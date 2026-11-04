/**
 * talent-search-engine — the search engine behind SeeWe's advanced Talent Search.
 *
 * Two layers:
 *   1. BOOLEAN QUERY LANGUAGE — real parser (not the legacy flat matcher):
 *        ("Maintenance Manager" OR "Plant Maintenance Head")
 *        AND (Extrusion OR Polymer OR "Plastic Pipes")
 *        AND (TPM OR OEE)
 *        NOT (Trainee OR Intern)
 *      • AND / OR / NOT operators (case-insensitive)
 *      • parentheses for grouping (nested to any sane depth)
 *      • double-quoted exact phrases
 *      • implicit AND between adjacent terms (search-engine convention)
 *      • STRICT validation → syntax errors with position, never silently
 *        degraded ("Do not silently ignore unsupported query operators").
 *   2. STRUCTURED CRITERIA matching helpers — token-exact skill matching
 *      (so "Java" never hits "JavaScript"), designation synonyms, employer
 *      substring matching, freshness windows.
 *
 * Everything here is pure & synchronous → unit-testable with bun.
 */

/* ============================ boolean language ============================ */

export interface BooleanSyntaxError {
  message: string
  position: number // 1-based character position in the query string
}

type Ast =
  | { kind: 'TERM'; term: string; phrase: boolean }
  | { kind: 'NOT'; child: Ast }
  | { kind: 'AND'; children: Ast[] }
  | { kind: 'OR'; children: Ast[] }

const OPERATORS = new Set(['AND', 'OR', 'NOT'])
const MAX_QUERY_LEN = 400
const MAX_TERMS = 40
const MAX_TERM_LEN = 60
const MAX_DEPTH = 8

interface Token {
  type: 'OP' | 'LPAREN' | 'RPAREN' | 'TERM'
  value: string // upper-cased operator for OP, raw text for TERM
  pos: number // 0-based index into the query
}

/** Tokenize: parens, quoted phrases, bare words. Unbalanced quotes produce a
 *  clean error rather than silently swallowing the rest of the query. */
