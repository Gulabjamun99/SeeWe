// SeeWe - GET /api/interview/[id]
// Loads one interview with its answers (ordered), plus the shortlist's client
// and application/job context. questions & report JSON strings are parsed
// into objects before returning.
//
// candidateView=1 — privacy mode for the candidate's own surfaces: ALL AI
// evaluation data (overall score, verdict, report, per-answer scores,
// feedback, strengths, improvements) is stripped server-side so scores can
// never leak to the candidate through this endpoint.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { InterviewQuestion, InterviewReport } from '@/lib/types'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const url = new URL(request.url)
    const candidateView = url.searchParams.get('candidateView') === '1'
    // SECURITY (audit verify-1): viewer-scoped access. The interview's own
    // candidate (candidateView=1), the owning recruiter, or a CLIENT portal
    // user of the shortlist's client may read it — nobody else, id alone is
    // not enough (was an IDOR: full AI report leaked to any id holder).
    const viewerId = url.searchParams.get('viewerId')

    const interview = await db.interview.findUnique({
      where: { id },
      include: {
        answers: { orderBy: { qIndex: 'asc' as const } },
        shortlist: {
          include: {
            client: true,
            application: {
              include: {
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

    const candidateId = interview.shortlist?.application?.candidateId ?? null
    const jobRecruiterId = interview.shortlist?.application?.job?.recruiterId ?? null
    const clientId = interview.shortlist?.clientId ?? null

    let authorized = false
    if (viewerId) {
      if (candidateView && viewerId === candidateId) authorized = true
      if (!candidateView && viewerId && viewerId === jobRecruiterId) authorized = true
      if (!authorized && !candidateView && clientId) {
        const viewer = await db.user.findUnique({
          where: { id: viewerId },
          select: { role: true, clientId: true },
        })
        if (viewer?.role === 'CLIENT' && viewer.clientId === clientId) authorized = true
      }
    }
    if (!authorized) {
      return NextResponse.json(
        { error: 'Not authorized to view this interview' },
        { status: 403 }
      )
    }

    // Parse questions JSON string -> InterviewQuestion[]
    let parsedQuestions: InterviewQuestion[] = []
    try {
      const arr = JSON.parse(interview.questions ?? '[]')
      if (Array.isArray(arr)) parsedQuestions = arr as InterviewQuestion[]
    } catch (err) {
      console.error(`[interview/${id}] Failed to parse questions JSON:`, err)
    }

    // Parse report JSON string -> InterviewReport | null
    let parsedReport: InterviewReport | null = null
    if (interview.report) {
      try {
        const obj = JSON.parse(interview.report)
        if (obj && typeof obj === 'object') parsedReport = obj as InterviewReport
      } catch (err) {
        console.error(`[interview/${id}] Failed to parse report JSON:`, err)
      }
    }

    if (candidateView) {
      // Candidate privacy: evaluation fields are removed before serialization
      const { overallScore: _s, verdict: _v, report: _r, ...safeInterview } = interview
      return NextResponse.json({
        data: {
          ...safeInterview,
          questions: parsedQuestions,
          report: null,
          answers: interview.answers.map((a) => ({
            ...a,
            score: null,
            feedback: null,
            strengths: null,
            improvements: null,
          })),
        },
      })
    }

    return NextResponse.json({
      data: {
        ...interview,
        questions: parsedQuestions,
        report: parsedReport,
      },
    })
  } catch (error) {
    console.error('[interview/[id]] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to load interview' }, { status: 500 })
  }
}
