import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson } from '@/lib/ai-client'

/* ------------------------------------------------------------------ */
/* Skill verification — question generation + candidate/recruiter read */
/* ------------------------------------------------------------------ */

// The fixed assessment domains (one line each, shown on the candidate grid).
const ASSESSMENT_DOMAINS: Record<string, string> = {
  'React & Frontend': 'Components, hooks, rendering behaviour and browser performance.',
  'JavaScript & TypeScript': 'Core language, types, async patterns and runtime behaviour.',
  Python: 'Language fundamentals, data structures and idiomatic scripting.',
  'SQL & Databases': 'Queries, joins, indexing and schema thinking.',
  'Java Backend': 'OOP, collections, JVM basics and service-layer patterns.',
  'Aptitude & Logic': 'Quantitative reasoning, patterns and problem solving.',
}

const TOTAL_QUESTIONS = 5
/** An ungraded attempt stays resumable for 60 minutes; after that starting a
 * domain simply creates a fresh attempt. */
const RESUME_WINDOW_MINUTES = 60

function badgeForPercentage(percentage: number): 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE' {
  if (percentage >= 90) return 'GOLD'
  if (percentage >= 75) return 'SILVER'
  if (percentage >= 60) return 'BRONZE'
  return 'NONE'
}

/* --------------------------- static fallback bank -------------------------- */
/* Used only when the AI generator fails after retries. 5 solid questions per
 * domain, written in-house (conceptual + practical, progressive difficulty). */

interface BankQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

