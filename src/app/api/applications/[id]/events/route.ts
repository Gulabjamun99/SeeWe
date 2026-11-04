// SeeWe - GET /api/applications/[id]/events
// Master spec §10 — application stage-history timeline.
//
// Access model (mirrors the app's explicit-viewer pattern):
//   ?viewerId=<userId> identifies the caller. Allowed:
//   • the job's own RECRUITER → FULL trail (every event type, incl. AI_SCREEN,
//     ATS_PUSH and recruiter-private NOTE rows)
//   • ADMIN → FULL trail (audit use)
//   • the application's own CANDIDATE → FILTERED trail: only STATUS_CHANGE and
//     OFFER events, with neutral labels. NEVER AI_SCREEN / ATS_PUSH /
//     AI_INVITE / NOTE / CLIENT_DECISION rows (recruiter-side AI notes/scores
//     stay recruiter-only — permanent rule).
//   Anyone else → 403.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Event types a CANDIDATE may see on their own application's timeline. */
const CANDIDATE_VISIBLE_TYPES = ['STATUS_CHANGE', 'OFFER'] as const

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const application = await db.application.findUnique({
      where: { id },
      select: {
        id: true,
        candidateId: true,
        job: { select: { recruiterId: true } },
      },
    })
    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    const viewerId = req.nextUrl.searchParams.get('viewerId')?.trim() ?? ''
    if (!viewerId) {
      return NextResponse.json(
        { error: 'viewerId is required' },
        { status: 400 }
      )
    }

    const viewer = await db.user.findUnique({
      where: { id: viewerId },
      select: { id: true, role: true },
    })
    if (!viewer) {
      return NextResponse.json({ error: 'Unknown viewer' }, { status: 403 })
    }

    const isJobRecruiter =
      viewer.role === 'RECRUITER' && viewer.id === application.job.recruiterId
    const isAdmin = viewer.role === 'ADMIN'
    const isOwnCandidate =
      viewer.role === 'CANDIDATE' && viewer.id === application.candidateId

    if (!isJobRecruiter && !isAdmin && !isOwnCandidate) {
      return NextResponse.json(
        { error: 'You do not have access to this timeline' },
        { status: 403 }
      )
    }

    // Recruiter/admin: everything. Candidate: only neutral pipeline rows.
    const events = await db.applicationEvent.findMany({
      where: isOwnCandidate
        ? { applicationId: id, type: { in: [...CANDIDATE_VISIBLE_TYPES] } }
        : { applicationId: id },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        type: true,
        fromStatus: true,
        toStatus: true,
        actorRole: true,
        actorName: true,
        note: true,
        createdAt: true,
      },
    })

    return NextResponse.json({
      data: events,
      scope: isOwnCandidate ? 'CANDIDATE' : 'FULL',
    })
  } catch (err) {
    console.error('GET /api/applications/[id]/events failed:', err)
    return NextResponse.json(
      { error: 'Failed to load application history' },
      { status: 500 }
    )
  }
}
