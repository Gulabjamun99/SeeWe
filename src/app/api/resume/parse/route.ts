// SeeWe - POST /api/resume/parse
// Pure parse endpoint: takes raw resume text OR an uploaded resume file
// (PDF / DOCX as a base64 data URL), extracts text when needed, and returns
// structured profile fields extracted by the LLM. No persistence — the client
// applies changes itself via PATCH /api/candidates/[id]. Never 500s for AI
// hiccups: falls back to a deterministic heuristic parser and flags the source
// as 'heuristic'.

import { NextRequest, NextResponse } from 'next/server'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'
import { chatWithRetry, extractJson } from '@/lib/ai-client'

/* ------------------------------------------------------------------ */
/* Contracts (local to this route)                                     */
/* ------------------------------------------------------------------ */

export interface ParsedResume {
  headline: string
  skills: string[]
  experienceYears: number
  location: string | null
  currentCompany: string | null
  education: string | null
  summary: string
  suggestedCategories: string[]
}

const MIN_CHARS = 30
const MAX_CHARS = 12000
/** decoded upload cap — resumes are text documents, 3 MB is generous */
const MAX_FILE_BYTES = 3 * 1024 * 1024
/** base64 inflates ~4/3x + data-url header; reject BEFORE allocating memory */
const MAX_FILE_B64_CHARS = Math.ceil((MAX_FILE_BYTES * 4) / 3) + 256

/* ------------------------------------------------------------------ */
/* File text extraction (PDF / DOCX)                                   */
/* ------------------------------------------------------------------ */

/**
 * Pull plain text out of an uploaded resume. Accepts a base64 data URL
 * ("data:application/pdf;base64,…") or a bare base64 string.
 */
async function extractTextFromFile(
  fileBase64: string,
  filename: string
): Promise<string> {
  const commaIdx = fileBase64.indexOf(',')
  const b64 = commaIdx >= 0 ? fileBase64.slice(commaIdx + 1) : fileBase64
  // Pre-decode guard: refuse oversized payloads BEFORE Buffer allocation,
  // otherwise a 100 MB POST could balloon memory before the 3 MB check runs.
  if (b64.length > MAX_FILE_B64_CHARS) {
    throw new Error('File is larger than 3 MB — export a lighter copy and retry')
  }
  let buf: Buffer
  try {
    buf = Buffer.from(b64, 'base64')
  } catch {
    throw new Error('Could not decode the uploaded file — please re-upload')
  }
  if (buf.length === 0) throw new Error('The uploaded file is empty')
  if (buf.length > MAX_FILE_BYTES) {
    throw new Error('File is larger than 3 MB — export a lighter copy and retry')
  }

  // PDF magic bytes: “%PDF-”. Guards against a mislabeled extension.
  const looksPdf = buf.subarray(0, 5).toString('latin1') === '%PDF-'
  const lower = filename.toLowerCase()

  if (looksPdf || lower.endsWith('.pdf')) {
    const parser = new PDFParse({ data: new Uint8Array(buf) })
    try {
      const result = await parser.getText()
      const text = (result?.text ?? '').replace(/\n?-- \d+ of \d+ --\n?/g, '\n').trim()
      if (!text) {
        throw new Error(
          'No readable text found in that PDF — it may be a scan. Paste the text instead'
        )
      }
      return text
    } catch (err) {
      // Re-wrap library internals (InvalidPDFStructure etc.) in human copy —
      // but pass through our own "no readable text" message untouched.
      if (err instanceof Error && err.message.startsWith('No readable text')) throw err
      console.error('[resume/parse] PDF extraction failed:', err)
      throw new Error(
        'That PDF could not be read — it may be corrupted or password-protected. Try another export or paste the text'
      )
    } finally {
      await parser.destroy().catch(() => undefined)
    }
  }

  if (lower.endsWith('.docx')) {
    try {
      const { value } = await mammoth.extractRawText({ buffer: buf })
      const text = (value ?? '').trim()
      if (!text) throw new Error('empty docx')
      return text
    } catch {
      throw new Error('Could not read that DOCX — is it a valid Word file?')
    }
  }

  if (lower.endsWith('.doc')) {
    throw new Error('Legacy .doc files are not supported — save as .docx or PDF and retry')
  }

  // Everything else: try UTF-8 like the plain-text path does.
  const text = buf.toString('utf8')
  if (text.includes('\u0000')) {
    throw new Error('Unsupported file type — upload PDF, DOCX or a plain-text resume')
  }
  return text
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Null-out empty strings so callers always get `string | null`. */
function nullable(value: unknown): string | null {
  const s = asTrimmedString(value)
  return s.length > 0 ? s : null
}

function clampNumber(value: unknown, fallback = 0): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : NaN
  if (!Number.isFinite(n) || n < 0) return fallback
  // Cap at a sane career length so model hallucinations can't hurt.
  return Math.min(Math.round(n * 10) / 10, 60)
}

