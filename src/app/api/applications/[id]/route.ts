import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { notify } from '@/lib/notify'
import { logApplicationEvent, actorNameFor } from '@/lib/application-events'
import {
  sendEmail,
  interviewInviteEmail,
  offerEmail,
  sharedWithClientEmail,
  statusUpdateEmail,
} from '@/lib/email'

const APPLICATION_STATUSES = [
  'APPLIED',
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'SHARED_WITH_CLIENT',
  'REJECTED',
  'HIRED',
  'OFFERED',
  'ONBOARDED',
]

/** CANDIDATE PRIVACY (absolute): AI screen dossiers, the AI resume-
 * authenticity scan and recruiter-private notes never reach candidate
 * surfaces. Recruiter-facing payloads may keep them. */
function stripScreenFields<
  T extends {
    screenSummary?: unknown
    screenVerdict?: unknown
    authenticityCheck?: unknown
    authenticityScore?: unknown
    notes?: unknown
  }
>(
  app: T
): Omit<
  T,
  'screenSummary' | 'screenVerdict' | 'authenticityCheck' | 'authenticityScore' | 'notes'
> {
  const {
    screenSummary: _summary,
    screenVerdict: _verdict,
    authenticityCheck: _authenticity,
    authenticityScore: _authScore,
    notes: _notes,
    ...rest
  } = app
  return rest
}

const CANDIDATE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  headline: true,
  location: true,
  company: true,
  skills: true,
  experienceYears: true,
  currentSalary: true,
  expectedSalary: true,
  education: true,
  resumeText: true,
  avatarSeed: true,
  noticePeriodDays: true,
  cvFileName: true,
  cvMimeType: true,
  cvUploadedAt: true,
  createdAt: true,
} as const

// GET /api/applications/[id] - full detail incl shortlists & interview
// Optional ?viewerId=<userId>: lets the route verify the caller's role —
// screen dossier fields are stripped for EVERYONE except the job's recruiter.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const application = await db.application.findUnique({
      where: { id },
      include: {
        job: {
          include: {
            _count: { select: { applications: true } },
            recruiter: {
              select: { id: true, name: true, company: true, avatarSeed: true },
            },
          },
        },
        candidate: { select: CANDIDATE_SELECT },
        shortlists: {
          include: {
            client: true,
            interview: true,
          },
        },
      },
    })

    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    // cvData (base64 bytes) never rides in JSON payloads — it streams via
    // /api/applications/[id]/cv with proper Content-Type/Disposition headers.
    const { cvData: _cvData, ...safeApplication } = application

    // Privacy default: strip the AI screen dossier unless the caller proves to
    // be the job's own recruiter (via viewerId). Candidates/anonymous → stripped.
    const viewerId = req.nextUrl.searchParams.get('viewerId')
    const isOwningRecruiter =
      !!viewerId && viewerId === application.job.recruiterId
    const payload = isOwningRecruiter ? safeApplication : stripScreenFields(safeApplication)

    return NextResponse.json({ data: payload })
  } catch (err) {
    console.error('GET /api/applications/[id] failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch application' },
      { status: 500 }
    )
  }
}

