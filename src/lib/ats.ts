// SeeWe - ATS dossier builder
// Builds the full structured candidate dossier that recruiters push into their
// own Applicant Tracking System (ATS). One interview = one complete,
// self-contained JSON document: candidate profile, position, application
// timeline, the entire AI interview (plan + answers + recordings metadata +
// scores) and the final report.
// Used by /api/ats/payload (copy/download) and /api/ats/push (webhook POST).

import { db } from '@/lib/db'
import type { InterviewQuestion, InterviewReport } from '@/lib/types'

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return (JSON.parse(raw) ?? fallback) as T
  } catch {
    return fallback
  }
}

export interface AtsDossier {
  schema: 'seewee.ats.candidate-dossier/v1'
  generatedAt: string
  candidate: {
    id: string
    name: string
    email: string
    phone: string | null
    headline: string | null
    location: string | null
    skills: string[]
    experienceYears: number | null
    currentSalaryLpa: number | null
    expectedSalaryLpa: number | null
    noticePeriodDays: number | null
    education: string | null
    resumeSummary: string | null
  }
  position: {
    id: string
    title: string
    company: string
    location: string
    jobType: string
    workMode: string
    requiredSkills: string[]
    experienceMin: number
    experienceMax: number
    salaryMinLpa: number | null
    salaryMaxLpa: number | null
    openings: number
    status: string
  }
  application: {
    id: string
    status: string
    matchScore: number | null
    appliedAt: string
    viewedByRecruiterAt: string | null
    cvFileName: string | null
    cvMimeType: string | null
    /** relative URL on this instance — streams the exact CV the candidate applied with */
    cvDownloadUrl: string | null
  }
  interview: {
    id: string
    type: 'AI_VIDEO'
    status: string
    difficulty: string
    startedAt: string | null
    completedAt: string | null
    overallScore: number | null
    verdict: string | null
    questions: Array<{
      qIndex: number
      question: string
      focusArea: string
      kind: string
      modelAnswerPoints: string[]
    }>
    answers: Array<{
      qIndex: number
      question: string
      transcript: string | null
      score: number | null
      feedback: string | null
      strengths: string[]
      improvements: string[]
      recordingKind: 'video' | 'audio' | null
      recordingSeconds: number | null
      take: string | null
    }>
    report: (InterviewReport & { candidateDetails?: unknown }) | null
  }
  process: {
    shortlistId: string
    shortlistStatus: string
    clientName: string | null
    clientDecision: string | null
    clientFeedback: string | null
    decidedAt: string | null
  }
}

/** Load one interview and compile the full ATS-ready dossier. Null if missing. */
export async function buildAtsDossier(interviewId: string): Promise<AtsDossier | null> {
  const interview = await db.interview.findUnique({
    where: { id: interviewId },
    include: {
      answers: { orderBy: { qIndex: 'asc' as const } },
      shortlist: {
        include: {
          client: { select: { id: true, name: true } },
          application: {
            include: {
              job: true,
              candidate: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                  headline: true,
                  location: true,
                  skills: true,
                  experienceYears: true,
                  currentSalary: true,
                  expectedSalary: true,
                  noticePeriodDays: true,
                  education: true,
                  resumeText: true,
                },
              },
            },
          },
        },
      },
    },
  })
  if (!interview?.shortlist?.application) return null

  const app = interview.shortlist.application
  const cand = app.candidate
  const job = app.job
  const questionPlan = parseJsonSafe<InterviewQuestion[]>(interview.questions, [])
  const report = parseJsonSafe<InterviewReport | null>(interview.report, null)

  const strengthsOf = (raw: string | null): string[] => parseJsonSafe<string[]>(raw, [])
  const mediaKind = (k: string | null): 'video' | 'audio' | null =>
    k === 'video' || k === 'audio' ? k : null

  return {
    schema: 'seewee.ats.candidate-dossier/v1',
    generatedAt: new Date().toISOString(),
    candidate: {
      id: cand.id,
      name: cand.name,
      email: cand.email,
      phone: cand.phone,
      headline: cand.headline,
      location: cand.location,
      skills: (cand.skills ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      experienceYears: cand.experienceYears,
      currentSalaryLpa: cand.currentSalary,
      expectedSalaryLpa: cand.expectedSalary,
      noticePeriodDays: cand.noticePeriodDays,
      education: cand.education,
      resumeSummary: cand.resumeText ? cand.resumeText.slice(0, 2000) : null,
    },
    position: {
      id: job.id,
      title: job.title,
      company: job.company,
      location: job.location,
      jobType: job.jobType,
      workMode: job.workMode,
      requiredSkills: (job.skills ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      experienceMin: job.experienceMin,
      experienceMax: job.experienceMax,
      salaryMinLpa: job.salaryMinLpa,
      salaryMaxLpa: job.salaryMaxLpa,
      openings: job.openings,
      status: job.status,
    },
    application: {
      id: app.id,
      status: app.status,
      matchScore: app.matchScore,
      appliedAt: app.createdAt.toISOString(),
      viewedByRecruiterAt: app.viewedAt ? app.viewedAt.toISOString() : null,
      cvFileName: app.cvFileName ?? null,
      cvMimeType: app.cvMimeType ?? null,
      cvDownloadUrl: app.cvFileName ? `/api/applications/${app.id}/cv` : null,
    },
    interview: {
      id: interview.id,
      type: 'AI_VIDEO',
      status: interview.status,
      difficulty: interview.difficulty,
      startedAt: interview.startedAt ? interview.startedAt.toISOString() : null,
      completedAt: interview.completedAt ? interview.completedAt.toISOString() : null,
      overallScore: interview.overallScore,
      verdict: interview.verdict,
      questions: questionPlan.map((q) => ({
        qIndex: q.qIndex,
        question: q.question,
        focusArea: q.focusArea ?? '',
        kind: q.kind ?? 'CORE',
        modelAnswerPoints: q.modelAnswerPoints ?? [],
      })),
      answers: interview.answers.map((a) => ({
        qIndex: a.qIndex,
        question: a.question,
        transcript: a.transcript,
        score: a.score,
        feedback: a.feedback,
        strengths: strengthsOf(a.strengths),
        improvements: strengthsOf(a.improvements),
        recordingKind: mediaKind(a.mediaKind),
        recordingSeconds: a.mediaSeconds,
        take: a.takeLabel,
      })),
      report,
    },
    process: {
      shortlistId: interview.shortlistId,
      shortlistStatus: interview.shortlist.status,
      clientName: interview.shortlist.client?.name ?? null,
      clientDecision: interview.shortlist.clientDecision,
      clientFeedback: interview.shortlist.clientFeedback,
      decidedAt: interview.shortlist.decidedAt ? interview.shortlist.decidedAt.toISOString() : null,
    },
  }
}
