// SeeWe - POST /api/ai/role-fit-deepdive
// CANDIDATE-SIDE "Contextual role-fit deep-dive": a narrative companion to the
// ATS keyword check. Instead of a percentage, it maps the candidate's actual
// projects, story and skills onto ONE live job — pitching how to frame their
// past work for this specific role, what transfers, where the honest gaps are,
// and how to walk into the interview prepared.
//
// Privacy: candidate-only endpoint showing the candidate's OWN fit guidance
// (clearly framed self-assessment). It never exposes any recruiter-side
// evaluation — no screen verdicts, stored match scores or authenticity scans.
// Nothing is persisted; the deep-dive is a pure read-and-analyse pass.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson } from '@/lib/ai-client'

export const dynamic = 'force-dynamic'

const RESUME_CLIP = 3000
const JD_CLIP = 2000

type Readiness = 'READY_NOW' | 'READY_SOON' | 'STRETCH'
const READINESS_VALUES: Readiness[] = ['READY_NOW', 'READY_SOON', 'STRETCH']

interface ProjectAngle {
  title: string
  pitch: string
}

interface InterviewPrepItem {
  question: string
  angle: string
}

interface DeepDivePayload {
  fitSummary: string
  projectAngles: ProjectAngle[]
  transferableStrengths: string[]
  riskFlags: string[]
  interviewPrep: InterviewPrepItem[]
  readiness: Readiness
  readinessLine: string
  source: 'ai' | 'heuristic'
  job: { id: string; title: string; company: string }
}

function cleanStr(v: unknown, maxLen: number): string {
  return typeof v === 'string' ? v.trim().slice(0, maxLen) : ''
}

function cleanList(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return []
  return v
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .map((s) => s.trim().slice(0, maxLen))
    .slice(0, maxItems)
}

function cleanAngleList(
  v: unknown,
  maxItems: number,
  titleLen: number,
  pitchLen: number
): ProjectAngle[] {
  if (!Array.isArray(v)) return []
  return v
    .map((item): ProjectAngle | null => {
      if (!item || typeof item !== 'object') return null
      const rec = item as Record<string, unknown>
      const title = cleanStr(rec.title, titleLen)
      const pitch = cleanStr(rec.pitch, pitchLen)
      if (!title && !pitch) return null
      return { title: title || 'Untitled project angle', pitch: pitch || title }
    })
    .filter((a): a is ProjectAngle => a !== null)
    .slice(0, maxItems)
}

function cleanPrepList(
  v: unknown,
  maxItems: number,
  qLen: number,
  aLen: number
): InterviewPrepItem[] {
  if (!Array.isArray(v)) return []
  return v
    .map((item): InterviewPrepItem | null => {
      if (!item || typeof item !== 'object') return null
      const rec = item as Record<string, unknown>
      const question = cleanStr(rec.question, qLen)
      const angle = cleanStr(rec.angle, aLen)
      if (!question && !angle) return null
      return { question: question || 'Tell me about a relevant project', angle: angle || question }
    })
    .filter((p): p is InterviewPrepItem => p !== null)
    .slice(0, maxItems)
}

function readinessOf(v: unknown): Readiness {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  return READINESS_VALUES.includes(s as Readiness) ? (s as Readiness) : 'READY_SOON'
}

