// SeeWe - GET /api/interview/by-token?token=...
// Two-way AI video interview deep link: the candidate lands on
// /?interview=<token> and this endpoint validates the token WITHOUT any
// session, returning exactly what the pre-interview SystemCheck screen needs.
//
// Errors: 404 unknown token · 410 expired token.
// PRIVACY: the payload NEVER includes any score/evaluation/report data —
// only question text, format, time limit and the skippable flag.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { findApplicationByToken } from '@/lib/interview-token'
import type { InterviewQuestion } from '@/lib/types'

export const dynamic = 'force-dynamic'

function parseStoredQuestions(raw: string | null | undefined): InterviewQuestion[] {
  try {
    const arr = JSON.parse(raw ?? '[]')
    return Array.isArray(arr) ? (arr as InterviewQuestion[]) : []
  } catch {
    return []
  }
}

export async function GET(request: Request) {
  try {
    const token = new URL(request.url).searchParams.get('token')?.trim() ?? ''
    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 })
    }

    const app = await findApplicationByToken(token)
    if (!app) {
      return NextResponse.json(
        { valid: false, error: 'Interview link not recognized' },
        { status: 404 }
      )
    }
    if (app.tokenExpiry && app.tokenExpiry.getTime() < Date.now()) {
      return NextResponse.json(
        { valid: false, expired: true, error: 'This interview link has expired — ask the hiring team to re-send the invite.' },
        { status: 410 }
      )
    }

    const job = await db.job.findUnique({
      where: { id: app.jobId },
      select: { title: true, company: true, location: true, aiInterviewEnabled: true },
    })
    const candidate = await db.user.findUnique({
      where: { id: app.candidateId },
      select: { name: true },
    })
    if (!job || !candidate) {
      return NextResponse.json(
        { valid: false, error: 'The job or candidate behind this link no longer exists' },
        { status: 404 }
      )
    }

    // The invite flow creates the interview; legacy/token-before-interview
    // edge cases return interview: null so the UI can fall back to start.
    const shortlist = await db.shortlist.findFirst({
      where: { applicationId: app.id },
      orderBy: { createdAt: 'desc' as const },
      include: { interview: true },
    })
    const interview = shortlist?.interview ?? null

    // SAME question shape /api/interview/start returns, remapped to the
    // token-boot contract: {qIndex, text, type, timeLimitSec, isSkippable}.
    const questions = interview
      ? parseStoredQuestions(interview.questions).map((q) => ({
          qIndex: q.qIndex,
          text: q.question,
          type: q.type ?? 'VOICE',
          timeLimitSec: q.timeLimitSec ?? 0,
          isSkippable: q.isSkippable === true,
        }))
      : []

    return NextResponse.json({
      data: {
        valid: true,
        expired: false,
        jobTitle: job.title,
        company: job.company,
        location: job.location,
        candidateName: candidate.name,
        applicationStatus: app.status,
        status: app.status,
        expiresAt: app.tokenExpiry ? app.tokenExpiry.toISOString() : null,
        interview: interview
          ? {
              id: interview.id,
              status: interview.status,
              questions,
            }
          : null,
      },
    })
  } catch (error) {
    console.error('[interview/by-token] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to validate interview link' }, { status: 500 })
  }
}
