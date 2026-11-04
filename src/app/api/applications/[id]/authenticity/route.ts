// SeeWe - POST /api/applications/[id]/authenticity
// RECRUITER-ONLY AI resume-authenticity scan for a specific application.
//
// Produces a trust verdict {score 0-100, level TRUSTED|REVIEW|HIGH_RISK,
// flags[], summary, recommendNextStep} from the candidate's resume text,
// cover note, profile facts and the job requirements — plus a deterministic
// heuristic fallback when the LLM is unavailable (the endpoint must always
// return a usable verdict for the recruiter).
//
// CANDIDATE PRIVACY (absolute): the result is persisted on the application and
// ONLY ever returned to the job's own recruiter. Candidate-facing read paths
// strip authenticityCheck/authenticityScore (see stripScreenFields in
// /api/applications/[id] and stripPrivateFields in /api/applications).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson } from '@/lib/ai-client'
import { logApplicationEvent, actorNameFor } from '@/lib/application-events'

export const dynamic = 'force-dynamic'

const RESUME_CLIP = 2500
const COVER_CLIP = 800

type Level = 'TRUSTED' | 'REVIEW' | 'HIGH_RISK'

interface AuthVerdict {
  score: number
  level: Level
  flags: string[]
  summary: string
  recommendNextStep: string
}

interface PersistedVerdict extends AuthVerdict {
  source: 'ai' | 'heuristic'
  checkedAt: string
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

function levelFromScore(score: number): Level {
  if (score >= 75) return 'TRUSTED'
  if (score >= 45) return 'REVIEW'
  return 'HIGH_RISK'
}

const LEVELS: Level[] = ['TRUSTED', 'REVIEW', 'HIGH_RISK']

/** Coerce a raw LLM object into a safe verdict (clamped, never throws). */
function sanitizeVerdict(raw: unknown): AuthVerdict {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  let score = Number(obj.score)
  if (!Number.isFinite(score)) score = 50
  score = Math.max(0, Math.min(100, Math.round(score)))

  const rawLevel: string = typeof obj.level === 'string' ? obj.level.trim().toUpperCase() : ''
  const level: Level = (LEVELS as string[]).includes(rawLevel) ? (rawLevel as Level) : levelFromScore(score)

  const flags = Array.isArray(obj.flags)
    ? obj.flags
        .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        .map((f) => f.trim().slice(0, 240))
        .slice(0, 6)
    : []

  const summary =
    typeof obj.summary === 'string' && obj.summary.trim().length > 0
      ? obj.summary.trim().slice(0, 700)
      : 'No summary produced for this scan.'

  const recommendNextStep =
    typeof obj.recommendNextStep === 'string' && obj.recommendNextStep.trim().length > 0
      ? obj.recommendNextStep.trim().slice(0, 240)
      : 'Review the profile yourself before deciding the next step.'

  return { score, level, flags, summary, recommendNextStep }
}

/* ------------------------------------------------------------------ */
/* Deterministic heuristic fallback (no LLM required)                  */
/* ------------------------------------------------------------------ */

const BUZZWORDS = [
  'synergy', 'synergies', 'thought leader', 'thought leadership', 'results-driven',
  'results driven', 'self-starter', 'self starter', 'team player', 'detail-oriented',
  'detail oriented', 'hardworking', 'dynamic professional', 'innovative thinker',
  'strategic thinker', 'proven track record', 'excellent communication skills',
  'fast-paced', 'fast paced', 'wearing many hats', 'ninja', 'rockstar', 'guru',
  'wizard', 'extensive experience', 'responsible for', 'go-getter',
]

const SUPERLATIVES = [
  'best', 'world-class', 'world class', 'expert', 'master', 'exceptional',
  'outstanding', 'award-winning', 'award winning', 'premier', 'elite',
  'unparalleled', 'unmatched', 'perfect', 'number one', '#1',
]

const VAGUE_PHRASES = [
  'worked on', 'involved in', 'helped with', 'helped to', 'assisted with',
  'assisted in', 'familiar with', 'exposure to', 'participated in',
  'various tasks', 'day-to-day tasks', 'etc.',
]

function countHits(text: string, needles: string[]): number {
  const lower = text.toLowerCase()
  let hits = 0
  for (const n of needles) {
    // count every non-overlapping occurrence of the phrase
    let idx = lower.indexOf(n)
    while (idx !== -1) {
      hits++
      idx = lower.indexOf(n, idx + n.length)
    }
  }
  return hits
}

function heuristicVerdict(input: {
  resumeText: string
  coverNote: string
  experienceYears: number | null
  githubUrl: string | null
}): AuthVerdict & { source: 'heuristic' } {
  const text = `${input.resumeText}\n${input.coverNote}`.trim()
  const words = text.split(/\s+/).filter(Boolean)
  const wordCount = words.length

  // Near-empty evidence: nothing to verify beyond profile basics.
  if (wordCount < 40) {
    return {
      score: 42,
      level: 'REVIEW',
      flags: [
        'Very little written material to verify — resume text is missing or nearly empty',
      ],
      summary:
        'The application carries almost no written evidence to evaluate, so credibility cannot be established from the material provided. The profile basics alone are not enough to judge authenticity.',
      recommendNextStep:
        'Ask the candidate to share a detailed resume or walk through their experience live before advancing.',
      source: 'heuristic',
    }
  }

  const flags: string[] = []
  let score = 82

  // 1) Years-claim mismatch: "N+ years" in the text vs the stated profile years.
  let maxClaim = 0
  const yearRe = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)/gi
  let m: RegExpExecArray | null
  while ((m = yearRe.exec(text)) !== null) {
    const n = Number(m[1])
    if (Number.isFinite(n) && n > 0 && n <= 45 && n > maxClaim) maxClaim = n
  }
  if (input.experienceYears !== null && maxClaim >= input.experienceYears + 2) {
    flags.push(
      `Resume claims up to ${maxClaim} years of experience but the profile states ${input.experienceYears}`
    )
    score -= 15
  }

