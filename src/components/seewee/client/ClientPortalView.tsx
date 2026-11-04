'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore, VERDICT_META } from '@/store/app-store'
import { printElement } from '@/lib/print'
import { InterviewTranscript } from '@/components/seewee/interview/InterviewTranscript'
import type {
  ClientDecision,
  ClientPortalReport,
  ClientPortalResponse,
  Verdict,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { skillsToArray, formatLpa } from '@/store/app-store'
import {
  Award,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock3,
  FileDown,
  Gauge,
  GraduationCap,
  Handshake,
  Inbox,
  Loader2,
  Lock,
  MapPin,
  Megaphone,
  MessageSquareQuote,
  Printer,
  Quote,
  RefreshCw,
  Search,
  Star,
  ThumbsDown,
  ThumbsUp,
  Timer,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'

/** ---------- small helpers ---------- */

const VERDICT_STROKE: Record<string, string> = {
  STRONG_HIRE: 'text-blue-500',
  HIRE: 'text-sky-500',
  MAYBE: 'text-amber-500',
  NO_HIRE: 'text-rose-500',
}

const DECISION_META: Record<
  ClientDecision,
  { label: string; badge: string; icon: typeof ThumbsUp }
> = {
  APPROVED: {
    label: 'Approved by your team',
    badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 border-blue-300',
    icon: ThumbsUp,
  },
  ON_HOLD: {
    label: 'On hold',
    badge: 'bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 text-amber-800 border-amber-300',
    icon: Timer,
  },
  REJECTED: {
    label: 'Declined',
    badge: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 border-rose-300',
    icon: ThumbsDown,
  },
}

function timeAgo(iso?: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function avatarTint(seed?: string | null): string {
  const palette = [
    'bg-blue-100 dark:bg-blue-900/40 text-blue-700',
    'bg-sky-100 dark:bg-sky-900/40 text-sky-700',
    'bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 text-amber-700',
    'bg-rose-100 dark:bg-rose-950/40 text-rose-700',
    'bg-slate-200 dark:bg-slate-800 text-slate-700',
    'bg-lime-100 dark:bg-lime-900/40 text-lime-700',
  ]
  const h = (seed ?? '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
  return palette[h % palette.length]
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ScoreDonut({ score, verdict }: { score?: number | null; verdict?: Verdict | null }) {
  const pct = Math.max(0, Math.min(100, ((score ?? 0) / 10) * 100))
  const stroke = verdict ? VERDICT_STROKE[verdict] ?? 'text-slate-400' : 'text-slate-400'
  return (
    <div
      className={`relative h-16 w-16 shrink-0 ${stroke}`}
      role="img"
      aria-label={`AI score ${score ?? 0} out of 10`}
    >
      <svg viewBox="0 0 36 36" className="h-16 w-16 -rotate-90">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="3.5" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray={`${pct} 100`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-black leading-none text-slate-900 dark:text-slate-100">
          {score != null ? score.toFixed(1) : '—'}
        </span>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">/ 10</span>
      </div>
    </div>
  )
}

/** ---------- requisition approvals (in-house headcount) ---------- */

interface PortalRequisition {
  id: string
  title: string
  department: string | null
  location: string
  jobType: string
  workMode: string
  experienceMin: number
  experienceMax: number
  salaryMinLpa: number | null
  salaryMaxLpa: number | null
  openings: number
  skills: string
  justification: string | null
  budgetConfirmed: boolean
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PUBLISHED'
  approverName: string | null
  approverNote: string | null
  decidedAt: string | null
  createdAt: string
  requestedBy: { id: string; name: string; email: string }
  client: { id: string; name: string }
}

const REQUISITION_DECISION_META: Record<
  PortalRequisition['status'],
  { label: string; cls: string; icon: typeof ThumbsUp }
> = {
  PENDING_APPROVAL: {
    label: 'Pending approval',
    cls: 'bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 text-amber-800 border-amber-300',
    icon: Timer,
  },
  APPROVED: {
    label: 'Approved',
    cls: 'bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 text-emerald-800 border-emerald-300',
    icon: ThumbsUp,
  },
  REJECTED: {
    label: 'Rejected',
    cls: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 border-rose-300',
    icon: ThumbsDown,
  },
  PUBLISHED: {
    label: 'Published as job',
    cls: 'bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 text-violet-800 border-violet-300',
    icon: Megaphone,
  },
}

/** Leadership side of the requisition workflow: approve/reject headcount
 * raised by the company's in-house recruiters, then see recent decisions. */
function RequisitionApprovals({ userId, refreshKey }: { userId: string; refreshKey: number }) {
  const [requisitions, setRequisitions] = useState<PortalRequisition[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // inline decision input: which card is armed with which action + its note
  const [armed, setArmed] = useState<{ id: string; action: 'APPROVE' | 'REJECT' } | null>(null)
  const [note, setNote] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/requisitions?userId=${encodeURIComponent(userId)}`)
      const json = (await res.json()) as { data?: PortalRequisition[]; error?: string }
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load requisitions')
      setRequisitions(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requisitions')
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const decide = async (req: PortalRequisition, action: 'APPROVE' | 'REJECT') => {
    if (action === 'REJECT' && !note.trim()) {
      toast.error('Add a short note so the recruiter knows why it was rejected')
      return
    }
    setBusyId(req.id)
    try {
      const res = await fetch(`/api/requisitions/${req.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, action, note: note.trim() || undefined }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to save decision')
      toast.success(
        action === 'APPROVE'
          ? `Requisition approved — ${req.requestedBy.name} can now publish it`
          : `Requisition rejected — ${req.requestedBy.name} has been notified`
      )
      setArmed(null)
      setNote('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save decision')
    } finally {
      setBusyId(null)
    }
  }

  const pending = (requisitions ?? []).filter((r) => r.status === 'PENDING_APPROVAL')
  const decided = (requisitions ?? [])
    .filter((r) => r.status !== 'PENDING_APPROVAL')
    .sort(
      (a, b) =>
        new Date(b.decidedAt ?? b.createdAt).getTime() - new Date(a.decidedAt ?? a.createdAt).getTime()
    )
    .slice(0, 6)

  if (loading && requisitions === null) {
    return <Skeleton className="mt-6 h-40 w-full rounded-2xl" aria-hidden />
  }
  if (error) {
    return (
      <div className="mt-6 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-700 dark:text-rose-300">
        Couldn&apos;t load requisitions: {error}
      </div>
    )
  }
  // nothing in the pipeline for this workspace — keep the portal clean
  if (!requisitions || requisitions.length === 0) return null

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-100 dark:bg-blue-900/40">
          <ClipboardList className="size-4.5 text-blue-600" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Requisition approvals
            {pending.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 dark:bg-amber-950/40 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                {pending.length} awaiting your call
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground">
            Headcount raised by your recruiters — validate the budget and give the call.
          </p>
        </div>
      </div>

      {/* pending decisions */}
      {pending.length === 0 ? (
        <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
          <CheckCircle2 className="size-4 text-emerald-500" aria-hidden /> No requisitions waiting on
          you right now.
        </p>
      ) : (
        <div className="mt-3 max-h-[420px] space-y-3 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
          {pending.map((req) => {
            const skills = skillsToArray(req.skills)
            const isArmed = armed?.id === req.id
            const busy = busyId === req.id
            return (
              <div
                key={req.id}
                className="rounded-xl border border-amber-200/70 dark:border-amber-900/50 bg-amber-50/40 dark:bg-amber-950/20 p-3.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold leading-tight text-slate-900 dark:text-slate-100">
                      {req.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Raised by <span className="font-medium text-slate-600 dark:text-slate-300">{req.requestedBy.name}</span>
                      {req.department ? ` · ${req.department}` : ''} · {timeAgo(req.createdAt)}
                    </p>
                  </div>
                  {req.budgetConfirmed && (
                    <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                      Budget validated
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3.5 shrink-0 text-slate-400" aria-hidden /> {req.location} · {req.workMode} · {req.jobType}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5 shrink-0 text-slate-400" aria-hidden /> {req.openings} opening{req.openings === 1 ? '' : 's'}
                  </span>
                  <span className="flex items-center gap-1">
                    <GraduationCap className="size-3.5 shrink-0 text-slate-400" aria-hidden /> {req.experienceMin}–{req.experienceMax} yrs
                  </span>
                  <span className="flex items-center gap-1">
                    <Wallet className="size-3.5 shrink-0 text-slate-400" aria-hidden /> {formatLpa(req.salaryMinLpa, req.salaryMaxLpa)}
                  </span>
                </div>

                {skills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {skills.slice(0, 6).map((s) => (
                      <span
                        key={s}
                        className="rounded-md bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200/70 dark:text-blue-300"
                      >
                        {s}
                      </span>
                    ))}
                    {skills.length > 6 && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        +{skills.length - 6} more
                      </span>
                    )}
                  </div>
                )}

                {req.justification && (
                  <blockquote className="mt-2 flex gap-1.5 rounded-lg border-l-2 border-blue-300 bg-white/70 dark:bg-slate-900/50 px-2.5 py-1.5 text-xs italic leading-relaxed text-slate-600 dark:text-slate-300">
                    <Quote className="mt-0.5 size-3 shrink-0 text-blue-400" aria-hidden />
                    <span>{req.justification}</span>
                  </blockquote>
                )}

                {/* decision controls */}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {!isArmed ? (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setArmed({ id: req.id, action: 'APPROVE' })
                          setNote('')
                        }}
                        className="h-11 flex-1 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 sm:h-8 sm:flex-none"
                      >
                        <ThumbsUp className="size-4" aria-hidden /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setArmed({ id: req.id, action: 'REJECT' })
                          setNote('')
                        }}
                        className="h-11 flex-1 rounded-lg border-rose-300 text-rose-600 hover:bg-rose-50 dark:text-rose-300 sm:h-8 sm:flex-none"
                      >
                        <ThumbsDown className="size-4" aria-hidden /> Reject
                      </Button>
                    </>
                  ) : (
                    <div className="w-full space-y-2">
                      <Input
                        autoFocus
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={
                          armed.action === 'REJECT'
                            ? 'Reason for rejection (required) — e.g. budget paused this quarter'
                            : 'Optional note for the recruiter — e.g. approved for Q3 start'
                        }
                        className="h-11 rounded-lg border-slate-200 dark:border-slate-800 sm:h-9"
                        aria-label="Decision note"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void decide(req, armed.action)}
                          className={`h-11 rounded-lg text-white sm:h-8 ${
                            armed.action === 'APPROVE'
                              ? 'bg-emerald-600 hover:bg-emerald-700'
                              : 'bg-rose-600 hover:bg-rose-700'
                          }`}
                        >
                          {busy ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : armed.action === 'APPROVE' ? (
                            <ThumbsUp className="size-4" aria-hidden />
                          ) : (
                            <ThumbsDown className="size-4" aria-hidden />
                          )}
                          Confirm {armed.action === 'APPROVE' ? 'approve' : 'reject'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setArmed(null)
                            setNote('')
                          }}
                          className="h-11 rounded-lg sm:h-8"
                        >
                          Cancel
                        </Button>
                        {armed.action === 'REJECT' && (
                          <span className="text-[11px] text-rose-500">A note is required</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* recent decisions */}
      {decided.length > 0 && (
        <div className="mt-4 border-t border-dashed border-slate-200 dark:border-slate-800 pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            Recent decisions
          </p>
          <ul className="mt-2 space-y-1.5">
            {decided.map((req) => {
              const meta = REQUISITION_DECISION_META[req.status]
              const Icon = meta.icon
              return (
                <li key={req.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}
                  >
                    <Icon className="size-3" aria-hidden /> {meta.label}
                  </span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">{req.title}</span>
                  <span className="text-slate-400 dark:text-slate-500">
                    · {req.approverName ?? 'Leadership'} · {timeAgo(req.decidedAt ?? req.createdAt)}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </section>
  )
}

/** ---------- main view ---------- */

type DecisionDraft = { report: ClientPortalReport; decision: ClientDecision }

/** lib/types is owned elsewhere — extend locally with what the portal API adds */
type PortalReportWithRecordings = ClientPortalReport & { recordingsCount?: number }
type PortalResponseWithRecordings = Omit<ClientPortalResponse, 'reports'> & {
  reports: PortalReportWithRecordings[]
}

export function ClientPortalView() {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)

  const [data, setData] = useState<PortalResponseWithRecordings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // per-report ZIP download busy state
  const [zipBusyId, setZipBusyId] = useState<string | null>(null)

  // filters
  const [query, setQuery] = useState('')
  const [verdictFilter, setVerdictFilter] = useState<string>('ALL')
  const [sortBy, setSortBy] = useState<string>('newest')
  const [pendingOnly, setPendingOnly] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [spotlightId, setSpotlightId] = useState<string | null>(null)

  // decision dialog
  const [draft, setDraft] = useState<DecisionDraft | null>(null)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    if (!user?.clientId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/client-portal?clientId=${encodeURIComponent(user.clientId)}`)
      const json = (await res.json()) as { data?: PortalResponseWithRecordings; error?: string }
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load')
      setData(json.data ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portal')
    } finally {
      setLoading(false)
    }
  }, [user?.clientId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  // 🔔 Deep-link handoff: a REPORT_SHARED notification can ask us to open that
  // specific report card. One-shot — consume and clear.
  const pendingFocus = useAppStore((s) => s.pendingFocus)
  const setPendingFocus = useAppStore((s) => s.setPendingFocus)
  useEffect(() => {
    if (!pendingFocus || pendingFocus.kind !== 'client-report') return
    setExpandedId(pendingFocus.shortlistId)
    setSpotlightId(pendingFocus.shortlistId)
    setPendingOnly(false)
    const t = setTimeout(
      () =>
        document
          .getElementById(`client-report-${pendingFocus.shortlistId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      400
    )
    const clearT = setTimeout(() => setSpotlightId(null), 3400)
    setPendingFocus(null)
    return () => {
      clearTimeout(t)
      clearTimeout(clearT)
    }
  }, [pendingFocus, setPendingFocus])

  const reports = data?.reports ?? []

  const visibleReports = useMemo(() => {
    let list = [...reports]
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (r) =>
          r.interview.candidateName.toLowerCase().includes(q) ||
          r.interview.jobTitle.toLowerCase().includes(q) ||
          r.job.company.toLowerCase().includes(q) ||
          r.candidate.headline?.toLowerCase().includes(q) ||
          r.candidate.skills?.toLowerCase().includes(q)
      )
    }
    if (verdictFilter !== 'ALL') list = list.filter((r) => r.interview.verdict === verdictFilter)
    if (pendingOnly) list = list.filter((r) => !r.clientDecision)
    if (sortBy === 'score') list.sort((a, b) => (b.interview.overallScore ?? 0) - (a.interview.overallScore ?? 0))
    else if (sortBy === 'scoreAsc') list.sort((a, b) => (a.interview.overallScore ?? 0) - (b.interview.overallScore ?? 0))
    else
      list.sort(
        (a, b) =>
          new Date(b.interview.completedAt ?? b.sharedAt).getTime() -
          new Date(a.interview.completedAt ?? a.sharedAt).getTime()
      )
    return list
  }, [reports, query, verdictFilter, pendingOnly, sortBy])

  async function submitDecision() {
    if (!draft || !user?.clientId) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/client-portal/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: user.clientId,
          shortlistId: draft.report.shortlistId,
          decision: draft.decision,
          feedback: feedback.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to save decision')
      toastFor(draft.decision)
      setDraft(null)
      setFeedback('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save decision')
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Client-facing recordings download: fetch the shared report's recording
   * pack as a blob and hand it to the browser via the hidden-anchor pattern.
   */
  async function downloadRecordings(r: PortalReportWithRecordings) {
    if (!user?.clientId || zipBusyId) return
    setZipBusyId(r.shortlistId)
    try {
      const res = await fetch(
        `/api/interview/media-zip?clientId=${encodeURIComponent(user.clientId)}&shortlistId=${encodeURIComponent(r.shortlistId)}`
      )
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error || `Server responded ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // prefer the server's Content-Disposition filename, fall back to a dated one
      const cdName = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1]
      a.download = cdName || `SeeWe-recordings-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      const count = r.recordingsCount ?? 1
      toast.success(
        `Recording pack downloaded · ${count} file${count === 1 ? '' : 's'} · ${formatBytes(blob.size)}`
      )
    } catch (err) {
      console.error('[ClientPortalView] recordings zip failed:', err)
      toast.error(err instanceof Error ? err.message : 'Could not download the recordings')
    } finally {
      setZipBusyId(null)
    }
  }

  // ---- signed-out / mis-linked gate ----
  if (!user || user.role !== 'CLIENT') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-sky-600 shadow-lg shadow-blue-200">
          <Handshake className="h-7 w-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Client Partner Portal</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          Sign in with the email your SeeWe recruiter registered to review AI-rated talent reports.
        </p>
        <Button
          onClick={() => setAuthOpen(true)}
          className="mt-6 h-11 bg-gradient-to-r from-blue-600 to-sky-600 px-8 text-white shadow-md hover:from-blue-700 hover:to-sky-700"
        >
          Sign in as Client Partner
        </Button>
      </div>
    )
  }

  if (!user.clientId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Account not linked</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-400">
          Your account isn&apos;t linked to a client organisation yet. Please sign out and sign in
          again with your registered client email, or contact your SeeWe recruiter.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      {/* ---------- hero ---------- */}
      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-600 via-blue-600 to-sky-600 p-5 text-white shadow-lg shadow-blue-100 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-xl font-black backdrop-blur-sm ring-1 ring-white/30">
              {initials(data?.client.name ?? user.name)}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-blue-100/90">
                Client Partner Portal
              </p>
              <h1 className="text-xl font-black sm:text-2xl">
                {loading && !data ? (
                  <span className="inline-block h-7 w-52 animate-pulse rounded bg-white/20" />
                ) : (
                  data?.client.name ?? user.name
                )}
              </h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-blue-50/90">
                {data?.client.industry && (
                  <span className="rounded-full bg-white/15 px-2 py-0.5 font-medium ring-1 ring-white/25">
                    {data.client.industry}
                  </span>
                )}
                <span>{data?.client.contactEmail ?? user.email}</span>
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-10 self-start border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white sm:self-auto"
            aria-label="Refresh reports"
          >
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
        {data?.client.notes && (
          <p className="mt-4 border-l-2 border-white/40 pl-3 text-sm italic leading-relaxed text-blue-50/95">
            “{data.client.notes}”
          </p>
        )}

        {/* stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Reports shared', value: String(data?.stats.totalReports ?? 0), icon: Inbox },
            {
              label: 'Avg AI score',
              value: data?.stats.avgScore != null ? `${data.stats.avgScore.toFixed(1)} / 10` : '—',
              icon: Gauge,
            },
            {
              label: 'Strong-hire rate',
              value: `${data?.stats.strongHireRate ?? 0}%`,
              icon: Star,
            },
            {
              label: 'Awaiting your call',
              value: String(data?.stats.pendingDecisions ?? 0),
              icon: Clock3,
            },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-xl bg-white/10 p-3.5 ring-1 ring-white/20 backdrop-blur-sm"
            >
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-blue-50/85 dark:text-[oklch(0.95_0.02_240/0.85)]">
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              </div>
              <p className="mt-1 text-2xl font-black">{loading && !data ? '…' : value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- requisition approvals (in-house headcount) ---------- */}
      <RequisitionApprovals userId={user.id} refreshKey={refreshKey} />

      {/* ---------- filters ---------- */}
      <section className="sticky top-16 z-20 mt-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-card/90 p-3 shadow-sm backdrop-blur-md">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search candidate, role, skill…"
              aria-label="Search reports"
              className="h-11 pl-9 sm:h-10"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:w-auto lg:items-center">
            <Select value={verdictFilter} onValueChange={setVerdictFilter}>
              <SelectTrigger aria-label="Filter by AI verdict" className="h-11 sm:h-10 lg:w-[150px]">
                <SelectValue placeholder="All verdicts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All verdicts</SelectItem>
                <SelectItem value="STRONG_HIRE">🚀 Strong Hire</SelectItem>
                <SelectItem value="HIRE">✅ Hire</SelectItem>
                <SelectItem value="MAYBE">🤔 Maybe</SelectItem>
                <SelectItem value="NO_HIRE">❌ No Hire</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger aria-label="Sort reports" className="h-11 sm:h-10 lg:w-[150px]">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="score">Highest score</SelectItem>
                <SelectItem value="scoreAsc">Lowest score</SelectItem>
              </SelectContent>
            </Select>
            <label className="col-span-2 flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-200 dark:border-slate-800 px-3 text-sm font-medium text-slate-700 dark:text-slate-300 sm:col-span-1 sm:h-10 lg:border-0 lg:px-2">
              <Switch checked={pendingOnly} onCheckedChange={setPendingOnly} aria-label="Only undecided reports" />
              <span className="lg:whitespace-nowrap">Undecided only</span>
            </label>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400" aria-live="polite">
          Showing <span className="font-semibold text-slate-700 dark:text-slate-300">{visibleReports.length}</span> of{' '}
          {reports.length} shared {reports.length === 1 ? 'report' : 'reports'}
        </p>
      </section>

      {/* ---------- body ---------- */}
      {loading && !data ? (
        <div className="mt-4 space-y-4" aria-hidden>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-2xl" />
          ))}
        </div>
      ) : error ? (
        <div className="mt-4 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 p-6 text-center">
          <p className="font-semibold text-rose-800 dark:text-rose-300">Couldn&apos;t load your reports</p>
          <p className="mt-1 text-sm text-rose-600">{error}</p>
          <Button
            onClick={() => void load()}
            variant="outline"
            className="mt-4 h-10 border-rose-300 text-rose-700 hover:bg-rose-100"
          >
            <RefreshCw className="mr-1.5 h-4 w-4" /> Try again
          </Button>
        </div>
      ) : visibleReports.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 dark:bg-slate-800/60 p-10 text-center">
          <Inbox className="mx-auto h-10 w-10 text-slate-300" aria-hidden />
          <h2 className="mt-3 text-lg font-bold text-slate-800 dark:text-slate-200">
            {reports.length === 0 ? 'No reports shared yet' : 'No reports match your filters'}
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">
            {reports.length === 0
              ? 'When your SeeWe recruiter shortlists a candidate and the AI interview is rated, the report lands here for your judgement.'
              : 'Try clearing the search or verdict filter to see every shared report.'}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-4 pb-4">
          {visibleReports.map((r) => {
            const meta = r.interview.verdict ? VERDICT_META[r.interview.verdict] : null
            const decision = r.clientDecision ? DECISION_META[r.clientDecision] : null
            const expanded = expandedId === r.shortlistId
            const dims = r.interview.report?.dimensionScores ?? []
            return (
              <article
                key={r.shortlistId}
                id={`client-report-${r.shortlistId}`}
                className={`scroll-mt-28 overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md ${
                  spotlightId === r.shortlistId
                    ? 'border-blue-300 ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-50 shadow-lg shadow-blue-100'
                    : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                {/* header row */}
                <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-5 sm:p-5">
                  <ScoreDonut score={r.interview.overallScore} verdict={r.interview.verdict} />

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ring-1 ring-slate-200 dark:ring-slate-800 ${avatarTint(r.candidate.avatarSeed)}`}
                        aria-hidden
                      >
                        {initials(r.interview.candidateName)}
                      </span>
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        {r.interview.candidateName}
                      </h3>
                      {meta && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${meta.className}`}
                        >
                          {meta.emoji} {meta.label}
                        </span>
                      )}
                      {decision && (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${decision.badge}`}
                        >
                          <decision.icon className="h-3 w-3" /> {decision.label}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-600 dark:text-slate-400">
                      {r.candidate.headline || r.interview.domain}
                      {r.candidate.experienceYears != null && (
                        <span className="text-slate-400 dark:text-slate-500"> · {r.candidate.experienceYears} yrs exp</span>
                      )}
                      {r.candidate.location && (
                        <span className="inline-flex items-center gap-0.5 text-slate-400 dark:text-slate-500">
                          {' '}
                          · <MapPin className="h-3 w-3" /> {r.candidate.location}
                        </span>
                      )}
                    </p>
                    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                      Interviewed for{' '}
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{r.interview.jobTitle}</span> @{' '}
                      {r.job.company} · {r.interview.difficulty.toLowerCase()} ·{' '}
                      {r.interview.questionsAnswered}/{r.interview.totalQuestions} questions ·{' '}
                      {timeAgo(r.interview.completedAt ?? r.sharedAt)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpandedId(expanded ? null : r.shortlistId)}
                      aria-expanded={expanded}
                      aria-label={expanded ? 'Collapse report details' : 'Expand report details'}
                      className="h-10 min-w-[120px] rounded-xl text-xs sm:h-9"
                    >
                      {expanded ? (
                        <>
                          Hide details <ChevronUp className="ml-1 h-3.5 w-3.5" />
                        </>
                      ) : (
                        <>
                          View report <ChevronDown className="ml-1 h-3.5 w-3.5" />
                        </>
                      )}
                    </Button>
                    {!r.clientDecision && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setDraft({ report: r, decision: 'APPROVED' })
                          setFeedback('')
                        }}
                        className="h-10 min-w-[120px] rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 text-xs text-white shadow-sm hover:from-blue-700 hover:to-sky-700 sm:h-9"
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Judge candidate
                      </Button>
                    )}
                  </div>
                </div>

                {/* expanded report */}
                {expanded && (
                  <div
                    id="client-report-print"
                    className="border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/60 dark:bg-slate-800/60 p-4 sm:p-5"
                  >
                    {/* print header (screen: includes the print CTA; print: branding only) */}
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="hidden text-base font-black tracking-tight text-blue-700 [@media_print]:block">
                        See
                        <span className="text-slate-800">We</span>
                        <span className="ml-2 align-middle text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">
                          Candidate Evaluation Report
                        </span>
                      </p>
                      <p className="hidden text-[10px] text-slate-400 [@media_print]:block">
                        {r.interview.candidateName} · {r.interview.jobTitle} · Confidential
                      </p>
                      <div className="ml-auto flex shrink-0 items-center gap-1.5">
                        {(r.recordingsCount ?? 0) > 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            data-print-hide
                            disabled={zipBusyId === r.shortlistId}
                            onClick={() => void downloadRecordings(r)}
                            aria-label={`Download this report's interview recordings as a ZIP (${r.recordingsCount} file${(r.recordingsCount ?? 0) === 1 ? '' : 's'})`}
                            className="h-8 gap-1.5 rounded-full border-blue-300 bg-blue-50 dark:bg-blue-950/40 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 hover:text-blue-800"
                          >
                            {zipBusyId === r.shortlistId ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : (
                              <FileDown className="size-3.5" aria-hidden />
                            )}
                            {zipBusyId === r.shortlistId ? 'Zipping…' : 'Download recordings (ZIP)'}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          data-print-hide
                          onClick={() =>
                            printElement('client-report-print', {
                              title: `SeeWe Report — ${r.interview.candidateName} — ${r.interview.jobTitle}`,
                            })
                          }
                          className="h-8 gap-1.5 rounded-full px-3 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:bg-white hover:text-blue-700 dark:hover:bg-white/10"
                          aria-label="Print or save this report as PDF"
                        >
                          <Printer className="size-3.5" aria-hidden /> Print / PDF
                        </Button>
                      </div>
                    </div>

                    {r.interview.report?.aiSummary && (
                      <blockquote className="rounded-xl border border-slate-200 dark:border-slate-800 bg-card p-3.5 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                        <MessageSquareQuote className="mb-1 h-4 w-4 text-blue-500" aria-hidden />
                        {r.interview.report.aiSummary}
                      </blockquote>
                    )}

                    {dims.length > 0 && (
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {dims.map((d) => (
                          <div key={d.name}>
                            <div className="mb-1 flex items-center justify-between text-xs font-medium text-slate-600 dark:text-slate-400">
                              <span className="truncate">{d.name}</span>
                              <span className="font-bold text-slate-800 dark:text-slate-200">
                                {d.score.toFixed(1)}
                                <span className="text-slate-400 dark:text-slate-500">/10</span>
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                              <div
                                className={`h-full rounded-full ${
                                  d.score >= 7 ? 'bg-blue-500' : d.score >= 5 ? 'bg-amber-500' : 'bg-rose-400'
                                }`}
                                style={{ width: `${Math.min(100, (d.score / 10) * 100)}%` }}
                                role="meter"
                                aria-label={`${d.name}: ${d.score} out of 10`}
                                aria-valuenow={d.score}
                                aria-valuemin={0}
                                aria-valuemax={10}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {(r.interview.report?.strengths?.length || r.interview.report?.weaknesses?.length) && (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        {r.interview.report?.strengths?.length ? (
                          <div>
                            <p className="mb-1.5 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-blue-700">
                              <ThumbsUp className="h-3.5 w-3.5" /> Strengths
                            </p>
                            <ul className="flex flex-wrap gap-1.5">
                              {r.interview.report.strengths.map((s, i) => (
                                <li
                                  key={i}
                                  className="rounded-full border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 text-xs text-blue-800"
                                >
                                  {s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                        {r.interview.report?.weaknesses?.length ? (
                          <div>
                            <p className="mb-1.5 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-rose-600">
                              <ThumbsDown className="h-3.5 w-3.5" /> Watch-outs
                            </p>
                            <ul className="flex flex-wrap gap-1.5">
                              {r.interview.report.weaknesses.map((s, i) => (
                                <li
                                  key={i}
                                  className="rounded-full border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-2.5 py-1 text-xs text-rose-700"
                                >
                                  {s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {/* candidate + recruiter context */}
                    <div className="mt-4 grid gap-3 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-card p-3">
                        <p className="mb-1 font-bold text-slate-700 dark:text-slate-300">Candidate snapshot</p>
                        <p>
                          {r.candidate.experienceYears != null
                            ? `${r.candidate.experienceYears} yrs · `
                            : ''}
                          {formatLpa(r.candidate.expectedSalary ?? undefined)}
                        </p>
                        <p
                          className={`mt-0.5 inline-flex items-center gap-1 ${
                            r.candidate.noticePeriodDays === 0
                              ? 'font-semibold text-blue-700'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          <Timer className="size-3" aria-hidden />
                          {r.candidate.noticePeriodDays == null
                            ? 'Notice period not specified'
                            : r.candidate.noticePeriodDays === 0
                              ? '⚡ Can join immediately'
                              : `Can join in ${r.candidate.noticePeriodDays} days`}
                        </p>
                        <div className="mt-1.5 flex max-h-16 flex-wrap gap-1 overflow-y-auto">
                          {skillsToArray(r.candidate.skills).slice(0, 8).map((s) => (
                            <span
                              key={s}
                              className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] text-slate-600 dark:text-slate-400"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                      {r.recruiterNote && (
                        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-card p-3">
                          <p className="mb-1 font-bold text-slate-700 dark:text-slate-300">Recruiter&apos;s note</p>
                          <p className="italic leading-relaxed text-slate-600 dark:text-slate-400">“{r.recruiterNote}”</p>
                        </div>
                      )}
                    </div>

                    {/* decision recap */}
                    {decision && (
                      <div className="mt-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-card p-3.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${decision.badge}`}
                          >
                            <decision.icon className="h-3.5 w-3.5" /> {decision.label}
                          </span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                            <CalendarClock className="h-3 w-3" /> {timeAgo(r.decidedAt)}
                          </span>
                        </div>
                        {r.clientFeedback && (
                          <p className="mt-2 border-l-2 border-slate-300 pl-3 text-sm italic text-slate-600 dark:text-slate-400">
                            “{r.clientFeedback}”
                          </p>
                        )}
                        <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                          <Lock className="h-3 w-3" />
                          Decision locked — contact your SeeWe recruiter to revisit it.
                        </p>
                      </div>
                    )}

                    {/* full Q&A transcript from the AI interview */}
                    <InterviewTranscript
                      interviewId={r.interview.id}
                      compact
                      className="mt-4 shadow-sm"
                      viewerId={user?.id}
                    />
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {/* ---------- decision dialog ---------- */}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Award className="h-5 w-5 text-blue-600" />
              Your verdict on {draft?.report.interview.candidateName}
            </DialogTitle>
            <DialogDescription>
              {draft?.report.interview.jobTitle} @ {draft?.report.job.company} · AI score{' '}
              <span className="font-bold text-slate-700 dark:text-slate-300">
                {draft?.report.interview.overallScore?.toFixed(1) ?? '—'}/10
              </span>
              . Your decision is shared back with the SeeWe recruiter.
            </DialogDescription>
          </DialogHeader>

          <div
            role="radiogroup"
            aria-label="Decision"
            className="grid grid-cols-3 gap-2"
          >
            {(
              [
                { value: 'APPROVED', label: 'Approve', icon: ThumbsUp, cls: 'data-[state=on]:border-blue-500 data-[state=on]:bg-blue-50 dark:data-[state=on]:bg-blue-950/40 data-[state=on]:text-blue-800 dark:data-[state=on]:text-blue-300' },
                { value: 'ON_HOLD', label: 'On hold', icon: Timer, cls: 'data-[state=on]:border-amber-500 data-[state=on]:bg-amber-50 dark:data-[state=on]:bg-amber-950/40 data-[state=on]:text-amber-800 dark:data-[state=on]:text-amber-300' },
                { value: 'REJECTED', label: 'Decline', icon: XCircle, cls: 'data-[state=on]:border-rose-500 data-[state=on]:bg-rose-50 dark:data-[state=on]:bg-rose-950/40 data-[state=on]:text-rose-800 dark:data-[state=on]:text-rose-300' },
              ] as const
            ).map(({ value, label, icon: Icon, cls }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={draft?.decision === value}
                data-state={draft?.decision === value ? 'on' : 'off'}
                onClick={() => draft && setDraft({ ...draft, decision: value })}
                className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-slate-200 dark:border-slate-800 bg-card p-2 text-xs font-semibold text-slate-500 dark:text-slate-400 transition-all hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${cls}`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="client-feedback">Note for the recruiter (optional)</Label>
            <Textarea
              id="client-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value.slice(0, 600))}
              placeholder="e.g. Strong on system design — move to the final culture round."
              className="min-h-[88px] resize-none"
            />
            <p className="text-right text-[11px] text-slate-400 dark:text-slate-500">{feedback.length}/600</p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDraft(null)} className="h-11 flex-1 sm:h-10 sm:flex-none">
              Cancel
            </Button>
            <Button
              onClick={() => void submitDecision()}
              disabled={submitting}
              className="h-11 flex-1 bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md hover:from-blue-700 hover:to-sky-700 sm:h-10 sm:flex-none"
            >
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>Submit verdict</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** toast helpers */
function toastFor(decision: ClientDecision) {
  if (decision === 'APPROVED') toast.success('Verdict sent — candidate approved ✅ The recruiter has been notified.')
  else if (decision === 'ON_HOLD') toast('Verdict sent — candidate put on hold ⏸')
  else toast.success('Verdict sent — candidate declined. Feedback recorded.')
}
