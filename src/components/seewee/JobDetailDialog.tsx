'use client'

import { useEffect, useState } from 'react'
import { useAppStore, skillsToArray, formatLpa, matchColor, consumeApplySource } from '@/store/app-store'
import { computeMatchScore } from '@/lib/match'
import { clampDialogShellScroll } from '@/lib/dialog-scroll-guard'
import type { ApiResponse, Job } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { SaveJobButton } from '@/components/seewee/SaveJobButton'
import { CompanyDialog } from '@/components/seewee/CompanyDialog'
import { InlineCvAttach } from '@/components/seewee/candidate/CvUploadCard'
import { fileToCvPayload } from '@/lib/cv-client'
import { toast } from 'sonner'
import {
  Bot,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Compass,
  Eye,
  Flag,
  Globe,
  IndianRupee,
  Link2,
  Loader2,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  Send,
  Share2,
  Sparkles,
  Twitter,
  UsersRound,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export function JobDetailDialog() {
  const activeJobId = useAppStore((s) => s.activeJobId)
  const closeJob = useAppStore((s) => s.closeJob)
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const setUser = useAppStore((s) => s.setUser)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const openJob = useAppStore((s) => s.openJob)
  const applySource = useAppStore((s) => s.applySource)

  const [job, setJob] = useState<Job | null>(null)
  const [loading, setLoading] = useState(false)
  const [coverNote, setCoverNote] = useState('')
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState(false)
  // Server-truth: this candidate already has an application for this job
  // (covers applications made in other sessions / via API — localStorage cache
  // alone was missing those, so the full apply form showed and only 409ed).
  const [serverApplied, setServerApplied] = useState(false)
  // CV picked inside the dialog (overrides the profile CV snapshot for THIS application)
  const [pendingCv, setPendingCv] = useState<File | null>(null)
  // company profile dialog overlays this one (job dialog stays open underneath)
  const [companyDialog, setCompanyDialog] = useState<string | null>(null)

  useEffect(() => {
    if (!activeJobId) return
    setJob(null)
    setApplied(false)
    setServerApplied(false)
    setCoverNote('')
    setLoading(true)
    fetch(`/api/jobs/${activeJobId}`)
      .then((r) => r.json())
      .then((json: { data?: Job }) => setJob(json.data ?? null))
      .catch(() => toast.error('Could not load this job'))
      .finally(() => setLoading(false))
    if (user?.role === 'CANDIDATE') {
      fetch(
        `/api/applications?candidateId=${encodeURIComponent(user.id)}&jobId=${encodeURIComponent(activeJobId)}`
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((json: { data?: Array<{ jobId?: string }> } | null) => {
          // Client-side guard too: only an application for THIS job counts.
          // (The API honours the jobId filter, but we don't trust the wire.)
          if (Array.isArray(json?.data) && json.data.some((a) => a.jobId === activeJobId))
            setServerApplied(true)
        })
        .catch(() => undefined)
    }
  }, [activeJobId, user?.id, user?.role])

  async function apply() {
    if (!user || !job) return
    if (user.role !== 'CANDIDATE') {
      toast.info('Only candidate accounts can apply. Sign in as a Job Seeker 🎯')
      return
    }
    setApplying(true)
    try {
      // A CV chosen in the dialog rides along; without one the backend
      // snapshots the profile CV automatically.
      let cv
      if (pendingCv) {
        cv = await fileToCvPayload(pendingCv)
      }
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          candidateId: user.id,
          coverNote: coverNote.trim() || undefined,
          // only tagged channels ride on the wire — the API defaults to DIRECT
          ...(applySource && applySource !== 'DIRECT' ? { source: applySource } : {}),
          ...(cv ? { cv } : {}),
        }),
      })
      const json: { error?: string; emailQueued?: { to: string } } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to apply')
      toast.success(
        `🎉 Applied to ${job.title}!${json.emailQueued ? ` Confirmation email sent to ${json.emailQueued.to}` : ''}`
      )
      try {
        const map = JSON.parse(localStorage.getItem('seewee-applied-jobs') ?? '{}') as Record<string, boolean>
        map[job.id] = true
        localStorage.setItem('seewee-applied-jobs', JSON.stringify(map))
      } catch {}
      // A CV uploaded here becomes the profile CV too (next applications reuse it)
      if (pendingCv && user) {
        setUser({ ...user, cvFileName: pendingCv.name, cvMimeType: pendingCv.type, cvUploadedAt: new Date().toISOString() })
      }
      setApplied(true)
      bumpRefresh()
      // The channel tag is spent by this application (career-page visitors keep theirs)
      consumeApplySource()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setApplying(false)
    }
  }

  const myMatch =
    user?.role === 'CANDIDATE' && job ? computeMatchScore(job.skills, user.skills) : null

  return (
    <Dialog open={!!activeJobId} onOpenChange={(o) => !o && closeJob()}>
      <DialogContent
        className="max-h-[92vh] overflow-clip p-0 sm:max-w-2xl"
        onScroll={clampDialogShellScroll}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{job?.title ?? 'Job details'}</DialogTitle>
          <DialogDescription>Job description and application</DialogDescription>
        </DialogHeader>

        {loading || !job ? (
          <div className="space-y-4 p-6">
            <div className="flex gap-3">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            </div>
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : (
          <ScrollArea className="max-h-[80vh] [&>[data-radix-scroll-area-viewport]]:max-h-[72vh]">
            <div className="p-6 sm:p-8">
              {/* Header */}
              <div className="flex items-start gap-4">
                <Avatar className="h-14 w-14 border border-slate-100 dark:border-slate-800/60">
                  {job.recruiter?.companyLogoData ? (
                     
                    <img
                      src={`data:${job.recruiter.companyLogoMime || 'image/png'};base64,${job.recruiter.companyLogoData}`}
                      alt={`${job.company} logo`}
                      className="size-full rounded-full object-cover"
                    />
                  ) : (
                    <AvatarFallback
                      className="bg-gradient-to-br from-blue-100 to-sky-100 text-lg font-black text-blue-700"
                      style={
                        job.recruiter?.brandColor
                          ? { background: `${job.recruiter.brandColor}1a`, color: job.recruiter.brandColor }
                          : undefined
                      }
                    >
                      {job.company.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="min-w-0 flex-1">
                  <DialogHeader className="text-left">
                    <DialogTitle className="text-xl font-black text-slate-900 dark:text-slate-100">{job.title}</DialogTitle>
                    <DialogDescription className="text-sm font-medium">
                      <button
                        type="button"
                        onClick={() => job && setCompanyDialog(job.company)}
                        title={`View all ${job.company} jobs`}
                        className="cursor-pointer rounded font-semibold text-slate-600 dark:text-slate-400 transition-colors hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        {job.company}
                      </button>{' · '}
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="inline h-3.5 w-3.5" /> {job.location}
                      </span>
                    </DialogDescription>
                  </DialogHeader>
                </div>
                {myMatch != null && (
                  <span
                    className={`shrink-0 rounded-full border px-3 py-1 text-xs font-bold ${
                      myMatch >= 70
                        ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/40'
                        : myMatch >= 40
                          ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/40'
                          : 'border-slate-300 bg-slate-50 dark:bg-slate-800/60'
                    } ${matchColor(myMatch)}`}
                  >
                    ⚡ {myMatch > 0 ? `${Math.round(myMatch)}% match` : 'Low match'}
                  </span>
                )}
                {user?.role === 'CANDIDATE' && (
                  <SaveJobButton jobId={job.id} className="shrink-0" />
                )}
              </div>

              {/* Meta chips */}
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                {[
                  { icon: BriefcaseBusiness, label: `${job.experienceMin}–${job.experienceMax} yrs` },
                  { icon: IndianRupee, label: formatLpa(job.salaryMinLpa, job.salaryMaxLpa) },
                  { icon: UsersRound, label: `${job.openings} opening${job.openings > 1 ? 's' : ''}` },
                  { icon: Eye, label: `${job.viewsCount} views` },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400">
                    <Icon className="h-3.5 w-3.5 text-blue-600" />
                    {label}
                  </div>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge variant="outline" className="rounded-full">{job.jobType}</Badge>
                <Badge className="rounded-full bg-sky-50 dark:bg-sky-950/40 text-sky-700">{job.workMode}</Badge>
                <Badge variant="secondary" className="rounded-full bg-slate-100 text-slate-500 dark:text-slate-400">
                  <CalendarClock className="mr-1 h-3 w-3" />
                  Posted {new Date(job.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                </Badge>
                {(job._count?.applications ?? 0) > 0 && (
                  <Badge variant="secondary" className="rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700">
                    {job._count?.applications} applied
                  </Badge>
                )}
              </div>

              {/* Skills */}
              <section aria-label="Required skills" className="mt-5">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Skills</h3>
                <div className="flex flex-wrap gap-1.5">
                  {skillsToArray(job.skills).map((s) => (
                    <Badge key={s} className="rounded-full border-none bg-blue-50 dark:bg-blue-950/40 px-3 py-1 text-blue-700">
                      {s}
                    </Badge>
                  ))}
                </div>
              </section>

              {/* Description */}
              <section aria-label="Job description" className="mt-5">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">About the role</h3>
                <div className="space-y-3 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {(job.description || '').split(/\n+/).filter(Boolean).slice(0, 10).map((para, i) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              </section>

              {/* About the company (recruiter-authored branding) */}
              {(job.recruiter?.companyAbout || job.recruiter?.companyWebsite) && (
                <section
                  aria-label="About the company"
                  className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-900/50"
                >
                  <div className="flex items-center gap-2.5">
                    {job.recruiter?.companyLogoData ? (
                       
                      <img
                        src={`data:${job.recruiter.companyLogoMime || 'image/png'};base64,${job.recruiter.companyLogoData}`}
                        alt=""
                        aria-hidden
                        className="size-8 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                      />
                    ) : null}
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                      About {job.company}
                    </h3>
                    {job.recruiter?.companyWebsite && (
                      <a
                        href={
                          job.recruiter.companyWebsite.startsWith('http')
                            ? job.recruiter.companyWebsite
                            : `https://${job.recruiter.companyWebsite}`
                        }
                        target="_blank"
                        rel="noreferrer noopener"
                        className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 transition-colors hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300"
                      >
                        <Globe className="size-3" aria-hidden /> Website
                      </a>
                    )}
                  </div>
                  {job.recruiter?.companyAbout && (
                    <p className="mt-2.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
                      {job.recruiter.companyAbout}
                    </p>
                  )}
                </section>
              )}

              {/* JD AI note */}
              <div className="mt-5 flex items-start gap-3 rounded-xl border border-dashed border-blue-300 bg-gradient-to-br from-blue-50/60 dark:from-blue-950/40 to-sky-50/40 p-4">
                <Bot className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
                <p className="text-xs leading-relaxed text-blue-900">
                  <span className="font-bold">SeeWe AI reads this role&apos;s JD.</span> If you&apos;re shortlisted,
                  your interview questions will be generated specifically from this job and your resume — spoken
                  aloud by the SeeWe AI Interviewer.
                </p>
              </div>

              <Separator className="my-6" />

              {/* Apply section */}
              {!user ? (
                <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-800/60 p-5 text-center">
                  <Sparkles className="h-6 w-6 text-blue-600" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Sign in as a Job Seeker to apply in one tap</p>
                  <Button
                    onClick={() => {
                      closeJob()
                      setAuthOpen(true)
                    }}
                    className="bg-gradient-to-r from-blue-600 to-sky-600 text-white hover:from-blue-700 hover:to-sky-700"
                  >
                    Sign in / Register
                  </Button>
                </div>
              ) : applied ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/40 p-4 text-sm font-semibold text-blue-800">
                  <CheckCircle2 className="h-5 w-5" />
                  Application submitted! Track it in My Journey 🚀
                </div>
              ) : isAlreadyApplied(job) || serverApplied ? (
                <div className="flex items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/40 p-4 text-sm font-semibold text-blue-800">
                  <CheckCircle2 className="h-5 w-5" />
                  You have already applied for this position 🎉
                </div>
              ) : user.role !== 'CANDIDATE' ? (
                <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 dark:text-slate-400">
                  {user.role === 'CLIENT'
                    ? '🤝 Client partners review talent in the Client Portal — job applications are for job seekers.'
                    : '👀 Recruiter view — candidates will appear here once they apply.'}
                </p>
              ) : (
                <section aria-label="Apply now">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-bold text-slate-900 dark:text-slate-100">Apply now</h3>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{coverNote.length}/600</span>
                  </div>
                  <div className="mb-3">
                    <InlineCvAttach pendingCv={pendingCv} onPendingChange={setPendingCv} />
                  </div>
                  <Textarea
                    aria-label="Cover note"
                    maxLength={600}
                    rows={3}
                    placeholder={`Why are you a great fit for ${job.title}? Recruiters love context… (optional)`}
                    value={coverNote}
                    onChange={(e) => setCoverNote(e.target.value)}
                    className="mb-3 resize-none"
                  />
                  <Button
                    onClick={() => void apply()}
                    disabled={applying}
                    aria-label="Submit application"
                    className="h-11 w-full bg-gradient-to-r from-blue-600 to-sky-600 text-base font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700"
                  >
                    {applying ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting…
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" /> Send my application ⚡
                      </>
                    )}
                  </Button>
                </section>
              )}

              {/* Share kit — every viewer can spread the word (referrals welcome) */}
              <ShareJobSection job={job} />

              {/* Report suspicious job — master spec §8/§33 (moderation queue) */}
              <ReportJobSection job={job} />

              {/* Similar jobs — key by job id so the list refetches when the dialog swaps jobs */}
              <SimilarJobs key={job.id} job={job} onOpen={(id) => openJob(id)} />
            </div>
          </ScrollArea>
        )}

        {/* Company profile dialog — overlays this job dialog; "View & apply"
            swaps the job shown here via the store and closes itself */}
        <CompanyDialog company={companyDialog} onClose={() => setCompanyDialog(null)} />
      </DialogContent>
    </Dialog>
  )
}

/** Best-effort detection: was this job applied? We rely on dialog-local state for
 * post-apply feedback; for pre-existing applications we check local application cache flag */
function isAlreadyApplied(_job: Job): boolean {
  if (typeof window === 'undefined') return false
  try {
    const map = JSON.parse(localStorage.getItem('seewee-applied-jobs') ?? '{}') as Record<string, boolean>
    return !!map[_job.id]
  } catch {
    return false
  }
}

/**
 * ShareJobSection — compact share kit at the bottom of the job dialog.
 * Copy-link produces the trackable apply deep link (/?job={id}&src=shared) so
 * applications coming through a shared link are attributed SHARED_LINK.
 * Icon-only share targets open the visitor's compose window in a new tab;
 * labels stay intentionally generic (no portal names).
 */
function ShareJobSection({ job }: { job: Job }) {
  const shareUrl = () =>
    typeof window === 'undefined'
      ? `/?job=${job.id}&src=shared`
      : `${window.location.origin}/?job=${job.id}&src=shared`

  const shareText = `${job.title} at ${job.company} — ${job.location}`

  async function copyLink() {
    const link = shareUrl()
    try {
      await navigator.clipboard.writeText(link)
      toast.success('🔗 Link copied — anyone with it can apply')
    } catch {
      toast.error('Could not copy — long-press the link instead')
    }
  }

  // Neutral share targets (icon-only; compose windows open in a new tab)
  const targets = [
    {
      icon: Linkedin,
      label: 'Share on professional network',
      href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl())}`,
    },
    {
      icon: Twitter,
      label: 'Share as a social post',
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl())}`,
    },
    {
      icon: MessageCircle,
      label: 'Share in a chat',
      href: `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl()}`)}`,
    },
  ]

  return (
    <section aria-label="Share this job" className="mt-6 rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/25">
      <h3 className="flex items-center gap-1.5 text-sm font-bold text-emerald-900 dark:text-emerald-200">
        <Share2 className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        Share this job
      </h3>
      <p className="mt-0.5 text-xs text-emerald-800/70 dark:text-emerald-300/70">
        Know someone perfect? Send them this role — applications through your link are counted.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void copyLink()}
          aria-label="Copy apply link"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-800 dark:bg-stone-900 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
        >
          <Link2 className="size-4" aria-hidden /> Copy link
        </button>
        {targets.map(({ icon: Icon, label, href }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={label}
            title={label}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-300 bg-white text-emerald-700 transition-colors hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-800 dark:bg-stone-900 dark:text-emerald-400 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-300"
          >
            <Icon className="size-4" aria-hidden />
          </a>
        ))}
        <a
          href={`mailto:?subject=${encodeURIComponent(`${shareText}`)}&body=${encodeURIComponent(`Saw this opening and thought of you:\n\n${shareText}\n${shareUrl()}`)}`}
          aria-label="Share by email"
          title="Share by email"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-300 bg-white text-emerald-700 transition-colors hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:border-emerald-800 dark:bg-stone-900 dark:text-emerald-400 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-300"
        >
          <Mail className="size-4" aria-hidden />
        </a>
      </div>
    </section>
  )
}

/**
 * SimilarJobs — compact "explorer more roles" rail under the apply section.
 * Fetch strategy: top skill of this job first; if fewer than 2 matches, top up
 * from the same company. Clicking a row swaps the dialog to that job via the
 * store (openJob) — the key on <SimilarJobs> makes it refetch for the new job.
 */
function SimilarJobs({ job, onOpen }: { job: Job; onOpen: (id: string) => void }) {
  // null = loading, [] = nothing found (section hidden), array = items
  const [similar, setSimilar] = useState<Job[] | null>(null)

  useEffect(() => {
    let cancelled = false
    const firstSkill = skillsToArray(job.skills)[0] ?? job.title
    fetch(`/api/jobs?keyword=${encodeURIComponent(firstSkill)}&limit=10`)
      .then((r) => r.json())
      .then(async (json: { data?: { jobs?: Job[] } }) => {
        let picks = (json.data?.jobs ?? []).filter((j) => j.id !== job.id).slice(0, 3)
        if (picks.length < 2) {
          try {
            const res2 = await fetch(`/api/jobs?keyword=${encodeURIComponent(job.company)}&limit=10`)
            const json2: { data?: { jobs?: Job[] } } = await res2.json()
            const seen = new Set([job.id, ...picks.map((p) => p.id)])
            picks = [
              ...picks,
              ...(json2.data?.jobs ?? []).filter((j) => !seen.has(j.id)),
            ].slice(0, 3)
          } catch {
            /* company top-up is best-effort */
          }
        }
        if (!cancelled) setSimilar(picks)
      })
      .catch(() => {
        if (!cancelled) setSimilar([])
      })
    return () => {
      cancelled = true
    }
  }, [job])

  if (similar !== null && similar.length === 0) return null

  return (
    <section aria-label="Similar jobs" className="mt-6">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        <Compass className="size-3.5 text-blue-600" aria-hidden /> Similar jobs you can explore
      </h3>
      {similar === null ? (
        <div className="space-y-2">
          <Skeleton className="h-[64px] rounded-xl" />
          <Skeleton className="h-[64px] rounded-xl" />
        </div>
      ) : (
        <ul className="space-y-2">
          {similar.map((j) => (
            <li key={j.id}>
              <button
                type="button"
                onClick={() => onOpen(j.id)}
                aria-label={`Open similar job ${j.title} at ${j.company}`}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-700 dark:hover:bg-blue-950/30"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {j.title}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium">{j.company}</span>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-0.5">
                      <MapPin className="size-3" aria-hidden /> {j.location}
                    </span>
                    <span aria-hidden>·</span>
                    {j.workMode}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-bold text-blue-700">
                  {formatLpa(j.salaryMinLpa, j.salaryMaxLpa)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * ReportJobSection — flag a suspicious posting (master spec §8/§33).
 * Reports land in the admin "Job reports" moderation queue; the candidate's
 * identity is attached automatically when they are signed in, otherwise the
 * report goes in anonymous.
 */
const REPORT_REASONS = [
  { value: 'FAKE_JOB', label: 'Fake or misleading job' },
  { value: 'SPAM', label: 'Spam / duplicate posting' },
  { value: 'EXPIRED', label: 'Position already filled / expired' },
  { value: 'FEE_ASKED', label: 'Asking for money to apply' },
  { value: 'DISCRIMINATORY', label: 'Discriminatory content' },
  { value: 'OTHER', label: 'Something else' },
] as const

function ReportJobSection({ job }: { job: Job }) {
  const user = useAppStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<string>('')
  const [details, setDetails] = useState('')
  const [sending, setSending] = useState(false)

  async function submit() {
    if (!reason) {
      toast.error('Choose a reason first')
      return
    }
    setSending(true)
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(job.id)}/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          details: details.trim() || undefined,
          reporterId: user?.id || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as ApiResponse<unknown>
      if (!res.ok || json.error) throw new Error(json.error ?? 'Failed to submit report')
      toast.success('Report submitted — our moderation team will review it')
      setOpen(false)
      setReason('')
      setDetails('')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit report')
    } finally {
      setSending(false)
    }
  }

  return (
    <section aria-label="Report this job">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:hover:bg-rose-950/30"
      >
        <Flag className="size-3.5" aria-hidden /> Report this job
      </button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="size-4 text-rose-500" aria-hidden /> Report “{job.title}”
            </DialogTitle>
            <DialogDescription>
              Tell us what&apos;s wrong with this posting. Reports go to the moderation team and are
              reviewed confidentially.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">Reason</p>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger aria-label="Report reason" className="min-h-[44px] rounded-xl">
                  <SelectValue placeholder="Choose a reason" />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_REASONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                Details (optional)
              </p>
              <Textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="e.g. The recruiter asked for a registration fee…"
                className="resize-none rounded-xl"
              />
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              {user
                ? `Reported as ${user.email}.`
                : 'You are not signed in — the report will be anonymous.'}
            </p>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={sending || !reason}
              className="gap-1.5 bg-rose-600 text-white hover:bg-rose-700"
            >
              {sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Flag className="size-4" aria-hidden />}
              {sending ? 'Submitting…' : 'Submit report'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
