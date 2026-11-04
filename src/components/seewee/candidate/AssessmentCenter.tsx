'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SkillBadge } from '@/components/seewee/SkillBadge'

/* ------------------------------------------------------------------ */
/* Skill verification — candidate-facing assessment widget             */
/* Self-contained: fetches its own data, safe to embed anywhere.       */
/* ------------------------------------------------------------------ */

type BadgeLevel = 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE'

interface DomainSummary {
  domain: string
  description: string
  bestBadge: BadgeLevel | null
  attempts: number
  lastPercentage: number | null
  lastAt: string | null
}

interface QuizQuestion {
  qIndex: number
  question: string
  options: string[]
}

interface InProgress {
  assessmentId: string
  domain: string
  totalQuestions: number
  startedAt: string
  questions: QuizQuestion[]
}

interface ReviewItem {
  qIndex: number
  question: string
  chosen: number
  chosenText?: string
  correctIndex: number
  correctText?: string
  explanation: string
  correct: boolean
}

interface QuizState {
  assessmentId: string
  domain: string
  questions: QuizQuestion[]
  resumed: boolean
}

interface ResultState {
  domain: string
  score: number
  total: number
  percentage: number
  badge: BadgeLevel
  review: ReviewItem[]
}

const OPTION_LABELS = ['A', 'B', 'C', 'D']

const BADGE_COPY: Record<BadgeLevel, string> = {
  GOLD: 'Outstanding — a Gold badge now shows on your profile.',
  SILVER: 'Strong result — a Silver badge now shows on your profile.',
  BRONZE: 'Badge earned — keep practising to reach Silver.',
  NONE: 'Not quite — review the explanations and retake any time.',
}

function ringColor(badge: BadgeLevel): string {
  switch (badge) {
    case 'GOLD':
      return 'text-amber-500'
    case 'SILVER':
      return 'text-stone-400'
    case 'BRONZE':
      return 'text-orange-600'
    default:
      return 'text-rose-400'
  }
}