const FALLBACK_BANK: Record<string, BankQuestion[]> = {
  'React & Frontend': [
    {
      question: 'Which hook lets a function component keep a value across renders WITHOUT triggering a re-render when that value changes?',
      options: ['useState', 'useRef', 'useMemo', 'useEffect'],
      correctIndex: 1,
      explanation:
        'useRef returns a mutable object whose .current persists for the lifetime of the component. Updating .current does not schedule a re-render, unlike useState.',
    },
    {
      question: 'What is the main purpose of the dependency array in a useEffect call?',
      options: [
        'It controls when the effect function re-runs',
        'It memoises the effect return value',
        'It defines the component props',
        'It replaces the cleanup function',
      ],
      correctIndex: 0,
      explanation:
        'React re-runs the effect only when one of the listed dependencies changes between renders. An empty array means the effect runs once after mount.',
    },
    {
      question: 'You call a state setter with a value that is identical (Object.is) to the current state. What happens?',
      options: [
        'React may bail out and skip re-rendering the component',
        'React always re-renders the component twice',
        'The component unmounts',
        'React throws an error',
      ],
      correctIndex: 0,
      explanation:
        'When the new state equals the current state, React can skip re-rendering as an optimisation. It may still render once more before bailing out, but no infinite loop occurs.',
    },
    {
      question: 'Why is the key prop important when rendering a list of elements?',
      options: [
        'It styles each list item differently',
        'It gives elements a stable identity so React can efficiently add, remove and reorder them while preserving state',
        'It is required for CSS to apply',
        'It sorts the list automatically',
      ],
      correctIndex: 1,
      explanation:
        'Keys let React match elements between renders so it can move DOM nodes instead of rebuilding them, preserving things like input focus and component state.',
    },
    {
      question: 'A child component needs to update state that lives in its parent. What is the standard React pattern?',
      options: [
        'Mutate the parent state object directly from the child',
        'Store the state in a global variable',
        'Pass a callback function from the parent down as a prop and call it from the child',
        'Read and write to the DOM node directly',
      ],
      correctIndex: 2,
      explanation:
        'State flows down via props and changes flow up via callback props. The parent owns the state and passes a function the child can call to request an update.',
    },
  ],
  'JavaScript & TypeScript': [
    {
      question: "What does the expression `'5' + 3` evaluate to in JavaScript?",
      options: ["'53'", '8', 'NaN', 'It throws a TypeError'],
      correctIndex: 0,
      explanation:
        'When either operand of + is a string, JavaScript converts the other operand to a string and concatenates, so the result is the string "53".',
    },
    {
      question: 'What is the difference between `let` and `const` declarations?',
      options: [
        'const values can never change in any way, let values always change',
        'A const binding cannot be reassigned, though object contents it references can still be mutated',
        'let is block-scoped while const is function-scoped',
        'There is no difference',
      ],
      correctIndex: 1,
      explanation:
        'const creates an immutable binding: you cannot assign the variable again. If it holds an object, the object’s properties can still be modified.',
    },
    {
      question: 'What does Array.prototype.map return?',
      options: [
        'The original array, modified in place',
        'A new array of the same length containing the callback’s return values',
        'A single accumulated value',
        'Only the elements for which the callback returned true',
      ],
      correctIndex: 1,
      explanation:
        'map builds and returns a new array by calling the callback once per element. filter selects a subset and reduce accumulates a single value.',
    },
    {
      question: 'In a TypeScript interface, what does the `?` mean in `age?: number`?',
      options: [
        'The property must be a number or null',
        'The property is optional and may be missing (undefined)',
        'The property is read-only',
        'The property accepts any type',
      ],
      correctIndex: 1,
      explanation:
        'The optional marker makes the property omitable: objects may leave it out entirely, and its type becomes number | undefined when read.',
    },
    {
      question: 'What does the TypeScript utility type `Partial<User>` produce?',
      options: [
        'A type with only the first property of User',
        'A type where every property of User is optional',
        'A type where every property of User is required',
        'A runtime copy of a User object',
      ],
      correctIndex: 1,
      explanation:
        'Partial<T> maps every property of T to its optional form, which is handy for update shapes like patch objects. It is erased at runtime.',
    },
  ],
  Python: [
    {
      question: 'Which built-in collection stores UNIQUE items with no guaranteed order?',
      options: ['list', 'tuple', 'set', 'dict'],
      correctIndex: 2,
      explanation:
        'A set rejects duplicate members and does not maintain insertion order. A dict keeps unique keys but preserves insertion order in modern Python.',
    },
    {
      question: 'Which list comprehension produces the squares of 0 through 4?',
      options: [
        '[x*x for x in range(5)]',
        'for x in range(5): x*x',
        '{x*x in range(5)}',
        '[range(5) * x]',
      ],
      correctIndex: 0,
      explanation:
        'A list comprehension is written [expression for item in iterable]. range(5) yields 0..4, so the result is [0, 1, 4, 9, 16].',
    },
    {
      question: 'What does `value = config.get("timeout", 30)` do when the key is missing?',
      options: [
        'It raises a KeyError',
        'It returns None',
        'It assigns 30 to value instead of raising an error',
        'It creates the key with value 30',
      ],
      correctIndex: 2,
      explanation:
        'dict.get accepts a default that is returned when the key does not exist. Unlike config["timeout"], no exception is raised and the dict is not modified.',
    },
    {
      question: 'What is the purpose of a Python virtual environment?',
      options: [
        'It speeds up the interpreter by caching bytecode',
        'It isolates a project’s dependencies from other projects and the system Python',
        'It compiles Python to machine code',
        'It provides access to the operating system shell',
      ],
      correctIndex: 1,
      explanation:
        'A virtual environment gives each project its own site-packages, so different projects can use different versions of the same library without conflicts.',
    },
    {
      question: 'What does the `if __name__ == "__main__":` guard do in a script?',
      options: [
        'It makes the module import faster',
        'It runs the guarded code only when the file is executed directly, not when it is imported',
        'It declares the entry point for the operating system',
        'It starts a REPL session',
      ],
      correctIndex: 1,
      explanation:
        '__name__ equals "__main__" only for the file launched by the interpreter. When the module is imported, __name__ is the module name, so the guarded block is skipped.',
    },
  ],
  'SQL & Databases': [
    {
      question: 'Which clause filters individual rows BEFORE rows are grouped for aggregation?',
      options: ['HAVING', 'WHERE', 'ORDER BY', 'LIMIT'],
      correctIndex: 1,
      explanation:
        'WHERE filters rows before grouping; HAVING filters the grouped results after aggregation, which is why HAVING can reference aggregates like COUNT().',
    },
    {
      question: 'What does an INNER JOIN return?',
      options: [
        'All rows from both tables, matched where possible',
        'Only rows that have matching values in both joined tables',
        'All rows from the left table plus matches from the right',
        'Only the rows that do NOT match',
      ],
      correctIndex: 1,
      explanation:
        'An INNER JOIN keeps only the row pairs that satisfy the join condition. LEFT JOIN keeps every left row, and FULL OUTER keeps unmatched rows from both sides.',
    },
    {
      question: 'Which statement adds a new column to an existing table?',
      options: [
        'UPDATE TABLE ADD COLUMN',
        'ALTER TABLE ... ADD COLUMN',
        'INSERT INTO TABLE ... COLUMN',
        'CREATE COLUMN ON TABLE',
      ],
      correctIndex: 1,
      explanation:
        'ALTER TABLE changes an existing table’s structure, including ADD COLUMN. INSERT adds rows (data), not columns.',
    },
    {
      question: 'What does a database index primarily improve, and at what cost?',
      options: [
        'It speeds up reads/lookups at the cost of extra storage and slower writes',
        'It speeds up writes at the cost of slower reads',
        'It compresses the table to save disk space',
        'It prevents all duplicate rows',
      ],
      correctIndex: 0,
      explanation:
        'An index is an auxiliary lookup structure (usually a B-tree) that turns full table scans into fast seeks. Every write must also update each index, and the index consumes storage.',
    },
    {
      question: 'Which expression counts only the DISTINCT values of a column?',
      options: ['COUNT(*)', 'COUNT(DISTINCT col)', 'DISTINCT COUNT(col)', 'SUM(DISTINCT *)'],
      correctIndex: 1,
      explanation:
        'COUNT(DISTINCT col) counts unique non-null values. COUNT(*) counts all rows including duplicates, and COUNT(col) counts non-null values.',
    },
  ],
  'Java Backend': [
    {
      question: 'Which keyword establishes an inheritance relationship between classes?',
      options: ['implements', 'extends', 'inherits', 'super'],
      correctIndex: 1,
      explanation:
        'class Child extends Parent creates a subclass. implements is used for interfaces, and super only references the parent members from within the child.',
    },
    {
      question: 'Which collection stores key-value pairs with unique keys?',
      options: ['ArrayList', 'HashSet', 'HashMap', 'LinkedList'],
      correctIndex: 2,
      explanation:
        'HashMap maps each key to exactly one value; putting an existing key replaces its value. HashSet stores unique single elements, not pairs.',
    },
    {
      question: 'For Java objects, what is the difference between `a == b` and `a.equals(b)`?',
      options: [
        'They are always identical',
        '== compares object references (identity); equals compares logical content when the class overrides it',
        '== compares content; equals compares memory addresses',
        '== works only for primitives',
      ],
      correctIndex: 1,
      explanation:
        'For objects == tests whether both variables point to the same instance. equals is meant for value equality and classes like String override it to compare contents.',
    },
    {
      question: 'What does the JVM do?',
      options: [
        'It converts .java source files to C++ code',
        'It executes compiled Java bytecode, letting the same build run on any platform with a JVM',
        'It manages relational databases',
        'It is an IDE for writing Java',
      ],
      correctIndex: 1,
      explanation:
        'javac compiles source to platform-independent bytecode. The JVM loads and executes that bytecode, which is what makes Java "write once, run anywhere".',
    },
    {
      question: 'What is the purpose of a Java interface?',
      options: [
        'To provide a fast data structure for sorting',
        'To declare a contract of methods that implementing classes must provide, enabling programming to an abstraction',
        'To store private fields of a class',
        'To replace exception handling',
      ],
      correctIndex: 1,
      explanation:
        'An interface defines method signatures without implementation (default methods aside). Callers depend on the contract rather than concrete classes, which keeps code loosely coupled.',
    },
  ],
  'Aptitude & Logic': [
    {
      question: 'What number continues the sequence: 2, 6, 12, 20, 30, ?',
      options: ['36', '40', '42', '44'],
      correctIndex: 2,
      explanation:
        'The gaps grow 4, 6, 8, 10 and then 12, so 30 + 12 = 42. (The pattern is n² + n.)',
    },
    {
      question: 'All A are B. All B are C. What must be true?',
      options: ['All C are A', 'All A are C', 'No A are C', 'Some B are not C'],
      correctIndex: 1,
      explanation:
        'Transitivity of containment: since the A group sits inside B and B sits inside C, every A is also a C. The reverse is not guaranteed.',
    },
    {
      question: 'A shirt priced at ₹800 is sold at a 25% discount. What is the final price?',
      options: ['₹500', '₹550', '₹600', '₹650'],
      correctIndex: 2,
      explanation:
        '25% of 800 is 200, so the discounted price is 800 − 200 = ₹600 (equivalently 800 × 0.75).',
    },
    {
      question: 'Which number is the odd one out: 3, 5, 7, 9, 11?',
      options: ['5', '7', '9', '11'],
      correctIndex: 2,
      explanation:
        'Every other number in the list is prime; 9 = 3 × 3 is composite, so it breaks the pattern.',
    },
    {
      question: 'Worker A finishes a task in 6 hours, worker B in 3 hours. Working together at these rates, how long does the task take?',
      options: ['4.5 hours', '2 hours', '3 hours', '1.5 hours'],
      correctIndex: 1,
      explanation:
        'Rates add: A does 1/6 of the task per hour and B does 1/3, together 1/2 per hour, so the whole task takes 2 hours.',
    },
  ],
}

