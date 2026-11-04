/**
 * jd-parser — deterministic Job-Description parser for the Talent Search
 * "Match vs JD" engine.
 *
 * Extracts from raw pasted JD text:
 *   • roleTitle           (job title / designation line)
 *   • minYears / maxYears (experience requirement, e.g. "5-8 years", "7+ yrs")
 *   • mustHaveSkills      (skill-lexicon scan, appearance order)
 *   • goodToHaveSkills    (skills appearing after "nice to have" markers)
 *   • responsibilities    (bullet lines / action-verb sentences)
 *   • location            ("Location:" header or known Indian city match)
 *
 * It is the ALWAYS-AVAILABLE fallback under the AI JD parser (see
 * /api/sourcing/match) and is labelled `keyword` in responses so recruiters
 * know exactly which engine read their JD. Nothing is invented: if a field
 * cannot be found it stays empty/unknown.
 */

import { hasSkillToken, synonymsFor } from './talent-search-engine'

export interface JdParse {
  roleTitle: string
  minYears: number | null
  maxYears: number | null
  mustHaveSkills: string[]
  goodToHaveSkills: string[]
  responsibilities: string[]
  location: string
}

/* ------------------------- AI-skill normalisation ------------------------- */
/* The AI parser returns skills verbatim from the JD ("performance management
 * cycles", "compensation and benefits frameworks"). Real CVs store the clean
 * skill token ("Performance Management", "Compensation Benchmarking"), so the
 * literal phrases never match. These helpers normalise AI output into
 * matchable skill terms and score them with word overlap instead of exact
 * substring only. */

const SKILL_FILLER_TAIL =
  /\s+(cycles?|programs?|frameworks?|initiatives?|processes?|activities|efforts?|practices?|workflows?)$/i

/** Gerund words that ARE real skills (everything else ending in -ing is a
 *  verb the AI leaked from the JD — "designing", "executing" — and is junk). */
const GERUND_SKILL_ALLOW = new Set([
  'marketing', 'recruiting', 'staffing', 'sourcing', 'training', 'hiring', 'onboarding',
  'auditing', 'coaching', 'consulting', 'modelling', 'modeling', 'branding', 'testing',
  'fundraising', 'programming', 'drafting', 'planning', 'reporting', 'budgeting',
])

/** Clean one AI-extracted skill phrase into a matchable term. */
function cleanSkillPhrase(raw: string): string[] {
  let s = raw.replace(/\s+/g, ' ').trim()
  if (s.length < 3) return []
  // sentences are not skills ("translating business data into HR strategy")
  if (s.split(' ').length > 4) return []
  // strip trailing filler nouns ("management cycles" → "management")
  while (SKILL_FILLER_TAIL.test(s)) s = s.replace(SKILL_FILLER_TAIL, '').trim()
  if (s.length < 3) return []
  // bare gerunds are leaked verbs, not skills ("designing") — unless the word
  // itself is a recognised skill ("marketing", "training")
  if (!s.includes(' ') && s.endsWith('ing') && !GERUND_SKILL_ALLOW.has(s.toLowerCase())) return []
  // split "compensation and benefits" into both halves when both are real
  const parts = s.split(/\s+(?:and|&)\s+/i)
  if (parts.length === 2 && parts[0].length >= 3 && parts[1].length >= 3) {
    return [parts[0].toLowerCase(), parts[1].toLowerCase()]
  }
  return [s.toLowerCase()]
}

/** Normalise an AI-parsed skill list: lowercase, de-filler, de-duplicate. */
export function normaliseJdSkills(skills: string[], max = 12): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of skills) {
    for (const term of cleanSkillPhrase(raw)) {
      if (seen.has(term)) continue
      seen.add(term)
      out.push(term)
      if (out.length >= max) return out
    }
  }
  return out
}

const JD_SKILL_STOPWORDS = new Set([
  'and', 'or', 'the', 'of', 'in', 'for', 'to', 'with', 'a', 'an', 'on', 'at', 'by', 'into',
])

/**
 * Does one JD skill hit a candidate? Layered matching so AI-verbatim phrases
 * still find the CV token:
 *   1. token-exact skill match (+synonyms) on the skills CSV
 *   2. literal phrase substring in resume text / held titles
 *   3. word overlap for multi-word phrases — ≥60% of significant words found
 *      ("performance management cycles" ↔ CV "Performance Management")
 */