  // 2) Buzzword density (hits per 100 words).
  const buzzHits = countHits(text, BUZZWORDS)
  const buzzDensity = (buzzHits / wordCount) * 100
  if (buzzDensity > 3.5) {
    flags.push(
      `High buzzword density — ${buzzHits} filler phrases in ${wordCount} words with little supporting detail`
    )
    score -= 10
  }

  // 3) Superlative pile-up without evidence.
  const superHits = countHits(text, SUPERLATIVES)
  if (superHits >= 4) {
    flags.push(`${superHits} self-superlatives without concrete backing`)
    score -= 8
  }

  // 4) Metric ratio: share of lines containing digits (measurable outcomes).
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  const metricLines = lines.filter((l) => /\d/.test(l)).length
  const metricRatio = lines.length > 0 ? metricLines / lines.length : 0
  if (wordCount > 120 && metricRatio < 0.12) {
    flags.push(
      'Almost no measurable outcomes — very few lines contain any numbers or results'
    )
    score -= 12
  }

  // 5) Vague-phrase ratio.
  const vagueHits = countHits(text, VAGUE_PHRASES)
  const vagueDensity = (vagueHits / wordCount) * 100
  if (vagueDensity > 1.2 || (vagueHits >= 5 && wordCount < 400)) {
    flags.push(
      'Heavy use of vague phrases ("worked on", "involved in", "assisted with") instead of concrete achievements'
    )
    score -= 10
  }

  // Verifiable public work is a positive signal.
  if (input.githubUrl) score += 8

  score = Math.max(0, Math.min(100, Math.round(score)))
  if (flags.length === 0) {
    flags.push('No obvious credibility issues detected by the automated checks')
  }

  const level = levelFromScore(score)
  const summary =
    level === 'TRUSTED'
      ? `The material reads as specific and consistent — concrete details outweigh generic claims${input.githubUrl ? ', and a verifiable public code profile strengthens the picture' : ''}. Nothing in the automated checks suggests inflation.`
      : level === 'REVIEW'
        ? 'Some parts of the material look inflated or under-evidenced. The profile is plausible overall, but the flagged points deserve a direct conversation before relying on them.'
        : 'Several independent credibility concerns show up in the material. Treat the claims as unverified until the candidate can evidence them.'

  const recommendNextStep =
    level === 'TRUSTED'
      ? 'Proceed to interview — probe depth on the top skills with a focused technical conversation.'
      : level === 'REVIEW'
        ? 'Ask the candidate to walk through the flagged claims (timelines, metrics, ownership) before shortlisting.'
        : 'Request supporting proof — work samples, a public portfolio or detailed references — before advancing.'

  return { score, level, flags, summary, recommendNextStep, source: 'heuristic' }
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
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

