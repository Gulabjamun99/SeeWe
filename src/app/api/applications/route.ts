import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeMatchScore } from '@/lib/match'
import { notify } from '@/lib/notify'
import { sendEmail, applicationReceivedEmail } from '@/lib/email'
import { validateCvUpload } from '@/lib/cv'
import { logApplicationEvent } from '@/lib/application-events'

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

/** CANDIDATE PRIVACY (absolute): the AI screen dossier, AI resume-authenticity
 * scan and recruiter-private notes never reach candidate payloads. matchScore
 * stays (product design). cvData (heavy base64) never rides in JSON either. */
function stripPrivateFields<
  T extends {
    screenSummary?: unknown
    screenVerdict?: unknown
    authenticityCheck?: unknown
    authenticityScore?: unknown
    notes?: unknown
    cvData?: unknown
  }
>(
  app: T
): Omit<
  T,
  | 'screenSummary'
  | 'screenVerdict'
  | 'authenticityCheck'
  | 'authenticityScore'
  | 'notes'
  | 'cvData'
> {
  const {
    screenSummary: _summary,
    screenVerdict: _verdict,
    authenticityCheck: _authenticityCheck,
    authenticityScore: _authenticityScore,
    notes: _notes,
    cvData: _cv,
    ...rest
  } = app
  return rest
}

// Attribution channels for the application source (deep-link share kit).
// Anything outside the whitelist silently falls back to DIRECT.
const APPLICATION_SOURCES = ['DIRECT', 'SHARED_LINK', 'CAREER_PAGE', 'REFERRAL']

// Public candidate fields - password never selected
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
  // CV metadata (bytes are never selected here — they stream via the /cv routes)
  cvFileName: true,
  cvMimeType: true,
  cvUploadedAt: true,
  createdAt: true,
} as const

// Recruiter-mode candidate select: adds the applicant's video-resume fields
// (the candidate opted in by recording/uploading the video). This extension is
// used ONLY on the recruiter inbox read below — candidate-facing responses
// (POST response, candidateId read) must never carry video paths/metadata.
const RECRUITER_CANDIDATE_SELECT = {
  ...CANDIDATE_SELECT,
  videoResumePath: true,
  videoResumeSeconds: true,
  videoResumeIntro: true,
} as const

