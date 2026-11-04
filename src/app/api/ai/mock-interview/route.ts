import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson } from '@/lib/ai-client'

/* -------------------------------------------------------------------------- */
/* Mock interview PRACTICE mode — question generation + candidate-private read */
/* PRIVACY: everything under /api/ai/mock-interview is candidate-private.      */
/* Practice answers, scores and reports are NEVER surfaced to recruiters or    */
/* client users — no recruiter-facing endpoint reads the MockInterview table.  */
/* This is the candidate's own practice gym, clearly separate from the real    */
/* AI interview dossier that recruiters evaluate.                              */
/* -------------------------------------------------------------------------- */

export const dynamic = 'force-dynamic'

const TRACKS = [
  'React & Frontend',
  'Node & Backend',
  'Data & SQL',
  'System Design',
  'Behavioral / HR',
  'Case & Product',
] as const

const TRACK_DESCRIPTIONS: Record<string, string> = {
  'React & Frontend': 'Components, hooks, state and rendering behaviour.',
  'Node & Backend': 'APIs, async runtimes, services and data flow.',
  'Data & SQL': 'Queries, joins, modelling and data reasoning.',
  'System Design': 'Scalability, trade-offs and architecture choices.',
  'Behavioral / HR': 'Structured storytelling about your real experience.',
  'Case & Product': 'Product sense, metrics and structured problem solving.',
}

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const

const QUESTION_COUNT = 3

interface BankQuestion {
  question: string
  focusArea: string
  tip: string
  level: 'EASY' | 'MEDIUM' | 'HARD'
}

/* --------------------------- static fallback bank -------------------------- */
/* Used only when the AI generator fails after retries. 6 hand-written questions
 * per track (2 per difficulty); 3 are picked deterministically based on the
 * requested difficulty. Tips are candidate-facing (practice mode shows them
 * before answering — that is the point of practice). */

