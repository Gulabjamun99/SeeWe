import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson } from '@/lib/ai-client'

/* -------------------------------------------------------------------------- */
/* Mock interview PRACTICE mode — grading + candidate-private report           */
/* PRIVACY: practice answers, scores and reports are NEVER surfaced to         */
/* recruiters or client users. No recruiter-facing endpoint reads the          */
/* MockInterview table; these routes are candidate-owner-only (403 otherwise). */
/* This is the candidate's self-improvement gym, not an employer evaluation.   */
/* -------------------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

const MIN_ANSWER_CHARS = 10

interface StoredQuestion {
  qIndex: number
  question: string
  focusArea: string
  tip: string
}

function parseQuestions(raw: string): StoredQuestion[] {
  try {
    const parsed = JSON.parse(raw) as StoredQuestion[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function clampText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/* ------------------------------ AI per-question ----------------------------- */

interface AiPerQuestion {
  score?: unknown
  feedback?: unknown
  sampleAnswer?: unknown
}

interface GradedQuestion {
  qIndex: number
  score: number
  feedback: string
  sampleAnswer: string
  source: 'ai' | 'heuristic'
}

async function gradeWithAi(
  q: StoredQuestion,
  difficulty: string,
  track: string,
  answer: string
): Promise<GradedQuestion> {
  const system = [
    'You are a supportive interview coach for a professional hiring platform.',
    'You grade PRACTICE interview answers privately for the candidate who wrote them — this is practice feedback, not an employer evaluation.',
    'Be honest but encouraging; reward structure, specificity and concrete evidence; do not reward buzzwords without substance.',
    'You ALWAYS reply with strict JSON only — no markdown fences, no commentary.',
  ].join(' ')

  const user = [
    `PRACTICE interview track: "${track}" (${difficulty}).`,
    `Question: ${q.question}`,
    `Skill tested: ${q.focusArea}`,
    `Coaching tip the candidate saw: ${q.tip}`,
    `Candidate's practice answer:\n"""${answer}"""`,
    'Grade the answer on 0-100 where 60+ means an interviewer would be satisfied.',
    'Rules:',
    '- "score": integer 0-100.',
    '- "feedback": 2-3 sentences written TO the candidate — one thing done well, one concrete improvement, plain language, no tool brand names.',
    '- "sampleAnswer": 2-4 sentences showing how a strong answer to THIS question would sound (may reuse the candidate\u2019s ideas where they are good).',
    'Reply with ONLY this JSON shape:',
    '{"score": 0, "feedback": "string", "sampleAnswer": "string"}',
  ].join('\n')

  const raw = await chatWithRetry(system, user)
  const parsed = extractJson<AiPerQuestion>(raw)
  const score = typeof parsed?.score === 'number' ? clamp(Math.round(parsed.score), 0, 100) : null
  const feedback = typeof parsed?.feedback === 'string' ? parsed.feedback.trim() : ''
  const sampleAnswer = typeof parsed?.sampleAnswer === 'string' ? parsed.sampleAnswer.trim() : ''
  if (score === null || feedback.length < 15 || sampleAnswer.length < 25) {
    throw new Error('AI per-question payload failed validation')
  }
  return {
    qIndex: q.qIndex,
    score,
    feedback: clampText(feedback, 600),
    sampleAnswer: clampText(sampleAnswer, 900),
    source: 'ai',
  }
}

/* --------------------------- heuristic fallback ----------------------------- */
/* Deterministic offline grading when the LLM is unavailable. Honest and clearly
 * labelled as a simplified review: it can reward length, structure, concrete
 * detail and keyword coverage, and it deliberately caps below what a real
 * interviewer judgment could give. */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'your', 'you', 'have', 'what', 'when', 'how',
  'would', 'could', 'from', 'into', 'about', 'there', 'their', 'them', 'then', 'than', 'will',
  'does', 'did', 'was', 'were', 'are', 'not', 'but', 'all', 'any', 'can', 'each', 'which', 'where',
  'give', 'tell', 'describe', 'explain', 'example',
])

function questionKeywords(question: string): string[] {
  const words = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
  return Array.from(new Set(words)).slice(0, 10)
}