/* ------------------------------ AI generation ------------------------------ */

interface AiQuestion {
  question?: unknown
  options?: unknown
  correctIndex?: unknown
  explanation?: unknown
}

/** Fisher–Yates shuffle of the option list, remapping correctIndex. Prevents
 * patterns like "the correct answer is always option A". */
function shuffleOptions<T extends { options: string[]; correctIndex: number }>(q: T): T {
  const order = q.options.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const shuffled = order.map((i) => q.options[i])
  const newCorrect = order.indexOf(q.correctIndex)
  return { ...q, options: shuffled, correctIndex: newCorrect }
}

/** Validate + normalise the AI's raw question list. Returns null when the
 * payload is not a clean set of exactly TOTAL_QUESTIONS questions. */
function sanitiseAiQuestions(raw: unknown): BankQuestion[] | null {
  if (!Array.isArray(raw) || raw.length !== TOTAL_QUESTIONS) return null
  const out: BankQuestion[] = []
  for (const item of raw as AiQuestion[]) {
    const question = typeof item?.question === 'string' ? item.question.trim() : ''
    const options = Array.isArray(item?.options) ? item.options : null
    const explanation = typeof item?.explanation === 'string' ? item.explanation.trim() : ''
    const correctIndex = item?.correctIndex
    if (
      question.length < 8 ||
      explanation.length < 4 ||
      !options ||
      options.length !== 4 ||
      !options.every((o) => typeof o === 'string' && o.trim().length > 0) ||
      typeof correctIndex !== 'number' ||
      !Number.isInteger(correctIndex) ||
      correctIndex < 0 ||
      correctIndex > 3
    ) {
      return null
    }
    out.push({
      question,
      options: (options as string[]).map((o) => o.trim()),
      correctIndex,
      explanation,
    })
  }
  return out
}