export function jdSkillHit(
  skill: string,
  hay: { skillsCsv: string | null | undefined; resumeText: string | null | undefined; titles: (string | null | undefined)[] },
): { hit: boolean; evidence: 'profile skills' | 'resume text' | 'designation' | null } {
  const sLower = (skill || '').toLowerCase().trim()
  if (!sLower) return { hit: false, evidence: null }
  const skillsLower = (hay.skillsCsv || '').toLowerCase()
  const resumeLower = (hay.resumeText || '').toLowerCase()
  const titlesLower = hay.titles.map((t) => (t || '').toLowerCase())

  // 1. token-exact (synonym-aware) — the strongest evidence
  if (hasSkillToken(hay.skillsCsv, skill)) return { hit: true, evidence: 'profile skills' }
  // 2. literal phrase
  if (resumeLower.includes(sLower)) return { hit: true, evidence: 'resume text' }
  if (titlesLower.some((t) => t.includes(sLower))) return { hit: true, evidence: 'designation' }
  // 3. word-level matching for multi-word phrases ("hr" counts — real token)
  const words = sLower.split(/[^a-z0-9+#.]+/).filter((w) => w.length >= 2 && !JD_SKILL_STOPWORDS.has(w))
  if (words.length === 0) return { hit: false, evidence: null }

  // generic words appear in almost every CV ("management", "development") —
  // they can never carry a match alone; specific words can ("compensation",
  // "change", "hrbp"). A JD skill hits when one of its SPECIFIC words appears
  // as a word inside a stored skill token ("Compensation and Benefits" ↔
  // "Compensation Benchmarking").
  const GENERIC_WORDS = new Set([
    'management', 'development', 'strategy', 'strategies', 'planning', 'relations',
    'analysis', 'analytics', 'systems', 'tools', 'design', 'operations', 'support',
    'services', 'solutions', 'skills', 'resources', 'process', 'processes',
    'compliance', 'assurance', 'optimization', 'optimisation', 'reviews', 'programs',
  ])
  const skillTokens = skillsLower ? skillsLower.split(',').map((x) => x.trim()).filter(Boolean) : []
  const specificWords = words.filter((w) => !GENERIC_WORDS.has(w))
  for (const w of specificWords) {
    const re = new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`)
    if (skillTokens.some((tok) => re.test(tok))) return { hit: true, evidence: 'profile skills' }
  }

  // word overlap across resume/titles for the remaining cases — ≥60% of the
  // phrase's words must appear ("performance management cycles" ↔ CV text)
  if (words.length >= 2) {
    const matchedInSkills = words.filter((w) => skillsLower.includes(w))
    const matchedInResume = words.filter((w) => resumeLower.includes(w))
    const matchedInTitles = words.filter((w) => titlesLower.some((t) => t.includes(w)))
    const totalMatched = new Set([...matchedInSkills, ...matchedInResume, ...matchedInTitles])
    if (totalMatched.size / words.length >= 0.6) {
      if (matchedInSkills.length >= Math.max(1, words.length / 2)) return { hit: true, evidence: 'profile skills' }
      return { hit: true, evidence: 'resume text' }
    }
  }
  return { hit: false, evidence: null }
}

/* ------------------------------ skill lexicon ----------------------------- */
/* Multi-word entries are matched first so "Spring Boot" wins over "Spring". */
const SKILL_LEXICON: string[] = [
  // Software & data
  'React', 'React Native', 'Next.js', 'Node.js', 'TypeScript', 'JavaScript', 'Java', 'Spring Boot',
  'Python', 'Django', 'Flask', 'FastAPI', 'Go', 'Kotlin', 'Swift', 'Flutter', 'PHP', 'Laravel',
  '.NET', 'C#', 'C++', 'Ruby on Rails', 'GraphQL', 'REST APIs', 'Microservices', 'MongoDB',
  'PostgreSQL', 'MySQL', 'Redis', 'Kafka', 'Spark', 'Airflow', 'Snowflake', 'dbt', 'SQL', 'NoSQL',
  'PyTorch', 'TensorFlow', 'scikit-learn', 'Pandas', 'NLP', 'LLM', 'Machine Learning', 'Deep Learning',
  'MLOps', 'Data Engineering', 'Data Analytics', 'Power BI', 'Tableau', 'Excel VBA', 'MS Excel',
  'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'Terraform', 'Jenkins', 'CI/CD', 'Linux',
  'Prometheus', 'Ansible', 'Shell Scripting', 'Selenium', 'Playwright', 'Cypress', 'Appium',
  'API Testing', 'Postman', 'Jest', 'Redux', 'Tailwind CSS', 'Accessibility', 'Firebase',
  // Manufacturing / industrial
  'TPM', 'OEE', 'CMMS', 'SAP PM', 'Preventive Maintenance', 'Condition Monitoring',
  'Vibration Analysis', 'Hydraulics', 'Pneumatics', 'Extrusion', 'Polymer', 'Plastic Pipes',
  'Injection Moulding', 'Lean Manufacturing', 'Kaizen', '5S', 'Six Sigma', 'SCADA', 'HVAC',
  'Compressors', 'Boilers', 'Root Cause Analysis', 'SPC', 'ISO 9001', 'Quality Control',
  'Calibration', 'NCR Management', 'Die Design', 'Process Optimisation', 'Material Science',
  'Energy Audits', 'AMC Management', 'Electrical Maintenance', 'Utility Equipment',
  // BFSI
  'Credit Underwriting', 'Financial Modelling', 'Ratio Analysis', 'Bloomberg', 'Risk Assessment',
  'IFRS 9', 'Market Risk', 'VaR', 'Basel III', 'Stress Testing', 'KYC', 'AML',
  'SEBI Regulations', 'Compliance Audits', 'Fund Accounting', 'NAV Reconciliation', 'SWIFT',
  'Settlements', 'Fraud Detection', 'Transaction Monitoring', 'Regulatory Reporting',
  'Portfolio Analytics', 'Case Management', 'Risk Governance', 'Policy Drafting',
  // Sales / marketing / ops / HR
  'Business Development', 'Key Account Management', 'Lead Generation', 'CRM', 'Salesforce',
  'Channel Sales', 'B2B Sales', 'Negotiation', 'Client Servicing', 'Digital Marketing', 'SEO',
  'SEM', 'Google Analytics', 'Content Marketing', 'Brand Management', 'Performance Marketing',
  'Recruitment', 'Payroll', 'HR Operations', 'Talent Acquisition', 'Performance Management',
  'Change Management', 'Organization Development', 'Employee Relations',
  'Compensation and Benefits', 'Total Rewards', 'HR Business Partnering', 'HRBP',
  'Succession Planning', 'Workforce Planning', 'Learning and Development', 'HR Strategy',
  'HRMS', 'HRIS', 'Statutory Compliance', 'Background Verification', 'Engagement Surveys',
  'Employer Branding', 'Campus Hiring', 'Onboarding', 'Grievance Handling',
  'Conflict Resolution', 'Industrial Relations', 'Organizational Design',
  'Supply Chain', 'Procurement', 'Logistics', 'Inventory Management', 'Vendor Management',
  'Warehouse Operations', 'Demand Planning', 'Project Management', 'Agile', 'Scrum',
  'Stakeholder Management', 'Budget Planning', 'Team Management', 'Shift Management',
  'Safety Compliance', 'ERP', 'SAP', 'Tally', 'QuickBooks',
  // Healthcare / pharma / others
  'Clinical Research', 'Pharmacovigilance', 'Regulatory Affairs', 'GCP', 'GMP', 'Medical Coding',
  'Patient Care', 'Nursing', 'Radiology', 'Lab Technician', 'Quality Assurance',
]

const CITY_HINTS = [
  'Bengaluru', 'Bangalore', 'Pune', 'Mumbai', 'Hyderabad', 'Delhi NCR', 'New Delhi', 'Chennai',
  'Ahmedabad', 'Kolkata', 'Noida', 'Gurugram', 'Gurgaon', 'Jaipur', 'Indore', 'Kochi',
  'Chandigarh', 'Nagpur', 'Remote',
]

const STOP_ROLE_TOKENS = new Set([
  'the', 'and', 'for', 'with', 'from', 'our', 'are', 'will', 'you', 'your', 'job', 'role',
  'opening', 'urgent', 'hiring', 'looking', 'wanted', 'required', 'vacancy', 'position',
  'description', 'title', 'designation', 'company', 'about', 'us', 'we', 'a', 'an', 'in', 'at',
  'of', 'to', 'on', 'as', 'by', 'be', 'is', 'it',
])

/* ------------------------------- utilities -------------------------------- */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Word-boundary skill scan. "Java" does not match "JavaScript". */
function scanSkills(text: string): string[] {
  const found: string[] = []
  const lower = text.toLowerCase()
  // longest-first so multi-word skills win their match before substrings
  const sorted = [...SKILL_LEXICON].sort((a, b) => b.length - a.length)
  for (const skill of sorted) {
    const re = new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(skill.toLowerCase())}([^a-z0-9+#]|$)`, 'i')
    if (re.test(lower)) found.push(skill)
  }
  return found
}

function extractYears(text: string): { minYears: number | null; maxYears: number | null } {
  let min: number | null = null
  let max: number | null = null
  const patterns: RegExp[] = [
    /(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\s*(?:\+)?\s*(?:years?|yrs?)/i,
    /(\d{1,2})\s*\+\s*(?:years?|yrs?)/i,
    /(?:minimum|min(?:imum)?|at least|over)\s+(\d{1,2})\s*(?:years?|yrs?)/i,
    /(\d{1,2})\s*(?:years?|yrs?)\s+(?:of\s+)?(?:relevant\s+)?experience/i,
    /experience\s*(?:of|:)?\s*(\d{1,2})\s*(?:-|–|to)?\s*(\d{1,2})?\s*(?:years?|yrs?)/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const a = parseInt(m[1], 10)
      const b = m[2] ? parseInt(m[2], 10) : null
      if (!Number.isNaN(a) && a <= 40) {
        min = a
        max = b !== null && !Number.isNaN(b) && b >= a && b <= 40 ? b : null
        return { minYears: min, maxYears: max }
      }
    }
  }
  return { minYears: null, maxYears: null }
}

const HEADER_LINE =
  /(?:key\s+responsibilities|responsibilities|required\s+skills?|skills?\s*required|skillset|requirements|qualifications?|about\s+us|about\s+the\s+role|perks|benefits|what\s+you.?ll\s+do|who\s+we\s+are|nice\s+to\s+have|good\s+to\s+have|job\s+description|employment\s+type|salary|experience|required|preferred)\b/i

function extractRoleTitle(text: string): string {
  const labelled =
    text.match(/(?:job\s*title|role\s*name|designation|position|role)\s*[:\-–]\s*([^\n]{3,80})/i)
  if (labelled) {
    const t = labelled[1].trim().replace(/\s+/g, ' ')
    // reject lines that are clearly sentences or section headers
    if (t.split(/\s+/).length <= 8 && !/[.!?]$/.test(t) && !HEADER_LINE.test(t)) return t.slice(0, 80)
  }
  // "As a Manager-HRBP, you will…" — the opening sentence often names the role
  const asA = text.match(/^As an?\s+([A-Z][^,.\n]{2,50}),/m)
  if (asA) {
    const t = asA[1].trim().replace(/\s+/g, ' ')
    if (t.split(/\s+/).length <= 6 && !HEADER_LINE.test(t)) return t.slice(0, 80)
  }
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0)
  if (
    firstLine &&
    firstLine.split(/\s+/).length <= 8 &&
    firstLine.length <= 70 &&
    !/[.:]$/.test(firstLine) &&
    !HEADER_LINE.test(firstLine)
  ) {
    return firstLine.replace(/[*_#]/g, '').trim()
  }
  return ''
}

function extractResponsibilities(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const bullets = lines
    .filter((l) => /^[-*•·]|^\d+[.)]\s/.test(l))
    .map((l) => l.replace(/^[-*•·]\s*|^\d+[.)]\s*/, '').trim())
    .filter((l) => l.length >= 15 && l.length <= 240)
  if (bullets.length >= 2) return bullets.slice(0, 8)

  // sentence fallback: keep responsibility-flavoured sentences
  const verbs =
    /\b(manage|lead|own|drive|handle|develop|maintain|ensure|coordinate|oversee|responsible|deliver|implement|build|design|support|monitor|plan|execute|supervise|prepare|analyse|analyze|optimize|optimise|collaborate|mentor|train|reduce|improve|increase)\b/i
  const sentences = text
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 240 && verbs.test(s))
  return sentences.slice(0, 8)
}

