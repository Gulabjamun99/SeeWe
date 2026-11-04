'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { format, formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  BadgeCheck,
  Bot,
  Briefcase,
  CheckCircle2,
  ClipboardList,
  Download,
  Eye,
  FileDown,
  FileText,
  History,
  Inbox,
  ListChecks,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  Mic,
  PartyPopper,
  RefreshCw,
  Scale,
  SearchX,
  Send,
  ShieldCheck,
  Sparkles,
  SquareCheckBig,
  Star,
  StickyNote,
  Timer,
  Video,
  Wallet,
  XCircle,
  XSquare,
  type LucideIcon,
} from 'lucide-react'
import { useAppStore, skillsToArray } from '@/store/app-store'
import { printElement } from '@/lib/print'
import { InterviewTranscript } from '@/components/seewee/interview/InterviewTranscript'
import { SkillBadge } from '@/components/seewee/SkillBadge'
import { ApplicationHistory } from './ApplicationHistory'
import { RecruiterFullProfile } from './RecruiterFullProfile'
import type { Application, Client, OnboardChecklistItem, ScreenSummary } from '@/lib/types'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

/* ---------------------------------- meta ---------------------------------- */

const STATUS_FILTERS = [
  'ALL',
  'APPLIED',
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'SHARED_WITH_CLIENT',
  'OFFERED',
  'HIRED',
  'ONBOARDED',
  'REJECTED',
] as const

const STATUS_META: Record<
  string,
  { label: string; cls: string; icon: LucideIcon }
> = {
  APPLIED: { label: 'Applied', cls: 'bg-slate-100 text-slate-700 dark:text-slate-300 border-slate-200', icon: FileText },
  SHORTLISTED: { label: 'Shortlisted', cls: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 border-amber-200', icon: Star },
  INTERVIEW_SCHEDULED: { label: 'AI Interview · live', cls: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 border-sky-200', icon: Mic },
  INTERVIEWED: { label: 'AI Interviewed', cls: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 border-blue-200', icon: Bot },
  SHARED_WITH_CLIENT: { label: 'Shared', cls: 'bg-sky-600 text-white border-sky-600', icon: Send },
  OFFERED: { label: 'Offer sent', cls: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 border-violet-300', icon: BadgeCheck },
  HIRED: { label: 'Hired', cls: 'bg-emerald-600 text-white border-emerald-600', icon: CheckCircle2 },
  ONBOARDED: { label: 'Onboarded 🎉', cls: 'bg-violet-600 text-white border-violet-600', icon: PartyPopper },
  REJECTED: { label: 'Rejected', cls: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 border-rose-200', icon: XCircle },
}

const AVATAR_STYLES = [
  'bg-blue-100 dark:bg-blue-900/40 text-blue-800',
  'bg-rose-100 dark:bg-rose-900/40 text-rose-800',
  'bg-amber-100 dark:bg-amber-900/40 text-amber-800',
  'bg-sky-100 dark:bg-sky-900/40 text-sky-800',
  'bg-lime-100 text-lime-800',
  'bg-cyan-100 text-cyan-800',
]

const PREF_KEY = 'seewee-client-pref'

interface ReportItem {
  interviewId: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
  company: string | null
  clientName: string | null
  clientEmail: string | null
  clientDecision?: string | null
  clientFeedback?: string | null
  overallScore: number | null
  verdict: string | null
  aiSummary: string
  completedAt: string | null
  /** per-question AI scores in qIndex order (additive from GET /api/interview/report) */
  questionScores?: (number | null)[]
}

/* --------------------------------- helpers -------------------------------- */

function readPref(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function writePref(map: Record<string, string>) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(map))
  } catch {
    /* storage full/unavailable — non fatal */
  }
}

function initials(name?: string | null): string {
  if (!name) return '?'
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

function pickAvatarStyle(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return AVATAR_STYLES[h % AVATAR_STYLES.length]
}

function matchPill(score?: number | null): { cls: string; label: string } {
  if (score == null) return { cls: 'border-slate-200 bg-slate-50 text-slate-400 dark:text-slate-500', label: 'No match data' }
  if (score >= 90) return { cls: 'border-blue-300 bg-blue-100 dark:bg-blue-900/40 text-blue-800', label: `${score}% match · excellent` }
  if (score >= 70) return { cls: 'border-blue-200 bg-blue-50 dark:bg-blue-950/40 text-blue-700', label: `${score}% match · strong` }
  if (score >= 40) return { cls: 'border-amber-200 bg-amber-50 dark:bg-amber-950/40 text-amber-700', label: `${score}% match` }
  if (score > 0) return { cls: 'border-rose-200 bg-rose-50 dark:bg-rose-950/40 text-rose-600', label: `${score}% match` }
  return { cls: 'border-slate-200 bg-slate-50 text-slate-500 dark:text-slate-400', label: 'Low skill overlap' }
}

/* ----------------------- AI screen dossier helpers ------------------------ */

const SCREEN_VERDICT_META: Record<string, { label: string; cls: string }> = {
  STRONG_FIT: {
    label: 'Strong fit',
    cls: 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700',
  },
  GOOD_FIT: {
    label: 'Good fit',
    cls: 'border-violet-300 bg-violet-50 dark:bg-violet-950/40 text-violet-700',
  },
  WEAK_FIT: {
    label: 'Weak fit',
    cls: 'border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-700',
  },
}

function parseScreenSummary(raw?: string | null): ScreenSummary | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ScreenSummary>
    if (!parsed || typeof parsed !== 'object' || typeof parsed.headline !== 'string') return null
    return {
      headline: parsed.headline,
      verdict:
        parsed.verdict === 'STRONG_FIT' || parsed.verdict === 'WEAK_FIT'
          ? parsed.verdict
          : 'GOOD_FIT',
      matchedSkills: Array.isArray(parsed.matchedSkills) ? parsed.matchedSkills : [],
      missingSkills: Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [],
      experienceFit: typeof parsed.experienceFit === 'string' ? parsed.experienceFit : '',
      screenNote: typeof parsed.screenNote === 'string' ? parsed.screenNote : '',
      flags: Array.isArray(parsed.flags) ? parsed.flags : [],
    }
  } catch {
    return null
  }
}

function parseChecklist(raw?: string | null): OnboardChecklistItem[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (i): i is OnboardChecklistItem =>
          !!i && typeof i === 'object' && typeof (i as OnboardChecklistItem).key === 'string'
      )
      .map((i) => ({
        key: i.key,
        label: typeof i.label === 'string' ? i.label : i.key,
        done: i.done === true,
        doneAt: typeof i.doneAt === 'string' ? i.doneAt : null,
      }))
  } catch {
    return []
  }
}

/** Internal parity check: flag when the AI screen verdict contradicts the
 * deterministic skill-match score — a human must look before deciding. */
function parityReview(verdict?: string | null, matchScore?: number | null): boolean {
  if (!verdict) return false
  const score = matchScore ?? 0
  return (
    (verdict === 'WEAK_FIT' && score >= 70) || (verdict === 'STRONG_FIT' && score < 40)
  )
}

function fmtLpaVal(v?: number | null): string {
  return v == null ? '—' : `₹${v} LPA`
}

/** 0 → "Immediate joiner", 30 → "30-day notice", null → "Notice n/a" */
function noticeLabel(days?: number | null): string {
  if (days == null) return 'Notice n/a'
  if (days === 0) return 'Immediate joiner'
  if (days % 7 === 0 && days >= 14 && days <= 90) {
    const w = Math.round(days / 7)
    return `${w}-week notice`
  }
  return `${days}-day notice`
}

function findReport(app: Application, reports: ReportItem[]): ReportItem | undefined {
  const email = app.candidate?.email
  const title = app.job?.title
  if (!email || !title) return undefined
  return reports.find((r) => r.candidateEmail === email && r.jobTitle === title)
}

/** Verified skill badge payload returned by GET /api/assessments?badgesOnly=1 */
interface CandidateBadge {
  domain: string
  badge: 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE'
  percentage: number
}

const MEDAL_BADGES: CandidateBadge['badge'][] = ['GOLD', 'SILVER', 'BRONZE']

/** Video-resume fields the recruiter-mode applications API adds for candidates who uploaded one */
type CandidateWithVideo = NonNullable<Application['candidate']> & {
  videoResumePath?: string | null
  videoResumeSeconds?: number | null
  videoResumeIntro?: string | null
}

