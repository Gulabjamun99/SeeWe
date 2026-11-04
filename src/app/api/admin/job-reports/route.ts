import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// SeeWe — Admin moderation queue: GET /api/admin/job-reports?status=
// status ∈ OPEN | REVIEWED | ACTIONED | ALL (default ALL).
//
// AUTH: same demo guard as /api/admin/stats — caller passes adminId, we
// verify role === 'ADMIN', otherwise 403.

const ERROR_MISSING_ID = 'Query param adminId is required'
const ERROR_FORBIDDEN = 'Admin access required'
const ERROR_BAD_STATUS = "status must be 'OPEN', 'REVIEWED', 'ACTIONED' or 'ALL'"
const ERROR_SERVER = 'Failed to load job reports'

const VALID_STATUSES = ['OPEN', 'REVIEWED', 'ACTIONED', 'ALL']

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const adminId = req.nextUrl.searchParams.get('adminId')
    if (!adminId || !adminId.trim()) {
      return NextResponse.json({ error: ERROR_MISSING_ID }, { status: 400 })
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

    const status = (req.nextUrl.searchParams.get('status') ?? 'ALL').trim().toUpperCase()
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: ERROR_BAD_STATUS }, { status: 400 })
    }

    const reports = await db.jobReport.findMany({
      where: status === 'ALL' ? undefined : { status },
      orderBy: { createdAt: 'desc' as const },
      take: 100,
      select: {
        id: true,
        reason: true,
        details: true,
        reporterEmail: true,
        status: true,
        adminNote: true,
        createdAt: true,
        job: {
          select: { id: true, title: true, company: true, status: true },
        },
      },
    })

    const counts = await db.jobReport.groupBy({ by: ['status'], _count: { _all: true } })
    const countByStatus: Record<string, number> = { OPEN: 0, REVIEWED: 0, ACTIONED: 0 }
    for (const row of counts) countByStatus[row.status] = row._count._all

    return NextResponse.json({
      data: {
        reports: reports.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        counts: { ...countByStatus, ALL: reports.length },
      },
    })
  } catch (err) {
    console.error('GET /api/admin/job-reports failed:', err)
    return NextResponse.json({ error: ERROR_SERVER }, { status: 500 })
  }
}
