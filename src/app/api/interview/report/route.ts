// SeeWe - /api/interview/report
// POST { interviewId } -> finalize interview: aggregate score & verdict,
//   LLM-written final report (4 dimensions), update shortlist/application.
// GET ?clientId=... | ?recruiterId=...  -> list COMPLETED interviews with
//   client + candidate + job context and parsed aiSummary.

import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { DimensionScore, InterviewQuestion, InterviewReport } from '@/lib/types'
import { buildCandidateDetails } from '@/lib/spoken-profile'
import { chatWithRetry, extractJson } from '@/lib/ai-client'
import { notifyMany } from '@/lib/notify'
import { sendEmail, interviewSubmittedEmail, interviewRecordingReadyEmail } from '@/lib/email'
import { logApplicationEvent } from '@/lib/application-events'

const DIMENSION_NAMES = ['Technical Depth', 'Communication', 'Problem Solving', 'Domain Knowledge'] as const

function verdictFor(score: number): 'STRONG_HIRE' | 'HIRE' | 'MAYBE' | 'NO_HIRE' {
  if (score >= 8) return 'STRONG_HIRE'
  if (score >= 6.5) return 'HIRE'
  if (score >= 5) return 'MAYBE'
  return 'NO_HIRE'
}

/** Force exactly the 4 standard dimensions, each scored 0-10 (1 decimal). */
function normalizeDimensionScores(raw: unknown, overallScore: number): DimensionScore[] {
  const arr = Array.isArray(raw) ? raw : []
  const byName = new Map<string, number>()
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const name = String((item as any).name ?? '').trim()
    const score = Number((item as any).score)
    if (name && Number.isFinite(score)) {
      byName.set(name.toLowerCase(), Math.min(10, Math.max(0, score)))
    }
  }
  return DIMENSION_NAMES.map((name) => {
    const found = byName.get(name.toLowerCase())
    const fallback = Math.min(10, Math.max(0, Math.round(overallScore * 10) / 10))
    return { name, score: Math.round((found ?? fallback) * 10) / 10 }
  })
}