const FALLBACK_BANK: Record<string, BankQuestion[]> = {
  'React & Frontend': [
    {
      question: 'What problem do React hooks like useState and useEffect solve compared with class components?',
      focusArea: 'React fundamentals',
      tip: 'Explain state and side-effects in function components, then note one practical benefit you have felt (simpler reuse, less boilerplate).',
      level: 'EASY',
    },
    {
      question: 'How do you decide between local component state, a shared context, and a server cache when managing data in a React app?',
      focusArea: 'State management',
      tip: 'Give a one-line rule for each layer (component / cross-tree / server data) and one example of a bug you avoid by choosing correctly.',
      level: 'EASY',
    },
    {
      question: 'A product list page re-renders on every keystroke of the search box and feels sluggish. Walk me through how you would diagnose and fix it.',
      focusArea: 'Rendering performance',
      tip: 'Structure it: measure first (profiler), then likely causes — uncontrolled re-renders, missing memoisation, heavy trees — and a concrete fix for each.',
      level: 'MEDIUM',
    },
    {
      question: 'Explain how you would build a modal or dropdown that closes on outside click without leaking event listeners.',
      focusArea: 'Effects & cleanup',
      tip: 'Describe the useEffect that adds the listener, why the cleanup return matters, and how refs tell you where the click landed.',
      level: 'MEDIUM',
    },
    {
      question: 'How would you design data fetching for a dashboard where several widgets need overlapping data and must not request it twice?',
      focusArea: 'Data fetching & caching',
      tip: 'Talk about a cache keyed by request, deduplication, staleness windows, and invalidation after mutations — pick tools you actually know.',
      level: 'HARD',
    },
    {
      question: 'You inherit a React codebase where prop drilling goes five levels deep and types are broken. What do you fix in week one, and what do you deliberately not touch yet?',
      focusArea: 'Refactoring judgement',
      tip: 'Show prioritisation: type safety and obvious bugs first, composition and context later; explain the risk you avoid by not big-bang rewriting.',
      level: 'HARD',
    },
  ],
  'Node & Backend': [
    {
      question: 'What happens in Node.js when you make a slow database query — what blocks and what does not?',
      focusArea: 'Event loop basics',
      tip: 'Explain the event loop in one sentence, then clarify that the query itself is async I/O while CPU-heavy work in your handler is what blocks.',
      level: 'EASY',
    },
    {
      question: 'What is the difference between 400, 401, 403 and 404 when an API request fails, and which do you return for a wrong password?',
      focusArea: 'HTTP & APIs',
      tip: 'Define each code in a few words; for the password case, mention why many APIs deliberately return a generic 401 to avoid leaking account existence.',
      level: 'EASY',
    },
    {
      question: 'How would you make an endpoint that emails 10,000 users not time out, and how would you know it actually finished?',
      focusArea: 'Background jobs',
      tip: 'Move work out of the request (queue/worker), return an ID, expose a status endpoint or notification; mention idempotency and retries.',
      level: 'MEDIUM',
    },
    {
      question: 'A teammate proposes caching every GET response in memory for an hour. Where does that break first in a real system?',
      focusArea: 'Caching trade-offs',
      tip: 'Cover stale data on hot resources, multi-instance memory divergence, cache keys, and invalidation after writes — then suggest a narrower policy.',
      level: 'MEDIUM',
    },
    {
      question: 'Design the API and data model for a "likes" feature that must stay correct when two requests like the same post at the same moment.',
      focusArea: 'Concurrency & integrity',
      tip: 'Name the unique constraint that makes double-likes impossible, the transaction or upsert that uses it, and how the UI stays consistent.',
      level: 'HARD',
    },
    {
      question: 'Your service occasionally doubles latency every few minutes with no code deploy. Describe a systematic way to find the cause.',
      focusArea: 'Debugging production',
      tip: 'Show a method: correlate timing with GC, connection-pool saturation or scheduled jobs, then prove it with one metric or log before changing code.',
      level: 'HARD',
    },
  ],
  'Data & SQL': [
    {
      question: 'Write (or describe in words) a query that returns each department with its average salary, only for departments with more than five employees.',
      focusArea: 'Aggregation',
      tip: 'Group by department, use AVG, then filter groups with HAVING — say out loud why WHERE would be wrong here.',
      level: 'EASY',
    },
    {
      question: 'What is the practical difference between an INNER JOIN and a LEFT JOIN, and when would you actually need the LEFT one?',
      focusArea: 'Joins',
      tip: 'One sentence on matched rows vs preserved left rows, then a real case: keeping customers who have never ordered.',
      level: 'EASY',
    },
    {
      question: 'A report query got slow after the table grew to millions of rows. Walk me through how you would investigate.',
      focusArea: 'Query performance',
      tip: 'Order it: read the query plan, check whether the filter and join columns are indexed, review cardinality, then measure the change after one fix.',
      level: 'MEDIUM',
    },
    {
      question: 'How would you find duplicate user records that differ only in whitespace or case in the email column?',
      focusArea: 'Data cleaning',
      tip: 'Normalise in the query (trim + lower), group by the normalised value with count > 1, then talk about how you would merge them safely.',
      level: 'MEDIUM',
    },
    {
      question: 'Design tables for courses and students where a student can enrol in many courses. How do you prevent duplicate enrolments?',
      focusArea: 'Schema modelling',
      tip: 'Junction table with a composite unique key (student, course); mention the foreign-key indexes and how you would record the enrolment date.',
      level: 'HARD',
    },
    {
      question: 'Explain what a transaction guarantees, and give a concrete example where skipping one would corrupt data.',
      focusArea: 'Transactions & consistency',
      tip: 'Define all-or-nothing, then a money-transfer example where a crash between debit and credit loses money without a transaction.',
      level: 'HARD',
    },
  ],
  'System Design': [
    {
      question: 'How would you explain to a junior teammate why a single-server app eventually needs a load balancer?',
      focusArea: 'Scaling basics',
      tip: 'Start from the limits of one machine (connections, CPU, single point of failure), then describe what a balancer adds: distribution and failover.',
      level: 'EASY',
    },
    {
      question: 'When would you reach for a cache versus a read replica, and what goes wrong with each?',
      focusArea: 'Read scaling',
      tip: 'Cache: fast but stale, needs invalidation. Replica: consistent-ish but replication lag. Pick one for a news feed and justify it.',
      level: 'EASY',
    },
    {
      question: 'Design a URL shortener: what are the key components, and where does the design get hard at 10k redirects per second?',
      focusArea: 'Core design exercise',
      tip: 'Cover ID generation, storage choice, cache for hot links, and the read-heavy ratio; name one trade-off you accept explicitly.',
      level: 'MEDIUM',
    },
    {
      question: 'You must add rate limiting to a public API deployed across several servers. What are your options and their trade-offs?',
      focusArea: 'Distributed coordination',
      tip: 'In-memory per instance (simple, wrong under load balancing) vs shared-store counters (correct, adds latency) — pick one and state the cost.',
      level: 'MEDIUM',
    },
    {
      question: 'Design the notification system for a hiring platform: emails and in-app alerts when application status changes, at 100k events a day.',
      focusArea: 'Event-driven design',
      tip: 'Producers write events to a queue, workers deliver per channel; discuss retries, deduplication keys and user-level preferences.',
      level: 'HARD',
    },
    {
      question: 'How would you decide between SQL and a document database for a new product catalogue with widely varying attributes?',
      focusArea: 'Storage trade-offs',
      tip: 'Weigh schema flexibility against relational integrity and reporting needs; end with a decision and the signal that would make you switch.',
      level: 'HARD',
    },
  ],
  'Behavioral / HR': [
    {
      question: 'Tell me about yourself and your journey into this field.',
      focusArea: 'Structured self-introduction',
      tip: 'Use present-past-future: what you do now, the path that got you here, what you want next — 90 seconds, relevant to the role only.',
      level: 'EASY',
    },
    {
      question: 'Why do you want to work here, and what made you apply to this role?',
      focusArea: 'Motivation',
      tip: 'Name one specific thing about the role or product you find interesting and connect it to one concrete skill you bring.',
      level: 'EASY',
    },
    {
      question: 'Describe a time you disagreed with a teammate or manager. What did you do and what was the outcome?',
      focusArea: 'Conflict & collaboration',
      tip: 'Use STAR: the situation, your task, the actions you took (listen, present data, commit to a decision) and the honest result.',
      level: 'MEDIUM',
    },
    {
      question: 'Tell me about a project that failed or slipped. What was your part in it?',
      focusArea: 'Ownership & learning',
      tip: 'Pick a real setback, own your contribution without blaming others, and end with the specific thing you changed afterwards.',
      level: 'MEDIUM',
    },
    {
      question: 'Tell me about the most difficult feedback you have received. How did you respond?',
      focusArea: 'Growth mindset',
      tip: 'Show you did not get defensive: what the feedback was, how you verified it, one behaviour you changed, and how it paid off.',
      level: 'HARD',
    },
    {
      question: 'Describe a time you had to deliver good work under an unrealistic deadline. What did you cut and how did you communicate it?',
      focusArea: 'Prioritisation under pressure',
      tip: 'STAR with emphasis on scope decisions: what you negotiated out, how you kept stakeholders informed, what shipped and its quality.',
      level: 'HARD',
    },
  ],
  'Case & Product': [
    {
      question: 'A food-delivery app notices order volume dropped 15% in one city. How would you investigate?',
      focusArea: 'Structured diagnosis',
      tip: 'Clarify scope first, then split the funnel: demand, supply, app issues, seasonality, competitor action — propose a check for each branch.',
      level: 'EASY',
    },
    {
      question: 'How would you improve the job-search experience for candidates on a platform like this one?',
      focusArea: 'Product improvement',
      tip: 'Pick one user pain, quantify who has it, propose a focused solution, and name the metric that would prove it worked.',
      level: 'EASY',
    },
    {
      question: 'The CEO wants to add a social feed to a productivity app. How would you evaluate whether to build it?',
      focusArea: 'Prioritisation',
      tip: 'Ask about the goal, weigh impact vs effort against the core loop, consider engagement cannibalisation, and give a clear build or don\u2019t-build call.',
      level: 'MEDIUM',
    },
    {
      question: 'Design a feature that helps users trust reviews on an e-commerce site. What are the top two fake-review defences you would ship first?',
      focusArea: 'Trust & safety design',
      tip: 'Think in layers: verified-purchase flags and anomalous-pattern detection; explain the false-positive cost of each and how you would measure it.',
      level: 'MEDIUM',
    },
    {
      question: 'How would you decide which metrics define success for a new "refer a friend" program?',
      focusArea: 'Metrics & measurement',
      tip: 'Distinguish the output metric (referred activations) from guardrails (referrer gaming, invite spam); define the review cadence.',
      level: 'HARD',
    },
    {
      question: 'Estimate how many interview hours a 50-person engineering company spends on hiring per year, and what that implies about reducing interviewer load.',
      focusArea: 'Estimation',
      tip: 'State assumptions out loud (openings, interviews per hire, hours per panel), do the arithmetic cleanly, then draw one actionable implication.',
      level: 'HARD',
    },
  ],
}

