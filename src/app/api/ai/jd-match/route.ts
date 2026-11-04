// SeeWe - POST /api/ai/jd-match
// AI Resume Builder: scores a resume against a pasted job description.
// Candidate-side feature — contains no recruiter evaluation data.
//
// POST { resumeText, jdText }
//   -> { data: { matchScore, matched, missing, suggestions, source } }
//      matchScore 0-100; matched/missing = keyword hits/gaps; suggestions =
//      concrete resume tweaks. `source` tells the UI whether the AI or the
//      deterministic fallback produced the result.
// NEVER dead-ends: when the LLM fails, a deterministic keyword-overlap scorer
// (tokenize → stopwords → weighted overlap) produces the same shape.

import { NextResponse } from 'next/server'
import { chatWithRetry, extractJson } from '@/lib/ai-client'
import type { JdMatchResult } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MAX_RESUME_CHARS = 6000
const MAX_JD_CHARS = 4000

function clip(v: string | null | undefined, max: number): string {
  const s = (v ?? '').trim()
  return s.length <= max ? s : s.slice(0, max) + '…'
}

/* ---------------- deterministic fallback scorer ---------------- */

const STOPWORDS = new Set(
  `a an and are as at be by for from has have how in is it its of on or that the to was were will with you your our we they their this these those what when where which who whom why
  about above after again against all am any because been before being below between both but can did do does doing down during each few more most other out over own same some such than too very
  able across along also among around become becomes best better bring build built come company etc every get give given go going help high into join keep key like look looking made make may must need needs new
  often one role roles should strong team teams well work working would years experience job jobs required requirements responsibility responsibilities preferred plus etc using use used`
    .split(/\s+/)
    .filter(Boolean)
)

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#./ ]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\.+|\.+$/g, ''))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t))
}

/** Deterministic keyword-overlap scoring between resume and JD. */
export function keywordOverlapMatch(resumeText: string, jdText: string): JdMatchResult {
  const resumeTokens = new Set(tokenize(resumeText))
  const jdCounts = new Map<string, number>()
  for (const token of tokenize(jdText)) {
    jdCounts.set(token, (jdCounts.get(token) ?? 0) + 1)
  }

  // Distinctive JD keywords = terms the JD uses, ranked by frequency
  const jdKeywords = [...jdCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([term]) => term)

  const matched = jdKeywords.filter((k) => resumeTokens.has(k))
  const missing = jdKeywords.filter((k) => !resumeTokens.has(k))

  const coverage = jdKeywords.length > 0 ? matched.length / jdKeywords.length : 0
  // Coverage dominates (70%), frequency-weighted presence of matched terms adds up to 30%
  const freqBoost =
    jdKeywords.length > 0
      ? Math.min(
          1,
          matched.reduce((sum, k) => sum + (jdCounts.get(k) ?? 1), 0) /
            (jdKeywords.reduce((sum, k) => sum + (jdCounts.get(k) ?? 1), 0) * 0.6)
        )
      : 0
  const matchScore = Math.round(Math.min(100, coverage * 70 + freqBoost * 30))

  return {
    matchScore,
    matched: matched.slice(0, 12),
    missing: missing.slice(0, 12),
    suggestions: [
      missing.length > 0
        ? `Weave these JD keywords into your bullets where honest: ${missing.slice(0, 5).join(', ')}.`
        : 'Your resume covers the core JD vocabulary — tighten the wording around your strongest wins.',
      'Quantify two more bullets with outcomes (%, time saved, scale).',
      'Mirror the exact job title in your headline when it genuinely matches your experience.',
    ],
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const resumeText = clip(typeof body?.resumeText === 'string' ? body.resumeText : '', MAX_RESUME_CHARS)
    const jdText = clip(typeof body?.jdText === 'string' ? body.jdText : '', MAX_JD_CHARS)

    if (!resumeText.trim() || !jdText.trim()) {
      return NextResponse.json(
        { error: 'resumeText and jdText are both required' },
        { status: 400 }
      )
    }

    try {
      const systemPrompt =
        'You are a technical recruiter scoring how well a resume matches a job description. You always respond with valid JSON only — no markdown fences, no commentary.'

      const userPrompt = `Score this resume against the job description.

JOB DESCRIPTION:
${jdText}

RESUME:
${resumeText}

Return STRICT JSON exactly shaped like:
{
  "matchScore": <0-100>,
  "matched": ["<JD keyword/skill clearly evidenced in the resume>", "..."],
  "missing": ["<JD keyword/skill NOT evidenced in the resume>", "..."],
  "suggestions": ["<concrete resume tweak to close a gap>", "..."]
}

Rules:
- matchScore reflects skills/tools/domain coverage and seniority fit — not prose quality.
- matched/missing: short single keywords or tool names only (max 10 each).
- suggestions: max 4, each specific and honest — never advise inventing experience.
- English only. Respond with valid JSON only, no markdown fences, no commentary.`

      const raw = await chatWithRetry(systemPrompt, userPrompt)
      const parsed = extractJson<Record<string, unknown>>(raw)
      const scoreNum = Number(parsed?.matchScore)
      const matchScore = Number.isFinite(scoreNum)
        ? Math.min(100, Math.max(0, Math.round(scoreNum)))
        : keywordOverlapMatch(resumeText, jdText).matchScore
      const asList = (v: unknown, max: number): string[] =>
        Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean).slice(0, max) : []

      const result: JdMatchResult = {
        matchScore,
        matched: asList(parsed?.matched, 12),
        missing: asList(parsed?.missing, 12),
        suggestions: asList(parsed?.suggestions, 6),
        source: 'ai',
      }
      // Guard: AI returning empty structure → deterministic result keeps it useful
      if (result.matched.length === 0 && result.missing.length === 0) {
        const fallback = keywordOverlapMatch(resumeText, jdText)
        return NextResponse.json({ data: fallback })
      }
      return NextResponse.json({ data: result })
    } catch (err) {
      console.error('[ai/jd-match] LLM match failed, deterministic fallback:', err)
      return NextResponse.json({
        data: { ...keywordOverlapMatch(resumeText, jdText), source: 'fallback' },
      })
    }
  } catch (error) {
    console.error('[ai/jd-match] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to match resume against JD' }, { status: 500 })
  }
}