function normalizeStringArray(raw: unknown, min: number): string[] {
  const arr = Array.isArray(raw)
    ? raw.map((s) => String(s).trim()).filter(Boolean)
    : typeof raw === 'string' && raw.trim()
      ? [raw.trim()]
      : []
  return arr.slice(0, Math.max(min, 4))
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const interviewId = typeof body?.interviewId === 'string' ? body.interviewId.trim() : ''
    if (!interviewId) {
      return NextResponse.json({ error: 'interviewId is required' }, { status: 400 })
    }

    const interview = await db.interview.findUnique({
      where: { id: interviewId },
      include: {
        answers: { orderBy: { qIndex: 'asc' as const } },
        shortlist: { select: { applicationId: true } },
      },
    })
    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
    }
    if (interview.answers.length === 0) {
      return NextResponse.json({ error: 'No answers submitted yet - cannot generate report' }, { status: 400 })
    }

    // Idempotency / cost guard: a completed interview already has its report.
    // Re-POSTing must NOT re-run the LLM (duplicated spend + shifting scores).
    // The candidate-safe confirmation shape is returned — no evaluation data.
    if (interview.status === 'COMPLETED' && interview.report) {
      return NextResponse.json({
        data: {
          id: interview.id,
          shortlistId: interview.shortlistId,
          candidateName: interview.candidateName,
          jobTitle: interview.jobTitle,
          domain: interview.domain,
          difficulty: interview.difficulty,
          status: 'COMPLETED',
          completedAt: (interview.completedAt ?? new Date()).toISOString(),
          candidateCopy: true,
          alreadyCompleted: true,
        },
      })
    }

    // ----- Aggregate scores -----
    // Identify closing preliminary (profile) questions — captured, never graded.
    let parsedQuestionPlan: InterviewQuestion[] = []
    try {
      const arr = JSON.parse(interview.questions ?? '[]')
      if (Array.isArray(arr)) parsedQuestionPlan = arr as InterviewQuestion[]
    } catch {
      parsedQuestionPlan = []
    }
    const preliminaryIndexes = new Set(
      parsedQuestionPlan.filter((q) => q?.kind === 'PRELIMINARY').map((q) => q.qIndex)
    )
    const scored = interview.answers.filter(
      (a) => typeof a.score === 'number' && !preliminaryIndexes.has(a.qIndex)
    )
    const overallScore =
      scored.length > 0
        ? Math.round((scored.reduce((sum, a) => sum + (a.score as number), 0) / scored.length) * 10) / 10
        : 0
    const verdict = verdictFor(overallScore)

    // Structured profile facts captured from the spoken closing answers
    const candidateDetails = buildCandidateDetails(
      interview.answers
        .filter((a) => preliminaryIndexes.has(a.qIndex))
        .map((a) => ({
          focusArea: parsedQuestionPlan.find((q) => q.qIndex === a.qIndex)?.focusArea ?? '',
          transcript: a.transcript ?? '',
        }))
    )

    // ----- LLM final report -----
    let parsedReport: InterviewReport
    try {
      const coreAnswers = interview.answers.filter((a) => !preliminaryIndexes.has(a.qIndex))
      const qaBlock = coreAnswers
        .map(
          (a, i) =>
            `Q${i + 1} (${typeof a.score === 'number' ? a.score.toFixed(1) : 'ungraded'}/10): ${a.question}\nA: ${
              (a.transcript ?? '(no answer)').slice(0, 800)
            }${a.feedback ? `\nPer-answer feedback: ${a.feedback}` : ''}`
        )
        .join('\n\n')

      const systemPrompt = `You are a senior hiring manager writing a concise evaluation report for a client after an AI-conducted technical interview. You judge strictly but fairly, grounded ONLY in the provided Q&A evidence. Respond with valid JSON only, no markdown fences, no commentary.`

      const userPrompt = `Write the final interview report.

CANDIDATE: ${interview.candidateName}
ROLE: ${interview.jobTitle}
DIFFICULTY: ${interview.difficulty}
COMPUTED OVERALL SCORE: ${overallScore.toFixed(1)}/10 (verdict ${verdict})

CANDIDATE PROFILE DETAILS (auto-captured from closing questions):
${JSON.stringify(candidateDetails)}

SCORED Q&A TRANSCRIPTS:
${qaBlock || '(no graded answers)'}

Return STRICT JSON exactly shaped like:
{
  "aiSummary": "<at most 90 words summarizing performance>",
  "dimensionScores": [{"name": "Technical Depth", "score": <0-10>}, {"name": "Communication", "score": <0-10>}, {"name": "Problem Solving", "score": <0-10>}, {"name": "Domain Knowledge", "score": <0-10>}],
  "strengths": ["<3-4 specific strengths>"],
  "weaknesses": ["<2-3 specific weaknesses>"],
  "recommendation": "<2-3 sentence hiring recommendation>"
}
Rules: dimensionScores MUST contain EXACTLY these four names, each scored 0-10 based on evidence. Scores may differ slightly from computed average when justified by quality. Respond with valid JSON only, no markdown fences, no commentary.`

      const raw = await chatWithRetry(systemPrompt, userPrompt)
      const parsed = extractJson<any>(raw)

      parsedReport = {
        aiSummary:
          typeof parsed?.aiSummary === 'string' && parsed.aiSummary.trim()
            ? parsed.aiSummary.trim()
            : `${interview.candidateName} completed the AI interview for ${interview.jobTitle}.`,
        dimensionScores: normalizeDimensionScores(parsed?.dimensionScores, overallScore),
        strengths: normalizeStringArray(parsed?.strengths, 3),
        weaknesses: normalizeStringArray(parsed?.weaknesses, 2),
        recommendation:
          typeof parsed?.recommendation === 'string' && parsed.recommendation.trim()
            ? parsed.recommendation.trim()
            : `Based on an overall score of ${overallScore.toFixed(1)}/10 the recommendation is "${verdict}".`,
      }

      // Enforce minimums if LLM returned too few bullets
      while (parsedReport.strengths.length < 3) {
        parsedReport.strengths.push('Completed all interview questions and engaged constructively.')
      }
      while (parsedReport.weaknesses.length < 2) {
        parsedReport.weaknesses.push('Deeper hands-on depth would strengthen the profile.')
      }
      if (Object.keys(candidateDetails).length > 0) {
        parsedReport.candidateDetails = candidateDetails
      }
    } catch (err) {
      console.error('[interview/report] LLM report generation failed, using deterministic fallback:', err)
      parsedReport = {
        aiSummary: `${interview.candidateName} answered ${interview.answers.length} question(s) with an average score of ${overallScore.toFixed(1)}/10 for the ${interview.jobTitle} role.`,
        dimensionScores: normalizeDimensionScores([], overallScore),
        strengths:
          scored.filter((a) => (a.score as number) >= 6).length > 0
            ? ['Solid correct answers on core technical questions', 'Clear structured explanations']
            : ['Engaged with every question asked'],
        weaknesses: ['Answer depth below expectations for the target level'],
        recommendation: `Overall score ${overallScore.toFixed(1)}/10 maps to verdict "${verdict}". Review individual answer transcripts before deciding.`,
      }
    }

    // ----- Persist final state (atomic) -----
    if (!interview.shortlist) {
      return NextResponse.json({ error: 'Interview has no parent shortlist' }, { status: 409 })
    }

    // §10 audit trail: capture the pre-completion status for the event row.
    const appForEvent = await db.application.findUnique({
      where: { id: interview.shortlist.applicationId },
      select: { status: true },
    })

    const updated = await db.$transaction([
      db.interview.update({
        where: { id: interview.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          overallScore,
          verdict,
          report: JSON.stringify(parsedReport),
        },
      }),
      db.shortlist.update({
        where: { id: interview.shortlistId },
        data: { status: 'COMPLETED' },
      }),
      db.application.update({
        where: { id: interview.shortlist.applicationId },
        data: { status: 'INTERVIEWED' },
      }),
      // §10 audit trail: interview completed — atomic with the mutation.
      // Candidate-neutral note (no scores/verdicts): STATUS_CHANGE rows are
      // candidate-visible on the timeline.
      db.applicationEvent.create({
        data: {
          applicationId: interview.shortlist.applicationId,
          type: 'STATUS_CHANGE',
          fromStatus: appForEvent?.status ?? null,
          toStatus: 'INTERVIEWED',
          actorRole: 'SYSTEM',
          note: 'AI interview completed — awaiting recruiter review',
        },
      }),
    ])

    // 🔔 Report card moment: recruiter gets the full AI verdict; the candidate
    // gets a score-free confirmation (candidates never see their AI score).
    const appRow = await db.application.findUnique({
      where: { id: interview.shortlist.applicationId },
      select: {
        id: true,
        candidateId: true,
        job: {
          select: {
            id: true,
            title: true,
            company: true,
            recruiterId: true,
            recruiter: { select: { email: true, name: true } },
          },
        },
        candidate: { select: { email: true, name: true } },
      },
    })

    // 🎬 Video review package — the recruiter must be able to re-watch every
    // answer. Count the recordings captured for this interview (files live
    // under upload/interview-media and stream via /api/interview/media/[file]
    // with ownership checks) and hand the recruiter a direct pointer.
    const recordedAnswers = interview.answers.filter((a) => !!a.mediaPath)
    const recordingCount = recordedAnswers.length
    const totalRecordingSeconds = Math.round(
      recordedAnswers.reduce((sum, a) => sum + (a.mediaSeconds ?? 0), 0)
    )

    if (appRow) {
      const verdictEmoji =
        verdict === 'STRONG_HIRE'
          ? '🚀'
          : verdict === 'HIRE'
            ? '✅'
            : verdict === 'MAYBE'
              ? '🤔'
              : '❌'
      const meta = {
        jobId: appRow.job?.id,
        applicationId: appRow.id,
        shortlistId: interview.shortlistId,
        jobTitle: appRow.job?.title,
        candidateName: interview.candidateName,
        recordingCount,
      }
      const recordingSuffix =
        recordingCount > 0
          ? ` ${recordingCount} answer recording${recordingCount === 1 ? '' : 's'} are ready to watch.`
          : ''
      await notifyMany([
        ...(appRow.job?.recruiterId
          ? [
              {
                userId: appRow.job.recruiterId,
                type: 'INTERVIEW_DONE' as const,
                title: recordingCount > 0
                  ? `🎬 ${verdictEmoji} AI interview done · ${interview.candidateName} · ${overallScore.toFixed(1)}/10`
                  : `${verdictEmoji} AI interview done · ${interview.candidateName} · ${overallScore.toFixed(1)}/10`,
                body: `${interview.candidateName} finished the AI interview for ${appRow.job.title}. Verdict: ${verdict.replace('_', ' ')}.${recordingSuffix} Review the report, watch the recordings and record your final decision.`,
                meta,
              },
            ]
          : []),
        ...(appRow.candidateId
          ? [
              {
                userId: appRow.candidateId,
                type: 'INTERVIEW_DONE' as const,
                title: `🎤 Interview complete · ${appRow.job?.title ?? 'Your interview'}`,
                body: `Your interview responses are with the hiring team. They will review everything and update you here — track progress in My Journey.`,
                meta,
              },
            ]
          : []),
      ])

      // 📧 Interview-submitted email to the candidate's address (score-free —
      // it confirms the submission and what happens next, never the result).
      if (appRow.candidate) {
        const submitted = interviewSubmittedEmail({
          candidateName: appRow.candidate.name,
          jobTitle: appRow.job?.title ?? interview.jobTitle,
          company: appRow.job?.company ?? 'the hiring team',
        })
        void sendEmail({
          to: appRow.candidate.email,
          toUserId: appRow.candidateId,
          kind: 'INTERVIEW_SUBMITTED',
          subject: submitted.subject,
          body: submitted.body,
          meta: {
            jobId: appRow.job?.id,
            applicationId: appRow.id,
            shortlistId: interview.shortlistId,
            jobTitle: appRow.job?.title ?? interview.jobTitle,
          },
        })
      }

      // 🎬 Recording-ready email to the RECRUITER (the video link/review
      // pointer — candidates never receive employer-side review material).
      if (appRow.job?.recruiter && recordingCount > 0) {
        const ready = interviewRecordingReadyEmail({
          candidateName: interview.candidateName,
          jobTitle: appRow.job?.title ?? interview.jobTitle,
          company: appRow.job?.company ?? 'the hiring team',
          recordingCount,
          totalSeconds: totalRecordingSeconds,
        })
        void sendEmail({
          to: appRow.job.recruiter.email,
          toUserId: appRow.job.recruiterId,
          kind: 'INTERVIEW_RECORDING_READY',
          subject: ready.subject,
          body: ready.body,
          meta: {
            jobId: appRow.job?.id,
            applicationId: appRow.id,
            shortlistId: interview.shortlistId,
            interviewId: interview.id,
            recordingCount,
            totalRecordingSeconds,
          },
        })
      }
    }

    // Return a CANDIDATE-SAFE confirmation: the room only needs identity +
    // completion metadata. Score, verdict and the full report stay server-side
    // for recruiter surfaces (hub / reports), never serialized to the candidate.
    return NextResponse.json({
      data: {
        id: interview.id,
        shortlistId: interview.shortlistId,
        candidateName: interview.candidateName,
        jobTitle: interview.jobTitle,
        domain: interview.domain,
        difficulty: interview.difficulty,
        status: 'COMPLETED',
        completedAt: new Date().toISOString(),
        candidateCopy: true,
      },
    })
  } catch (error) {
    console.error('[interview/report] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 })
  }
}

