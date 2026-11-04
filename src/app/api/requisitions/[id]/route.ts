import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'

/**
 * Job Requisition & Approval workflow — decision endpoint.
 *
 * PUBLISH  (recruiter, own company, requisition must be APPROVED):
 *          turns the requisition into a live Job (JD assembled from the
 *          approved request) and marks it PUBLISHED.
 * APPROVE / REJECT (client partner of the same company, requisition must be
 *          PENDING_APPROVAL): leadership sign-off, with a mandatory note on
 *          rejection.
 */

/** Assemble a professional, readable JD from the approved requisition. */
function buildJd(r: {
  title: string
  department: string | null
  location: string
  jobType: string
  workMode: string
  experienceMin: number
  experienceMax: number
  salaryMinLpa: number | null
  salaryMaxLpa: number | null
  openings: number
  skills: string
  justification: string | null
}, companyName: string): string {
  const skills = r.skills
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const band =
    r.salaryMinLpa != null && r.salaryMaxLpa != null
      ? `₹${r.salaryMinLpa} – ₹${r.salaryMaxLpa} LPA (final offer within the approved band, based on experience)`
      : r.salaryMinLpa != null
        ? `₹${r.salaryMinLpa}+ LPA, based on experience`
        : r.salaryMaxLpa != null
          ? `up to ₹${r.salaryMaxLpa} LPA, based on experience`
          : 'competitive, based on experience'

  const lines: string[] = []

  lines.push(`About the role`)
  lines.push(
    `${companyName} is looking for a ${r.title} to join ${r.department ? `our ${r.department} team` : 'our team'} in ${r.location} (${r.workMode}, ${r.jobType}). This approved headcount plan covers ${r.openings} opening${r.openings === 1 ? '' : 's'}, and you will work closely with experienced engineers and stakeholders from day one.`
  )
  lines.push('')
  lines.push(`Why this role is open`)
  if (r.justification) {
    lines.push(r.justification)
  } else {
    lines.push(
      `The ${r.department ?? 'company'} team is growing and this position strengthens our delivery capacity for upcoming programmes.`
    )
  }
  lines.push('')
  lines.push(`What we are looking for`)
  lines.push(`• ${r.experienceMin}–${r.experienceMax} years of relevant professional experience`)
  if (skills.length > 0) {
    lines.push(`• Hands-on, day-to-day strength in: ${skills.join(', ')}`)
  }
  lines.push(`• Clear written and spoken communication, and comfort working in a collaborative team`)
  lines.push('')
  lines.push(`Compensation & work setup`)
  lines.push(`• Salary band: ${band}`)
  lines.push(`• Work mode: ${r.workMode} · Employment type: ${r.jobType} · Location: ${r.location}`)
  lines.push('')
  lines.push(`Hiring process`)
  lines.push(
    `Shortlisted applicants complete a structured interview with a skills-focused evaluation. You will receive a status update at every stage, and feedback is shared after each round.`
  )

  return lines.join('\n')
}

const REQUISITION_INCLUDE = {
  requestedBy: { select: { id: true, name: true, email: true } },
  client: { select: { id: true, name: true } },
} as const

/** Fetch the published job for a requisition (no schema relation on JobRequisition). */
async function publishedJobFor(jobId: string | null) {
  if (!jobId) return null
  return db.job.findUnique({
    where: { id: jobId },
    select: { id: true, title: true, status: true },
  })
}