export default function AssessmentCenter({ user }: { user: { id: string; name?: string } }) {
  const [domains, setDomains] = useState<DomainSummary[]>([])
  const [inProgress, setInProgress] = useState<InProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [startingDomain, setStartingDomain] = useState<string | null>(null)

  const [quiz, setQuiz] = useState<QuizState | null>(null)
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<(number | null)[]>([])
  const [submitting, setSubmitting] = useState(false)

  const [result, setResult] = useState<ResultState | null>(null)

  const userId = user?.id

  const loadMine = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(`/api/assessments?userId=${encodeURIComponent(userId)}&mine=1`)
      const json: { domains?: DomainSummary[]; inProgress?: InProgress | null; error?: string } =
        await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Could not load assessments')
      setDomains(json.domains ?? [])
      setInProgress(json.inProgress ?? null)
    } catch (err) {
      console.error('[AssessmentCenter] load failed:', err)
      // quiet failure — the grid simply stays empty
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void loadMine()
  }, [loadMine])

  const startQuiz = async (domain: string) => {
    if (!userId || startingDomain) return
    setStartingDomain(domain)
    try {
      const res = await fetch('/api/assessments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, domain }),
      })
      const json: {
        assessmentId?: string
        questions?: QuizQuestion[]
        resumed?: boolean
        error?: string
      } = await res.json()
      if (!res.ok || json.error || !json.assessmentId || !json.questions) {
        throw new Error(json.error || 'Could not start the assessment')
      }
      setQuiz({
        assessmentId: json.assessmentId,
        domain,
        questions: json.questions,
        resumed: json.resumed === true,
      })
      setCurrent(0)
      setAnswers(new Array(json.questions.length).fill(null))
      setResult(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the assessment')
    } finally {
      setStartingDomain(null)
    }
  }

  const resumeQuiz = (ip: InProgress) => {
    setQuiz({ assessmentId: ip.assessmentId, domain: ip.domain, questions: ip.questions, resumed: true })
    setCurrent(0)
    setAnswers(new Array(ip.questions.length).fill(null))
    setResult(null)
  }

  const submitQuiz = async () => {
    if (!quiz || !userId || answers.some((a) => a === null)) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/assessments/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, assessmentId: quiz.assessmentId, answers }),
      })
      const json: {
        domain?: string
        score?: number
        total?: number
        percentage?: number
        badge?: BadgeLevel
        review?: ReviewItem[]
        error?: string
      } = await res.json()
      if (!res.ok || json.error || json.badge === undefined) {
        throw new Error(json.error || 'Could not grade the assessment')
      }
      const badge = json.badge
      const pct = json.percentage ?? 0
      if (badge === 'NONE') {
        toast(`Attempt saved · ${pct}% — review the explanations and retake any time`)
      } else {
        toast.success(
          `${badge === 'GOLD' ? '🏆' : badge === 'SILVER' ? '🥈' : '🥉'} ${
            badge.charAt(0) + badge.slice(1).toLowerCase()
          } badge · ${pct}% · ${quiz.domain}`
        )
      }
      setResult({
        domain: quiz.domain,
        score: json.score ?? 0,
        total: json.total ?? 5,
        percentage: pct,
        badge,
        review: json.review ?? [],
      })
      setQuiz(null)
      void loadMine() // refresh badges/attempt counts behind the result view
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not grade the assessment')
    } finally {
      setSubmitting(false)
    }
  }

  const exitQuiz = () => {
    setQuiz(null)
    setResult(null)
    setCurrent(0)
  }

  if (!userId) return null

  /* ------------------------------- result view ------------------------------ */

  if (result) {
    const ring = 2 * Math.PI * 26
    return (
      <div className="space-y-4">
        <Card className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {result.domain} · result
            </p>
            <SkillBadge badge={result.badge} size="lg" />
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
                  strokeDashoffset={ring * (1 - result.percentage / 100)}
                  className={`${ringColor(result.badge)} transition-[stroke-dashoffset] duration-700`}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <div>
                  <p className="text-xl font-bold text-slate-900 dark:text-slate-100">
                    {result.percentage}%
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {result.score}/{result.total} correct
                  </p>
                </div>
              </div>
            </div>
            <p
              className={`max-w-sm text-sm ${
                result.badge === 'NONE'
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-emerald-700 dark:text-emerald-400'
              }`}
            >
              {BADGE_COPY[result.badge]}
            </p>
            <Button onClick={exitQuiz} className="h-11 w-full rounded-lg bg-violet-600 text-white hover:bg-violet-700 sm:h-9 sm:w-auto">
              Done
            </Button>
          </CardContent>
        </Card>

        {/* review */}
        <Card className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
          <CardContent className="p-0">
            <p className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:text-slate-200">
              Review your answers
            </p>
            <div className="max-h-[24rem] space-y-3 overflow-y-auto p-4">
              {result.review.map((r) => (
                <div
                  key={r.qIndex}
                  className={`rounded-lg border p-3 ${
                    r.correct
                      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                      : 'border-rose-200 bg-rose-50/60 dark:border-rose-900/60 dark:bg-rose-950/30'
                  }`}
                >
                  <p className="flex items-start gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    {r.correct ? (
                      <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
                    ) : (
                      <X className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden />
                    )}
                    <span>
                      {r.qIndex + 1}. {r.question}
                    </span>
                  </p>
                  <p className="mt-1.5 pl-6 text-xs text-slate-600 dark:text-slate-400">
                    Your answer:{' '}
                    <span className={r.correct ? 'font-semibold text-emerald-700' : 'font-semibold text-rose-600'}>
                      {OPTION_LABELS[r.chosen] ?? '—'}. {r.chosenText || '—'}
                    </span>
                    {!r.correct && (
                      <>
                        {' '}
                        · Correct:{' '}
                        <span className="font-semibold text-emerald-700">
                          {OPTION_LABELS[r.correctIndex]}. {r.correctText || '—'}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="mt-1 pl-6 text-xs italic text-slate-500 dark:text-slate-400">
                    {r.explanation}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  /* -------------------------------- quiz view ------------------------------- */

  if (quiz) {
    const q = quiz.questions[current]
    const answered = answers.filter((a) => a !== null).length
    const allAnswered = answered === quiz.questions.length

    return (
      <Card className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
        <CardContent className="space-y-5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                {quiz.domain}
              </p>
              <p className="text-xs text-muted-foreground">
                Question {current + 1} of {quiz.questions.length} · {answered} answered
                {quiz.resumed ? ' · resumed attempt' : ''}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={exitQuiz}
              className="h-9 shrink-0 text-muted-foreground hover:text-slate-700 dark:hover:text-slate-300"
              aria-label="Exit assessment (progress is saved and can be resumed)"
            >
              Exit
            </Button>
          </div>

          {/* calm progress bar: answered questions */}
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={quiz.questions.length}
            aria-valuenow={answered}
            aria-label="Questions answered"
          >
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-300"
              style={{ width: `${(answered / quiz.questions.length) * 100}%` }}
            />
          </div>

          <p className="text-base font-medium leading-relaxed text-slate-900 dark:text-slate-100">
            {q?.question}
          </p>

          <div className="grid gap-2" role="radiogroup" aria-label={`Options for question ${current + 1}`}>
            {(q?.options ?? []).map((opt, oi) => {
              const selected = answers[current] === oi
              return (
                <button
                  key={oi}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() =>
                    setAnswers((prev) => prev.map((v, i) => (i === current ? oi : v)))
                  }
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left text-sm transition-colors ${
                    selected
                      ? 'border-violet-500 bg-violet-50 text-slate-900 ring-2 ring-violet-500/60 dark:bg-violet-950/40 dark:text-slate-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:bg-violet-50/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-violet-700 dark:hover:bg-violet-950/20'
                  }`}
                >
                  <span
                    className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                      selected
                        ? 'bg-violet-600 text-white'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                    aria-hidden
                  >
                    {OPTION_LABELS[oi]}
                  </span>
                  <span className="min-w-0">{opt}</span>
                </button>
              )
            })}
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
            {current < quiz.questions.length - 1 ? (
              <Button
                onClick={() => setCurrent((c) => Math.min(quiz.questions.length - 1, c + 1))}
                className="h-11 flex-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 sm:h-9 sm:flex-none"
              >
                Next <ArrowRight className="size-4" aria-hidden />
              </Button>
            ) : (
              <Button
                onClick={() => void submitQuiz()}
                disabled={!allAnswered || submitting}
                className="h-11 flex-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:cursor-not-allowed sm:h-9 sm:flex-none"
                aria-label="Submit assessment for grading"
              >
                {submitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Grading…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" aria-hidden /> Submit
                  </>
                )}
              </Button>
            )}
          </div>
          {!allAnswered && current === quiz.questions.length - 1 && (
            <p className="text-center text-xs text-muted-foreground">
              Answer every question to enable Submit — use Back to review earlier ones.
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  /* -------------------------------- grid view ------------------------------- */

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-100 dark:bg-violet-950/40">
          <ShieldCheck className="size-5 text-violet-600" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Skill verification
            {user.name ? <span className="text-muted-foreground"> · {user.name}</span> : null}
          </h3>
          <p className="text-xs text-muted-foreground">
            Take a 5-question check. Score 60%+ to earn a badge recruiters can see. Your best
            attempt counts.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
              <CardContent className="space-y-2 p-4">
                <div className="h-4 w-28 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-3 w-full animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-8 w-24 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : domains.length === 0 ? (
        <Card className="rounded-xl border-dashed border-slate-300 dark:border-slate-700 shadow-sm">
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Assessments are unavailable right now — please try again later.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {domains.map((d) => {
            const resumable = inProgress?.domain === d.domain
            const busy = startingDomain === d.domain
            return (
              <Card
                key={d.domain}
                className="flex flex-col rounded-xl border-slate-200 dark:border-slate-800 shadow-sm"
              >
                <CardContent className="flex flex-1 flex-col gap-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{d.domain}</p>
                    <SkillBadge badge={d.bestBadge} size="xs" />
                  </div>
                  <p className="flex-1 text-xs leading-relaxed text-muted-foreground">
                    {d.description}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {d.attempts === 0
                      ? 'No attempts yet'
                      : `${d.attempts} attempt${d.attempts === 1 ? '' : 's'}${
                          d.lastPercentage != null ? ` · last ${d.lastPercentage}%` : ''
                        }`}
                  </p>
                  <Button
                    size="sm"
                    variant={resumable ? 'default' : d.attempts > 0 ? 'outline' : 'default'}
                    disabled={startingDomain !== null}
                    onClick={() => (resumable && inProgress ? resumeQuiz(inProgress) : void startQuiz(d.domain))}
                    className="h-11 w-full rounded-lg text-xs sm:h-8"
                    aria-label={`${resumable ? 'Resume' : d.attempts > 0 ? 'Retake' : 'Take'} the ${d.domain} assessment`}
                  >
                    {busy ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" aria-hidden /> Preparing…
                      </>
                    ) : resumable ? (
                      'Resume'
                    ) : d.attempts > 0 ? (
                      <>
                        <RotateCcw className="size-3.5" aria-hidden /> Retake
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-3.5" aria-hidden /> Take assessment
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
