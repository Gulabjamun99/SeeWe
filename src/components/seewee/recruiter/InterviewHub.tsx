'use client'

/**
 * InterviewHub — the recruiter's one-stop AI-interview command center.
 * Groups every interview by position, shows who interviewed, what the AI asked,
 * what the candidate answered (transcript + recording), scores/verdicts and the
 * auto-captured profile details (location · experience · notice · CTC) —
 * all searchable in one click.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, isValid } from 'date-fns'
import {
  Award,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  CirclePause,
  Clock3,
  CloudUpload,
  Copy,
  Download,
  FileText,
  Gavel,
  GraduationCap,
  IndianRupee,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Timer,
  Trash2,
  UserCheck,
  Users,
  Video,
  Wallet,
  Webhook,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore, VERDICT_META } from '@/store/app-store'
import type { InterviewQuestion, InterviewReport } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/* ------------------------------- types ------------------------------- */

interface HubAnswer {
  qIndex: number
  question: string
  transcript: string | null
  score: number | null
  feedback: string | null
  audioPresent: boolean
  mediaPath: string | null
  mediaKind: string | null
  mediaSeconds: number | null
}

interface HubInterview {
  id: string
  status: string
  difficulty: string
  overallScore: number | null
  verdict: string | null
  startedAt: string | null
  completedAt: string | null
  applicationId: string | null
  candidateName: string
  candidateId: string | null
  candidateEmail: string
  clientName: string | null
  questions: InterviewQuestion[]
  answers: HubAnswer[]
  report: (InterviewReport & { candidateDetails?: InterviewCandidateDetails | null }) | null
  /** how many answers carry a video/audio recording */
  mediaCount: number
  /** the HUMAN final call — the AI verdict is advisory only */
  recruiterDecision: string | null
  recruiterDecisionNote: string | null
  recruiterDecidedAt: string | null
  profile: {
    location: string | null
    experienceYears: number | null
    noticePeriodDays: number | null
    currentSalary: number | null
    expectedSalary: number | null
    phone: string | null
    headline: string | null
    skills: string[]
    education: string | null
    resumeSummary: string | null
    matchScore: number | null
    appliedAt: string | null
    viewedAt: string | null
    applicationStatus: string | null
    shortlistStatus: string | null
    clientDecision: string | null
  }
}

interface InterviewCandidateDetails {
  location?: string | null
  experienceYears?: number | null
  noticePeriodDays?: number | null
  currentSalaryLpa?: number | null
  expectedSalaryLpa?: number | null
}

interface HubJobGroup {
  jobId: string
  jobTitle: string
  company: string
  jobLocation: string
  jobStatus: string
  openings: number
  total: number
  completed: number
  inProgress: number
  avgScore: number | null
  verdictCounts: Record<string, number>
  interviews: HubInterview[]
}

interface HubData {
  summary: {
    positions: number
    totalInterviews: number
    completed: number
    inProgress: number
    avgScore: number | null
  }
  groups: HubJobGroup[]
}

type VerdictFilter = 'ALL' | 'IN_PROGRESS' | 'STRONG_HIRE' | 'HIRE' | 'MAYBE' | 'NO_HIRE'

const VERDICT_FILTERS: Array<{ value: VerdictFilter; label: string; cls: string }> = [
  { value: 'ALL', label: 'All', cls: 'data-[state=on]:bg-slate-900 data-[state=on]:text-white' },
  { value: 'IN_PROGRESS', label: '⏳ In progress', cls: 'data-[state=on]:bg-amber-600 data-[state=on]:text-white' },
  { value: 'STRONG_HIRE', label: '🚀 Strong Hire', cls: 'data-[state=on]:bg-blue-600 data-[state=on]:text-white' },
  { value: 'HIRE', label: '✅ Hire', cls: 'data-[state=on]:bg-sky-600 data-[state=on]:text-white' },
  { value: 'MAYBE', label: '🤔 Maybe', cls: 'data-[state=on]:bg-amber-500 data-[state=on]:text-white' },
  { value: 'NO_HIRE', label: '❌ No Hire', cls: 'data-[state=on]:bg-rose-600 data-[state=on]:text-white' },
]

/* ------------------------------ helpers ------------------------------ */

function fmtDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—'
  const d = new Date(value)
  if (!isValid(d)) return '—'
  return format(d, withTime ? 'd MMM yyyy, h:mm a' : 'd MMM yyyy')
}

function scoreColor(score: number | null | undefined): string {
  if (score == null) return 'text-slate-400 dark:text-slate-500'
  if (score >= 8) return 'text-emerald-600 dark:text-emerald-400'
  if (score >= 6.5) return 'text-sky-600 dark:text-sky-400'
  if (score >= 5) return 'text-amber-600 dark:text-amber-400'
  return 'text-rose-600 dark:text-rose-400'
}

function scoreRingCls(score: number | null | undefined): string {
  if (score == null) return 'border-slate-200 dark:border-slate-700 text-slate-400'
  if (score >= 8) return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
  if (score >= 6.5) return 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
  if (score >= 5) return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
  return 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
}

function noticeLabel(days: number | null | undefined): string {
  if (days == null) return '—'
  if (days === 0) return 'Immediate'
  if (days < 30) return `${days} days`
  const months = Math.round((days / 30) * 10) / 10
  return `${months} mo (${days}d)`
}

const APP_STATUS_LABEL: Record<string, string> = {
  APPLIED: 'Applied',
  SHORTLISTED: 'Shortlisted',
  INTERVIEW_SCHEDULED: 'Interview scheduled',
  INTERVIEWED: 'Interviewed',
  SHARED_WITH_CLIENT: 'Shared with client',
  REJECTED: 'Rejected',
  HIRED: 'Hired',
}

