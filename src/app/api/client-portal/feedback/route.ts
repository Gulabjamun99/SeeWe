import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { notifyMany } from '@/lib/notify'
import { logApplicationEvent } from '@/lib/application-events'
import type { ClientDecision } from '@/lib/types'

const VALID_DECISIONS = ['APPROVED', 'REJECTED', 'ON_HOLD']

/**
 * POST /api/client-portal/feedback
 * Client partner records their judgement on a shared AI interview report.
 * Body: { clientId, shortlistId, decision: APPROVED|REJECTED|ON_HOLD, feedback? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      clientId?: string
      shortlistId?: string
      decision?: string
      feedback?: string
    } | null

    if (!body?.clientId || !body?.shortlistId) {
      return NextResponse.json(
        { error: 'clientId and shortlistId are required' },
        { status: 400 }
      )
    }
    if (!body.decision || !VALID_DECISIONS.includes(body.decision)) {
      return NextResponse.json(
        { error: "decision must be 'APPROVED', 'REJECTED' or 'ON_HOLD'" },
        { status: 400 }
      )
    }
    if (body.feedback != null && typeof body.feedback !== 'string') {
      return NextResponse.json({ error: 'feedback must be a string' }, { status: 400 })
    }

    const shortlist = await db.shortlist.findUnique({
      where: { id: body.shortlistId },
      include: {
        interview: true,
        application: {
          include: {
            candidate: { select: { id: true, name: true } },
            job: { select: { id: true, title: true, recruiterId: true } },
          },
        },
      },
    })
    if (!shortlist) {
      return NextResponse.json({ error: 'Shared report not found' }, { status: 404 })
    }

    // Ownership guard: the client may only decide on reports shared with them
    if (shortlist.clientId !== body.clientId) {
      return NextResponse.json(
        { error: 'This report was not shared with your organisation' },
        { status: 403 }
      )
    }
    if (shortlist.status !== 'REPORT_SHARED' || shortlist.interview?.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'Only completed, shared reports can be reviewed' },
        { status: 409 }
      )
    }

    // One decision per report: flipping APPROVED -> REJECTED (or vice versa)
    // after notifications went out corrupts the audit trail. Re-submitting the
    // SAME decision stays idempotent (client may refresh/retry safely).
    if (shortlist.clientDecision && shortlist.clientDecision !== body.decision) {
      return NextResponse.json(
        {
          error: `A decision (${shortlist.clientDecision}) was already recorded for this report. Contact your SeeWe recruiter to revisit it.`,
        },
        { status: 409 }
      )
    }

    const updated = await db.shortlist.update({
      where: { id: body.shortlistId },
      data: {
        clientDecision: body.decision as ClientDecision,
        clientFeedback: body.feedback?.trim() ? body.feedback.trim().slice(0, 600) : null,
        decidedAt: new Date(),
      },
    })

    // §10 audit trail: client verdict (recruiter-only row — CLIENT_DECISION
    // events never reach the candidate timeline). Non-fatal.
    const clientRowForEvent = await db.client.findUnique({
      where: { id: body.clientId },
      select: { name: true },
    })
    if (shortlist.applicationId) {
      void logApplicationEvent(db, {
        applicationId: shortlist.applicationId,
        type: 'CLIENT_DECISION',
        actorRole: 'CLIENT',
        actorName: clientRowForEvent?.name ?? null,
        note: `Client verdict: ${body.decision}${
          body.feedback?.trim() ? ` — "${body.feedback.trim().slice(0, 160)}"` : ''
        }`,
      }).catch((err) => console.error('[application-events] non-fatal client-decision log failure:', err))
    }

    // 🔔 Close the loop: recruiter + candidate hear the client's verdict (non-fatal)
    const clientRow = await db.client.findUnique({ where: { id: body.clientId } })
    const clientName = clientRow?.name ?? 'The client'
    const candidateName = shortlist.application?.candidate?.name ?? 'The candidate'
    const jobTitle = shortlist.application?.job?.title ?? 'the role'
    const decisionCopy: Record<string, { emoji: string; recruiter: string; candidate: string }> = {
      APPROVED: {
        emoji: '✅',
        recruiter: 'wants to move forward',
        candidate: 'was impressed — the hiring team wants to move forward',
      },
      ON_HOLD: {
        emoji: '⏸',
        recruiter: 'put the decision on hold',
        candidate: 'is holding the decision for now',
      },
      REJECTED: {
        emoji: '👎',
        recruiter: 'declined this profile',
        candidate: 'has decided not to move forward this time',
      },
    }
    const copy = decisionCopy[body.decision]
    const recruiterId = shortlist.application?.job?.recruiterId
    const candidateUserId = shortlist.application?.candidate?.id
    const verdictMeta = {
      jobId: shortlist.application?.job?.id,
      applicationId: shortlist.application?.id,
      shortlistId: updated.id,
      clientName,
      candidateName,
      jobTitle,
      decision: body.decision,
    }
    await notifyMany([
      ...(recruiterId
        ? [
            {
              userId: recruiterId,
              type: 'CLIENT_VERDICT' as const,
              title: `${copy.emoji} ${clientName} · ${candidateName} · ${jobTitle}`,
              body: `${clientName} ${copy.recruiter} after reviewing the AI report.${body.feedback?.trim() ? ` Note: “${body.feedback.trim().slice(0, 120)}”` : ''}`,
              meta: verdictMeta,
            },
          ]
        : []),
      ...(candidateUserId
        ? [
            {
              userId: candidateUserId,
              type: 'CLIENT_VERDICT' as const,
              title: `${copy.emoji} Client review done · ${jobTitle}`,
              body: `${clientName} ${copy.candidate}.`,
              meta: verdictMeta,
            },
          ]
        : []),
    ])

    return NextResponse.json({
      data: {
        shortlistId: updated.id,
        clientDecision: updated.clientDecision,
        clientFeedback: updated.clientFeedback,
        decidedAt: updated.decidedAt?.toISOString() ?? null,
      },
    })
  } catch (err) {
    console.error('POST /api/client-portal/feedback failed:', err)
    return NextResponse.json(
      { error: 'Failed to save decision' },
      { status: 500 }
    )
  }
}
