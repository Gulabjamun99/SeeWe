// SeeWe - POST /api/ai/suggest-questions
// The recruiter stays in charge of the AI interview — this endpoint only
// SUGGESTS up to 10 questions drawn from the job description so the recruiter
// has a starting point. Suggestions are never saved automatically: the
// recruiter picks which ones to add (and can rewrite any of them).
//
// Body: { jobId } (loads title/skills/jdText from the job) OR
//       { title, skills, jdText } for a not-yet-saved job draft.
// Response: { data: { suggestions: [{ text, type, timeLimitSec, focusArea }] } }

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson } from '@/lib/ai-client'

export const dynamic = 'force-dynamic'

const MAX_SUGGESTIONS = 10

function clip(v: string | null | undefined, max: number): string {
  const s = (v ?? '').trim()
  return s.length <= max ? s : s.slice(0, max) + '…'
}

interface Suggestion {
  text: string
  type: 'VOICE' | 'TEXT'
  timeLimitSec: number
  focusArea: string
}

function normalizeSuggestions(raw: unknown): Suggestion[] {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as Record<string, unknown>)?.questions)
      ? ((raw as Record<string, unknown>).questions as unknown[])
      : []
  const out: Suggestion[] = []
  for (const item of list) {
    const obj = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
    const text =
      typeof obj.question === 'string' && obj.question.trim()
        ? obj.question.trim()
        : typeof obj.text === 'string' && obj.text.trim()
          ? obj.text.trim()
          : typeof item === 'string' && item.trim()
            ? item.trim()
            : ''
    if (!text) continue
    const type = obj.type === 'TEXT' ? 'TEXT' : 'VOICE'
    const t = typeof obj.timeLimitSec === 'number' && obj.timeLimitSec >= 30 ? Math.min(600, Math.round(obj.timeLimitSec)) : 120
    const focusArea =
      typeof obj.focusArea === 'string' && obj.focusArea.trim()
        ? obj.focusArea.trim().slice(0, 80)
        : 'Role fit'
    out.push({ text: text.slice(0, 600), type, timeLimitSec: t, focusArea })
    if (out.length >= MAX_SUGGESTIONS) break
  }
  return out
}

const FALLBACK: Suggestion[] = [
  { text: 'Please introduce yourself and walk me through your most relevant experience for this role.', type: 'VOICE', timeLimitSec: 120, focusArea: 'Introduction' },
  { text: 'Which project are you proudest of, and what exactly was YOUR contribution in it?', type: 'VOICE', timeLimitSec: 180, focusArea: 'Project depth' },
  { text: 'Describe the core skills this role needs — rate yourself honestly on each with one real example.', type: 'VOICE', timeLimitSec: 180, focusArea: 'Skill self-assessment' },
  { text: 'Tell me about the toughest problem you solved recently. What was the situation and the outcome?', type: 'VOICE', timeLimitSec: 180, focusArea: 'Problem solving' },
  { text: 'How do you prioritise when multiple deliverables land on the same day?', type: 'VOICE', timeLimitSec: 120, focusArea: 'Prioritisation' },
  { text: 'Which tools, frameworks or processes have you mastered that this role will use daily?', type: 'VOICE', timeLimitSec: 120, focusArea: 'Tooling' },
  { text: 'In your own words, summarise what you understand about this role and what makes you a strong fit.', type: 'TEXT', timeLimitSec: 240, focusArea: 'Role understanding' },
  { text: 'Describe a time you received critical feedback. What did you change afterwards?', type: 'VOICE', timeLimitSec: 150, focusArea: 'Coachability' },
  { text: 'Where do you want to be professionally two years from now?', type: 'TEXT', timeLimitSec: 180, focusArea: 'Career goals' },
  { text: 'Anything else about your background you would like the hiring team to know?', type: 'TEXT', timeLimitSec: 180, focusArea: 'Open floor' },
]

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))

    let title = ''
    let skills = ''
    let jdText = ''

    if (typeof body?.jobId === 'string' && body.jobId.trim()) {
      const job = await db.job.findUnique({ where: { id: body.jobId.trim() } })
      if (!job) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      }
      title = job.title
      skills = job.skills
      jdText = job.jdText || job.description
    } else {
      title = typeof body?.title === 'string' ? body.title.trim() : ''
      skills = typeof body?.skills === 'string' ? body.skills.trim() : ''
      jdText = typeof body?.jdText === 'string' ? body.jdText.trim() : ''
    }

    if (!title && !jdText) {
      return NextResponse.json(
        { error: 'Provide jobId, or a title + JD draft so the AI has context' },
        { status: 400 }
      )
    }

    const systemPrompt =
      'You are an interview designer helping a recruiter prepare questions for an AI-conducted screening interview. You always respond with valid JSON only — no markdown fences, no commentary.'

    const userPrompt = `Design interview questions now.

ROLE: ${clip(title, 120) || 'Unspecified role'}
KEY SKILLS: ${clip(skills, 300) || 'not listed'}
JOB DESCRIPTION:
${clip(jdText, 2200)}

TASK
Return a STRICT JSON array of EXACTLY 10 suggested screening questions a recruiter would want answered before calling this candidate. Mix:
- 2 short intro/motivation questions
- 5 role-specific skill/scenario questions grounded in the JD
- 2 behavioural/work-style questions
- 1 availability/logistics question (notice period, location or salary expectations)

Each element MUST be exactly:
{"question": "<concise spoken-style question in English>", "type": "VOICE" or "TEXT", "timeLimitSec": <30-600>, "focusArea": "<short label>"}

Rules:
- "VOICE" for questions best answered by speaking (stories, scenarios, walk-throughs); "TEXT" for short factual answers (notices, expectations, one-liners).
- timeLimitSec: realistic answer windows (90-240 for voice, 120-300 for text).
- English only, concise enough to be read aloud. Exactly 10 items. Respond with valid JSON only.`

    let suggestions: Suggestion[]
    // [build-batch-3] provenance flag — the configurator UI badges whether the
    // ten questions came from the live model or the offline fallback set.
    let source: 'ai' | 'fallback' = 'ai'
    try {
      const raw = await chatWithRetry(systemPrompt, userPrompt)
      suggestions = normalizeSuggestions(extractJson<unknown>(raw))
      if (suggestions.length === 0) throw new Error('empty suggestions')
    } catch (err) {
      console.error('[suggest-questions] AI failed, using fallback set:', err)
      suggestions = FALLBACK
      source = 'fallback'
    }

    return NextResponse.json({ data: { suggestions, source } })
  } catch (error) {
    console.error('[suggest-questions] Unexpected error:', error)
    return NextResponse.json({ error: 'Could not generate question suggestions' }, { status: 500 })
  }
}