// PATCH /api/applications/[id] - recruiter pipeline actions (status / notes / mark-viewed)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await db.application.findUnique({
      where: { id },
      include: { job: { select: { id: true, recruiterId: true, title: true, company: true } } },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const patch = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}

    /** Recruiter-ownership: notes / markViewed must come from the job's own
     * recruiter (candidate withdraw path uses candidateId instead). */
    const isJobRecruiter =
      typeof patch.recruiterId === 'string' && patch.recruiterId === existing.job.recruiterId

    const data: Record<string, unknown> = {}
    const status: unknown = patch.status
    const wantsNotes = patch.notes !== undefined
    const wantsViewed = patch.markViewed === true
    const wantsStatus = status !== undefined

    // Nothing to do at all → explicit 400 (unchanged contract for empty PATCHes)
    if (!wantsNotes && !wantsViewed && !wantsStatus) {
      return NextResponse.json(
        { error: `status is required and must be one of: ${APPLICATION_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }

    // --- recruiter private notes (ATS-style) ---
    if (wantsNotes) {
      if (!isJobRecruiter) {
        return NextResponse.json(
          { error: 'Only the job\'s recruiter can update notes' },
          { status: 403 }
        )
      }
      if (patch.notes === null) {
        data.notes = null
      } else if (typeof patch.notes === 'string') {
        const trimmed = patch.notes.trim().slice(0, 2000)
        data.notes = trimmed.length > 0 ? trimmed : null
      } else {
        return NextResponse.json({ error: 'notes must be a string or null' }, { status: 400 })
      }
    }

    // --- "recruiter viewed" engagement signal (idempotent, first-write-wins).
    // A repeat markViewed is a harmless no-op (200), never an error. ---
    if (wantsViewed) {
      if (!isJobRecruiter) {
        return NextResponse.json(
          { error: 'Only the job\'s recruiter can mark applications viewed' },
          { status: 403 }
        )
      }
      if (!existing.viewedAt) data.viewedAt = new Date()
    }

    // --- status transition (existing behaviour) ---
    if (wantsStatus) {
      if (typeof status !== 'string' || !APPLICATION_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: `status is required and must be one of: ${APPLICATION_STATUSES.join(', ')}` },
          { status: 400 }
        )
      }
      data.status = status
    }

    // Light ownership check: when a candidate withdraws (self-rejects),
    // the caller must identify itself as the application's owner.
    if (status === 'REJECTED' && typeof patch.candidateId === 'string') {
      if (patch.candidateId !== existing.candidateId) {
        return NextResponse.json(
          { error: 'Only the application owner can withdraw it' },
          { status: 403 }
        )
      }
    }

    const updated = await db.application.update({
      where: { id },
      data,
      include: {
        candidate: { select: CANDIDATE_SELECT },
        job: true,
      },
    })

    /* ---------- §10 audit trail (non-fatal, never blocks the pipeline) ----------
     * One row per mutating aspect: VIEWED (first engagement), NOTE (private
     * note saved) and STATUS_CHANGE (pipeline move, with from/to stages). */
    void (async () => {
      try {
        const recruiterName = await actorNameFor(isJobRecruiter ? patch.recruiterId as string : null)
        if (data.viewedAt) {
          await logApplicationEvent(db, {
            applicationId: id,
            type: 'VIEWED',
            actorRole: 'RECRUITER',
            actorName: recruiterName,
            note: 'Recruiter opened the application',
          })
        }
        if (wantsNotes) {
          await logApplicationEvent(db, {
            applicationId: id,
            type: 'NOTE',
            actorRole: 'RECRUITER',
            actorName: recruiterName,
            note: data.notes ? `Private note saved: "${String(data.notes).slice(0, 160)}"` : 'Private note cleared',
          })
        }
        if (data.status !== undefined && data.status !== existing.status) {
          const selfWithdraw =
            data.status === 'REJECTED' && typeof patch.candidateId === 'string' &&
            patch.candidateId === existing.candidateId
          await logApplicationEvent(db, {
            applicationId: id,
            type: 'STATUS_CHANGE',
            fromStatus: existing.status,
            toStatus: String(data.status),
            actorRole: isJobRecruiter ? 'RECRUITER' : selfWithdraw ? 'CANDIDATE' : 'SYSTEM',
            actorName: isJobRecruiter
              ? recruiterName
              : selfWithdraw
                ? (updated.candidate?.name ?? null)
                : null,
            note: selfWithdraw
              ? 'Candidate withdrew the application'
              : `Moved to ${String(data.status)}`,
          })
        }
      } catch (err) {
        console.error('[application-events] non-fatal PATCH log failure:', err)
      }
    })()

    if (data.status === undefined) {
      // notes / viewed-only updates don't touch the pipeline — no notifications
      // (cvData is stripped — the heavy base64 never leaves the server; screen
      // fields are stripped too unless the caller is the verified recruiter)
      return NextResponse.json({
        data: isJobRecruiter
          ? { ...updated, cvData: undefined }
          : stripScreenFields({ ...updated, cvData: undefined }),
      })
    }

    const newStatus = updated.status

    // 📧 Every pipeline step emails the candidate's registered address so they
    // stay ready for the interview / next process (non-fatal, simulated
    // transport in this sandbox — recorded in EmailLog + dev.log).
    const emailMeta = {
      jobId: updated.job?.id,
      applicationId: updated.id,
      jobTitle: updated.job?.title,
      company: updated.job?.company,
    }
    function queueProcessEmail(kind: Parameters<typeof sendEmail>[0]['kind'], subject: string, body: string) {
      void sendEmail({
        to: updated.candidate.email,
        toUserId: updated.candidate.id,
        kind,
        subject,
        body,
        meta: emailMeta,
      })
    }

    // 🔔 Candidate-facing pipeline updates (non-fatal).
    // Candidate self-withdraw (REJECTED + candidateId present) stays silent.
    const selfWithdraw = newStatus === 'REJECTED' && typeof patch.candidateId === 'string'
    if (!selfWithdraw && updated.candidate && updated.job) {
      if (newStatus === 'SHORTLISTED') {
        void notify({
          userId: updated.candidate.id,
          type: 'SHORTLIST',
          title: `⭐ Shortlisted · ${updated.job.title}`,
          body: `${updated.job.company} moved your application forward. Next stop: an AI-led video interview.`,
          meta: {
            jobId: updated.job.id,
            applicationId: updated.id,
            jobTitle: updated.job.title,
          },
        })
        const invite = interviewInviteEmail({
          candidateName: updated.candidate.name,
          jobTitle: updated.job.title,
          company: updated.job.company,
        })
        queueProcessEmail('INTERVIEW_INVITE', invite.subject, invite.body)
      } else if (newStatus === 'HIRED') {
        // 🎉 The offer moment — the single most important candidate signal
        void notify({
          userId: updated.candidate.id,
          type: 'SHORTLIST',
          title: `🎉 Offer received · ${updated.job.title}`,
          body: `Congratulations! ${updated.job.company} extended you an offer for ${updated.job.title}. Check My Journey for details.`,
          meta: {
            jobId: updated.job.id,
            applicationId: updated.id,
            jobTitle: updated.job.title,
          },
        })
        const offer = offerEmail({
          candidateName: updated.candidate.name,
          jobTitle: updated.job.title,
          company: updated.job.company,
        })
        queueProcessEmail('OFFER', offer.subject, offer.body)
      } else if (newStatus === 'SHARED_WITH_CLIENT') {
        // Your profile crossed the last mile — the hiring client is reviewing it
        void notify({
          userId: updated.candidate.id,
          type: 'SHORTLIST',
          title: `📤 Shared with client · ${updated.job.title}`,
          body: `${updated.job.company} shared your profile with the hiring client. Client feedback usually arrives in a few days.`,
          meta: {
            jobId: updated.job.id,
            applicationId: updated.id,
            jobTitle: updated.job.title,
          },
        })
        const shared = sharedWithClientEmail({
          candidateName: updated.candidate.name,
          jobTitle: updated.job.title,
          company: updated.job.company,
        })
        queueProcessEmail('SHARED_WITH_CLIENT', shared.subject, shared.body)
      } else if (newStatus === 'REJECTED') {
        void notify({
          userId: updated.candidate.id,
          type: 'SHORTLIST',
          title: `Application update · ${updated.job.title}`,
          body: `${updated.job.company} isn't moving forward this time — keep going, better matches are waiting.`,
          meta: {
            jobId: updated.job.id,
            applicationId: updated.id,
            jobTitle: updated.job.title,
          },
        })
        const update = statusUpdateEmail({
          candidateName: updated.candidate.name,
          jobTitle: updated.job.title,
          company: updated.job.company,
          kind: 'REJECTED',
        })
        queueProcessEmail('STATUS_UPDATE', update.subject, update.body)
      } else if (newStatus === 'INTERVIEW_SCHEDULED') {
        const sched = statusUpdateEmail({
          candidateName: updated.candidate.name,
          jobTitle: updated.job.title,
          company: updated.job.company,
          kind: 'INTERVIEW_SCHEDULED',
        })
        queueProcessEmail('STATUS_UPDATE', sched.subject, sched.body)
      }
    }

    const emailQueued = !selfWithdraw && updated.candidate
      ? { to: updated.candidate.email, kind: newStatus }
      : null
    return NextResponse.json({
      data: isJobRecruiter
        ? { ...updated, cvData: undefined }
        : stripScreenFields({ ...updated, cvData: undefined }),
      emailQueued,
    })
  } catch (err) {
    console.error('PATCH /api/applications/[id] failed:', err)
    return NextResponse.json(
      { error: 'Failed to update application' },
      { status: 500 }
    )
  }
}