    // Auth: the caller must be a RECRUITER who owns the application's job.
    const caller = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!caller || caller.role !== 'RECRUITER') {
      return NextResponse.json(
        { error: 'Only recruiters can run the authenticity scan' },
        { status: 403 }
      )
    }

    const application = await db.application.findUnique({
      where: { id },
      select: {
        id: true,
        coverNote: true,
        authenticityCheck: true,
        authenticityScore: true,
        job: {
          select: {
            id: true,
            title: true,
            skills: true,
            experienceMin: true,
            experienceMax: true,
            recruiterId: true,
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
            githubUrl: true,
          },
        },
      },
    })

    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }
    if (application.job.recruiterId !== caller.id) {
      return NextResponse.json(
        { error: 'You can only scan applications to your own jobs' },
        { status: 403 }
      )
    }

    // Idempotent unless force — a stored scan is authoritative.
    if (application.authenticityCheck && !force) {
      try {
        const stored = JSON.parse(application.authenticityCheck) as PersistedVerdict
        return NextResponse.json({ data: stored, cached: true })
      } catch {
        // Corrupt stored JSON → fall through and re-run the scan.
      }
    }

    const cand = application.candidate
    const resumeText = (cand.resumeText || '').slice(0, RESUME_CLIP)
    const coverNote = (application.coverNote || '').slice(0, COVER_CLIP)

    let verdict: AuthVerdict
    let source: 'ai' | 'heuristic' = 'ai'

    const system = [
      'You are a resume-authenticity reviewer on the trust team of a hiring platform.',
      'You receive a candidate profile, their resume text, their cover note and the job they applied to.',
      'Judge how credible and self-consistent the material looks and flag anything inflated, inconsistent, or templated or bulk-generated.',
      'Output STRICT JSON only — no markdown, no commentary — exactly this shape:',
      '{"score": <integer 0-100>, "level": "TRUSTED"|"REVIEW"|"HIGH_RISK", "flags": ["..."], "summary": "...", "recommendNextStep": "..."}',
      'Rules:',
      '- score: 0-100 where 100 means fully credible, well-evidenced and internally consistent; 0 means clearly fabricated.',
      '- level bands: TRUSTED = 75-100, REVIEW = 40-74, HIGH_RISK = 0-39.',
      '- flags: 0 to 5 short, specific, evidence-based strings quoting the exact evidence. Good examples: "Claims team leadership of 12 but resume describes only individual work", "Timeline overlap: two full-time roles in 2023-2024", "Long lists of tools with no project outcomes", "Formatting suggests templated or bulk-generated phrasing". Empty array when nothing suspicious.',
      '- Never accuse without quoting evidence. NEVER mention any AI-writing tool, chatbot or product by name — if phrasing looks machine-generated, write "templated or bulk-generated phrasing".',
      '- summary: 2-3 sentences, balanced and professional; mention credible strengths as well as concerns.',
      '- recommendNextStep: exactly one actionable line for the recruiter.',
      '- If a public code/portfolio link is provided, weigh that verifiable public work positively.',
    ].join('\n')

    const user = [
      'JOB APPLIED TO:',
      `Title: ${application.job.title}`,
      `Required skills: ${application.job.skills || '(none listed)'}`,
      `Experience range: ${application.job.experienceMin}-${application.job.experienceMax} years`,
      '',
      'CANDIDATE PROFILE:',
      `Name: ${cand.name}`,
      `Headline: ${cand.headline || '(none)'}`,
      `Stated total experience: ${cand.experienceYears ?? '(not stated)'} years`,
      `Skills: ${cand.skills || '(none listed)'}`,
      `Education: ${cand.education || '(none listed)'}`,
      `Public code profile: ${cand.githubUrl || '(none provided)'}`,
      '',
      `COVER NOTE: ${coverNote || '(none)'}`,
      '',
      'RESUME TEXT (may be truncated):',
      resumeText || '(no resume text provided)',
      '',
      'Run the authenticity review now and output only the JSON object.',
    ].join('\n')

    try {
      const raw = await chatWithRetry(system, user, 2)
      const parsed = extractJson<unknown>(raw)
      verdict = sanitizeVerdict(parsed)
      source = 'ai'
    } catch (aiErr) {
      console.error('[applications/authenticity] LLM failed, using heuristic fallback:', aiErr)
      const h = heuristicVerdict({
        resumeText,
        coverNote,
        experienceYears: cand.experienceYears ?? null,
        githubUrl: cand.githubUrl ?? null,
      })
      verdict = {
        score: h.score,
        level: h.level,
        flags: h.flags,
        summary: h.summary,
        recommendNextStep: h.recommendNextStep,
      }
      source = 'heuristic'
    }

    const persisted: PersistedVerdict = {
      ...verdict,
      source,
      checkedAt: new Date().toISOString(),
    }

    await db.application.update({
      where: { id: application.id },
      data: {
        authenticityCheck: JSON.stringify(persisted),
        authenticityScore: persisted.score,
      },
    })

    // §10 audit trail: resume authenticity scan (recruiter-only row — logged
    // under AI_SCREEN; candidates never receive it). Non-fatal.
    void actorNameFor(caller.id)
      .then((actorName) =>
        logApplicationEvent(db, {
          applicationId: application.id,
          type: 'AI_SCREEN',
          actorRole: 'RECRUITER',
          actorName,
          note: `Resume authenticity scan · score ${persisted.score}/100 (${persisted.level})`,
        })
      )
      .catch((err) => console.error('[application-events] non-fatal authenticity log failure:', err))

    return NextResponse.json({ data: persisted })
  } catch (err) {
    console.error('POST /api/applications/[id]/authenticity failed:', err)
    return NextResponse.json(
      { error: 'Could not complete the authenticity scan' },
      { status: 500 }
    )
  }
}
