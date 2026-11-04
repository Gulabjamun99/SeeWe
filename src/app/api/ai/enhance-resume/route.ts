// SeeWe - POST /api/ai/enhance-resume
// AI Resume Builder: rewrites raw experience bullets into high-impact,
// metric-driven, action-verb statements. Candidate-side feature — contains
// no evaluation data and never touches recruiter surfaces.
//
// POST { bullets: string[], context?: string }
//   -> { data: { bullets: string[] } } — SAME count and order as the input.
// Graceful fallback: when the LLM fails, the ORIGINAL bullets are returned
// with a `note` so the UI never dead-ends.

import { NextResponse } from 'next/server'
import { chatWithRetry, extractJson } from '@/lib/ai-client'

export const dynamic = 'force-dynamic'

const MAX_BULLETS = 30
const MAX_BULLET_CHARS = 400
const MAX_CONTEXT_CHARS = 1200

function clip(v: string | null | undefined, max: number): string {
  const s = (v ?? '').trim()
  return s.length <= max ? s : s.slice(0, max)
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))

    const rawBullets = Array.isArray(body?.bullets) ? body.bullets : []
    const bullets = rawBullets
      .map((b: unknown) => (typeof b === 'string' ? b.trim().slice(0, MAX_BULLET_CHARS) : ''))
      .slice(0, MAX_BULLETS)

    if (bullets.length === 0 || bullets.every((b: string) => !b)) {
      return NextResponse.json(
        { error: 'bullets must be a non-empty array of strings' },
        { status: 400 }
      )
    }

    const context = clip(typeof body?.context === 'string' ? body.context : '', MAX_CONTEXT_CHARS)

    const systemPrompt =
      'You are an expert resume writer. You turn plain duty statements into sharp, high-impact resume bullets. You always respond with valid JSON only — no markdown fences, no commentary.'

    const userPrompt = `Rewrite these resume bullets now.

${context ? `CONTEXT (role/company the bullets belong to):\n${context}\n` : ''}
BULLETS (keep the exact order):
${bullets.map((b: string, i: number) => `${i}. ${b || '(empty)'}`).join('\n')}

RULES for every rewritten bullet:
- Start with a strong past/present action verb (Led, Built, Automated, Reduced, ...).
- Include a metric ONLY when the original bullet already states one — NEVER invent numbers, users, percentages or currency amounts that were not in the original.
- When no metric exists, add crisp specificity about the scope/tech instead (e.g. "across the checkout flow", "for the mobile design system").
- Max 2 lines (~28 words) each, no pronouns, no fluff, English only.
- Preserve the meaning — never fabricate employers, titles or numbers.

Return STRICT JSON exactly shaped like:
{"bullets": ["<rewritten bullet 0>", "<rewritten bullet 1>", ...]}

EXACTLY ${bullets.length} bullets, same order. Respond with valid JSON only, no markdown fences, no commentary.`

    let out: string[] = bullets
    let note: string | undefined

    try {
      const raw = await chatWithRetry(systemPrompt, userPrompt)
      const parsed = extractJson<{ bullets?: unknown }>(raw)
      const enhanced = Array.isArray(parsed?.bullets) ? parsed.bullets : []

      const cleaned = bullets.map((original: string, i: number) => {
        const candidate = typeof enhanced[i] === 'string' ? enhanced[i].trim() : ''
        // Fallback per-slot: a missing/garbled slot returns the original bullet
        return candidate && candidate.length <= MAX_BULLET_CHARS * 2 ? candidate : original
      })
      out = cleaned
    } catch (err) {
      console.error('[ai/enhance-resume] LLM enhancement failed, returning originals:', err)
      note = 'AI enhancement is unavailable right now — your original bullets were kept.'
    }

    return NextResponse.json({ data: { bullets: out, ...(note ? { note } : {}) } })
  } catch (error) {
    console.error('[ai/enhance-resume] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to enhance resume bullets' }, { status: 500 })
  }
}
