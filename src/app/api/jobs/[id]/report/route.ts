// SeeWe - POST /api/jobs/[id]/report
//
// Master spec §8 — REPORT SUSPICIOUS JOB. Any signed-in user can flag a listing
// (fake job, spam, expired, fee asked, discriminatory, other). Moderators
// (admin, task 4-c) read the queue; the reported job itself is untouched here.
//
// body: { reason, details?, reporterEmail? }
//   reason ∈ FAKE_JOB | SPAM | EXPIRED | FEE_ASKED | DISCRIMINATORY | OTHER
// reporterEmail is optional (anonymous reports allowed); when the SPA has a
// logged-in user it sends reporterId and we stamp their account email.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const REPORT_REASONS = ['FAKE_JOB', 'SPAM', 'EXPIRED', 'FEE_ASKED', 'DISCRIMINATORY', 'OTHER'] as const

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)

    const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
    if (!REPORT_REASONS.includes(reason as (typeof REPORT_REASONS)[number])) {
      return NextResponse.json(
        { error: `reason must be one of: ${REPORT_REASONS.join(', ')}` },
        { status: 400 }
      )
    }

    const details =
      typeof body?.details === 'string' && body.details.trim()
        ? body.details.trim().slice(0, 1000)
        : null

    const job = await db.job.findUnique({ where: { id }, select: { id: true } })
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Optional reporter identity — any logged-in user may report; anonymous
    // (email-only) reports are accepted too.
    let reporterEmail =
      typeof body?.reporterEmail === 'string' && body.reporterEmail.trim()
        ? body.reporterEmail.trim()
        : null
    const reporterId =
      typeof body?.reporterId === 'string' && body.reporterId.trim()
        ? body.reporterId.trim()
        : null
    if (reporterId) {
      const reporter = await db.user.findUnique({
        where: { id: reporterId },
        select: { email: true },
      })
      if (reporter) reporterEmail = reporter.email
    }

    const report = await db.jobReport.create({
      data: {
        jobId: id,
        reason,
        details,
        reporterEmail,
      },
      select: { id: true },
    })

    return NextResponse.json({ data: { id: report.id } }, { status: 201 })
  } catch (err) {
    console.error('POST /api/jobs/[id]/report failed:', err)
    return NextResponse.json({ error: 'Failed to submit report' }, { status: 500 })
  }
}