interface ReportListItem {
  interviewId: string
  applicationId: string | null
  jobId: string | null
  candidateName: string
  candidateEmail: string
  jobTitle: string
  company: string
  clientName: string | null
  clientEmail: string | null
  clientDecision: string | null
  clientFeedback: string | null
  decidedAt: Date | null
  overallScore: number | null
  verdict: string | null
  aiSummary: string
  completedAt: Date | null
  interviewUrlHint: '/'
  /** per-question scores in qIndex order (null = unanswered/not scored) */
  questionScores: (number | null)[]
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const clientIdParam = searchParams.get('clientId')
    const recruiterId = searchParams.get('recruiterId')

    // SECURITY (audit verify-1): report listing is tenant-scoped ONLY. Without
    // a recruiterId or clientId the response would leak every company's
    // completed reports (scores, verdicts, candidate emails) — refuse instead.
    if (!clientIdParam && !recruiterId) {
      return NextResponse.json(
        { error: 'recruiterId or clientId is required — reports are tenant-scoped' },
        { status: 400 }
      )
    }

    // Build filter conditions
    const clientId =
      clientIdParam && clientIdParam !== 'ALL_CLIENTS' ? clientIdParam : null

    const interviewWhere: Prisma.InterviewWhereInput = { status: 'COMPLETED' }
    if (clientId || recruiterId) {
      interviewWhere.shortlist = {
        ...(clientId ? { clientId } : {}),
        ...(recruiterId ? { application: { is: { job: { is: { recruiterId } } } } } : {}),
      }
    }

