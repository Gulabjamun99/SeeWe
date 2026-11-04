// SeeWe - POST /api/interview/decision
// The recruiter's FINAL call on a completed AI interview. The AI verdict is
// advisory only — this route records the human decision and (where the choice
// is unambiguous) moves the pipeline:
//   ADVANCE → decision recorded + candidate gets a score-free "moving
//             forward" signal. The concrete next pipeline step (share with
//             client / offer) stays an explicit recruiter action.
//   HOLD    → decision recorded, nothing else changes (no candidate signal).
//   REJECT  → decision recorded + application moves to REJECTED with the
//             standard candidate notification + email.
//
// Ownership: only the job's own recruiter may decide. Candidates never see
// scores/verdicts — every notification below is score-free by design.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logApplicationEvent, actorNameFor } from '@/lib/application-events'
import { notify } from '@/lib/notify'
import { sendEmail, statusUpdateEmail } from '@/lib/email'

const DECISIONS = ['ADVANCE', 'HOLD', 'REJECT'] as const
type Decision = (typeof DECISIONS)[number]

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const interviewId = typeof body?.interviewId === 'string' ? body.interviewId.trim() : ''
    const recruiterId = typeof body?.recruiterId === 'string' ? body.recruiterId.trim() : ''
    const decision = typeof body?.decision === 'string' ? body.decision.trim().toUpperCase() : ''
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 600) : ''

    if (!interviewId || !recruiterId) {
      return NextResponse.json(
        { error: 'interviewId and recruiterId are required' },
        { status: 400 }
      )
    }
    if (!DECISIONS.includes(decision as Decision)) {
      return NextResponse.json(
        { error: `decision must be one of: ${DECISIONS.join(', ')}` },
        { status: 400 }
      )
    }

    const interview = await db.interview.findUnique({
      where: { id: interviewId },
      select: {
        id: true,
        candidateName: true,
        jobTitle: true,
        status: true,
        recruiterDecision: true,
        shortlist: {
          select: {
            applicationId: true,
            application: {
              select: {
                id: true,
                status: true,
                candidate: { select: { id: true, name: true, email: true } },
                job: { select: { id: true, title: true, company: true, recruiterId: true } },
              },
            },
          },
        },
      },
    })

    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
    }
    if (interview.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'The final decision unlocks once the interview is completed' },
        { status: 409 }
      )
    }

    const app = interview.shortlist?.application
    if (!app) {
      return NextResponse.json({ error: 'Interview has no parent application' }, { status: 409 })
    }
    if (app.job.recruiterId !== recruiterId) {
      return NextResponse.json(
        { error: 'Only the job\'s own recruiter can record the final decision' },
        { status: 403 }
      )
    }

    const previousDecision = interview.recruiterDecision
    const decisionChanged = previousDecision !== decision

    // ---- persist the human decision (atomic with any pipeline move) ----
    const now = new Date()
    const updated = await db.$transaction(async (tx) => {
      const iv = await tx.interview.update({
        where: { id: interview.id },
        data: {
          recruiterDecision: decision,
          recruiterDecisionNote: note || null,
          recruiterDecidedAt: now,
          recruiterDecidedBy: recruiterId,
        },
      })

      let newStatus: string | null = null
      if (decision === 'REJECT' && app.status !== 'REJECTED') {
        newStatus = 'REJECTED'
        await tx.application.update({
          where: { id: app.id },
          data: { status: 'REJECTED' },
        })
      }
      return { iv, newStatus }
    })

    // ---- §10 audit trail + candidate signals (non-fatal) ----
    const recruiterName = await actorNameFor(recruiterId)
    const decisionLabel =
      decision === 'ADVANCE' ? 'Advanced' : decision === 'HOLD' ? 'On hold' : 'Rejected'
    try {
      await logApplicationEvent(db, {
        applicationId: app.id,
        type: 'RECRUITER_DECISION',
        actorRole: 'RECRUITER',
        actorName: recruiterName,
        // Candidate-visible timelines filter to STATUS_CHANGE/OFFER server-side,
        // so this row stays recruiter-only.
        note:
          `Final decision: ${decisionLabel}` +
          (updated.newStatus ? ` — moved to ${updated.newStatus}` : '') +
          (note ? ` · "${note}"` : ''),
      })
      if (updated.newStatus) {
        await logApplicationEvent(db, {
          applicationId: app.id,
          type: 'STATUS_CHANGE',
          fromStatus: app.status,
          toStatus: updated.newStatus,
          actorRole: 'RECRUITER',
          actorName: recruiterName,
          note: 'Recruiter final decision after AI interview review',
        })
      }
    } catch (err) {
      console.error('[interview/decision] non-fatal event log failure:', err)
    }

    if (decisionChanged && app.candidate) {
      const meta = {
        jobId: app.job.id,
        applicationId: app.id,
        interviewId: interview.id,
        jobTitle: app.job.title,
      }
      if (decision === 'REJECT') {
        // Same neutral, encouraging copy the pipeline uses for rejections.
        void notify({
          userId: app.candidate.id,
          type: 'SHORTLIST',
          title: `Application update · ${app.job.title}`,
          body: `${app.job.company} isn't moving forward this time — keep going, better matches are waiting.`,
          meta,
        })
        const update = statusUpdateEmail({
          candidateName: app.candidate.name,
          jobTitle: app.job.title,
          company: app.job.company,
          kind: 'REJECTED',
        })
        void sendEmail({
          to: app.candidate.email,
          toUserId: app.candidate.id,
          kind: 'STATUS_UPDATE',
          subject: update.subject,
          body: update.body,
          meta,
        })
      } else if (decision === 'ADVANCE') {
        // Score-free good news — no verdict, no numbers, ever.
        void notify({
          userId: app.candidate.id,
          type: 'SHORTLIST',
          title: `Moving forward · ${app.job.title}`,
          body: `The hiring team reviewed your interview for ${app.job.title} and your profile is moving ahead. Next steps will be shared here and on your email.`,
          meta,
        })
      }
      // HOLD: deliberately silent — nothing changed for the candidate yet.
    }

    return NextResponse.json({
      data: {
        interviewId: interview.id,
        recruiterDecision: updated.iv.recruiterDecision,
        recruiterDecisionNote: updated.iv.recruiterDecisionNote,
        recruiterDecidedAt: updated.iv.recruiterDecidedAt?.toISOString() ?? null,
        applicationStatus: updated.newStatus ?? app.status,
      },
    })
  } catch (error) {
    console.error('[interview/decision] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to record the decision' }, { status: 500 })
  }
}