async function generateQuestions(domain: string): Promise<BankQuestion[]> {
  const description = ASSESSMENT_DOMAINS[domain] ?? ''
  const system = [
    'You are an exam setter for a professional hiring platform.',
    'You write fair, brand-neutral multiple-choice questions that a working professional should be able to answer.',
    'You ALWAYS reply with strict JSON only — no markdown fences, no commentary.',
  ].join(' ')

  const user = [
    `Create a 5-question multiple-choice skill assessment for the domain "${domain}".`,
    description ? `Focus areas: ${description}` : '',
    'Rules:',
    '- Exactly 5 question objects, nothing else.',
    '- Mix conceptual and practical questions; difficulty should progress from warm-up to the hardest question.',
    '- Each question has exactly 4 plausible options and exactly ONE clearly correct answer.',
    '- No trick questions, no ambiguity, no "all of the above" options, no company or product names.',
    '- Each question includes an explanation of 1-2 sentences for the correct answer.',
    'Reply with ONLY this JSON shape:',
    '[{"question": "string", "options": ["a", "b", "c", "d"], "correctIndex": 0, "explanation": "string"}]',
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const raw = await chatWithRetry(system, user)
    const parsed = extractJson<unknown>(raw)
    const clean = sanitiseAiQuestions(parsed)
    if (clean) return clean.map(shuffleOptions)
    console.error('[assessments] AI payload failed validation, using fallback bank')
  } catch (err) {
    console.error('[assessments] AI generation failed, using fallback bank:', err)
  }
  // Deterministic fallback: banked questions, options shuffled per attempt.
  return (FALLBACK_BANK[domain] ?? FALLBACK_BANK['Aptitude & Logic']).map(shuffleOptions)
}

