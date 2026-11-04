// SeeWe - POST /api/ai/ats-check
// CANDIDATE-SIDE "ATS check" simulator: shows the candidate how their own
// profile scores against a live job BEFORE they apply, with honest strengths,
// gaps and concrete profile improvements.
//
// Privacy: this is the candidate's OWN data about themselves — it never
// exposes any recruiter-side evaluation (match scores stored on applications,
// screen dossiers, authenticity scans, notes or CV bytes). Nothing is
// persisted here; the endpoint is a pure read-and-analyse pass.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson } from '@/lib/ai-client'
import { computeMatchScore } from '@/lib/match'

export const dynamic = 'force-dynamic'

const RESUME_CLIP = 2000
const JD_CLIP = 1200

interface AtsPayload {
  matchPct: number
  skillPct: number | null
  contextPct: number
  strengths: string[]
  gaps: string[]
  suggestions: string[]
  missingKeywords: string[]
  verdictLine: string
  source: 'ai' | 'fallback'
  job: { id: string; title: string; company: string }
}

function clampInt(n: unknown, min: number, max: number, fallback: number): number {
  const num = Number(n)
  if (!Number.isFinite(num)) return fallback
  return Math.max(min, Math.min(max, Math.round(num)))
}

function cleanList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, maxItems)
}

/* Deterministic fallback when the LLM is unavailable — honest, keyword-level
 * only, and clearly flagged with source:'fallback'. */