    const interviews = await db.interview.findMany({
      where: interviewWhere,
      orderBy: { completedAt: 'desc' as const },
      include: {
        answers: { select: { qIndex: true, score: true }, orderBy: { qIndex: 'asc' as const } },
        shortlist: {
          include: {
            client: true,
            application: {
              include: {
                candidate: { select: { name: true, email: true } },
                job: { select: { id: true, title: true, company: true } },
              },
            },
          },
        },
      },
    })

    const items: ReportListItem[] = interviews.map((iv) => {
      let aiSummary = ''
      if (iv.report) {
        try {
          const obj = JSON.parse(iv.report)
          aiSummary = typeof obj?.aiSummary === 'string' ? obj.aiSummary : ''
        } catch (err) {
          console.error('[interview/report] Failed to parse stored report:', err)
        }
      }
      return {
        interviewId: iv.id,
        applicationId: iv.shortlist?.applicationId ?? null,
        jobId: iv.shortlist?.application?.job?.id ?? null,
        candidateName: iv.shortlist?.application?.candidate?.name ?? iv.candidateName,
        candidateEmail: iv.shortlist?.application?.candidate?.email ?? '',
        jobTitle: iv.shortlist?.application?.job?.title ?? iv.jobTitle,
        company: iv.shortlist?.application?.job?.company ?? '',
        clientName: iv.shortlist?.client?.name ?? null,
        clientEmail: iv.shortlist?.client?.contactEmail ?? null,
        clientDecision: iv.shortlist?.clientDecision ?? null,
        clientFeedback: iv.shortlist?.clientFeedback ?? null,
        decidedAt: iv.shortlist?.decidedAt ?? null,
        overallScore: iv.overallScore,
        verdict: iv.verdict,
        aiSummary,
        completedAt: iv.completedAt,
        interviewUrlHint: '/',
        questionScores: [...iv.answers]
          .sort((a, b) => a.qIndex - b.qIndex)
          .map((a) => (typeof a.score === 'number' ? a.score : null)),
      }
    })

    items.sort((a, b) => {
      const ta = a.completedAt ? new Date(a.completedAt).getTime() : 0
      const tb = b.completedAt ? new Date(b.completedAt).getTime() : 0
      return tb - ta
    })

    return NextResponse.json({ data: items })
  } catch (error) {
    console.error('[interview/report][GET] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to list reports' }, { status: 500 })
  }
}
