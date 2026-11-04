'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Code2,
  Database,
  Lightbulb,
  Loader2,
  Network,
  RotateCcw,
  Server,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'

/* ------------------------------------------------------------------ */
/* Mock interview PRACTICE mode — candidate-private widget.            */
/* Everything shown here is the candidate's own practice data;         */
/* recruiters and clients never see any of it (server-enforced).       */
/* Self-contained: fetches its own data, safe to embed anywhere.       */
/* ------------------------------------------------------------------ */

interface PracticeUser {
  id: string
  name?: string
}

interface PracticeQuestion {
  qIndex: number
  question: string
  focusArea: string
  tip: string
}

interface InProgress {
  mockId: string
  track: string
  difficulty: string
  startedAt: string
  questions: PracticeQuestion[]
}

interface HistoryItem {
  id: string
  track: string
  difficulty: string
  overallScore: number | null
  completedAt: string
  focusAreas: string[]
}

interface Stats {
  totalSessions: number
  avgScore: number | null
  bestTrack: string | null
}

interface PerQuestion {
  qIndex: number
  score: number
  feedback: string
  sampleAnswer: string
}

interface Report {
  overallScore: number
  strengths: string[]
  focusAreas: string[]
  summary: string
  perQuestion: PerQuestion[]
  source?: 'ai' | 'heuristic'
}

const MIN_CHARS = 10

const TRACKS: { track: string; icon: typeof Code2; blurb: string }[] = [
  { track: 'React & Frontend', icon: Code2, blurb: 'Components, hooks, state and rendering behaviour.' },
  { track: 'Node & Backend', icon: Server, blurb: 'APIs, async runtimes, services and data flow.' },
  { track: 'Data & SQL', icon: Database, blurb: 'Queries, joins, modelling and data reasoning.' },
  { track: 'System Design', icon: Network, blurb: 'Scalability, trade-offs and architecture choices.' },
  { track: 'Behavioral / HR', icon: Users, blurb: 'Structured storytelling about your real experience.' },
  { track: 'Case & Product', icon: Lightbulb, blurb: 'Product sense, metrics and structured problem solving.' },
]

const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD'] as const
type Difficulty = (typeof DIFFICULTIES)[number]

function scoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-600'
  if (score >= 50) return 'text-amber-600'
  return 'text-rose-500'
}

function scoreStroke(score: number): string {
  if (score >= 75) return 'stroke-emerald-500'
  if (score >= 50) return 'stroke-amber-500'
  return 'stroke-rose-400'
}

function scoreChip(score: number): string {
  if (score >= 75) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
  if (score >= 50) return 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
  return 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  } catch {
    return ''
  }
}