// PATCH /api/requisitions/[id] — { userId, action: PUBLISH | APPROVE | REJECT, note? }
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const action = typeof body.action === 'string' ? body.action.trim().toUpperCase() : ''
    const note = typeof body.note === 'string' ? body.note.trim() : ''

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    if (!['PUBLISH', 'APPROVE', 'REJECT'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be PUBLISH, APPROVE or REJECT' },
        { status: 400 }
      )
    }

    const [user, requisition] = await Promise.all([
      db.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, role: true, clientId: true },
      }),
      db.jobRequisition.findUnique({
        where: { id },
        include: {
          client: { select: { id: true, name: true } },
          requestedBy: { select: { id: true, name: true } },
        },
      }),
    ])

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (!requisition) {
      return NextResponse.json({ error: 'Requisition not found' }, { status: 404 })
    }

    // ---------- leadership decision (client partner) ----------
    if (action === 'APPROVE' || action === 'REJECT') {
      if (user.role !== 'CLIENT') {
        return NextResponse.json(
          { error: 'Only client partners (company leadership) can approve or reject requisitions' },
          { status: 403 }
        )
      }
      if (user.clientId !== requisition.clientId) {
        return NextResponse.json(
          { error: 'This requisition belongs to a different company workspace' },
          { status: 403 }
        )
      }
      if (requisition.status !== 'PENDING_APPROVAL') {
        return NextResponse.json(
          { error: `Only requisitions pending approval can be decided — this one is already ${requisition.status}` },
          { status: 400 }
        )
      }
      if (action === 'REJECT' && !note) {
        return NextResponse.json(
          { error: 'A note is required when rejecting a requisition — tell the recruiter why' },
          { status: 400 }
        )
      }

      const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
      const updated = await db.jobRequisition.update({
        where: { id: requisition.id },
        data: {
          status,
          approverName: user.name,
          approverNote: note || null,
          decidedAt: new Date(),
        },
        include: REQUISITION_INCLUDE,
      })

      await notify({
        userId: requisition.requestedById,
        type: 'REQUISITION',
        title: `Requisition ${action === 'APPROVE' ? 'approved' : 'rejected'} · ${requisition.title}`,
        body:
          action === 'APPROVE'
            ? `${user.name} approved your headcount request. You can now publish it as a job.`
            : `${user.name} rejected your headcount request. Note: ${note}`,
        meta: {
          requisitionId: requisition.id,
          decision: status,
          approverName: user.name,
        },
      })

      return NextResponse.json({
        data: { ...updated, publishedJob: await publishedJobFor(updated.publishedJobId) },
      })
    }

    // ---------- publish as a live job (recruiter) ----------
    if (user.role !== 'RECRUITER') {
      return NextResponse.json(
        { error: 'Only recruiters can publish a requisition as a job' },
        { status: 403 }
      )
    }
    if (user.clientId !== requisition.clientId) {
      return NextResponse.json(
        { error: 'This requisition belongs to a different company workspace' },
        { status: 403 }
      )
    }
    if (requisition.status === 'PENDING_APPROVAL') {
      return NextResponse.json(
        { error: 'This requisition is still awaiting leadership approval — publish becomes available once it is approved' },
        { status: 400 }
      )
    }
    if (requisition.status !== 'APPROVED') {
      return NextResponse.json(
        { error: `Only approved requisitions can be published — this one is ${requisition.status}` },
        { status: 400 }
      )
    }

    const description = buildJd(requisition, requisition.client.name)

    const result = await db.$transaction(async (tx) => {
      const job = await tx.job.create({
        data: {
          title: requisition.title,
          company: requisition.client.name,
          recruiterId: requisition.requestedById,
          description,
          location: requisition.location,
          jobType: requisition.jobType,
          workMode: requisition.workMode,
          experienceMin: requisition.experienceMin,
          experienceMax: requisition.experienceMax,
          salaryMinLpa: requisition.salaryMinLpa,
          salaryMaxLpa: requisition.salaryMaxLpa,
          skills: requisition.skills,
          openings: requisition.openings,
          status: 'ACTIVE',
          jdText: description,
        },
      })

      const updated = await tx.jobRequisition.update({
        where: { id: requisition.id },
        data: {
          status: 'PUBLISHED',
          publishedJobId: job.id,
        },
      })

      return { job, updated }
    })

    await notify({
      userId: requisition.requestedById,
      type: 'REQUISITION',
      title: `Requisition published · ${requisition.title}`,
      body: `Live job posted for ${requisition.title} — candidates can start applying.`,
      meta: {
        requisitionId: requisition.id,
        jobId: result.job.id,
      },
    })

    return NextResponse.json({
      data: {
        ...result.updated,
        publishedJob: { id: result.job.id, title: result.job.title, status: result.job.status },
      },
    })
  } catch (err) {
    console.error('PATCH /api/requisitions/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to update requisition' }, { status: 500 })
  }
}