function heuristicGrade(
  q: StoredQuestion,
  track: string,
  answer: string
): GradedQuestion {
  const text = answer.trim()
  const lower = text.toLowerCase()
  const words = text.split(/\s+/).filter(Boolean)
  const wordCount = words.length

  // Near-empty answer: honest floor score, honest copy.
  if (text.length < MIN_ANSWER_CHARS) {
    return {
      qIndex: q.qIndex,
      score: 8,
      feedback:
        'Offline review (simplified mode): the answer is too short to demonstrate your thinking — aim for a couple of minutes of structured speaking. Name your approach, one concrete example and the result you achieved.',
      sampleAnswer: clampText(
        `A strong answer on ${q.focusArea} would take a clear position, then support it: for instance, walk through one specific situation or design choice, the actions you took, and how the outcome was measured. ${q.tip}`,
        900
      ),
      source: 'heuristic',
    }
  }

  // Length band (word count → base score).
  let score: number
  if (wordCount < 15) score = 25
  else if (wordCount < 40) score = 40
  else if (wordCount < 100) score = 55
  else if (wordCount < 200) score = 62
  else score = 68

  // Specificity signals: metrics/numbers and concrete connectors.
  const hasDigits = /\d/.test(text)
  if (hasDigits) score += 5
  const connectors = ['because', 'for example', 'e.g.', 'so that', 'as a result', 'instead', 'trade-off', 'tradeoff']
  const connectorHits = connectors.filter((c) => lower.includes(c)).length
  score += Math.min(6, connectorHits * 3)

  // Keyword coverage vs the question (technical reasoning proxy).
  const keywords = questionKeywords(q.question)
  if (keywords.length > 0) {
    const covered = keywords.filter((k) => lower.includes(k)).length
    score += Math.min(8, Math.round((covered / keywords.length) * 8))
  }

  // STAR structure for behavioral questions.
  const isBehavioral = track === 'Behavioral / HR'
  if (isBehavioral) {
    const starGroups = [
      ['situation', 'context', 'at the time', 'we were', 'challenge'],
      ['my role', 'i was responsible', 'my task', 'i had to', 'i decided', 'i proposed'],
      ['i ', 'we ', 'action', 'implemented', 'built', 'wrote', 'organised', 'organized'],
      ['result', 'outcome', 'learned', 'impact', 'shipped', 'improved'],
    ]
    const groupsHit = starGroups.filter((group) => group.some((g) => lower.includes(g))).length
    if (groupsHit >= 3) score += 6
    if (groupsHit >= 4) score += 3
  }

  score = clamp(Math.round(score), 5, 80) // heuristic cap — honest limit of offline review

  const strengthsBits: string[] = []
  if (wordCount >= 40) strengthsBits.push(`a workable length (${wordCount} words)`)
  if (hasDigits) strengthsBits.push('concrete numbers')
  if (connectorHits > 0) strengthsBits.push('explicit reasoning')
  const strong =
    strengthsBits.length > 0
      ? `It shows ${strengthsBits.join(', ')}.`
      : 'It gets the core idea across.'
  const improve = isBehavioral
    ? 'Structure it as STAR — the situation, your actions, and the measurable result — to make it land.'
    : `Tie your approach back to ${q.focusArea}: name the trade-off you chose and how you would verify it worked.`

  return {
    qIndex: q.qIndex,
    score,
    feedback: clampText(
      `Offline review (simplified mode): ${strong} ${improve}`,
      600
    ),
    sampleAnswer: clampText(
      `A strong answer on ${q.focusArea} would: ${q.tip} For example — one concrete situation or design choice, the specific actions taken, and an outcome that could be measured.`,
      900
    ),
    source: 'heuristic',
  }
}

/* ------------------------------ AI overall call ----------------------------- */

interface AiOverall {
  overallScore?: unknown
  strengths?: unknown
  focusAreas?: unknown
  summary?: unknown
}

interface PracticeReport {
  overallScore: number
  strengths: string[]
  focusAreas: string[]
  summary: string
  perQuestion: { qIndex: number; score: number; feedback: string; sampleAnswer: string }[]
  source: 'ai' | 'heuristic'
  completedAt: string
}