export default function MockInterviewPractice({ user }: { user: PracticeUser }) {
  const userId = user?.id

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [inProgress, setInProgress] = useState<InProgress | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [stats, setStats] = useState<Stats>({ totalSessions: 0, avgScore: null, bestTrack: null })

  // setup state
  const [track, setTrack] = useState<string | null>(null)
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM')
  const [starting, setStarting] = useState(false)

  // quiz state
  const [quiz, setQuiz] = useState<{ mockId: string; track: string; difficulty: string; questions: PracticeQuestion[]; resumed: boolean } | null>(null)
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  // report state (+ the session's questions kept for the review accordion)
  const [report, setReport] = useState<Report | null>(null)
  const [reportSession, setReportSession] = useState<{ track: string; questions: PracticeQuestion[] } | null>(null)

  const loadMine = useCallback(async () => {
    if (!userId) return
    setLoadError(null)
    try {
      const res = await fetch(`/api/ai/mock-interview?userId=${encodeURIComponent(userId)}&history=1`)
      const json: { data?: { inProgress: InProgress | null; history: HistoryItem[]; stats: Stats }; error?: string } =
        await res.json()
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Could not load your practice sessions')
      }
      setInProgress(json.data.inProgress ?? null)
      setHistory(json.data.history ?? [])
      setStats(json.data.stats ?? { totalSessions: 0, avgScore: null, bestTrack: null })
    } catch (err) {
      console.error('[MockInterviewPractice] load failed:', err)
      setLoadError(err instanceof Error ? err.message : 'Could not load your practice sessions')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  const startPractice = async () => {
    if (!userId || !track || starting) return
    setStarting(true)
    try {
      const res = await fetch('/api/ai/mock-interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, track, difficulty }),
      })
      const json: {
        data?: { mockId: string; track: string; difficulty: string; resumed: boolean; questions: PracticeQuestion[] }
        error?: string
      } = await res.json()
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Could not start the practice session')
      }
      setQuiz({
        mockId: json.data.mockId,
        track: json.data.track,
        difficulty: json.data.difficulty,
        questions: json.data.questions,
        resumed: json.data.resumed === true,
      })
      setCurrent(0)
      setAnswers(new Array(json.data.questions.length).fill(''))
      setReport(null)
      setInProgress(null) // consumed by entering the quiz
      if (json.data.resumed) toast.info('Resumed your saved practice session')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the practice session')
    } finally {
      setStarting(false)
    }
  }

  const resumePractice = (ip: InProgress) => {
    setQuiz({
      mockId: ip.mockId,
      track: ip.track,
      difficulty: ip.difficulty,
      questions: ip.questions,
      resumed: true,
    })
    setCurrent(0)
    setAnswers(new Array(ip.questions.length).fill(''))
    setReport(null)
    setInProgress(null)
    toast.info('Resumed your saved practice session — questions kept, typed answers start fresh')
  }

  const submitPractice = async () => {
    if (!quiz || !userId || submitting) return
    if (answers.some((a) => a.trim().length < MIN_CHARS)) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/ai/mock-interview/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, mockId: quiz.mockId, answers }),
      })
      const json: { data?: Report; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Could not grade the practice session')
      }
      setReport(json.data)
      setReportSession({ track: quiz.track, questions: quiz.questions })
      setQuiz(null)
      toast.success('Practice report ready — only you can see this')
      void loadMine() // refresh history + stats behind the report
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not grade the practice session')
    } finally {
      setSubmitting(false)
    }
  }

  const exitQuiz = () => {
    setQuiz(null)
    setCurrent(0)
    setAnswers([])
    // the session stays IN_PROGRESS server-side — honest resume next time
    void loadMine()
  }

  const practiceAgain = () => {
    setReport(null)
    setReportSession(null)
    setTrack(null)
    setDifficulty('MEDIUM')
    void loadMine()
  }

  const answeredCount = useMemo(
    () => answers.filter((a) => a.trim().length >= MIN_CHARS).length,
    [answers]
  )

  if (!userId) return null

  /* ------------------------------- report view ------------------------------ */

  if (report) {
    const ring = 2 * Math.PI * 26
    const score = report.overallScore
    return (
      <div className="space-y-4" aria-live="polite">
        <Card className="rounded-xl border-slate-200 shadow-sm dark:border-slate-800">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-50 px-3 py-1 text-[11px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
              <ShieldCheck className="size-3.5" aria-hidden /> Practice report · private to you
            </span>
            <div className="relative">
              <svg viewBox="0 0 64 64" className="size-28 -rotate-90">
                <circle
                  cx="32"
                  cy="32"
                  r="26"
                  fill="none"
                  strokeWidth="6"
                  className="stroke-slate-100 dark:stroke-slate-800"
                />
                <circle
                  cx="32"
                  cy="32"
                  r="26"
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={ring}
                  strokeDashoffset={ring * (1 - score / 100)}
                  className={`${scoreStroke(score)} transition-[stroke-dashoffset] duration-700`}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <div>
                  <p className={`text-2xl font-bold ${scoreColor(score)}`}>{score}</p>
                  <p className="text-[11px] text-muted-foreground">out of 100</p>
                </div>
              </div>
            </div>
            <p className="max-w-md text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {report.summary}
            </p>
            {report.source === 'heuristic' && (
              <p className="text-[11px] text-muted-foreground">
                Simplified offline feedback — scores are indicative only.
              </p>
            )}
            <Button
              onClick={practiceAgain}
              className="h-11 w-full rounded-lg bg-violet-600 text-white hover:bg-violet-700 sm:h-9 sm:w-auto"
            >
              <RotateCcw className="size-4" aria-hidden /> Practice again
            </Button>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card className="rounded-xl border-emerald-200 bg-emerald-50/50 shadow-sm dark:border-emerald-900/60 dark:bg-emerald-950/20">
            <CardContent className="p-4">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                <Check className="size-4" aria-hidden /> Strengths
              </p>
              <ul className="space-y-1.5">
                {report.strengths.map((s, i) => (
                  <li key={i} className="text-sm text-emerald-900/90 dark:text-emerald-200/90">
                    {s}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card className="rounded-xl border-amber-200 bg-amber-50/50 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20">
            <CardContent className="p-4">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
                <Target className="size-4" aria-hidden /> Focus areas next
              </p>
              <ul className="space-y-1.5">
                {report.focusAreas.map((f, i) => (
                  <li key={i} className="text-sm text-amber-900/90 dark:text-amber-200/90">
                    {f}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-xl border-slate-200 shadow-sm dark:border-slate-800">
          <CardContent className="p-0">
            <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-200">
              Question-by-question review
            </p>
            <div className="max-h-96 overflow-y-auto p-4">
              <Accordion type="multiple" className="w-full">
                {report.perQuestion.map((pq, i) => (
                  <AccordionItem key={pq.qIndex} value={`q-${pq.qIndex}`}>
                    <AccordionTrigger className="hover:no-underline">
                      <span className="flex min-w-0 flex-1 items-center gap-2 pr-2 text-left">
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${scoreChip(pq.score)}`}
                        >
                          {pq.score}/100
                        </span>
                        <span className="min-w-0 break-words text-sm font-medium text-slate-800 dark:text-slate-200">
                          {i + 1}. {reportSession?.questions[i]?.focusArea ?? `Question ${i + 1}`}
                        </span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3">
                      {reportSession?.questions[i]?.question && (
                        <p className="text-sm italic text-slate-500 dark:text-slate-400">
                          {reportSession.questions[i].question}
                        </p>
                      )}
                      <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                        {pq.feedback}
                      </p>
                      <div className="rounded-lg bg-stone-50 p-3 dark:bg-stone-900">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500 dark:text-stone-400">
                          A strong answer would sound like
                        </p>
                        <p className="text-sm leading-relaxed text-stone-700 dark:text-stone-300">
                          {pq.sampleAnswer}
                        </p>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  /* -------------------------------- quiz view ------------------------------- */

  if (quiz) {
    const q = quiz.questions[current]
    const isLast = current === quiz.questions.length - 1
    const currentValid = (answers[current] ?? '').trim().length >= MIN_CHARS
    const allValid = answeredCount === quiz.questions.length
    const currentLen = (answers[current] ?? '').trim().length

    return (
      <Card className="rounded-xl border-slate-200 shadow-sm dark:border-slate-800">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {quiz.track}
              </p>
              <p className="text-xs text-muted-foreground">
                Question {current + 1}/{quiz.questions.length} · {quiz.difficulty}
                {quiz.resumed ? ' · resumed session' : ''}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={exitQuiz}
              className="h-9 shrink-0 text-muted-foreground hover:text-slate-700 dark:hover:text-slate-300"
              aria-label="Exit practice (session stays saved and can be resumed)"
            >
              Exit
            </Button>
          </div>

          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={quiz.questions.length}
            aria-valuenow={answeredCount}
            aria-label="Questions answered"
          >
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-300"
              style={{ width: `${(answeredCount / quiz.questions.length) * 100}%` }}
            />
          </div>

          <p className="text-base font-medium leading-relaxed text-slate-900 dark:text-slate-100">
            {q?.question}
          </p>

          {/* practice tip — shown BEFORE answering, this is practice mode */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
            <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
              <Lightbulb className="size-3.5" aria-hidden /> How to approach this
            </p>
            <p className="text-sm leading-relaxed text-amber-900/90 dark:text-amber-200/90">
              {q?.tip}
            </p>
          </div>

          <div>
            <label htmlFor="mock-answer" className="sr-only">
              Your answer to question {current + 1}
            </label>
            <textarea
              id="mock-answer"
              value={answers[current] ?? ''}
              onChange={(e) =>
                setAnswers((prev) => prev.map((v, i) => (i === current ? e.target.value : v)))
              }
              placeholder="Answer out loud, then type the key points here — structure beats length…"
              className="min-h-[200px] w-full resize-y rounded-lg border border-slate-300 bg-white p-3 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              aria-describedby="mock-answer-hint"
            />
            <p id="mock-answer-hint" className="mt-1 text-[11px] text-muted-foreground">
              {currentValid
                ? `${currentLen} characters — looking structured. ${answeredCount}/${quiz.questions.length} answered`
                : `Write at least ${MIN_CHARS} characters to count as answered (${answeredCount}/${quiz.questions.length} answered)`}
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
            <Button
              variant="outline"
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
              disabled={current === 0}
              className="h-11 flex-1 rounded-lg sm:h-9 sm:flex-none"
            >
              <ArrowLeft className="size-4" aria-hidden /> Back
            </Button>
            {!isLast ? (
              <Button
                onClick={() => setCurrent((c) => Math.min(quiz.questions.length - 1, c + 1))}
                className="h-11 flex-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 sm:h-9 sm:flex-none"
              >
                Next <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button
                onClick={() => void submitPractice()}
                disabled={!allValid || submitting}
                className="h-11 flex-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:cursor-not-allowed sm:h-9 sm:flex-none"
                aria-label="Submit practice answers for private feedback"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Reviewing…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" aria-hidden /> Submit for feedback
                  </>
                )}
              </Button>
            )}
          </div>
          {isLast && !allValid && (
            <p className="text-center text-xs text-muted-foreground">
              Answer every question (at least {MIN_CHARS} characters each) to enable Submit —
              use Back to review earlier ones.
            </p>
          )}
          <p className="text-center text-[11px] text-muted-foreground">
            Exit any time — the session stays saved so you can resume it.
          </p>
        </CardContent>
      </Card>
    )
  }

  /* -------------------------------- setup view ------------------------------ */

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-100 dark:bg-violet-950/40">
          <Sparkles className="size-5 text-violet-600" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Practice interview
            {user.name ? <span className="text-muted-foreground"> · {user.name}</span> : null}
          </h3>
          <p className="text-xs text-muted-foreground">
            Drill three questions against the coach, get a private score and a sample answer.
          </p>
        </div>
      </div>

      <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
        Only you see your practice results — recruiters never do
      </p>

      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="rounded-xl border-slate-200 shadow-sm dark:border-slate-800">
                <CardContent className="space-y-2 p-4">
                  <div className="h-4 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                  <div className="h-3 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="h-11 w-full animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        </div>
      ) : loadError ? (
        <Card className="rounded-xl border-dashed border-rose-300 shadow-sm dark:border-rose-900">
          <CardContent className="space-y-3 p-6 text-center">
            <p className="text-sm text-rose-700 dark:text-rose-300">{loadError}</p>
            <Button
              variant="outline"
              onClick={() => void loadMine()}
              className="h-11 rounded-lg sm:h-9"
            >
              <RotateCcw className="size-4" aria-hidden /> Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {inProgress && inProgress.questions.length > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/60 dark:bg-violet-950/20 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-violet-900 dark:text-violet-200">
                  Practice session in progress — {inProgress.track} ({inProgress.difficulty})
                </p>
                <p className="text-xs text-violet-700/80 dark:text-violet-300/80">
                  Questions are kept; typed answers from a previous visit aren&apos;t saved.
                </p>
              </div>
              <Button
                onClick={() => resumePractice(inProgress)}
                className="h-11 shrink-0 rounded-lg bg-violet-600 text-white hover:bg-violet-700 sm:h-9"
              >
                Resume <ArrowRight className="size-4" aria-hidden />
              </Button>
            </div>
          )}

          {/* track picker */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pick a track
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {TRACKS.map((t) => {
                const Icon = t.icon
                const selected = track === t.track
                return (
                  <button
                    key={t.track}
                    type="button"
                    onClick={() => setTrack(t.track)}
                    aria-pressed={selected}
                    className={`flex min-h-11 w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                      selected
                        ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-500/50 dark:bg-violet-950/40'
                        : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/40 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-violet-700 dark:hover:bg-violet-950/20'
                    }`}
                  >
                    <span
                      className={`grid size-8 shrink-0 place-items-center rounded-lg ${
                        selected
                          ? 'bg-violet-600 text-white'
                          : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
                      }`}
                      aria-hidden
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {t.track}
                      </span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                        {t.blurb}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* difficulty segmented control */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Difficulty
            </p>
            <div
              className="inline-flex w-full overflow-hidden rounded-lg border border-slate-200 sm:w-auto dark:border-slate-700"
              role="group"
              aria-label="Difficulty"
            >
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDifficulty(d)}
                  aria-pressed={difficulty === d}
                  className={`min-h-11 flex-1 px-5 py-2 text-sm font-medium transition-colors sm:flex-none ${
                    difficulty === d
                      ? 'bg-violet-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-violet-50 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-violet-950/30'
                  }`}
                >
                  {d.charAt(0) + d.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          <Button
            onClick={() => void startPractice()}
            disabled={!track || starting}
            className="h-11 w-full rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:cursor-not-allowed sm:h-10 sm:w-auto sm:px-8"
          >
            {starting ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden /> Preparing questions…
              </>
            ) : (
              <>
                <Sparkles className="size-4" aria-hidden /> Start practice
              </>
            )}
          </Button>

          {/* history strip + lifetime stats */}
          <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recent sessions
              </p>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <TrendingUp className="size-3" aria-hidden />
                {stats.totalSessions === 0
                  ? 'No completed sessions yet'
                  : `${stats.totalSessions} completed${stats.avgScore != null ? ` · avg ${stats.avgScore}/100` : ''}${stats.bestTrack ? ` · strongest: ${stats.bestTrack}` : ''}`}
              </p>
            </div>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Finish a practice session and it will appear here — visible only to you.
              </p>
            ) : (
              <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto pr-1">
                {history.map((h) => (
                  <span
                    key={h.id}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-[11px] text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                    title={`${h.track} · ${h.difficulty} · ${h.overallScore ?? '—'}/100`}
                  >
                    <span className="max-w-[10rem] truncate font-medium">{h.track}</span>
                    <span aria-hidden>·</span>
                    <span className={h.overallScore != null ? scoreColor(h.overallScore) : ''}>
                      {h.overallScore != null ? `${h.overallScore}/100` : '—'}
                    </span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0 text-stone-500 dark:text-stone-400">
                      {formatDate(h.completedAt)}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