function extractLocation(text: string): string {
  const labelled = text.match(/location\s*[:\-–]\s*([A-Za-z ,/()-]{3,60})/i)
  if (labelled) return labelled[1].trim().split(/\s{2,}/)[0].slice(0, 60)
  for (const city of CITY_HINTS) {
    if (new RegExp(`(^|[^a-z])${escapeRegex(city)}([^a-z]|$)`, 'i').test(text)) return city
  }
  return ''
}

/* ------------------------------ public API -------------------------------- */

const GOOD_TO_HAVE_MARKERS =
  /(nice\s*to\s*have|good\s*to\s*have|preferred\s*(?:skills?|qualifications?)|plus(?:es)?\s*[:\-]|bonus\s*(?:points|skills)?\s*[:\-])([\s\S]*?)(?:\n\s*\n|$)/i

/**
 * Deterministic JD parse. Never throws; unknown fields stay empty so the
 * match engine can mark them UNKNOWN instead of guessing.
 */
export function parseJdDeterministic(rawJd: string): JdParse {
  const jd = (rawJd || '').replace(/\r\n/g, '\n').trim()
  if (!jd) {
    return { roleTitle: '', minYears: null, maxYears: null, mustHaveSkills: [], goodToHaveSkills: [], responsibilities: [], location: '' }
  }

  let mustSection = jd
  let goodSection = ''
  const gtm = jd.match(GOOD_TO_HAVE_MARKERS)
  if (gtm && gtm.index !== undefined) {
    mustSection = jd.slice(0, gtm.index)
    goodSection = gtm[2] || ''
  }

  const mustSeen = new Set<string>()
  const mustHaveSkills = scanSkills(mustSection).filter((s) => {
    if (mustSeen.has(s)) return false
    mustSeen.add(s)
    return true
  }).slice(0, 12)

  let goodToHaveSkills: string[] = []
  if (goodSection) {
    const seen = new Set(mustHaveSkills.map((s) => s.toLowerCase()))
    goodToHaveSkills = scanSkills(goodSection)
      .filter((s) => !seen.has(s.toLowerCase()))
      .slice(0, 8)
  }

  const { minYears, maxYears } = extractYears(jd)

  return {
    roleTitle: extractRoleTitle(jd),
    minYears,
    maxYears,
    mustHaveSkills,
    goodToHaveSkills,
    responsibilities: extractResponsibilities(jd),
    location: extractLocation(jd),
  }
}

