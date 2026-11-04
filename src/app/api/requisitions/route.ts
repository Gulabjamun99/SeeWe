import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Job Requisition & Approval workflow (in-house workforce planning).
 *
 * A recruiter raises a headcount request (requisition) inside their own
 * company workspace (Client). Company leadership signs in through the client
 * partner portal and approves/rejects it; only APPROVED requisitions can be
 * published as live jobs. Candidates never see any of this.
 */

const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship']
const WORK_MODES = ['On-site', 'Hybrid', 'Remote']

const REQUISITION_INCLUDE = {
  requestedBy: { select: { id: true, name: true, email: true } },
  client: { select: { id: true, name: true } },
} as const

/** Attach the published job (if any) without a schema relation on JobRequisition. */
async function attachPublishedJobs<T extends { publishedJobId: string | null }>(
  requisitions: T[]
): Promise<Array<T & { publishedJob: { id: string; title: string; status: string } | null }>> {
  const jobIds = requisitions
    .map((r) => r.publishedJobId)
    .filter((id): id is string => !!id)
  const jobs = jobIds.length
    ? await db.job.findMany({
        where: { id: { in: jobIds } },
        select: { id: true, title: true, status: true },
      })
    : []
  const byId = new Map(jobs.map((j) => [j.id, j]))
  return requisitions.map((r) => ({
    ...r,
    publishedJob: r.publishedJobId ? byId.get(r.publishedJobId) ?? null : null,
  }))
}

// GET /api/requisitions?userId=...
// RECRUITER → their own company's requisitions; CLIENT → the same workspace
// (leadership reviews them); ADMIN → 403 (requisitions are a company surface).
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'Query param userId is required' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, clientId: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (user.role === 'ADMIN') {
      return NextResponse.json(
        { error: 'Requisitions belong to company workspaces — admin access is not permitted' },
        { status: 403 }
      )
    }
    if (user.role !== 'RECRUITER' && user.role !== 'CLIENT') {
      return NextResponse.json(
        { error: 'Only recruiter and client partner accounts can view requisitions' },
        { status: 403 }
      )
    }
    if (!user.clientId) {
      return NextResponse.json(
        { error: 'Your account is not linked to a company workspace' },
        { status: 400 }
      )
    }

    const requisitions = await attachPublishedJobs(
      await db.jobRequisition.findMany({
        where: { clientId: user.clientId },
        orderBy: { createdAt: 'desc' },
        take: 200,
        include: REQUISITION_INCLUDE,
      })
    )

    return NextResponse.json({ data: requisitions })
  } catch (err) {
    console.error('GET /api/requisitions failed:', err)
    return NextResponse.json({ error: 'Failed to fetch requisitions' }, { status: 500 })
  }
}

// POST /api/requisitions — recruiter raises a headcount request
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, clientId: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (user.role !== 'RECRUITER') {
      return NextResponse.json(
        { error: 'Only recruiters can raise requisitions' },
        { status: 403 }
      )
    }
    if (!user.clientId) {
      return NextResponse.json(
        { error: 'Your account is not linked to a company workspace' },
        { status: 400 }
      )
    }

    // ---- field validation ----
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
    const num = (v: unknown): number | undefined => {
      if (v === undefined || v === null || v === '') return undefined
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }

    const title = str(body.title)
    const location = str(body.location)
    const skills = str(body.skills)
    const department = str(body.department) || null
    const justification = str(body.justification) || null

    if (!title) {
      return NextResponse.json({ error: 'Role title is required' }, { status: 400 })
    }
    if (!location) {
      return NextResponse.json({ error: 'Location is required' }, { status: 400 })
    }
    if (!skills) {
      return NextResponse.json({ error: 'Add at least one skill' }, { status: 400 })
    }

    const jobType = body.jobType === undefined || body.jobType === '' ? 'Full-time' : str(body.jobType)
    const workMode = body.workMode === undefined || body.workMode === '' ? 'On-site' : str(body.workMode)
    if (!JOB_TYPES.includes(jobType)) {
      return NextResponse.json(
        { error: `jobType must be one of: ${JOB_TYPES.join(', ')}` },
        { status: 400 }
      )
    }
    if (!WORK_MODES.includes(workMode)) {
      return NextResponse.json(
        { error: `workMode must be one of: ${WORK_MODES.join(', ')}` },
        { status: 400 }
      )
    }

    const experienceMin = num(body.experienceMin) ?? 0
    const experienceMax = num(body.experienceMax) ?? 5
    if (experienceMin < 0) {
      return NextResponse.json({ error: 'experienceMin cannot be negative' }, { status: 400 })
    }
    if (experienceMax < experienceMin) {
      return NextResponse.json({ error: 'experienceMax must be ≥ experienceMin' }, { status: 400 })
    }

    const salaryMinLpa = num(body.salaryMinLpa)
    const salaryMaxLpa = num(body.salaryMaxLpa)
    if (salaryMinLpa !== undefined && salaryMinLpa <= 0) {
      return NextResponse.json({ error: 'salaryMinLpa must be a positive LPA figure' }, { status: 400 })
    }
    if (salaryMinLpa !== undefined && salaryMaxLpa !== undefined && salaryMaxLpa < salaryMinLpa) {
      return NextResponse.json({ error: 'salaryMaxLpa must be ≥ salaryMinLpa' }, { status: 400 })
    }

    const openings = num(body.openings) ?? 1
    if (openings < 1) {
      return NextResponse.json({ error: 'At least 1 opening is required' }, { status: 400 })
    }

    // Budget confirmation is mandatory — leadership should only review
    // requests the recruiter has already validated against the manpower budget.
    if (body.budgetConfirmed !== true) {
      return NextResponse.json(
        {
          error:
            'Budget confirmation required — tick “I confirm the manpower budget for this role is validated” before sending this requisition for approval',
        },
        { status: 400 }
      )
    }

    const created = await db.jobRequisition.create({
      data: {
        clientId: user.clientId,
        requestedById: user.id,
        title,
        department,
        location,
        jobType,
        workMode,
        experienceMin,
        experienceMax,
        salaryMinLpa: salaryMinLpa ?? null,
        salaryMaxLpa: salaryMaxLpa ?? null,
        openings: Math.round(openings),
        skills,
        justification,
        budgetConfirmed: true,
        status: 'PENDING_APPROVAL',
      },
      include: REQUISITION_INCLUDE,
    })

    return NextResponse.json({ data: created }, { status: 201 })
  } catch (err) {
    console.error('POST /api/requisitions failed:', err)
    return NextResponse.json({ error: 'Failed to create requisition' }, { status: 500 })
  }
}
