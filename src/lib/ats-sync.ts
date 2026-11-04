// SeeWe - ATS job-sync engine (shared by the inbound webhook and sync-jobs)
// One ingestion path for both directions of the enterprise ATS bridge:
//   1. POST /api/v1/webhooks/ats/[companyId]  (the ATS pushes jobs IN)
//   2. POST /api/ats/sync-jobs                (SeeWe pulls jobs from the ATS,
//      or generates a realistic demo batch when no real endpoint answers)
// Jobs are upserted per recruiter: matched by the external `atsJobId` first,
// then by (title + company). SeeWe never trusts payload company strings — the
// owning recruiter's own company name is stamped on every synced job.

import { db } from '@/lib/db'
import { parseAiInterviewConfig } from '@/lib/ai-interview-config'
import type { AtsInboundJob, AtsSyncResult } from '@/lib/types'
import type { Job } from '@prisma/client'

const MAX_JOBS_PER_SYNC = 50
const WEBHOOK_TIMEOUT_MS = 8_000

/** Whitelist of accepted work modes (maps the ATS `locationType` field). */
function normalizeWorkMode(value: unknown): string {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (v === 'remote' || v === 'work from home' || v === 'wfh') return 'Remote'
  if (v === 'hybrid') return 'Hybrid'
  return 'On-site'
}

/** skills arrives as a comma string OR an array — normalize to the Job.skills format. */
function normalizeSkills(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean).join(', ')
  }
  if (typeof value === 'string') return value.trim()
  return ''
}

/** Parse "12-18 LPA" / "12 to 18" / "₹18" style ranges into {min, max} LPA numbers. */
export function parseSalaryRange(value: unknown): { min: number; max: number } | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return { min: value, max: value }
  }
  if (typeof value !== 'string') return null
  const nums = value
    .replace(/,/g, ' ')
    .match(/\d+(\.\d+)?/g)
    ?.map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 500)
    .slice(0, 2)
  if (!nums || nums.length === 0) return null
  if (nums.length === 1) return { min: nums[0], max: nums[0] }
  const [a, b] = nums
  return a <= b ? { min: a, max: b } : { min: b, max: a }
}

/**
 * Anti-spam validation: a synced job MUST have a usable human title.
 * Email-shaped junk (e.g. "jobs@spam.example/apply-now") is rejected.
 */
function validateJobTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const title = raw.trim().replace(/\s+/g, ' ').slice(0, 200)
  if (!title) return null
  // email-shaped junk: something@domain
  if (/@/.test(title) || /^[^\s]+@[^\s]+\.[^\s]+$/.test(title)) return null
  return title
}

export interface UpsertContext {
  recruiterId: string
  /** recruiter's verified company name — payload company values are ignored */
  company: string
}

/**
 * Upsert a batch of inbound ATS jobs for one recruiter.
 * Match priority: Job.atsJobId (scoped to recruiter) → Job.title + Job.company.
 * Every created/updated row gets status ACTIVE + the external atsJobId stamp.
 */
export async function upsertAtsJobs(
  ctx: UpsertContext,
  inbound: AtsInboundJob[]
): Promise<AtsSyncResult> {
  const result: AtsSyncResult = {
    created: 0,
    updated: 0,
    total: 0,
    skipped: 0,
    source: 'webhook',
    jobs: [],
  }

  const batch = inbound.slice(0, MAX_JOBS_PER_SYNC)

  for (const raw of batch) {
    const title = validateJobTitle(raw?.title)
    if (!title) {
      result.skipped++
      continue
    }

    const salary = parseSalaryRange(raw?.salaryRange)
    const description =
      typeof raw?.description === 'string' && raw.description.trim()
        ? raw.description.trim().slice(0, 8000)
        : ''
    const location =
      typeof raw?.location === 'string' && raw.location.trim()
        ? raw.location.trim().slice(0, 200)
        : 'Not specified'

    // Optional AI-screening draft config riding on the job row
    let aiEnabled = false
    let aiConfigJson: string | undefined
    if (raw?.draft && typeof raw.draft === 'object') {
      const parsed = parseAiInterviewConfig(raw.draft)
      if (parsed.ok && parsed.config && parsed.config.questions.length > 0) {
        aiEnabled = true
        aiConfigJson = JSON.stringify(parsed.config)
      }
    }

    const baseData = {
      description: description || 'Imported from the company ATS.',
      jdText: description || undefined,
      location,
      workMode: normalizeWorkMode(raw?.locationType),
      skills: normalizeSkills(raw?.skills),
      status: 'ACTIVE' as const,
      salaryMinLpa: salary?.min,
      salaryMaxLpa: salary?.max,
      ...(aiConfigJson
        ? { aiInterviewEnabled: true, aiInterviewConfig: aiConfigJson }
        : {}),
    }

    // ---- Match 1: external ATS id (scoped to this recruiter) ----
    let existing: Job | null = null
    const atsJobId =
      typeof raw?.atsJobId === 'string' && raw.atsJobId.trim()
        ? raw.atsJobId.trim().slice(0, 120)
        : null
    if (atsJobId) {
      existing = await db.job.findFirst({
        where: { recruiterId: ctx.recruiterId, atsJobId },
      })
    }

    // ---- Match 2: title + company within this recruiter's board ----
    if (!existing) {
      existing = await db.job.findFirst({
        where: { recruiterId: ctx.recruiterId, title, company: ctx.company },
      })
    }

    if (existing) {
      const updated = await db.job.update({
        where: { id: existing.id },
        data: { ...baseData, atsJobId: atsJobId ?? existing.atsJobId },
      })
      result.updated++
      result.jobs.push({ id: updated.id, title: updated.title, atsJobId: updated.atsJobId, outcome: 'updated' })
    } else {
      const created = await db.job.create({
        data: {
          title,
          company: ctx.company,
          recruiterId: ctx.recruiterId,
          jobType: 'Full-time',
          openings: 1,
          experienceMin: 0,
          experienceMax: 5,
          atsJobId,
          ...baseData,
        },
      })
      result.created++
      result.jobs.push({ id: created.id, title: created.title, atsJobId: created.atsJobId, outcome: 'created' })
    }
  }

  result.total = result.created + result.updated
  return result
}

