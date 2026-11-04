import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/* ------------------------------------------------------------------ */
/* Skill verification — server-side grading (never client-side)        */
/* ------------------------------------------------------------------ */

type BadgeLevel = 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE'

const BADGE_ORDER: BadgeLevel[] = ['NONE', 'BRONZE', 'SILVER', 'GOLD']

function badgeForPercentage(percentage: number): BadgeLevel {
  if (percentage >= 90) return 'GOLD'
  if (percentage >= 75) return 'SILVER'
  if (percentage >= 60) return 'BRONZE'
  return 'NONE'
}

function asBadge(value: unknown): BadgeLevel | null {
  return value === 'GOLD' || value === 'SILVER' || value === 'BRONZE' || value === 'NONE'
    ? value
    : null
}

interface StoredQuestion {
  qIndex: number
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

function parseQuestions(raw: string): StoredQuestion[] {
  try {
    const parsed = JSON.parse(raw) as StoredQuestion[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// POST /api/assessments/submit
//   { userId, assessmentId, answers: number[5] } → grade + review + domain summary
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      userId?: unknown
      assessmentId?: unknown
      answers?: unknown
    } | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { userId, assessmentId, answers } = body
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    if (typeof assessmentId !== 'string' || assessmentId.trim().length === 0) {
      return NextResponse.json({ error: 'assessmentId is required' }, { status: 400 })
    }
    if (
      !Array.isArray(answers) ||
      answers.length === 0 ||
      !answers.every((a) => typeof a === 'number' && Number.isInteger(a) && a >= 0 && a <= 3)
    ) {
      return NextResponse.json(
        { error: 'answers must be an array of option indexes (0-3)' },
        { status: 400 }
      )
    }

    const row = await db.skillAssessment.findUnique({
      where: { id: assessmentId.trim() },
    })
    if (!row) {
      return NextResponse.json({ error: 'Assessment not found' }, { status: 404 })
    }
    if (row.userId !== userId.trim()) {
      // an attempt may only be submitted by its owner
      return NextResponse.json({ error: 'This attempt belongs to another user' }, { status: 403 })
    }
    if (row.badge !== null || row.completedAt !== null) {
      return NextResponse.json(
        { error: 'This attempt has already been graded' },
        { status: 400 }
      )
    }

    const questions = parseQuestions(row.questions)
    if (questions.length === 0) {
      return NextResponse.json({ error: 'Assessment has no questions' }, { status: 500 })
    }
    if (answers.length !== questions.length) {
      return NextResponse.json(
        { error: `Expected ${questions.length} answers, received ${answers.length}` },
        { status: 400 }
      )
    }

    /* ------------------------------ grade ------------------------------ */
    let score = 0
    const review = questions.map((q) => {
      const chosen = answers[q.qIndex]
      const correct = chosen === q.correctIndex
      if (correct) score += 1
      return {
        qIndex: q.qIndex,
        question: q.question,
        chosen,
        chosenText: q.options[chosen] ?? '',
        correctIndex: q.correctIndex,
        correctText: q.options[q.correctIndex] ?? '',
        explanation: q.explanation,
        correct,
      }
    })

    const total = questions.length
    const percentage = Math.round((score / total) * 100)
    const badge = badgeForPercentage(percentage)

    await db.skillAssessment.update({
      where: { id: row.id },
      data: {
        answers: JSON.stringify(answers),
        score,
        percentage,
        badge,
        completedAt: new Date(),
      },
    })

    /* ------------------- updated summary for this domain ------------------- */
    const domainAttempts = await db.skillAssessment.findMany({
      where: { userId: row.userId, domain: row.domain, badge: { not: null } },
      select: { badge: true },
    })
    let bestBadge: BadgeLevel | null = null
    for (const a of domainAttempts) {
      const b = asBadge(a.badge)
      if (b && (bestBadge === null || BADGE_ORDER.indexOf(b) > BADGE_ORDER.indexOf(bestBadge))) {
        bestBadge = b
      }
    }

    return NextResponse.json({
      domain: row.domain,
      score,
      total,
      percentage,
      badge,
      domainSummary: { domain: row.domain, bestBadge },
      review,
    })
  } catch (err) {
    console.error('POST /api/assessments/submit failed:', err)
    return NextResponse.json({ error: 'Could not grade the assessment' }, { status: 500 })
  }
}
