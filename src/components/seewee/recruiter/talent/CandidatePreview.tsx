'use client'

/**
 * CandidatePreview — the recruiter's candidate workspace drawer.
 *
 * Tabs inside one dialog:
 *   • Profile — full profile (privacy: contact masked until revealed through
 *     the logged + quota-tracked endpoint), work history, education,
 *     certifications, scrubbed resume, CV download.
 *   • Sourcing — status workflow (11 statuses), note, tags, follow-up
 *     reminder, team assignment, activity history (immutable trail).
 *   • Match — transparent candidate-vs-job scoring with per-component
 *     evidence + optional AI rationale (advisory, labelled).
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Award,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Download,
  Eye,
  EyeOff,
  FileText,
  GraduationCap,
  Languages,
  Loader2,
  Mail,
  MapPin,
  Phone,
  ShieldAlert,
  Sparkles,
  Target,
  UserCog,
  Users,
  Video,
  Wallet,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
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
import { SOURCING_STATUSES, SOURCING_STATUS_META, type SourcingStatus } from '@/lib/talent-constants'
import { noticeLabel } from './CandidateCard'

interface JobLite {
  id: string
  title: string
  company: string
}

interface TeammateLite {
  id: string
  name: string
  company?: string | null
}

interface ProfileData {
  id: string
  name: string
  email?: string | null
  phone?: string | null
  headline?: string | null
  location?: string | null
  skills?: string | null
  experienceYears?: number | null
  expectedSalary?: number | null
  currentSalary?: number | null
  education?: string | null
  resumeText?: string | null
  avatarSeed?: string | null
  noticePeriodDays?: number | null
  githubUrl?: string | null
  linkedinUrl?: string | null
  portfolioUrl?: string | null
  cvFileName?: string | null
  industry?: string | null
  functionalArea?: string | null
  preferredLocations?: string | null
  languages?: string | null
  employmentTypePref?: string | null
  lastActiveAt?: string | null
  profileSource?: string | null
  contactMasked?: boolean
  sections?: {
    experiences?: { id: string; title: string; company: string; isCurrent: boolean; startDate: string; endDate?: string | null; description?: string | null }[]
    education?: { id: string; degree: string; institution: string; startYear?: string | null; endYear?: string | null }[]
    certifications?: { id: string; name: string; issuer?: string | null; year?: string | null }[]
  }
}

interface JdParsed {
  roleTitle: string
  minYears: number | null
  maxYears: number | null
  mustHaveSkills: string[]
  goodToHaveSkills: string[]
  responsibilities: string[]
  location: string
}

interface MatchData {
  source: 'job' | 'jd'
  job: { id: string; title: string; company: string } | null
  parseEngine: 'structured' | 'AI' | 'keyword'
  match: {
    overall: number
    verdictLabel: string
    verdict: string
    missingMandatory: string[]
    coreGate: { applied: boolean; coreScore: number | null; reason: string }
    components: { key: string; label: string; state: string; detail: string; evidence: string[]; weight: number }[]
    contextChecks: { key: string; label: string; state: string; detail: string }[]
    jdParsed: JdParsed
  }
  aiSummary: string | null
  engine: 'rules-only' | 'rules+AI'
  advisory: string
}

interface SimilarCandidate {
  id: string
  name: string
  headline: string | null
  location: string | null
  maskedEmail: string | null
  experienceYears: number | null
  expectedSalary: number | null
  profileSource: string | null
  topSkills: string[]
  sharedSkills: string[]
  matchPercent: number
  sameIndustry: boolean
  sameFunctionalArea: boolean
}

interface CvVersionMeta {
  id: string
  label: string
  fileName: string
  isActive: boolean
  createdAt: string
}

interface SourcingState {
  status: string
  note: string
  tags: string
  followUpAt: string
  assignedToId: string
  lastContactedAt: string
  history: { at: string; actor: string; action: string }[]
}

interface CandidatePreviewProps {
  candidateId: string
  candidateName: string
  recruiterId: string
  jobs: JobLite[]
  teammates: TeammateLite[]
  onClose: () => void
  onSourcingChanged: () => void
  /** pivot to another candidate (Similar-candidates navigation) */
  onOpenCandidate?: (candidateId: string, candidateName: string) => void
}

const EMPTY_STATE: SourcingState = { status: 'NEW', note: '', tags: '', followUpAt: '', assignedToId: '', lastContactedAt: '', history: [] }