// POST /api/applications - candidate applies to a job
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { jobId, candidateId, coverNote } = body as Record<string, unknown>

    // Optional attribution channel: shared apply links / career page / referral.
    // Whitelist-validated — unknown values degrade to DIRECT.
    const source: string =
      typeof body.source === 'string' && APPLICATION_SOURCES.includes(body.source)
        ? body.source
        : 'DIRECT'

    if (typeof jobId !== 'string' || jobId.trim().length === 0) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }
    if (typeof candidateId !== 'string' || candidateId.trim().length === 0) {
      return NextResponse.json({ error: 'candidateId is required' }, { status: 400 })
    }

    const job = await db.job.findUnique({ where: { id: jobId.trim() } })
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    // QA-audit fix (verify-2): closed/paused/expired vacancies must not accept
    // new applications — only an ACTIVE posting is open for business.
    if (job.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: 'This job is no longer accepting applications' },
        { status: 409 }
      )
    }

    const candidate = await db.user.findUnique({ where: { id: candidateId.trim() } })
    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }
    if (candidate.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Only CANDIDATE accounts can apply to jobs' },
        { status: 400 }
      )
    }

    // Duplicate pair check (schema also enforces @@unique([jobId, candidateId]))
    const existing = await db.application.findUnique({
      where: { jobId_candidateId: { jobId: job.id, candidateId: candidate.id } },
    })
    if (existing) {
      return NextResponse.json({ error: 'Already applied' }, { status: 409 })
    }

    const matchScore = computeMatchScore(job.skills, candidate.skills)
    const matchPct = matchScore ?? 0

    /* ---------- CV attachment (snapshot semantics) ----------
     * Priority: an explicitly uploaded document in this request wins; otherwise
     * the candidate's profile CV is snapshotted onto the application. The
     * recruiter therefore always receives a CV with every applied candidate. */
    let applicationCv: { fileName: string; mimeType: string; base64: string } | null = null
    if (body?.cv !== undefined && body?.cv !== null) {
      const parsed = validateCvUpload(body.cv)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      applicationCv = {
        fileName: parsed.cv.fileName,
        mimeType: parsed.cv.mimeType,
        base64: parsed.cv.base64,
      }
    } else {
      const profileCv = await db.user.findUnique({
        where: { id: candidate.id },
        select: { cvFileName: true, cvMimeType: true, cvData: true },
      })
      if (profileCv?.cvFileName && profileCv.cvMimeType && profileCv.cvData) {
        applicationCv = {
          fileName: profileCv.cvFileName,
          mimeType: profileCv.cvMimeType,
          base64: profileCv.cvData,
        }
      }
    }

    const application = await db.application.create({
      data: {
        jobId: job.id,
        candidateId: candidate.id,
        coverNote: typeof coverNote === 'string' && coverNote.trim() ? coverNote.trim() : undefined,
        status: 'APPLIED',
        matchScore,
        source,
        ...(applicationCv
          ? {
              cvFileName: applicationCv.fileName,
              cvMimeType: applicationCv.mimeType,
              cvData: applicationCv.base64,
            }
          : {}),
      },
      include: {
        job: {
          select: { id: true, title: true, company: true },
        },
        candidate: { select: CANDIDATE_SELECT },
      },
    })

    // §10 audit trail: the very first pipeline row — application created (non-fatal)
    void logApplicationEvent(db, {
      applicationId: application.id,
      type: 'STATUS_CHANGE',
      fromStatus: null,
      toStatus: 'APPLIED',
      actorRole: 'CANDIDATE',
      actorName: candidate.name,
      note: 'Applied to the job',
    }).catch((err) => console.error('[application-events] non-fatal apply log failure:', err))

    // 🔔 Notify the recruiter about the new application (non-fatal)
    void notify({
      userId: job.recruiterId,
      type: 'APPLICATION',
      title: `New application · ${job.title}`,
      body: `${candidate.name} applied with a ${Math.round(matchPct)}% skill match${matchPct === 0 ? '' : ' — worth a look'}${applicationCv ? ' · CV attached' : ''}.`,
      meta: {
        jobId: job.id,
        applicationId: application.id,
        actorName: candidate.name,
        jobTitle: job.title,
        score: matchPct,
        cvAttached: Boolean(applicationCv),
      },
    })

    // 📧 Confirmation email to the candidate's address (non-fatal) — they know
    // the application landed and what the next steps look like.
    const mail = applicationReceivedEmail({
      candidateName: candidate.name,
      jobTitle: job.title,
      company: job.company,
      hasCv: Boolean(applicationCv),
    })
    void sendEmail({
      to: candidate.email,
      toUserId: candidate.id,
      kind: 'APPLICATION_RECEIVED',
      subject: mail.subject,
      body: mail.body,
      meta: { jobId: job.id, applicationId: application.id, jobTitle: job.title, company: job.company },
    })

    // cvData (base64 bytes) never rides in JSON — it streams via the /cv route
    const { cvData: _cvData, ...safeApplication } = application
    return NextResponse.json(
      {
        data: { ...safeApplication, cvFileName: applicationCv?.fileName ?? null },
        emailQueued: { to: candidate.email, kind: 'APPLICATION_RECEIVED' },
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('POST /api/applications failed:', err)
    return NextResponse.json(
      { error: 'Failed to create application' },
      { status: 500 }
    )
  }
}

