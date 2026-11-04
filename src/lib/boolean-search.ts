/**
 * boolean-search — simple boolean keyword parser for talent search (master
 * spec §9 "Boolean and advanced search").
 *
 * Grammar (case-insensitive operators, whitespace-separated, double quotes
 * group a phrase into ONE term):
 *   react AND node        → both must appear
 *   react OR python       → either may appear
 *   react NOT fresher     → react must appear, fresher must NOT
 *   "senior developer" AND node → phrase as a single term
 *
 *parseBooleanQuery returns:
 *   { must: string[], should: string[], not: string[] } — lower-cased terms, or
 *   null — the query has NO boolean operators (plain text) so callers keep
 *   their legacy substring behaviour.
 *
 * Semantics for the matcher:
 *   • must:   every term must appear in at least one searched field
 *   • should: when non-empty, AT LEAST ONE term must appear (OR across terms
 *             and across fields) — this is what a leading bare term lands in,
 *             so `react NOT fresher` still requires react
 *   • not:    no term may appear anywhere
 */

export interface BooleanQuery {
  must: string[]
  should: string[]
  not: string[]
}

const OPERATORS = new Set(['AND', 'OR', 'NOT'])
const MAX_TOKENS = 24
const MAX_TERM_LEN = 60

/** Tokenize respecting double-quoted phrases: `"senior dev" AND react` →
 * ['senior dev', 'AND', 'react']. Unbalanced quotes degrade gracefully (the
 * rest of the string becomes one term). */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < input.length && tokens.length <= MAX_TOKENS) {
    // skip whitespace
    while (i < input.length && /\s/.test(input[i])) i++
    if (i >= input.length) break
    if (input[i] === '"') {
      const close = input.indexOf('"', i + 1)
      if (close === -1) {
        // unbalanced quote → treat the remainder as one phrase term
        tokens.push(input.slice(i + 1))
        break
      }
      tokens.push(input.slice(i + 1, close))
      i = close + 1
    } else {
      let j = i
      while (j < input.length && !/\s/.test(input[j])) j++
      tokens.push(input.slice(i, j))
      i = j
    }
  }
  return tokens.slice(0, MAX_TOKENS + 1)
}

function cleanTerm(raw: string): string {
  return raw.trim().toLowerCase().slice(0, MAX_TERM_LEN)
}

/**
 * Parse a boolean keyword string. Returns null when the query contains no
 * boolean operators (caller keeps legacy substring behaviour), when it is
 * malformed (dangling operator, operator-only, no usable terms), or when it
 * is empty.
 */
export function parseBooleanQuery(q: string): BooleanQuery | null {
  if (typeof q !== 'string') return null
  const trimmed = q.trim()
  if (!trimmed || trimmed.length > 400) return null

  const tokens = tokenize(trimmed)
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) return null

  // No operators at all → not boolean; keep legacy substring behaviour.
  const hasOperator = tokens.some((t) => OPERATORS.has(t.toUpperCase()))
  if (!hasOperator) return null

  const must: string[] = []
  const should: string[] = []
  const not: string[] = []

  // 'bare' (leading terms before any operator) → should (OR across fields);
  // terms after AND/OR/NOT land in their respective buckets.
  let mode: 'BARE' | 'MUST' | 'SHOULD' | 'NOT' = 'BARE'
  let sawTerm = false

  for (const token of tokens) {
    const upper = token.toUpperCase()
    if (OPERATORS.has(upper)) {
      // An operator directly after another operator (or leading) is malformed.
      if (!sawTerm && mode !== 'BARE') return null
      mode = upper === 'AND' ? 'MUST' : upper === 'OR' ? 'SHOULD' : 'NOT'
      // after an operator we expect a term next; reset so a dangling operator
      // at the end can be detected
      sawTerm = false
      continue
    }
    const term = cleanTerm(token)
    if (!term) continue // e.g. empty quoted phrase — ignore silently
    if (mode === 'MUST') must.push(term)
    else if (mode === 'SHOULD' || mode === 'BARE') should.push(term)
    else not.push(term)
    sawTerm = true
  }

  // Dangling operator ("react AND") → malformed → legacy behaviour.
  if (!sawTerm) return null
  // Nothing usable to match (e.g. only NOT terms is actually usable — a pure
  // exclusion query — so allow must/should/not any non-empty combination).
  if (must.length === 0 && should.length === 0 && not.length === 0) return null
  // A pure NOT query ("NOT intern") has nothing positive to anchor on — treat
  // as legacy rather than "match everyone without intern".
  if (must.length === 0 && should.length === 0) return null

  return { must, should, not }
}

/**
 * Does one candidate match a parsed boolean query?
 * `fieldsOf` returns the lower-cased searchable fields for the record
 * (headline, skills, name, resume text, location — same field set as the
 * legacy substring search). Matching is substring-based and
 * case-insensitive, consistent with the legacy keyword path.
 */
export function matchesBooleanQuery(
  query: BooleanQuery,
  fields: string[]
): boolean {
  const haystack = fields.filter(Boolean)
  const contains = (term: string): boolean =>
    haystack.some((f) => f.includes(term))

  for (const term of query.must) {
    if (!contains(term)) return false
  }
  if (query.should.length > 0 && !query.should.some(contains)) return false
  for (const term of query.not) {
    if (contains(term)) return false
  }
  return true
}
