'use client'

/**
 * CandidateLeaderboard — per-job, evaluation-driven ranking of AI-interviewed
 * candidates (recruiter-only surface).
 *
 * Flow: pick a job with AI screening enabled → its applications are loaded →
 * every COMPLETED interview is lazily graded through
 * POST /api/ai/evaluate-interview (idempotent server-side; results cached in
 * component state so re-visits don't re-grade) → ranked table by overall
 * score with 4-factor breakdown, proctoring flags, per-question video
 * playback and pipeline actions (Shortlist / Hold / Reject / Offer / Sync).
 *
 * PRIVACY: scores, verdicts, evaluations and the push audit live ONLY here and
 * in other recruiter surfaces — never wire any of this into a candidate view.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Award,
  Bot,
  Briefcase,
  Camera,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileVideo,
  Loader2,
  Medal,
  RefreshCw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Timer,
  Trophy,
  X,
  XCircle,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import type { Application, Job } from '@/lib/types'
import { statusMetaFor } from './statusMeta'
import { timeAgoShort } from './timeAgo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

interface EvaluationData {
  id: string
  interviewId: string
  overallScore: number
  technicalScore: number | null
  communicationScore: number | null
  problemSolvingScore: number | null
  presentationScore: number | null
  keyStrengths: string[]
  keyWeaknesses: string[]
  antiCheatFlags: string[]
  atsSyncStatus: string
  verdict?: string | null
  perQuestion?: { qIndex: number; score: number; feedback: string }[]
}

type EvalState =
  | { status: 'loading' }
  | { status: 'done'; evaluation: EvaluationData }
  | { status: 'error'; message: string }

interface AppSlice {
  app: Application
  interviewId: string | null
  interviewStatus: string | null
}

interface VideoDetail {
  questions: { qIndex: number; text: string; type?: string; isSkippable?: boolean }[]
  answers: {
    qIndex: number
    transcript?: string | null
    mediaPath?: string | null
    mediaKind?: string | null
    mediaSeconds?: number | null
    score?: number | null
  }[]
}

const FACTORS = [
  { key: 'technicalScore', label: 'Technical', weight: '40%' },
  { key: 'communicationScore', label: 'Communication', weight: '25%' },
  { key: 'problemSolvingScore', label: 'Problem Solving', weight: '20%' },
  { key: 'presentationScore', label: 'Presentation', weight: '15%' },
] as const

const FLAG_LABELS: Record<string, string> = {
  TAB_SWITCH: 'Tab switching detected',
  CAMERA_LOST: 'Camera feed lost',
  MISSING_TRANSCRIPT: 'Answer transcript missing',
  NO_ANSWER: 'No answer recorded',
  EVALUATION_FALLBACK: 'Graded via fallback scoring (AI unavailable)',
}

const VERDICT_PILLS: Record<string, string> = {
  STRONG_HIRE: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  HIRE: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  MAYBE: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  NO_HIRE: 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
}

const SYNC_PILLS: Record<string, { label: string; cls: string }> = {
  PENDING: {
    label: 'ATS · pending',
    cls: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400',
  },
  SYNCED: {
    label: 'ATS · synced',
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  FAILED: {
    label: 'ATS · failed',
    cls: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  },
  SKIPPED: {
    label: 'ATS · skipped',
    cls: 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-500',
  },
}

function flagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? flag.replaceAll('_', ' ').toLowerCase()
}

function scoreColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500'
  if (pct >= 65) return 'bg-sky-500'
  if (pct >= 50) return 'bg-amber-500'
  return 'bg-rose-500'
}

function scoreTextColor(pct: number): string {
  if (pct >= 80) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 65) return 'text-sky-600 dark:text-sky-400'
  if (pct >= 50) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}

async function readApi<T>(res: Response): Promise<T> {
  const json: { data?: T; error?: string } = await res.json().catch(() => ({}))
  if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`)
  return json.data as T
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

/** 0-100 circular score ring */
function ScoreRing({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value))
  const R = 20
  const CIRC = 2 * Math.PI * R
  return (
    <div className="relative grid size-12 shrink-0 place-items-center" role="img" aria-label={`Overall score ${pct} of 100`}>
      <svg viewBox="0 0 48 48" className="size-12 -rotate-90">
        <circle cx="24" cy="24" r={R} fill="none" strokeWidth="5" className="stroke-slate-100 dark:stroke-slate-800" />
        <circle
          cx="24"
          cy="24"
          r={R}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          stroke="currentColor"
          className={scoreTextColor(pct)}
          strokeDasharray={`${(pct / 100) * CIRC} ${CIRC}`}
        />
      </svg>
      <span className={`absolute text-xs font-black tabular-nums ${scoreTextColor(pct)}`}>{Math.round(pct)}</span>
    </div>
  )
}

