// SeeWe - POST /api/share
// Shares a completed AI interview report with a client.
// Accepts either shortlistId or applicationId, resolves/creates the shortlist,
// attaches the client and flips pipeline statuses.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { notifyMany } from '@/lib/notify'
import { logApplicationEvent } from '@/lib/application-events'

const SHORTLIST_INCLUDE = {
  client: true,
  application: { include: { candidate: true, job: true } },
  interview: true,
} satisfies Prisma.ShortlistInclude

type ShortlistRow = Prisma.ShortlistGetPayload<{ include: typeof SHORTLIST_INCLUDE }>

async function loadShortlist(id: string): Promise<ShortlistRow | null> {
  return db.shortlist.findUnique({
    where: { id },
    include: SHORTLIST_INCLUDE,
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))

    const shortlistIdInput =
      typeof body?.shortlistId === 'string' ? body.shortlistId.trim() : ''
    const applicationIdInput =
      typeof body?.applicationId === 'string' ? body.applicationId.trim() : ''
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''

    if (!shortlistIdInput && !applicationIdInput) {
      return NextResponse.json(
        { error: 'shortlistId or applicationId is required' },
        { status: 400 }
      )
    }
    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 })
    }

    // Resolve client
    const client = await db.client.findUnique({ where: { id: clientId } })
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Resolve shortlist (by id or by application)
    let shortlist: ShortlistRow | null = null
    if (shortlistIdInput) {
      shortlist = await loadShortlist(shortlistIdInput)
    }
    if (!shortlist && applicationIdInput) {
      const app = await db.application.findUnique({
        where: { id: applicationIdInput },
        include: { shortlists: { orderBy: { createdAt: 'desc' as const }, take: 1 }, job: true },
      })
      if (!app) {
        return NextResponse.json({ error: 'Application not found' }, { status: 404 })
      }
      if (app.shortlists.length > 0) {
        shortlist = await loadShortlist(app.shortlists[0].id)
      }
      // AI screening DISABLED on this job → the pipeline skips the AI round
      // entirely. Auto-create the shortlist anchor so the profile/screen
      // dossier can be shared without any interview (the interview guard
      // below is bypassed for these jobs).
      if (!shortlist && !app.job.aiInterviewEnabled) {
        await db.shortlist.create({
          data: { applicationId: app.id, status: 'PENDING_INTERVIEW' },
        })
        shortlist = await db.shortlist.findFirst({
          where: { applicationId: app.id },
          include: SHORTLIST_INCLUDE,
        })
      }
      // NOTE for AI-enabled jobs: no auto-create here. An interview hangs off a
      // shortlist, so an application with no shortlist can NEVER have a
      // completed interview — creating a placeholder row before the guard
      // below used to leak an orphan COMPLETED shortlist on every premature
      // share attempt.
    }

    if (!shortlist || !shortlist.application) {
      return NextResponse.json(
        {
          error:
            'No pipeline record yet — shortlist the candidate and finish the AI interview before sharing.',
        },
        { status: 409 }
      )
    }

    // Guardrail: AI-enabled jobs may only be shared once the interview has
    // completed. Jobs with AI screening DISABLED skip the AI round entirely —
    // the recruiter's screen dossier / profile is what gets shared.
    const aiEnabled = shortlist.application.job?.aiInterviewEnabled === true
    if (aiEnabled && (!shortlist.interview || shortlist.interview.status !== 'COMPLETED')) {
      return NextResponse.json(
        {
          error:
            'AI interview is not completed yet — finish the interview before sharing the report.',
        },
        { status: 409 }
      )
    }

    // Update share state
    const [updatedShortlist] = await db.$transaction([
      db.shortlist.update({
        where: { id: shortlist.id },
        data: { clientId, status: 'REPORT_SHARED' },
        include: { client: true },
      }),
      db.application.update({
        where: { id: shortlist.applicationId },
        data: { status: 'SHARED_WITH_CLIENT' },
      }),
      // §10 audit trail: report shared with the client — atomic with the mutation.
      db.applicationEvent.create({
        data: {
          applicationId: shortlist.applicationId,
          type: 'SHARED_WITH_CLIENT',
          fromStatus: shortlist.application.status,
          toStatus: 'SHARED_WITH_CLIENT',
          actorRole: 'RECRUITER',
          note:
            shortlist.interview?.status === 'COMPLETED'
              ? `AI interview report shared with ${client.name}`
              : `Candidate profile shared with ${client.name}`,
        },
      }),
    ])

    // 🔔 Tell every portal user of this client that a fresh report landed (non-fatal)
    const clientUsers = await db.user.findMany({
      where: { clientId, role: 'CLIENT' },
      select: { id: true },
      take: 20,
    })
    const candidateName = shortlist.application.candidate?.name ?? 'A candidate'
    const jobTitle = shortlist.application.job?.title ?? 'a role'
    const hasReport = shortlist.interview?.status === 'COMPLETED'
    await notifyMany(
      clientUsers.map((u) => ({
        userId: u.id,
        type: 'REPORT_SHARED' as const,
        title: hasReport
          ? `🧾 New AI report · ${candidateName} · ${jobTitle}`
          : `🧾 New candidate profile · ${candidateName} · ${jobTitle}`,
        body: hasReport
          ? `The hiring team shared a completed AI interview report for the ${jobTitle} role. Review and send your verdict.`
          : `The hiring team shared a candidate profile for the ${jobTitle} role (this position skips the AI interview round). Review and send your verdict.`,
        meta: {
          shortlistId: updatedShortlist.id,
          applicationId: shortlist.applicationId,
          candidateName,
          jobTitle,
          clientName: client.name,
          hasReport,
        },
      }))
    )

    return NextResponse.json({
      data: {
        ok: true,
        shortlist: updatedShortlist,
        clientName: client.name,
      },
    })
  } catch (error) {
    console.error('[share] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Failed to share report' },
      { status: 500 }
    )
  }
}