/* ------------------------------ sanitisation ------------------------------- */

interface PracticeQuestion {
  qIndex: number
  question: string
  focusArea: string
  tip: string
}

function clampTip(tip: string): string {
  const clean = tip.replace(/\s+/g, ' ').trim()
  return clean.length > 200 ? `${clean.slice(0, 197)}...` : clean
}

/** Deterministic bank pick: the two bank questions tagged with the requested
 * difficulty plus one bridge question (EASY→first MEDIUM, MEDIUM→first EASY,
 * HARD→first MEDIUM), always in stable bank order. */
function pickBankQuestions(track: string, difficulty: string): PracticeQuestion[] {
  const bank = FALLBACK_BANK[track] ?? FALLBACK_BANK['React & Frontend']
  const matched = bank.filter((q) => q.level === difficulty)
  const bridgeLevel = difficulty === 'HARD' ? 'MEDIUM' : difficulty === 'EASY' ? 'MEDIUM' : 'EASY'
  const bridge =
    bank.find((q) => q.level === bridgeLevel) ??
    bank.find((q) => q.level !== difficulty) ??
    bank[0]
  const picked = [...matched, bridge].slice(0, QUESTION_COUNT)
  return picked.map((q, i) => ({
    qIndex: i,
    question: q.question,
    focusArea: q.focusArea,
    tip: clampTip(q.tip),
  }))
}

