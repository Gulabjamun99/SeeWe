import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

// SeeWe — Admin moderation queue: PATCH /api/admin/job-reports/[reportId]
// Body: { adminId, status: 'REVIEWED'|'ACTIONED', adminNote?, closeJob? }
//
// closeJob: true also closes the reported Job (status = 'CLOSED') so it
// disappears from public browsing — the "act on it" path.

const ERROR_MISSING_ID = 'adminId is required in the request body'
const ERROR_FORBIDDEN = 'Admin access required'
const ERROR_BAD_STATUS = "status must be 'REVIEWED' or 'ACTIONED'"
const ERROR_SERVER = 'Failed to update job report'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> }
) {
  try {
    const { reportId } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const adminId = typeof body.adminId === 'string' ? body.adminId : ''
    const status = typeof body.status === 'string' ? body.status.trim().toUpperCase() : ''
    const adminNote =
      typeof body.adminNote === 'string' && body.adminNote.trim()
        ? body.adminNote.trim().slice(0, 1000)
        : undefined
    const closeJob = body.closeJob === true

    if (!adminId) {
      return NextResponse.json({ error: ERROR_MISSING_ID }, { status: 400 })
    }
    if (status !== 'REVIEWED' && status !== 'ACTIONED') {
      return NextResponse.json({ error: ERROR_BAD_STATUS }, { status: 400 })
    }

    const admin = await db.user.findUnique({
      where: { id: adminId },
      select: { id: true, role: true },
    })
    if (!admin) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    if (admin.role !== 'ADMIN') {
      return NextResponse.json({ error: ERROR_FORBIDDEN }, { status: 403 })
    }

    const report = await db.jobReport.findUnique({
      where: { id: reportId },
      select: { id: true, jobId: true, job: { select: { id: true, title: true, status: true } } },
    })
    if (!report) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    }

    const ops: Prisma.PrismaPromise<unknown>[] = [
      db.jobReport.update({
        where: { id: reportId },
        data: {
          status,
          ...(adminNote !== undefined ? { adminNote } : {}),
        },
        select: {
          id: true,
          reason: true,
          details: true,
          reporterEmail: true,
          status: true,
          adminNote: true,
          createdAt: true,
          job: { select: { id: true, title: true, company: true, status: true } },
        },
      }),
    ]
    // Close the reported job only when explicitly asked
    if (closeJob) {
      ops.push(db.job.update({ where: { id: report.jobId }, data: { status: 'CLOSED' } }))
    }
    await db.$transaction(ops)
    const updated = await db.jobReport.findUniqueOrThrow({
      where: { id: reportId },
      select: {
        id: true,
        reason: true,
        details: true,
        reporterEmail: true,
        status: true,
        adminNote: true,
        createdAt: true,
        job: { select: { id: true, title: true, company: true, status: true } },
      },
    })

    return NextResponse.json({ data: { ...updated, createdAt: updated.createdAt.toISOString() } })
  } catch (err) {
    console.error('PATCH /api/admin/job-reports/[reportId] failed:', err)
    return NextResponse.json({ error: ERROR_SERVER }, { status: 500 })
  }
}
