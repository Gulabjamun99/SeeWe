// SeeWe - POST /api/ai/cv-optimizer
//
// Master spec §6 — job-specific resume suggestions, CANDIDATE-PRIVATE.
// Compares the candidate's CV/profile against one ACTIVE job's requirements
// and returns: match score, missing/strong keywords, a suggested profile
// summary, improved bullet suggestions and a one-line verdict.
//
// PRIVACY (permanent rule): this output belongs to the candidate alone. It is
// NEVER written to Application/User/any recruiter-visible surface — the route
// only reads, and the response rides straight back to the candidate's UI.
//
// body: { jobId, candidateId } — candidateId must be a CANDIDATE (403 for
// others), mirroring how /api/applications passes the acting user's id.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson } from '@/lib/ai-client'

export const dynamic = 'force-dynamic'

export interface OptimizerBullet {
  target: string
  improved: string
}

export interface CvOptimizerResult {
  matchScore: number
  missingKeywords: string[]
  strongKeywords: string[]
  summarySuggestion: string
  bulletSuggestions: OptimizerBullet[]
  verdict: string
  /** ai = live LLM, heuristic = deterministic keyword-overlap fallback */
  source: 'ai' | 'heuristic'
}

const clampScore = (n: unknown, fallback: number): number => {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(0, Math.min(100, Math.round(v)))
}

const strArray = (v: unknown, max = 12): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        .map((x) => x.trim())
        .slice(0, max)
    : []

/* ------------------------------------------------------------------ */
/* Deterministic fallback (AI unavailable) — keyword overlap scoring   */
/* ------------------------------------------------------------------ */

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
  )
}

function heuristicResult(
  jobSkills: string[],
  jdText: string,
  candidateSkills: string[],
  candidateText: string
): CvOptimizerResult {
  const candidateTokens = tokenize(`${candidateSkills.join(' ')} ${candidateText}`)
  const jdTokens = tokenize(jdText)

  const strongKeywords: string[] = []
  const missingKeywords: string[] = []
  for (const skill of jobSkills) {
    const s = skill.toLowerCase().trim()
    if (!s) continue
    if (candidateTokens.has(s)) strongKeywords.push(skill)
    else missingKeywords.push(skill)
  }

  // Extra JD keywords the CV never mentions (top few, excluding skill hits)
  const extraMissing = [...jdTokens]
    .filter((t) => !candidateTokens.has(t) && t.length >= 4)
    .slice(0, 4)
  for (const t of extraMissing) {
    if (!missingKeywords.some((m) => m.toLowerCase() === t)) missingKeywords.push(t)
  }

  const overlap = strongKeywords.length
  const total = jobSkills.length || 1
  const matchScore = clampScore((overlap / total) * 100, 0)

  const headlineSkill = candidateSkills[0] ?? 'your domain'
  const summarySuggestion =
    `${headlineSkill} professional with hands-on experience across ` +
    `${strongKeywords.slice(0, 4).join(', ') || 'core delivery work'}. ` +
    (missingKeywords.length
      ? `Currently strengthening: ${missingKeywords.slice(0, 3).join(', ')}.`
      : `Strong overlap with this role's requirements.`)

  const bulletSuggestions: OptimizerBullet[] = [
    {
      target: 'Profile summary / headline',
      improved: missingKeywords.length
        ? `Add measurable work featuring ${missingKeywords.slice(0, 3).join(', ')} — this JD asks for them explicitly.`
        : `Quantify your top achievement with a number (%, users, latency, revenue).`,
    },
    {
      target: 'Most recent experience',
      improved: `Start with an action verb and tie the outcome to the role: "Delivered X using ${strongKeywords[0] ?? headlineSkill}, improving Y by Z%".`,
    },
  ]

  const verdict =
    matchScore >= 70
      ? 'Strong overlap — your CV already covers most of what this role asks for.'
      : matchScore >= 40
        ? 'Decent base — add the missing keywords to move into the shortlist zone.'
        : 'Big gap — rework your CV around this JD before applying.'

  return {
    matchScore,
    missingKeywords: missingKeywords.slice(0, 10),
    strongKeywords: strongKeywords.slice(0, 10),
    summarySuggestion,
    bulletSuggestions,
    verdict,
    source: 'heuristic',
  }
}