// GET /api/applications?candidateId=... | ?recruiterId=... [&jobId=] [&status=]
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const candidateId = sp.get('candidateId')
    const recruiterId = sp.get('recruiterId')

    if (!candidateId && !recruiterId) {
      return NextResponse.json(
        { error: 'Provide either candidateId or recruiterId as a query param' },
        { status: 400 }
      )
    }

    // Mode 1: a candidate's own applications with full job details.
    // An explicit jobId narrows the result to ONE job — the job detail dialog
    // uses this to ask "have I already applied HERE?" (without the filter any
    // past application to ANY job would show a false "already applied").
    if (candidateId) {
      const jobIdFilter = sp.get('jobId')
      const statusFilter = sp.get('status')
      if (statusFilter && !APPLICATION_STATUSES.includes(statusFilter)) {
        return NextResponse.json(
          { error: `status must be one of: ${APPLICATION_STATUSES.join(', ')}` },
          { status: 400 }
        )
      }
      const applications = await db.application.findMany({
        where: {
          candidateId,
          ...(jobIdFilter ? { jobId: jobIdFilter } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          job: {
            include: {
              _count: { select: { applications: true } },
              recruiter: {
                select: { id: true, name: true, company: true, avatarSeed: true },
              },
            },
          },
          shortlists: {
            include: {
              client: { select: { id: true, name: true, contactEmail: true } },
              interview: {
                // Candidate privacy: no AI score/verdict in candidate payloads
                select: {
                  id: true,
                  status: true,
                  domain: true,
                  completedAt: true,
                },
              },
            },
          },
        },
      })
      // Candidate view: offer fields + status ride along, screen dossier / notes do not.
      return NextResponse.json({ data: applications.map(stripPrivateFields) })
    }

    // Mode 2: recruiter inbox across all their posted jobs
    const jobIdFilter = sp.get('jobId')
    const statusFilter = sp.get('status')
    if (statusFilter && !APPLICATION_STATUSES.includes(statusFilter)) {
      return NextResponse.json(
        { error: `status must be one of: ${APPLICATION_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }

    const recruitersJobs = await db.job.findMany({
      where: { recruiterId: recruiterId! },
      select: { id: true },
    })
    const jobIds = recruitersJobs.map((j) => j.id)
    if (jobIds.length === 0) {
      return NextResponse.json({ data: [] })
    }

    // Tenancy guard: an explicit jobId is honoured ONLY when it belongs to
    // this recruiter — otherwise the recruiter-scope bypass would leak
    // another recruiter's applications for that job.
    if (jobIdFilter && !jobIds.includes(jobIdFilter)) {
      return NextResponse.json({ data: [] })
    }

    const applications = await db.application.findMany({
      where: {
        jobId: jobIdFilter ? jobIdFilter : { in: jobIds },
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      // Explicit select: recruiters receive the CV snapshot METADATA (bytes
      // stream via /api/applications/[id]/cv) but never the heavy cvData blob.
      select: {
        id: true,
        jobId: true,
        candidateId: true,
        coverNote: true,
        status: true,
        matchScore: true,
        source: true,
        notes: true,
        viewedAt: true,
        // AI screen dossier (recruiter-side only)
        screenSummary: true,
        screenVerdict: true,
        // AI resume-authenticity scan (recruiter-side only; stripped for candidates above)
        authenticityCheck: true,
        authenticityScore: true,
        // Offer management
        offeredAt: true,
        offerLetter: true,
        offerStatus: true,
        // Onboarding tracker
        onboardChecklist: true,
        onboardStatus: true,
        cvFileName: true,
        cvMimeType: true,
        createdAt: true,
        updatedAt: true,
        candidate: { select: RECRUITER_CANDIDATE_SELECT },
        job: {
          select: {
            id: true,
            title: true,
            company: true,
            location: true,
            workMode: true,
            salaryMinLpa: true,
            salaryMaxLpa: true,
            // drives the AI-invite flow on applicant cards (optional per job)
            aiInterviewEnabled: true,
          },
        },
        shortlists: {
          include: {
            interview: { select: { id: true, status: true } },
          },
        },
      },
    })

    return NextResponse.json({ data: applications })
  } catch (err) {
    console.error('GET /api/applications failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch applications' },
      { status: 500 }
    )
  }
}