export function CandidatePreview({
  candidateId,
  candidateName,
  recruiterId,
  jobs,
  teammates,
  onClose,
  onSourcingChanged,
  onOpenCandidate,
}: CandidatePreviewProps) {
  const [tab, setTab] = useState<'profile' | 'similar' | 'sourcing' | 'match'>('profile')
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // contact reveal
  const [contact, setContact] = useState<{ email: string; phone: string | null } | null>(null)
  const [revealing, setRevealing] = useState(false)

  // CV versions (dedicated download card in the Profile tab)
  const [cvVersions, setCvVersions] = useState<CvVersionMeta[]>([])
  const [cvOlderOpen, setCvOlderOpen] = useState(false)

  // sourcing
  const [sourcing, setSourcing] = useState<SourcingState>(EMPTY_STATE)
  const [sourcingLoading, setSourcingLoading] = useState(false)
  const [sourcingSaving, setSourcingSaving] = useState(false)

  // match — two sources: a posted job OR a pasted JD (user rule: JD decides)
  const [matchMode, setMatchMode] = useState<'job' | 'jd'>(jobs.length > 0 ? 'job' : 'jd')
  const [jobId, setJobId] = useState<string>('')
  const [jdText, setJdText] = useState<string>('')
  const [matchData, setMatchData] = useState<MatchData | null>(null)
  const [matching, setMatching] = useState(false)
  const [showContextFilters, setShowContextFilters] = useState(false)
  const [ctxLocation, setCtxLocation] = useState('')
  const [ctxNotice, setCtxNotice] = useState('')
  const [ctxCtc, setCtxCtc] = useState('')

  // similar candidates
  const [similar, setSimilar] = useState<SimilarCandidate[]>([])
  const [similarLoading, setSimilarLoading] = useState(false)
  const [similarError, setSimilarError] = useState<string | null>(null)
  const [similarScanned, setSimilarScanned] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    setCvVersions([])
    Promise.all([
      fetch(`/api/candidates/${encodeURIComponent(candidateId)}?viewerId=${encodeURIComponent(recruiterId)}`),
      fetch(`/api/candidates/${encodeURIComponent(candidateId)}/resume-versions`).catch(() => null),
    ])
      .then(async ([profileRes, versionsRes]) => {
        const json: { data?: ProfileData; error?: string } = await profileRes.json()
        if (!alive) return
        if (json.error) throw new Error(json.error)
        setProfile(json.data ?? null)
        if (versionsRes && versionsRes.ok) {
          const vj: { data?: CvVersionMeta[] } = await versionsRes.json()
          if (alive && Array.isArray(vj.data)) setCvVersions(vj.data)
        }
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load profile')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [candidateId, recruiterId])

  const loadSourcing = useCallback(async () => {
    setSourcingLoading(true)
    try {
      const res = await fetch(
        `/api/sourcing?recruiterId=${encodeURIComponent(recruiterId)}&candidateIds=${encodeURIComponent(candidateId)}`
      )
      const json: { data?: { status: string; note?: string | null; tags?: string | null; followUpAt?: string | null; assignedToId?: string | null; lastContactedAt?: string | null; history?: SourcingState['history'] }[]; error?: string } = await res.json()
      const row = json.data?.[0]
      if (row) {
        setSourcing({
          status: row.status || 'NEW',
          note: row.note || '',
          tags: row.tags || '',
          followUpAt: row.followUpAt ? row.followUpAt.slice(0, 10) : '',
          assignedToId: row.assignedToId || '',
          lastContactedAt: row.lastContactedAt ? row.lastContactedAt.slice(0, 10) : '',
          history: row.history || [],
        })
      } else {
        setSourcing(EMPTY_STATE)
      }
    } catch {
      /* keep empty state */
    } finally {
      setSourcingLoading(false)
    }
  }, [recruiterId, candidateId])

  useEffect(() => {
    loadSourcing()
  }, [loadSourcing])

  const revealContact = async () => {
    setRevealing(true)
    try {
      const res = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId }),
      })
      const json: { data?: { email: string; phone: string | null }; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to reveal contact')
      setContact({ email: json.data!.email, phone: json.data!.phone })
      toast.success('Contact revealed', { description: 'This action is logged in your sourcing activity.' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reveal contact')
    } finally {
      setRevealing(false)
    }
  }

  const saveSourcing = async (overrides?: Partial<SourcingState>) => {
    setSourcingSaving(true)
    const next = { ...sourcing, ...overrides }
    try {
      const body: Record<string, unknown> = {
        recruiterId,
        candidateId,
        status: next.status,
      }
      if (next.note !== undefined) body.note = next.note
      if (next.tags !== undefined) body.tags = next.tags
      if (next.followUpAt) body.followUpAt = new Date(next.followUpAt).toISOString()
      if (next.lastContactedAt) body.lastContactedAt = new Date(next.lastContactedAt).toISOString()
      body.assignedToId = next.assignedToId || ''
      const res = await fetch('/api/sourcing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json: { data?: { ok: boolean; error?: string }[]; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to save')
      const first = json.data?.[0]
      if (first && !first.ok) throw new Error(first.error || 'Failed to save')
      setSourcing(next)
      toast.success('Sourcing tracker updated')
      onSourcingChanged()
      loadSourcing()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save tracker')
    } finally {
      setSourcingSaving(false)
    }
  }

  const runMatch = async () => {
    if (matchMode === 'job' && !jobId) return
    if (matchMode === 'jd' && !jdText.trim()) return
    setMatching(true)
    setMatchData(null)
    try {
      const payload: Record<string, unknown> = { recruiterId, candidateId }
      if (matchMode === 'job' && jobId) payload.jobId = jobId
      if (matchMode === 'jd' && jdText.trim()) {
        payload.jdText = jdText.trim()
        const cf: Record<string, unknown> = {}
        if (ctxLocation.trim()) cf.location = ctxLocation.trim()
        if (ctxNotice && Number(ctxNotice) > 0) cf.maxNoticeDays = Number(ctxNotice)
        if (ctxCtc && Number(ctxCtc) > 0) cf.maxExpectedCtc = Number(ctxCtc)
        if (Object.keys(cf).length > 0) payload.contextFilters = cf
      }
      const res = await fetch('/api/sourcing/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json: { data?: MatchData; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to compute match')
      setMatchData(json.data ?? null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to compute match')
    } finally {
      setMatching(false)
    }
  }

  const loadSimilar = useCallback(async () => {
    setSimilarLoading(true)
    setSimilarError(null)
    try {
      const res = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/similar?viewerId=${encodeURIComponent(recruiterId)}`)
      const json: { data?: { similar: SimilarCandidate[]; scannedPool: number }; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load similar candidates')
      setSimilar(json.data?.similar ?? [])
      setSimilarScanned(json.data?.scannedPool ?? 0)
    } catch (err) {
      setSimilarError(err instanceof Error ? err.message : 'Failed to load similar candidates')
    } finally {
      setSimilarLoading(false)
    }
  }, [candidateId, recruiterId])

  useEffect(() => {
    if (tab === 'similar' && similar.length === 0 && !similarLoading && !similarError) {
      loadSimilar()
    }
  }, [tab, similar.length, similarLoading, similarError, loadSimilar])

  const initials = (profile?.name || candidateName)
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('')

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[92vh] max-h-[92vh] w-[96vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1200px] sm:w-[96vw]">
        <DialogHeader className="border-b border-slate-100 px-5 pb-3 pt-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <Avatar className="size-11 rounded-lg">
              <AvatarFallback className="rounded-lg bg-teal-100 text-sm font-bold text-teal-800 dark:bg-teal-900/50 dark:text-teal-300">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <DialogTitle className="truncate text-left text-base">{profile?.name || candidateName}</DialogTitle>
              <DialogDescription className="truncate text-left text-xs">
                {profile?.headline || 'Loading…'}
                {profile?.location ? ` · ${profile.location}` : ''}
              </DialogDescription>
            </div>
            {profile?.profileSource === 'SYNTHETIC_SEED' && (
              <Badge variant="outline" className="ml-auto shrink-0 text-[10px] text-slate-400">
                synthetic test profile
              </Badge>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {(
              [
                ['profile', 'Profile', <Eye key="i" className="size-3" aria-hidden />],
                ['similar', 'Similar candidates', <Sparkles key="i" className="size-3" aria-hidden />],
                ['sourcing', 'Sourcing tracker', <UserCog key="i" className="size-3" aria-hidden />],
                ['match', 'Match vs JD', <Target key="i" className="size-3" aria-hidden />],
              ] as const
            ).map(([key, label, icon]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  tab === key
                    ? 'bg-teal-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
                aria-pressed={tab === key}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {error && !loading && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </div>
          )}

          {/* ── PROFILE TAB (two-column on wide screens — full-view) ────── */}
          {!loading && profile && tab === 'profile' && (
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-2">
              <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                {profile.experienceYears !== null && profile.experienceYears !== undefined && (
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <span className="block text-[10px] uppercase text-slate-400">Experience</span>
                    <span className="font-semibold">{profile.experienceYears} yrs</span>
                  </div>
                )}
                {profile.currentSalary !== null && profile.currentSalary !== undefined && (
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <span className="block text-[10px] uppercase text-slate-400">Current CTC</span>
                    <span className="font-semibold">₹{profile.currentSalary} LPA</span>
                  </div>
                )}
                {profile.expectedSalary !== null && profile.expectedSalary !== undefined && (
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <span className="block text-[10px] uppercase text-slate-400">Expected CTC</span>
                    <span className="font-semibold">₹{profile.expectedSalary} LPA</span>
                  </div>
                )}
                {profile.noticePeriodDays !== null && profile.noticePeriodDays !== undefined && (
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <span className="block text-[10px] uppercase text-slate-400">Notice</span>
                    <span className="font-semibold">{noticeLabel(profile.noticePeriodDays)}</span>
                  </div>
                )}
                {profile.industry && (
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <span className="block text-[10px] uppercase text-slate-400">Industry</span>
                    <span className="truncate font-semibold">{profile.industry}</span>
                  </div>
                )}
                {profile.employmentTypePref && (
                  <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
                    <span className="block text-[10px] uppercase text-slate-400">Prefers</span>
                    <span className="font-semibold">{profile.employmentTypePref}</span>
                  </div>
                )}
              </div>

              {/* contact reveal card */}
              <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900 dark:bg-teal-950/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300">
                    <Mail className="size-3.5" aria-hidden /> Contact details
                  </span>
                  {!contact ? (
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 gap-1 bg-teal-600 text-[11px] text-white hover:bg-teal-700"
                      onClick={revealContact}
                      disabled={revealing}
                    >
                      {revealing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Eye className="size-3" aria-hidden />}
                      Reveal contact
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-teal-600">
                      <CheckCircle2 className="size-3" aria-hidden /> revealed & logged
                    </span>
                  )}
                </div>
                {contact ? (
                  <div className="mt-2 space-y-1 text-xs">
                    <p className="flex items-center gap-1.5">
                      <Mail className="size-3 text-slate-400" aria-hidden /> {contact.email}
                    </p>
                    {contact.phone && (
                      <p className="flex items-center gap-1.5">
                        <Phone className="size-3 text-slate-400" aria-hidden /> {contact.phone}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    <EyeOff className="size-3" aria-hidden />
                    {profile.contactMasked ? 'Masked — revealing is logged and counts toward your daily quota.' : 'Hidden by privacy policy.'}
                  </p>
                )}
              </div>

              {profile.skills && (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Skills</p>
                  <div className="flex flex-wrap gap-1">
                    {profile.skills.split(',').map((s) => (
                      <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {s.trim()}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {profile.sections?.experiences && profile.sections.experiences.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <Briefcase className="size-3" aria-hidden /> Work history
                  </p>
                  <div className="space-y-2">
                    {profile.sections.experiences.map((w) => (
                      <div key={w.id} className="rounded-lg border border-slate-100 p-2.5 dark:border-slate-800">
                        <p className="text-xs font-semibold">
                          {w.title} {w.isCurrent && <Badge className="ml-1 bg-teal-100 text-[9px] text-teal-700">current</Badge>}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {w.company} · {w.startDate} → {w.endDate || 'present'}
                        </p>
                        {w.description && <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{w.description}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              </div>
              <div className="space-y-4">
              {profile.sections?.education && profile.sections.education.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <GraduationCap className="size-3" aria-hidden /> Education
                  </p>
                  {profile.sections.education.map((e) => (
                    <p key={e.id} className="text-xs text-slate-600 dark:text-slate-300">
                      {e.degree}, {e.institution} {e.endYear ? `(${e.endYear})` : ''}
                    </p>
                  ))}
                </div>
              )}

              {profile.sections?.certifications && profile.sections.certifications.length > 0 && (
                <div>
                  <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    <Award className="size-3" aria-hidden /> Certifications
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {profile.sections.certifications.map((c) => (
                      <Badge key={c.id} variant="outline" className="text-[10px] font-normal">
                        {c.name}
                        {c.year ? ` · ${c.year}` : ''}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {(profile.languages || profile.preferredLocations) && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {profile.languages && (
                    <span className="inline-flex items-center gap-1">
                      <Languages className="size-3" aria-hidden /> {profile.languages}
                    </span>
                  )}
                  {profile.preferredLocations && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" aria-hidden /> open to: {profile.preferredLocations}
                    </span>
                  )}
                  {profile.lastActiveAt && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="size-3" aria-hidden /> last active {new Date(profile.lastActiveAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              )}

              {/* ── CV document card (always present — honest when absent) ── */}
              {(() => {
                const activeCv = cvVersions.find((v) => v.isActive) ?? cvVersions[0] ?? null
                const older = activeCv ? cvVersions.filter((v) => v.id !== activeCv.id) : []
                return (
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <FileText className="size-3.5" aria-hidden /> CV / Resume document
                    </p>
                    {activeCv ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100" title={activeCv.fileName}>
                            {activeCv.label || activeCv.fileName}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {activeCv.fileName}
                            {activeCv.isActive && ' · active version'}
                            {older.length > 0 && ` · ${older.length} older version${older.length > 1 ? 's' : ''}`}
                          </p>
                        </div>
                        <a
                          href={`/api/candidates/${encodeURIComponent(candidateId)}/resume-versions/${activeCv.id}/download?requesterId=${encodeURIComponent(recruiterId)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-teal-700"
                          aria-label={`Download CV ${activeCv.fileName}`}
                        >
                          <Download className="size-3.5" aria-hidden /> Download CV
                        </a>
                      </div>
                    ) : profile?.cvFileName ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="truncate text-xs font-semibold text-slate-800 dark:text-slate-100" title={profile.cvFileName}>
                          {profile.cvFileName}
                        </p>
                        <a
                          href={`/api/candidates/${encodeURIComponent(candidateId)}/cv?requesterId=${encodeURIComponent(recruiterId)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-[11px] font-semibold text-white transition hover:bg-teal-700"
                          aria-label={`Download CV ${profile.cvFileName}`}
                        >
                          <Download className="size-3.5" aria-hidden /> Download CV
                        </a>
                      </div>
                    ) : (
                      <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        No CV file attached by this candidate — the work history, education and resume text
                        below carry the full detail. You can request the CV when you make contact.
                      </p>
                    )}
                    {older.length > 0 && (
                      <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                        <button
                          type="button"
                          className="text-[10px] font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                          onClick={() => setCvOlderOpen((o) => !o)}
                          aria-expanded={cvOlderOpen}
                        >
                          {cvOlderOpen ? 'Hide' : 'Show'} older versions ({older.length})
                        </button>
                        {cvOlderOpen && (
                          <ul className="mt-1.5 space-y-1">
                            {older.map((v) => (
                              <li key={v.id} className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="truncate text-slate-600 dark:text-slate-300">
                                  {v.label || v.fileName}
                                  <span className="ml-1 text-[9px] text-slate-400">{new Date(v.createdAt).toLocaleDateString()}</span>
                                </span>
                                <a
                                  href={`/api/candidates/${encodeURIComponent(candidateId)}/resume-versions/${v.id}/download?requesterId=${encodeURIComponent(recruiterId)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="shrink-0 rounded border border-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600 hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:text-slate-300"
                                >
                                  Get
                                </a>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}

              {(profile.githubUrl || profile.linkedinUrl || profile.portfolioUrl) && (
                <div className="flex flex-wrap gap-2">
                  {profile.githubUrl && (
                    <a href={profile.githubUrl} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] text-slate-600 hover:border-teal-400 dark:border-slate-700 dark:text-slate-300">
                      GitHub
                    </a>
                  )}
                  {profile.linkedinUrl && (
                    <a href={profile.linkedinUrl} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] text-slate-600 hover:border-teal-400 dark:border-slate-700 dark:text-slate-300">
                      LinkedIn
                    </a>
                  )}
                  {profile.portfolioUrl && (
                    <a href={profile.portfolioUrl} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] text-slate-600 hover:border-teal-400 dark:border-slate-700 dark:text-slate-300">
                      Portfolio
                    </a>
                  )}
                </div>
              )}

              {profile.resumeText && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Resume</p>
                  <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-[11px] leading-relaxed text-slate-600 [scrollbar-width:thin] dark:bg-slate-800/60 dark:text-slate-300">
                    {profile.resumeText}
                  </pre>
                  <p className="mt-1 text-[10px] text-slate-400">
                    Contact details are scrubbed from this text by privacy policy — use “Reveal contact”.
                  </p>
                </div>
              )}
            </div>
              </div>
          )}

          {/* ── SIMILAR CANDIDATES TAB ─────────────────────────────────── */}
          {!loading && profile && tab === 'similar' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900 dark:bg-teal-950/30">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300">
                  <Sparkles className="size-3.5" aria-hidden /> Similar-type candidates
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                  Candidates whose skills, role, functional area and experience look like{' '}
                  <strong>{profile.name}</strong>. Rank = skill overlap 55% + role 15% + functional area 12% +
                  industry 8% + experience proximity 10%. Zero-skill-overlap profiles from a different
                  functional area are excluded — &quot;similar&quot; means something here.
                </p>
              </div>

              {similarLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              )}

              {similarError && !similarLoading && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                  {similarError}{' '}
                  <button type="button" onClick={loadSimilar} className="ml-1 font-semibold underline">
                    Retry
                  </button>
                </div>
              )}

              {!similarLoading && !similarError && similar.length === 0 && (
                <p className="text-xs text-slate-500">
                  No similar candidates found in the scanned pool ({similarScanned} profiles) — this
                  profile&apos;s skill set is quite unique on the platform right now.
                </p>
              )}

              {!similarLoading && !similarError && similar.length > 0 && (
                <>
                  <p className="text-[10px] text-slate-400">
                    Scanned {similarScanned} visible profiles · top {similar.length} shown · contacts stay masked until revealed
                  </p>
                  <ul className="space-y-2">
                    {similar.map((s) => (
                      <li
                        key={s.id}
                        className="rounded-xl border border-slate-200 p-3 transition hover:border-teal-300 hover:shadow-sm dark:border-slate-800 dark:hover:border-teal-800"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
                              {s.name}
                              {s.profileSource === 'SYNTHETIC_SEED' && (
                                <Badge variant="outline" className="text-[9px] font-normal text-slate-400">synthetic</Badge>
                              )}
                            </p>
                            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                              {s.headline || '—'}
                              {s.location ? ` · ${s.location}` : ''}
                              {s.experienceYears !== null ? ` · ${s.experienceYears} yrs` : ''}
                              {s.expectedSalary !== null ? ` · ₹${s.expectedSalary} LPA` : ''}
                            </p>
                            {s.sharedSkills.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                <span className="text-[10px] text-slate-400">shared:</span>
                                {s.sharedSkills.map((sk) => (
                                  <span key={sk} className="rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                                    {sk}
                                  </span>
                                ))}
                              </div>
                            )}
                            <div className="mt-1 flex flex-wrap gap-1">
                              {s.sameFunctionalArea && (
                                <Badge variant="outline" className="text-[9px] font-normal text-slate-500">same functional area</Badge>
                              )}
                              {s.sameIndustry && (
                                <Badge variant="outline" className="text-[9px] font-normal text-slate-500">same industry</Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <div
                              className={`flex size-12 flex-col items-center justify-center rounded-full text-[11px] font-black ${
                                s.matchPercent >= 60
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                  : s.matchPercent >= 35
                                    ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                              aria-label={`Similarity ${s.matchPercent} percent`}
                            >
                              {s.matchPercent}%
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-[11px]"
                              onClick={() => onOpenCandidate?.(s.id, s.name)}
                              aria-label={`View profile of ${s.name}`}
                            >
                              <Users className="size-3" aria-hidden /> View profile
                            </Button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* ── SOURCING TAB ────────────────────────────────────────────── */}
          {!loading && tab === 'sourcing' && (
            <div className="space-y-4">
              {sourcingLoading ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-500">Sourcing status</Label>
                      <Select value={sourcing.status} onValueChange={(v) => setSourcing((s) => ({ ...s, status: v }))}>
                        <SelectTrigger className="h-9 text-xs" aria-label="Sourcing status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SOURCING_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              <span className={`mr-1.5 inline-block size-2 rounded-full ${SOURCING_STATUS_META[s].tone.split(' ')[0]}`} />
                              {SOURCING_STATUS_META[s].label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-500">Assigned teammate</Label>
                      <Select value={sourcing.assignedToId || 'unassigned'} onValueChange={(v) => setSourcing((s) => ({ ...s, assignedToId: v === 'unassigned' ? '' : v }))}>
                        <SelectTrigger className="h-9 text-xs" aria-label="Assigned teammate">
                          <SelectValue placeholder="Unassigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unassigned">Unassigned</SelectItem>
                          {teammates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                              {t.company ? ` · ${t.company}` : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-500">Last contacted</Label>
                      <Input type="date" value={sourcing.lastContactedAt} onChange={(e) => setSourcing((s) => ({ ...s, lastContactedAt: e.target.value }))} className="h-9 text-xs" aria-label="Last contacted date" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-slate-500">Follow-up reminder</Label>
                      <Input type="date" value={sourcing.followUpAt} onChange={(e) => setSourcing((s) => ({ ...s, followUpAt: e.target.value }))} className="h-9 text-xs" aria-label="Follow-up date" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Tags (comma separated)</Label>
                    <Input value={sourcing.tags} onChange={(e) => setSourcing((s) => ({ ...s, tags: e.target.value }))} placeholder="strong-fit, met-at-event" className="h-9 text-xs" aria-label="Tags" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">Sourcing note</Label>
                    <Textarea value={sourcing.note} onChange={(e) => setSourcing((s) => ({ ...s, note: e.target.value }))} placeholder="Screening notes, context, next steps…" className="min-h-[70px] text-xs" aria-label="Sourcing note" />
                  </div>
                  <Button
                    type="button"
                    className="h-9 gap-1.5 bg-teal-600 text-xs text-white hover:bg-teal-700"
                    onClick={() => saveSourcing()}
                    disabled={sourcingSaving}
                  >
                    {sourcingSaving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
                    Save tracker
                  </Button>

                  {sourcing.history.length > 0 && (
                    <>
                      <Separator />
                      <div>
                        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Activity history</p>
                        <ol className="space-y-2">
                          {[...sourcing.history].reverse().map((h, i) => (
                            <li key={i} className="flex items-start gap-2 text-[11px]">
                              <CircleDot className="mt-0.5 size-3 shrink-0 text-teal-500" aria-hidden />
                              <div>
                                <p className="text-slate-700 dark:text-slate-300">{h.action}</p>
                                <p className="text-slate-400">
                                  {h.actor} · {new Date(h.at).toLocaleString()}
                                </p>
                              </div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── MATCH TAB (job record OR pasted JD — the JD decides) ────── */}
          {!loading && tab === 'match' && (
            <div className="space-y-4">
              {/* source switch */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">JD source</span>
                {(
                  [
                    ['job', 'My posted jobs', jobs.length],
                    ['jd', 'Paste JD text', null],
                  ] as const
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setMatchMode(key); setMatchData(null) }}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      matchMode === key
                        ? 'bg-teal-600 text-white'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                    aria-pressed={matchMode === key}
                  >
                    {label}
                    {count !== null && <span className="rounded-full bg-white/25 px-1.5 text-[10px]">{count}</span>}
                  </button>
                ))}
              </div>

              {matchMode === 'job' && (
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-[11px] text-slate-500">Job</Label>
                    <Select value={jobId} onValueChange={setJobId}>
                      <SelectTrigger className="h-9 text-xs" aria-label="Job to match against">
                        <SelectValue placeholder={jobs.length ? 'Select a job' : 'No posted jobs yet'} />
                      </SelectTrigger>
                      <SelectContent>
                        {jobs.map((j) => (
                          <SelectItem key={j.id} value={j.id}>
                            {j.title} · {j.company}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="button" className="h-9 gap-1.5 bg-teal-600 text-xs text-white hover:bg-teal-700" onClick={runMatch} disabled={!jobId || matching}>
                    {matching ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Target className="size-3.5" aria-hidden />}
                    Compute match
                  </Button>
                </div>
              )}

              {matchMode === 'jd' && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] text-slate-500">
                      Paste your Job Description — roles, responsibilities, years of experience, work, skills.
                      The JD decides the score.
                    </Label>
                    <Textarea
                      value={jdText}
                      onChange={(e) => setJdText(e.target.value)}
                      placeholder={'Job Title: Maintenance Manager\nExperience: 7-12 years\n\nResponsibilities:\n- Lead plant maintenance and TPM programme\n- Drive OEE improvement across extrusion lines\n\nMust have: SAP PM, Preventive Maintenance, Hydraulics, Pneumatics\nLocation: Pune'}
                      className="min-h-[130px] text-xs"
                      aria-label="Job description text"
                    />
                  </div>

                  {/* opt-in context filters — flag-only, never raise the score */}
                  <div className="rounded-lg border border-slate-100 p-2.5 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setShowContextFilters((v) => !v)}
                      className="flex w-full items-center justify-between text-left text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                      aria-expanded={showContextFilters}
                    >
                      Optional filters (location / notice / budget) — flag-only checks
                      <span className="text-slate-400">{showContextFilters ? '−' : '+'}</span>
                    </button>
                    {showContextFilters && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-slate-400">Location</Label>
                          <Input value={ctxLocation} onChange={(e) => setCtxLocation(e.target.value)} placeholder="Pune" className="h-8 text-xs" aria-label="Context location filter" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-slate-400">Max notice (days)</Label>
                          <Input type="number" min={0} value={ctxNotice} onChange={(e) => setCtxNotice(e.target.value)} placeholder="60" className="h-8 text-xs" aria-label="Max notice days filter" />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-slate-400">Max expected CTC (LPA)</Label>
                          <Input type="number" min={0} value={ctxCtc} onChange={(e) => setCtxCtc(e.target.value)} placeholder="25" className="h-8 text-xs" aria-label="Max CTC filter" />
                        </div>
                      </div>
                    )}
                    <p className="mt-1.5 text-[10px] leading-snug text-slate-400">
                      These filters never raise the score — they only flag mismatches next to the result. If
                      role / skills / responsibilities don&apos;t match the JD, experience or location cannot
                      rescue the profile.
                    </p>
                  </div>

                  <Button type="button" className="h-9 gap-1.5 bg-teal-600 text-xs text-white hover:bg-teal-700" onClick={runMatch} disabled={!jdText.trim() || matching}>
                    {matching ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Target className="size-3.5" aria-hidden />}
                    Compute match
                  </Button>
                </div>
              )}

              {matching && (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              )}

              {matchData && !matching && (
                <div className="space-y-3">
                  {/* parsed JD summary */}
                  <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold">
                        {matchData.match.jdParsed.roleTitle || 'Parsed JD'}
                        {matchData.job ? ` · ${matchData.job.company}` : ''}
                      </p>
                      <Badge variant="outline" className="text-[10px] font-normal text-slate-500">
                        JD parsed by: {matchData.parseEngine === 'structured' ? 'posted job record' : matchData.parseEngine === 'AI' ? 'AI parser' : 'keyword parser'}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
                      {(matchData.match.jdParsed.minYears !== null || matchData.match.jdParsed.maxYears !== null) && (
                        <span>Experience: {matchData.match.jdParsed.minYears ?? '?'}–{matchData.match.jdParsed.maxYears ?? '+'} yrs</span>
                      )}
                      {matchData.match.jdParsed.location && <span>Location: {matchData.match.jdParsed.location}</span>}
                      <span>Responsibilities extracted: {matchData.match.jdParsed.responsibilities.length}</span>
                    </div>
                    {matchData.match.jdParsed.mustHaveSkills.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-slate-400">must-have:</span>
                        {matchData.match.jdParsed.mustHaveSkills.map((s) => (
                          <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">{s}</span>
                        ))}
                      </div>
                    )}
                    {matchData.match.jdParsed.goodToHaveSkills.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] text-slate-400">good-to-have:</span>
                        {matchData.match.jdParsed.goodToHaveSkills.map((s) => (
                          <span key={s} className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">{s}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* core-gate banner */}
                  {matchData.match.coreGate.applied && (
                    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                        <ShieldAlert className="size-3.5" aria-hidden /> Core JD mismatch — score capped
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-amber-800/90 dark:text-amber-200/90">
                        {matchData.match.coreGate.reason}
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-4 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                    <div className={`flex size-16 shrink-0 flex-col items-center justify-center rounded-full ${
                      matchData.match.overall >= 75
                        ? 'bg-emerald-50 dark:bg-emerald-950/40'
                        : matchData.match.overall >= 50
                          ? 'bg-teal-50 dark:bg-teal-950/40'
                          : 'bg-amber-50 dark:bg-amber-950/40'
                    }`}>
                      <span className={`text-xl font-black ${
                        matchData.match.overall >= 50 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                      }`}>{matchData.match.overall}</span>
                      <span className="text-[9px] uppercase text-slate-400">/ 100</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold">{matchData.match.verdictLabel}</p>
                      <p className="text-[11px] text-slate-500">
                        {matchData.source === 'job' ? `vs posted job: ${matchData.job?.title}` : 'vs pasted JD'} · Engine: {matchData.engine === 'rules+AI' ? 'rules + AI rationale' : 'rules-based (AI unavailable)'}
                      </p>
                      {matchData.match.missingMandatory.length > 0 && (
                        <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                          Missing must-haves: {matchData.match.missingMandatory.join(', ')}
                        </p>
                      )}
                    </div>
                  </div>

                  {matchData.aiSummary && (
                    <div className="rounded-lg border border-violet-200 bg-violet-50/70 p-3 dark:border-violet-900 dark:bg-violet-950/30">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
                        <Video className="size-3" aria-hidden /> AI rationale (advisory — verified facts only)
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{matchData.aiSummary}</p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {matchData.match.components.map((c) => (
                      <div key={c.key} className="rounded-lg border border-slate-100 p-2.5 dark:border-slate-800">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold">{c.label}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              c.state === 'PASS'
                                ? 'bg-emerald-100 text-emerald-700'
                                : c.state === 'PARTIAL'
                                  ? 'bg-amber-100 text-amber-700'
                                  : c.state === 'FAIL'
                                    ? 'bg-rose-100 text-rose-700'
                                    : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {c.state === 'UNKNOWN' ? 'unknown' : c.state.toLowerCase()}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{c.detail}</p>
                        {c.evidence.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {c.evidence.map((e, i) => (
                              <li key={i} className="text-[10px] text-teal-700 dark:text-teal-400">
                                ✓ {e}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </div>

                  {matchData.match.contextChecks.length > 0 && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        Your optional filters (flag-only)
                      </p>
                      <div className="space-y-1.5">
                        {matchData.match.contextChecks.map((c) => (
                          <div key={c.key} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 p-2 dark:border-slate-800">
                            <div>
                              <p className="text-[11px] font-semibold">{c.label}</p>
                              <p className="text-[10px] text-slate-500 dark:text-slate-400">{c.detail}</p>
                            </div>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                c.state === 'PASS'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : c.state === 'WARN'
                                    ? 'bg-amber-100 text-amber-700'
                                    : c.state === 'FAIL'
                                      ? 'bg-rose-100 text-rose-700'
                                      : 'bg-slate-100 text-slate-500'
                              }`}
                            >
                              {c.state === 'UNKNOWN' ? 'unknown' : c.state.toLowerCase()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] leading-relaxed text-slate-400">{matchData.advisory}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