function normalizeSkills(value: unknown, max = 12): string[] {
  const raw = Array.isArray(value) ? value : []
  const out: string[] = []
  for (const item of raw) {
    let s = asTrimmedString(item)
    if (!s) continue
    s = s.replace(/\s+/g, ' ')
    if (s.length > 40) s = s.slice(0, 40).trim()
    if (!out.some((existing) => existing.toLowerCase() === s.toLowerCase())) out.push(s)
    if (out.length >= max) break
  }
  return out
}

/** Keep summaries to ≤ maxWords words. */
function clipWords(value: unknown, maxWords: number): string {
  const s = asTrimmedString(value).replace(/\s+/g, ' ')
  const words = s.split(' ').filter(Boolean)
  if (words.length <= maxWords) return s
  return words.slice(0, maxWords).join(' ')
}

/* ------------------------------------------------------------------ */
/* Deterministic fallback assets                                       */
/* ------------------------------------------------------------------ */

/** Curated known tech skills for word-boundary matching (~60 entries). */
const KNOWN_SKILLS: string[] = [
  'JavaScript', 'TypeScript', 'React', 'React Native', 'Next.js', 'Vue.js', 'Angular',
  'Node.js', 'Express', 'NestJS', 'Python', 'Django', 'Flask', 'FastAPI',
  'Java', 'Spring Boot', 'Kotlin', 'Swift', 'Flutter', 'Dart',
  'Go', 'Rust', 'C++', 'C#', '.NET', 'PHP', 'Laravel', 'Ruby on Rails',
  'SQL', 'MySQL', 'PostgreSQL', 'MongoDB', 'Redis', 'Elasticsearch', 'SQLite',
  'GraphQL', 'REST API', 'HTML', 'CSS', 'Tailwind CSS', 'Redux',
  'AWS', 'Azure', 'Google Cloud', 'Docker', 'Kubernetes', 'Jenkins', 'CI/CD',
  'Git', 'Linux', 'Terraform', 'Machine Learning', 'Deep Learning', 'TensorFlow',
  'PyTorch', 'Pandas', 'NumPy', 'scikit-learn', 'Data Analysis', 'Power BI',
  'Tableau', 'Kafka', 'Apache Spark', 'Figma', 'Selenium',
]

const INDIAN_CITIES: string[] = [
  'Bengaluru', 'Bangalore', 'Mumbai', 'Navi Mumbai', 'New Delhi', 'Delhi', 'Gurugram',
  'Gurgaon', 'Noida', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata', 'Ahmedabad',
  'Jaipur', 'Indore', 'Chandigarh', 'Kochi', 'Coimbatore', 'Thiruvananthapuram',
  'Bhubaneswar', 'Lucknow', 'Nagpur', 'Surat', 'Vadodara', 'Visakhapatnam',
  'Mohali', 'Remote',
]

/**
 * Map detected skills onto SeeWe job categories. Used both as a safety net for
 * sparse AI output and as the heuristic parser's category suggester.
 */