/** 63 → "1:03" (video-resume duration chip) */
function fmtSecs(total: number): string {
  const s = Math.max(0, Math.round(total))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

interface InterviewState {
  stage: 'none' | 'progress' | 'done'
  score: number | null
  report?: ReportItem
}

function interviewState(app: Application, reports: ReportItem[]): InterviewState {
  const rep = findReport(app, reports)
  if (rep) return { stage: 'done', score: rep.overallScore ?? null, report: rep }
  if (app.status === 'INTERVIEW_SCHEDULED') return { stage: 'progress', score: null }
  if (['INTERVIEWED', 'SHARED_WITH_CLIENT', 'HIRED'].includes(app.status))
    return { stage: 'done', score: null }
  return { stage: 'none', score: null }
}

/* ------------------------------ the component ----------------------------- */

interface ApplicantsPanelProps {
  /** when dashboard requests "show applicants of job X", this fires */
  focusRequest?: { jobId: string; n: number } | null
  /** deep-linked application to spotlight (ring + scroll) */
  highlightId?: string | null
  /** tells the dashboard the spotlight has been shown */
  onHighlightDone?: () => void
}

const PAGE_SIZE = 5

export function ApplicantsPanel({ focusRequest, highlightId, onHighlightDone }: ApplicantsPanelProps) {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const setPendingFocus = useAppStore((s) => s.setPendingFocus)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [apps, setApps] = useState<Application[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [reports, setReports] = useState<ReportItem[]>([])

  const [jobFilter, setJobFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('ALL')
  // AI-ranked (matchScore desc, nulls last) vs chronological
  const [sortMode, setSortMode] = useState<'ranked' | 'newest'>('ranked')
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  // [build-batch-3] bulk actions — multi-select then shortlist/reject many at once
  const [bulkMode, setBulkMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // progressive disclosure: show the first PAGE_SIZE matches, reveal more on demand
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // dialogs
  const [shortlistFor, setShortlistFor] = useState<Application | null>(null)
  const [slChoice, setSlChoice] = useState('')
  const [picker, setPicker] = useState<{ app: Application; mode: 'share' } | null>(null)
  const [pickerChoice, setPickerChoice] = useState('')
  const [reportView, setReportView] = useState<ReportItem | null>(null)
  // which applicant card has its private-notes editor open
  const [notesOpenId, setNotesOpenId] = useState<string | null>(null)
  const [historyOpenId, setHistoryOpenId] = useState<string | null>(null)
  // which applicant card has its AI screen dossier / onboarding tracker open
  const [screenOpenId, setScreenOpenId] = useState<string | null>(null)
  const [authOpenId, setAuthOpenId] = useState<string | null>(null)
  const [onboardOpenId, setOnboardOpenId] = useState<string | null>(null)
  // video-resume preview dialog (streamed with this recruiter as viewerId)
  const [fullProfile, setFullProfile] = useState<{ id: string; name: string } | null>(null)
  const [videoPreview, setVideoPreview] = useState<{
    name: string
    path: string
    seconds: number | null
    intro: string | null
  } | null>(null)
  // offer dialog
  const [offerFor, setOfferFor] = useState<Application | null>(null)
  const [offerForm, setOfferForm] = useState({ salaryLpa: '', joiningDate: '', workMode: '' })
  const [offerBusy, setOfferBusy] = useState(false)

  const markBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const load = useCallback(async () => {
    if (!user || user.role !== 'RECRUITER') return
    setLoading(true)
    setError(null)
    try {
      const rid = encodeURIComponent(user.id)
      const [aRes, cRes, rRes] = await Promise.all([
        fetch(`/api/applications?recruiterId=${rid}`),
        fetch('/api/clients'),
        fetch(`/api/interview/report?recruiterId=${rid}`),
      ])
      const [aJson, cJson, rJson]: [
        { data?: Application[]; error?: string },
        { data?: Client[]; error?: string },
        { data?: ReportItem[]; error?: string },
      ] = await Promise.all([aRes.json(), cRes.json(), rRes.json()])

      if (!aRes.ok || aJson.error) throw new Error(aJson.error || 'Failed to load applications')
      setApps(aJson.data ?? [])
      setClients(cJson.data ?? [])
      setReports(rJson.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load pipeline')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  useEffect(() => {
    if (focusRequest) setJobFilter(focusRequest.jobId)
  }, [focusRequest])

  // filter changes reset progressive disclosure
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [jobFilter, statusFilter])

  /* ------------------------------ derived data ---------------------------- */

  const jobChips = useMemo(() => {
    const m = new Map<string, { id: string; title: string; count: number }>()
    for (const a of apps) {
      if (!a.job) continue
      const e = m.get(a.job.id) ?? { id: a.job.id, title: a.job.title, count: 0 }
      e.count++
      m.set(a.job.id, e)
    }
    return [...m.values()]
  }, [apps])

  const filtered = useMemo(() => {
    const list = apps.filter(
      (a) =>
        (jobFilter === 'all' || a.jobId === jobFilter) &&
        (statusFilter === 'ALL' || a.status === statusFilter)
    )
    if (sortMode === 'newest') {
      return [...list].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
    }
    // AI-ranked: deterministic skill-match score desc, unscreened (nulls) last
    return [...list].sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1))
  }, [apps, jobFilter, statusFilter, sortMode])

  const hasPendingPipeline = useMemo(
    () =>
      filtered.some((a) => ['APPLIED', 'SHORTLISTED', 'INTERVIEW_SCHEDULED'].includes(a.status)),
    [filtered]
  )

  /* ------------------------- verified skill badges ------------------------- */
  // One batched lookup for the distinct candidates in the visible page
  // (debounced, failure-safe): badges are additive decoration only.
  const [badgesByUser, setBadgesByUser] = useState<Record<string, CandidateBadge[]>>({})
  const visibleApps = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])
  const visibleCandidateIdsKey = useMemo(
    () => [...new Set(visibleApps.map((a) => a.candidateId))].join(','),
    [visibleApps]
  )

  useEffect(() => {
    if (!user || user.role !== 'RECRUITER') return
    const ids = visibleCandidateIdsKey.split(',').filter(Boolean).slice(0, 60)
    if (ids.length === 0) return
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/assessments?candidateIds=${encodeURIComponent(ids.join(','))}&badgesOnly=1&recruiterId=${encodeURIComponent(user.id)}`
          )
          const json: { byUser?: Record<string, CandidateBadge[]>; error?: string } = await res.json()
          if (!res.ok || json.error || !json.byUser) return
          setBadgesByUser((prev) => ({ ...prev, ...json.byUser }))
        } catch {
          /* badges are optional — never break the applicants list */
        }
      })()
    }, 300)
    return () => clearTimeout(t)
  }, [visibleCandidateIdsKey, user])

  // 🔔 deep-link spotlight: make sure the target is rendered, scroll to it, glow, let go
  useEffect(() => {
    if (!highlightId) return
    const idx = filtered.findIndex((a) => a.id === highlightId)
    if (idx >= visibleCount) setVisibleCount(idx + 1)
    const scrollT = setTimeout(() => {
      document
        .getElementById(`application-card-${highlightId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 400)
    const clearT = setTimeout(() => onHighlightDone?.(), 3400)
    return () => {
      clearTimeout(scrollT)
      clearTimeout(clearT)
    }
  }, [highlightId])

  /* -------------------------------- actions ------------------------------- */

  /** First-engagement signal: shortlist / interview / share / notes all count
   * as "recruiter viewed" for the candidate's application tracker. One-way,
   * idempotent (server keeps the first timestamp). */
  const ensureViewed = useCallback(
    (app: Application) => {
      if (!user || user.role !== 'RECRUITER' || app.viewedAt) return
      void (async () => {
        try {
          const res = await fetch(`/api/applications/${app.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ markViewed: true, recruiterId: user.id }),
          })
          if (!res.ok) return
          const viewedAt = new Date().toISOString()
          setApps((prev) =>
            prev.map((a) => (a.id === app.id ? { ...a, viewedAt } : a))
          )
        } catch {
          /* signal only — never block the recruiter's actual action */
        }
      })()
    },
    [user]
  )

  const patchStatus = async (app: Application, status: string) => {
    ensureViewed(app)
    markBusy(app.id, true)
    try {
      const res = await fetch(`/api/applications/${app.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json: { error?: string; emailQueued?: { to: string } } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Update failed')
      // Surface the automatic candidate email so the recruiter knows the
      // candidate was told about this step at their registered address.
      if (json.emailQueued?.to) {
        toast.info(`📧 Email sent to ${json.emailQueued.to}`, { description: 'The candidate was notified about this update.' })
      }
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update candidate')
      return false
    } finally {
      markBusy(app.id, false)
    }
  }

  const confirmShortlist = async () => {
    if (!shortlistFor) return
    const app = shortlistFor
    setShortlistFor(null)
    if (slChoice && clients.some((c) => c.id === slChoice)) {
      const pref = readPref()
      pref[app.id] = slChoice
      writePref(pref)
    }
    if (await patchStatus(app, 'SHORTLISTED')) {
      toast.success(`⭐ ${app.candidate?.name ?? 'Candidate'} shortlisted`)
      bumpRefresh()
    }
  }

  /** Shortlist entry point. In-house model: the report destination is ALWAYS
   *  the recruiter's own company portal, so linked recruiters skip the
   *  "pick a client" dialog entirely (one click to shortlist). */
  const requestShortlist = async (app: Application) => {
    if (user?.clientId) {
      if (await patchStatus(app, 'SHORTLISTED')) {
        toast.success(`⭐ ${app.candidate?.name ?? 'Candidate'} shortlisted`)
        bumpRefresh()
      }
      return
    }
    setSlChoice('')
    setShortlistFor(app)
  }

  /**
   * Send (or re-send) the AI interview invite to the CANDIDATE. The recruiter
   * never takes the AI interview themselves — they authored the questions on
   * the job, and this hands the room to the candidate via email + notification.
   */
  const sendInvite = async (app: Application) => {
    markBusy(app.id, true)
    try {
      const res = await fetch('/api/interview/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: app.id }),
      })
      const json: {
        data?: { alreadyExisted?: boolean; resent?: boolean }
        error?: string
      } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Invite failed')
      const name = app.candidate?.name ?? 'candidate'
      if (json.data?.alreadyExisted || json.data?.resent) {
        toast.success(`Invite re-sent to ${name} — they can take the interview from their dashboard.`)
      } else {
        toast.success(`✉️ AI interview invite sent to ${name} — it lands in their email + notifications.`)
      }
      bumpRefresh()
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the invite')
    } finally {
      markBusy(app.id, false)
    }
  }

  /** Picker dialog confirm — share destination only (interviews are invited,
   *  never "started" from the recruiter side). */
  const confirmPicker = () => {
    if (!picker) return
    const { app } = picker
    setPicker(null)
    void doShare(app, pickerChoice)
  }

  const requestShare = (app: Application) => {
    ensureViewed(app)
    // In-house default: reports go straight to the recruiter's OWN company
    // partner portal — one click, no destination hunting.
    if (user?.clientId) {
      void doShare(app, user.clientId)
      return
    }
    const prefId = readPref()[app.id]
    const existingClientId = app.shortlists?.[0]?.clientId
    if (prefId) {
      void doShare(app, prefId)
      return
    }
    if (existingClientId) {
      void doShare(app, existingClientId)
      return
    }
    setPickerChoice('')
    setPicker({ app, mode: 'share' })
  }

  const doShare = async (app: Application, clientId: string) => {
    if (!clientId) {
      toast.error('Pick a client first so the report lands somewhere useful.')
      return
    }
    const clientName = clients.find((c) => c.id === clientId)?.name ?? 'client'
    markBusy(app.id, true)
    try {
      const shortlistId = app.shortlists?.[0]?.id ?? app.id
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortlistId, clientId, applicationId: app.id }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Sharing failed')
      if (await patchStatus(app, 'SHARED_WITH_CLIENT')) {
        toast.success(`📤 AI report shared with the ${clientName} partner portal`)
        bumpRefresh()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not share report')
    } finally {
      markBusy(app.id, false)
    }
  }

  const rejectApplicant = async (app: Application) => {
    if (await patchStatus(app, 'REJECTED')) {
      toast.success(`${app.candidate?.name ?? 'Candidate'} moved out of the pipeline`)
      bumpRefresh()
    }
  }

  /* --------------------- [build-batch-3] bulk actions --------------------- */

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleSelectAllVisible = () => {
    const allSelected = visibleApps.length > 0 && visibleApps.every((a) => selectedIds.has(a.id))
    setSelectedIds(allSelected ? new Set() : new Set(visibleApps.map((a) => a.id)))
  }

  /** Deep-link into the Messages tab with this candidate's thread pre-opened. */
  const messageCandidate = (app: Application) => {
    if (!app.candidate?.id) return
    setPendingFocus({
      kind: 'messages',
      peerId: app.candidate.id,
      peerName: app.candidate.name ?? undefined,
    })
  }

  /** Bulk shortlist — every selected APPLIED application moves to SHORTLISTED. */
  const bulkShortlist = async () => {
    if (bulkBusy) return
    const targets = apps.filter((a) => selectedIds.has(a.id) && a.status === 'APPLIED')
    const skipped = selectedIds.size - targets.length
    if (targets.length === 0) {
      toast.info('Only APPLIED candidates can be shortlisted — selection adjusted.')
      return
    }
    setBulkBusy(true)
    let ok = 0
    for (const app of targets) {
      markBusy(app.id, true)
      try {
        const res = await fetch(`/api/applications/${app.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'SHORTLISTED' }),
        })
        const json: { error?: string } = await res.json()
        if (!res.ok || json.error) throw new Error(json.error || 'Update failed')
        ok += 1
      } catch (err) {
        toast.error(`${app.candidate?.name ?? 'Candidate'}: ${err instanceof Error ? err.message : 'failed'}`)
      } finally {
        markBusy(app.id, false)
      }
    }
    setBulkBusy(false)
    setSelectedIds(new Set())
    if (ok > 0) {
      toast.success(`⭐ ${ok} candidate${ok === 1 ? '' : 's'} shortlisted`)
      bumpRefresh()
      void load()
    }
    if (skipped > 0) toast.info(`${skipped} selection${skipped === 1 ? '' : 's'} skipped (already shortlisted or further along).`)
  }

  /** Bulk reject — every selected not-yet-terminal application moves to REJECTED. */
  const bulkReject = async () => {
    if (bulkBusy) return
    const targets = apps.filter(
      (a) => selectedIds.has(a.id) && !['REJECTED', 'HIRED', 'ONBOARDED'].includes(a.status)
    )
    if (targets.length === 0) {
      toast.info('Nothing to reject — selected candidates are already rejected or hired.')
      return
    }
    setBulkBusy(true)
    let ok = 0
    for (const app of targets) {
      markBusy(app.id, true)
      try {
        const res = await fetch(`/api/applications/${app.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'REJECTED' }),
        })
        const json: { error?: string } = await res.json()
        if (!res.ok || json.error) throw new Error(json.error || 'Update failed')
        ok += 1
      } catch (err) {
        toast.error(`${app.candidate?.name ?? 'Candidate'}: ${err instanceof Error ? err.message : 'failed'}`)
      } finally {
        markBusy(app.id, false)
      }
    }
    setBulkBusy(false)
    setSelectedIds(new Set())
    if (ok > 0) {
      toast.success(`${ok} candidate${ok === 1 ? '' : 's'} moved out of the pipeline`)
      bumpRefresh()
      void load()
    }
  }

  /* ------------------------------- derived -------------------------------- */

  /** Run (or force re-run) the AI screen; on success open the dossier. */
  const runScreen = async (app: Application, force: boolean) => {
    if (!user) return
    markBusy(app.id, true)
    try {
      const res = await fetch(`/api/applications/${app.id}/screen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, force }),
      })
      const json: { data?: ScreenSummary; cached?: boolean; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) throw new Error(json.error || 'AI screen failed')
      setApps((prev) =>
        prev.map((a) =>
          a.id === app.id
            ? { ...a, screenSummary: JSON.stringify(json.data), screenVerdict: json.data!.verdict }
            : a
        )
      )
      setScreenOpenId(app.id)
      if (force) toast.success('🔁 Screen re-run — dossier refreshed')
      else if (json.cached) toast.info('Screen note opened (already screened)')
      else toast.success('✨ AI screen ready')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not run the AI screen')
    } finally {
      markBusy(app.id, false)
    }
  }

  /** Run (or force re-run) the AI resume-authenticity scan (recruiter-only anti-fraud layer). */
  const runAuthenticity = async (app: Application, force: boolean) => {
    if (!user) return
    markBusy(app.id, true)
    try {
      const res = await fetch(`/api/applications/${app.id}/authenticity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, force }),
      })
      const json: { data?: unknown; cached?: boolean; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) throw new Error(json.error || 'Authenticity scan failed')
      const d = json.data as { score?: number; level?: string }
      setApps((prev) =>
        prev.map((a) =>
          a.id === app.id
            ? {
                ...a,
                authenticityCheck: JSON.stringify(json.data),
                authenticityScore: typeof d.score === 'number' ? d.score : null,
              }
            : a
        )
      )
      setAuthOpenId(app.id)
      if (force) toast.success('🔁 Trust scan re-run — result refreshed')
      else if (json.cached) toast.info('Trust scan opened (already scanned)')
      else toast.success(`🛡 Trust scan ready — ${d.level ?? 'result'} (${d.score ?? '–'}/100)`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not run the authenticity scan')
    } finally {
      markBusy(app.id, false)
    }
  }

  /** Prefill + open the offer dialog (salary from the job band, date +30d). */
  const openOfferDialog = (app: Application) => {
    const salaryMax = app.job?.salaryMaxLpa
    const salaryMin = app.job?.salaryMinLpa
    const prefill =
      salaryMax ??
      (salaryMin != null && salaryMax != null ? (salaryMin + salaryMax) / 2 : salaryMin) ??
      app.candidate?.expectedSalary ??
      null
    const d = new Date()
    d.setDate(d.getDate() + 30)
    setOfferForm({
      salaryLpa: prefill != null ? String(Math.round(prefill * 10) / 10) : '',
      joiningDate: format(d, 'yyyy-MM-dd'),
      workMode: app.job?.workMode || 'On-site',
    })
    setOfferFor(app)
  }

  const submitOffer = async () => {
    if (!offerFor || !user || offerBusy) return
    const salary = Number.parseFloat(offerForm.salaryLpa)
    if (!Number.isFinite(salary) || salary <= 0) {
      toast.error('Enter a valid salary in LPA')
      return
    }
    setOfferBusy(true)
    const app = offerFor
    try {
      const res = await fetch(`/api/applications/${app.id}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          userId: user.id,
          salaryLpa: salary,
          joiningDate: offerForm.joiningDate,
          workMode: offerForm.workMode,
        }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Could not send the offer')
      toast.success(
        `📨 Offer sent to ${app.candidate?.name ?? 'candidate'} — they'll accept or decline from their portal`
      )
      setOfferFor(null)
      bumpRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send the offer')
    } finally {
      setOfferBusy(false)
    }
  }

  /** Export the CURRENTLY FILTERED pipeline as a CSV file (Excel-friendly UTF-8) */
  const exportCsv = () => {
    const esc = (v: unknown): string => {
      const s = v == null ? '' : String(v)
      // quote when the value contains a quote / comma / newline; double inner quotes
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const header = [
      'Candidate',
      'Email',
      'Headline',
      'Job Title',
      'Company',
      'Status',
      'Match %',
      'Experience (yrs)',
      'Location',
      'Expected Salary (LPA)',
      'Notice Period',
      'Skills',
      'Cover Note',
      'Applied At',
      'Shared With Client',
      'AI Score (/10)',
      'AI Verdict',
      'Client Decision',
      'Q1 Score',
      'Q2 Score',
      'Q3 Score',
      'Q4 Score',
      'Q5 Score',
      'Q6 Score',
    ]
    const rows = filtered.map((app) => {
      const rep = findReport(app, reports)
      // pad per-question scores to a stable 6 columns (null → blank)
      const qScores = Array.from({ length: 6 }, (_, qi) => {
        const v = rep?.questionScores?.[qi]
        return typeof v === 'number' ? v : ''
      })
      return [
        app.candidate?.name ?? '',
        app.candidate?.email ?? '',
        app.candidate?.headline ?? '',
        app.job?.title ?? '',
        app.job?.company ?? '',
        STATUS_META[app.status]?.label ?? app.status,
        app.matchScore != null ? Math.round(app.matchScore) : '',
        app.candidate?.experienceYears ?? '',
        app.candidate?.location ?? '',
        app.candidate?.expectedSalary ?? '',
        app.candidate?.noticePeriodDays === 0
          ? 'Immediate'
          : (app.candidate?.noticePeriodDays ?? ''),
        skillsToArray(app.candidate?.skills).join('; '),
        app.coverNote ?? '',
        format(new Date(app.createdAt), 'yyyy-MM-dd HH:mm'),
        rep?.clientName ?? app.shortlists?.[0]?.client?.name ?? '',
        rep?.overallScore ?? (interviewState(app, reports).score ?? ''),
        rep?.verdict?.replace('_', ' ') ?? '',
        rep?.clientDecision?.replace('_', ' ') ?? app.shortlists?.[0]?.clientDecision?.replace('_', ' ') ?? '',
        ...qScores,
      ].map(esc)
    })

    const csv = ['\uFEFF' + header.map(esc).join(','), ...rows.map((r) => r.join(','))].join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `seewee-applicants-${format(new Date(), 'yyyy-MM-dd')}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`📥 Exported ${rows.length} applicant${rows.length === 1 ? '' : 's'} to CSV`)
  }

  /* --------------------------------- views -------------------------------- */

  if (loading) {
    return (
      <div className="space-y-4">
        <Card className="rounded-xl border-slate-200 dark:border-slate-800 p-4 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-32 rounded-full" />
            ))}
          </div>
        </Card>
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
            <CardContent className="flex gap-4 p-4">
              <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
                <div className="flex gap-1.5 pt-1">
                  <Skeleton className="h-5 w-14 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-12 rounded-full" />
                </div>
              </div>
              <div className="hidden w-40 space-y-2 sm:block">
                <Skeleton className="ml-auto h-6 w-24 rounded-full" />
                <Skeleton className="ml-auto h-8 w-full rounded-lg" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card className="rounded-xl border-rose-200 bg-rose-50/50 dark:bg-rose-950/40 shadow-sm">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <XCircle className="size-10 text-rose-400" aria-hidden />
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>
          <Button variant="outline" onClick={() => void load()} className="h-11 sm:h-9">
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <Card className="rounded-xl border-slate-200 dark:border-slate-800 p-3 shadow-sm sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
            <button
              type="button"
              onClick={() => setJobFilter('all')}
              aria-label="Show all jobs"
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                jobFilter === 'all'
                  ? 'border-transparent bg-blue-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 dark:text-slate-400 hover:border-blue-300 hover:text-blue-700'
              }`}
            >
              All jobs · {apps.length}
            </button>
            {jobChips.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => setJobFilter(j.id)}
                aria-label={`Show applicants for ${j.title}`}
                className={`max-w-[220px] shrink-0 truncate rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  jobFilter === j.id
                    ? 'border-transparent bg-blue-600 text-white shadow-sm'
                    : 'border-slate-200 bg-white text-slate-600 dark:text-slate-400 hover:border-blue-300 hover:text-blue-700'
                }`}
              >
                {j.title} · {j.count}
              </button>
            ))}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 self-start lg:self-auto">
            {/* Sort: AI-ranked (match % desc) vs newest */}
            <div
              role="group"
              aria-label="Sort applicants"
              className="flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800"
            >
              <button
                type="button"
                onClick={() => setSortMode('ranked')}
                aria-pressed={sortMode === 'ranked'}
                title="Sort by skill-match % (highest first)"
                className={`flex min-h-[44px] items-center gap-1 px-3 text-xs font-semibold transition-colors sm:min-h-[36px] ${
                  sortMode === 'ranked'
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-400 hover:text-violet-700'
                }`}
              >
                <Sparkles className="size-3.5" aria-hidden /> AI-ranked
              </button>
              <button
                type="button"
                onClick={() => setSortMode('newest')}
                aria-pressed={sortMode === 'newest'}
                title="Sort by application date (newest first)"
                className={`flex min-h-[44px] items-center gap-1 border-l border-slate-200 px-3 text-xs font-semibold transition-colors dark:border-slate-800 sm:min-h-[36px] ${
                  sortMode === 'newest'
                    ? 'bg-violet-600 text-white'
                    : 'bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-400 hover:text-violet-700'
                }`}
              >
                <Timer className="size-3.5" aria-hidden /> Newest
              </button>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger
                aria-label="Filter by application status"
                className="h-11 w-[190px] rounded-lg border-slate-200 dark:border-slate-800 sm:h-9"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === 'ALL' ? 'All statuses' : (STATUS_META[s]?.label ?? s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={bulkMode ? 'default' : 'ghost'}
              size="sm"
              onClick={() => {
                setBulkMode((v) => !v)
                setSelectedIds(new Set())
              }}
              aria-pressed={bulkMode}
              title={bulkMode ? 'Exit bulk selection' : 'Select multiple applicants to shortlist or reject together'}
              className={bulkMode
                ? 'h-11 gap-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 sm:h-9'
                : 'h-11 gap-1.5 rounded-lg px-2.5 text-slate-500 hover:text-blue-600 sm:h-9'}
            >
              <ListChecks className="size-4" aria-hidden />
              <span className="hidden md:inline">{bulkMode ? 'Selecting' : 'Bulk'}</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={exportCsv}
              disabled={filtered.length === 0}
              aria-label={`Export ${filtered.length} applicants as CSV`}
              title={`Export ${filtered.length} applicants as CSV`}
              className="min-w-[44px] p-2 text-slate-400 dark:text-slate-500 hover:text-blue-600 sm:min-w-[36px]"
            >
              <Download className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void load()}
              aria-label="Refresh applicants"
              className="min-w-[44px] p-2 text-slate-400 dark:text-slate-500 hover:text-blue-600 sm:min-w-[36px]"
            >
              <RefreshCw className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </Card>

      {/* [build-batch-3] Bulk selection action bar */}
      {bulkMode && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 dark:border-blue-900/70 bg-blue-50/70 dark:bg-blue-950/30 px-3 py-2.5"
          role="toolbar"
          aria-label="Bulk applicant actions"
        >
          <SquareCheckBig className="size-4 shrink-0 text-blue-600" aria-hidden />
          <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
            {selectedIds.size} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={toggleSelectAllVisible}
            className="h-11 rounded-lg border-blue-200 dark:border-blue-900 bg-white/70 text-blue-700 hover:bg-blue-100 sm:h-8"
          >
            {visibleApps.length > 0 && visibleApps.every((a) => selectedIds.has(a.id))
              ? 'Clear page'
              : 'Select page'}
          </Button>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={bulkBusy || selectedIds.size === 0}
              onClick={() => void bulkShortlist()}
              className="h-11 gap-1.5 rounded-lg border-amber-300 bg-amber-50 text-amber-800 shadow-none hover:bg-amber-100 sm:h-8"
              variant="outline"
            >
              {bulkBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Star className="size-4 text-amber-500" aria-hidden />}
              Shortlist selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkBusy || selectedIds.size === 0}
              onClick={() => void bulkReject()}
              className="h-11 gap-1.5 rounded-lg border-rose-200 bg-white text-rose-600 hover:bg-rose-50 sm:h-8"
            >
              {bulkBusy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <XSquare className="size-4" aria-hidden />}
              Reject selected
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={bulkBusy}
              onClick={() => setSelectedIds(new Set())}
              className="h-11 text-slate-500 hover:text-slate-700 sm:h-8"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Result list */}
      {filtered.length === 0 ? (
        apps.length === 0 ? (
          <Card className="rounded-xl border-dashed border-blue-300 bg-blue-50/40 dark:bg-blue-950/40 shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
                <Inbox className="size-7 text-blue-600" aria-hidden />
              </span>
              <p className="font-semibold text-slate-800 dark:text-slate-200">No applications yet</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Once candidates apply to your jobs they appear here — shortlist them, run an AI
                interview straight from their resume, and ship rated reports to your clients.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-xl border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
              <SearchX className="size-9 text-slate-400 dark:text-slate-500" aria-hidden />
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No candidates match these filters
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-11 sm:h-8"
                onClick={() => {
                  setJobFilter('all')
                  setStatusFilter('ALL')
                }}
              >
                Clear filters
              </Button>
            </CardContent>
          </Card>
        )
      ) : (
        <>
          <p className="px-1 text-xs text-muted-foreground">
            Showing <span className="font-semibold text-slate-700 dark:text-slate-300">{Math.min(visibleCount, filtered.length)}</span> of{' '}
            {filtered.length} matching · {apps.length} total
          </p>

          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            {filtered.slice(0, visibleCount).map((app) => {
              const cand = app.candidate
              const stMeta = STATUS_META[app.status] ?? STATUS_META.APPLIED
              const pill = matchPill(app.matchScore)
              const ivw = interviewState(app, reports)
              const sharedDone =
                app.status === 'SHARED_WITH_CLIENT' ||
                app.status === 'HIRED' ||
                app.shortlists?.[0]?.status === 'REPORT_SHARED'
              const sharedClientName =
                ivw.report?.clientName ?? app.shortlists?.[0]?.client?.name ?? null
              const busy = busyIds.has(app.id)
              const skills = skillsToArray(cand?.skills)
              const candVideo = cand as CandidateWithVideo | undefined
              const onboardItems = parseChecklist(app.onboardChecklist)

              return (
                <Card
                  key={app.id}
                  id={`application-card-${app.id}`}
                  className={`scroll-mt-24 rounded-xl border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:border-blue-200 hover:shadow-md ${
                    app.id === highlightId
                      ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-white shadow-lg shadow-blue-100'
                      : ''
                  } ${
                    busy ? 'opacity-60' : ''
                  }`}
                >
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row">
                      {/* left: identity */}
                      <div className="flex min-w-0 flex-1 gap-3">
                        <Avatar className="size-12 shrink-0 ring-2 ring-white">
                          <AvatarFallback
                            className={`${pickAvatarStyle(cand?.email ?? app.id)} font-semibold`}
                          >
                            {initials(cand?.name)}
                          </AvatarFallback>
                        </Avatar>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="truncate font-semibold text-slate-900 dark:text-slate-100">
                              {cand?.name ?? 'Unknown candidate'}
                            </p>
                            <Badge variant="outline" className={`${stMeta.cls} gap-1`}>
                              <stMeta.icon className="size-3" aria-hidden />
                              {stMeta.label}
                            </Badge>
                            {cand && (
                              <button
                                type="button"
                                onClick={() =>
                                  setFullProfile({ id: cand.id, name: cand.name ?? 'Candidate' })
                                }
                                className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/60"
                                aria-label={`View full profile of ${cand?.name ?? 'candidate'}`}
                              >
                                <Eye className="size-3" aria-hidden /> Full profile
                              </button>
                            )}
                          </div>

                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {cand?.headline || 'Open to opportunities'} · applying for{' '}
                            <span className="font-medium text-blue-700">
                              {app.job?.title ?? 'your role'}
                            </span>
                          </p>

                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Briefcase className="size-3.5 text-slate-400 dark:text-slate-500" aria-hidden />
                              {cand?.experienceYears != null
                                ? `${cand.experienceYears} yrs exp`
                                : 'Experience n/a'}
                            </span>
                            <span className="flex items-center gap-1">
                              <MapPin className="size-3.5 text-slate-400 dark:text-slate-500" aria-hidden />
                              {cand?.location || 'Location n/a'}
                            </span>
                            <span className="flex items-center gap-1">
                              <Wallet className="size-3.5 text-slate-400 dark:text-slate-500" aria-hidden />
                              Wants {fmtLpaVal(cand?.expectedSalary)}
                            </span>
                            <span
                              className={`flex items-center gap-1 ${
                                cand?.noticePeriodDays === 0 ? 'font-medium text-blue-700' : ''
                              }`}
                            >
                              <Timer className="size-3.5 text-slate-400 dark:text-slate-500" aria-hidden />
                              {noticeLabel(cand?.noticePeriodDays)}
                            </span>
                          </div>

                          {skills.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {skills.slice(0, 6).map((s) => (
                                <span
                                  key={s}
                                  className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-400"
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

                          {/* verified skill badges (candidate-consented, best per domain) */}
                          {(badgesByUser[cand?.id ?? ''] ?? [])
                            .filter((b) => MEDAL_BADGES.includes(b.badge)).length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {(badgesByUser[cand?.id ?? ''] ?? [])
                                .filter((b) => MEDAL_BADGES.includes(b.badge))
                                .slice(0, 3)
                                .map((b) => (
                                  <SkillBadge key={b.domain} badge={b.badge} domain={b.domain} size="xs" />
                                ))}
                            </div>
                          )}

                          {/* video resume chip — only when the candidate added one */}
                          {candVideo?.videoResumePath && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setVideoPreview({
                                    name: candVideo.name ?? 'Candidate',
                                    path: candVideo.videoResumePath!,
                                    seconds: candVideo.videoResumeSeconds ?? null,
                                    intro: candVideo.videoResumeIntro ?? null,
                                  })
                                }
                                aria-label={`Play ${candVideo.name ?? 'candidate'}'s video resume`}
                                className="inline-flex min-h-[26px] items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-700 ring-1 ring-inset ring-violet-200/70 transition-colors hover:bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 dark:ring-violet-900 dark:hover:bg-violet-900/60"
                              >
                                <Video className="size-3.5" aria-hidden />
                                Video
                                {candVideo.videoResumeSeconds != null &&
                                  ` · ${fmtSecs(candVideo.videoResumeSeconds)}`}
                              </button>
                            </div>
                          )}

                          {app.coverNote && (
                            <blockquote className="mt-2.5 rounded-r-lg border-l-2 border-blue-300 bg-blue-50/40 py-1.5 pl-3 pr-2 text-xs italic text-slate-600 dark:text-slate-400">
                              “{app.coverNote}”
                            </blockquote>
                          )}

                          {/* 📎 CV attached to this application — the exact
                              document the candidate applied with */}
                          {app.cvFileName && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                              <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                <FileText className="size-3.5 shrink-0 text-blue-600" aria-hidden />
                                <span className="max-w-[180px] truncate">{app.cvFileName}</span>
                              </span>
                              <a
                                href={`/api/applications/${app.id}/cv?inline=1`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-900/40"
                                aria-label={`View CV ${app.cvFileName}`}
                              >
                                <Eye className="size-3.5" aria-hidden /> View CV
                              </a>
                              <a
                                href={`/api/applications/${app.id}/cv`}
                                className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                                aria-label={`Download CV ${app.cvFileName}`}
                              >
                                <Download className="size-3.5" aria-hidden /> Download
                              </a>
                            </div>
                          )}
                          {!app.cvFileName && cand?.cvFileName && (
                            <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                              No CV snapshot on this application — candidate's latest CV:{' '}
                              <a
                                href={`/api/candidates/${cand.id}/cv?inline=1&requesterId=${encodeURIComponent(user?.id ?? '')}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold underline underline-offset-2"
                              >
                                {cand.cvFileName}
                              </a>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* right: match + actions */}
                      <div className="flex shrink-0 flex-col items-stretch gap-2 sm:w-52 sm:items-end">
                        <Badge
                          variant="outline"
                          className={`${pill.cls} justify-center px-3 py-1 text-xs font-semibold sm:self-end`}
                        >
                          🎯 {pill.label}
                        </Badge>

                        <div className="mt-1 flex flex-wrap gap-2 sm:flex-col sm:items-end sm:gap-2">
                          {/* [build-batch-3] bulk-select checkbox (Bulk mode only) */}
                          {bulkMode && (
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={selectedIds.has(app.id)}
                              aria-label={`Select ${cand?.name ?? 'candidate'} for bulk action`}
                              onClick={() => toggleSelect(app.id)}
                              className={`flex h-11 min-w-[100px] items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors sm:h-9 sm:min-w-[110px] ${
                                selectedIds.has(app.id)
                                  ? 'border-blue-600 bg-blue-600 text-white'
                                  : 'border-slate-300 dark:border-slate-700 bg-white text-slate-600 dark:bg-slate-900 dark:text-slate-300 hover:border-blue-400'
                              }`}
                            >
                              {selectedIds.has(app.id) ? (
                                <SquareCheckBig className="size-4" aria-hidden />
                              ) : (
                                <span className="size-4 rounded-sm border-2 border-current" aria-hidden />
                              )}
                              {selectedIds.has(app.id) ? 'Selected' : 'Select'}
                            </button>
                          )}

                          {/* ✨ AI screen — recruiter-only dossier (never candidate-facing) */}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              ensureViewed(app)
                              if (app.screenSummary) {
                                setScreenOpenId(screenOpenId === app.id ? null : app.id)
                              } else {
                                void runScreen(app, false)
                              }
                            }}
                            aria-expanded={screenOpenId === app.id}
                            aria-label={
                              app.screenSummary
                                ? `Open AI screen note for ${cand?.name ?? 'candidate'}`
                                : `Run AI screen for ${cand?.name ?? 'candidate'}`
                            }
                            className="h-11 min-w-[120px] rounded-lg border-violet-200 dark:border-violet-900/70 text-violet-700 hover:bg-violet-50 sm:h-9 sm:min-w-[130px]"
                          >
                            {busy ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden />
                            ) : (
                              <Sparkles className="size-4" aria-hidden />
                            )}
                            {app.screenSummary ? 'Screen note' : 'AI Screen'}
                          </Button>

                          {/* 🛡 Authenticity scan — anti-fraud trust layer (recruiter-only) */}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => {
                              ensureViewed(app)
                              if (app.authenticityCheck) {
                                setAuthOpenId(authOpenId === app.id ? null : app.id)
                              } else {
                                void runAuthenticity(app, false)
                              }
                            }}
                            aria-expanded={authOpenId === app.id}
                            aria-label={
                              app.authenticityCheck
                                ? `Open authenticity scan for ${cand?.name ?? 'candidate'}`
                                : `Run authenticity scan for ${cand?.name ?? 'candidate'}`
                            }
                            className="h-11 min-w-[120px] rounded-lg border-emerald-200 dark:border-emerald-900/70 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 sm:h-9 sm:min-w-[130px]"
                          >
                            {busy ? (
                              <Loader2 className="size-4 animate-spin" aria-hidden />
                            ) : (
                              <ShieldCheck className="size-4" aria-hidden />
                            )}
                            {app.authenticityCheck
                              ? `Trust ${app.authenticityScore ?? ''}`.trim()
                              : 'Trust scan'}
                          </Button>

                          {(app.status === 'APPLIED' || app.status === 'REJECTED') && (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => void requestShortlist(app)}
                              className="h-11 min-w-[140px] rounded-lg border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-800 shadow-none hover:bg-amber-100 sm:h-9 sm:min-w-[150px]"
                              variant="outline"
                              aria-label={`Shortlist ${cand?.name ?? 'candidate'}`}
                            >
                              <Star className="size-4 text-amber-500" aria-hidden /> Shortlist ★
                            </Button>
                          )}

                          {(app.status === 'APPLIED' || app.status === 'SHORTLISTED') &&
                            app.job?.aiInterviewEnabled && (
                              <Button
                                size="sm"
                                disabled={busy}
                                onClick={() => void sendInvite(app)}
                                className="h-11 min-w-[170px] rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-md transition-all hover:from-blue-700 hover:to-sky-600 hover:shadow-lg sm:h-9 sm:min-w-[180px]"
                                aria-label={`Send the AI interview invite to ${cand?.name ?? 'candidate'}`}
                              >
                                <Mail className="size-4" aria-hidden /> Send AI Invite ✉️
                              </Button>
                            )}

                          {/* AI screening OFF for this job → skip the AI round;
                              a shortlisted profile can go straight to the client */}
                          {app.status === 'SHORTLISTED' && !app.job?.aiInterviewEnabled && (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => requestShare(app)}
                              className="h-11 min-w-[150px] rounded-lg bg-sky-600 text-white shadow-md hover:bg-sky-700 sm:h-9 sm:min-w-[160px]"
                              aria-label={`Share ${cand?.name ?? 'candidate'} with a client`}
                            >
                              <Send className="size-4" aria-hidden /> Share Profile →
                            </Button>
                          )}

                          {app.status === 'INTERVIEW_SCHEDULED' &&
                            (app.shortlists?.[0]?.interview?.status === 'IN_PROGRESS' ? (
                              <Badge
                                variant="outline"
                                className="justify-center border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/40 px-3 py-1.5 text-xs font-semibold text-blue-700"
                              >
                                <span className="mr-1 size-1.5 animate-pulse rounded-full bg-blue-500" aria-hidden />
                                Candidate is taking the AI interview…
                              </Badge>
                            ) : (
                              <>
                                <Badge
                                  variant="outline"
                                  className="justify-center border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 px-3 py-1.5 text-xs font-semibold text-amber-700"
                                >
                                  ✉️ Invite sent · waiting for candidate
                                </Badge>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => void sendInvite(app)}
                                  className="h-11 min-w-[130px] rounded-lg border-blue-200 dark:border-blue-900/70 text-blue-700 hover:bg-blue-50 sm:h-9 sm:min-w-[140px]"
                                  aria-label={`Re-send the AI interview invite to ${cand?.name ?? 'candidate'}`}
                                >
                                  <RefreshCw className="size-4" aria-hidden /> Resend invite
                                </Button>
                              </>
                            ))}

                          {(app.status === 'INTERVIEWED' || ivw.stage === 'done') &&
                            app.status !== 'SHARED_WITH_CLIENT' &&
                            app.status !== 'HIRED' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => setReportView(ivw.report ?? null)}
                                  className="h-11 min-w-[140px] rounded-lg border-blue-200 dark:border-blue-900/70 text-blue-700 hover:bg-blue-50 sm:h-9 sm:min-w-[150px]"
                                  aria-label={`View AI report for ${cand?.name ?? 'candidate'}`}
                                >
                                  <Bot className="size-4" aria-hidden /> View AI Report
                                </Button>
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => requestShare(app)}
                                  className="h-11 min-w-[140px] rounded-lg bg-sky-600 text-white hover:bg-sky-700 sm:h-9 sm:min-w-[150px]"
                                  aria-label={`Share AI report for ${cand?.name ?? 'candidate'} with client`}
                                >
                                  <Send className="size-4" aria-hidden /> Share Report →
                                </Button>
                              </>
                            )}

                          {/* 📨 Offer flow — interviewed / client-approved candidates */}
                          {(app.status === 'INTERVIEWED' || app.status === 'SHARED_WITH_CLIENT') && (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => openOfferDialog(app)}
                              className="h-11 min-w-[140px] rounded-lg bg-gradient-to-r from-violet-600 to-purple-500 text-white shadow-md transition-all hover:from-violet-700 hover:to-purple-600 hover:shadow-lg sm:h-9 sm:min-w-[150px]"
                              aria-label={`Send offer to ${cand?.name ?? 'candidate'}`}
                            >
                              <BadgeCheck className="size-4" aria-hidden /> Send offer
                            </Button>
                          )}

                          {app.status === 'OFFERED' && (
                            <Badge
                              variant="outline"
                              className="justify-center border-violet-300 bg-violet-50 dark:bg-violet-950/40 px-3 py-1 text-xs font-semibold text-violet-700"
                            >
                              ⏳ Awaiting candidate response
                            </Badge>
                          )}

                          {/* 🧭 Onboarding tracker — appears once the offer is accepted */}
                          {(app.status === 'HIRED' || app.status === 'ONBOARDED') && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => setOnboardOpenId(onboardOpenId === app.id ? null : app.id)}
                              aria-expanded={onboardOpenId === app.id}
                              aria-label={`Onboarding tracker for ${cand?.name ?? 'candidate'}`}
                              className="h-11 min-w-[120px] rounded-lg border-emerald-200 dark:border-emerald-900/70 text-emerald-700 hover:bg-emerald-50 sm:h-9 sm:min-w-[130px]"
                            >
                              <ClipboardList className="size-4" aria-hidden /> Onboarding
                              {onboardItems.length > 0 && (
                                <span className="text-[10px] font-bold text-emerald-600">
                                  {onboardItems.filter((i) => i.done).length}/{onboardItems.length}
                                </span>
                              )}
                            </Button>
                          )}

                          {!['REJECTED', 'HIRED', 'ONBOARDED'].includes(app.status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => void rejectApplicant(app)}
                              className="h-11 min-w-[100px] rounded-lg text-rose-600 dark:text-rose-300 hover:bg-rose-50 hover:text-rose-700 sm:h-8"
                              aria-label={`Reject ${cand?.name ?? 'candidate'}`}
                            >
                              <XCircle className="size-4" aria-hidden /> Reject
                            </Button>
                          )}

                          {/* [build-batch-3] direct 1:1 chat — opens the Messages tab
                              with this candidate's thread pre-opened */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => messageCandidate(app)}
                            className="h-11 min-w-[100px] rounded-lg text-teal-600 dark:text-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:hover:bg-teal-950/40 sm:h-8"
                            aria-label={`Message ${cand?.name ?? 'candidate'}`}
                          >
                            <MessageSquare className="size-4" aria-hidden /> Message
                          </Button>

                          {/* private ATS notes — opening counts as "viewed" */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const next = notesOpenId === app.id ? null : app.id
                              setNotesOpenId(next)
                              if (next) ensureViewed(app)
                            }}
                            aria-expanded={notesOpenId === app.id}
                            aria-label={`Private notes for ${cand?.name ?? 'candidate'}`}
                            className="relative h-11 min-w-[100px] rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-blue-700 sm:h-8"
                          >
                            <StickyNote className="size-4" aria-hidden /> Notes
                            {app.notes && notesOpenId !== app.id && (
                              <span
                                className="absolute right-2 top-2 size-2 rounded-full bg-blue-500 sm:right-1.5"
                                aria-hidden
                                title="Note saved"
                              />
                            )}
                          </Button>

                          {/* §10 stage-history timeline toggle */}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setHistoryOpenId(historyOpenId === app.id ? null : app.id)
                            }
                            aria-expanded={historyOpenId === app.id}
                            aria-label={`Stage history for ${cand?.name ?? 'candidate'}`}
                            className="h-11 min-w-[104px] rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 hover:text-blue-700 sm:h-8"
                          >
                            <History className="size-4" aria-hidden /> History
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* mini timeline */}
                    {(app.shortlists?.length ?? 0) > 0 ||
                    ivw.stage !== 'none' ||
                    ['INTERVIEW_SCHEDULED', 'INTERVIEWED', 'SHARED_WITH_CLIENT', 'HIRED'].includes(
                      app.status
                    ) ? (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-dashed border-slate-100 dark:border-slate-800/60 pt-3">
                        <ClipboardList
                          className="mr-1 size-3.5 text-slate-300"
                          aria-hidden
                        />
                        <TimelineChip
                          done={
                            (app.shortlists?.length ?? 0) > 0 ||
                            ['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'SHARED_WITH_CLIENT', 'HIRED'].includes(
                              app.status
                            )
                          }
                          label="Shortlisted"
                        />
                        <ChevronSep />
                        <TimelineChip
                          done={ivw.stage === 'done'}
                          progress={ivw.stage === 'progress'}
                          label={
                            ivw.score != null
                              ? `AI Interview ${ivw.score}/10`
                              : ivw.stage === 'progress'
                                ? 'AI Interview running…'
                                : 'AI Interview'
                          }
                        />
                        <ChevronSep />
                        <TimelineChip
                          done={!!sharedDone}
                          label={sharedClientName ? `Shared · ${sharedClientName}` : 'Shared'}
                        />
                        {(() => {
                          const dec =
                            ivw.report?.clientDecision ?? app.shortlists?.[0]?.clientDecision ?? null
                          if (!dec) return null
                          const map: Record<string, { label: string; cls: string; icon: string }> = {
                            APPROVED: { label: 'Client approved ✓', cls: 'border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-700', icon: '👍' },
                            ON_HOLD: { label: 'Client on hold', cls: 'border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-700', icon: '⏸' },
                            REJECTED: { label: 'Client declined', cls: 'border-rose-300 bg-rose-50 dark:bg-rose-950/40 text-rose-600', icon: '👎' },
                          }
                          const m = map[dec]
                          if (!m) return null
                          return (
                            <>
                              <ChevronSep />
                              <span
                                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${m.cls}`}
                              >
                                {m.icon} {m.label}
                              </span>
                            </>
                          )
                        })()}
                      </div>
                    ) : null}

                    {/* private ATS notes editor */}
                    {notesOpenId === app.id && (
                      <ApplicantNotes
                        app={app}
                        recruiterId={user?.id ?? ''}
                        onSaved={(notes) =>
                          setApps((prev) =>
                            prev.map((a) => (a.id === app.id ? { ...a, notes } : a))
                          )
                        }
                      />
                    )}

                    {/* §10 stage-history audit timeline (recruiter = full trail) */}
                    {historyOpenId === app.id && (
                      <ApplicationHistory applicationId={app.id} viewerId={user?.id ?? ''} />
                    )}

                    {/* ✨ AI screen dossier — recruiter-only, includes the parity check */}
                    {screenOpenId === app.id && (
                      <ScreenDossier app={app} busy={busy} onRerun={() => void runScreen(app, true)} />
                    )}

                    {/* 🛡 Authenticity dossier — anti-fraud scan result (recruiter-only) */}
                    {authOpenId === app.id && (
                      <AuthenticityPanel
                        app={app}
                        busy={busy}
                        onRerun={() => void runAuthenticity(app, true)}
                      />
                    )}

                    {/* 🧭 Onboarding tracker — unlocked once the offer is accepted */}
                    {(app.status === 'HIRED' || app.status === 'ONBOARDED') &&
                      onboardOpenId === app.id && (
                        <OnboardingSection
                          app={app}
                          recruiterId={user?.id ?? ''}
                          onUpdated={(updated) =>
                            setApps((prev) =>
                              prev.map((a) => (a.id === updated.id ? updated : a))
                            )
                          }
                        />
                      )}
                  </CardContent>
                </Card>
              )
            })}
          </motion.div>

          {/* Progressive disclosure */}
          {visibleCount < filtered.length && (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-10 min-h-[40px] gap-1.5 rounded-full border-blue-200 dark:border-blue-900/70 px-5 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more applicant
                {filtered.length - visibleCount === 1 ? '' : 's'}
                <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                  ({filtered.length - visibleCount} left)
                </span>
              </Button>
            </div>
          )}
        </>
      )}

      {/* Shortlist dialog */}
      <Dialog
        open={!!shortlistFor}
        onOpenChange={(open) => {
          if (!open) setShortlistFor(null)
        }}
      >
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Star className="size-4 text-amber-500" aria-hidden /> Shortlist{' '}
              {shortlistFor?.candidate?.name}
            </DialogTitle>
            <DialogDescription>
              Pick the client who should receive this candidate&apos;s AI report once the interview
              completes. You can change it later.
            </DialogDescription>
          </DialogHeader>

          <RadioGroup value={slChoice} onValueChange={setSlChoice} className="max-h-64 space-y-1 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
            <Label
              htmlFor="cl-none"
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40 has-[button[data-state=checked]]:border-blue-400 has-[button[data-state=checked]]:bg-blue-50"
            >
              <RadioGroupItem id="cl-none" value="" className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">Skip — decide later</span>
                <span className="text-xs text-muted-foreground">
                  You can attach a client before sharing the report.
                </span>
              </span>
            </Label>

            {clients.map((c) => (
              <Label
                key={c.id}
                htmlFor={`cl-${c.id}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40 has-[button[data-state=checked]]:border-blue-400 has-[button[data-state=checked]]:bg-blue-50"
              >
                <RadioGroupItem id={`cl-${c.id}`} value={c.id} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.contactEmail}</span>
                </span>
              </Label>
            ))}

            {clients.length === 0 && (
              <p className="rounded-lg bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-800">
                No clients registered yet — add one from the Clients tab, or just skip for now.
              </p>
            )}
          </RadioGroup>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShortlistFor(null)} className="h-11 sm:h-9">
              Cancel
            </Button>
            <Button
              onClick={() => void confirmShortlist()}
              className="h-11 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white hover:from-blue-700 hover:to-sky-600 sm:h-9"
            >
              <Star className="size-4" aria-hidden /> Shortlist candidate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Client picker before interview/share */}
      <Dialog
        open={!!picker}
        onOpenChange={(open) => {
          if (!open) setPicker(null)
        }}
      >
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="size-4 text-sky-600" aria-hidden /> Share with client
            </DialogTitle>
            <DialogDescription>
              Choose which client receives{' '}
              <span className="font-medium text-slate-700 dark:text-slate-300">
                {picker?.app.candidate?.name}&apos;s
              </span>{' '}
              profile{picker?.app.job?.aiInterviewEnabled ? ' and rated AI report' : ''}. Skipping
              keeps it private to you.
            </DialogDescription>
          </DialogHeader>

          <RadioGroup value={pickerChoice} onValueChange={setPickerChoice} className="max-h-64 space-y-1 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
            <Label
              htmlFor="pk-none"
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40 has-[button[data-state=checked]]:border-blue-400 has-[button[data-state=checked]]:bg-blue-50"
            >
              <RadioGroupItem id="pk-none" value="" className="mt-0.5" />
              <span className="grid gap-0.5">
                <span className="text-sm font-medium">Skip — keep private</span>
                <span className="text-xs text-muted-foreground">
                  The profile stays visible only to you.
                </span>
              </span>
            </Label>

            {clients.map((c) => (
              <Label
                key={c.id}
                htmlFor={`pk-${c.id}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 dark:border-slate-800 p-3 transition-colors hover:border-blue-300 hover:bg-blue-50/40 has-[button[data-state=checked]]:border-blue-400 has-[button[data-state=checked]]:bg-blue-50"
              >
                <RadioGroupItem id={`pk-${c.id}`} value={c.id} className="mt-0.5" />
                <span className="grid gap-0.5">
                  <span className="text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.contactEmail}</span>
                </span>
              </Label>
            ))}
          </RadioGroup>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPicker(null)} className="h-11 sm:h-9">
              Cancel
            </Button>
            <Button
              onClick={confirmPicker}
              className="h-11 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white hover:from-blue-700 hover:to-sky-600 sm:h-9"
            >
              <Send className="size-4" aria-hidden /> Share →
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Report viewer */}
      <Dialog
        open={!!reportView}
        onOpenChange={(open) => {
          if (!open) setReportView(null)
        }}
      >
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="size-5 text-blue-600" aria-hidden /> AI Interview Report
            </DialogTitle>
            <DialogDescription>
              {reportView?.candidateName} · {reportView?.jobTitle}
            </DialogDescription>
          </DialogHeader>

          {reportView && (
            <div id="seewee-report-dialog-print" className="space-y-3">
              {/* print-only branded header */}
              <div className="hidden items-center justify-between border-b-2 border-blue-600 pb-3 [@media_print]:flex">
                <div className="flex items-center gap-2">
                  <img src="/seewee-logo.png" alt="SeeWe" className="h-8 w-auto rounded-md" />
                  <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                    AI Interview Report
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  {reportView.candidateName} · {reportView.jobTitle} · Confidential
                </p>
              </div>

              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-800/60 p-3">
                <VerdictRing score={reportView.overallScore} verdict={reportView.verdict} />
                <div className="grid gap-1 text-sm">
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Overall score {reportView.overallScore != null ? `${reportView.overallScore}/10` : '—'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Completed{' '}
                    {reportView.completedAt
                      ? format(new Date(reportView.completedAt), 'MMM d, yyyy · hh:mm a')
                      : 'recently'}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border-l-4 border-blue-400 bg-blue-50/50 dark:bg-blue-950/40 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-blue-700">
                  AI Summary
                </p>
                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">{reportView.aiSummary}</p>
              </div>

              <InterviewTranscript interviewId={reportView.interviewId} compact viewerId={user?.id} />

              {reportView.clientName == null && (
                <p className="text-xs text-muted-foreground">
                  💡 Not shared yet — hit “Share Report” to send this to the intended client.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                printElement('seewee-report-dialog-print', {
                  title: `SeeWe AI Report — ${reportView?.candidateName ?? 'candidate'} — ${reportView?.jobTitle ?? 'role'}`,
                })
              }
              className="h-11 gap-1.5 sm:h-9"
              aria-label="Download this AI report as PDF via the print dialog"
            >
              <FileDown className="size-4 text-blue-600" aria-hidden /> Download PDF
            </Button>
            <Button
              variant="outline"
              data-print-hide
              onClick={() => setReportView(null)}
              className="h-11 sm:h-9"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send offer dialog */}
      <Dialog
        open={!!offerFor}
        onOpenChange={(open) => {
          if (!open) setOfferFor(null)
        }}
      >
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BadgeCheck className="size-5 text-violet-600" aria-hidden /> Send offer to{' '}
              {offerFor?.candidate?.name}
            </DialogTitle>
            <DialogDescription>
              {offerFor?.job?.title ?? 'The role'} · an AI-drafted offer letter goes to the
              candidate&apos;s portal — they accept or decline from there.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="offer-salary">Salary (₹ LPA)</Label>
                <Input
                  id="offer-salary"
                  type="number"
                  min="1"
                  max="500"
                  step="0.5"
                  inputMode="decimal"
                  value={offerForm.salaryLpa}
                  onChange={(e) => setOfferForm((f) => ({ ...f, salaryLpa: e.target.value }))}
                  placeholder="e.g. 18"
                  className="min-h-[44px] rounded-lg sm:min-h-[40px]"
                  aria-label="Offered salary in LPA"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="offer-date">Joining date</Label>
                <Input
                  id="offer-date"
                  type="date"
                  value={offerForm.joiningDate}
                  min={format(new Date(), 'yyyy-MM-dd')}
                  onChange={(e) => setOfferForm((f) => ({ ...f, joiningDate: e.target.value }))}
                  className="min-h-[44px] rounded-lg sm:min-h-[40px]"
                  aria-label="Proposed joining date"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="offer-workmode">Work mode</Label>
              <Input
                id="offer-workmode"
                value={offerForm.workMode}
                onChange={(e) => setOfferForm((f) => ({ ...f, workMode: e.target.value }))}
                placeholder="On-site / Hybrid / Remote"
                className="min-h-[44px] rounded-lg sm:min-h-[40px]"
                aria-label="Work mode for the offer"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOfferFor(null)} className="h-11 sm:h-9">
              Cancel
            </Button>
            <Button
              disabled={offerBusy || !offerForm.salaryLpa || !offerForm.joiningDate}
              onClick={() => void submitOffer()}
              className="h-11 rounded-lg bg-gradient-to-r from-violet-600 to-purple-500 text-white hover:from-violet-700 hover:to-purple-600 sm:h-9"
            >
              {offerBusy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <BadgeCheck className="size-4" aria-hidden />
              )}
              Send offer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Video resume preview (candidate-consented; streamed with this
          recruiter as the authorized viewer) */}
      <Dialog
        open={!!videoPreview}
        onOpenChange={(open) => {
          if (!open) setVideoPreview(null)
        }}
      >
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Video className="size-4 text-violet-600" aria-hidden /> Video resume —{' '}
              {videoPreview?.name}
            </DialogTitle>
            <DialogDescription>
              {videoPreview?.seconds != null && `${fmtSecs(videoPreview.seconds)} · `}
              Recorded by the candidate for recruiter review — not shared publicly.
            </DialogDescription>
          </DialogHeader>
          {videoPreview && (
            <div className="space-y-3">
              {/* key forces a fresh element per file so switching candidates restarts playback */}
              <video
                key={videoPreview.path}
                controls
                playsInline
                preload="metadata"
                src={`/api/candidates/video-resume/${encodeURIComponent(videoPreview.path)}?viewerId=${encodeURIComponent(user?.id ?? '')}`}
                className="aspect-video w-full rounded-lg bg-stone-900"
              />
              {videoPreview.intro && (
                <blockquote className="rounded-r-lg border-l-2 border-violet-300 bg-violet-50/50 py-1.5 pl-3 pr-2 text-xs italic text-slate-600 dark:border-violet-700 dark:bg-violet-950/30 dark:text-slate-300">
                  “{videoPreview.intro}”
                </blockquote>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Full candidate profile (structured) — shared dialog */}
      <RecruiterFullProfile
        candidateId={fullProfile?.id ?? ''}
        candidateName={fullProfile?.name}
        viewerId={user?.id}
        open={!!fullProfile}
        onOpenChange={(o) => {
          if (!o) setFullProfile(null)
        }}
      />
    </div>
  )
}

/* ------------------------------- sub pieces ------------------------------- */

function ChevronSep() {
  return <span className="select-none px-0.5 text-[10px] text-slate-300">›</span>
}

function TimelineChip({
  done,
  progress,
  label,
}: {
  done?: boolean
  progress?: boolean
  label: string
}) {
  return (
    <span
      className={`inline-flex max-w-[240px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        done
          ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/40 text-blue-700'
          : progress
            ? 'animate-pulse border-amber-200 bg-amber-50 dark:bg-amber-950/40 text-amber-700'
            : 'border-dashed border-slate-200 bg-slate-50 text-slate-400 dark:text-slate-500'
      }`}
    >
      {done ? (
        <CheckCircle2 className="size-3 shrink-0" aria-hidden />
      ) : progress ? (
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden />
      ) : (
        <span className="size-1.5 shrink-0 rounded-full bg-current opacity-60" aria-hidden />
      )}
      {label}
    </span>
  )
}

function VerdictRing({ score, verdict }: { score: number | null; verdict: string | null }) {
  const RING_COLORS: Record<string, string> = {
    STRONG_HIRE: '#2563eb',
    HIRE: '#0284c7',
    MAYBE: '#d97706',
    NO_HIRE: '#e11d48',
  }
  const color = RING_COLORS[verdict ?? ''] ?? '#94a3b8'
  const pct = Math.max(0, Math.min(100, Math.round((score ?? 0) * 10)))
  const r = 24
  const circ = 2 * Math.PI * r
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`Score ${score ?? 'n/a'} out of 10`} className="shrink-0 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" className="stroke-slate-200 dark:stroke-slate-800" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * circ} ${circ}`}
      />
      <text
        x="32"
        y="37"
        textAnchor="middle"
        fontSize="15"
        fontWeight="700"
        fill="#0f172a" className="fill-slate-900 dark:fill-slate-100"
        transform="rotate(90 32 32)"
      >
        {score != null ? score.toFixed(1) : '—'}
      </text>
    </svg>
  )
}

/* -------------------------------------------------------------------------- */
/* Private notes editor (ATS-style, recruiter-only)                            */
/* -------------------------------------------------------------------------- */

const NOTES_MAX = 2000

function ApplicantNotes({
  app,
  recruiterId,
  onSaved,
}: {
  app: Application
  recruiterId: string
  /** pushes the saved note back into the panel's local state */
  onSaved: (notes: string | null) => void
}) {
  const [draftNotes, setDraftNotes] = useState(app.notes ?? '')
  const [saving, setSaving] = useState(false)
  const mounted = useRef(app.id)
  // reset the draft when a different card opens its editor
  useEffect(() => {
    if (mounted.current !== app.id) {
      mounted.current = app.id
      setDraftNotes(app.notes ?? '')
    }
  }, [app.id, app.notes])

  const dirty = draftNotes !== (app.notes ?? '')
  const overLimit = draftNotes.length > NOTES_MAX

  const save = async () => {
    if (saving || overLimit) return
    setSaving(true)
    try {
      const res = await fetch(`/api/applications/${app.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: draftNotes, recruiterId }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to save note')
      const saved = draftNotes.trim() ? draftNotes.trim().slice(0, NOTES_MAX) : null
      onSaved(saved)
      setDraftNotes(saved ?? '')
      toast.success(
        saved ? '📌 Note saved — visible only to you' : 'Note cleared',
        { description: `Private note on ${app.candidate?.name ?? 'candidate'}` }
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/50 dark:bg-blue-950/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-800">
          <StickyNote className="size-3.5" aria-hidden /> Private note
          <span className="font-medium normal-case tracking-normal text-slate-400 dark:text-slate-500">
            · only you see this
          </span>
        </p>
        <span
          className={`text-[10px] tabular-nums ${overLimit ? 'font-bold text-rose-600 dark:text-rose-300' : 'text-slate-400 dark:text-slate-500'}`}
        >
          {draftNotes.length}/{NOTES_MAX}
        </span>
      </div>
      <Textarea
        value={draftNotes}
        onChange={(e) => setDraftNotes(e.target.value)}
        placeholder="Evaluation notes, screen-call takeaways, salary discussion, follow-ups…"
        aria-label="Private note"
        rows={3}
        className="resize-y rounded-lg border-blue-200 bg-white dark:bg-slate-900 text-sm focus-visible:ring-blue-300"
      />
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {dirty ? 'Unsaved changes' : 'Saved'} · autosaved to the candidate record (not visible to
          the candidate)
        </p>
        <Button
          size="sm"
          disabled={saving || !dirty || overLimit}
          onClick={() => void save()}
          className="h-9 min-h-[36px] rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 px-4 text-xs font-semibold text-white hover:from-blue-700 hover:to-sky-600"
          aria-label="Save private note"
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <StickyNote className="size-3.5" aria-hidden />
          )}
          Save note
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* AI screen dossier (recruiter-only — NEVER rendered on candidate surfaces)   */
/* -------------------------------------------------------------------------- */

