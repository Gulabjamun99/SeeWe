// SeeWe - POST /api/interview/start
// Boots (or resumes) an AI interview for a shortlisted candidate.
//
// RECRUITER-AUTHORED QUESTIONS: the questions ALWAYS come from the job's
// recruiter-authored config (Job.aiInterviewConfig). The AI never invents the
// round here — it only suggests questions at design time (see
// /api/ai/suggest-questions). A job with AI screening disabled cannot start an
// AI interview at all (403). An interview is created in PENDING state by
// /api/interview/invite when the recruiter sends the invite; this route flips
// it to IN_PROGRESS when the CANDIDATE opens the room. Idempotent: re-calling
// resumes the existing interview instead of regenerating.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { InterviewQuestion } from '@/lib/types'
import { questionsFromConfig, parseJobAiConfig } from '@/lib/ai-interview-questions'
import { logApplicationEvent } from '@/lib/application-events'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const shortlistId =
      typeof body?.shortlistId === 'string' ? body.shortlistId.trim() : ''
    const applicationId =
      typeof body?.applicationId === 'string' ? body.applicationId.trim() : ''
    // Master spec §18/§37 — recording consent. The room sends consent:true the
    // moment the candidate ticks the consent checkbox and presses Begin.
    // BACKWARD COMPATIBLE: absent/false on the resume path never blocks a
    // resume — the ledger row + consentAt are written only for explicit true.
    const consent = body?.consent === true
    if (!shortlistId && !applicationId) {
      return NextResponse.json(
        { error: 'shortlistId or applicationId is required' },
        { status: 400 }
      )
    }

    let shortlist = shortlistId
      ? await db.shortlist.findUnique({
          where: { id: shortlistId },
          include: {
            client: true,
            application: {
              include: {
                candidate: true,
                job: true,
              },
            },
            interview: true,
          },
        })
      : null

    // Resolve by application when no (or an unknown) shortlist id was passed.
    // Recruiter UIs may only have the application id at hand.
    if (!shortlist && applicationId) {
      let app = await db.application.findUnique({
        where: { id: applicationId },
        include: {
          candidate: true,
          job: true,
          shortlists: { orderBy: { createdAt: 'asc' as const } },
        },
      })
      if (!app) {
        return NextResponse.json({ error: 'Application not found' }, { status: 404 })
      }

      // Ensure the application has entered the pipeline
      if (app.status === 'APPLIED') {
        const fromStatus = app.status
        app = await db.application.update({
          where: { id: app.id },
          data: { status: 'SHORTLISTED' },
          include: {
            candidate: true,
            job: true,
            shortlists: { orderBy: { createdAt: 'asc' as const } },
          },
        })
        // §10 audit trail: auto-shortlist on interview start. Non-fatal.
        void logApplicationEvent(db, {
          applicationId: app.id,
          type: 'STATUS_CHANGE',
          fromStatus,
          toStatus: 'SHORTLISTED',
          actorRole: 'SYSTEM',
          note: 'Entered the pipeline when the AI interview started',
        }).catch((err) => console.error('[application-events] non-fatal start log failure:', err))
      }

      // Find or create the shortlist anchor for this application
      if (app.shortlists.length > 0) {
        shortlist = await db.shortlist.findUnique({
          where: { id: app.shortlists[app.shortlists.length - 1].id },
          include: {
            client: true,
            application: {
              include: { candidate: true, job: true },
            },
            interview: true,
          },
        })
      } else {
        await db.shortlist.create({
          data: {
            applicationId: app.id,
            status: 'PENDING_INTERVIEW',
          },
        })
        shortlist = await db.shortlist.findFirst({
          where: { applicationId: app.id },
          include: {
            client: true,
            application: {
              include: { candidate: true, job: true },
            },
            interview: true,
          },
        })
      }
    }

    if (!shortlist || !(shortlist as { application?: unknown }).application) {
      return NextResponse.json(
        { error: shortlistId && !applicationId ? 'Shortlist not found' : 'Application not found' },
        { status: 404 }
      )
    }

    // Idempotent resume path
    if (shortlist.interview) {
      const existing = await db.interview.findUnique({
        where: { id: shortlist.interview.id },
        include: { answers: { orderBy: { qIndex: 'asc' as const } } },
      })
      if (existing) {
        let parsedQuestions: InterviewQuestion[] = []
        try {
          const arr = JSON.parse(existing.questions ?? '[]')
          if (Array.isArray(arr)) parsedQuestions = arr
        } catch {
          parsedQuestions = []
        }
        // A PENDING interview means the CANDIDATE just opened the room for the
        // first time — flip it to IN_PROGRESS now (the recruiter never takes
        // the interview, so only the candidate can trigger this transition).
        if (existing.status === 'PENDING') {
          await db.interview.update({
            where: { id: existing.id },
            data: { status: 'IN_PROGRESS', startedAt: new Date() },
          })
          existing.status = 'IN_PROGRESS'
          existing.startedAt = new Date()
        }
        // Recording-consent ledger (§37): record on the FIRST consented begin
        // only — re-resuming with consent:true must not duplicate rows. An
        // absent consent flag (older clients / plain resume) changes nothing.
        if (consent && !existing.consentAt) {
          const app = shortlist.application
          const context = `${existing.jobTitle} @ ${app?.job?.company ?? 'the hiring team'}`
          await db.interview.update({
            where: { id: existing.id },
            data: { consentAt: new Date() },
          })
          existing.consentAt = new Date()
          await db.consentRecord.create({
            data: {
              userId: app?.candidateId ?? null,
              kind: 'INTERVIEW_RECORDING',
              version: '1.0',
              context,
            },
          })
        }
        // CANDIDATE-SAFE resume payload: AI evaluation (overall score, verdict,
        // report, per-answer scores/feedback) never leaves the server — the
        // room only needs questions, progress and the candidate's transcripts.
        const { overallScore: _s, verdict: _v, report: _r, ...safeExisting } = existing
        return NextResponse.json({
          // NOTE: `resumed` must live INSIDE data — the client's postJson
          // helper only forwards `json.data`, so a top-level flag is lost.
          data: {
            ...safeExisting,
            questions: parsedQuestions,
            resumed: true,
            answers: existing.answers.map((a) => ({
              ...a,
              score: null,
              feedback: null,
              strengths: null,
              improvements: null,
            })),
          },
        })
      }
    }

    const { candidate, job } = shortlist.application

    const jobTitle = job.title
    const domain = jobTitle // stored on the interview row for backward compatibility
    // §10 audit trail: capture the pre-start status for the transaction's event row.
    const preStartStatus = shortlist.application.status

    // ----- RECRUITER-AUTHORED QUESTIONS ONLY -----
    // The AI never invents the round here. A job must have AI screening
    // enabled AND an authored question set for an interview to exist.
    if (!job.aiInterviewEnabled) {
      return NextResponse.json(
        {
          error:
            'AI interview is not enabled for this job — the hiring team runs its own interview process for this role.',
        },
        { status: 403 }
      )
    }
    const config = parseJobAiConfig(job.aiInterviewConfig)
    if (!config) {
      return NextResponse.json(
        {
          error:
            'The hiring team has not finished setting up the questions for this interview yet. Please check back shortly.',
        },
        { status: 409 }
      )
    }
    const allQuestions = questionsFromConfig(config)
    const difficulty = 'MEDIUM' // question set is recruiter-authored; difficulty concept retired

    // ----- Persist: interview + status updates (atomic) -----
    const [interview] = await db.$transaction([
      db.interview.create({
        data: {
          shortlistId: shortlist.id,
          candidateName: candidate.name,
          jobTitle,
          domain,
          difficulty,
          questions: JSON.stringify(allQuestions),
          status: 'IN_PROGRESS',
          startedAt: new Date(),
          ...(consent ? { consentAt: new Date() } : {}),
        },
      }),
      db.shortlist.update({
        where: { id: shortlist.id },
        data: { status: 'INTERVIEW_IN_PROGRESS' },
      }),
      db.application.update({
        where: { id: shortlist.applicationId },
        data: { status: 'INTERVIEW_SCHEDULED' },
      }),
      // §10 audit trail: interview in progress — atomic with the mutation.
      db.applicationEvent.create({
        data: {
          applicationId: shortlist.applicationId,
          type: 'STATUS_CHANGE',
          fromStatus: preStartStatus,
          toStatus: 'INTERVIEW_SCHEDULED',
          actorRole: 'CANDIDATE',
          actorName: candidate.name,
          note: 'AI interview started',
        },
      }),
    ])

    // Consent ledger row for the freshly created interview (best-effort —
    // a ledger hiccup must never fail the start).
    if (consent) {
      try {
        await db.consentRecord.create({
          data: {
            userId: candidate.id,
            kind: 'INTERVIEW_RECORDING',
            version: '1.0',
            context: `${jobTitle} @ ${job.company ?? 'the hiring team'}`,
          },
        })
      } catch (ledgerErr) {
        console.error('[interview/start] consent ledger write failed:', ledgerErr)
      }
    }

    return NextResponse.json({
      data: {
        ...interview,
        questions: allQuestions, // parsed objects, not JSON string
        answers: [],
        shortlist: { id: shortlist.id, status: 'INTERVIEW_IN_PROGRESS' },
        application: { id: shortlist.applicationId, status: 'INTERVIEW_SCHEDULED' },
      },
      resumed: false,
    })
  } catch (error) {
    console.error('[interview/start] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to start interview' }, { status: 500 })
  }
}