function suggestCategories(skills: string[]): string[] {
  const text = ` ${skills.join(' ').toLowerCase()} `
  const picks: string[] = []
  const add = (c: string) => {
    if (!picks.includes(c)) picks.push(c)
  }
  if (/ (react|next\.js|vue|angular|javascript|typescript|node\.js|html|css|tailwind css|redux|frontend) /.test(text)) add('Software Engineering')
  if (/ (python|django|flask|fastapi|java|spring boot|\.net|php|laravel|ruby on rails|rust|kotlin|backend) /.test(text)) add('Software Engineering')
  if (/ (machine learning|deep learning|tensorflow|pytorch|pandas|numpy|scikit-learn|data analysis|apache spark) /.test(text)) add('Data Science')
  if (/ (sql|mysql|postgresql|mongodb|redis|elasticsearch|sqlite) /.test(text)) add('Data & Analytics')
  if (/ (aws|azure|google cloud|docker|kubernetes|terraform|jenkins|ci\/cd|linux) /.test(text)) add('DevOps & Cloud')
  if (/ (react native|flutter|swift|dart|mobile development) /.test(text)) add('Mobile Development')
  if (text.includes(' figma')) add('Design')
  else if (text.includes(' selenium')) add('Quality Assurance')
  // Reorder so Mobile lands right after the core engineering picks.
  const mobileIdx = picks.indexOf('Mobile Development')
  if (mobileIdx !== -1 && picks.length > 1) {
    picks.splice(mobileIdx, 1)
    picks.splice(1, 0, 'Mobile Development')
  }
  if (picks.length === 0 && skills.length > 0) add('Software Engineering')
  return picks.slice(0, 4)
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractKnownSkills(text: string): string[] {
  const found: string[] = []
  for (const skill of KNOWN_SKILLS) {
    // Lookarounds instead of \b so symbols like C++ / .NET / Next.js still work.
    const re = new RegExp(
      `(?<![A-Za-z0-9+#.])${escapeRegExp(skill)}(?![A-Za-z0-9+#])`,
      'i'
    )
    if (re.test(text)) found.push(skill)
    if (found.length >= 12) break
  }
  return found
}

function extractExperienceYears(text: string): number {
  // Matches "7 years", "5+ years", "3.5 yrs"…
  let best = 0
  const re = /(\d{1,2}(?:\.\d)?)\s*\+?\s*(?:years?|yrs?)/gi
  for (const m of text.matchAll(re)) {
    const n = Number.parseFloat(m[1])
    if (Number.isFinite(n) && n >= 0 && n <= 45 && n > best) best = n
  }
  if (best === 0 && /\bdecade\b/i.test(text)) best = 10
  return best
}

function extractLocation(text: string): string | null {
  // Prefer explicit "Location : X" lines before scanning for city names.
  const labeled = text.match(/location\s*[:\-]\s*([A-Za-z .,'-]{2,40})/i)
  if (labeled?.[1]) {
    const v = labeled[1].split(/\n/)[0]?.trim()
    if (v) return v
  }
  for (const city of INDIAN_CITIES) {
    if (new RegExp(`\\b${escapeRegExp(city)}\\b`, 'i').test(text)) {
      if (city === 'Bangalore') return 'Bengaluru'
      if (city === 'Gurgaon') return 'Gurugram'
      return city
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Heuristic parser                                                    */
/* ------------------------------------------------------------------ */

function heuristicParse(resumeText: string): ParsedResume {
  const text = resumeText.replace(/\r\n/g, '\n').trim()

  const skills = extractKnownSkills(text)
  const experienceYears = extractExperienceYears(text)

  // Headline: first meaningful line, trimmed to 70 chars.
  let headline = ''
  for (const line of text.split('\n')) {
    const l = line.replace(/^[\s\-*•#]+/, '').trim()
    if (l.length >= 3 && !/^(resume|curriculum vitae|profile)$/i.test(l)) {
      headline = l.slice(0, 70).trim()
      break
    }
  }

  const location = extractLocation(text)

  let currentCompany: string | null = null
  const companyLine = text.match(/(?:current\s+company|company)\s*[:\-]\s*([^\n]{2,60})/i)
  if (companyLine?.[1]) currentCompany = companyLine[1].trim()

  let education: string | null = null
  const eduMatch = text.match(
    /((?:B|M)\.?(?:Tech|E\b|Sc|CA)|Bachelor(?:'s)?|Master(?:'s)?|MBA|Ph\.?D)[^\n]{0,70}/i
  )
  if (eduMatch?.[0]) {
    education = eduMatch[0]
      .split(/\n/)
      .join(', ')
      .replace(/\s+/g, ' ')
      .split(',')
      .slice(0, 2)
      .join(',')
      .trim()
      .slice(0, 90)
  }

  const topSkills = skills.slice(0, 4)
  const subject =
    headline.replace(/^(Senior|Lead|Principal|Junior)\s+/i, '') || 'Professional candidate'
  const summaryParts: string[] = [subject]
  if (experienceYears > 0) {
    summaryParts.push(
      `with ${experienceYears} ${experienceYears === 1 ? 'year' : 'years'} of hands-on experience`
    )
  }
  if (topSkills.length > 0) summaryParts.push(`skilled in ${topSkills.join(', ')}`)
  const summary = clipWords(summaryParts.join(', ').replace(', with', ' with'), 60)

  return {
    headline,
    skills,
    experienceYears,
    location,
    currentCompany,
    education,
    summary,
    suggestedCategories: suggestCategories(skills),
  }
}

/* ------------------------------------------------------------------ */
/* LLM prompt                                                          */
/* ------------------------------------------------------------------ */

const SYSTEM_PROMPT = `You are an expert resume parser. You read raw resume text and return one strict JSON object with normalized profile fields. Output STRICT JSON only — no markdown fences, no commentary, no extra keys.

Required shape:
{
  "headline": string,              // e.g. "Senior React Developer"
  "skills": string[],              // 5-12 normalized skill names (e.g. "React", "Node.js", "SQL")
  "experienceYears": number,       // best estimate of total professional experience; 0 if unclear
  "location": string | null,       // city/country if present, else null
  "currentCompany": string | null, // most recent employer, else null
  "education": string | null,      // degree + institution short form e.g. "B.Tech CSE, VIT Vellore", else null
  "summary": string,               // professional summary, maximum 60 words
  "suggestedCategories": string[]  // 2-4 job categories like "Software Engineering", "Data Science"
}`

function buildUserPrompt(resumeText: string): string {
  return `Parse the following resume text and return the STRICT JSON object described in your instructions. If a field cannot be determined use null (or 0 for experienceYears).

RESUME TEXT:
"""
${resumeText}
"""

Return only the JSON object now.`
}

/* ------------------------------------------------------------------ */
/* Route handler                                                       */
/* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      resumeText?: unknown
      file_base64?: unknown
      filename?: unknown
    }

    /* ------------------------- obtain raw text ------------------------- */
    let rawText = ''
    if (typeof body.file_base64 === 'string' && body.file_base64.length > 0) {
      const filename =
        typeof body.filename === 'string' && body.filename.trim()
          ? body.filename.trim()
          : 'resume.pdf'
      try {
        rawText = await extractTextFromFile(body.file_base64, filename)
      } catch (err) {
        // 422 — the upload itself was unusable (client should surface this)
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? err.message
                : 'Could not read the uploaded resume'
          },
          { status: 422 }
        )
      }
    } else if (typeof body.resumeText === 'string') {
      rawText = body.resumeText.trim()
    }

    if (rawText.length < MIN_CHARS) {
      return NextResponse.json(
        {
          error: `Resume text is required (minimum ${MIN_CHARS} characters after extraction)`
        },
        { status: 400 }
      )
    }

    const resumeText = rawText.length > MAX_CHARS ? rawText.slice(0, MAX_CHARS) : rawText

    let source: 'ai' | 'heuristic' = 'ai'
    let extracted: ParsedResume

    try {
      const raw = await chatWithRetry(SYSTEM_PROMPT, buildUserPrompt(resumeText))
      const parsed = extractJson<Record<string, unknown>>(raw)

      extracted = {
        headline: asTrimmedString(parsed.headline).slice(0, 90),
        skills: normalizeSkills(parsed.skills),
        experienceYears: clampNumber(parsed.experienceYears),
        location: nullable(parsed.location),
        currentCompany: nullable(parsed.currentCompany ?? parsed.company),
        education: nullable(parsed.education),
        summary: clipWords(parsed.summary, 60),
        suggestedCategories: normalizeSkills(parsed.suggestedCategories, 4),
      }

      // Quality gate: with zero usable signal prefer the heuristic parser.
      if (!extracted.headline && extracted.skills.length === 0 && !extracted.location) {
        throw new Error('AI output lacked usable fields')
      }
      if (extracted.suggestedCategories.length < 2) {
        extracted.suggestedCategories = suggestCategories(extracted.skills)
      }
    } catch (err) {
      console.error('[resume/parse] AI path failed, using heuristic parser:', err)
      source = 'heuristic'
      extracted = heuristicParse(resumeText)
    }

    return NextResponse.json({ data: { extracted, source, text: resumeText } })
  } catch (error) {
    console.error('[resume/parse] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to parse resume' }, { status: 500 })
  }
}
