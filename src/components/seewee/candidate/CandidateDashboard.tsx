'use client'

/**
 * CandidateDashboard — candidate home inside SeeWe.
 * Tab 1: My Applications (pipeline tracker per application).
 * Tab 2: My Profile (editable form — falls back to a local draft if the
 *        backend PATCH route isn't available yet).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  AlarmClock,
  AlertTriangle,
  BadgeCheck,
  BellRing,
  Bookmark,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Dumbbell,
  Eye,
  FileBarChart,
  FileText,
  KeyRound,
  Loader2,
  Mail,
  MapPin,
  MessageSquare,
  MicVocal,
  PartyPopper,
  Play,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  UserRound,
  Users,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
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

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ProfileStrength } from '@/components/seewee/candidate/ProfileStrength'
import { Textarea } from '@/components/ui/textarea'
import { SavedJobsTab } from '@/components/seewee/candidate/SavedJobsTab'
import { JobAlertsTab } from '@/components/seewee/candidate/JobAlertsTab'
import AssessmentCenter from '@/components/seewee/candidate/AssessmentCenter'
import AtsSimulator from '@/components/seewee/candidate/AtsSimulator'
import { RecommendedJobs } from '@/components/seewee/candidate/RecommendedJobs'
import { matchBadgeClass, matchBadgeText } from '@/lib/match-ui'
import { ResumeParserCard } from '@/components/seewee/candidate/ResumeParserCard'
import { ProfileSections } from '@/components/seewee/candidate/ProfileSections'
import { CvUploadCard } from '@/components/seewee/candidate/CvUploadCard'
import VideoResumeCard from '@/components/seewee/candidate/VideoResumeCard'
import MockInterviewPractice from '@/components/seewee/candidate/MockInterviewPractice'
import GuildsHub from '@/components/seewee/candidate/GuildsHub'
import AlertsChatFeed from '@/components/seewee/candidate/AlertsChatFeed'
import RoleFitDeepDive from '@/components/seewee/candidate/RoleFitDeepDive'
import { MessagesPanel } from '@/components/seewee/MessagesPanel'
import { useAppStore, formatLpa } from '@/store/app-store'
import type { Application, ApiResponse, OfferLetter, ProcessEmail } from '@/lib/types'

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

interface ProfileDraftState {
  name: string
  phone: string
  headline: string
  location: string
  skills: string
  experienceYears: string
  currentSalary: string
  expectedSalary: string
  education: string
  resumeText: string
  /** '' = not specified, '0' = immediate, else days */
  noticePeriodDays: string
  /** Portfolio links (public, shown to recruiters) */
  githubUrl: string
  linkedinUrl: string
  behanceUrl: string
  portfolioUrl: string
  /** PRIVATE privacy shield — current employer; recruiters from this company never see the profile */
  currentEmployer: string
}

const DRAFT_KEY = 'seewee-draft-profile'

/** Subset of GET /api/candidates/[id] used to resync the store + form draft */
interface CandidateProfilePayload {
  name?: string | null
  phone?: string | null
  headline?: string | null
  location?: string | null
  company?: string | null
  skills?: string | null
  experienceYears?: number | null
  currentSalary?: number | null
  expectedSalary?: number | null
  education?: string | null
  resumeText?: string | null
  noticePeriodDays?: number | null
  githubUrl?: string | null
  linkedinUrl?: string | null
  behanceUrl?: string | null
  portfolioUrl?: string | null
  currentEmployer?: string | null
}

const EMPTY_DRAFT: ProfileDraftState = {
  name: '',
  phone: '',
  headline: '',
  location: '',
  skills: '',
  experienceYears: '',
  currentSalary: '',
  expectedSalary: '',
  education: '',
  resumeText: '',
  noticePeriodDays: '',
  githubUrl: '',
  linkedinUrl: '',
  behanceUrl: '',
  portfolioUrl: '',
  currentEmployer: '',
}

/** Select-safe notice period options (Radix forbids empty item values) */
const NOTICE_OPTIONS = [
  { value: 'unspecified', label: 'Not specified' },
  { value: '0', label: 'Immediate joiner' },
  { value: '15', label: '15 days' },
  { value: '30', label: '1 month' },
  { value: '60', label: '2 months' },
  { value: '90', label: '3 months' },
] as const

/* ------------------ e-commerce-parcel tracking timeline ------------------- */
/* Applied → Viewed → Shortlisted → Interview → Offer → Hired. We only ever
 * render timestamps we actually track (createdAt / viewedAt) — later steps
 * show no date rather than a fabricated one. AI scores/verdicts never appear. */
const TIMELINE_NODES = [
  'Applied',
  'Viewed',
  'Shortlisted',
  'Interview',
  'Offer',
  'Hired',
] as const

const BEYOND_APPLIED = new Set([
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'SHARED_WITH_CLIENT',
  'OFFERED',
  'HIRED',
  'ONBOARDED',
])
const INTERVIEW_STAGE = new Set([
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'SHARED_WITH_CLIENT',
  'OFFERED',
  'HIRED',
  'ONBOARDED',
])
const OFFER_STAGE = new Set(['OFFERED', 'HIRED', 'ONBOARDED'])
const HIRED_STAGE = new Set(['HIRED', 'ONBOARDED'])

/** Which of the 6 tracking nodes are complete; which one is live now. */
function timelineState(
  status: Application['status'],
  viewedAt?: string | null,
  offerStatus?: string | null
): { done: boolean[]; current: number; rejected: boolean } {
  const done = [
    true, // Applied — always known
    Boolean(viewedAt), // Viewed — recruiter engagement signal
    BEYOND_APPLIED.has(status),
    INTERVIEW_STAGE.has(status),
    OFFER_STAGE.has(status) || Boolean(offerStatus),
    HIRED_STAGE.has(status),
  ]
  const rejected = status === 'REJECTED'
  const firstUndone = done.findIndex((d) => !d)
  const current = !rejected && firstUndone !== -1 ? firstUndone : -1
  return { done, current, rejected }
}

/** Compact date stamp for the two timeline nodes we can honestly date */
function shortDateSafe(iso?: string | null): string {
  if (!iso) return ''
  try {
    return format(new Date(iso), 'MMM d')
  } catch {
    return ''
  }
}

/** One overdue application as reported by GET /api/applications/sla */
interface SlaOverdue {
  applicationId: string
  jobTitle: string
  company: string
  daysWaiting: number
  reminderSent: boolean
}

// 14-day SLA sweep session guard — module-level so React remounts, tab
// switches and dev hot-reloads never re-trigger the recruiter reminder batch.
// The fetched overdue list is ALSO cached module-level and hydrated into state
// synchronously, so the amber banner survives dashboard remounts (view switches
// between Find Jobs and My Journey unmount this component).
let slaCheckedForUserId: string | null = null
let slaCachedOverdue: SlaOverdue[] | null = null

function parseOfferLetter(raw?: string | null): OfferLetter | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<OfferLetter>
    if (!parsed || typeof parsed.body !== 'string') return null
    return {
      subject: typeof parsed.subject === 'string' ? parsed.subject : 'Your offer letter',
      body: parsed.body,
      salaryLpa: typeof parsed.salaryLpa === 'number' ? parsed.salaryLpa : 0,
      joiningDate: typeof parsed.joiningDate === 'string' ? parsed.joiningDate : '',
      workMode: typeof parsed.workMode === 'string' ? parsed.workMode : '',
      generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : '',
    }
  } catch {
    return null
  }
}

