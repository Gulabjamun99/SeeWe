// SeeWe — spoken-answer → structured profile parsing
// Used by /api/interview/answer (auto-feed) and /api/interview/report
// (candidateDetails block). Best-effort parsing of natural speech captured by
// ASR; a failed parse simply returns null and never corrupts data.

/** "I live in Pune" → "Pune" (best-effort; null when nothing usable) */
export function parseSpokenLocation(text: string): string | null {
  let t = (text ?? '').trim().replace(/\s+/g, ' ')
  if (!t) return null
  t = (t.split(/(?:,|\.|;|—)/)[0] ?? t).trim()
  t = t.replace(/^(well|so|okay|ok|um+|uh+|yeah|actually|basically)\b[\s,-]*/i, '')
  t = t.replace(/\b(i|im|i'm|my|we|its|it's|am|are|is|currently|presently|right now|these days|living|live|lives|staying|stay|residing|reside|based|from|in|at|near|city|area)\b/gi, ' ')
  t = t.replace(/\b(and|but|also|however|would|open to|relocat\w*|yes|no|not a? problem|flexible)\b.*$/i, ' ')
  t = t.replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim()
  if (t.replace(/[^a-zA-Z]/g, '').length < 3) return null
  const city = t
    .split(' ')
    .slice(0, 4)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
  return city.slice(0, 60)
}

/** "8 years" → 8 · "18 months" → 1.5 · "fresher" → 0 */
export function parseSpokenExperienceYears(text: string): number | null {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return null
  if (/\b(fresher|no experience|zero experience|just started|just graduated|first job|entry level)\b/.test(t)) return 0
  const years = t.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)/)
  if (years) return Math.max(0, Math.min(60, parseFloat(years[1])))
  const months = t.match(/(\d{1,2})\s*months?/)
  if (months) return Math.max(0, Math.round((parseInt(months[1], 10) / 12) * 10) / 10)
  return null
}

/** "serving 60 days" → 60 · "two months" → 60 · "immediate" → 0 */
export function parseSpokenNoticeDays(text: string): number | null {
  const t = (text ?? '').toLowerCase()
  if (!t.trim()) return null
  if (/\b(immediate|immediately|no notice|right away|today|tomorrow)\b/.test(t)) return 0
  const days = t.match(/(\d{1,3})\s*days?/)
  if (days) return Math.max(0, Math.min(365, parseInt(days[1], 10)))
  const months = t.match(/(\d{1,2})\s*months?/)
  if (months) return Math.max(0, Math.min(365, parseInt(months[1], 10) * 30))
  const words: Array<[RegExp, number]> = [
    [/\bfifteen\b/, 15], [/\bthirty\b/, 30], [/\bone\s*month\b/, 30], [/\bsixty\b/, 60],
    [/\btwo\s*months?\b/, 60], [/\bninety\b/, 90], [/\bthree\s*months?\b/, 90],
  ]
  for (const [re, d] of words) if (re.test(t)) return d
  if (/\bserving notice\b/.test(t)) return 30
  return null
}

/** "currently 6, expecting 10 LPA" → { current: 6, expected: 10 } */
export function parseSpokenCtc(text: string): { current: number | null; expected: number | null } {
  const t = (text ?? '').toLowerCase().replace(/,/g, ' ')
  if (!t.trim()) return { current: null, expected: null }
  const tokens: Array<{ v: number; idx: number }> = []
  // 1) LPA/lakh-qualified numbers take priority
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?|per annum|p\.a\b)/g)) {
    const v = parseFloat(m[1])
    if (Number.isFinite(v) && v >= 0.5 && v <= 500) tokens.push({ v, idx: m.index ?? 0 })
  }
  // 2) Bare numbers fill the gaps (deduped against LPA matches)
  if (tokens.length < 2) {
    for (const m of t.matchAll(/\b(\d{1,3}(?:\.\d)?)\b/g)) {
      const idx = m.index ?? 0
      if (tokens.some((tk) => Math.abs(tk.idx - idx) < 3)) continue
      const v = parseFloat(m[1])
      if (Number.isFinite(v) && v >= 0.5 && v <= 100) tokens.push({ v, idx })
    }
  }
  if (tokens.length === 0) return { current: null, expected: null }
  tokens.sort((a, b) => a.idx - b.idx)
  if (tokens.length === 1) {
    const before = t.slice(0, tokens[0].idx)
    return /expect/.test(before) ? { current: null, expected: tokens[0].v } : { current: tokens[0].v, expected: null }
  }
  return { current: tokens[0].v, expected: tokens[tokens.length - 1].v }
}

/**
 * Parse ALL four profile facts from their per-question transcripts.
 * `pairs` = [{focusArea, transcript}] for every answered preliminary question.
 */
export function buildCandidateDetails(
  pairs: Array<{ focusArea: string; transcript: string }>
): {
  location?: string | null
  experienceYears?: number | null
  noticePeriodDays?: number | null
  currentSalaryLpa?: number | null
  expectedSalaryLpa?: number | null
} {
  const details: {
    location?: string | null
    experienceYears?: number | null
    noticePeriodDays?: number | null
    currentSalaryLpa?: number | null
    expectedSalaryLpa?: number | null
  } = {}
  for (const { focusArea, transcript } of pairs) {
    const text = (transcript ?? '').trim()
    if (!text) continue
    if (/location/i.test(focusArea)) {
      const loc = parseSpokenLocation(text)
      if (loc) details.location = loc
    }
    if (/experience/i.test(focusArea)) {
      const yrs = parseSpokenExperienceYears(text)
      if (yrs != null) details.experienceYears = yrs
    }
    if (/notice/i.test(focusArea)) {
      const days = parseSpokenNoticeDays(text)
      if (days != null) details.noticePeriodDays = days
    }
    if (/ctc|salary/i.test(focusArea)) {
      const ctc = parseSpokenCtc(text)
      if (ctc.current != null) details.currentSalaryLpa = Math.round(ctc.current * 10) / 10
      if (ctc.expected != null) details.expectedSalaryLpa = Math.round(ctc.expected * 10) / 10
    }
  }
  return details
}