function tokenize(q: string): { tokens: Token[]; error?: BooleanSyntaxError } {
  const tokens: Token[] = []
  let i = 0
  let terms = 0
  while (i < q.length) {
    if (/\s/.test(q[i])) {
      i++
      continue
    }
    if (q[i] === '(') {
      tokens.push({ type: 'LPAREN', value: '(', pos: i })
      i++
      continue
    }
    if (q[i] === ')') {
      tokens.push({ type: 'RPAREN', value: ')', pos: i })
      i++
      continue
    }
    if (q[i] === '"') {
      const close = q.indexOf('"', i + 1)
      if (close === -1) {
        return {
          tokens,
          error: { message: 'Unclosed double quote — close the phrase with a " character.', position: i + 1 },
        }
      }
      const phrase = q.slice(i + 1, close).trim()
      if (!phrase) {
        return { tokens, error: { message: 'Empty quoted phrase ("") — write the exact text to match.', position: i + 1 } }
      }
      if (phrase.length > MAX_TERM_LEN) {
        return {
          tokens,
          error: { message: `Phrase is longer than ${MAX_TERM_LEN} characters — shorten it.`, position: i + 1 },
        }
      }
      tokens.push({ type: 'TERM', value: phrase, pos: i })
      terms++
      i = close + 1
      continue
    }
    let j = i
    while (j < q.length && !/[\s()"]/.test(q[j])) j++
    const word = q.slice(i, j)
    const upper = word.toUpperCase()
    if (OPERATORS.has(upper)) {
      tokens.push({ type: 'OP', value: upper, pos: i })
    } else {
      tokens.push({ type: 'TERM', value: word, pos: i })
      terms++
    }
    i = j
  }
  if (terms > MAX_TERMS) {
    return { tokens, error: { message: `Query has more than ${MAX_TERMS} terms — split it into a saved search.`, position: 1 } }
  }
  return { tokens }
}

/**
 * Parse a boolean query.
 * Returns { ok: true, ast, summary } or { ok: false, error }.
 * Unlike the legacy parser this NEVER falls back silently: malformed input is
 * a hard error with a human-readable message + 1-based position.
 */
export function parseBooleanQuery(q: string):
  | { ok: true; ast: Ast; summary: string }
  | { ok: false; error: BooleanSyntaxError } {
  if (typeof q !== 'string') return { ok: false, error: { message: 'Query must be text.', position: 1 } }
  const query = q.trim()
  if (!query) return { ok: false, error: { message: 'Query is empty.', position: 1 } }
  if (query.length > MAX_QUERY_LEN) {
    return { ok: false, error: { message: `Query is longer than ${MAX_QUERY_LEN} characters.`, position: MAX_QUERY_LEN + 1 } }
  }

  const { tokens, error } = tokenize(query)
  if (error) return { ok: false, error }

  let idx = 0
  let depth = 0

  const peek = (): Token | undefined => tokens[idx]

  function parseOr(): Ast | { error: BooleanSyntaxError } {
    const children: Ast[] = []
    for (;;) {
      const nodeOrErr = parseAnd()
      if ('error' in nodeOrErr) return nodeOrErr
      children.push(nodeOrErr)
      const t = peek()
      if (t && t.type === 'OP' && t.value === 'OR') {
        idx++
        continue
      }
      break
    }
    return children.length === 1 ? children[0] : { kind: 'OR', children }
  }

  function parseAnd(): Ast | { error: BooleanSyntaxError } {
    const children: Ast[] = []
    for (;;) {
      const nodeOrErr = parseUnary()
      if ('error' in nodeOrErr) return nodeOrErr
      children.push(nodeOrErr)
      const t = peek()
      // implicit AND: a TERM/LPAREN/NOT following a completed operand
      if (t && (t.type === 'TERM' || t.type === 'LPAREN' || (t.type === 'OP' && t.value === 'NOT'))) {
        continue
      }
      if (t && t.type === 'OP' && t.value === 'AND') {
        idx++
        const next = peek()
        if (!next || (next.type === 'OP' && next.value !== 'NOT')) {
          return { error: { message: `"AND" must be followed by a term, phrase or "(...)" group.`, position: t.pos + 1 } }
        }
        continue
      }
      break
    }
    return children.length === 1 ? children[0] : { kind: 'AND', children }
  }

  function parseUnary(): Ast | { error: BooleanSyntaxError } {
    const t = peek()
    if (!t) {
      return { error: { message: 'Unexpected end of query — complete the last operator.', position: query.length + 1 } }
    }
    if (t.type === 'OP' && t.value === 'NOT') {
      idx++
      const child = parseUnary()
      if ('error' in child) return child
      return { kind: 'NOT', child }
    }
    return parsePrimary()
  }

  function parsePrimary(): Ast | { error: BooleanSyntaxError } {
    const t = peek()
    if (!t) {
      return { error: { message: 'Unexpected end of query — a term was expected.', position: query.length + 1 } }
    }
    if (t.type === 'LPAREN') {
      depth++
      if (depth > MAX_DEPTH) {
        return { error: { message: `Too many nested parentheses (max ${MAX_DEPTH}).`, position: t.pos + 1 } }
      }
      idx++
      const inner = parseOr()
      if ('error' in inner) return inner
      const close = peek()
      if (!close || close.type !== 'RPAREN') {
        return { error: { message: 'Missing closing parenthesis ")".', position: (close?.pos ?? query.length) + 1 } }
      }
      idx++
      depth--
      return inner
    }
    if (t.type === 'RPAREN') {
      return { error: { message: 'Unmatched closing parenthesis ")".', position: t.pos + 1 } }
    }
    if (t.type === 'OP') {
      return { error: { message: `"${t.value}" cannot appear here — it must sit between two terms or before a term.`, position: t.pos + 1 } }
    }
    idx++
    return { kind: 'TERM', term: t.value.toLowerCase(), phrase: t.value.includes(' ') }
  }

  const first = peek()
  if (!first) return { ok: false, error: { message: 'Query contains no searchable terms.', position: 1 } }

  const astOrErr = parseOr()
  if ('error' in astOrErr) return { ok: false, error: astOrErr.error }

  if (idx < tokens.length) {
    const t = tokens[idx]
    return {
      ok: false,
      error: {
        message: t.type === 'RPAREN' ? 'Unmatched closing parenthesis ")".' : `"${t.value}" cannot appear here.`,
        position: t.pos + 1,
      },
    }
  }

  return { ok: true, ast: astOrErr, summary: describeAst(astOrErr) }
}

/** Human-readable interpretation shown under the query box — keeps AND/OR
 *  grouping intact so the recruiter sees exactly what will run. */
export function describeAst(ast: Ast): string {
  interface Group {
    kind: 'all' | 'any'
    terms: string[]
  }
  const groups: Group[] = []
  const nots: string[] = []

  const t = (n: Ast): string => (n.kind === 'TERM' && n.phrase ? `"${n.term}"` : n.kind === 'TERM' ? n.term : '')

  function flattenAnd(node: Ast) {
    switch (node.kind) {
      case 'TERM':
        groups.push({ kind: 'all', terms: [t(node)] })
        break
      case 'OR':
        groups.push({ kind: 'any', terms: node.children.map(t) })
        break
      case 'AND':
        node.children.forEach(flattenAnd)
        break
      case 'NOT':
        collectNot(node.child)
        break
    }
  }

  function collectNot(node: Ast) {
    switch (node.kind) {
      case 'TERM':
        nots.push(t(node))
        break
      case 'OR':
        node.children.forEach(collectNot)
        break
      case 'AND':
        node.children.forEach(collectNot)
        break
      case 'NOT':
        collectNot(node.child)
        break
    }
  }

  // Root OR = "any of" across everything; otherwise treat as AND-tree
  if (ast.kind === 'OR') {
    groups.push({ kind: 'any', terms: ast.children.map(t) })
  } else if (ast.kind === 'NOT') {
    collectNot(ast.child)
  } else {
    flattenAnd(ast)
  }

  const parts: string[] = []
  for (const g of groups) {
    if (g.kind === 'any') parts.push(`Any of: ${g.terms.join(' / ')}`)
    else parts.push(`Must include: ${g.terms.join(', ')}`)
  }
  if (nots.length) parts.push(`Must NOT include: ${nots.join(', ')}`)
  return parts.join(' • ') || 'Plain keyword search'
}

/** Evaluate the parsed query against a record's lower-cased searchable fields. */
export function evaluateBooleanAst(ast: Ast, fields: string[]): boolean {
  const hay = fields.filter(Boolean)
  const contains = (term: string): boolean => hay.some((f) => f.includes(term))
  switch (ast.kind) {
    case 'TERM':
      return contains(ast.term)
    case 'NOT':
      return !evaluateBooleanAst(ast.child, fields)
    case 'AND':
      return ast.children.every((c) => evaluateBooleanAst(c, fields))
    case 'OR':
      return ast.children.some((c) => evaluateBooleanAst(c, fields))
  }
}

/** Collect every positive term (for relevance scoring). */
export function collectTerms(ast: Ast): string[] {
  switch (ast.kind) {
    case 'TERM':
      return [ast.term]
    case 'NOT':
      return []
    case 'AND':
    case 'OR':
      return ast.children.flatMap(collectTerms)
  }
}

/* ========================= structured criteria matching ==================== */

/** Small synonym map so common designations/skills hit their variants. */
const TERM_SYNONYMS: Record<string, string[]> = {
  sde: ['software engineer', 'software developer', 'fullstack developer', 'frontend developer', 'backend developer'],
  'software engineer': ['sde', 'software developer', 'developer', 'programmer', 'full stack developer'],
  developer: ['software engineer', 'programmer', 'coder', 'software developer'],
  fullstack: ['full stack', 'full stack developer', 'fullstack developer', 'software engineer', 'web developer'],
  'full stack': ['fullstack', 'full stack developer', 'fullstack developer', 'software engineer', 'web developer'],
  'full stack developer': ['fullstack developer', 'fullstack', 'full stack', 'software engineer', 'web developer'],
  frontend: ['front end', 'frontend developer', 'frontend engineer', 'ui developer', 'web developer', 'react developer'],
  'front end': ['frontend', 'frontend developer', 'frontend engineer', 'ui developer', 'web developer', 'react developer'],
  'frontend developer': ['frontend engineer', 'frontend', 'ui developer', 'react developer', 'web developer'],
  backend: ['back end', 'backend developer', 'backend engineer', 'node.js developer', 'java developer', 'python developer'],
  'back end': ['backend', 'backend developer', 'backend engineer', 'node.js developer', 'java developer'],
  'backend developer': ['backend engineer', 'backend', 'api developer', 'software engineer'],
  'web developer': ['frontend developer', 'full stack developer', 'software engineer', 'ui developer'],
  react: ['reactjs', 'react.js', 'react native'],
  reactjs: ['react', 'react.js'],
  'next.js': ['nextjs', 'next'],
  nextjs: ['next.js', 'next'],
  node: ['node.js', 'nodejs'],
  'node.js': ['nodejs', 'node'],
  javascript: ['js', 'typescript', 'es6'],
  js: ['javascript'],
  typescript: ['ts', 'javascript'],
  python: ['django', 'fastapi', 'flask'],
  java: ['spring boot', 'j2ee', 'core java'],
  qa: ['quality assurance', 'quality analyst', 'test engineer', 'sdet', 'automation engineer'],
  'quality assurance': ['qa', 'quality analyst', 'test engineer', 'sdet'],
  sdet: ['qa engineer', 'automation engineer', 'test engineer', 'quality assurance'],
  'automation engineer': ['sdet', 'qa engineer', 'test engineer', 'selenium tester'],
  devops: ['site reliability', 'sre', 'platform engineer', 'cloud engineer', 'infrastructure engineer'],
  sre: ['devops', 'site reliability', 'platform engineer'],
  'cloud engineer': ['devops', 'aws engineer', 'azure engineer', 'platform engineer'],
  'data scientist': ['machine learning engineer', 'ml engineer', 'ai engineer', 'data analyst'],
  'machine learning engineer': ['data scientist', 'ml engineer', 'ai engineer', 'mlops'],
  'ml engineer': ['machine learning engineer', 'data scientist', 'ai engineer'],
  'data analyst': ['bi analyst', 'business intelligence', 'data analytics', 'data scientist'],
  'product manager': ['pm', 'technical product manager', 'product owner', 'associate product manager'],
  'product owner': ['product manager', 'pm', 'agile product owner'],
  hrbp: ['hr business partner', 'hr business partnering', 'hr manager', 'human resources'],
  'hr business partner': ['hrbp', 'hr business partnering', 'hr manager', 'human resources'],
  'hr business partnering': ['hrbp', 'hr business partner'],
  hr: ['human resources', 'hr generalist', 'hr manager', 'hr operations', 'talent acquisition', 'recruiter', 'hrbp'],
  'human resources': ['hr', 'hr generalist', 'hr manager', 'talent acquisition', 'recruiter', 'hrbp'],
  'talent acquisition': ['recruiter', 'hr recruiter', 'technical recruiter', 'talent acquisition specialist', 'sourcing'],
  recruiter: ['talent acquisition', 'technical recruiter', 'hr recruiter', 'talent acquisition specialist'],
  'business development': ['bde', 'sales', 'sales executive', 'business development manager', 'account manager'],
  bde: ['business development executive', 'business development', 'sales executive'],
  'sales executive': ['business development', 'bde', 'account executive', 'sales manager'],
  'total rewards': ['compensation and benefits', 'compensation benchmarking', 'c&b'],
  'compensation and benefits': ['total rewards', 'compensation benchmarking', 'c&b'],
  'compensation benchmarking': ['compensation and benefits', 'total rewards'],
  'c&b': ['compensation and benefits', 'total rewards'],
  ui: ['ui/ux', 'user interface', 'frontend'],
  ux: ['ui/ux', 'user experience', 'product design'],
  'ui/ux': ['ux', 'ui', 'user experience', 'user interface', 'product designer'],
  mern: ['mongodb', 'express', 'react', 'node.js', 'full stack developer'],
  llm: ['large language model', 'generative ai', 'genai', 'ai engineer'],
  genai: ['llm', 'generative ai', 'large language model', 'ai engineer'],
  tpm: ['total productive maintenance'],
  oee: ['overall equipment effectiveness'],
  seo: ['search engine optimization', 'search engine optimisation'],
}

/** Public view of the synonym map for role/skill matching elsewhere. */
export function synonymsFor(token: string): string[] {
  const t = token.trim().toLowerCase()
  return t && TERM_SYNONYMS[t] ? TERM_SYNONYMS[t] : []
}

/** Token-exact skill match against a comma-separated skills field, with the
 *  synonym map applied in both directions. "Java" will NOT match "JavaScript". */
export function hasSkillToken(skillsCsv: string | null | undefined, term: string): boolean {
  if (!skillsCsv) return false
  const t = term.trim().toLowerCase()
  if (!t) return false
  const tokens = skillsCsv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (tokens.includes(t)) return true
  const syn = TERM_SYNONYMS[t]
  if (syn && syn.some((s) => tokens.includes(s))) return true
  // reverse: a stored token may be a synonym of the search term
  for (const token of tokens) {
    const syn2 = TERM_SYNONYMS[token]
    if (syn2 && syn2.includes(t)) return true
  }
  return false
}

/** Designation match: substring on the designation text + synonyms. */
export function matchesDesignation(text: string | null | undefined, term: string): boolean {
  if (!text) return false
  const t = term.trim().toLowerCase()
  if (!t) return false
  const hay = text.toLowerCase()
  if (hay.includes(t)) return true
  const syn = TERM_SYNONYMS[t]
  return !!syn && syn.some((s) => hay.includes(s))
}

/** Freshness helper: is the record active within N days? null/absent → only
 *  matches when the "any" window (N undefined) is requested. */
export function isFreshWithin(lastActiveAt: Date | string | null | undefined, days: number | undefined): boolean {
  if (days === undefined) return true
  if (!lastActiveAt) return false
  const d = typeof lastActiveAt === 'string' ? new Date(lastActiveAt) : lastActiveAt
  return Date.now() - d.getTime() <= days * 24 * 60 * 60 * 1000
}

/** Mask contact info for list views — contacts unlock on demand. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const [user, domain] = email.split('@')
  if (!domain) return '•••'
  const visible = user.slice(0, 2)
  return `${visible}${'•'.repeat(Math.max(2, Math.min(6, user.length - 2)))}@${domain.replace(/^[^.]+/, '•••')}`
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 4) return '••••'
  return `${phone.slice(0, phone.indexOf(digits.slice(-4)) >= 0 ? Math.max(0, phone.length - 4) : 0)}•••••${digits.slice(-4)}`
}