function splitSkills(csv?: string | null): string[] {
  if (!csv) return []
  return csv.split(',').map((s) => s.trim()).filter(Boolean)
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/* Deterministic heuristic fallback when the LLM is unavailable — built purely
 * from skill overlap, the job's own requirements and the experience band.
 * Clearly flagged with source:'heuristic'. */
function buildHeuristic(input: {
  jobTitle: string
  jobSkills: string[]
  candSkills: string[]
  candExp: number | null
  expMin: number
  expMax: number
  workMode: string
  hasResume: boolean
}): Omit<DeepDivePayload, 'job'> {
  const jobLower = input.jobSkills.map((s) => s.toLowerCase())
  const candLower = new Set(input.candSkills.map((s) => s.toLowerCase()))
  const overlap = input.jobSkills.filter((s) => candLower.has(s.toLowerCase()))
  const missing = input.jobSkills.filter((s) => !candLower.has(s.toLowerCase()))
  const ratio = jobLower.length > 0 ? overlap.length / jobLower.length : 0

  const readiness: Readiness = ratio >= 0.6 ? 'READY_NOW' : ratio >= 0.35 ? 'READY_SOON' : 'STRETCH'

  const projectAngles: ProjectAngle[] = []
  for (const skill of overlap.slice(0, 3)) {
    projectAngles.push({
      title: `Frame one project around ${skill}`,
      pitch: `Pick a real project where you used ${skill} and walk through the problem, your decisions and the measurable outcome — it maps directly to a core requirement of this role.`,
    })
  }
  // Top up to at least 2 angles from the candidate's own strongest skills.
  const ownSkills = input.candSkills
    .filter((s) => !overlap.some((o) => o.toLowerCase() === s.toLowerCase()))
    .slice(0, 2)
  for (const skill of ownSkills) {
    if (projectAngles.length >= 2) break
    projectAngles.push({
      title: `Lead with your ${skill} depth`,
      pitch: `${skill} is not word-for-word in this job description, but your hands-on work with it shows the underlying problem-solving this team needs — frame it that way.`,
    })
  }
  while (projectAngles.length < 2) {
    projectAngles.push(
      input.hasResume
        ? {
            title: 'Pick your single strongest project',
            pitch:
              'Choose the project closest to this role and prepare a 60-second story: the context, what you personally built and what changed because of it.',
          }
        : {
            title: 'Add project detail to your profile',
            pitch:
              'Your profile is light on project detail — add one concrete project with its outcome so your experience can speak for itself.',
          }
    )
  }

  const transferableStrengths: string[] = []
  if (overlap.length > 0) {
    transferableStrengths.push(
      `Hands-on with ${overlap.slice(0, 3).join(', ')} — skills this role uses daily`
    )
  }
  if (input.candExp != null && input.candExp >= input.expMin) {
    transferableStrengths.push(
      `${input.candExp} years of experience sits inside the ${input.expMin}-${input.expMax} year band for this role`
    )
  }
  if (input.hasResume) {
    transferableStrengths.push('A written profile with real project context to draw stories from')
  }
  if (input.candSkills.length > 0) {
    transferableStrengths.push(
      `A breadth of skills (${input.candSkills.slice(0, 4).join(', ')}) that shows adaptability`
    )
  }
  while (transferableStrengths.length < 2) {
    transferableStrengths.push(
      'You are engaging with the role early — that intent itself is worth showing'
    )
  }

  const riskFlags: string[] = []
  if (missing.length > 0) {
    riskFlags.push(
      `No evidence yet of ${missing.slice(0, 3).join(', ')} — be upfront and show adjacent experience instead of claiming it`
    )
  }
  if (input.candExp != null && input.candExp < input.expMin) {
    riskFlags.push(
      `This role asks for ${input.expMin}-${input.expMax} years and you have ${input.candExp} — counter it with density: what you shipped per year`
    )
  }
  if (input.candExp != null && input.candExp > input.expMax + 2) {
    riskFlags.push(
      `At ${input.candExp} years you are more senior than the ${input.expMin}-${input.expMax} band — prepare an honest answer on why this role still fits you`
    )
  }
  if (riskFlags.length === 0) {
    riskFlags.push('No obvious gaps on paper — the open question will be depth, not breadth')
  }

  const interviewPrep: InterviewPrepItem[] = input.jobSkills.slice(0, 3).map((skill) => ({
    question: `How have you used ${skill} in a real project, and what was the outcome?`,
    angle: `Prepare one concrete ${skill} story with a number in it — if you have not used ${skill}, say what you would learn first and map it to your closest experience.`,
  }))
  while (interviewPrep.length < 3) {
    interviewPrep.push({
      question: 'Why this role, and why now?',
      angle: 'Connect one genuine thing about your trajectory to what this team is building — specific, not flattery.',
    })
  }

  const readinessLine =
    readiness === 'READY_NOW'
      ? `Your profile covers most of what ${input.jobTitle} needs — you can apply with confidence today.`
      : readiness === 'READY_SOON'
        ? `You are a plausible fit for ${input.jobTitle} (${input.workMode.toLowerCase()}) — close one or two gaps first and then apply.`
        : `${input.jobTitle} is a stretch today — treat it as a target role and build the missing pieces deliberately.`

  return {
    fitSummary: `Keyword overlap with the listed skills is ${Math.round(ratio * 100)}%. ${
      overlap.length > 0
        ? `Your strengths here are ${overlap.slice(0, 3).join(', ')}.`
        : 'There is little direct skill overlap on paper.'
    } Use the angles below to frame your real work for this specific role.`,
    projectAngles: projectAngles.slice(0, 4),
    transferableStrengths: transferableStrengths.slice(0, 4),
    riskFlags: riskFlags.slice(0, 3),
    interviewPrep: interviewPrep.slice(0, 5),
    readiness,
    readinessLine,
    source: 'heuristic',
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

    // Auth: candidate-only. Recruiters/clients/admins never get this narrative
    // about a candidate's profile — it is the candidate's own coaching view.
    const caller = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!caller || caller.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Only the candidate can run this deep-dive' },
        { status: 403 }
      )
    }

    const candidate = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        skills: true,
        resumeText: true,
        headline: true,
        experienceYears: true,
        education: true,
        githubUrl: true,
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
        workMode: true,
        status: true,
      },
    })
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    if (job.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'This job is no longer active — pick another one' },
        { status: 404 }
      )
    }

    const jobSkills = splitSkills(job.skills)
    const candSkills = splitSkills(candidate.skills)
    const jd = ((job.jdText || job.description || '') as string).slice(0, JD_CLIP)
    const candExp = typeof candidate.experienceYears === 'number' ? candidate.experienceYears : null

    let payload: DeepDivePayload

    const system = [
      'You are an honest career coach on a hiring platform helping a candidate understand how their real projects and story map to ONE specific job BEFORE they apply.',
      'This is a NARRATIVE deep-dive, not a keyword score: focus on how to frame their actual experience for this role.',
      'Output STRICT JSON only — no markdown, no commentary — exactly this shape:',
      '{"fitSummary": "...", "projectAngles": [{"title": "...", "pitch": "..."}], "transferableStrengths": ["..."], "riskFlags": ["..."], "interviewPrep": [{"question": "...", "angle": "..."}], "readiness": "READY_NOW" | "READY_SOON" | "STRETCH", "readinessLine": "..."}',
      'Rules:',
      '- fitSummary: 2-3 honest sentences on how well the candidate\'s actual background maps to this role.',
      '- projectAngles: 2-4 items. Each reframes ONE of the candidate\'s real past projects or skills for THIS specific role. title is short (a label), pitch is 1-2 sentences of concrete framing advice. Ground every angle in what the candidate actually did — never invent projects.',
      '- transferableStrengths: 2-4 short strings — capabilities from their profile that transfer to this role even if the wording differs.',
      '- riskFlags: 0-3 honest strings describing REAL gaps or concerns (missing skills, experience-band mismatch, domain distance) phrased constructively, never harshly. Empty array only if there is genuinely nothing concerning.',
      '- interviewPrep: 3-5 items. question = a question this candidate will plausibly be asked in an interview for THIS job; angle = how THIS candidate, given their specific profile, should approach answering it.',
      '- readiness: "READY_NOW" (can apply with confidence today), "READY_SOON" (plausible fit, close 1-2 gaps first) or "STRETCH" (significant gap — target role). Be calibrated, not generous.',
      '- readinessLine: exactly one honest sentence summarising that verdict.',
      '- Never invent experience, employers, numbers or tools the candidate did not mention. Plain text, no emojis, no markdown.',
    ].join('\n')

    const user = [
      'JOB:',
      `Title: ${job.title}`,
      `Company: ${job.company}`,
      `Work mode: ${job.workMode || '(not stated)'}`,
      `Skills required: ${job.skills || '(none listed)'}`,
      `Experience range: ${job.experienceMin}-${job.experienceMax} years`,
      job.salaryMinLpa != null && job.salaryMaxLpa != null
        ? `Salary range: ${job.salaryMinLpa}-${job.salaryMaxLpa} LPA`
        : 'Salary range: (not disclosed)',
      `Job description: ${jd || '(not provided)'}`,
      '',
      'CANDIDATE:',
      `Headline: ${candidate.headline || '(none)'}`,
      `Total experience: ${candExp ?? '(not stated)'} years`,
      `Skills: ${candidate.skills || '(none listed)'}`,
      `Education: ${candidate.education || '(none listed)'}`,
      `GitHub: ${candidate.githubUrl || '(none provided)'}`,
      '',
      'RESUME TEXT (may be truncated):',
      resumeText || '(no resume text provided)',
      '',
      'Produce the JSON deep-dive now.',
    ].join('\n')

    try {
      const raw = await chatWithRetry(system, user, 2)
      const parsed = extractJson<Record<string, unknown>>(raw)

      const fitSummary =
        cleanStr(parsed.fitSummary, 700) ||
        `Here is an honest read of how your background maps to ${job.title} — use the angles below to frame your strongest work.`

      let projectAngles = cleanAngleList(parsed.projectAngles, 4, 120, 340)
      if (projectAngles.length < 2) {
        projectAngles = projectAngles.concat(
          [
            {
              title: 'Pick your single strongest project',
              pitch: 'Choose the project closest to this role and prepare a 60-second story: the context, what you personally built, and the measurable outcome.',
            },
            {
              title: `Connect your headline to ${job.title}`,
              pitch: 'Rewrite how you introduce yourself so the first sentence makes the link between what you have done and what this team needs.',
            },
          ].slice(0, 2 - projectAngles.length)
        )
      }

      let transferableStrengths = cleanList(parsed.transferableStrengths, 4, 220)
      if (transferableStrengths.length < 2) {
        transferableStrengths = transferableStrengths.concat(
          ['A complete profile with real project context to draw from'].slice(
            0,
            2 - transferableStrengths.length
          )
        )
      }

      const riskFlags = cleanList(parsed.riskFlags, 3, 240)

      let interviewPrep = cleanPrepList(parsed.interviewPrep, 5, 260, 340)
      if (interviewPrep.length < 3) {
        interviewPrep = interviewPrep.concat(
          [
            {
              question: 'Walk me through a project you are proud of.',
              angle: 'Pick the project closest to this role and keep it structured: context, your contribution, the outcome.',
            },
            {
              question: 'What is your biggest gap for this role?',
              angle: 'Name it honestly before they find it, then show the adjacent experience that shortens the learning curve.',
            },
            {
              question: 'Why this role?',
              angle: 'Tie one genuine thread of your trajectory to what this team is building — specific, not flattery.',
            },
          ].slice(0, 3 - interviewPrep.length)
        )
      }

      const readiness = readinessOf(parsed.readiness)
      const readinessLine =
        cleanStr(parsed.readinessLine, 320) ||
        'An honest self-assessment — use the gaps below as your to-do list before applying.'

      payload = {
        fitSummary,
        projectAngles,
        transferableStrengths,
        riskFlags,
        interviewPrep,
        readiness,
        readinessLine,
        source: 'ai',
        job: { id: job.id, title: job.title, company: job.company },
      }
    } catch (aiErr) {
      console.error('[ai/role-fit-deepdive] LLM failed, using heuristic fallback:', aiErr)
      const fb = buildHeuristic({
        jobTitle: job.title,
        jobSkills,
        candSkills,
        candExp,
        expMin: job.experienceMin,
        expMax: job.experienceMax,
        workMode: job.workMode || 'On-site',
        hasResume: resumeText.trim().length > 0,
      })
      payload = { ...fb, job: { id: job.id, title: job.title, company: job.company } }
    }

    return NextResponse.json({ data: payload })
  } catch (err) {
    console.error('POST /api/ai/role-fit-deepdive failed:', err)
    return NextResponse.json(
      { error: 'Could not run the deep-dive right now' },
      { status: 500 }
    )
  }
}