function sanitiseStringList(value: unknown, minItems: number, maxItems: number, maxLen: number): string[] | null {
  if (!Array.isArray(value)) return null
  const clean = value
    .filter((v): v is string => typeof v === 'string' && v.trim().length >= 3)
    .map((v) => clampText(v, maxLen))
  const deduped = Array.from(new Set(clean))
  return deduped.length >= minItems ? deduped.slice(0, maxItems) : null
}

async function overallWithAi(
  track: string,
  difficulty: string,
  questions: StoredQuestion[],
  answers: string[],
  graded: GradedQuestion[]
): Promise<{ overallScore: number; strengths: string[]; focusAreas: string[]; summary: string }> {
  const system = [
    'You are a supportive interview coach writing a private PRACTICE report for the candidate who answered — never an employer evaluation.',
    'You ALWAYS reply with strict JSON only — no markdown fences, no commentary.',
  ].join(' ')

  const transcript = questions
    .map((q) => {
      const g = graded.find((x) => x.qIndex === q.qIndex)
      return [
        `Q${q.qIndex + 1} (${q.focusArea}): ${q.question}`,
        `Candidate answer: ${answers[q.qIndex] ?? ''}`,
        `Graded score: ${g?.score ?? 0}/100`,
      ].join('\n')
    })
    .join('\n\n')

  const user = [
    `PRACTICE track: "${track}" (${difficulty}).`,
    transcript,
    'Write the overall practice report.',
    'Rules:',
    '- "overallScore": integer 0-100, consistent with the per-question scores.',
    '- "strengths": 2-4 short skill areas the candidate did WELL (each ≤ 8 words).',
    '- "focusAreas": 2-4 short skill areas to IMPROVE next (each ≤ 8 words) — these help the candidate pick their next practice track.',
    '- "summary": 2-3 encouraging sentences, honest about the weakest part, no tool brand names.',
    'Reply with ONLY this JSON shape:',
    '{"overallScore": 0, "strengths": ["string"], "focusAreas": ["string"], "summary": "string"}',
  ].join('\n')

  const raw = await chatWithRetry(system, user)
  const parsed = extractJson<AiOverall>(raw)
  const overallScore =
    typeof parsed?.overallScore === 'number' ? clamp(Math.round(parsed.overallScore), 0, 100) : null
  const strengths = sanitiseStringList(parsed?.strengths, 2, 4, 60)
  const focusAreas = sanitiseStringList(parsed?.focusAreas, 2, 4, 60)
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : ''
  if (overallScore === null || !strengths || !focusAreas || summary.length < 20) {
    throw new Error('AI overall payload failed validation')
  }
  return { overallScore, strengths, focusAreas, summary: clampText(summary, 500) }
}

function heuristicOverall(
  track: string,
  graded: GradedQuestion[],
  questions: StoredQuestion[]
): { overallScore: number; strengths: string[]; focusAreas: string[]; summary: string } {
  const avg = Math.round(graded.reduce((a, g) => a + g.score, 0) / Math.max(1, graded.length))
  const overallScore = clamp(avg, 5, 80)

  const withArea = graded.map((g) => {
    const q = questions.find((x) => x.qIndex === g.qIndex)
    return { ...g, area: q?.focusArea ?? track }
  })
  const sorted = [...withArea].sort((a, b) => b.score - a.score)
  const strengths = Array.from(new Set(sorted.slice(0, 2).map((g) => g.area))).map(
    (a) => `Working approach to ${a.toLowerCase()}`
  )
  let focusAreas = Array.from(new Set(sorted.slice(-2).map((g) => g.area)))
  if (focusAreas.length < 2) focusAreas = Array.from(new Set([track, ...focusAreas]))

  const band =
    overallScore >= 75
      ? 'Strong practice run'
      : overallScore >= 50
        ? 'Solid base to build on'
        : 'Early practice — keep going'
  const summary = clampText(
    `${band}: you averaged ${overallScore}/100 across ${graded.length} questions. This offline review rewards length, structure and concrete detail — the scores are indicative, not a judgment of your potential. Focus your next run on ${focusAreas[0]?.toLowerCase() ?? track}.`,
    500
  )
  return {
    overallScore,
    strengths: strengths.length >= 2 ? strengths : [`Working approach to ${track.toLowerCase()}`, 'Persistence'],
    focusAreas: focusAreas.slice(0, 4),
    summary,
  }
}