/**
 * Role-title similarity: token overlap between the JD role and the role the
 * candidate currently holds (or headline). 0..1.
 */
export function roleTitleSimilarity(jdRole: string, heldTitles: (string | null | undefined)[]): number {
  const jdTokens = jdRole
    .toLowerCase()
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length >= 2 && !STOP_ROLE_TOKENS.has(t))
  if (jdTokens.length === 0) return 0
  let best = 0
  for (const title of heldTitles) {
    if (!title) continue
    const titleLower = title.toLowerCase()
    // a token hits when the title contains it OR any of its known synonyms
    // ("Manager-HRBP" ↔ "HR Business Partner" via hrbp ↔ hr business partner)
    const hits = jdTokens.filter((t) => {
      if (titleLower.includes(t)) return true
      return synonymsFor(t).some((s) => titleLower.includes(s))
    }).length
    const coverage = hits / jdTokens.length
    // reward seniority-prefix alignment (senior/plant/head/lead)
    best = Math.max(best, coverage)
  }
  return best
}

/**
 * Keyword coverage of JD responsibilities against the candidate resume:
 * meaningful noun-ish tokens (len>=4, non-stopword) found in the resume text.
 * Returns { coverage, matched, missed }.
 */
export function responsibilitiesCoverage(
  responsibilities: string[],
  resumeText: string | null | undefined,
): { coverage: number | null; matched: string[]; missed: string[] } {
  if (responsibilities.length === 0) return { coverage: null, matched: [], missed: [] }
  const resumeLower = (resumeText || '').toLowerCase()
  const keywords = new Set<string>()
  for (const line of responsibilities) {
    for (const tok of line.toLowerCase().split(/[^a-z0-9+#.]+/)) {
      if (tok.length >= 4 && !STOP_ROLE_TOKENS.has(tok) && !/^\d+$/.test(tok)) keywords.add(tok)
    }
  }
  const kwList = [...keywords].slice(0, 40)
  if (kwList.length === 0) return { coverage: null, matched: [], missed: [] }
  const matched = kwList.filter((k) => resumeLower.includes(k))
  const missed = kwList.filter((k) => !resumeLower.includes(k))
  return { coverage: matched.length / kwList.length, matched, missed }
}