/* ------------------------------- data shaping ------------------------------ */

type BadgeLevel = 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE'

interface StoredQuestion {
  qIndex: number
  question: string
  options: string[]
  correctIndex: number
  explanation: string
}

function parseQuestions(row: { questions: string }): StoredQuestion[] {
  try {
    const parsed = JSON.parse(row.questions) as StoredQuestion[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Client-safe question shape — NEVER includes correctIndex or explanation. */
function publicQuestions(questions: StoredQuestion[]) {
  return questions.map((q) => ({ qIndex: q.qIndex, question: q.question, options: q.options }))
}

const BADGE_ORDER: BadgeLevel[] = ['NONE', 'BRONZE', 'SILVER', 'GOLD']

function asBadge(value: unknown): BadgeLevel | null {
  return value === 'GOLD' || value === 'SILVER' || value === 'BRONZE' || value === 'NONE'
    ? value
    : null
}

const RESUME_WINDOW_MS = RESUME_WINDOW_MINUTES * 60_000

/** An in-progress attempt (badge null, uncompleted, younger than the window). */
function isResumable(row: {
  badge: string | null
  completedAt: Date | null
  createdAt: Date
}) {
  return (
    row.badge === null &&
    row.completedAt === null &&
    Date.now() - row.createdAt.getTime() < RESUME_WINDOW_MS
  )
}

/* ---------------------------------- GET ----------------------------------- */

// GET /api/assessments
//   ?userId=...&mine=1                              → candidate's own view (resume included)
//   ?candidateIds=a,b&badgesOnly=1&recruiterId=...  → recruiter badge lookup
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const userId = sp.get('userId')
    const mine = sp.get('mine') === '1'
    const candidateIdsParam = sp.get('candidateIds')
    const badgesOnly = sp.get('badgesOnly') === '1'

    /* ------------------------------ candidate view ------------------------------ */
    if (mine) {
      if (!userId) {
        return NextResponse.json({ error: 'userId is required' }, { status: 400 })
      }
      const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }

      const attempts = await db.skillAssessment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          domain: true,
          questions: true,
          score: true,
          total: true,
          percentage: true,
          badge: true,
          completedAt: true,
          createdAt: true,
        },
      })

      // newest still-open attempt within the resume window
      const open = attempts.find((a) => isResumable(a))

      const byDomain = new Map<
        string,
        {
          domain: string
          description: string
          bestBadge: BadgeLevel | null
          attempts: number
          lastPercentage: number | null
          lastAt: string | null
        }
      >()
      // always expose all six domains so the grid renders every card
      for (const [domain, description] of Object.entries(ASSESSMENT_DOMAINS)) {
        byDomain.set(domain, {
          domain,
          description,
          bestBadge: null,
          attempts: 0,
          lastPercentage: null,
          lastAt: null,
        })
      }
      for (const a of attempts) {
        const entry = byDomain.get(a.domain)
        if (!entry) continue
        if (a.completedAt != null && a.badge != null) {
          entry.attempts += 1
          const badge = asBadge(a.badge)
          if (
            badge &&
            (entry.bestBadge === null ||
              BADGE_ORDER.indexOf(badge) > BADGE_ORDER.indexOf(entry.bestBadge))
          ) {
            entry.bestBadge = badge
          }
          if (entry.lastAt === null || a.completedAt.getTime() > new Date(entry.lastAt).getTime()) {
            entry.lastAt = a.completedAt.toISOString()
            entry.lastPercentage = a.percentage
          }
        }
      }

      return NextResponse.json({
        domains: [...byDomain.values()],
        inProgress: open
          ? {
              assessmentId: open.id,
              domain: open.domain,
              totalQuestions: open.total,
              startedAt: open.createdAt.toISOString(),
              questions: publicQuestions(parseQuestions(open)),
            }
          : null,
      })
    }

    /* ------------------------------ recruiter view ------------------------------ */
    if (badgesOnly) {
      const recruiterId = sp.get('recruiterId')
      if (!recruiterId) {
        return NextResponse.json({ error: 'recruiterId is required' }, { status: 400 })
      }
      const recruiter = await db.user.findUnique({
        where: { id: recruiterId },
        select: { id: true, role: true },
      })
      if (!recruiter || recruiter.role !== 'RECRUITER') {
        return NextResponse.json({ error: 'Recruiter account required' }, { status: 403 })
      }
      if (!candidateIdsParam) {
        return NextResponse.json({ byUser: {} })
      }
      const ids = candidateIdsParam
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 100)
      if (ids.length === 0) {
        return NextResponse.json({ byUser: {} })
      }

      // Only completed attempts; only domain + badge + percentage are exposed
      // (never identity fields, contact details or currentEmployer).
      const rows = await db.skillAssessment.findMany({
        where: { userId: { in: ids }, badge: { not: null }, completedAt: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { userId: true, domain: true, badge: true, percentage: true },
      })

      const byUser: Record<string, { domain: string; badge: BadgeLevel; percentage: number }[]> = {}
      for (const id of ids) byUser[id] = []
      for (const row of rows) {
        const list = byUser[row.userId]
        if (!list) continue
        const badge = asBadge(row.badge)
        if (!badge) continue
        const existing = list.find((b) => b.domain === row.domain)
        if (!existing) {
          list.push({ domain: row.domain, badge, percentage: row.percentage ?? 0 })
        } else if (BADGE_ORDER.indexOf(badge) > BADGE_ORDER.indexOf(existing.badge)) {
          // rows are newest-first: upgrade to the better attempt for this domain
          existing.badge = badge
          existing.percentage = row.percentage ?? existing.percentage
        }
      }
      // at most 6 domains per candidate, best badges first
      for (const id of Object.keys(byUser)) {
        byUser[id] = byUser[id]
          .sort((a, b) => BADGE_ORDER.indexOf(b.badge) - BADGE_ORDER.indexOf(a.badge))
          .slice(0, 6)
      }

      return NextResponse.json({ byUser })
    }

    return NextResponse.json(
      { error: 'Provide mine=1 or badgesOnly=1 to select a mode' },
      { status: 400 }
    )
  } catch (err) {
    console.error('GET /api/assessments failed:', err)
    return NextResponse.json({ error: 'Could not load assessments' }, { status: 500 })
  }
}