/* ------------------------------------------------------------------ */
/* Route                                                               */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : ''
    const candidateId = typeof body?.candidateId === 'string' ? body.candidateId.trim() : ''

    if (!jobId || !candidateId) {
      return NextResponse.json({ error: 'jobId and candidateId are required' }, { status: 400 })
    }

    // Candidate-only surface (privacy rule): any other role gets 403.
    const candidate = await db.user.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        role: true,
        name: true,
        headline: true,
        skills: true,
        experienceYears: true,
        resumeText: true,
        workExperiences: {
          orderBy: { createdAt: 'desc' as const },
          select: { title: true, company: true, isCurrent: true, description: true },
        },
        projects: {
          orderBy: { createdAt: 'desc' as const },
          select: { title: true, techStack: true, description: true },
        },
      },
    })
    if (!candidate || candidate.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'The CV optimizer is available to candidate accounts only' },
        { status: 403 }
      )
    }

    const job = await db.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        title: true,
        company: true,
        status: true,
        skills: true,
        description: true,
        jdText: true,
        experienceMin: true,
        experienceMax: true,
      },
    })
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'This job is no longer active — the optimizer only analyzes open roles' },
        { status: 409 }
      )
    }

    const jobSkills = job.skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const candidateSkills = (candidate.skills ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const experienceBlock = candidate.workExperiences
      .map(
        (e) =>
          `- ${e.title} @ ${e.company}${e.isCurrent ? ' (current)' : ''}: ${e.description ?? 'no details listed'}`
      )
      .join('\n')
    const projectsBlock = candidate.projects
      .map((p) => `- ${p.title} [${p.techStack ?? 'no stack listed'}]: ${p.description ?? 'no details listed'}`)
      .join('\n')

    const jdText = (job.jdText || job.description || '').slice(0, 2500)
    const resumeText = (candidate.resumeText ?? '').slice(0, 2500)

    const system = [
      'You are an expert Indian recruitment CV coach for an Indian job portal.',
      'You compare one candidate against one job and answer with STRICT JSON only —',
      'no markdown fences, no commentary.',
      'JSON shape:',
      '{',
      '  "matchScore": number 0-100,',
      '  "missingKeywords": string[],',
      '  "strongKeywords": string[],',
      '  "summarySuggestion": string,',
      '  "bulletSuggestions": [{ "target": string, "improved": string }],',
      '  "verdict": string',
      '}',
      'Rules: matchScore reflects keyword+experience fit for THIS job; missingKeywords are JD skills/keywords absent from the CV (max 8); strongKeywords are matched strengths (max 8); summarySuggestion is a 2-3 sentence profile summary rewritten for this job; every bulletSuggestions.target MUST be an existing experience/project title from the candidate profile and improved is one action-verb enhanced bullet with a concrete outcome; verdict is ONE line.',
    ].join('\n')

    const user = [
      `JOB: ${job.title} @ ${job.company} (experience ${job.experienceMin}-${job.experienceMax} yrs)`,
      `JOB SKILLS: ${jobSkills.join(', ')}`,
      `JOB DESCRIPTION: ${jdText}`,
      '',
      `CANDIDATE: ${candidate.name} — headline: ${candidate.headline ?? 'none'} — experience: ${candidate.experienceYears ?? '?'} yrs`,
      `CANDIDATE SKILLS: ${candidateSkills.join(', ') || 'none listed'}`,
      `RESUME TEXT: ${resumeText || 'none'}`,
      `WORK EXPERIENCE:\n${experienceBlock || 'none listed'}`,
      `PROJECTS:\n${projectsBlock || 'none listed'}`,
      '',
      'Return ONLY the JSON object.',
    ].join('\n')

    try {
      const raw = await chatWithRetry(system, user)
      const parsed = extractJson<Partial<CvOptimizerResult>>(raw)

      const fallback = heuristicResult(jobSkills, jdText, candidateSkills, `${resumeText} ${experienceBlock} ${projectsBlock}`)

      const bullets: OptimizerBullet[] = Array.isArray(parsed.bulletSuggestions)
        ? parsed.bulletSuggestions
            .filter(
              (b): b is OptimizerBullet =>
                !!b &&
                typeof b === 'object' &&
                typeof (b as OptimizerBullet).target === 'string' &&
                typeof (b as OptimizerBullet).improved === 'string'
            )
            .map((b) => ({ target: b.target.slice(0, 120), improved: b.improved.slice(0, 400) }))
            .slice(0, 5)
        : []

      const result: CvOptimizerResult = {
        matchScore: clampScore(parsed.matchScore, fallback.matchScore),
        missingKeywords: strArray(parsed.missingKeywords, 8).length
          ? strArray(parsed.missingKeywords, 8)
          : fallback.missingKeywords,
        strongKeywords: strArray(parsed.strongKeywords, 8).length
          ? strArray(parsed.strongKeywords, 8)
          : fallback.strongKeywords,
        summarySuggestion:
          typeof parsed.summarySuggestion === 'string' && parsed.summarySuggestion.trim()
            ? parsed.summarySuggestion.trim().slice(0, 900)
            : fallback.summarySuggestion,
        bulletSuggestions: bullets.length ? bullets : fallback.bulletSuggestions,
        verdict:
          typeof parsed.verdict === 'string' && parsed.verdict.trim()
            ? parsed.verdict.trim().slice(0, 240)
            : fallback.verdict,
        source: 'ai',
      }

      return NextResponse.json({ data: result })
    } catch (aiErr) {
      console.error('[cv-optimizer] AI path failed, using heuristic fallback:', aiErr)
      const fallback = heuristicResult(
        jobSkills,
        jdText,
        candidateSkills,
        `${resumeText} ${experienceBlock} ${projectsBlock}`
      )
      return NextResponse.json({
        data: fallback,
      })
    }
  } catch (err) {
    console.error('POST /api/ai/cv-optimizer failed:', err)
    return NextResponse.json(
      { error: 'Could not analyze your CV right now — please try again' },
      { status: 500 }
    )
  }
}
