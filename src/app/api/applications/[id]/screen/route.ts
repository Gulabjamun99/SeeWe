import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson } from '@/lib/ai-client'
import type { ScreenSummary, ScreenVerdict } from '@/lib/types'
import { logApplicationEvent, actorNameFor } from '@/lib/application-events'

const VERDICTS: ScreenVerdict[] = ['STRONG_FIT', 'GOOD_FIT', 'WEAK_FIT']

function clip(text: string | null | undefined, max: number): string {
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function toStrArray(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim().slice(0, 60))
    .slice(0, max)
}

function toLine(v: unknown, fallback: string, max = 200): string {
  if (typeof v !== 'string' || !v.trim()) return fallback
  return v.trim().replace(/\s+/g, ' ').slice(0, max)
}

/* ------------------------------------------------------------------ */
/* Deterministic template fallback (AI-free screening)                 */
/* ------------------------------------------------------------------ */

function parseSkillsCsv(csv?: string | null): string[] {
  if (!csv) return []
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function templateScreen(opts: {
  jobSkills: string[]
  candidateSkills: string[]
  experienceYears: number | null
  experienceMin: number
  experienceMax: number
}): ScreenSummary {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]/g, '')
  const candSet = new Set(opts.candidateSkills.map(norm))
  const matchedSkills = opts.jobSkills.filter((s) => candSet.has(norm(s)))
  const missingSkills = opts.jobSkills.filter((s) => !candSet.has(norm(s)))

  const ratio = opts.jobSkills.length > 0 ? matchedSkills.length / opts.jobSkills.length : 0
  const exp = opts.experienceYears
  const inWindow = exp != null && exp >= opts.experienceMin && exp <= opts.experienceMax
  const belowWindow = exp != null && exp < opts.experienceMin

  let verdict: ScreenVerdict
  if (ratio >= 0.7 && !belowWindow) verdict = 'STRONG_FIT'
  else if (ratio >= 0.4 || (inWindow && ratio >= 0.3)) verdict = 'GOOD_FIT'
  else verdict = 'WEAK_FIT'

  const expLine =
    exp == null
      ? `Experience not stated on the profile (role asks for ${opts.experienceMin}–${opts.experienceMax} years).`
      : `${exp} year${exp === 1 ? '' : 's'} of experience against a ${opts.experienceMin}–${opts.experienceMax} year window${
          belowWindow ? ' — below the requested range' : inWindow ? ' — inside the requested range' : ' — above the requested range'
        }.`

  const screenNote = [
    `Skills overlap covers ${matchedSkills.length} of ${opts.jobSkills.length} required skills${
      matchedSkills.length > 0 ? ` (${matchedSkills.slice(0, 6).join(', ')})` : ''
    }.`,
    missingSkills.length > 0
      ? `Not evidenced on profile: ${missingSkills.slice(0, 6).join(', ')}.`
      : 'No required-skill gaps detected from the profile.',
    expLine,
  ].join(' ')

  const flags: string[] = []
  if (belowWindow) flags.push(`Experience below the ${opts.experienceMin}-year minimum`)
  if (ratio < 0.4 && opts.jobSkills.length > 0) flags.push('Less than 40% of required skills evidenced')
  if (missingSkills.length > opts.jobSkills.length / 2) flags.push('Majority of required skills missing from profile')

  return {
    headline: `Rule-based screen · ${matchedSkills.length}/${opts.jobSkills.length} skills matched`,
    verdict,
    matchedSkills,
    missingSkills,
    experienceFit: expLine,
    screenNote,
    flags,
  }
}

