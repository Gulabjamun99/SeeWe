// SeeWe - POST /api/interview/invite
// The RECRUITER invites a shortlisted candidate to take the AI interview for a
// specific job. The recruiter never takes the interview themselves — they only
// author the questions (Job.aiInterviewConfig) and send the invite. The
// candidate receives an email + in-app notification and takes the interview
// from their own dashboard.
//
// Body: { applicationId }
// - Validates that the job actually has AI screening enabled with ≥1 authored
//   question (otherwise 409 with an actionable message).
// - Idempotent: if an interview already exists it is returned with
//   `alreadyExisted: true` and the invite mail/notification is re-sent (resend).
// - Creates the Interview in PENDING status; it flips to IN_PROGRESS when the
//   CANDIDATE opens the room (see /api/interview/start).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { sendEmail, interviewInviteEmail } from '@/lib/email'
import { questionsFromConfig, parseJobAiConfig } from '@/lib/ai-interview-questions'
import { logApplicationEvent, actorNameFor } from '@/lib/application-events'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const applicationId =
      typeof body?.applicationId === 'string' ? body.applicationId.trim() : ''
    if (!applicationId) {
      return NextResponse.json({ error: 'applicationId is required' }, { status: 400 })
    }

    const app = await db.application.findUnique({
      where: { id: applicationId },
      include: {
        candidate: { select: { id: true, name: true, email: true } },
        job: true,
        shortlists: {
          orderBy: { createdAt: 'asc' as const },
          include: { interview: true },
        },
      },
    })
    if (!app) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    const { job, candidate } = app

    // ---- Guard: AI screening must be enabled WITH an authored question set ----
    if (!job.aiInterviewEnabled) {
      return NextResponse.json(
        {
          error:
            'AI screening is OFF for this job. Turn it on from the job editor and add your questions first.',
        },
        { status: 409 }
      )
    }
    const config = parseJobAiConfig(job.aiInterviewConfig)
    if (!config) {
      return NextResponse.json(
        {
          error:
            'This job has no AI interview questions yet — open the job editor and add or suggest questions first.',
        },
        { status: 409 }
      )
    }

    // ---- Resolve / create the pipeline shortlist anchor ----
    let shortlist = app.shortlists.length > 0 ? app.shortlists[app.shortlists.length - 1] : null
    if (!shortlist) {
      shortlist = await db.shortlist.create({
        data: { applicationId: app.id, status: 'PENDING_INTERVIEW' },
        include: { interview: true },
      })
    }

    // ---- Idempotent: existing interview → resend invite ----
    if (shortlist.interview) {
      const existing = shortlist.interview
      if (existing.status === 'COMPLETED') {
        return NextResponse.json(
          { error: 'This candidate has already completed the AI interview — view the report instead.' },
          { status: 409 }
        )
      }
      // Re-send the invite (user-visible "Resend invite" action)
      const mail = interviewInviteEmail({
        candidateName: candidate.name,
        jobTitle: job.title,
        company: job.company,
      })
      void sendEmail({
        to: candidate.email,
        toUserId: candidate.id,
        kind: 'INTERVIEW_INVITE',
        subject: mail.subject,
        body: mail.body,
        meta: { jobId: job.id, applicationId: app.id, jobTitle: job.title, company: job.company, resent: true },
      })
      void notify({
        userId: candidate.id,
        type: 'SHORTLIST',
        title: `🎬 AI interview invite · ${job.title}`,
        body: `The hiring team re-sent your AI interview invite for ${job.title} at ${job.company}. Open your dashboard to take it.`,
        meta: { jobId: job.id, applicationId: app.id, shortlistId: shortlist.id },
      })
      // §10 audit trail: invite re-sent (recruiter-only AI_INVITE row). Non-fatal.
      void actorNameFor(job.recruiterId)
        .then((actorName) =>
          logApplicationEvent(db, {
            applicationId: app.id,
            type: 'AI_INVITE',
            actorRole: 'RECRUITER',
            actorName,
            note: 'AI interview invite re-sent to the candidate',
          })
        )
        .catch((err) => console.error('[application-events] non-fatal invite log failure:', err))
      return NextResponse.json({
        data: { interview: existing, alreadyExisted: true, resent: true },
      })
    }

    // ---- Create the PENDING interview from the recruiter's questions ----
    const questions = questionsFromConfig(config)
    // §10 audit trail: resolve the inviting recruiter's display name up-front so
    // the event rows can be written atomically inside the transaction below.
    const inviterName = await actorNameFor(job.recruiterId)
    const [interview] = await db.$transaction([
      db.interview.create({
        data: {
          shortlistId: shortlist.id,
          candidateName: candidate.name,
          jobTitle: job.title,
          domain: job.title,
          difficulty: 'MEDIUM',
          questions: JSON.stringify(questions),
          status: 'PENDING',
        },
      }),
      db.shortlist.update({
        where: { id: shortlist.id },
        data: { status: 'PENDING_INTERVIEW' },
      }),
      db.application.update({
        where: { id: app.id },
        data: { status: 'INTERVIEW_SCHEDULED' },
      }),
      // §10 audit trail: pipeline move + invite row, atomic with the mutation.
      db.applicationEvent.create({
        data: {
          applicationId: app.id,
          type: 'STATUS_CHANGE',
          fromStatus: app.status,
          toStatus: 'INTERVIEW_SCHEDULED',
          actorRole: 'RECRUITER',
          actorName: inviterName,
          note: 'AI interview invite sent — interview scheduled',
        },
      }),
      db.applicationEvent.create({
        data: {
          applicationId: app.id,
          type: 'AI_INVITE',
          actorRole: 'RECRUITER',
          actorName: inviterName,
          note: `AI interview invite sent with ${questions.length} authored questions`,
        },
      }),
    ])

    // 📧 Invite mail lands in the candidate's Email updates mailbox
    const mail = interviewInviteEmail({
      candidateName: candidate.name,
      jobTitle: job.title,
      company: job.company,
    })
    void sendEmail({
      to: candidate.email,
      toUserId: candidate.id,
      kind: 'INTERVIEW_INVITE',
      subject: mail.subject,
      body: mail.body,
      meta: { jobId: job.id, applicationId: app.id, jobTitle: job.title, company: job.company },
    })

    // 🔔 In-app notification for the candidate
    void notify({
      userId: candidate.id,
      type: 'SHORTLIST',
      title: `🎬 AI interview invite · ${job.title}`,
      body: `You are shortlisted for ${job.title} at ${job.company}. Your AI interview (${questions.length} questions) is ready — take it from your dashboard.`,
      meta: { jobId: job.id, applicationId: app.id, shortlistId: shortlist.id },
    })

    return NextResponse.json(
      { data: { interview, alreadyExisted: false, resent: false } },
      { status: 201 }
    )
  } catch (error) {
    console.error('[interview/invite] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to send interview invite' }, { status: 500 })
  }
}