/* ---------------------------------- POST ----------------------------------- */

// POST /api/ai/mock-interview/submit { userId, mockId, answers: string[3] }
// Owner-only grading of a practice session. 403 for any other caller;
// practice reports are never readable by recruiters or clients.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      userId?: unknown
      mockId?: unknown
      answers?: unknown
    } | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { userId, mockId, answers } = body
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    if (typeof mockId !== 'string' || mockId.trim().length === 0) {
      return NextResponse.json({ error: 'mockId is required' }, { status: 400 })
    }
    if (!Array.isArray(answers) || !answers.every((a) => typeof a === 'string')) {
      return NextResponse.json({ error: 'answers must be an array of 3 text answers' }, { status: 400 })
    }

    const row = await db.mockInterview.findUnique({ where: { id: mockId.trim() } })
    if (!row) {
      return NextResponse.json({ error: 'Practice session not found' }, { status: 404 })
    }
    // Owner-only: a practice session may only be submitted by the candidate it belongs to.
    if (row.userId !== userId.trim()) {
      return NextResponse.json(
        { error: 'This practice session belongs to another user' },
        { status: 403 }
      )
    }
    if (row.status === 'COMPLETED' || row.report !== null) {
      return NextResponse.json(
        { error: 'This practice session has already been completed' },
        { status: 400 }
      )
    }

    const questions = parseQuestions(row.questions)
    if (questions.length === 0) {
      return NextResponse.json({ error: 'Practice session has no questions' }, { status: 500 })
    }
    if (answers.length !== questions.length) {
      return NextResponse.json(
        { error: `Expected ${questions.length} answers, received ${answers.length}` },
        { status: 400 }
      )
    }
    if (answers.some((a) => a.trim().length < MIN_ANSWER_CHARS)) {
      return NextResponse.json(
        { error: 'Each answer needs at least a sentence before submitting' },
        { status: 400 }
      )
    }

    /* ------------------------------ grade answers ------------------------------ */
    // Practice data stays candidate-private end to end.
    const graded: GradedQuestion[] = await Promise.all(
      questions.map(async (q) => {
        const answer = answers[q.qIndex] ?? ''
        try {
          return await gradeWithAi(q, row.difficulty, row.track, answer)
        } catch (err) {
          console.error(`[mock-interview/submit] per-question AI failed for q${q.qIndex}:`, err)
          return heuristicGrade(q, row.track, answer)
        }
      })
    )

    let overall: { overallScore: number; strengths: string[]; focusAreas: string[]; summary: string }
    try {
      overall = await overallWithAi(row.track, row.difficulty, questions, answers, graded)
    } catch (err) {
      console.error('[mock-interview/submit] overall AI failed, using heuristic:', err)
      overall = heuristicOverall(row.track, graded, questions)
    }

    const usedHeuristic = graded.some((g) => g.source === 'heuristic')
    const report: PracticeReport = {
      overallScore: overall.overallScore,
      strengths: overall.strengths,
      focusAreas: overall.focusAreas,
      summary: overall.summary,
      perQuestion: graded.map((g) => ({
        qIndex: g.qIndex,
        score: g.score,
        feedback: g.feedback,
        sampleAnswer: g.sampleAnswer,
      })),
      source: usedHeuristic ? 'heuristic' : 'ai',
      completedAt: new Date().toISOString(),
    }

    const completedAt = new Date()
    await db.mockInterview.update({
      where: { id: row.id },
      data: {
        report: JSON.stringify(report),
        status: 'COMPLETED',
        completedAt,
      },
    })

    // PRIVACY: response goes only to the owning candidate. Practice results are
    // never written anywhere recruiters or clients can read.
    return NextResponse.json({
      data: {
        overallScore: report.overallScore,
        strengths: report.strengths,
        focusAreas: report.focusAreas,
        summary: report.summary,
        perQuestion: report.perQuestion,
        source: report.source,
      },
    })
  } catch (err) {
    console.error('POST /api/ai/mock-interview/submit failed:', err)
    return NextResponse.json({ error: 'Could not grade the practice session' }, { status: 500 })
  }
}
