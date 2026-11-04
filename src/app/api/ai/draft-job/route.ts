// SeeWe - POST /api/ai/draft-job
// The recruiter types a few POINTERS of what they want in the posting; this
// endpoint turns them into a suggested Description + Full JD. Nothing is
// written anywhere — the suggestion only becomes job copy after the recruiter
// APPROVES it in the form, and they can request targeted changes before that
// (feedback loop). AI is advisory; the recruiter's word is final.
//
// Body: { pointers, title?, skills?, currentDescription?, currentJd?, feedback? }
// Response: { data: { description, jdText, source: 'ai' | 'fallback' } }

import { NextResponse } from 'next/server'
import { chatWithRetry, extractJson } from '@/lib/ai-client'

export const dynamic = 'force-dynamic'

function clip(v: string | null | undefined, max: number): string {
  const s = (v ?? '').trim()
  return s.length <= max ? s : s.slice(0, max) + '…'
}

interface JobDraft {
  description: string
  jdText: string
}

function normalizeDraft(raw: unknown): JobDraft {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const description = typeof obj.description === 'string' ? obj.description.trim() : ''
  const jdText = typeof obj.jdText === 'string' ? obj.jdText.trim() : ''
  if (description.length < 30 || jdText.length < 80) throw new Error('draft too short to be useful')
  return { description: clip(description, 1200), jdText: clip(jdText, 6000) }
}

/** Offline template when the model is unavailable — honest 'fallback' badge in the UI. */
function fallbackDraft(pointers: string, title: string, skills: string): JobDraft {
  const lines = pointers
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const bullets = lines.map((p) => `- ${p}`).join('\n')
  const role = title || 'This role'
  const skillLine = skills ? `Core skills: ${skills}.` : ''
  return {
    description: `${role} — we are hiring a hands-on owner for this seat.\n\nWhat the hiring manager is looking for:\n${bullets}\n\n${skillLine} You will work with a focused team that ships fast, communicates clearly and values ownership over titles.`,
    jdText: `About the role\n${role} sits at the heart of the team. These pointers come straight from the hiring manager:\n${bullets}\n\nResponsibilities\n- Own day-to-day execution end to end — from planning to shipping.\n- Collaborate with cross-functional partners (product, design, data).\n- Raise blockers early and keep stakeholders updated.\n\nRequirements\n- ${skillLine || 'Relevant skills for the role, with proof of real work.'}\n- Strong ownership and clear written + spoken communication.\n- Experience that matches the pointers above.\n\nNice to have\n- Startup or high-ownership environment experience.\n\nCompensation & logistics\n- Pay band and the interview process are shared upfront in this posting.`,
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const pointers = typeof body?.pointers === 'string' ? body.pointers.trim() : ''
    if (pointers.length < 3) {
      return NextResponse.json(
        { error: 'Add a few pointers first — the AI drafts from those' },
        { status: 400 }
      )
    }
    const title = typeof body?.title === 'string' ? body.title.trim() : ''
    const skills = typeof body?.skills === 'string' ? body.skills.trim() : ''
    const currentDescription =
      typeof body?.currentDescription === 'string' ? body.currentDescription.trim() : ''
    const currentJd = typeof body?.currentJd === 'string' ? body.currentJd.trim() : ''
    const feedback = typeof body?.feedback === 'string' ? body.feedback.trim() : ''

    const systemPrompt =
      'You are an expert recruiter and job-post copywriter for the Indian hiring market. You write clear, honest, candidate-friendly copy in English. You always respond with valid JSON only — no markdown fences, no commentary.'

    const userPrompt = `Draft job-posting copy now.

RECRUITER POINTERS (every one must be reflected):
${clip(pointers, 800)}

CONTEXT
Role title: ${clip(title, 120) || 'not set yet'}
Skills: ${clip(skills, 300) || 'not listed'}
Existing description draft: ${clip(currentDescription, 900) || '(empty)'}
Existing full JD draft: ${clip(currentJd, 2200) || '(empty)'}
${
  feedback
    ? `RECRUITER CHANGE REQUEST (apply strictly, keep everything else intact):\n${clip(feedback, 600)}`
    : ''
}

TASK
Return STRICT JSON exactly: {"description": "...", "jdText": "..."}

- "description": 3-6 short plain-text lines — what this person owns, team & stack flavour, work mode, growth. No headings, no bullets.
- "jdText": a complete structured JD in plain text with these section labels each on their own line: "About the role", "Responsibilities", "Requirements", "Nice to have", "Compensation & logistics" — hyphen "-" bullets under each. Under 350 words total.
- Every recruiter pointer must appear naturally; do NOT invent conflicting facts (no invented salary numbers, no invented company claims).
- India-friendly wording. No markdown #/##, no HTML. Valid JSON only.`

    let draft: JobDraft
    // Provenance flag — the UI badges whether the copy came from the live
    // model or the offline template, so the recruiter always knows.
    let source: 'ai' | 'fallback' = 'ai'
    try {
      const raw = await chatWithRetry(systemPrompt, userPrompt)
      draft = normalizeDraft(extractJson<unknown>(raw))
    } catch (err) {
      console.error('[draft-job] AI failed, using offline template:', err)
      draft = fallbackDraft(pointers, title, skills)
      source = 'fallback'
    }

    return NextResponse.json({ data: { ...draft, source } })
  } catch (error) {
    console.error('[draft-job] Unexpected error:', error)
    return NextResponse.json({ error: 'Could not draft the job copy' }, { status: 500 })
  }
}
