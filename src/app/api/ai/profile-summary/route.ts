// SeeWe - POST /api/ai/profile-summary
// AI-era profile helper: turns the candidate's basic details (name, headline,
// skills, experience, education, location) into a polished first-person
// profile summary they can drop into their resume narrative and edit freely.
// Never 500s for AI hiccups — falls back to a deterministic template and
// flags the source so the UI can set expectations honestly.

import { NextRequest, NextResponse } from 'next/server'
import { chatWithRetry } from '@/lib/ai-client'

export const dynamic = 'force-dynamic'

const MAX_FIELD = 400
const MAX_SUMMARY_CHARS = 900
const MIN_SUMMARY_CHARS = 40

interface SummaryInput {
  name?: string
  headline?: string
  skills?: string
  experienceYears?: string | number
  education?: string
  location?: string
}

function clean(value: string | undefined | null, cap = MAX_FIELD): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, cap)
}

function normalizeExperience(value: string | number | undefined): string {
  if (value == null || value === '') return ''
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(n) || n < 0) return ''
  return `${n} ${n === 1 ? 'year' : 'years'}`
}

/** Deterministic fallback so the button always produces something usable. */
function buildFallback(input: SummaryInput): string {
  const name = clean(input.name) || 'I am a professional'
  const headline = clean(input.headline)
  const skills = clean(input.skills)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const topSkills = skills.slice(0, 4)
  const exp = normalizeExperience(input.experienceYears)
  const education = clean(input.education)
  const location = clean(input.location)

  const open = headline
    ? `${name.split(' ')[0]} — ${headline}.`
    : `${name.split(' ')[0]} is a focused professional.`
  const skillSentence = topSkills.length
    ? `Core strengths span ${topSkills.join(', ')}${skills.length > topSkills.length ? ' and related tools' : ''}.`
    : ''
  const expSentence = exp ? `Bringing ${exp} of hands-on experience.` : ''
  const eduSentence = education ? `Academic background: ${education}.` : ''
  const locSentence = location ? `Based in ${location}, open to the right opportunity.` : ''

  return [open, skillSentence, expSentence, eduSentence, locSentence]
    .filter(Boolean)
    .join(' ')
    .slice(0, MAX_SUMMARY_CHARS)
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as SummaryInput | null
    if (!body) {
      return NextResponse.json({ error: 'Send profile details as JSON' }, { status: 400 })
    }

    const input: SummaryInput = {
      name: clean(body.name, 80),
      headline: clean(body.headline),
      skills: clean(body.skills),
      experienceYears: body.experienceYears,
      education: clean(body.education),
      location: clean(body.location),
    }

    if (!input.name && !input.skills && !input.headline) {
      return NextResponse.json(
        { error: 'Add at least your name, headline or skills first — I need something to work with' },
        { status: 400 }
      )
    }

    const system = [
      'You are an expert career coach writing profile summaries for candidates on a hiring platform.',
      'Write ONE short paragraph in the candidate\'s own voice (first person, no name repetition).',
      'Rules: 3-4 sentences, max 90 words, plain text only — no markdown, no emojis, no quotes around the text, no placeholders like [company].',
      'Include the headline, top skills, years of experience, education and location only when provided.',
      'Never invent employers, job titles, certifications, numbers or claims that are not in the input.',
      'Keep the tone confident, specific and factual — suitable for recruiters scanning quickly.',
    ].join(' ')

    const user = [
      'Candidate details:',
      `Name: ${input.name || '(not given)'}`,
      `Headline: ${input.headline || '(not given)'}`,
      `Skills: ${input.skills || '(not given)'}`,
      `Experience: ${normalizeExperience(input.experienceYears) || '(not given)'}`,
      `Education: ${input.education || '(not given)'}`,
      `Location: ${input.location || '(not given)'}`,
      '',
      'Write the profile summary now.',
    ].join('\n')

    try {
      const raw = await chatWithRetry(system, user)
      const summary = raw
        .replace(/^["'\u201c\u201c]+|["'\u201d\u201d]+$/g, '')
        .replace(/\s*\n+\s*/g, ' ')
        .trim()
        .slice(0, MAX_SUMMARY_CHARS)

      if (summary.length >= MIN_SUMMARY_CHARS) {
        return NextResponse.json({ data: { summary, source: 'ai' } })
      }
      throw new Error('AI summary too short')
    } catch (aiErr) {
      console.error('[ai/profile-summary] falling back to template:', aiErr)
      return NextResponse.json({ data: { summary: buildFallback(input), source: 'fallback' } })
    }
  } catch (err) {
    console.error('[ai/profile-summary] failed:', err)
    return NextResponse.json({ error: 'Could not generate a summary right now' }, { status: 500 })
  }
}
