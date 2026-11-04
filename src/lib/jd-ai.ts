/**
 * jd-ai — shared AI-assisted JD parsing used by /api/sourcing/match (one
 * candidate) and /api/talent/jd-search (whole-database search).
 *
 * The AI output is untrusted: everything is sanitised to strict shapes, and
 * on ANY failure the caller falls back to the deterministic keyword parser.
 */
import { chatWithRetry, extractJson } from '@/lib/ai-client'
import { normaliseJdSkills } from '@/lib/jd-parser'
import type { JdParse } from '@/lib/jd-parser'

/** AI parse of a pasted JD → strict JSON; returns null on any failure. */
export async function aiParseJd(jdText: string): Promise<Partial<JdParse> | null> {
  try {
    const sys =
      'You are a precise recruitment JD parser. Extract structured fields from the job description. Return ONLY strict JSON, no prose, no markdown: ' +
      '{"roleTitle": string (the exact job title, max 80 chars), "minYears": number|null, "maxYears": number|null, ' +
      '"mustHaveSkills": string[] (max 10, exact skill names as written), "goodToHaveSkills": string[] (max 8), ' +
      '"responsibilities": string[] (max 8, each <=200 chars, verbatim-ish from the JD), "location": string ("" if absent)}. ' +
      'Never invent skills or requirements that are not in the text.'
    const raw = await chatWithRetry(sys, jdText.slice(0, 6000), 1)
    const parsed = extractJson<Partial<JdParse>>(raw)
    if (!parsed || typeof parsed !== 'object') return null
    // hard sanitise — AI output is untrusted; skill phrases are normalised to
    // matchable terms ("performance management cycles" → "performance management")
    const clean: JdParse = {
      roleTitle: typeof parsed.roleTitle === 'string' ? parsed.roleTitle.slice(0, 80) : '',
      minYears: typeof parsed.minYears === 'number' && parsed.minYears >= 0 && parsed.minYears <= 40 ? Math.round(parsed.minYears) : null,
      maxYears: typeof parsed.maxYears === 'number' && parsed.maxYears >= 0 && parsed.maxYears <= 40 ? Math.round(parsed.maxYears) : null,
      mustHaveSkills: normaliseJdSkills(Array.isArray(parsed.mustHaveSkills) ? parsed.mustHaveSkills.filter((s) => typeof s === 'string' && s.trim()).slice(0, 12).map((s) => s.trim().slice(0, 60)) : []),
      goodToHaveSkills: normaliseJdSkills(Array.isArray(parsed.goodToHaveSkills) ? parsed.goodToHaveSkills.filter((s) => typeof s === 'string' && s.trim()).slice(0, 8).map((s) => s.trim().slice(0, 60)) : [], 8),
      responsibilities: Array.isArray(parsed.responsibilities) ? parsed.responsibilities.filter((s) => typeof s === 'string' && s.trim().length > 10).slice(0, 8).map((s) => s.trim().slice(0, 200)) : [],
      location: typeof parsed.location === 'string' ? parsed.location.slice(0, 60) : '',
    }
    // a parse without any signal is useless → treat as failure
    const signal = clean.mustHaveSkills.length + clean.responsibilities.length + (clean.roleTitle ? 1 : 0)
    return signal > 0 ? clean : null
  } catch {
    return null
  }
}