function FactorBars({ evaluation }: { evaluation: EvaluationData }) {
  return (
    <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4" aria-label="Four-factor breakdown">
      {FACTORS.map(({ key, label, weight }) => {
        const raw = evaluation[key]
        const val = typeof raw === 'number' ? raw : 0
        return (
          <div key={key}>
            <div className="mb-0.5 flex items-baseline justify-between gap-1">
              <span className="truncate text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                {label} <span className="font-normal text-slate-400 dark:text-slate-500">{weight}</span>
              </span>
              <span className={`text-[10px] font-bold tabular-nums ${scoreTextColor(val)}`}>{Math.round(val)}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-500 ${scoreColor(val)}`}
                style={{ width: `${Math.max(3, Math.min(100, val))}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <Badge className="gap-1 rounded-full bg-gradient-to-r from-amber-500 to-amber-600 px-2.5 py-1 text-[11px] font-black text-white shadow-sm" aria-label="Rank 1">
        <Medal className="size-3" aria-hidden /> #1
      </Badge>
    )
  }
  if (rank <= 3) {
    return (
      <Badge variant="outline" className="gap-1 rounded-full border-slate-300 px-2.5 py-1 text-[11px] font-black text-slate-600 dark:border-slate-600 dark:text-slate-300" aria-label={`Rank ${rank}`}>
        <Award className="size-3" aria-hidden /> #{rank}
      </Badge>
    )
  }
  return (
    <span className="inline-grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400" aria-label={`Rank ${rank}`}>
      {rank}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function CandidateLeaderboard({
  /** optional handoff — opens the Integrations tab when no ATS is connected */
  onOpenIntegrations,
}: {
  onOpenIntegrations?: () => void
} = {}) {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const recruiterId = user?.role === 'RECRUITER' ? user.id : ''

  // ---- job picker ----
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [jobsLoading, setJobsLoading] = useState(true)
  const [jobId, setJobId] = useState('')

  // ---- applications + evaluations ----
  const [apps, setApps] = useState<Application[] | null>(null)
  const [appsLoading, setAppsLoading] = useState(false)
  const [evals, setEvals] = useState<Record<string, EvalState>>({})
  const evalsInFlight = useRef<Set<string>>(new Set())

  // ---- video dialog ----
  const [videoApp, setVideoApp] = useState<{ appId: string; name: string; interviewId: string } | null>(null)
  const [videoDetail, setVideoDetail] = useState<VideoDetail | null>(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoQ, setVideoQ] = useState(0)

  // ---- actions ----
  const [actingId, setActingId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  /* ---------------- data loading ---------------- */

  const loadJobs = useCallback(async () => {
    if (!recruiterId) return
    setJobsLoading(true)
    try {
      const data = await readApi<{ jobs: Job[] }>(
        await fetch(`/api/jobs?recruiterId=${encodeURIComponent(recruiterId)}&limit=100`)
      )
      const aiJobs = (data.jobs ?? []).filter((j) => j.aiInterviewEnabled === true)
      setJobs(aiJobs)
      setJobId((prev) => (prev && aiJobs.some((j) => j.id === prev) ? prev : aiJobs[0]?.id ?? ''))
    } catch (err) {
      setJobs([])
      toast.error(err instanceof Error ? err.message : 'Failed to load jobs')
    } finally {
      setJobsLoading(false)
    }
  }, [recruiterId])

  const loadApps = useCallback(
    async (id: string) => {
      if (!recruiterId || !id) return
      setAppsLoading(true)
      try {
        const data = await readApi<Application[]>(
          await fetch(
            `/api/applications?recruiterId=${encodeURIComponent(recruiterId)}&jobId=${encodeURIComponent(id)}`
          )
        )
        setApps(data ?? [])
      } catch (err) {
        setApps([])
        toast.error(err instanceof Error ? err.message : 'Failed to load applicants')
      } finally {
        setAppsLoading(false)
      }
    },
    [recruiterId]
  )

  useEffect(() => {
    void loadJobs()
  }, [loadJobs, refreshKey])

  useEffect(() => {
    if (jobId) void loadApps(jobId)
    else setApps(null)
  }, [jobId, loadApps, refreshKey])

  /** Lazily grade one interview (skipped when already loading/done). */
  const evaluate = useCallback(
    async (interviewId: string, force = false) => {
      if (!recruiterId || !interviewId) return
      if (!force) {
        if (evalsInFlight.current.has(interviewId)) return
        const existing = evals[interviewId]
        if (existing && (existing.status === 'done' || existing.status === 'loading')) return
      }
      evalsInFlight.current.add(interviewId)
      setEvals((prev) => ({ ...prev, [interviewId]: { status: 'loading' } }))
      try {
        const data = await readApi<{ evaluation: EvaluationData }>(
          await fetch('/api/ai/evaluate-interview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ interviewId, recruiterId }),
          })
        )
        setEvals((prev) => ({
          ...prev,
          [interviewId]: { status: 'done', evaluation: { ...data.evaluation, interviewId } },
        }))
      } catch (err) {
        setEvals((prev) => ({
          ...prev,
          [interviewId]: {
            status: 'error',
            message: err instanceof Error ? err.message : 'Evaluation failed',
          },
        }))
      } finally {
        evalsInFlight.current.delete(interviewId)
      }
    },
    [recruiterId, evals]
  )

  // split + grade whenever applications change
  const { completed, awaiting } = useMemo(() => {
    const done: AppSlice[] = []
    const wait: AppSlice[] = []
    for (const app of apps ?? []) {
      const shortlist = app.shortlists?.find((s) => s.interview) ?? app.shortlists?.[0]
      const iv = shortlist?.interview
      if (iv && iv.status === 'COMPLETED') {
        done.push({ app, interviewId: iv.id, interviewStatus: iv.status })
      } else {
        wait.push({ app, interviewId: iv?.id ?? null, interviewStatus: iv?.status ?? null })
      }
    }
    return { completed: done, awaiting: wait }
  }, [apps])

  useEffect(() => {
    if (completed.length === 0) return
    for (const slice of completed) {
      if (slice.interviewId) void evaluate(slice.interviewId)
    }
    // evaluate() identity changes with the evals cache — the in-flight guard
    // above keeps this loop from re-grading anything already graded.
  }, [completed.map((c) => c.interviewId).join(','), recruiterId])

  // ranked rows: graded first by overallScore desc, then errored/pending
  const ranked = useMemo(() => {
    const scoreOf = (slice: AppSlice): number | null => {
      const st = slice.interviewId ? evals[slice.interviewId] : undefined
      return st?.status === 'done' ? st.evaluation.overallScore : null
    }
    return [...completed].sort((a, b) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1))
  }, [completed, evals])

  const evaluating = completed.filter(
    (c) => c.interviewId && (evals[c.interviewId]?.status === 'loading' || !evals[c.interviewId])
  ).length

  /* ---------------- actions ---------------- */

  const setStatus = async (slice: AppSlice, status: string, label: string) => {
    setActingId(slice.app.id)
    // optimistic pill update
    setApps((prev) =>
      (prev ?? []).map((a) => (a.id === slice.app.id ? { ...a, status: status as Application['status'] } : a))
    )
    try {
      await readApi(
        await fetch(`/api/applications/${slice.app.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        })
      )
      toast.success(`${slice.app.candidate?.name ?? 'Candidate'} → ${label}`)
      bumpRefresh() // other panels refetch; this one reconciles via refreshKey
    } catch (err) {
      // server truth reconciles via the jobId/refreshKey reload below
      toast.error(err instanceof Error ? err.message : `Could not mark ${label}`)
      if (jobId) void loadApps(jobId)
    } finally {
      setActingId(null)
    }
  }

  const syncToAts = async (slice: AppSlice) => {
    if (!recruiterId || !slice.interviewId) return
    setSyncingId(slice.app.id)
    try {
      // pick the recruiter's first ACTIVE integration
      const integrations = await readApi<{ id: string; name: string; active: boolean; apiKey: string | null }[]>(
        await fetch(`/api/ats/integrations?recruiterId=${encodeURIComponent(recruiterId)}`)
      )
      const target = integrations.find((i) => i.active)
      if (!target) {
        toast.error('Connect an ATS first', {
          description: 'The ATS Integration Center takes about a minute to set up.',
          action: onOpenIntegrations
            ? { label: 'Open Integrations', onClick: () => onOpenIntegrations() }
            : undefined,
        })
        return
      }
      const data = await readApi<{
        pushId: string
        status: string
        httpStatus: number | null
        message: string | null
        evaluationSynced: boolean
      }>(
        await fetch('/api/ats/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recruiterId, integrationId: target.id, interviewId: slice.interviewId }),
        })
      )
      if (data.status === 'SUCCESS') {
        toast.success(`${slice.app.candidate?.name ?? 'Candidate'} delivered to ${target.name}`, {
          description: data.message ?? undefined,
        })
      } else if (data.status === 'SKIPPED') {
        toast.info('Demo-mode ATS — nothing delivered', {
          description:
            'This integration has no real endpoint URL yet. Add the ATS webhook URL in the Integration Center to deliver dossiers.',
        })
      } else {
        toast.warning(`Push failed — ${data.message ?? 'unknown error'}`, {
          description: 'The attempt is logged in the Integration Center activity feed.',
        })
      }
      // reflect sync status on the row
      if (slice.interviewId) {
        setEvals((prev) => {
          const st = prev[slice.interviewId!]
          if (st?.status !== 'done') return prev
          return {
            ...prev,
            [slice.interviewId!]: {
              status: 'done',
              evaluation: {
                ...st.evaluation,
                atsSyncStatus:
                  data.status === 'SUCCESS' ? 'SYNCED' : data.status === 'SKIPPED' ? 'SKIPPED' : 'FAILED',
              },
            },
          }
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ATS sync failed')
    } finally {
      setSyncingId(null)
    }
  }

  /* ---------------- video dialog ---------------- */

  const openVideo = async (slice: AppSlice) => {
    if (!slice.interviewId) return
    setVideoApp({ appId: slice.app.id, name: slice.app.candidate?.name ?? 'Candidate', interviewId: slice.interviewId })
    setVideoDetail(null)
    setVideoLoading(true)
    setVideoQ(0)
    try {
      // GET /api/interview/[id] — parsed questions (text lives in `question`)
      // + answers ordered by qIndex; recruiter surfaces use this endpoint today.
      const res = await fetch(`/api/interview/${encodeURIComponent(slice.interviewId)}`)
      const json: {
        data?: {
          questions?: { qIndex?: number; question?: string; type?: string; isSkippable?: boolean }[]
          answers?: {
            qIndex?: number
            transcript?: string | null
            mediaPath?: string | null
            mediaKind?: string | null
            mediaSeconds?: number | null
            score?: number | null
          }[]
        }
        error?: string
      } = await res.json()
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Could not load the interview recording')
      }
      const questions = (json.data.questions ?? []).map((q) => ({
        qIndex: Number(q.qIndex ?? 0),
        text: String(q.question ?? ''),
        type: q.type,
        isSkippable: q.isSkippable === true,
      }))
      const answers = (json.data.answers ?? []).map((a) => ({
        qIndex: Number(a.qIndex ?? 0),
        transcript: a.transcript,
        mediaPath: a.mediaPath,
        mediaKind: a.mediaKind,
        mediaSeconds: a.mediaSeconds,
        score: a.score,
      }))
      setVideoDetail({ questions, answers })
      // jump to the first question that actually has a recording
      const firstWithMedia = answers.find((a) => a.mediaPath)?.qIndex ?? 0
      setVideoQ(firstWithMedia)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load the interview recording')
      setVideoApp(null)
    } finally {
      setVideoLoading(false)
    }
  }

  const currentAnswer = videoDetail?.answers.find((a) => a.qIndex === videoQ)
  const currentQuestion = videoDetail?.questions.find((q) => q.qIndex === videoQ)
  const currentEval = (() => {
    if (!videoApp) return null
    const st = evals[videoApp.interviewId]
    return st?.status === 'done' ? st.evaluation : null
  })()
  const currentFeedback = currentEval?.perQuestion?.find((p) => p.qIndex === videoQ)

  /* ---------------- render ---------------- */

  if (!user || user.role !== 'RECRUITER') return null

  const selectedJob = jobs?.find((j) => j.id === jobId)

  return (
    <div className="space-y-4">
      {/* header + job picker */}
      <Card className="rounded-xl border-slate-200 shadow-sm dark:border-slate-800">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-sm"
              aria-hidden
            >
              <Trophy className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 sm:text-base">
                Candidate Leaderboard
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Multi-factor AI ranking — Technical 40% · Communication 25% · Problem Solving 20% · Presentation 15%
              </p>
            </div>
          </div>
          <div className="w-full sm:w-72">
            {jobsLoading ? (
              <Skeleton className="h-10 w-full rounded-lg" />
            ) : jobs && jobs.length > 0 ? (
              <Select value={jobId} onValueChange={setJobId}>
                <SelectTrigger
                  className="h-10 w-full rounded-lg border-slate-200 dark:border-slate-800"
                  aria-label="Pick a job with AI interviews"
                >
                  <SelectValue placeholder="Pick a job with AI interviews" />
                </SelectTrigger>
                <SelectContent>
                  {jobs.map((j) => (
                    <SelectItem key={j.id} value={j.id}>
                      {j.title}
                      {j.status !== 'ACTIVE' ? ` · ${j.status.toLowerCase()}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                No jobs with AI screening yet — turn on AI Screening when posting a job.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* body */}
      {!jobId ? null : appsLoading && apps == null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : completed.length === 0 && awaiting.length === 0 ? (
        <Card className="rounded-xl border-dashed border-slate-300 shadow-sm dark:border-slate-700">
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
            <Bot className="size-8 text-slate-300 dark:text-slate-600" aria-hidden />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No applicants here yet</p>
            <p className="max-w-sm text-xs text-slate-500 dark:text-slate-400">
              Applications for this role will appear the moment candidates apply.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {evaluating > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2 text-xs font-medium text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Grading {evaluating} AI interview{evaluating === 1 ? '' : 's'} — multi-factor evaluation usually
              takes a few seconds per candidate…
            </div>
          )}

          {/* ranked graded rows */}
          <div className="space-y-2">
            {ranked.map((slice, idx) => {
              const rank = idx + 1
              const st = slice.interviewId ? evals[slice.interviewId] : undefined
              const cand = slice.app.candidate
              const evalData = st?.status === 'done' ? st.evaluation : null
              const isOpen = expandedId === slice.app.id
              const acted = ['SHORTLISTED', 'HOLD', 'REJECTED', 'OFFERED'].includes(slice.app.status)
              const meta = statusMetaFor(slice.app.status)
              const syncPill = evalData ? (SYNC_PILLS[evalData.atsSyncStatus] ?? SYNC_PILLS.PENDING) : null

              return (
                <div
                  key={slice.app.id}
                  className={`rounded-xl border bg-white shadow-sm transition-colors dark:bg-slate-900 ${
                    isOpen
                      ? 'border-blue-300 dark:border-blue-800'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700'
                  }`}
                >
                  {/* row head */}
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : slice.app.id)}
                    aria-expanded={isOpen}
                    className="flex w-full flex-wrap items-center gap-3 p-3.5 text-left sm:flex-nowrap"
                  >
                    <RankBadge rank={rank} />

                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm font-bold text-slate-800 dark:text-slate-200">
                        {cand?.name ?? 'Unknown candidate'}
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                      </p>
                      <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                        {cand?.headline || cand?.company || '—'}
                        {typeof slice.app.matchScore === 'number' && (
                          <span className="font-semibold text-slate-500 dark:text-slate-400">
                            {' '}· job fit {Math.round(slice.app.matchScore)}%
                          </span>
                        )}
                      </p>
                    </div>

                    {/* verdict + ATS chips */}
                    <div className="hidden items-center gap-1.5 md:flex">
                      {evalData?.verdict && (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                            VERDICT_PILLS[evalData.verdict] ?? VERDICT_PILLS.MAYBE
                          }`}
                        >
                          {(evalData.verdict ?? '').replace('_', ' ')}
                        </span>
                      )}
                      {syncPill && (
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold ${syncPill.cls}`}
                        >
                          {syncPill.label}
                        </span>
                      )}
                    </div>

                    {/* score */}
                    <div className="flex w-24 shrink-0 items-center justify-end gap-2 sm:w-28">
                      {st?.status === 'loading' && (
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400">
                          <Loader2 className="size-3.5 animate-spin" aria-hidden /> grading
                        </span>
                      )}
                      {st?.status === 'error' && (
                        <span className="text-[10px] font-semibold text-rose-500" title={st.message}>
                          eval failed
                        </span>
                      )}
                      {evalData && <ScoreRing value={evalData.overallScore} />}
                    </div>

                    <ChevronDown
                      className={`size-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      aria-hidden
                    />
                  </button>

                  {/* factor bars (always visible once graded) */}
                  {evalData && (
                    <div className="px-3.5 pb-3">
                      <FactorBars evaluation={evalData} />
                    </div>
                  )}

                  {/* expanded detail */}
                  {isOpen && (
                    <div className="space-y-3 border-t border-dashed border-slate-200 p-3.5 dark:border-slate-800">
                      {st?.status === 'error' && (
                        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                          <span className="flex items-center gap-1.5">
                            <AlertTriangle className="size-3.5" aria-hidden /> {st.message}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 rounded-md text-[11px]"
                            onClick={() => slice.interviewId && void evaluate(slice.interviewId, true)}
                          >
                            <RefreshCw className="size-3" aria-hidden /> Retry
                          </Button>
                        </div>
                      )}

                      {evalData && (
                        <>
                          {/* strengths / weaknesses */}
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="size-3" aria-hidden /> Key strengths
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {evalData.keyStrengths.length === 0 ? (
                                  <span className="text-[11px] text-slate-400">—</span>
                                ) : (
                                  evalData.keyStrengths.map((s, i) => (
                                    <span
                                      key={i}
                                      className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    >
                                      {s}
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                            <div>
                              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                                <AlertTriangle className="size-3" aria-hidden /> Watch-outs
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {evalData.keyWeaknesses.length === 0 ? (
                                  <span className="text-[11px] text-slate-400">—</span>
                                ) : (
                                  evalData.keyWeaknesses.map((w, i) => (
                                    <span
                                      key={i}
                                      className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                                    >
                                      {w}
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          </div>

                          {/* proctoring flags */}
                          <div
                            className={`rounded-lg border px-3 py-2.5 ${
                              evalData.antiCheatFlags.length > 0
                                ? 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/30'
                                : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/20'
                            }`}
                            aria-label="Proctoring flag alerts"
                          >
                            <p
                              className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider ${
                                evalData.antiCheatFlags.length > 0
                                  ? 'text-rose-700 dark:text-rose-300'
                                  : 'text-emerald-700 dark:text-emerald-300'
                              }`}
                            >
                              {evalData.antiCheatFlags.length > 0 ? (
                                <ShieldAlert className="size-3.5" aria-hidden />
                              ) : (
                                <ShieldCheck className="size-3.5" aria-hidden />
                              )}
                              Proctoring flag alerts
                            </p>
                            {evalData.antiCheatFlags.length === 0 ? (
                              <p className="mt-1 text-[11px] text-emerald-800 dark:text-emerald-300">
                                No flags — clean session
                              </p>
                            ) : (
                              <ul className="mt-1.5 space-y-1">
                                {evalData.antiCheatFlags.map((f, i) => (
                                  <li
                                    key={`${f}-${i}`}
                                    className="flex items-center gap-1.5 text-[11px] font-medium text-rose-800 dark:text-rose-300"
                                  >
                                    <AlertTriangle className="size-3 shrink-0" aria-hidden />
                                    {flagLabel(f)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </>
                      )}

                      {/* actions */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Button
                          size="sm"
                          disabled={acted || actingId === slice.app.id}
                          onClick={() => void setStatus(slice, 'SHORTLISTED', 'Shortlisted')}
                          className="h-8 gap-1 rounded-lg bg-emerald-600 text-[11px] font-semibold text-white hover:bg-emerald-700"
                        >
                          {actingId === slice.app.id ? (
                            <Loader2 className="size-3 animate-spin" aria-hidden />
                          ) : (
                            <CheckCircle2 className="size-3" aria-hidden />
                          )}
                          Shortlist
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acted || actingId === slice.app.id}
                          onClick={() => void setStatus(slice, 'HOLD', 'On hold')}
                          className="h-8 gap-1 rounded-lg border-amber-300 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
                        >
                          <Timer className="size-3" aria-hidden /> Hold
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acted || actingId === slice.app.id}
                          onClick={() => void setStatus(slice, 'REJECTED', 'Rejected')}
                          className="h-8 gap-1 rounded-lg border-rose-300 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                        >
                          <XCircle className="size-3" aria-hidden /> Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acted || actingId === slice.app.id || slice.interviewStatus !== 'COMPLETED'}
                          title={
                            slice.interviewStatus !== 'COMPLETED'
                              ? 'Offer unlocks after the AI interview completes'
                              : undefined
                          }
                          onClick={() => void setStatus(slice, 'OFFERED', 'Offer sent')}
                          className="h-8 gap-1 rounded-lg border-violet-300 text-[11px] font-semibold text-violet-700 hover:bg-violet-50 dark:border-violet-900 dark:text-violet-300 dark:hover:bg-violet-950/40"
                        >
                          <Briefcase className="size-3" aria-hidden /> Offer
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={syncingId === slice.app.id || !evalData}
                          onClick={() => void syncToAts(slice)}
                          className="h-8 gap-1 rounded-lg border-sky-300 text-[11px] font-semibold text-sky-700 hover:bg-sky-50 dark:border-sky-900 dark:text-sky-300 dark:hover:bg-sky-950/40"
                        >
                          {syncingId === slice.app.id ? (
                            <Loader2 className="size-3 animate-spin" aria-hidden />
                          ) : (
                            <Send className="size-3" aria-hidden />
                          )}
                          Sync to ATS
                        </Button>
                        {acted && (
                          <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                            decision recorded — reopen via Applicants
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void openVideo(slice)}
                          className="ml-auto h-8 gap-1 rounded-lg text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40"
                        >
                          <FileVideo className="size-3.5" aria-hidden /> Answers &amp; recordings
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}

            {completed.length === 0 && awaiting.length > 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center dark:border-slate-700 dark:bg-slate-900/40">
                <Trophy className="mx-auto size-7 text-slate-300 dark:text-slate-600" aria-hidden />
                <p className="mt-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  No completed AI interviews yet
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                  The leaderboard fills up as candidates finish their AI interviews — evaluated
                  candidates are ranked by overall score automatically.
                </p>
              </div>
            )}
          </div>

          {/* awaiting interviews */}
          {awaiting.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3">
                  <Bot className="size-4 shrink-0 text-slate-400" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-800 dark:text-slate-200">
                      Awaiting interview
                    </span>
                    <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                      {awaiting.length} candidate{awaiting.length === 1 ? '' : 's'} invited or not yet graded
                    </span>
                  </span>
                  <ChevronDown className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="max-h-72 space-y-1.5 overflow-y-auto border-t border-dashed border-slate-200 p-3 dark:border-slate-800 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
                  {awaiting.map(({ app, interviewStatus }) => {
                    const meta = statusMetaFor(app.status)
                    return (
                      <li
                        key={app.id}
                        className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                            {app.candidate?.name ?? 'Unknown candidate'}
                            <span className="font-normal text-slate-400 dark:text-slate-500">
                              {' '}· {app.candidate?.headline || app.candidate?.company || '—'}
                            </span>
                          </p>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0 text-[9px] font-bold uppercase tracking-wide ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                        <span className="shrink-0 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                          {interviewStatus === 'PENDING'
                            ? 'invite sent · waiting for candidate'
                            : interviewStatus === 'IN_PROGRESS'
                              ? 'interview in progress…'
                              : 'not invited yet'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </details>
            </div>
          )}
        </>
      )}

      {/* video / answers dialog */}
      <Dialog
        open={!!videoApp}
        onOpenChange={(open) => {
          if (!open) setVideoApp(null)
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-xl [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileVideo className="size-4 text-blue-600" aria-hidden />
              {videoApp?.name}&apos;s answers
              {selectedJob ? <span className="font-normal text-slate-400">· {selectedJob.title}</span> : null}
            </DialogTitle>
            <DialogDescription>
              Per-question recordings — switch questions with the chips. Answers were recorded
              separately per question.
            </DialogDescription>
          </DialogHeader>

          {videoLoading || !videoDetail ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading recordings…
            </div>
          ) : (
            <div className="space-y-3">
              {/* segmented Q control */}
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Jump to question">
                {videoDetail.questions.map((q) => {
                  const ans = videoDetail.answers.find((a) => a.qIndex === q.qIndex)
                  const hasMedia = !!ans?.mediaPath
                  const active = videoQ === q.qIndex
                  return (
                    <button
                      key={q.qIndex}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      disabled={!hasMedia}
                      onClick={() => setVideoQ(q.qIndex)}
                      title={hasMedia ? q.text : 'No recording for this question'}
                      className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors ${
                        active
                          ? 'border-blue-600 bg-blue-600 text-white'
                          : hasMedia
                            ? 'border-slate-300 bg-white text-slate-600 hover:border-blue-400 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300'
                            : 'cursor-not-allowed border-dashed border-slate-200 text-slate-300 dark:border-slate-700 dark:text-slate-600'
                      }`}
                    >
                      {hasMedia ? <Camera className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
                      Q{q.qIndex + 1}
                      {q.isSkippable ? ' ·skip' : ''}
                    </button>
                  )
                })}
              </div>

              {/* player */}
              {currentAnswer?.mediaPath ? (
                <figure className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 dark:border-slate-800">
                  {currentAnswer.mediaKind === 'audio' ? (
                    <div className="flex items-center gap-3 bg-gradient-to-r from-slate-900 to-slate-800 px-3 py-3">
                      <Bot className="size-5 shrink-0 text-sky-300" aria-hidden />
                      <audio
                        key={currentAnswer.mediaPath}
                        controls
                        preload="metadata"
                        src={`/api/interview/media/${encodeURIComponent(currentAnswer.mediaPath)}`}
                        className="h-9 w-full min-w-0"
                        aria-label={`Audio answer for question ${videoQ + 1}`}
                      />
                    </div>
                  ) : (
                    <video
                      key={currentAnswer.mediaPath}
                      controls
                      preload="metadata"
                      playsInline
                      src={`/api/interview/media/${encodeURIComponent(currentAnswer.mediaPath)}`}
                      className="aspect-video w-full bg-slate-950"
                      aria-label={`Video answer for question ${videoQ + 1}`}
                    />
                  )}
                  <figcaption className="flex items-center justify-between gap-2 border-t border-white/10 bg-white px-3 py-1.5 text-[10px] font-medium text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                    <span className="font-semibold text-blue-700 dark:text-blue-300">
                      Question {videoQ + 1}
                      {currentAnswer.mediaKind === 'audio' ? ' · audio answer' : ' · video answer'}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      {typeof currentAnswer.mediaSeconds === 'number' && (
                        <span className="tabular-nums">{Math.round(currentAnswer.mediaSeconds)}s</span>
                      )}
                      {typeof currentAnswer.score === 'number' && (
                        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {currentAnswer.score.toFixed(1)}/10
                        </span>
                      )}
                    </span>
                  </figcaption>
                </figure>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-400 dark:border-slate-700">
                  No recording for this question
                  {currentQuestion?.isSkippable ? ' (candidate could skip it)' : ''}
                </p>
              )}

              {/* question + transcript + feedback */}
              {currentQuestion && (
                <div className="space-y-2 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <span className="mr-1.5 inline-grid size-5 place-items-center rounded-full bg-blue-600 align-middle text-[10px] font-black text-white">
                      {videoQ + 1}
                    </span>
                    {currentQuestion.text}
                  </p>
                  <p className="rounded-lg bg-slate-50 p-2.5 text-[12px] leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    {currentAnswer?.transcript?.trim() || 'No transcript captured for this answer.'}
                  </p>
                  {currentFeedback && (
                    <p className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <Copy className="mt-0.5 size-3 shrink-0 text-blue-500" aria-hidden />
                      <span>
                        <strong className="font-semibold text-slate-600 dark:text-slate-300">
                          AI feedback ({currentFeedback.score}/10):
                        </strong>{' '}
                        {currentFeedback.feedback}
                      </span>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