/* ---------------------------------- POST ---------------------------------- */

// POST /api/assessments { userId, domain } — start (or resume) an attempt.
export async function POST(req: NextRequest) {
  try {
    const body = (await req
      .json()
      .catch(() => null)) as { userId?: unknown; domain?: unknown } | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { userId, domain } = body
    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    if (typeof domain !== 'string' || !ASSESSMENT_DOMAINS[domain]) {
      return NextResponse.json(
        { error: `domain must be one of: ${Object.keys(ASSESSMENT_DOMAINS).join(', ')}` },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({
      where: { id: userId.trim() },
      select: { id: true, role: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (user.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Only candidate accounts can take skill assessments' },
        { status: 403 }
      )
    }

    // Resume an open attempt for this user + domain if one is still fresh.
    const existing = await db.skillAssessment.findFirst({
      where: { userId: user.id, domain, badge: null, completedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    if (existing && isResumable(existing)) {
      return NextResponse.json({
        assessmentId: existing.id,
        domain,
        total: existing.total,
        resumed: true,
        questions: publicQuestions(parseQuestions(existing)),
      })
    }

    // Fresh attempt: generate 5 questions (AI with static fallback bank).
    const generated = await generateQuestions(domain)
    const questions = generated.map((q, i) => ({ qIndex: i, ...q }))

    const created = await db.skillAssessment.create({
      data: {
        userId: user.id,
        domain,
        questions: JSON.stringify(questions),
        total: TOTAL_QUESTIONS,
      },
      select: { id: true, createdAt: true },
    })

    return NextResponse.json({
      assessmentId: created.id,
      domain,
      total: TOTAL_QUESTIONS,
      resumed: false,
      questions: publicQuestions(questions),
    })
  } catch (err) {
    console.error('POST /api/assessments failed:', err)
    return NextResponse.json({ error: 'Could not start the assessment' }, { status: 500 })
  }
}