function ScreenDossier({
  app,
  busy,
  onRerun,
}: {
  app: Application
  busy: boolean
  onRerun: () => void
}) {
  const summary = parseScreenSummary(app.screenSummary)
  if (!summary) return null
  const verdictMeta = SCREEN_VERDICT_META[summary.verdict] ?? SCREEN_VERDICT_META.GOOD_FIT
  const parity = parityReview(app.screenVerdict ?? summary.verdict, app.matchScore)

  return (
    <div
      id={`screen-dossier-${app.id}`}
      className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-900/60 dark:bg-violet-950/20"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-800 dark:text-violet-300">
          <Sparkles className="size-3.5" aria-hidden /> AI Screen
        </p>
        <div className="flex items-center gap-2">
          {parity && (
            <span
              title="Skill-match and AI screen note disagree — review before deciding"
              className="inline-flex cursor-help items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
            >
              <Scale className="size-3" aria-hidden /> Parity review
            </span>
          )}
          <Badge variant="outline" className={`${verdictMeta.cls} gap-1 px-2.5 py-0.5 text-[11px] font-bold`}>
            {verdictMeta.label}
          </Badge>
        </div>
      </div>

      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{summary.headline}</p>

      {(summary.matchedSkills.length > 0 || summary.missingSkills.length > 0) && (
        <div className="mt-2 space-y-1.5">
          {summary.matchedSkills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.matchedSkills.map((s) => (
                <span
                  key={`m-${s}`}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  ✓ {s}
                </span>
              ))}
            </div>
          )}
          {summary.missingSkills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {summary.missingSkills.map((s) => (
                <span
                  key={`g-${s}`}
                  className="rounded-md border border-slate-200 bg-stone-50 px-1.5 py-0.5 text-[11px] font-medium text-stone-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400"
                >
                  ✕ {s}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {summary.experienceFit && (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-semibold text-slate-700 dark:text-slate-300">Experience: </span>
          {summary.experienceFit}
        </p>
      )}

      {summary.screenNote && (
        <p className="mt-2 rounded-r-lg border-l-2 border-violet-300 bg-white/60 py-1.5 pl-3 pr-2 text-xs leading-relaxed text-slate-700 dark:border-violet-700 dark:bg-slate-900/60 dark:text-slate-300">
          {summary.screenNote}
        </p>
      )}

      {summary.flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {summary.flags.map((f) => (
            <span
              key={f}
              className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
            >
              ⚠ {f}
            </span>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-dashed border-violet-200 pt-2 dark:border-violet-900/60">
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Internal only — the candidate never sees this dossier.
        </p>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onRerun}
          aria-label="Re-run the AI screen"
          className="h-8 min-h-[32px] gap-1 rounded-lg px-2.5 text-[11px] font-semibold text-violet-600 hover:bg-violet-100 hover:text-violet-700 dark:text-violet-300"
        >
          {busy ? (
            <Loader2 className="size-3 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="size-3" aria-hidden />
          )}
          Re-run
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Authenticity dossier — AI anti-fraud trust scan (recruiter-only surface)   */
/* -------------------------------------------------------------------------- */

const AUTH_LEVEL_META: Record<string, { label: string; chip: string; bar: string }> = {
  TRUSTED: {
    label: 'Trusted',
    chip: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    bar: 'bg-emerald-500',
  },
  REVIEW: {
    label: 'Needs review',
    chip: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    bar: 'bg-amber-500',
  },
  HIGH_RISK: {
    label: 'High risk',
    chip: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
    bar: 'bg-rose-500',
  },
}

function parseAuthenticity(raw: string | null | undefined): {
  score?: number
  level?: string
  flags?: string[]
  summary?: string
  recommendNextStep?: string
} | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as {
      score?: number
      level?: string
      flags?: string[]
      summary?: string
      recommendNextStep?: string
    }
    if (typeof p !== 'object' || p == null) return null
    return p
  } catch {
    return null
  }
}

function AuthenticityPanel({
  app,
  busy,
  onRerun,
}: {
  app: Application
  busy: boolean
  onRerun: () => void
}) {
  const scan = parseAuthenticity(app.authenticityCheck)
  if (!scan) return null
  const score = typeof scan.score === 'number' ? Math.max(0, Math.min(100, Math.round(scan.score))) : null
  const meta = AUTH_LEVEL_META[scan.level ?? ''] ?? AUTH_LEVEL_META.REVIEW
  const flags = Array.isArray(scan.flags) ? scan.flags : []

  return (
    <div
      id={`auth-dossier-${app.id}`}
      className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="size-3.5" aria-hidden /> Authenticity scan
        </p>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`${meta.chip} gap-1 px-2.5 py-0.5 text-[11px] font-bold`}>
            {meta.label}
          </Badge>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={onRerun}
            className="h-7 gap-1 rounded-lg px-2 text-[11px] text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
          >
            {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <RefreshCw className="size-3" aria-hidden />}
            Re-run
          </Button>
        </div>
      </div>

      {score != null && (
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950/60">
            <div
              className={`h-full rounded-full ${meta.bar}`}
              style={{ width: `${score}%` }}
              role="meter"
              aria-valuenow={score}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Resume authenticity score ${score} out of 100`}
            />
          </div>
          <span className="text-xs font-bold tabular-nums text-slate-700 dark:text-slate-200">{score}/100</span>
        </div>
      )}

      {scan.summary && (
        <p className="mt-2 rounded-r-lg border-l-2 border-emerald-300 bg-white/60 py-1.5 pl-3 pr-2 text-xs leading-relaxed text-slate-700 dark:border-emerald-700 dark:bg-slate-900/60 dark:text-slate-300">
          {scan.summary}
        </p>
      )}

      {flags.length > 0 && (
        <div className="mt-2 space-y-1">
          {flags.map((f) => (
            <p key={f} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
              <span aria-hidden className="mt-0.5 text-amber-500">▲</span>
              {f}
            </p>
          ))}
        </div>
      )}

      {scan.recommendNextStep && (
        <p className="mt-2 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
          Next step: {scan.recommendNextStep}
        </p>
      )}

      <p className="mt-2 text-[10px] italic text-slate-400 dark:text-slate-500">
        Internal only — the candidate never sees this scan.
      </p>
    </div>
  )
}

function OnboardingSection({
  app,
  recruiterId,
  onUpdated,
}: {
  app: Application
  recruiterId: string
  /** pushes the server-returned application back into the panel state */
  onUpdated: (app: Application) => void
}) {
  const items = parseChecklist(app.onboardChecklist)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const done = items.filter((i) => i.done).length
  const pct = items.length > 0 ? Math.round((done / items.length) * 100) : 0
  const fullyOnboarded = app.status === 'ONBOARDED' || app.onboardStatus === 'COMPLETED'

  const toggle = async (key: string) => {
    if (busyKey) return
    setBusyKey(key)
    try {
      const res = await fetch(`/api/applications/${app.id}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle-onboard', userId: recruiterId, key }),
      })
      const json: { data?: Application; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) throw new Error(json.error || 'Failed to update')
      const wasOnboarded = app.status === 'ONBOARDED'
      onUpdated(json.data)
      if (json.data.status === 'ONBOARDED' && !wasOnboarded) {
        toast.success(`🎉 ${app.candidate?.name ?? 'Candidate'} is fully onboarded!`, {
          description: 'All 4 onboarding steps are complete.',
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update onboarding')
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/20">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-300">
          <ClipboardList className="size-3.5" aria-hidden /> Onboarding tracker
          <span className="font-medium normal-case tracking-normal text-slate-400 dark:text-slate-500">
            · {done}/{items.length || 4} done
          </span>
        </p>
        {fullyOnboarded && (
          <Badge className="gap-1 border-violet-600 bg-violet-600 px-2.5 py-0.5 text-[11px] font-bold text-white">
            <PartyPopper className="size-3" aria-hidden /> Onboarded 🎉
          </Badge>
        )}
      </div>

      {/* progress bar (done / 4) */}
      <div
        className="mb-2.5 h-1.5 w-full overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-900/40"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Onboarding progress: ${done} of ${items.length || 4} steps done`}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        {(items.length > 0
          ? items
          : parseChecklist(
              JSON.stringify([
                { key: 'bgv', label: 'Background verification', done: false, doneAt: null },
                { key: 'docs', label: 'Document collection', done: false, doneAt: null },
                { key: 'esign', label: 'Contract e-sign', done: false, doneAt: null },
                { key: 'day1', label: 'Day-1 access', done: false, doneAt: null },
              ])
            )
        ).map((item) => (
          <label
            key={item.key}
            className={`flex cursor-pointer items-center gap-2.5 rounded-lg border border-emerald-100 bg-white px-3 py-2 transition-colors hover:border-emerald-300 dark:border-emerald-900/50 dark:bg-slate-900 dark:hover:border-emerald-700 ${
              busyKey === item.key ? 'opacity-60' : ''
            }`}
          >
            <Checkbox
              checked={item.done}
              disabled={busyKey === item.key}
              onCheckedChange={() => void toggle(item.key)}
              aria-label={`Mark "${item.label}" ${item.done ? 'not done' : 'done'}`}
              className="data-[state=checked]:border-emerald-600 data-[state=checked]:bg-emerald-600"
            />
            <span className="min-w-0">
              <span
                className={`block truncate text-xs font-medium ${
                  item.done
                    ? 'text-emerald-700 line-through dark:text-emerald-300'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                {item.label}
              </span>
              {item.done && item.doneAt && (
                <span className="block text-[10px] text-slate-400 dark:text-slate-500">
                  done {format(new Date(item.doneAt), 'MMM d, hh:mm a')}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
        Ticking all 4 steps marks the hire as fully onboarded.
      </p>
    </div>
  )
}