interface AiPracticeQuestion {
  qIndex?: unknown
  question?: unknown
  focusArea?: unknown
  tip?: unknown
}

/** Validate + normalise the AI's raw question list. Returns null unless it is a
 * clean set of exactly QUESTION_COUNT questions with usable text and tips. */
function sanitiseAiQuestions(raw: unknown): PracticeQuestion[] | null {
  if (!Array.isArray(raw) || raw.length !== QUESTION_COUNT) return null
  const out: PracticeQuestion[] = []
  for (let i = 0; i < QUESTION_COUNT; i++) {
    const item = raw[i] as AiPracticeQuestion
    const question = typeof item?.question === 'string' ? item.question.trim() : ''
    const focusArea = typeof item?.focusArea === 'string' ? item.focusArea.trim() : ''
    const tip = typeof item?.tip === 'string' ? item.tip.trim() : ''
    if (question.length < 10 || question.length > 400 || focusArea.length < 3 || tip.length < 10) {
      return null
    }
    out.push({
      qIndex: i, // re-index server-side; never trust AI-provided indexes
      question,
      focusArea: focusArea.slice(0, 60),
      tip: clampTip(tip),
    })
  }
  return out
}

async function generateQuestions(track: string, difficulty: string): Promise<PracticeQuestion[]> {
  const description = TRACK_DESCRIPTIONS[track] ?? ''
  const system = [
    'You are an interview coach for a professional hiring platform running PRACTICE interviews.',
    'You write realistic, brand-neutral interview questions and short coaching tips.',
    'You ALWAYS reply with strict JSON only — no markdown fences, no commentary.',
  ].join(' ')

  const user = [
    `Create ${QUESTION_COUNT} interview questions for a PRACTICE session on the track "${track}" at ${difficulty} difficulty.`,
    description ? `Track focus: ${description}` : '',
    'Rules:',
    '- Exactly 3 question objects, nothing else.',
    '- Every question must match the requested level (EASY = warm-up fundamentals, MEDIUM = applied day-to-day, HARD = senior/edge-case depth).',
    '- "focusArea": 2-5 words naming the skill the question tests.',
    '- "tip": ONE sentence (max 30 words) telling the candidate HOW to approach the answer. This tip is shown to the candidate BEFORE they answer — practice mode, not a real evaluation.',
    '- No company or product names, no tool-brand names, no trick questions.',
    'Reply with ONLY this JSON shape:',
    '[{"qIndex": 0, "question": "string", "focusArea": "string", "tip": "string"}]',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const raw = await chatWithRetry(system, user)
    const parsed = extractJson<unknown>(raw)
    const clean = sanitiseAiQuestions(parsed)
    if (clean) return clean
    console.error('[mock-interview] AI payload failed validation, using fallback bank')
  } catch (err) {
    console.error('[mock-interview] AI generation failed, using fallback bank:', err)
  }
  return pickBankQuestions(track, difficulty)
}