/* ------------------------------------------------------------------ */
/* POST /api/applications/[id]/screen — run (or re-run) the AI screen  */
/* Body: { userId: string (must be the job's RECRUITER), force?: boolean } */
/* ------------------------------------------------------------------ */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as { userId?: unknown; force?: unknown } | null
    const userId = typeof body?.userId === 'string' ? body.userId : ''
    const force = body?.force === true

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const caller = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!caller || caller.role !== 'RECRUITER') {
      // Candidate-facing guard: screen dossiers are recruiter-only, full stop.
      return NextResponse.json(
        { error: 'Only a recruiter can run the AI screen' },
        { status: 403 }
      )
    }

    const application = await db.application.findUnique({
      where: { id },
      include: {
        job: {
          select: {
            id: true,
            recruiterId: true,
            title: true,
            skills: true,
            experienceMin: true,
            experienceMax: true,
            description: true,
            jdText: true,
          },
        },
        candidate: {
          select: {
            id: true,
            name: true,
            headline: true,
            skills: true,
            experienceYears: true,
            education: true,
            resumeText: true,
          },
        },
      },
    })

    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    // Ownership: the caller must be the job's own recruiter.
    if (application.job.recruiterId !== caller.id) {
      return NextResponse.json(
        { error: "Only the job's recruiter can screen this application" },
        { status: 403 }
      )
    }

    // Idempotent: an existing screen is returned as-is unless force=true.
    if (application.screenSummary && !force) {
      try {
        const existing = JSON.parse(application.screenSummary) as ScreenSummary
        return NextResponse.json({ data: existing, cached: true })
      } catch {
        // corrupt stored JSON → fall through and regenerate
      }
    }

    const jobSkills = parseSkillsCsv(application.job.skills)
    const candidateSkills = parseSkillsCsv(application.candidate.skills)
    const fallback = templateScreen({
      jobSkills,
      candidateSkills,
      experienceYears: application.candidate.experienceYears ?? null,
      experienceMin: application.job.experienceMin,
      experienceMax: application.job.experienceMax,
    })

    let summary: ScreenSummary = fallback
    try {
      const raw = await chatWithRetry(
        [
          'You are a precise, factual recruiter screening assistant.',
          'Compare one candidate against one job and output a screening dossier.',
          'STRICT JSON only — no markdown fences, no commentary. Shape:',
          '{"headline": string (one line), "verdict": "STRONG_FIT"|"GOOD_FIT"|"WEAK_FIT", "matchedSkills": string[], "missingSkills": string[], "experienceFit": string (one line), "screenNote": string (2-4 sentences, factual, hiring-relevant), "flags": string[]}',
          'Rules: base every statement ONLY on the provided profile and job text; no speculation, no protected-characteristic remarks; flags may be an empty array; use verdict WEAK_FIT only when the gap is material.',
        ].join('\n'),
        JSON.stringify({
          job: {
            title: application.job.title,
            requiredSkills: jobSkills,
            experienceWindow: `${application.job.experienceMin}-${application.job.experienceMax} years`,
            description: clip(application.job.jdText || application.job.description, 1200),
          },
          candidate: {
            name: application.candidate.name,
            headline: clip(application.candidate.headline, 160),
            skills: candidateSkills,
            experienceYears: application.candidate.experienceYears,
            education: clip(application.candidate.education, 200),
            resumeExcerpt: clip(application.candidate.resumeText, 1500),
          },
        })
      )
      const parsed = extractJson<Partial<ScreenSummary>>(raw)
      const verdict: ScreenVerdict = VERDICTS.includes(parsed.verdict as ScreenVerdict)
        ? (parsed.verdict as ScreenVerdict)
        : fallback.verdict
      summary = {
        headline: toLine(parsed.headline, fallback.headline),
        verdict,
        matchedSkills: toStrArray(parsed.matchedSkills, 14),
        missingSkills: toStrArray(parsed.missingSkills, 14),
        experienceFit: toLine(parsed.experienceFit, fallback.experienceFit),
        screenNote: toLine(parsed.screenNote, fallback.screenNote, 600),
        flags: toStrArray(parsed.flags, 6),
      }
    } catch (err) {
      console.error('[screen] AI screen failed — using deterministic template:', err)
    }

    await db.application.update({
      where: { id },
      data: {
        screenSummary: JSON.stringify(summary),
        screenVerdict: summary.verdict,
      },
    })

    // §10 audit trail: AI screen dossier generated (recruiter-only row —
    // candidates never receive AI_SCREEN events). Non-fatal.
    void actorNameFor(caller.id)
      .then((actorName) =>
        logApplicationEvent(db, {
          applicationId: id,
          type: 'AI_SCREEN',
          actorRole: 'RECRUITER',
          actorName,
          note: `AI screen dossier generated · verdict ${summary.verdict}`,
        })
      )
      .catch((err) => console.error('[application-events] non-fatal screen log failure:', err))

    return NextResponse.json({ data: summary, cached: false })
  } catch (err) {
    console.error('POST /api/applications/[id]/screen failed:', err)
    return NextResponse.json({ error: 'Failed to run AI screen' }, { status: 500 })
  }
}
