import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { parseAiInterviewConfig } from '@/lib/ai-interview-config'
import { applyCompanyBranding } from '@/lib/company-branding'

// Branding fields surfaced with every listing (candidate-facing)
const RECRUITER_BRANDING_SELECT = {
  companyAbout: true,
  companyWebsite: true,
  companyLogoData: true,
  companyLogoMime: true,
  brandColor: true,
} as const

const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship']
const WORK_MODES = ['On-site', 'Remote', 'Hybrid']

// Parse a numeric query param; undefined when absent/invalid
function numParam(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

// GET /api/jobs - search & list jobs (recruiter view returns all own statuses)
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const keyword = (sp.get('keyword') || '').trim()
    const location = (sp.get('location') || '').trim()
    const jobType = sp.get('jobType') || ''
    const workMode = sp.get('workMode') || ''
    const recruiterId = sp.get('recruiterId') || ''
    const minExperience = numParam(sp.get('minExperience'))
    const maxExperience = numParam(sp.get('maxExperience'))
    const minSalaryLpa = numParam(sp.get('minSalaryLpa'))
    // postedWithin: freshness filter in days (7/15/30) — jobs created since then only
    const postedWithin = numParam(sp.get('postedWithin'))
    const sort = sp.get('sort') || 'recent' // recent | salary_desc | salary_asc
    const page = Math.max(1, numParam(sp.get('page')) ?? 1)
    const limit = Math.min(100, Math.max(1, numParam(sp.get('limit')) ?? 20))

    // Recruiters see all statuses of their own jobs; public sees ACTIVE only
    const where: Prisma.JobWhereInput = recruiterId
      ? { recruiterId }
      : { status: 'ACTIVE' }

    // SQLite has no case-insensitive mode -> fetch a bounded set and filter in JS
    const fetched = await db.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        _count: { select: { applications: true } },
        recruiter: {
          select: {
            id: true,
            name: true,
            company: true,
            avatarSeed: true,
            ...RECRUITER_BRANDING_SELECT,
          },
        },
      },
    })

    const kw = keyword.toLowerCase()
    const loc = location.toLowerCase()
    // Freshness cutoff — only meaningful when postedWithin is a positive number
    const postedCutoff =
      postedWithin !== undefined && postedWithin > 0
        ? new Date(Date.now() - postedWithin * 24 * 60 * 60 * 1000)
        : null

    const filtered = fetched.filter((job) => {
      if (postedCutoff && new Date(job.createdAt) < postedCutoff) return false
      if (
        kw &&
        ![job.title, job.company, job.skills, job.description, job.location]
          .map((f) => (f || '').toLowerCase())
          .some((f) => f.includes(kw))
      ) {
        return false
      }
      if (loc && !(job.location || '').toLowerCase().includes(loc)) return false
      if (jobType && job.jobType !== jobType) return false
      if (workMode && job.workMode !== workMode) return false
      // Experience overlap: candidate [min,max] vs job [experienceMin, experienceMax]
      if (
        minExperience !== undefined &&
        !(minExperience <= job.experienceMax)
      ) {
        return false
      }
      if (
        maxExperience !== undefined &&
        !(job.experienceMin <= maxExperience)
      ) {
        return false
      }
      if (minSalaryLpa !== undefined && job.salaryMinLpa !== null && job.salaryMinLpa < minSalaryLpa) {
        return false
      }
      return true
    })

    const total = filtered.length

    // Sorting (recent = createdAt desc, already the query order). Jobs without
    // a salary always sink to the bottom of salary sorts.
    if (sort === 'salary_desc') {
      filtered.sort(
        (a, b) => (b.salaryMaxLpa ?? -1) - (a.salaryMaxLpa ?? -1)
      )
    } else if (sort === 'salary_asc') {
      filtered.sort(
        (a, b) =>
          (a.salaryMinLpa ?? Number.MAX_SAFE_INTEGER) -
          (b.salaryMinLpa ?? Number.MAX_SAFE_INTEGER)
      )
    }

    const start = (page - 1) * limit
    const jobs = filtered.slice(start, start + limit)

    return NextResponse.json({ data: { jobs, total, page, limit } })
  } catch (err) {
    console.error('GET /api/jobs failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    )
  }
}