/* --------------------------------- helpers --------------------------------- */

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

interface ReportShape {
  overallScore?: number
  strengths?: string[]
  focusAreas?: string[]
  summary?: string
}

function parseReport(raw: string | null): ReportShape {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as ReportShape
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/* ----------------------------------- GET ----------------------------------- */

// GET /api/ai/mock-interview?userId=...&history=1
// Candidate-private view: in-progress session (resume), last 6 completed
// sessions and lifetime practice stats. NEVER readable by recruiters/clients.
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const userId = sp.get('userId')
    if (!userId || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId.trim() },
      select: { id: true, role: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    // Candidate-only: practice data belongs to the candidate alone.
    if (user.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Only candidates can view practice interviews' },
        { status: 403 }
      )
    }

    const uid = userId.trim()

    const [inProgressRow, completedRows, totalSessions, allCompleted] = await Promise.all([
      db.mockInterview.findFirst({
        where: { userId: uid, status: 'IN_PROGRESS' },
        orderBy: { createdAt: 'desc' },
      }),
      db.mockInterview.findMany({
        where: { userId: uid, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 6,
      }),
      db.mockInterview.count({ where: { userId: uid, status: 'COMPLETED' } }),
      db.mockInterview.findMany({
        where: { userId: uid, status: 'COMPLETED' },
        select: { track: true, report: true },
      }),
    ])

    const ip = inProgressRow
      ? {
          mockId: inProgressRow.id,
          track: inProgressRow.track,
          difficulty: inProgressRow.difficulty,
          startedAt: inProgressRow.createdAt.toISOString(),
          questions: parseQuestions(inProgressRow.questions).map((q) => ({
            qIndex: q.qIndex,
            question: q.question,
            focusArea: q.focusArea,
            tip: q.tip,
          })),
        }
      : null

    const history = completedRows.map((row) => {
      const report = parseReport(row.report)
      return {
        id: row.id,
        track: row.track,
        difficulty: row.difficulty,
        overallScore: typeof report.overallScore === 'number' ? report.overallScore : null,
        completedAt: (row.completedAt ?? row.updatedAt).toISOString(),
        focusAreas: Array.isArray(report.focusAreas) ? report.focusAreas.slice(0, 4) : [],
      }
    })

    const scores = allCompleted
      .map((r) => parseReport(r.report).overallScore)
      .filter((s): s is number => typeof s === 'number')
    const avgScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null

    // bestTrack: highest average score per track (tie → first alphabetically).
    const byTrack = new Map<string, number[]>()
    for (const r of allCompleted) {
      const s = parseReport(r.report).overallScore
      if (typeof s === 'number') {
        const list = byTrack.get(r.track) ?? []
        list.push(s)
        byTrack.set(r.track, list)
      }
    }
    let bestTrack: string | null = null
    let bestAvg = -1
    for (const [trackName, list] of byTrack) {
      const avg = list.reduce((a, b) => a + b, 0) / list.length
      if (avg > bestAvg || (avg === bestAvg && bestTrack !== null && trackName < bestTrack)) {
        bestAvg = avg
        bestTrack = trackName
      }
    }

    return NextResponse.json({
      data: {
        inProgress: ip,
        history,
        stats: { totalSessions, avgScore, bestTrack },
      },
    })
  } catch (err) {
    console.error('GET /api/ai/mock-interview failed:', err)
    return NextResponse.json({ error: 'Could not load practice interviews' }, { status: 500 })
  }
}

