// SeeWe - GET /api/interview/hub?recruiterId=...
// One-stop recruiter view: every position's AI interviews with the full
// question plan, candidate answers + transcripts, per-question scores, the
// overall verdict, auto-captured profile details (location / experience /
// notice / CTC) and the generated report — grouped by job.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { InterviewQuestion, InterviewReport } from '@/lib/types'

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed ?? fallback) as T
  } catch {
    return fallback
  }
}

interface HubAnswer {
  qIndex: number
  question: string
  transcript: string | null
  score: number | null
  feedback: string | null
  audioPresent: boolean
  mediaPath: string | null
  mediaKind: string | null
  mediaSeconds: number | null
}

interface HubInterview {
  id: string
  status: string
  difficulty: string
  overallScore: number | null
  verdict: string | null
  startedAt: Date | null
  completedAt: Date | null
  applicationId: string | null
  candidateName: string
  candidateId: string | null
  candidateEmail: string
  clientName: string | null
  questions: InterviewQuestion[]
  answers: HubAnswer[]
  report: InterviewReport | null
  /** how many answers carry a video/audio recording (recruiter review + email pointer) */
  mediaCount: number
  /** the HUMAN final call — the AI verdict above is advisory only */
  recruiterDecision: string | null
  recruiterDecisionNote: string | null
  recruiterDecidedAt: string | null
  profile: {
    location: string | null
    experienceYears: number | null
    noticePeriodDays: number | null
    currentSalary: number | null
    expectedSalary: number | null
    phone: string | null
    headline: string | null
    skills: string[]
    education: string | null
    resumeSummary: string | null
    matchScore: number | null
    appliedAt: Date | null
    viewedAt: Date | null
    applicationStatus: string | null
    shortlistStatus: string | null
    clientDecision: string | null
  }
}

interface HubJobGroup {
  jobId: string
  jobTitle: string
  company: string
  jobLocation: string
  jobStatus: string
  openings: number
  total: number
  completed: number
  inProgress: number
  avgScore: number | null
  verdictCounts: Record<string, number>
  interviews: HubInterview[]
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const recruiterId = searchParams.get('recruiterId')?.trim() ?? ''
    if (!recruiterId) {
      return NextResponse.json({ error: 'recruiterId is required' }, { status: 400 })
    }