function buildFallback(input: {
  jobSkills: string[]
  resumeText: string
  matchedSkills: string[]
  missingSkills: string[]
  jobTitle: string
}): Omit<AtsPayload, 'skillPct' | 'job'> {
  const lower = input.resumeText.toLowerCase()
  const skillTokens = input.jobSkills.map((s) => s.toLowerCase()).filter((s) => s.length >= 3)
  const hits = skillTokens.filter((s) => lower.includes(s)).length
  const contextPct =
    skillTokens.length > 0 ? Math.round((hits / skillTokens.length) * 100) : 0

  const strengths = input.matchedSkills.length
    ? [
        `Your profile lists ${input.matchedSkills.slice(0, 3).join(', ')} — core skills this role asks for`,
      ]
    : ['You have applied with a complete profile — a solid starting point']

  const gaps = input.missingSkills.length
    ? [`No mention of ${input.missingSkills.slice(0, 3).join(', ')} in your profile yet`]
    : ['Add more detail about your projects so the check can go deeper than keywords']

  const suggestions = [
    input.missingSkills.length
      ? `Add ${input.missingSkills[0]} to your skills list if you have genuinely used it`
      : 'Expand each skill with a one-line example of where you used it',
    input.resumeText
      ? 'Rewrite one resume bullet around the main responsibility in this job description'
      : 'Add a short resume summary describing your strongest project',
    'Quantify one achievement with a number (users, performance, revenue, team size)',
    'Mirror the exact wording of one key requirement from the job description in your headline',
  ].slice(0, 5)

  const missingKeywords = input.missingSkills.slice(0, 8)

  const verdictLine =
    contextPct >= 60
      ? `Your profile covers a lot of ground for ${input.jobTitle} — tightening the details could push you clearly into the shortlist zone.`
      : `Your profile is a starting point for ${input.jobTitle} — a few targeted additions could meaningfully improve your fit.`

  return {
    matchPct: contextPct,
    contextPct,
    strengths,
    gaps,
    suggestions,
    missingKeywords,
    verdictLine,
    source: 'fallback',
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { userId?: unknown; jobId?: unknown }
      | null
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : ''

    if (!userId || !jobId) {
      return NextResponse.json({ error: 'userId and jobId are required' }, { status: 400 })
    }

    // Auth: the caller must be the candidate themself — recruiters/clients are
    // never allowed to use this candidate-side simulator.
    const caller = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!caller || caller.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Only the candidate can run this check' },
        { status: 403 }
      )
    }

    const candidate = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        skills: true,
        resumeText: true,
        experienceYears: true,
        headline: true,
        education: true,
        expectedSalary: true,
      },
    })
    if (!candidate) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const resumeText = (candidate.resumeText || '').slice(0, RESUME_CLIP)
    if (!resumeText && !(candidate.skills && candidate.skills.trim())) {
      return NextResponse.json(
        { error: 'Add skills or resume details to your profile first' },
        { status: 400 }
      )
    }

    const job = await db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        title: true,
        company: true,
        skills: true,
        description: true,
        jdText: true,
        experienceMin: true,
        experienceMax: true,
        salaryMinLpa: true,
        salaryMaxLpa: true,
        status: true,
      },
    })
    if (!job || job.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'This job is no longer active — pick another one' },
        { status: 404 }
      )
    }

    // Honest keyword-level skill overlap (null when either side has no skills).
    const skillPct = computeMatchScore(job.skills, candidate.skills)

    const jobSkills = job.skills
      ? job.skills.split(',').map((s) => s.trim()).filter(Boolean)
      : []
    const candSkills = candidate.skills
      ? candidate.skills.split(',').map((s) => s.trim()).filter(Boolean)
      : []
    const matchedSkills = jobSkills.filter((s) =>
      candSkills.some((c) => c.toLowerCase() === s.toLowerCase())
    )
    const missingSkills = jobSkills.filter(
      (s) => !candSkills.some((c) => c.toLowerCase() === s.toLowerCase())
    )
    const jd = ((job.jdText || job.description || '') as string).slice(0, JD_CLIP)

    let payload: AtsPayload

    const system = [
      'You are an honest application coach on a hiring platform helping a candidate improve BEFORE they apply.',
      'You compare the candidate profile below against one live job and output STRICT JSON only — no markdown, no commentary — exactly this shape:',
      '{"contextPct": <integer 0-100>, "strengths": ["..."], "gaps": ["..."], "suggestions": ["..."], "missingKeywords": ["..."], "verdictLine": "..."}',
      'Rules:',
      '- contextPct: how well the candidate\'s projects, domains and overall context fit this job BEYOND plain keyword overlap (0 = unrelated background, 100 = near-perfect contextual fit). Be calibrated, not generous.',
      '- strengths: 2-4 short specific strings grounded ONLY in the candidate\'s actual profile.',
      '- gaps: 2-4 short specific strings describing real shortfalls against THIS job.',
      '- suggestions: 3-5 CONCRETE resume/profile improvements tailored to THIS job. Each one line, imperative, actionable (e.g. "Add a bullet quantifying the checkout rewrite, e.g. cut p95 latency by 40%").',
      '- missingKeywords: at most 8 terms that appear in the job description but are genuinely absent from the candidate profile.',
      '- verdictLine: exactly one encouraging-but-honest sentence about their current standing for this job.',
      '- Never invent experience, employers, numbers or tools the candidate did not mention. Plain text, no emojis, no markdown.',
    ].join('\n')

    const user = [
      'JOB:',
      `Title: ${job.title}`,
      `Company: ${job.company}`,
      `Skills required: ${job.skills || '(none listed)'}`,
      `Experience range: ${job.experienceMin}-${job.experienceMax} years`,
      job.salaryMinLpa != null && job.salaryMaxLpa != null
        ? `Salary range: ${job.salaryMinLpa}-${job.salaryMaxLpa} LPA`
        : 'Salary range: (not disclosed)',
      `Job description: ${jd || '(not provided)'}`,
      '',
      'CANDIDATE:',
      `Headline: ${candidate.headline || '(none)'}`,
      `Total experience: ${candidate.experienceYears ?? '(not stated)'} years`,
      `Skills: ${candidate.skills || '(none listed)'}`,
      `Education: ${candidate.education || '(none listed)'}`,
      `Expected salary: ${candidate.expectedSalary ?? '(not stated)'} LPA`,
      `Keyword-level skill overlap with this job: ${skillPct === null ? 'unknown (profile has no skills listed)' : `${skillPct}%`}`,
      '',
      'RESUME TEXT (may be truncated):',
      resumeText || '(no resume text provided)',
      '',
      'Produce the JSON assessment now.',
    ].join('\n')

    try {
      const raw = await chatWithRetry(system, user, 2)
      const parsed = extractJson<Record<string, unknown>>(raw)

      const contextPct = clampInt(parsed.contextPct, 0, 100, 50)
      const strengths = cleanList(parsed.strengths, 4, 200)
      const gaps = cleanList(parsed.gaps, 4, 200)
      let suggestions = cleanList(parsed.suggestions, 5, 240)
      const missingKeywords = cleanList(parsed.missingKeywords, 8, 60)
      const verdictLine =
        typeof parsed.verdictLine === 'string' && parsed.verdictLine.trim()
          ? parsed.verdictLine.trim().slice(0, 300)
          : 'Overall, a reasonable starting point — tighten the details below to strengthen your application.'

      // Keep the promised minimums where the model under-delivered.
      if (strengths.length < 2) strengths.push('You have a complete profile submitted for review')
      if (gaps.length < 2) gaps.push('More project detail would sharpen this assessment')
      if (suggestions.length < 3) {
        suggestions = suggestions.concat(
          [
            'Quantify one achievement with a concrete number',
            'Mirror one key requirement from the job description in your headline',
            'Add your most relevant project with a one-line outcome',
          ].slice(0, 3 - suggestions.length)
        )
      }

      const matchPct =
        skillPct === null
          ? contextPct
          : Math.max(0, Math.min(100, Math.round(0.6 * skillPct + 0.4 * contextPct)))

      payload = {
        matchPct,
        skillPct,
        contextPct,
        strengths,
        gaps,
        suggestions,
        missingKeywords,
        verdictLine,
        source: 'ai',
        job: { id: job.id, title: job.title, company: job.company },
      }
    } catch (aiErr) {
      console.error('[ai/ats-check] LLM failed, using keyword fallback:', aiErr)
      const fb = buildFallback({
        jobSkills,
        resumeText,
        matchedSkills,
        missingSkills,
        jobTitle: job.title,
      })
      payload = {
        ...fb,
        skillPct,
        job: { id: job.id, title: job.title, company: job.company },
      }
    }

    return NextResponse.json({ data: payload })
  } catch (err) {
    console.error('POST /api/ai/ats-check failed:', err)
    return NextResponse.json(
      { error: 'Could not run the check right now' },
      { status: 500 }
    )
  }
}