// POST /api/jobs - create a job posting
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const {
      recruiterId,
      title,
      description,
      location,
      skills,
      company,
      jobType,
      workMode,
      experienceMin,
      experienceMax,
      salaryMinLpa,
      salaryMaxLpa,
      openings,
      jdText,
      aiInterviewEnabled,
      aiInterviewConfig,
      companyBranding,
    } = body as Record<string, unknown>

    // Required fields
    if (
      typeof title !== 'string' ||
      title.trim().length === 0 ||
      typeof description !== 'string' ||
      description.trim().length === 0 ||
      typeof location !== 'string' ||
      location.trim().length === 0 ||
      typeof skills !== 'string' ||
      skills.trim().length === 0
    ) {
      return NextResponse.json(
        { error: 'title, description, location and skills are required fields' },
        { status: 400 }
      )
    }

    // Quality gate (QA queue): reject spammy titles and email-shaped company
    // names so the public job feed never fills with junk rows like
    // "hr exe" @ "txrecruiter@gmail.com".
    const EMAIL_SHAPED = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const cleanTitle = title.trim()
    if (cleanTitle.length < 3 || /^(hr|job|test|aaa+|xyz+)$/i.test(cleanTitle)) {
      return NextResponse.json(
        { error: 'Give the job a meaningful title (min 3 characters, not a placeholder like "test" or "aaa")' },
        { status: 400 }
      )
    }
    if (typeof company === 'string' && company.trim()) {
      const cleanCompany = company.trim()
      if (EMAIL_SHAPED.test(cleanCompany)) {
        return NextResponse.json(
          { error: 'Company name cannot be an email address — use the organisation name (edit it on your profile if needed)' },
          { status: 400 }
        )
      }
      if (cleanCompany.length < 2) {
        return NextResponse.json(
          { error: 'Company name is too short' },
          { status: 400 }
        )
      }
    }

    // recruiterId must reference an existing RECRUITER
    let recruiter
    if (typeof recruiterId !== 'string' || recruiterId.trim().length === 0) {
      return NextResponse.json({ error: 'recruiterId is required' }, { status: 400 })
    }
    recruiter = await db.user.findUnique({ where: { id: recruiterId.trim() } })
    if (!recruiter || recruiter.role !== 'RECRUITER') {
      return NextResponse.json(
        { error: 'recruiterId must belong to an existing RECRUITER account' },
        { status: 400 }
      )
    }

    // Optional numeric field validation
    const nums: Array<[string, unknown]> = [
      ['experienceMin', experienceMin],
      ['experienceMax', experienceMax],
      ['salaryMinLpa', salaryMinLpa],
      ['salaryMaxLpa', salaryMaxLpa],
      ['openings', openings],
    ]
    for (const [field, value] of nums) {
      if (
        value !== undefined &&
        value !== null &&
        (typeof value !== 'number' || !Number.isFinite(value))
      ) {
        return NextResponse.json(
          { error: `Field '${field}' must be a number` },
          { status: 400 }
        )
      }
    }

    // Range sanity: keep nonsense ranges & abuse values out of the DB
    const expMin = typeof experienceMin === 'number' ? experienceMin : 0
    const expMax = typeof experienceMax === 'number' ? experienceMax : 5
    if (expMin < 0 || expMax < 0 || expMin > 50 || expMax > 50) {
      return NextResponse.json(
        { error: 'experience values must be between 0 and 50 years' },
        { status: 400 }
      )
    }
    if (expMin > expMax) {
      return NextResponse.json(
        { error: 'experienceMin cannot be greater than experienceMax' },
        { status: 400 }
      )
    }
    // Transparency policy (absolute): a published listing MUST show its pay
    // range upfront — both bounds present, positive, min ≤ max. No band, no
    // listing: the client form enforces this too, this is the server backstop.
    const salMinNum = typeof salaryMinLpa === 'number' ? salaryMinLpa : NaN
    const salMaxNum = typeof salaryMaxLpa === 'number' ? salaryMaxLpa : NaN
    if (
      !Number.isFinite(salMinNum) ||
      !Number.isFinite(salMaxNum) ||
      salMinNum <= 0 ||
      salMaxNum <= 0 ||
      salMinNum > salMaxNum
    ) {
      return NextResponse.json(
        { error: 'Salary range is required — listings must show pay upfront' },
        { status: 400 }
      )
    }
    for (const [label, v] of [
      ['salaryMinLpa', salaryMinLpa],
      ['salaryMaxLpa', salaryMaxLpa],
    ] as const) {
      if (typeof v === 'number' && (v < 0 || v > 500)) {
        return NextResponse.json(
          { error: `${label} must be between 0 and 500 LPA` },
          { status: 400 }
        )
      }
    }
    if (typeof jobType === 'string' && !JOB_TYPES.includes(jobType)) {
      return NextResponse.json(
        { error: `jobType must be one of: ${JOB_TYPES.join(', ')}` },
        { status: 400 }
      )
    }
    if (typeof workMode === 'string' && !WORK_MODES.includes(workMode)) {
      return NextResponse.json(
        { error: `workMode must be one of: ${WORK_MODES.join(', ')}` },
        { status: 400 }
      )
    }

    // ---- Company branding (optional; validated BEFORE the job row is created) ----
    const brandingResult = await applyCompanyBranding(recruiter.id, companyBranding)
    if (brandingResult.error) {
      return NextResponse.json({ error: brandingResult.error }, { status: 400 })
    }

    // ---- AI screening interview (OPTIONAL per job) ----
    // The recruiter opts in explicitly; the question set is theirs (the AI only
    // suggests). A job without this flag simply never runs an AI interview.
    const aiEnabled = aiInterviewEnabled === true
    let aiConfigJson: string | undefined
    if (aiInterviewEnabled !== undefined || aiInterviewConfig !== undefined) {
      const parsed = parseAiInterviewConfig(aiInterviewConfig)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      if (aiEnabled && (!parsed.config || parsed.config.questions.length === 0)) {
        return NextResponse.json(
          { error: 'AI screening is ON — add at least one interview question (or ask the AI to suggest from the JD).' },
          { status: 400 }
        )
      }
      if (aiEnabled && parsed.config) {
        aiConfigJson = JSON.stringify(parsed.config)
      }
    }

    const desc = description.trim()
    const job = await db.job.create({
      data: {
        title: title.trim(),
        description: desc,
        location: location.trim(),
        skills: skills.trim(),
        recruiterId: recruiter.id,
        // Auto-fill company from the recruiter's profile when omitted
        company:
          (typeof company === 'string' && company.trim()) || recruiter.company || recruiter.name,
        jdText: (typeof jdText === 'string' && jdText.trim()) || desc,
        jobType: (typeof jobType === 'string' && jobType) || 'Full-time',
        workMode: (typeof workMode === 'string' && workMode) || 'On-site',
        status: 'ACTIVE',
        experienceMin: typeof experienceMin === 'number' ? experienceMin : 0,
        experienceMax: typeof experienceMax === 'number' ? experienceMax : 5,
        salaryMinLpa: typeof salaryMinLpa === 'number' ? salaryMinLpa : undefined,
        salaryMaxLpa: typeof salaryMaxLpa === 'number' ? salaryMaxLpa : undefined,
        openings: typeof openings === 'number' && openings >= 1 ? Math.min(1000, Math.floor(openings)) : 1,
        aiInterviewEnabled: aiEnabled,
        ...(aiConfigJson ? { aiInterviewConfig: aiConfigJson } : {}),
      },
      include: {
        _count: { select: { applications: true } },
        recruiter: {
          select: {
            id: true,
            name: true,
            company: true,
            avatarSeed: true,
            ...RECRUITER_BRANDING_SELECT,
          },
        },
      },
    })

    return NextResponse.json({ data: job }, { status: 201 })
  } catch (err) {
    console.error('POST /api/jobs failed:', err)
    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    )
  }
}