    const [jobs, interviews] = await Promise.all([
      db.job.findMany({
        where: { recruiterId },
        orderBy: { createdAt: 'desc' as const },
        select: {
          id: true,
          title: true,
          company: true,
          location: true,
          status: true,
          openings: true,
        },
      }),
      db.interview.findMany({
        where: { shortlist: { application: { job: { recruiterId } } } },
        orderBy: { createdAt: 'desc' as const },
        include: {
          answers: { orderBy: { qIndex: 'asc' as const } },
          shortlist: {
            select: {
              status: true,
              clientDecision: true,
              client: { select: { name: true } },
              application: {
                select: {
                  id: true,
                  status: true,
                  matchScore: true,
                  createdAt: true,
                  viewedAt: true,
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
                      noticePeriodDays: true,
                      currentSalary: true,
                      expectedSalary: true,
                      education: true,
                      resumeText: true,
                    },
                  },
                  job: { select: { id: true } },
                },
              },
            },
          },
        },
      }),
    ])

    const interviewsByJob = new Map<string, typeof interviews>()
    for (const iv of interviews) {
      const jobId = iv.shortlist?.application?.job?.id
      if (!jobId) continue
      const list = interviewsByJob.get(jobId) ?? []
      list.push(iv)
      interviewsByJob.set(jobId, list)
    }

    function mapInterview(iv: (typeof interviews)[number]): HubInterview {
      const cand = iv.shortlist?.application?.candidate
      return {
        id: iv.id,
        status: iv.status,
        difficulty: iv.difficulty,
        overallScore: iv.overallScore,
        verdict: iv.verdict,
        startedAt: iv.startedAt,
        completedAt: iv.completedAt,
        applicationId: iv.shortlist?.application?.id ?? null,
        candidateName: iv.candidateName,
        candidateId: cand?.id ?? null,
        candidateEmail: cand?.email ?? '',
        clientName: iv.shortlist?.client?.name ?? null,
        questions: parseJsonSafe<InterviewQuestion[]>(iv.questions, []),
        answers: iv.answers.map((a) => ({
          qIndex: a.qIndex,
          question: a.question,
          transcript: a.transcript,
          score: a.score,
          feedback: a.feedback,
          audioPresent: a.audioPresent,
          mediaPath: a.mediaPath,
          mediaKind: a.mediaKind,
          mediaSeconds: a.mediaSeconds,
        })),
        report: parseJsonSafe<InterviewReport | null>(iv.report, null),
        mediaCount: iv.answers.filter((a) => !!a.mediaPath).length,
        recruiterDecision: iv.recruiterDecision,
        recruiterDecisionNote: iv.recruiterDecisionNote,
        recruiterDecidedAt: iv.recruiterDecidedAt ? iv.recruiterDecidedAt.toISOString() : null,
        profile: {
          location: cand?.location ?? null,
          experienceYears: cand?.experienceYears ?? null,
          noticePeriodDays: cand?.noticePeriodDays ?? null,
          currentSalary: cand?.currentSalary ?? null,
          expectedSalary: cand?.expectedSalary ?? null,
          phone: cand?.phone ?? null,
          headline: cand?.headline ?? null,
          skills: (cand?.skills ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          education: cand?.education ?? null,
          resumeSummary: cand?.resumeText ? cand.resumeText.slice(0, 600) : null,
          matchScore: iv.shortlist?.application?.matchScore ?? null,
          appliedAt: iv.shortlist?.application?.createdAt ?? null,
          viewedAt: iv.shortlist?.application?.viewedAt ?? null,
          applicationStatus: iv.shortlist?.application?.status ?? null,
          shortlistStatus: iv.shortlist?.status ?? null,
          clientDecision: iv.shortlist?.clientDecision ?? null,
        },
      }
    }

    const groups: HubJobGroup[] = jobs
      .map((job) => {
        const list = (interviewsByJob.get(job.id) ?? []).map(mapInterview)
        const completedList = list.filter((iv) => iv.status === 'COMPLETED')
        const verdictCounts: Record<string, number> = {}
        for (const iv of completedList) {
          if (iv.verdict) verdictCounts[iv.verdict] = (verdictCounts[iv.verdict] ?? 0) + 1
        }
        return {
          jobId: job.id,
          jobTitle: job.title,
          company: job.company,
          jobLocation: job.location,
          jobStatus: job.status,
          openings: job.openings,
          total: list.length,
          completed: completedList.length,
          inProgress: list.filter((iv) => iv.status === 'IN_PROGRESS').length,
          avgScore:
            completedList.length > 0
              ? Math.round(
                  (completedList.reduce((s, iv) => s + (iv.overallScore ?? 0), 0) / completedList.length) * 10
                ) / 10
              : null,
          verdictCounts,
          interviews: list,
        }
      })
      .filter((g) => g.total > 0)
      .sort((a, b) => b.total - a.total)

    const allInterviews = groups.flatMap((g) => g.interviews)
    const completedAll = allInterviews.filter((iv) => iv.status === 'COMPLETED')

    return NextResponse.json({
      data: {
        summary: {
          positions: groups.length,
          totalInterviews: allInterviews.length,
          completed: completedAll.length,
          inProgress: allInterviews.filter((iv) => iv.status === 'IN_PROGRESS').length,
          avgScore:
            completedAll.length > 0
              ? Math.round(
                  (completedAll.reduce((s, iv) => s + (iv.overallScore ?? 0), 0) / completedAll.length) * 10
                ) / 10
              : null,
        },
        groups,
      },
    })
  } catch (error) {
    console.error('[interview/hub] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to load interview hub' }, { status: 500 })
  }
}