/* ---------------------------------- POST ----------------------------------- */

// POST /api/ai/mock-interview { userId, track, difficulty }
// Starts (or resumes) a practice session. Candidate-only: any non-candidate
// caller gets 403. Practice data is never exposed to employers — ever.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      userId?: unknown
      track?: unknown
      difficulty?: unknown
    } | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { userId, track, difficulty } = body
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    if (typeof track !== 'string' || !(TRACKS as readonly string[]).includes(track)) {
      return NextResponse.json({ error: 'Pick one of the available practice tracks' }, { status: 400 })
    }
    // Difficulty is optional and defaults to MEDIUM; an explicit bad value is rejected.
    let diff = 'MEDIUM'
    if (difficulty !== undefined && difficulty !== null) {
      if (typeof difficulty !== 'string' || !(DIFFICULTIES as readonly string[]).includes(difficulty)) {
        return NextResponse.json(
          { error: 'difficulty must be EASY, MEDIUM or HARD' },
          { status: 400 }
        )
      }
      diff = difficulty
    }

    const user = await db.user.findUnique({
      where: { id: userId.trim() },
      select: { id: true, role: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    // Candidate-only: recruiters/clients may never start or read practice data.
    if (user.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Only candidates can run practice interviews' },
        { status: 403 }
      )
    }

    const uid = userId.trim()

    // Resume an existing unfinished session instead of piling up new ones.
    const existing = await db.mockInterview.findFirst({
      where: { userId: uid, status: 'IN_PROGRESS' },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) {
      const questions = parseQuestions(existing.questions)
      if (questions.length === QUESTION_COUNT) {
        return NextResponse.json({
          data: {
            mockId: existing.id,
            track: existing.track,
            difficulty: existing.difficulty,
            resumed: true,
            questions: questions.map((q) => ({
              qIndex: q.qIndex,
              question: q.question,
              focusArea: q.focusArea,
              tip: q.tip,
            })),
          },
        })
      }
      // Broken row (should not happen) — abandon it and start fresh below.
      await db.mockInterview.delete({ where: { id: existing.id } })
    }

    const questions = await generateQuestions(track, diff)

    const row = await db.mockInterview.create({
      data: {
        userId: uid,
        track,
        difficulty: diff,
        questions: JSON.stringify(questions),
        status: 'IN_PROGRESS',
      },
    })

    return NextResponse.json({
      data: {
        mockId: row.id,
        track,
        difficulty: diff,
        resumed: false,
        questions: questions.map((q) => ({
          qIndex: q.qIndex,
          question: q.question,
          focusArea: q.focusArea,
          tip: q.tip,
        })),
      },
    })
  } catch (err) {
    console.error('POST /api/ai/mock-interview failed:', err)
    return NextResponse.json(
      { error: 'Could not start the practice session right now' },
      { status: 500 }
    )
  }
}