/* --------------------------- CSV export (ATS import) --------------------------- */

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadFile(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function exportGroupCsv(group: HubJobGroup) {
  const header = [
    'Candidate', 'Email', 'Phone', 'Headline', 'Location', 'Experience (yrs)',
    'Notice period (days)', 'Current CTC (LPA)', 'Expected CTC (LPA)', 'Skills',
    'Interview status', 'AI score (0-10)', 'AI verdict', 'Application status',
    'Applied on', 'Recruiter viewed', 'Interview completed', 'Client decision',
  ]
  const rows = group.interviews.map((iv) => [
    iv.candidateName,
    iv.candidateEmail,
    iv.profile.phone,
    iv.profile.headline,
    iv.profile.location,
    iv.profile.experienceYears,
    iv.profile.noticePeriodDays,
    iv.profile.currentSalary,
    iv.profile.expectedSalary,
    iv.profile.skills.join(' | '),
    iv.status,
    iv.overallScore,
    iv.verdict ? iv.verdict.replace('_', ' ') : '',
    iv.profile.applicationStatus,
    iv.profile.appliedAt ? fmtDate(iv.profile.appliedAt) : '',
    iv.profile.viewedAt ? fmtDate(iv.profile.viewedAt) : '',
    iv.completedAt ? fmtDate(iv.completedAt, true) : '',
    iv.profile.clientDecision ?? '',
  ])
  const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
  const safeTitle = group.jobTitle.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  downloadFile(`seewee-${safeTitle}-candidates.csv`, 'text/csv;charset=utf-8', csv)
  toast.success(`${group.interviews.length} candidate${group.interviews.length === 1 ? '' : 's'} exported — ready for ATS import`)
}

function matchHaystack(iv: HubInterview, group: HubJobGroup, q: string): boolean {
  const hay = [
    iv.candidateName,
    iv.candidateEmail,
    group.jobTitle,
    group.company,
    iv.profile.location,
    iv.profile.headline,
    iv.profile.phone,
    iv.verdict ? VERDICT_META[iv.verdict]?.label : '',
    iv.profile.skills.join(' '),
    iv.questions.map((x) => x.question).join(' '),
  ]
    .join(' ')
    .toLowerCase()
  return hay.includes(q)
}

/* --------------------- .ics calendar download (client-side) --------------------- */

/** Escape a text value per RFC 5545 (backslash, semicolon, comma, newlines) */
function icsEscape(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Fold long content lines at ~75 octets (continuation lines start with a space) */
function icsFold(line: string): string {
  if (line.length <= 73) return line
  const chunks: string[] = [line.slice(0, 73)]
  let rest = line.slice(73)
  while (rest.length > 0) {
    chunks.push(' ' + rest.slice(0, 73))
    rest = rest.slice(73)
  }
  return chunks.join('\r\n')
}

/** UTC calendar stamp in basic format: YYYYMMDDTHHMMSSZ */
function icsStamp(value: Date): string {
  return value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/** Tomorrow 10:00 IST (UTC+5:30) — honest placeholder for interviews without a slot */
function tomorrowTenIst(): Date {
  const IST_MS = 5.5 * 60 * 60 * 1000
  const istNow = new Date(Date.now() + IST_MS)
  return new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + 1, 4, 30, 0)
  )
}

function downloadInterviewIcs(iv: HubInterview, jobTitle: string) {
  const isDone = iv.status === 'COMPLETED' && iv.completedAt
  const started = iv.status === 'IN_PROGRESS' && iv.startedAt
  const start = isDone ? new Date(iv.completedAt!) : started ? new Date(iv.startedAt!) : tomorrowTenIst()

  const slotNote = isDone
    ? `Completed ${fmtDate(iv.completedAt, true)} — archived here for your records.`
    : started
      ? `In progress — started ${fmtDate(iv.startedAt, true)}.`
      : 'Proposed slot: tomorrow 10:00 IST — AI interviews are candidate-paced, so this is a placeholder reminder; nudge the candidate to start any time.'

  const focusAreas = Array.from(new Set(iv.questions.map((q) => q.focusArea).filter(Boolean))).slice(0, 3)
  const description = [
    `AI-led structured interview · Difficulty: ${iv.difficulty} · 45 min.`,
    focusAreas.length ? `Focus areas: ${focusAreas.join(', ')}.` : '',
    slotNote,
    'Join info: the candidate opens the voice interview room from their dashboard; the scored report lands in your Interview Hub automatically.',
  ]
    .filter(Boolean)
    .join('\n')

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SeeWe//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${iv.id}@interview.seewee`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    'DURATION:PT45M',
    `SUMMARY:${icsEscape(`Interview: ${iv.candidateName} · ${jobTitle}`)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  const ics = lines.map(icsFold).join('\r\n')

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${iv.candidateName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'candidate'}-interview.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  toast.success('📅 Calendar file downloaded')
}

/* ------------------------------ component ---------------------------- */

export function InterviewHub() {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)

  const [data, setData] = useState<HubData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('ALL')
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set())
  const [detail, setDetail] = useState<{ group: HubJobGroup; iv: HubInterview } | null>(null)

  const load = useCallback(async () => {
    if (!user || user.role !== 'RECRUITER') return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/interview/hub?recruiterId=${encodeURIComponent(user.id)}`)
      const json: { data?: HubData; error?: string } = await res.json()
      if (!res.ok || !json.data) throw new Error(json.error ?? 'Failed to load')
      setData(json.data)
      // auto-expand groups with recent activity
      setOpenGroups(new Set(json.data.groups.slice(0, 2).map((g) => g.jobId)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the interview hub')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const q = query.trim().toLowerCase()

  const visibleGroups = useMemo<HubJobGroup[]>(() => {
    if (!data) return []
    return data.groups
      .map((group) => {
        const groupMatches = q && [
          group.jobTitle,
          group.company,
          group.jobLocation,
        ].join(' ').toLowerCase().includes(q)
        const filtered = group.interviews.filter((iv) => {
          if (verdictFilter === 'IN_PROGRESS' && iv.status !== 'IN_PROGRESS') return false
          if (verdictFilter !== 'ALL' && verdictFilter !== 'IN_PROGRESS' && iv.verdict !== verdictFilter) return false
          if (q && !groupMatches && !matchHaystack(iv, group, q)) return false
          return true
        })
        return { ...group, interviews: filtered }
      })
      .filter((group) => group.interviews.length > 0)
  }, [data, q, verdictFilter])

  function toggleGroup(jobId: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(jobId)) next.delete(jobId)
      else next.add(jobId)
      return next
    })
  }

  /* ------------------------------ states ------------------------------ */

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading interview hub">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="rounded-xl border-rose-200 dark:border-rose-900/60">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="font-medium text-rose-700 dark:text-rose-300">{error}</p>
          <Button onClick={() => void load()} variant="outline" className="rounded-lg">
            <RefreshCw className="size-4" aria-hidden /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!data || data.groups.length === 0) {
    return (
      <Card className="rounded-xl border-dashed">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
            <Bot className="size-7 text-blue-600" aria-hidden />
          </span>
          <p className="font-semibold text-slate-800 dark:text-slate-200">No interviews yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Once you shortlist candidates and they complete AI interviews, every position&apos;s
            interviews, answers and reports will appear here for one-click analysis.
          </p>
        </CardContent>
      </Card>
    )
  }

  const s = data.summary

  return (
    <div className="space-y-4">
      {/* summary KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Positions interviewed', value: s.positions, icon: BriefcaseBusiness },
          { label: 'Total interviews', value: s.totalInterviews, icon: Users },
          { label: 'Completed', value: s.completed, icon: FileText },
          { label: 'Avg score', value: s.avgScore != null ? `${s.avgScore.toFixed(1)}/10` : '—', icon: Award },
        ].map(({ label, value, icon: Icon }) => (
          <Card key={label} className="rounded-xl p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <Icon className="size-3.5" aria-hidden /> {label}
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
          </Card>
        ))}
      </div>

      {/* search + verdict filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search candidate, position, skill, city…"
            aria-label="Search interviews"
            className="h-10 rounded-xl border-slate-200 pl-9 dark:border-slate-800"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-xs font-semibold text-slate-400 hover:text-slate-600"
            >
              ✕
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by verdict">
          {VERDICT_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              data-state={verdictFilter === f.value ? 'on' : 'off'}
              onClick={() => setVerdictFilter(f.value)}
              className={cn(
                'inline-flex min-h-[32px] items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-all hover:border-blue-400 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
                f.cls,
                verdictFilter === f.value && 'border-transparent shadow-sm'
              )}
              aria-pressed={verdictFilter === f.value}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* position groups */}
      {visibleGroups.length === 0 ? (
        <Card className="rounded-xl border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No interviews match “{query || VERDICT_FILTERS.find((f) => f.value === verdictFilter)?.label}”.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visibleGroups.map((group) => {
            const open = openGroups.has(group.jobId)
            return (
              <Card key={group.jobId} className="overflow-hidden rounded-xl">
                <div
                  role="button"
                  tabIndex={0}
                  aria-expanded={open}
                  onClick={() => toggleGroup(group.jobId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleGroup(group.jobId)
                    }
                  }}
                  className="flex w-full cursor-pointer flex-col gap-2 p-4 text-left transition-colors hover:bg-slate-50/80 sm:flex-row sm:items-center sm:justify-between dark:hover:bg-slate-800/40"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                      <BriefcaseBusiness className="size-4 shrink-0 text-blue-600" aria-hidden />
                      <span className="truncate">{group.jobTitle}</span>
                      <span className="hidden items-center gap-1 text-xs font-medium text-slate-400 sm:inline-flex">
                        <Building2 className="size-3" aria-hidden /> {group.company}
                      </span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1"><MapPin className="size-3" aria-hidden /> {group.jobLocation || '—'}</span>
                      <span>{group.total} interview{group.total === 1 ? '' : 's'} · {group.completed} completed</span>
                      {group.inProgress > 0 && (
                        <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                          <Clock3 className="size-3" aria-hidden /> {group.inProgress} in progress
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2.5 sm:shrink-0">
                    {group.avgScore != null && (
                      <span className={cn('rounded-full border px-2.5 py-1 text-xs font-bold tabular-nums', scoreRingCls(group.avgScore))}>
                        avg {group.avgScore.toFixed(1)}/10
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg border-slate-200 text-xs dark:border-slate-700"
                      onClick={(e) => {
                        e.stopPropagation()
                        exportGroupCsv(group)
                      }}
                      aria-label={`Export all ${group.jobTitle} candidates as CSV for ATS import`}
                    >
                      <Download className="size-3.5" aria-hidden /> Export CSV
                    </Button>
                    <ChevronDown className={cn('size-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} aria-hidden />
                  </div>
                </div>

                {open && (
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                      {group.interviews.map((iv) => {
                        const verdict = iv.verdict ? VERDICT_META[iv.verdict] : null
                        const inProgress = iv.status === 'IN_PROGRESS'
                        return (
                          <li key={iv.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-3">
                              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-sky-600 text-sm font-bold text-white" aria-hidden>
                                {iv.candidateName.charAt(0).toUpperCase()}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                                  {iv.candidateName}
                                  <span className="ml-2 text-xs font-normal text-slate-400">{iv.candidateEmail}</span>
                                </p>
                                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                                  {inProgress ? (
                                    <span className="inline-flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                                      <Loader2 className="size-3 animate-spin" aria-hidden /> In progress
                                    </span>
                                  ) : (
                                    <span>Completed {fmtDate(iv.completedAt)}</span>
                                  )}
                                  {iv.clientName && <span>· shared with {iv.clientName}</span>}
                                  {iv.profile.location && <span>· 📍 {iv.profile.location}</span>}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 sm:shrink-0">
                              {verdict && (
                                <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', verdict.className)}>
                                  {verdict.emoji} {verdict.label}
                                </span>
                              )}
                              {iv.recruiterDecision && DECISION_META[iv.recruiterDecision] && (
                                <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-semibold', DECISION_META[iv.recruiterDecision].cls)} title="Recruiter final decision">
                                  {DECISION_META[iv.recruiterDecision].emoji} {DECISION_META[iv.recruiterDecision].label}
                                </span>
                              )}
                              <span className={cn('text-sm font-bold tabular-nums', scoreColor(iv.overallScore))}>
                                {iv.overallScore != null ? `${iv.overallScore.toFixed(1)}/10` : '—'}
                              </span>
                              <button
                                type="button"
                                onClick={() => downloadInterviewIcs(iv, group.jobTitle)}
                                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300"
                                aria-label={`Add ${iv.candidateName}'s ${group.jobTitle} interview to calendar (.ics download)`}
                                title="Add to calendar (.ics)"
                              >
                                <CalendarPlus className="size-3.5" aria-hidden />
                              </button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 rounded-lg border-slate-200 text-xs dark:border-slate-700"
                                onClick={() => setDetail({ group, iv })}
                              >
                                Open →
                              </Button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      {/* ------------------------- detail dialog ------------------------- */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto rounded-xl [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                  {detail.iv.candidateName}
                  {detail.iv.verdict && VERDICT_META[detail.iv.verdict] && (
                    <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', VERDICT_META[detail.iv.verdict].className)}>
                      {VERDICT_META[detail.iv.verdict].emoji} {VERDICT_META[detail.iv.verdict].label}
                    </span>
                  )}
                  {detail.iv.status === 'IN_PROGRESS' && (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      ⏳ In progress
                    </span>
                  )}
                  {detail.iv.mediaCount > 0 && (
                    <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      🎬 {detail.iv.mediaCount} recording{detail.iv.mediaCount === 1 ? '' : 's'}
                    </span>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {detail.group.jobTitle} · {detail.group.company} — AI interview {detail.iv.difficulty.toLowerCase()} ·{' '}
                  {detail.iv.status === 'COMPLETED' ? `completed ${fmtDate(detail.iv.completedAt, true)}` : 'started ' + fmtDate(detail.iv.startedAt, true)}
                  {detail.iv.clientName ? ` · client: ${detail.iv.clientName}` : ''}
                </DialogDescription>
              </DialogHeader>

              {/* score + auto-captured details */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className={cn('flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border-2', scoreRingCls(detail.iv.overallScore))}>
                  <span className="text-lg font-black tabular-nums leading-none">
                    {detail.iv.overallScore != null ? detail.iv.overallScore.toFixed(1) : '—'}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">/ 10</span>
                </div>
                <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
                  <DetailChip icon={MapPin} label="Location" value={detail.iv.report?.candidateDetails?.location ?? detail.iv.profile.location} viaInterview={!!detail.iv.report?.candidateDetails?.location} />
                  <DetailChip icon={GraduationCap} label="Experience" value={detail.iv.report?.candidateDetails?.experienceYears != null ? `${detail.iv.report.candidateDetails.experienceYears} yrs` : detail.iv.profile.experienceYears != null ? `${detail.iv.profile.experienceYears} yrs` : null} viaInterview={detail.iv.report?.candidateDetails?.experienceYears != null} />
                  <DetailChip icon={Timer} label="Notice period" value={detail.iv.report?.candidateDetails?.noticePeriodDays != null ? noticeLabel(detail.iv.report.candidateDetails.noticePeriodDays) : detail.iv.profile.noticePeriodDays != null ? noticeLabel(detail.iv.profile.noticePeriodDays) : null} viaInterview={detail.iv.report?.candidateDetails?.noticePeriodDays != null} />
                  <DetailChip icon={Wallet} label="Current CTC" value={detail.iv.report?.candidateDetails?.currentSalaryLpa != null ? `${detail.iv.report.candidateDetails.currentSalaryLpa} LPA` : detail.iv.profile.currentSalary != null ? `${detail.iv.profile.currentSalary} LPA` : null} viaInterview={detail.iv.report?.candidateDetails?.currentSalaryLpa != null} />
                  <DetailChip icon={IndianRupee} label="Expected CTC" value={detail.iv.report?.candidateDetails?.expectedSalaryLpa != null ? `${detail.iv.report.candidateDetails.expectedSalaryLpa} LPA` : detail.iv.profile.expectedSalary != null ? `${detail.iv.profile.expectedSalary} LPA` : null} viaInterview={detail.iv.report?.candidateDetails?.expectedSalaryLpa != null} />
                  <DetailChip icon={BriefcaseBusiness} label="Headline" value={detail.iv.profile.headline} />
                </div>
              </div>

              {/* contact + skills */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                  <Mail className="size-3" aria-hidden /> {detail.iv.candidateEmail || '—'}
                </span>
                {detail.iv.profile.phone && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                    <Phone className="size-3" aria-hidden /> {detail.iv.profile.phone}
                  </span>
                )}
                {detail.iv.profile.education && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                    <GraduationCap className="size-3" aria-hidden /> {detail.iv.profile.education}
                  </span>
                )}
                {detail.iv.profile.matchScore != null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800">
                    ⭐ {Math.round(detail.iv.profile.matchScore)}% skill match
                  </span>
                )}
                {detail.iv.profile.skills.slice(0, 8).map((sk) => (
                  <span key={sk} className="rounded-full bg-blue-50 px-2.5 py-1 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                    {sk}
                  </span>
                ))}
              </div>

              {/* application timeline — the candidate's journey through the pipeline */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                <span className="font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Journey:</span>
                <span>Applied {fmtDate(detail.iv.profile.appliedAt)}</span>
                {detail.iv.profile.viewedAt && <span>· Recruiter viewed {fmtDate(detail.iv.profile.viewedAt)}</span>}
                {detail.iv.completedAt && <span>· Interview {fmtDate(detail.iv.completedAt)}</span>}
                {detail.iv.profile.applicationStatus && (
                  <Badge variant="outline" className="ml-auto rounded-full border-blue-200 bg-blue-50 text-[10px] font-semibold text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                    {APP_STATUS_LABEL[detail.iv.profile.applicationStatus] ?? detail.iv.profile.applicationStatus}
                  </Badge>
                )}
                {detail.iv.profile.clientDecision && (
                  <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                    client: {detail.iv.profile.clientDecision.toLowerCase()}
                  </Badge>
                )}
              </div>

              {/* resume snapshot */}
              {detail.iv.profile.resumeSummary && (
                <details className="group rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                  <summary className="flex cursor-pointer select-none items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 group-open:text-slate-600">
                    <FileText className="size-3.5" aria-hidden /> Resume snapshot
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    {detail.iv.profile.resumeSummary}
                  </p>
                </details>
              )}

              <Separator />

              {/* full question plan + answers (recruiter transparency) */}
              <section aria-label="Interview questions and answers">
                <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
                  <Video className="size-4 text-sky-600" aria-hidden /> Interview recording &amp;
                  transcript
                </h3>
                <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                  Watch each answer's video and read exactly what the candidate said —
                  question by question.
                </p>
                <ol className="max-h-96 space-y-3 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
                  {detail.iv.questions.map((question) => {
                    const answer = detail.iv.answers.find((a) => a.qIndex === question.qIndex)
                    const isPrelim = question.kind === 'PRELIMINARY'
                    return (
                      <li key={question.qIndex} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white', isPrelim ? 'bg-teal-500' : 'bg-blue-600')}>
                            {question.qIndex + 1}
                          </span>
                          <Badge variant="outline" className="max-w-[240px] truncate rounded-full text-[10px] font-medium">
                            {question.focusArea}
                          </Badge>
                          {isPrelim && (
                            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
                              auto-fed to profile
                            </span>
                          )}
                          {answer && typeof answer.score === 'number' && (
                            <span className={cn('ml-auto text-xs font-bold tabular-nums', scoreColor(answer.score))}>
                              {answer.score.toFixed(1)}/10
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-sm font-medium text-slate-800 dark:text-slate-200">{question.question}</p>
                        {answer?.transcript ? (
                          <>
                            <blockquote className="mt-2 rounded-lg border-l-4 border-blue-200 bg-slate-50 px-3 py-2 text-sm italic leading-relaxed text-slate-600 dark:border-blue-900 dark:bg-slate-800/60 dark:text-slate-300">
                              “{answer.transcript}”
                            </blockquote>
                            {answer.feedback && (
                              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                                <span className="font-semibold text-slate-600 dark:text-slate-300">AI note:</span> {answer.feedback}
                              </p>
                            )}
                            {answer.mediaPath && (
                              <div className="mt-2">
                                {answer.mediaKind === 'video' ? (
                                  <video
                                    controls
                                    playsInline
                                    src={`/api/interview/media/${encodeURIComponent(answer.mediaPath)}${user?.id ? `?viewerId=${encodeURIComponent(user.id)}` : ''}`}
                                    className="max-h-64 w-full rounded-lg border border-slate-200 bg-slate-950 dark:border-slate-800"
                                    aria-label={`Recording of answer ${question.qIndex + 1}`}
                                  />
                                ) : (
                                  <audio
                                    controls
                                    src={`/api/interview/media/${encodeURIComponent(answer.mediaPath)}${user?.id ? `?viewerId=${encodeURIComponent(user.id)}` : ''}`}
                                    className="w-full"
                                    aria-label={`Recording of answer ${question.qIndex + 1}`}
                                  />
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="mt-2 text-xs italic text-slate-400 dark:text-slate-500">Not answered yet</p>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </section>

              {/* report summary */}
              {detail.iv.report && (
                <section aria-label="AI report summary" className="rounded-xl bg-gradient-to-br from-blue-50 to-sky-50 p-4 dark:from-blue-950/30 dark:to-sky-950/20">
                  <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
                    <Bot className="size-4 text-blue-600" aria-hidden /> AI report summary
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">{detail.iv.report.aiSummary}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {detail.iv.report.dimensionScores.map((dim) => (
                      <div key={dim.name} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 truncate text-xs font-medium text-slate-600 dark:text-slate-300">{dim.name}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/70 dark:bg-slate-800" aria-hidden>
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-sky-500"
                            style={{ width: `${Math.min(100, (dim.score / 10) * 100)}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{dim.score.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Strengths</p>
                      <ul className="mt-1 space-y-1">
                        {detail.iv.report.strengths.map((st, i) => (
                          <li key={i} className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">✓ {st}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wide text-rose-700 dark:text-rose-400">Watch-outs</p>
                      <ul className="mt-1 space-y-1">
                        {detail.iv.report.weaknesses.map((wk, i) => (
                          <li key={i} className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">▲ {wk}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <p className="mt-3 rounded-lg bg-white/70 p-2.5 text-xs leading-relaxed text-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                    <span className="font-bold text-slate-700 dark:text-slate-200">Recommendation:</span> {detail.iv.report.recommendation}
                  </p>
                </section>
              )}

              {/* FINAL CALL — AI suggestion (advisory) beside the recruiter's own decision */}
              {detail.iv.status === 'COMPLETED' && (
                <FinalDecisionPanel
                  iv={detail.iv}
                  recruiterId={user?.id ?? ''}
                  onDecided={(patch) => {
                    setData(
                      (prev) =>
                        prev
                          ? {
                              ...prev,
                              groups: prev.groups.map((g) => ({
                                ...g,
                                interviews: g.interviews.map((x) =>
                                  x.id === detail.iv.id
                                    ? {
                                        ...x,
                                        recruiterDecision: patch.recruiterDecision,
                                        recruiterDecisionNote: patch.recruiterDecisionNote,
                                        recruiterDecidedAt: patch.recruiterDecidedAt,
                                        profile: {
                                          ...x.profile,
                                          applicationStatus:
                                            patch.applicationStatus ?? x.profile.applicationStatus,
                                        },
                                      }
                                    : x
                                ),
                              })),
                            }
                          : prev
                    )
                    setDetail(
                      (prev) =>
                        prev && prev.iv.id === detail.iv.id
                          ? {
                              ...prev,
                              iv: {
                                ...prev.iv,
                                recruiterDecision: patch.recruiterDecision,
                                recruiterDecisionNote: patch.recruiterDecisionNote,
                                recruiterDecidedAt: patch.recruiterDecidedAt,
                                profile: {
                                  ...prev.iv.profile,
                                  applicationStatus:
                                    patch.applicationStatus ?? prev.iv.profile.applicationStatus,
                                },
                              },
                            }
                          : prev
                    )
                  }}
                />
              )}

              {/* ATS handoff — push this candidate into the recruiter's own pipeline */}
              {detail.iv.status === 'COMPLETED' ? (
                <AtsPanel interviewId={detail.iv.id} candidateName={detail.iv.candidateName} />
              ) : (
                <p className="rounded-xl border border-dashed border-slate-200 p-3 text-center text-xs text-slate-400 dark:border-slate-700 dark:text-slate-500">
                  ATS handoff unlocks once this interview is completed.
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/* --------------------------- detail chip ---------------------------- */

/** Recruiter final-decision badges (list rows + panel) */
export const DECISION_META: Record<
  string,
  { label: string; emoji: string; cls: string }
> = {
  ADVANCE: {
    label: 'Advanced',
    emoji: '✅',
    cls: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  HOLD: {
    label: 'On hold',
    emoji: '⏸',
    cls: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  REJECT: {
    label: 'Rejected',
    emoji: '❌',
    cls: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  },
}

function DetailChip({
  icon: Icon,
  label,
  value,
  viaInterview = false,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  value: string | null | undefined
  viaInterview?: boolean
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 dark:border-slate-800 dark:bg-slate-900">
      <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        <Icon className="size-3" aria-hidden /> {label}
        {viaInterview && value && (
          <span className="ml-1 rounded-full bg-teal-50 px-1.5 py-px text-[9px] font-bold text-teal-700 dark:bg-teal-950/40 dark:text-teal-300">
            via interview
          </span>
        )}
      </p>
      <p className={cn('mt-0.5 truncate text-sm font-semibold', value ? 'text-slate-800 dark:text-slate-200' : 'text-slate-300 dark:text-slate-600')}>
        {value || 'Not captured'}
      </p>
    </div>
  )
}

/* ------------------------- ATS handoff panel ------------------------ */

interface AtsIntegrationItem {
  id: string
  name: string
  webhookUrl: string
  apiKey: string | null
  active: boolean
  pushCount: number
  lastPush: { status: string; createdAt: string } | null
}

interface AtsPushItem {
  id: string
  status: string
  httpStatus: number | null
  message: string | null
  integration: { id: string; name: string }
  createdAt: string
}

/**
 * Send-to-ATS panel inside the candidate detail dialog. Supports a registered
 * webhook (one-click push with audit log) plus manual handoff via Copy JSON /
 * Download JSON — the exact dossier an ATS needs for the next process.
 */
function AtsPanel({ interviewId, candidateName }: { interviewId: string; candidateName: string }) {
  const user = useAppStore((s) => s.user)
  const recruiterId = user?.id ?? ''

  const [integrations, setIntegrations] = useState<AtsIntegrationItem[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [history, setHistory] = useState<AtsPushItem[]>([])
  const [busy, setBusy] = useState<'' | 'push' | 'copy' | 'download' | 'save'>('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', webhookUrl: '', apiKey: '' })

  const loadAll = useCallback(async () => {
    if (!recruiterId) return
    try {
      const [intgRes, pushRes] = await Promise.all([
        fetch(`/api/ats/integrations?recruiterId=${encodeURIComponent(recruiterId)}`),
        fetch(
          `/api/ats/push?recruiterId=${encodeURIComponent(recruiterId)}&interviewId=${encodeURIComponent(interviewId)}`
        ),
      ])
      const intgJson: { data?: AtsIntegrationItem[] } = await intgRes.json()
      const pushJson: { data?: AtsPushItem[] } = await pushRes.json()
      const list = intgJson.data ?? []
      setIntegrations(list)
      setHistory(pushJson.data ?? [])
      setSelectedId((prev) => prev || list.find((x) => x.active)?.id || '')
    } catch {
      setIntegrations([])
    }
  }, [recruiterId, interviewId])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const selected = integrations?.find((x) => x.id === selectedId) ?? null

  async function fetchDossier(): Promise<unknown | null> {
    const res = await fetch(`/api/ats/payload?interviewId=${encodeURIComponent(interviewId)}`)
    const json: { data?: unknown; error?: string } = await res.json()
    if (!res.ok || !json.data) throw new Error(json.error || 'Failed to build the ATS payload')
    return json.data
  }

  async function pushToAts() {
    if (!selected) {
      toast.error('Pick an ATS integration first')
      return
    }
    setBusy('push')
    try {
      const res = await fetch('/api/ats/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId, integrationId: selected.id, interviewId }),
      })
      const json: { data?: AtsPushItem; error?: string } = await res.json()
      if (!res.ok || !json.data) throw new Error(json.error || 'Push failed')
      if (json.data.status === 'SUCCESS') {
        toast.success(`${candidateName} delivered to ${selected.name}`, {
          description: json.data.message ?? undefined,
        })
      } else {
        toast.warning(`Push failed — ${json.data.message ?? 'unknown error'}`, {
          description: 'The attempt is logged. You can still Copy/Download the JSON for manual import.',
        })
      }
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Push failed')
    } finally {
      setBusy('')
    }
  }

  async function copyPayload() {
    setBusy('copy')
    try {
      const dossier = await fetchDossier()
      await navigator.clipboard.writeText(JSON.stringify(dossier, null, 2))
      toast.success('ATS payload copied — paste it into your ATS import box')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Copy failed')
    } finally {
      setBusy('')
    }
  }

  async function downloadPayload() {
    setBusy('download')
    try {
      const dossier = await fetchDossier()
      const safeName = candidateName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
      downloadFile(`seewee-ats-${safeName}.json`, 'application/json', JSON.stringify(dossier, null, 2))
      toast.success('Dossier downloaded — import it into your ATS')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy('')
    }
  }

  async function saveIntegration() {
    if (!form.name.trim() || !form.webhookUrl.trim()) {
      toast.error('Name and webhook URL are required')
      return
    }
    setBusy('save')
    try {
      const res = await fetch('/api/ats/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId, ...form }),
      })
      const json: { data?: { id: string }; error?: string } = await res.json()
      if (!res.ok || !json.data) throw new Error(json.error || 'Could not save the integration')
      toast.success('ATS connected')
      setForm({ name: '', webhookUrl: '', apiKey: '' })
      setShowAdd(false)
      await loadAll()
      setSelectedId(json.data.id)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the integration')
    } finally {
      setBusy('')
    }
  }

  async function removeIntegration(id: string) {
    try {
      const res = await fetch(`/api/ats/integrations?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      toast.success('Integration removed')
      if (selectedId === id) setSelectedId('')
      await loadAll()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <section aria-label="Send to ATS" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
          <Webhook className="size-4 text-teal-600" aria-hidden /> Send to ATS
        </h3>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 gap-1 rounded-lg text-xs text-teal-700 hover:bg-teal-50 hover:text-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/40"
          onClick={() => setShowAdd((v) => !v)}
        >
          <Plus className="size-3.5" aria-hidden /> {showAdd ? 'Cancel' : 'New integration'}
        </Button>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        Push {candidateName}&apos;s complete dossier — profile, interview plan, answers, recordings metadata,
        scores and report — into your own hiring pipeline for the next process.
      </p>

      {/* connect form */}
      {showAdd && (
        <div className="mt-3 space-y-2.5 rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ats-name" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Integration name
              </Label>
              <Input
                id="ats-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Company hiring pipeline"
                className="h-9 rounded-lg"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ats-url" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Webhook URL (POST endpoint)
              </Label>
              <Input
                id="ats-url"
                value={form.webhookUrl}
                onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
                placeholder="https://ats.yourcompany.com/hooks/seewee"
                className="h-9 rounded-lg"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ats-key" className="text-xs font-medium text-slate-600 dark:text-slate-300">
              API key (optional — sent as x-ats-api-key header)
            </Label>
            <Input
              id="ats-key"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="shared secret"
              className="h-9 rounded-lg"
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => void saveIntegration()}
              disabled={busy === 'save'}
              className="h-9 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
            >
              {busy === 'save' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              Save integration
            </Button>
          </div>
        </div>
      )}

      {/* integrations + actions */}
      {integrations === null ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      ) : integrations.length === 0 && !showAdd ? (
        <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-4 text-center dark:border-slate-700">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            No ATS connected yet. Register your ATS webhook — or use Copy / Download below for a manual import.
          </p>
        </div>
      ) : (
        integrations.length > 0 && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger className="h-9 w-full rounded-lg sm:w-64" aria-label="Choose ATS integration">
                  <SelectValue placeholder="Choose ATS integration" />
                </SelectTrigger>
                <SelectContent>
                  {integrations.map((it) => (
                    <SelectItem key={it.id} value={it.id} disabled={!it.active}>
                      {it.name} · {it.pushCount} push{it.pushCount === 1 ? '' : 'es'}
                      {it.active ? '' : ' (paused)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void pushToAts()}
                  disabled={busy === 'push' || !selected}
                  className="h-9 rounded-lg bg-teal-600 text-white hover:bg-teal-700"
                >
                  {busy === 'push' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CloudUpload className="size-4" aria-hidden />}
                  Push to ATS
                </Button>
                <Button size="sm" variant="outline" onClick={() => void copyPayload()} disabled={busy === 'copy'} className="h-9 rounded-lg border-slate-200 dark:border-slate-700">
                  {busy === 'copy' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                  Copy JSON
                </Button>
                <Button size="sm" variant="outline" onClick={() => void downloadPayload()} disabled={busy === 'download'} className="h-9 rounded-lg border-slate-200 dark:border-slate-700">
                  {busy === 'download' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
                  Download
                </Button>
                {selected && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void removeIntegration(selected.id)}
                    className="h-9 rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    aria-label={`Remove ${selected.name} integration`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </div>
            </div>
            {selected && (
              <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                <Webhook className="mr-1 inline size-3" aria-hidden /> posts to {selected.webhookUrl}
                {selected.apiKey ? ' · x-ats-api-key header attached' : ''}
              </p>
            )}
          </div>
        )
      )}

      {/* push history for this candidate */}
      {history.length > 0 && (
        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Push log</p>
          <ul className="mt-1 max-h-36 space-y-1.5 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
            {history.map((h) => (
              <li key={h.id} className="flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800/60">
                {h.status === 'SUCCESS' ? (
                  <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-rose-500" aria-hidden />
                )}
                <span className="min-w-0">
                  <span className="font-semibold text-slate-700 dark:text-slate-200">{h.integration.name}</span>
                  {' — '}
                  <span className="text-slate-500 dark:text-slate-400">{h.message ?? h.status}</span>
                  <span className="ml-1 whitespace-nowrap text-slate-400 dark:text-slate-500">· {fmtDate(h.createdAt, true)}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/* ----------------------- final decision panel ----------------------- */

interface DecisionPatch {
  recruiterDecision: string
  recruiterDecisionNote: string | null
  recruiterDecidedAt: string
  applicationStatus?: string | null
}

type DecisionChoice = 'ADVANCE' | 'HOLD' | 'REJECT'

/**
 * Side-by-side FINAL CALL — the AI's advisory suggestion on the LEFT, the
 * recruiter's authoritative decision on the RIGHT. The AI verdict never
 * executes anything on its own: only the human buttons move the pipeline
 * (REJECT closes the application; ADVANCE/HOLD record the call and leave the
 * next concrete step — share with client / offer — as an explicit action).
 */
function FinalDecisionPanel({
  iv,
  recruiterId,
  onDecided,
}: {
  iv: HubInterview
  recruiterId: string
  onDecided: (patch: DecisionPatch) => void
}) {
  const [note, setNote] = useState(iv.recruiterDecisionNote ?? '')
  const [busy, setBusy] = useState<DecisionChoice | null>(null)
  const [confirmFor, setConfirmFor] = useState<DecisionChoice | null>(null)
  const [editing, setEditing] = useState(false)
  const existing = iv.recruiterDecision

  async function decide(decision: DecisionChoice) {
    setBusy(decision)
    try {
      const res = await fetch('/api/interview/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interviewId: iv.id, recruiterId, decision, note }),
      })
      const json: { data?: DecisionPatch; error?: string } = await res.json()
      if (!res.ok || !json.data) throw new Error(json.error ?? 'Failed to record the decision')
      onDecided({
        recruiterDecision: json.data.recruiterDecision,
        recruiterDecisionNote: json.data.recruiterDecisionNote,
        recruiterDecidedAt: json.data.recruiterDecidedAt,
        applicationStatus: json.data.applicationStatus,
      })
      toast.success(
        decision === 'ADVANCE'
          ? '✅ Advanced — candidate notified they are moving ahead'
          : decision === 'HOLD'
            ? '⏸ On hold — decision recorded'
            : '❌ Rejected — application closed'
      )
      setConfirmFor(null)
      setEditing(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record the decision')
    } finally {
      setBusy(null)
    }
  }

  const decidedMeta = existing ? DECISION_META[existing] : null
  const showControls = !existing || editing
  const aiRec = iv.report?.recommendation ?? ''

  const CONFIRM_COPY: Record<DecisionChoice, { title: string; body: string; cta: string; ctaCls: string }> = {
    ADVANCE: {
      title: 'Advance this candidate?',
      body: 'Your approval is recorded and the candidate is politely told they are moving ahead (no scores shared). The next concrete step — sharing with the client or sending an offer — stays with you.',
      cta: 'Yes, advance',
      ctaCls: 'bg-emerald-600 text-white hover:bg-emerald-700',
    },
    HOLD: {
      title: 'Put this candidate on hold?',
      body: 'The decision is recorded for the hiring team. The candidate is NOT notified — nothing changes for them until you decide again.',
      cta: 'Put on hold',
      ctaCls: 'bg-amber-600 text-white hover:bg-amber-700',
    },
    REJECT: {
      title: 'Reject this application?',
      body: 'The application moves to Rejected and the candidate receives a polite, score-free update. You can still undo it later from the Applicants pipeline.',
      cta: 'Reject application',
      ctaCls: 'bg-rose-600 text-white hover:bg-rose-700',
    },
  }

  return (
    <section aria-label="Final decision" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <h3 className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
        <Gavel className="size-4 text-slate-600 dark:text-slate-300" aria-hidden /> Final decision
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          AI advises · you decide
        </span>
      </h3>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {/* LEFT — the AI suggestion (advisory only) */}
        <div className="rounded-lg border border-blue-100 bg-gradient-to-br from-blue-50 to-sky-50 p-3 dark:border-blue-900/50 dark:from-blue-950/30 dark:to-sky-950/20">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
            <Bot className="size-3.5" aria-hidden /> AI suggestion — advisory only
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {iv.verdict && VERDICT_META[iv.verdict] && (
              <span className={cn('rounded-full border px-2 py-0.5 text-xs font-semibold', VERDICT_META[iv.verdict].className)}>
                {VERDICT_META[iv.verdict].emoji} {VERDICT_META[iv.verdict].label}
              </span>
            )}
            <span className={cn('text-lg font-black tabular-nums', scoreColor(iv.overallScore))}>
              {iv.overallScore != null ? `${iv.overallScore.toFixed(1)}/10` : '—'}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            {aiRec || 'No AI recommendation was generated — decide from the transcript and recordings.'}
          </p>
          {iv.mediaCount > 0 && (
            <p className="mt-2 text-[11px] font-medium text-slate-500 dark:text-slate-400">
              🎬 {iv.mediaCount} answer recording{iv.mediaCount === 1 ? '' : 's'} available above — watch before deciding.
            </p>
          )}
        </div>

        {/* RIGHT — the recruiter's authoritative call */}
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            <UserCheck className="size-3.5" aria-hidden /> Your final call
          </p>

          {showControls ? (
            <>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <Button
                  size="sm"
                  onClick={() => setConfirmFor('ADVANCE')}
                  disabled={busy !== null}
                  className="h-9 flex-col gap-0 rounded-lg bg-emerald-600 px-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                  aria-label="Advance this candidate"
                >
                  {busy === 'ADVANCE' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <UserCheck className="size-3.5" aria-hidden />}
                  Advance
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmFor('HOLD')}
                  disabled={busy !== null}
                  className="h-9 flex-col gap-0 rounded-lg border-amber-300 px-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-950/40"
                  aria-label="Put this candidate on hold"
                >
                  {busy === 'HOLD' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CirclePause className="size-3.5" aria-hidden />}
                  Hold
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirmFor('REJECT')}
                  disabled={busy !== null}
                  className="h-9 flex-col gap-0 rounded-lg border-rose-300 px-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
                  aria-label="Reject this application"
                >
                  {busy === 'REJECT' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <XCircle className="size-3.5" aria-hidden />}
                  Reject
                </Button>
              </div>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 600))}
                placeholder="Optional note — why this call? Visible to the hiring team, never to the candidate."
                rows={2}
                className="mt-2 rounded-lg text-xs"
                maxLength={600}
                aria-label="Decision note"
              />
              <p className="mt-1 text-right text-[10px] text-slate-400">{note.length}/600</p>
              {existing && (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Current decision: {decidedMeta?.label ?? existing} · changing it re-runs the pipeline effect.
                </p>
              )}
            </>
          ) : (
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-2">
                {decidedMeta && (
                  <span className={cn('rounded-full border px-2.5 py-1 text-xs font-bold', decidedMeta.cls)}>
                    {decidedMeta.emoji} {decidedMeta.label}
                  </span>
                )}
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  decided {fmtDate(iv.recruiterDecidedAt, true)}
                </span>
              </div>
              {iv.recruiterDecisionNote && (
                <p className="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs italic leading-relaxed text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                  “{iv.recruiterDecisionNote}”
                </p>
              )}
              {iv.profile.applicationStatus && (
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  Pipeline: {APP_STATUS_LABEL[iv.profile.applicationStatus] ?? iv.profile.applicationStatus}
                  {existing === 'ADVANCE' && ' · next step is yours: Share with client or Offer'}
                </p>
              )}
              <Button
                size="sm"
                variant="outline"
                className="mt-2 h-8 rounded-lg text-xs"
                onClick={() => setEditing(true)}
              >
                <RefreshCw className="size-3" aria-hidden /> Change decision
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* decision confirmation */}
      <AlertDialog open={confirmFor !== null} onOpenChange={(o) => !o && setConfirmFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmFor ? CONFIRM_COPY[confirmFor].title : ''}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmFor ? CONFIRM_COPY[confirmFor].body : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              className={cn('rounded-lg', confirmFor ? CONFIRM_COPY[confirmFor].ctaCls : '')}
              onClick={(e) => {
                e.preventDefault()
                if (confirmFor) void decide(confirmFor)
              }}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : (confirmFor ? CONFIRM_COPY[confirmFor].cta : 'Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