function timeAgoSafe(iso?: string | null): string {
  if (!iso) return ''
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

function readLocalDraft(): ProfileDraftState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return { ...EMPTY_DRAFT, ...(parsed as Partial<ProfileDraftState>) }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function CandidateDashboard() {
  /* ------------------------------- store -------------------------------- */
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const view = useAppStore((s) => s.view)
  const setView = useAppStore((s) => s.setView)
  const openJob = useAppStore((s) => s.openJob)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const setUser = useAppStore((s) => s.setUser)

  /* -------------------------------- tabs -------------------------------- */
  const [tab, setTab] = useState('applications')
  // Profile privacy toggle: profile hidden from recruiter talent search when off
  const [profileVisible, setProfileVisible] = useState(true)
  const [visibilitySaving, setVisibilitySaving] = useState(false)
  // deep-link spotlight: the applications card a notification pointed at
  const [spotlightAppId, setSpotlightAppId] = useState<string | null>(null)
  // External components (e.g. the header bell) can jump straight to a tab
  useEffect(() => {
    function onTabRequest(e: Event) {
      const t = (e as CustomEvent<{ tab?: string }>).detail?.tab
      if (t) setTab(t)
    }
    document.addEventListener('seewee:candidate-tab', onTabRequest)
    return () => document.removeEventListener('seewee:candidate-tab', onTabRequest)
  }, [])

  // 🔔 Deep-link handoff: a SHORTLIST / INTERVIEW_DONE / CLIENT_VERDICT
  // notification can spotlight one specific application card. One-shot.
  const pendingFocus = useAppStore((s) => s.pendingFocus)
  const setPendingFocus = useAppStore((s) => s.setPendingFocus)
  useEffect(() => {
    // direct-message handoff — switch to the Messages tab; MessagesPanel opens
    // the thread itself from the same pendingFocus contract
    if (pendingFocus?.kind === 'messages') {
      setTab('messages')
      return
    }
    if (!pendingFocus || pendingFocus.kind !== 'candidate-application') return
    setTab('applications')
    setSpotlightAppId(pendingFocus.applicationId)
    const t = setTimeout(
      () =>
        document
          .getElementById(`candidate-application-${pendingFocus.applicationId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      400
    )
    const clearT = setTimeout(() => setSpotlightAppId(null), 3400)
    setPendingFocus(null)
    return () => {
      clearTimeout(t)
      clearTimeout(clearT)
    }
  }, [pendingFocus, setPendingFocus])

  /* ---------------------------- applications ---------------------------- */
  const [applications, setApplications] = useState<Application[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const fetchApplications = useCallback(async () => {
    if (!user?.id) return
    setLoadError(null)
    try {
      const res = await fetch(`/api/applications?candidateId=${encodeURIComponent(user.id)}`)
      const json = (await res.json().catch(() => ({}))) as ApiResponse<Application[]>
      if (!res.ok || json.error) throw new Error(json.error ?? 'Failed to load applications')
      setApplications(Array.isArray(json.data) ? json.data : [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load applications')
    }
  }, [user?.id])

  useEffect(() => {
    void fetchApplications()
  }, [fetchApplications, refreshKey])

  /* ------------------ 14-day response-promise SLA sweep ------------------ */
  // Fires once per candidate per browser session (module-level guard so hot
  // reloads / strict-mode remounts can't spam recruiters with reminders).
  const [slaOverdue, setSlaOverdue] = useState<SlaOverdue[]>(() =>
    user?.id && slaCheckedForUserId === user.id && slaCachedOverdue
      ? slaCachedOverdue
      : []
  )
  useEffect(() => {
    if (!user?.id || slaCheckedForUserId === user.id) return
    slaCheckedForUserId = user.id
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/applications/sla?userId=${encodeURIComponent(user.id)}`
        )
        const json = (await res.json().catch(() => ({}))) as ApiResponse<{
          overdue: SlaOverdue[]
        }>
        if (!res.ok || json.error || !json.data) return
        if (!cancelled) {
          const overdue = Array.isArray(json.data.overdue) ? json.data.overdue : []
          slaCachedOverdue = overdue
          setSlaOverdue(overdue)
        }
      } catch {
        /* the SLA sweep is best-effort — never blocks the dashboard */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  // applicationId → overdue info, for per-card chips
  const slaByApp = useMemo(() => {
    const map = new Map<string, SlaOverdue>()
    for (const item of slaOverdue) map.set(item.applicationId, item)
    return map
  }, [slaOverdue])

  /* ------------------------------- profile ------------------------------ */
  const [draft, setDraft] = useState<ProfileDraftState>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  /** true once (or since) a sync attempt failed — keeps the visual note up */
  const [patchFailed, setPatchFailed] = useState(false)

  // Auto-fill from logged-in user; layered over any persisted local draft.
  useEffect(() => {
    const saved = readLocalDraft()
    if (saved) setPatchFailed(true) // note persists visually while a draft exists
    if (!user) {
      if (!saved) setDraft(EMPTY_DRAFT)
      return
    }
    setDraft({
      name: user.name ?? '',
      phone: user.phone ?? '',
      headline: user.headline ?? '',
      location: user.location ?? '',
      skills: user.skills ?? '',
      experienceYears:
        user.experienceYears != null ? String(user.experienceYears) : '',
      currentSalary:
        user.currentSalary != null ? String(user.currentSalary) : '',
      expectedSalary:
        user.expectedSalary != null ? String(user.expectedSalary) : '',
      education: user.education ?? '',
      resumeText: user.resumeText ?? '',
      noticePeriodDays:
        user.noticePeriodDays != null ? String(user.noticePeriodDays) : '',
      githubUrl: user.githubUrl ?? '',
      linkedinUrl: user.linkedinUrl ?? '',
      behanceUrl: user.behanceUrl ?? '',
      portfolioUrl: user.portfolioUrl ?? '',
      currentEmployer: user.currentEmployer ?? '',
    })
    if (saved) setDraft((prev) => ({ ...prev, ...saved }))
  }, [user?.id])

  // Keep the visibility switch in sync with server truth
  useEffect(() => {
    if (user) setProfileVisible(user.profileVisible !== false)
  }, [user?.id, user?.profileVisible])

  /** Instant-save the profile visibility toggle (independent of profile form). */
  async function toggleProfileVisibility(next: boolean) {
    if (!user || visibilitySaving) return
    const prev = profileVisible
    setProfileVisible(next)
    setVisibilitySaving(true)
    try {
      const res = await fetch(`/api/candidates/${encodeURIComponent(user.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileVisible: next }),
      })
      const json: { data?: { profileVisible?: boolean }; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to update visibility')
      setUser({ ...user, profileVisible: json.data?.profileVisible ?? next })
      toast.success(
        next
          ? 'Profile visible to recruiters ✓'
          : 'Profile hidden from recruiter searches'
      )
    } catch (err) {
      setProfileVisible(prev) // optimistic revert
      toast.error(err instanceof Error ? err.message : 'Could not update visibility')
    } finally {
      setVisibilitySaving(false)
    }
  }

  function update<K extends keyof ProfileDraftState>(key: K, value: string) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  /* ------------------------- AI summary writer ------------------------- */
  // One-click "write it for me": sends the visible profile details to
  // /api/ai/profile-summary and drops the result into the draft so the
  // candidate can edit before saving. Honest toasts for both the AI and
  // template-fallback sources.
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false)
  async function generateSummaryWithAi() {
    if (!user || aiSummaryLoading) return
    if (!draft.name.trim() && !draft.skills.trim() && !draft.headline.trim()) {
      toast.error('Fill your name, headline or skills first — AI needs material to work with')
      return
    }
    const hadText = draft.resumeText.trim().length > 0
    setAiSummaryLoading(true)
    try {
      const res = await fetch('/api/ai/profile-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name,
          headline: draft.headline,
          skills: draft.skills,
          experienceYears: draft.experienceYears,
          education: draft.education,
          location: draft.location,
        }),
      })
      const json: {
        data?: { summary?: string; source?: 'ai' | 'fallback' }
        error?: string
      } = await res.json()
      if (!res.ok || json.error || !json.data?.summary) {
        throw new Error(json.error || 'Could not generate a summary')
      }
      update('resumeText', json.data.summary)
      if (json.data.source === 'fallback') {
        toast.info('Draft ready from your details — polish it and save')
      } else {
        toast.success(
          hadText
            ? 'Summary rewritten — review, edit freely, then Save'
            : 'Summary written — review, edit freely, then Save'
        )
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate a summary right now')
    } finally {
      setAiSummaryLoading(false)
    }
  }

  async function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!user) return
    setSaving(true)
    try {
      const numericYears = Number.parseFloat(draft.experienceYears)
      const numericCurrent = Number.parseFloat(draft.currentSalary)
      const numericExpected = Number.parseFloat(draft.expectedSalary)
      const parsedNotice = Number.parseInt(draft.noticePeriodDays, 10)
      const profileFields = {
        userId: user.id,
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        headline: draft.headline.trim(),
        location: draft.location.trim(),
        skills: draft.skills.trim(),
        experienceYears: Number.isFinite(numericYears) ? numericYears : null,
        currentSalary: Number.isFinite(numericCurrent) ? numericCurrent : null,
        expectedSalary: Number.isFinite(numericExpected) ? numericExpected : null,
        education: draft.education.trim(),
        resumeText: draft.resumeText,
        noticePeriodDays:
          draft.noticePeriodDays !== '' && Number.isInteger(parsedNotice)
            ? Math.max(0, Math.min(180, parsedNotice))
            : null,
        githubUrl: draft.githubUrl.trim(),
        linkedinUrl: draft.linkedinUrl.trim(),
        behanceUrl: draft.behanceUrl.trim(),
        portfolioUrl: draft.portfolioUrl.trim(),
        currentEmployer: draft.currentEmployer.trim(),
      }

      /*
       * Server-first sync via PATCH /api/candidates/[id]. Any failure —
       * offline, non-ok, network — falls back to a localStorage draft so
       * nothing the candidate types is lost; the banner below nudges them
       * to retry once connectivity returns.
       */
      let synced = false
      try {
        const res = await fetch(`/api/candidates/${encodeURIComponent(user.id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profileFields),
        })
        synced = res.ok
      } catch {
        synced = false
      }

      if (synced) {
        try {
          window.localStorage.removeItem(DRAFT_KEY)
        } catch {
          /* noop */
        }
        setPatchFailed(false)
        setUser({ ...user, ...profileFields })
        toast.success('Profile saved ✨')
      } else {
        try {
          window.localStorage.setItem(DRAFT_KEY, JSON.stringify(profileFields))
        } catch {
          /* storage might be unavailable — still keep in-memory state */
        }
        setPatchFailed(true)
        toast.info('Server unreachable — profile drafted on this device')
      }
    } finally {
      setSaving(false)
    }
  }

  /**
   * Reload the profile from the server and sync BOTH the zustand user and the
   * local form draft — used after the AI Resume Parser applies extracted
   * fields. Mirrors the save-success path (clears stale local drafts).
   */
  const reloadProfileFromServer = useCallback(async () => {
    if (!user?.id) return
    try {
      const res = await fetch(`/api/candidates/${encodeURIComponent(user.id)}`)
      const json = (await res.json().catch(() => ({}))) as {
        data?: CandidateProfilePayload
        error?: string
      }
      const fresh = json.data
      if (!res.ok || !fresh) return

      setUser({
        ...user,
        name: fresh.name ?? user.name,
        phone: fresh.phone ?? null,
        headline: fresh.headline ?? null,
        location: fresh.location ?? null,
        company: fresh.company ?? null,
        skills: fresh.skills ?? null,
        experienceYears: fresh.experienceYears ?? null,
        currentSalary: fresh.currentSalary ?? null,
        expectedSalary: fresh.expectedSalary ?? null,
        education: fresh.education ?? null,
        resumeText: fresh.resumeText ?? null,
        noticePeriodDays: fresh.noticePeriodDays ?? null,
        githubUrl: fresh.githubUrl ?? null,
        linkedinUrl: fresh.linkedinUrl ?? null,
        behanceUrl: fresh.behanceUrl ?? null,
        portfolioUrl: fresh.portfolioUrl ?? null,
        currentEmployer: fresh.currentEmployer ?? null,
      })
      setDraft({
        name: fresh.name ?? '',
        phone: fresh.phone ?? '',
        headline: fresh.headline ?? '',
        location: fresh.location ?? '',
        skills: fresh.skills ?? '',
        experienceYears:
          fresh.experienceYears != null ? String(fresh.experienceYears) : '',
        currentSalary:
          fresh.currentSalary != null ? String(fresh.currentSalary) : '',
        expectedSalary:
          fresh.expectedSalary != null ? String(fresh.expectedSalary) : '',
        education: fresh.education ?? '',
        resumeText: fresh.resumeText ?? '',
        noticePeriodDays:
          fresh.noticePeriodDays != null ? String(fresh.noticePeriodDays) : '',
        githubUrl: fresh.githubUrl ?? '',
        linkedinUrl: fresh.linkedinUrl ?? '',
        behanceUrl: fresh.behanceUrl ?? '',
        portfolioUrl: fresh.portfolioUrl ?? '',
        currentEmployer: fresh.currentEmployer ?? '',
      })
      // The PATCH came from the parser card (server-truth); drop any stale draft.
      window.localStorage.removeItem(DRAFT_KEY)
      setPatchFailed(false)
    } catch {
      /* silent — the parser card already surfaced its own success toast */
    }
  }, [user, setUser])

  /* ----------------------------- mailbox ------------------------------ */
  // Process emails "sent" to this candidate's address (application received,
  // interview invite, offer, status updates). The sandbox records mail instead
  // of delivering it — this card is the candidate's inbox view of that flow.
  const [emails, setEmails] = useState<ProcessEmail[] | null>(null)
  const [emailsOpen, setEmailsOpen] = useState(false)
  const fetchEmails = useCallback(async () => {
    if (!user?.id) return
    try {
      const res = await fetch(`/api/emails?userId=${encodeURIComponent(user.id)}`)
      const json = (await res.json().catch(() => ({}))) as ApiResponse<ProcessEmail[]>
      if (res.ok && Array.isArray(json.data)) setEmails(json.data)
    } catch {
      /* mailbox is best-effort */
    }
  }, [user?.id])
  useEffect(() => {
    void fetchEmails()
  }, [fetchEmails, refreshKey])

  /* ----------------------------- derived data --------------------------- */
  const stats = useMemo(() => {
    const apps = applications ?? []
    const interviewsDone = apps.filter((a) =>
      (a.shortlists ?? []).some((sl) => sl.interview?.status === 'COMPLETED')
    ).length
    const shared = apps.filter(
      (a) =>
        a.status === 'SHARED_WITH_CLIENT' ||
        (a.shortlists ?? []).some((sl) => sl.status === 'REPORT_SHARED')
    ).length
    return { total: apps.length, interviewsDone, shared }
  }, [applications])

  /* ====================================================================== */
  /* Render                                                                  */
  /* ====================================================================== */

  /* ------------------------- signed-out prompt -------------------------- */
  if (!user) {
    return (
      <div className="mx-auto max-w-md pt-14">
        <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-lg">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-100 to-sky-100 dark:from-blue-900/40 dark:to-sky-900/40 text-blue-700">
              <UserRound className="size-7" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Sign in to your candidate space
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                Track every application through the AI-interview pipeline and manage your
                live profile.
              </p>
            </div>
            <Button
              onClick={() => setAuthOpen(true)}
              className="min-h-[44px] rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 px-6 font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700"
            >
              <KeyRound className="size-4" aria-hidden /> Sign in / Register
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const firstName = (user.name ?? 'there').split(' ')[0]

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      {/* ----------------------------- header ------------------------------ */}
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Welcome back, {firstName} 👋
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Your mission control — applications, AI interviews and profile.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge
            variant="outline"
            className="gap-1.5 rounded-full border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/40 px-3 py-1 text-blue-700"
          >
            <Briefcase className="size-3.5" aria-hidden />
            {stats.total} application{stats.total === 1 ? '' : 's'}
          </Badge>
          <Badge
            variant="outline"
            className="gap-1.5 rounded-full border-sky-200 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/40 px-3 py-1 text-sky-700"
          >
            <MicVocal className="size-3.5" aria-hidden />
            {stats.interviewsDone} AI interview{stats.interviewsDone === 1 ? '' : 's'} graded
          </Badge>
          <Badge
            variant="outline"
            className="gap-1.5 rounded-full border-slate-200 dark:border-slate-800 bg-card px-3 py-1 text-slate-500 dark:text-slate-400"
          >
            <Send className="size-3.5" aria-hidden />
            {stats.shared} report{stats.shared === 1 ? '' : 's'} shared
          </Badge>
        </div>

        {/* Profile completeness meter — nudges candidates toward a
            recruiter-friendly profile and deep-links to the form */}
        <ProfileStrength user={user} onComplete={() => setTab('profile')} />
      </header>

      <Separator />

      {/* ------------------------------ tabs ------------------------------- */}
      <Tabs value={tab} onValueChange={(v) => setTab(v)} className="w-full">
        <TabsList className="h-11 w-full max-w-3xl grid grid-cols-8 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
          <TabsTrigger
            value="applications"
            title="Applications"
            className="min-h-[36px] rounded-lg px-1 data-[state=active]:bg-card data-[state=active]:text-blue-700 data-[state=active]:shadow-sm"
          >
            <Briefcase className="size-4 sm:mr-1.5" aria-hidden />
            <span className="hidden lg:inline">Applications</span>
            <span className="lg:hidden sr-only">Applications</span>
          </TabsTrigger>
          <TabsTrigger
            value="saved"
            title="Saved jobs"
            className="min-h-[36px] rounded-lg px-1 data-[state=active]:bg-card data-[state=active]:text-amber-700 data-[state=active]:shadow-sm"
          >
            <Bookmark className="size-4 sm:mr-1.5" aria-hidden />
            <span className="hidden lg:inline">Saved</span>
            <span className="lg:hidden sr-only">Saved</span>
          </TabsTrigger>
          <TabsTrigger
            value="messages"
            title="Messages"
            className="min-h-[36px] rounded-lg px-1 data-[state=active]:bg-card data-[state=active]:text-teal-700 data-[state=active]:shadow-sm"
          >
            <MessageSquare className="size-4 sm:mr-1.5" aria-hidden />
            <span className="hidden lg:inline">Messages</span>
            <span className="lg:hidden sr-only">Messages</span>
          </TabsTrigger>
          <TabsTrigger
            value="skills"
            title="Skill verification & ATS check"
            className="min-h-[36px] rounded-lg px-1 data-[state=active]:bg-card data-[state=active]:text-violet-700 data-[state=active]:shadow-sm"
          >
            <ShieldCheck className="size-4 sm:mr-1.5" aria-hidden />
            <span className="hidden lg:inline">Skills</span>
            <span className="lg:hidden sr-only">Skills</span>
          </TabsTrigger>
          <TabsTrigger
            value="practice"
            title="Practice interview (private)"
            className="min-h-[36px] rounded-lg px-1 data-[state=active]:bg-card data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm"
          >
            <Dumbbell className="size-4 sm:mr-1.5" aria-hidden />
            <span className="hidden lg:inline">Practice</span>
            <span className="lg:hidden sr-only">Practice</span>
          </TabsTrigger>
          <TabsTrigger
            value="guilds"
            title="Referral guilds"
            className="min-h-[36px] rounded-lg px-1 data-[state=active]:bg-card data-[state=active]:text-violet-700 data-[state=active]:shadow-sm"
          >
            <Users className="size-4 sm:mr-1.5" aria-hidden />
            <span className="hidden lg:inline">Guilds</span>
            <span className="lg:hidden sr-only">Guilds</span>
          </TabsTrigger>
          <TabsTrigger
            value="alerts"
            title="Job alerts"
            className="min-h-[36px] rounded-lg px-1 data-[state=active]:bg-card data-[state=active]:text-blue-700 data-[state=active]:shadow-sm"
          >
            <BellRing className="size-4 sm:mr-1.5" aria-hidden />
            <span className="hidden lg:inline">Alerts</span>
            <span className="lg:hidden sr-only">Alerts</span>
          </TabsTrigger>
          <TabsTrigger
            value="profile"
            title="My profile"
            className="min-h-[36px] rounded-lg px-1 data-[state=active]:bg-card data-[state=active]:text-sky-700 data-[state=active]:shadow-sm"
          >
            <UserRound className="size-4 sm:mr-1.5" aria-hidden />
            <span className="hidden lg:inline">Profile</span>
            <span className="lg:hidden sr-only">Profile</span>
          </TabsTrigger>
        </TabsList>

        {/* ============ SKILLS TAB (verification + ATS check + deep-dive) ============ */}
        <TabsContent value="skills" className="mt-5 space-y-4 focus-visible:outline-none">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <AssessmentCenter user={user ? { id: user.id, name: user.name } : { id: '' }} />
            <AtsSimulator user={user ? { id: user.id, name: user.name } : { id: '' }} />
          </div>
          <RoleFitDeepDive user={user ? { id: user.id, name: user.name } : { id: '' }} />
        </TabsContent>

        {/* ================= PRACTICE TAB (private mock interviews) ================= */}
        <TabsContent value="practice" className="mt-5 focus-visible:outline-none">
          <MockInterviewPractice user={user ? { id: user.id, name: user.name } : { id: '' }} />
        </TabsContent>

        {/* ==================== GUILDS TAB (referral community) ===================== */}
        <TabsContent value="guilds" className="mt-5 focus-visible:outline-none">
          <GuildsHub user={user ? { id: user.id, name: user.name } : { id: '' }} />
        </TabsContent>

        {/* ==================== MESSAGES TAB (direct chat) =================== */}
        <TabsContent value="messages" className="mt-5 focus-visible:outline-none">
          <MessagesPanel role="CANDIDATE" />
        </TabsContent>

        {/* ======================= APPLICATIONS TAB ======================= */}
        <TabsContent value="applications" className="mt-5 space-y-4 focus-visible:outline-none">
          {/* ⏰ 14-day response promise — honest SLA banner (Absolute
              Transparency pack). Copy claims a reminder only when one really
              went out; a guard-skipped sweep means it went out earlier. */}
          {slaOverdue.length > 0 && (
            <div
              role="status"
              aria-label="Response promise notice"
              className="flex items-start gap-3 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3.5 shadow-sm"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-100 dark:bg-amber-900/50"
                aria-hidden
              >
                <AlarmClock className="size-4.5 text-amber-600 dark:text-amber-300" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
                  ⏰ {slaOverdue.length} application{slaOverdue.length === 1 ? '' : 's'} past our
                  14-day response promise
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                  {slaOverdue.some((o) => o.reminderSent)
                    ? "We've sent the recruiters a reminder — you'll see movement here."
                    : 'A reminder is already with the recruiter — you\'ll see movement here.'}
                </p>
              </div>
            </div>
          )}

          {/* 🎉 Live offers — the single most urgent item in the journey.
              Screen/AI data NEVER renders here: the API strips it for candidates. */}
          {(applications ?? [])
            .filter((a) => a.offerStatus === 'SENT')
            .map((app) => (
              <OfferCard
                key={app.id}
                app={app}
                userId={user.id}
                onChanged={() => {
                  void fetchApplications()
                  void fetchEmails()
                  bumpRefresh()
                }}
              />
            ))}

          {/* ✨ AI job discovery — top matches for this candidate, one tap away */}
          <RecommendedJobs onApplied={() => void fetchApplications()} />

          {/* 📧 Email updates — what the platform sent to your email address */}
          {user.email && (
            <Card className="overflow-hidden rounded-2xl border-blue-100 dark:border-blue-900/50 shadow-sm">
              <button
                type="button"
                onClick={() => setEmailsOpen((o) => !o)}
                aria-expanded={emailsOpen}
                className="flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-blue-50/50 dark:hover:bg-blue-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-100 to-sky-100 text-blue-700 dark:from-blue-900/40 dark:to-sky-900/40">
                    <Mail className="size-4.5" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Email updates {emails && emails.length > 0 ? `(${emails.length})` : ''}
                    </span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {emails && emails.length > 0
                        ? `Latest: ${emails[0].subject}`
                        : `Process mail for ${user.email} — application received, interview invites, offers`}
                    </span>
                  </span>
                </span>
                <ChevronDown
                  className={`size-4 shrink-0 text-slate-400 transition-transform ${emailsOpen ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>
              {emailsOpen && (
                <div className="border-t border-blue-100 dark:border-blue-900/50 bg-blue-50/30 dark:bg-blue-950/10">
                  {emails === null ? (
                    <div className="space-y-2 p-4" aria-label="Loading emails">
                      <Skeleton className="h-12 rounded-xl" />
                      <Skeleton className="h-12 rounded-xl" />
                    </div>
                  ) : emails.length === 0 ? (
                    <p className="px-5 py-4 text-xs text-slate-500 dark:text-slate-400">
                      No mail yet — apply to a job and the confirmation lands here.
                    </p>
                  ) : (
                    <ul className="max-h-80 space-y-1 overflow-y-auto p-3 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar]:w-1.5 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700">
                      {emails.map((mail) => (
                        <li
                          key={mail.id}
                          className="rounded-xl border border-transparent bg-white px-3.5 py-2.5 shadow-sm transition-colors hover:border-blue-200 dark:bg-slate-900 dark:hover:border-blue-800"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                              {mail.subject}
                            </p>
                            <span className="shrink-0 text-[10px] font-medium text-slate-400">
                              {timeAgoSafe(mail.createdAt)}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 whitespace-pre-line text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                            {mail.body}
                          </p>
                          <p className="mt-1 text-[10px] font-medium uppercase tracking-wide text-blue-600/70">
                            to {mail.toEmail}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* loading skeletons */}
          {applications === null && !loadError && (
            <div className="space-y-4" aria-label="Loading applications">
              {[0, 1, 2].map((i) => (
                <Card key={i} className="rounded-2xl shadow-md">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-11 rounded-xl" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-1/3 rounded-full" />
                        <Skeleton className="h-3 w-1/4 rounded-full" />
                      </div>
                      <Skeleton className="h-6 w-16 rounded-full" />
                    </div>
                    <Skeleton className="h-9 w-full rounded-xl" />
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* error */}
          {loadError && (
            <Card className="rounded-2xl border-rose-200 dark:border-rose-900/60 shadow-md">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <p className="flex items-center gap-2 text-sm font-medium text-rose-600">
                  <AlertTriangle className="size-4" aria-hidden /> {loadError}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void fetchApplications()}
                  className="min-h-[40px] rounded-lg"
                >
                  <RefreshCw className="size-4" aria-hidden /> Retry
                </Button>
              </CardContent>
            </Card>
          )}

          {/* empty */}
          {applications !== null && !loadError && applications.length === 0 && (
            <Card className="rounded-2xl border-dashed shadow-sm">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Sparkles className="size-8 text-blue-400" aria-hidden />
                <h3 className="font-semibold text-slate-800 dark:text-slate-200">No applications yet</h3>
                <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
                  Browse open roles and apply — once shortlisted, your AI video interview
                  unlocks right here.
                </p>
                <Button
                  onClick={() => setView('browse')}
                  className="mt-1 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700"
                >
                  Browse Jobs
                </Button>
              </CardContent>
            </Card>
          )}

          {/* application cards */}
          {applications !== null &&
            !loadError &&
            applications.map((app) => (
              <div
                key={app.id}
                id={`candidate-application-${app.id}`}
                className={`scroll-mt-28 rounded-2xl transition-all ${
                  spotlightAppId === app.id
                    ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-white shadow-lg shadow-blue-100'
                    : ''
                }`}
              >
                <ApplicationCard
                  app={app}
                  inRoom={view === 'interview'}
                  sla={slaByApp.get(app.id)}
                />
              </div>
            ))}
        </TabsContent>

        {/* ========================== SAVED TAB =========================== */}
        <TabsContent value="saved" className="mt-5 focus-visible:outline-none">
          <SavedJobsTab />
        </TabsContent>

        {/* ==================== ALERTS TAB (chat feed + rules) ==================== */}
        <TabsContent value="alerts" className="mt-5 space-y-4 focus-visible:outline-none">
          <AlertsChatFeed
            user={user ? { id: user.id, name: user.name } : { id: '' }}
            onOpenJob={(jobId) => openJob(jobId)}
            onNavigate={(t) => {
              if (t === 'jobs') setView('browse')
              else setTab(t)
            }}
          />
          <JobAlertsTab />
        </TabsContent>

        {/* ========================= PROFILE TAB ========================== */}
        <TabsContent value="profile" className="mt-5 focus-visible:outline-none">
          {patchFailed && (
            <div
              role="status"
              className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
            >
              <AlertTriangle className="size-4 shrink-0 text-amber-500" aria-hidden />
              <span>
                Offline draft on this device — check your connection and press
                <strong className="font-semibold"> Save profile</strong> to sync it.
              </span>
            </div>
          )}

          {/* ---------- structured profile (photo, employment,
              education, projects, certifications, desired job, CV builder) ---------- */}
          <section aria-labelledby="profile-heading" className="mb-6">
            <h2
              id="profile-heading"
              className="mb-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-700 dark:text-slate-300"
            >
              <Sparkles className="size-4 text-blue-600" aria-hidden />
              Your complete profile
            </h2>
            <ProfileSections user={user} onProfileChanged={() => void reloadProfileFromServer()} />
          </section>

          {/* ---------- attached CV document (sent to recruiters) ---------- */}
          <section aria-labelledby="cv-attach-heading" className="mb-6">
            <h2
              id="cv-attach-heading"
              className="mb-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-700 dark:text-slate-300"
            >
              <FileText className="size-4 text-blue-600" aria-hidden />
              Your CV document
            </h2>
            <CvUploadCard />
          </section>

          {/* ---------- 1-minute video resume (record or upload) ---------- */}
          <section aria-labelledby="video-resume-heading" className="mb-6">
            <h2
              id="video-resume-heading"
              className="mb-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-700 dark:text-slate-300"
            >
              <Play className="size-4 text-violet-600" aria-hidden />
              Your video resume
            </h2>
            <VideoResumeCard user={user ? { id: user.id, name: user.name } : { id: '' }} />
          </section>

          {/* ---------- instant resume import (AI parser) ---------- */}
          <section aria-labelledby="resume-import-heading" className="mb-6">
            <h2
              id="resume-import-heading"
              className="mb-3 flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-700 dark:text-slate-300"
            >
              <Sparkles className="size-4 text-blue-600" aria-hidden />
              Instant resume import
            </h2>
            <ResumeParserCard
              candidateId={user.id}
              onApplied={() => void reloadProfileFromServer()}
            />
          </section>

          <form onSubmit={(e) => void saveProfile(e)}>
            <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-lg">
              <CardContent className="space-y-6 p-6 sm:p-7">
                <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                  <Field label="Full name" htmlFor="pf-name">
                    <Input
                      id="pf-name"
                      value={draft.name}
                      onChange={(e) => update('name', e.target.value)}
                      placeholder="Your full name"
                      className="min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 focus-visible:ring-blue-300"
                    />
                  </Field>
                  <Field label="Phone" htmlFor="pf-phone">
                    <Input
                      id="pf-phone"
                      value={draft.phone}
                      onChange={(e) => update('phone', e.target.value)}
                      placeholder="+91 …"
                      inputMode="tel"
                      className="min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 focus-visible:ring-blue-300"
                    />
                  </Field>
                  <Field label="Headline" htmlFor="pf-headline">
                    <Input
                      id="pf-headline"
                      value={draft.headline}
                      onChange={(e) => update('headline', e.target.value)}
                      placeholder="Senior Frontend Engineer · React"
                      className="min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 focus-visible:ring-blue-300"
                    />
                  </Field>
                  <Field label="Location" htmlFor="pf-location">
                    <div className="relative">
                      <MapPin
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                        aria-hidden
                      />
                      <Input
                        id="pf-location"
                        value={draft.location}
                        onChange={(e) => update('location', e.target.value)}
                        placeholder="Bengaluru, India"
                        className="min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 pl-9 focus-visible:ring-blue-300"
                      />
                    </div>
                  </Field>
                  <Field
                    label="Skills"
                    htmlFor="pf-skills"
                    hint="comma separated"
                  >
                    <Input
                      id="pf-skills"
                      value={draft.skills}
                      onChange={(e) => update('skills', e.target.value)}
                      placeholder="React, TypeScript, Node.js"
                      className="min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 focus-visible:ring-blue-300"
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Experience (yrs)" htmlFor="pf-exp">
                      <Input
                        id="pf-exp"
                        value={draft.experienceYears}
                        onChange={(e) => update('experienceYears', e.target.value)}
                        inputMode="decimal"
                        placeholder="4"
                        className="min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 focus-visible:ring-blue-300"
                      />
                    </Field>
                    <Field
                      label="Current salary"
                      htmlFor="pf-current"
                      hint="LPA"
                    >
                      <Input
                        id="pf-current"
                        value={draft.currentSalary}
                        onChange={(e) => update('currentSalary', e.target.value)}
                        inputMode="decimal"
                        placeholder="12"
                        className="min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 focus-visible:ring-blue-300"
                      />
                    </Field>
                    <Field
                      label="Expected salary"
                      htmlFor="pf-expected"
                      hint="LPA"
                    >
                      <Input
                        id="pf-expected"
                        value={draft.expectedSalary}
                        onChange={(e) => update('expectedSalary', e.target.value)}
                        inputMode="decimal"
                        placeholder="18"
                        className="min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 focus-visible:ring-blue-300"
                      />
                    </Field>
                  </div>
                  <Field label="Education" htmlFor="pf-edu" hint="spans full width on mobile">
                    <Input
                      id="pf-edu"
                      value={draft.education}
                      onChange={(e) => update('education', e.target.value)}
                      placeholder="B.Tech CSE, VIT Vellore · 2021"
                      className="min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 focus-visible:ring-blue-300 sm:col-span-1"
                    />
                  </Field>
                  <Field
                    label={
                      <span className="inline-flex items-center gap-1.5">
                        <CalendarClock className="size-4 text-blue-600" aria-hidden />
                        Notice period
                      </span>
                    }
                    htmlFor="pf-notice"
                    hint="recruiters filter by this"
                  >
                    <Select
                      value={draft.noticePeriodDays === '' ? 'unspecified' : draft.noticePeriodDays}
                      onValueChange={(v) =>
                        update('noticePeriodDays', v === 'unspecified' ? '' : v)
                      }
                    >
                      <SelectTrigger
                        id="pf-notice"
                        aria-label="Notice period"
                        className="min-h-[44px] rounded-xl border-slate-200 dark:border-slate-800 focus-visible:ring-blue-300"
                      >
                        <SelectValue placeholder="Select notice period" />
                      </SelectTrigger>
                      <SelectContent>
                        {NOTICE_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {/* Profile visibility toggle — instant save, outside the form draft */}
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40 sm:col-span-2">
                    <div className="min-w-0">
                      <Label
                        htmlFor="pf-visible"
                        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700 dark:text-slate-300"
                      >
                        <Eye className="size-4 text-blue-600" aria-hidden />
                        Visible to recruiters
                      </Label>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                        {profileVisible
                          ? 'Your profile appears in recruiter talent searches.'
                          : 'Hidden — recruiters cannot find you in talent search. Applications stay active.'}
                      </p>
                    </div>
                    <Switch
                      id="pf-visible"
                      aria-label="Toggle profile visibility to recruiters"
                      checked={profileVisible}
                      disabled={visibilitySaving}
                      onCheckedChange={(v) => void toggleProfileVisibility(v)}
                      className="data-[state=checked]:bg-blue-600"
                    />
                  </div>
                </div>

                <Separator />

                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label
                      htmlFor="pf-resume"
                      className="text-[13px] font-medium text-slate-700 dark:text-slate-300"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <FileText className="size-4 text-blue-600" aria-hidden />
                        Resume summary
                      </span>
                    </Label>
                    <div className="flex items-center gap-2">
                      <span
                        id="pf-resume-count"
                        className="text-[11px] text-slate-400 dark:text-slate-500"
                      >
                        {draft.resumeText.length} characters
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => void generateSummaryWithAi()}
                        disabled={aiSummaryLoading || saving}
                        aria-label="Write the resume summary with AI"
                        className="h-8 min-h-[36px] gap-1.5 rounded-lg border-blue-200 bg-blue-50/60 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-300 dark:hover:bg-blue-950/70"
                      >
                        {aiSummaryLoading ? (
                          <>
                            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Writing…
                          </>
                        ) : (
                          <>
                            <Sparkles className="size-3.5" aria-hidden /> Write with AI
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    id="pf-resume"
                    value={draft.resumeText}
                    onChange={(e) => update('resumeText', e.target.value)}
                    placeholder="Paste, compose — or tap “Write with AI” to draft it from your details above. The AI interviewer builds questions from this."
                    aria-describedby="pf-resume-count"
                    className="min-h-[220px] resize-y rounded-xl border-slate-200 dark:border-slate-800 text-sm leading-relaxed focus-visible:ring-blue-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar]:w-1.5"
                  />
                </div>

                {/* ------------------- portfolio & verified links ------------------- */}
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-4 space-y-4">
                  <div>
                    <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                      <FileBarChart className="size-4 text-violet-500" aria-hidden /> Portfolio &amp; verified links
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                      Recruiters see these on your profile — keep them current.
                    </p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="GitHub" htmlFor="pf-github">
                      <Input id="pf-github" inputMode="url" placeholder="https://github.com/yourhandle" value={draft.githubUrl} onChange={(e) => update('githubUrl', e.target.value)} className="min-h-[44px] rounded-xl" />
                    </Field>
                    <Field label="Professional profile" htmlFor="pf-linkedin">
                      <Input id="pf-linkedin" inputMode="url" placeholder="https://…/in/yourhandle" value={draft.linkedinUrl} onChange={(e) => update('linkedinUrl', e.target.value)} className="min-h-[44px] rounded-xl" />
                    </Field>
                    <Field label="Design portfolio" htmlFor="pf-behance">
                      <Input id="pf-behance" inputMode="url" placeholder="https://…/yourhandle" value={draft.behanceUrl} onChange={(e) => update('behanceUrl', e.target.value)} className="min-h-[44px] rounded-xl" />
                    </Field>
                    <Field label="Personal site" htmlFor="pf-portfolio">
                      <Input id="pf-portfolio" inputMode="url" placeholder="https://yoursite.dev" value={draft.portfolioUrl} onChange={(e) => update('portfolioUrl', e.target.value)} className="min-h-[44px] rounded-xl" />
                    </Field>
                  </div>
                </div>

                {/* ------------------- privacy shield (current employer block) ------------------- */}
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30 p-4 space-y-2">
                  <p className="text-[13px] font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                    <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden /> Privacy shield — hide from your current employer
                  </p>
                  <Field
                    label="Current employer (private)"
                    htmlFor="pf-employer"
                    hint="Never shown to anyone"
                  >
                    <Input
                      id="pf-employer"
                      placeholder="e.g. Infosys — recruiters from this company won't see you"
                      value={draft.currentEmployer}
                      onChange={(e) => update('currentEmployer', e.target.value)}
                      className="min-h-[44px] rounded-xl border-emerald-200 dark:border-emerald-900/60"
                      maxLength={80}
                    />
                  </Field>
                  <p className="text-xs leading-relaxed text-emerald-700/80 dark:text-emerald-400/80">
                    While this is set, recruiters who hire for this company can never find your
                    profile in talent search — anonymous browsing, guaranteed. You still see and can
                    apply to every job.
                  </p>
                </div>

                <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">
                    Saved drafts power your AI interview questions — keep them sharp.
                  </p>
                  <Button
                    type="submit"
                    disabled={saving}
                    className="min-h-[44px] rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 px-6 font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden /> Saving…
                      </>
                    ) : (
                      <>
                        <Save className="size-4" aria-hidden /> Save Profile
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function Field(props: {
  label: ReactNode
  htmlFor: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={props.htmlFor} className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
          {props.label}
        </Label>
        {props.hint ? (
          <span className="text-[11px] text-slate-400 dark:text-slate-500">{props.hint}</span>
        ) : null}
      </div>
      {props.children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ApplicationTimeline — e-commerce parcel-tracking style journey       */
/* Applied → Viewed → Shortlisted → Interview → Offer → Hired.          */
/* Wraps to 3+3 nodes on mobile, single row with connectors on sm+.     */
/* ------------------------------------------------------------------ */

function ApplicationTimeline({ app, sla }: { app: Application; sla?: SlaOverdue }) {
  const { done, current, rejected } = timelineState(app.status, app.viewedAt, app.offerStatus)
  const appliedStamp = shortDateSafe(app.createdAt)
  const viewedStamp = shortDateSafe(app.viewedAt)
  const last = TIMELINE_NODES.length - 1

  return (
    <div>
      {(sla || rejected) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {sla && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlarmClock className="size-3" aria-hidden />
              Reminder sent · {sla.daysWaiting}d waiting
            </span>
          )}
          {rejected && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-300 bg-rose-50 px-2.5 py-0.5 text-[11px] font-semibold text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <XCircle className="size-3" aria-hidden /> Not moving forward
            </span>
          )}
        </div>
      )}
      <ol
        className={`grid grid-cols-3 gap-y-3 rounded-2xl bg-slate-50/80 px-3 py-4 dark:bg-slate-800/60 sm:grid-cols-6 sm:px-4 ${
          rejected ? 'opacity-60' : ''
        }`}
        aria-label="Application journey"
      >
        {TIMELINE_NODES.map((label, i) => {
          const isDone = !rejected && done[i]
          const isCurrent = i === current
          // We only date the two steps we actually track — later nodes show
          // no timestamp rather than an invented one.
          const stamp = i === 0 ? appliedStamp : i === 1 ? viewedStamp : ''
          // Connector segments light up emerald only between two done nodes
          const solidLeft = i > 0 && !rejected && done[i - 1] && done[i]
          const solidRight = i < last && !rejected && done[i] && done[i + 1]
          return (
            <li key={label} className="flex min-w-0 flex-col items-center gap-1.5">
              <div className="flex w-full items-center justify-center sm:justify-start">
                {/* connector line before (sm+ single row only) */}
                <span
                  aria-hidden
                  className={`hidden h-px flex-1 sm:block ${
                    i === 0
                      ? 'opacity-0'
                      : solidLeft
                        ? 'bg-emerald-400'
                        : 'border-t border-dashed border-slate-300 dark:border-slate-600'
                  }`}
                />
                <span className="grid size-6 shrink-0 place-items-center">
                  {isCurrent ? (
                    <span className="relative grid place-items-center">
                      <span
                        className="absolute inset-0 animate-ping rounded-full bg-violet-300/60 dark:bg-violet-500/40"
                        aria-hidden
                      />
                      <span className="size-3 rounded-full bg-violet-500 ring-2 ring-white dark:ring-slate-800" />
                    </span>
                  ) : rejected && done[i] ? (
                    // greyed progress — how far it got before the stop
                    <span className="size-3 rounded-full bg-slate-400 dark:bg-slate-500" />
                  ) : isDone ? (
                    <span className="size-3 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" />
                  ) : (
                    <span className="size-3 rounded-full border-2 border-slate-300 dark:border-slate-600" />
                  )}
                </span>
                {/* connector line after */}
                <span
                  aria-hidden
                  className={`hidden h-px flex-1 sm:block ${
                    i === last
                      ? 'opacity-0'
                      : solidRight
                        ? 'bg-emerald-400'
                        : 'border-t border-dashed border-slate-300 dark:border-slate-600'
                  }`}
                />
              </div>
              <span
                className={`max-w-full truncate text-center text-[10px] font-medium leading-tight sm:text-[11px] ${
                  isCurrent
                    ? 'font-semibold text-violet-700 dark:text-violet-300'
                    : isDone
                      ? 'text-slate-600 dark:text-slate-300'
                      : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {label}
              </span>
              {stamp ? (
                <span className="text-[9px] leading-none text-slate-400 dark:text-slate-500">
                  {stamp}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function ApplicationCard({ app, inRoom, sla }: { app: Application; inRoom: boolean; sla?: SlaOverdue }) {
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const storeUser = useAppStore((s) => s.user)
  const job = app.job
  const shortlists = app.shortlists ?? []
  const primaryShortlist = shortlists[0]
  const interview = primaryShortlist?.interview

  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)

  const activeResume = Boolean(interview?.status === 'IN_PROGRESS' && !inRoom)
  const invited = interview?.status === 'PENDING' // recruiter sent the AI interview invite
  const completed = interview?.status === 'COMPLETED'
  // Candidate privacy: AI verdict/score are never shown on candidate surfaces
  const shared =
    primaryShortlist?.status === 'REPORT_SHARED' ||
    app.status === 'SHARED_WITH_CLIENT'

  const rejected = app.status === 'REJECTED'
  const hired = app.status === 'HIRED' || app.status === 'ONBOARDED'

  const companyInitial = (job?.company ?? job?.title ?? 'S').trim().charAt(0).toUpperCase()

  /** Shell listens for this event and starts the room (see page shell code). */
  function requestStartInterview() {
    document.dispatchEvent(
      new CustomEvent<string>('seewee:start-interview', {
        detail: primaryShortlist?.id || app.id,
      })
    )
  }

  async function withdraw() {
    setWithdrawing(true)
    try {
      const res = await fetch(`/api/applications/${app.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'REJECTED', candidateId: storeUser?.id }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to withdraw')
      toast.success(`Application for ${job?.title ?? 'this role'} withdrawn`)
      setWithdrawOpen(false)
      bumpRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not withdraw application')
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-slate-200 dark:border-slate-800 shadow-lg transition-shadow hover:shadow-xl">
      {/* job mini-card header */}
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <Avatar className="size-11 shrink-0 rounded-xl border border-slate-100 dark:border-slate-800/60">
            <AvatarFallback className="rounded-xl bg-gradient-to-br from-blue-500 to-sky-600 text-sm font-bold text-white">
              {companyInitial}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="truncate text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                {job?.title ?? 'Untitled role'}
              </h3>
              {app.matchScore != null && (
                <Badge
                  variant="outline"
                  className={`gap-1 rounded-full ${matchBadgeClass(app.matchScore)}`}
                >
                  <Star className="size-3" aria-hidden />
                  {matchBadgeText(app.matchScore)}
                </Badge>
              )}
              {app.status === 'OFFERED' && (
                <Badge
                  variant="outline"
                  className="gap-1 rounded-full border-violet-300 bg-violet-50 px-2.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                >
                  <BadgeCheck className="size-3" aria-hidden /> Offer received
                </Badge>
              )}
              {(app.status === 'HIRED' || app.status === 'ONBOARDED') && (
                <Badge className="gap-1 rounded-full border-emerald-600 bg-emerald-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                  <PartyPopper className="size-3" aria-hidden />
                  {app.status === 'ONBOARDED' ? 'Onboarded 🎉' : 'Hired 🎉'}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium text-slate-600 dark:text-slate-400">
                {job?.company ?? 'Unknown company'}
              </span>
              {job?.location ? (
                <>
                  ·
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="size-3" aria-hidden /> {job.location}
                  </span>
                </>
              ) : null}
              {job?.workMode ? <>· {job.workMode}</> : null}
              {app.viewedAt ? (
                <>
                  ·
                  <span
                    className="inline-flex items-center gap-0.5 font-medium text-blue-700"
                    title={`A recruiter first opened this application ${timeAgoSafe(app.viewedAt)}`}
                  >
                    <Eye className="size-3" aria-hidden /> Viewed by recruiter ·{' '}
                    {timeAgoSafe(app.viewedAt)}
                  </span>
                </>
              ) : app.status === 'APPLIED' ? (
                <>
                  ·
                  <span className="inline-flex items-center gap-0.5 text-slate-400 dark:text-slate-500">
                    <Eye className="size-3" aria-hidden /> Awaiting recruiter review
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-xs font-semibold text-blue-700">
              {formatLpa(job?.salaryMinLpa, job?.salaryMaxLpa)}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
              <CalendarClock className="size-3" aria-hidden />
              {timeAgoSafe(app.createdAt)}
            </span>
          </div>
        </div>

        {/* -------- parcel-tracking journey + transparency SLA chip -------- */}
        <ApplicationTimeline app={app} sla={sla} />

        {/* -------------------- interview status strip ----------------------- */}
        {(activeResume || invited || completed || shared || rejected || hired || app.status === 'APPLIED') && (
          <div className="space-y-2.5 pt-0.5">
            {/* 🎉 The offer moment — full celebration card */}
            {hired && (
              <div
                role="status"
                aria-label="Offer received"
                className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-3 text-white shadow-lg shadow-emerald-600/25"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20" aria-hidden>
                  <PartyPopper className="size-4.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-bold leading-tight">
                    {app.status === 'ONBOARDED'
                      ? 'Onboarding complete — welcome aboard!'
                      : 'Offer received — congratulations!'}
                  </span>
                  <span className="block truncate text-xs text-white/85">
                    {job?.company ?? 'The hiring team'} has marked you{' '}
                    {app.status === 'ONBOARDED' ? 'ONBOARDED' : 'HIRED'} for{' '}
                    {job?.title ?? 'this role'}.
                  </span>
                </span>
              </div>
            )}
            {/* 🎤 AI interview invite — the recruiter sent this candidate their
                interview; the candidate takes it from here (never the recruiter). */}
            {invited && (
              <button
                type="button"
                onClick={requestStartInterview}
                aria-label="Take AI interview"
                className="flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 px-4 py-2.5 text-white shadow-lg shadow-blue-600/25 transition-transform hover:scale-[1.01]"
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className="relative grid place-items-center" aria-hidden>
                    <span className="absolute size-4 animate-ping rounded-full bg-white/50" />
                    <Play className="relative size-4 fill-current" />
                  </span>
                  Take AI Interview 🎤
                </span>
                <span className="text-[11px] font-normal text-white/85">
                  Invite received — answer voice &amp; typed questions set by the hiring team
                </span>
              </button>
            )}

            {/* Resume AI Interview banner — pulsing gradient CTA.
                NOTE: this dispatches 'seewee:start-interview' which the app
                shell listens for; the shell sets activeShortlistId via the
                store and mounts <InterviewRoom/> fullscreen. */}
            {activeResume && (
              <button
                type="button"
                onClick={requestStartInterview}
                aria-label="Resume AI interview"
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 px-4 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-transform hover:scale-[1.01]"
              >
                <span className="relative grid place-items-center" aria-hidden>
                  <span className="absolute size-4 animate-ping rounded-full bg-white/50" />
                  <Play className="relative size-4 fill-current" />
                </span>
                Resume AI Interview
              </button>
            )}

            {completed && interview && (
              <button
                type="button"
                onClick={requestStartInterview}
                aria-label="Review your interview answers"
                className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-card px-3.5 py-2.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  <FileBarChart className="size-3.5 text-blue-600" aria-hidden />
                  Interview completed — tap to review your answers
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="size-3.5" aria-hidden /> Submitted
                </span>
              </button>
            )}

            {shared && (
              <Badge className="w-fit gap-1.5 rounded-full border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/40 px-3 py-1 text-blue-700 shadow-[0_0_16px_-4px_rgba(59,130,246,0.65)]">
                <Send className="size-3" aria-hidden />
                Shared with{primaryShortlist?.client?.name ? ` ${primaryShortlist.client.name}` : ' client'}
              </Badge>
            )}

            {/* Withdraw — only while still just APPLIED (nothing else started) */}
            {app.status === 'APPLIED' && (
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  onClick={() => setWithdrawOpen(true)}
                  className="h-9 min-h-[44px] rounded-lg px-3 text-xs font-medium text-slate-400 dark:text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
                >
                  <XCircle className="size-3.5" aria-hidden /> Withdraw application
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <AlertDialogContent className="max-w-sm rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this application?</AlertDialogTitle>
            <AlertDialogDescription>
              Your application for “{job?.title ?? 'this role'}” at{' '}
              {job?.company ?? 'the company'} will be marked as withdrawn. You can always apply
              again later if the role is still open.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-lg sm:h-9">Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void withdraw()}
              disabled={withdrawing}
              className="h-11 rounded-lg bg-rose-600 text-white hover:bg-rose-700 sm:h-9"
            >
              {withdrawing ? 'Withdrawing…' : 'Withdraw'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}


/* -------------------------------------------------------------------------- */
/* OfferCard — prominent accept/decline surface for a live (SENT) offer        */
/* Shows ONLY offer facts: title, company, salary, joining date, work mode.    */
/* Never any AI scores or screen data (product + privacy rule).                */
/* -------------------------------------------------------------------------- */

function OfferCard({
  app,
  userId,
  onChanged,
}: {
  app: Application
  userId: string
  /** re-fetches applications + notifications after accept/decline */
  onChanged: () => void
}) {
  const job = app.job
  const letter = parseOfferLetter(app.offerLetter)
  const [letterOpen, setLetterOpen] = useState(false)
  const [confirmDecline, setConfirmDecline] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)

  async function respond(action: 'accept' | 'decline') {
    if (busy) return
    setBusy(action)
    try {
      const res = await fetch(`/api/applications/${app.id}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, userId }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Could not respond to the offer')
      if (action === 'accept') {
        toast.success('🎊 Offer accepted — welcome aboard! Your onboarding starts now.')
      } else {
        toast.success('Offer declined — the hiring team has been notified.')
      }
      setLetterOpen(false)
      setConfirmDecline(false)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not respond to the offer')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card className="overflow-hidden rounded-2xl border-violet-300 shadow-lg shadow-violet-600/10 dark:border-violet-800">
      <CardContent className="space-y-3.5 p-5">
        <div className="flex items-start gap-3">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-md shadow-violet-600/25"
            aria-hidden
          >
            <PartyPopper className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold leading-tight tracking-tight text-slate-900 dark:text-slate-100">
              🎉 You have an offer — {job?.title ?? 'a new role'} at{' '}
              {job?.company ?? 'the hiring team'}
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Congratulations! Review the letter and let the team know your decision.
            </p>
          </div>
        </div>

        {/* offer facts — no scores, ever */}
        <div className="flex flex-wrap gap-2">
          {letter && letter.salaryLpa > 0 && (
            <Badge
              variant="outline"
              className="gap-1 rounded-full border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <Briefcase className="size-3.5" aria-hidden /> ₹{letter.salaryLpa} LPA
            </Badge>
          )}
          {letter?.joiningDate && (
            <Badge
              variant="outline"
              className="gap-1 rounded-full border-violet-300 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
            >
              <CalendarClock className="size-3.5" aria-hidden /> Join{' '}
              {format(new Date(letter.joiningDate), 'MMMM d, yyyy')}
            </Badge>
          )}
          {letter?.workMode && (
            <Badge
              variant="outline"
              className="gap-1 rounded-full border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
            >
              <MapPin className="size-3.5" aria-hidden /> {letter.workMode}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setLetterOpen(true)}
            className="min-h-[44px] flex-1 rounded-xl border-violet-300 text-violet-700 hover:bg-violet-50 sm:flex-none dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40"
            aria-label="View the full offer letter"
          >
            <FileText className="size-4" aria-hidden /> View offer letter
          </Button>
          <Button
            onClick={() => void respond('accept')}
            disabled={busy !== null}
            className="min-h-[44px] flex-1 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-600/25 hover:from-emerald-700 hover:to-teal-700 sm:flex-none"
            aria-label="Accept the offer"
          >
            {busy === 'accept' ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden />
            )}
            Accept offer
          </Button>
          {confirmDecline ? (
            <div
              className="flex w-full items-center justify-end gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2 dark:border-rose-900/60 dark:bg-rose-950/30"
              role="alert"
            >
              <span className="text-xs font-medium text-rose-700 dark:text-rose-300">
                Are you sure?
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => setConfirmDecline(false)}
                className="h-8 min-h-[36px] rounded-lg px-2.5 text-xs text-slate-500 hover:text-slate-700"
              >
                Keep it
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void respond('decline')}
                className="h-8 min-h-[36px] rounded-lg border-rose-300 px-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-100"
                aria-label="Confirm declining the offer"
              >
                {busy === 'decline' ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <XCircle className="size-3.5" aria-hidden />
                )}
                Yes, decline
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setConfirmDecline(true)}
              className="min-h-[44px] rounded-xl px-3 text-xs font-medium text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-300"
              aria-label="Decline the offer"
            >
              <XCircle className="size-3.5" aria-hidden /> Decline
            </Button>
          )}
        </div>
      </CardContent>

      {/* offer letter reader */}
      <Dialog open={letterOpen} onOpenChange={setLetterOpen}>
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-start gap-2 text-left">
              <BadgeCheck className="mt-0.5 size-5 shrink-0 text-violet-600" aria-hidden />
              <span className="text-sm leading-snug">{letter?.subject ?? 'Your offer letter'}</span>
            </DialogTitle>
            <DialogDescription>
              {job?.title} · {job?.company ?? 'the hiring team'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/60 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar]:w-1.5 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700">
            <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              {letter?.body ?? 'The full letter will appear here once generated.'}
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => setLetterOpen(false)}
              className="min-h-[40px] rounded-lg"
            >
              Close
            </Button>
            <Button
              onClick={() => void respond('accept')}
              disabled={busy !== null}
              className="min-h-[40px] rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-700 hover:to-teal-700"
            >
              {busy === 'accept' ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden />
              )}
              Accept offer
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