/* ------------------------------------------------------------------ */
/* Pull mode: fetch real jobs from the ATS webhook URL                  */
/* ------------------------------------------------------------------ */

/**
 * GET the integration's webhookUrl and extract a { jobs: [...] } payload.
 * Returns null on ANY failure (unreachable, non-JSON, no jobs key) so callers
 * can fall back to the demo batch — the sync must never dead-end.
 */
export async function fetchJobsFromWebhook(
  webhookUrl: string,
  apiKey: string | null
): Promise<AtsInboundJob[] | null> {
  try {
    const res = await fetch(webhookUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SeeWe-ATS-Sync/1.0',
        ...(apiKey ? { 'x-ats-api-key': apiKey } : {}),
      },
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const ct = res.headers.get('content-type') ?? ''
    if (!ct.includes('json')) return null
    const json = (await res.json()) as { jobs?: unknown } | null
    if (!json || !Array.isArray(json.jobs)) return null
    return json.jobs as AtsInboundJob[]
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Demo mode: realistic 3-job batch shaped by the integration's atsType  */
/* ------------------------------------------------------------------ */

interface DemoTemplate {
  title: string
  department: string
  location: string
  locationType: string
  salaryRange: string
  skills: string[]
  description: string
}

const DEMO_TEMPLATES: DemoTemplate[] = [
  {
    title: 'Senior Backend Engineer',
    department: 'Engineering',
    location: 'Bengaluru, India',
    locationType: 'Hybrid',
    salaryRange: '22-32 LPA',
    skills: ['Node.js', 'TypeScript', 'PostgreSQL', 'System Design', 'AWS', 'Microservices'],
    description:
      'Own core services end to end: design resilient APIs, tune PostgreSQL data models and mentor mid-level engineers. You will join a platform squad shipping to production daily, with real ownership of latency, reliability and cost budgets. Strong REST/queueing fundamentals and cloud (AWS) exposure expected.',
  },
  {
    title: 'Product Designer',
    department: 'Design',
    location: 'Remote (India)',
    locationType: 'Remote',
    salaryRange: '14-22 LPA',
    skills: ['Figma', 'Design Systems', 'User Research', 'Prototyping', 'Accessibility'],
    description:
      'Shape product flows from discovery to high-fidelity handoff. You will run lightweight user research, maintain the design system and pair with engineers on polished, accessible interfaces. A portfolio demonstrating shipped B2C or B2B work is required.',
  },
  {
    title: 'Data Analyst II',
    department: 'Analytics',
    location: 'Pune, India',
    locationType: 'On-site',
    salaryRange: '10-16 LPA',
    skills: ['SQL', 'Python', 'Dashboards', 'Statistics', 'Stakeholder Communication'],
    description:
      'Turn product and funnel data into decisions: build dashboards, write advanced SQL, partner with growth and ops stakeholders on weekly metric reviews. Comfort with Python notebooks and one BI stack expected; curiosity for experimentation analysis a plus.',
  },
]

/**
 * Demo batch generator — 3 realistic jobs. Titles/locations stay stable per
 * integration so repeated syncs UPDATE instead of duplicating; the atsType
 * flavours the departments and the external ids.
 */
export function buildDemoJobs(atsType: string, company: string): AtsInboundJob[] {
  const type = (atsType || 'CUSTOM').toUpperCase()
  return DEMO_TEMPLATES.map((t, i) => ({
    atsJobId: `seewee-demo-${type.toLowerCase()}-${i + 1}`,
    title: t.title,
    department: t.department,
    location: t.location,
    locationType: t.locationType,
    description: `${company} · ${t.department} — synced from the company ATS.\n\n${t.description}`,
    salaryRange: t.salaryRange,
    skills: t.skills,
  }))
}
