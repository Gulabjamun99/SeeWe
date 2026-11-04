import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type {
  ClientPortalReport,
  ClientPortalResponse,
  ClientPortalStats,
  Difficulty,
  InterviewReport,
  Verdict,
} from '@/lib/types'

/** lib/types is maintained separately — extend locally with what this API adds */
type ClientPortalReportWithRecordings = ClientPortalReport & {
  /** recorded answers (video/audio) attached to this report's interview */
  recordingsCount: number
}

/** Defensive JSON decode for the interview report blob */
function parseReport(raw?: string | null): InterviewReport | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as InterviewReport
    return null
  } catch {
    return null
  }
}

function safeQuestionsCount(raw?: string | null): number {
  if (!raw) return 0
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.length : 0
  } catch {
    return 0
  }
}

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get('clientId')
    if (!clientId) {
      return NextResponse.json({ error: 'Query param clientId is required' }, { status: 400 })
    }

    const client = await db.client.findUnique({ where: { id: clientId } })
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Every report shared with this client, newest first
    const shortlists = await db.shortlist.findMany({
      where: { clientId: client.id, status: 'REPORT_SHARED' },
      include: {
        interview: { include: { answers: { select: { id: true, mediaPath: true } } } },
        application: {
          include: {
            job: { select: { id: true, title: true, company: true, location: true } },
            candidate: {
              select: {
                id: true,
                name: true,
                headline: true,
                location: true,
                skills: true,
                experienceYears: true,
                expectedSalary: true,
                noticePeriodDays: true,
                avatarSeed: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    const reports: ClientPortalReportWithRecordings[] = shortlists
      .filter((s) => s.interview && s.interview.status === 'COMPLETED')
      .map((s) => {
        const iv = s.interview!
        return {
          shortlistId: s.id,
          sharedAt: s.createdAt.toISOString(),
          recruiterNote: s.recruiterNote,
          clientDecision: (s.clientDecision as ClientPortalReport['clientDecision']) ?? null,
          clientFeedback: s.clientFeedback,
          decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
          interview: {
            id: iv.id,
            candidateName: iv.candidateName,
            jobTitle: iv.jobTitle,
            domain: iv.domain,
            difficulty: iv.difficulty as Difficulty,
            overallScore: iv.overallScore,
            verdict: (iv.verdict as Verdict) ?? null,
            completedAt: iv.completedAt ? iv.completedAt.toISOString() : null,
            questionsAnswered: iv.answers?.length ?? safeQuestionsCount(iv.questions),
            totalQuestions: safeQuestionsCount(iv.questions),
            report: parseReport(iv.report),
          },
          candidate: {
            id: s.application.candidate.id,
            name: s.application.candidate.name,
            headline: s.application.candidate.headline,
            location: s.application.candidate.location,
            skills: s.application.candidate.skills,
            experienceYears: s.application.candidate.experienceYears ?? null,
            expectedSalary: s.application.candidate.expectedSalary ?? null,
            noticePeriodDays: s.application.candidate.noticePeriodDays ?? null,
            avatarSeed: s.application.candidate.avatarSeed,
          },
          job: s.application.job,
          // recorded answers power the client-facing "Download recordings (ZIP)" action
          recordingsCount: (iv.answers ?? []).filter((a) => a.mediaPath).length,
        }
      })

    // ---- stats ----
    const scored = reports.filter((r) => r.interview.overallScore != null)
    const avgScore =
      scored.length > 0
        ? Math.round(
            (scored.reduce((sum, r) => sum + (r.interview.overallScore ?? 0), 0) / scored.length) * 10
          ) / 10
        : null

    const verdictCounts: Record<string, number> = {
      STRONG_HIRE: 0,
      HIRE: 0,
      MAYBE: 0,
      NO_HIRE: 0,
    }
    for (const r of reports) {
      if (r.interview.verdict && verdictCounts[r.interview.verdict] != null) {
        verdictCounts[r.interview.verdict] += 1
      }
    }

    const stats: ClientPortalStats = {
      totalReports: reports.length,
      avgScore,
      verdictCounts,
      pendingDecisions: reports.filter((r) => !r.clientDecision).length,
      approved: reports.filter((r) => r.clientDecision === 'APPROVED').length,
      rejected: reports.filter((r) => r.clientDecision === 'REJECTED').length,
      strongHireRate:
        reports.length > 0 ? Math.round((verdictCounts.STRONG_HIRE / reports.length) * 100) : 0,
    }

    const payload: ClientPortalResponse = {
      client: {
        id: client.id,
        name: client.name,
        contactEmail: client.contactEmail,
        industry: client.industry,
        notes: client.notes,
        addedBy: client.addedBy,
        createdAt: client.createdAt.toISOString(),
      },
      reports,
      stats,
    }

    return NextResponse.json({ data: payload })
  } catch (err) {
    console.error('GET /api/client-portal failed:', err)
    return NextResponse.json(
      { error: 'Failed to load client portal' },
      { status: 500 }
    )
  }
}
