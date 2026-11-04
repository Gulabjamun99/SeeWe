'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  Briefcase,
  Building2,
  ChevronRight,
  Clock3,
  CopyPlus,
  Eye,
  GraduationCap,
  Code2,
  Link2,
  Linkedin,
  Mail,
  MapPin,
  MessageCircle,
  MoreVertical,
  MoreHorizontal,
  PauseCircle,
  PencilLine,
  PlayCircle,
  SearchX,
  Share2,
  Trash2,
  Twitter,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react'
import { useAppStore, skillsToArray, formatLpa } from '@/store/app-store'
import type { Job } from '@/lib/types'
import { clampDialogShellScroll } from '@/lib/dialog-scroll-guard'
import { PostJobForm } from '@/components/seewee/recruiter/PostJobForm'
import { FormErrorBoundary } from '@/components/seewee/FormErrorBoundary'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'

const JOB_STATUS_META: Record<string, { label: string; cls: string }> = {
  ACTIVE: { label: 'Active', cls: 'border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-700' },
  PAUSED: { label: 'Paused', cls: 'border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-700' },
  CLOSED: { label: 'Closed', cls: 'border-slate-300 bg-slate-100 text-slate-500 dark:text-slate-400' },
}

async function copyToClipboard(text: string, successMessage: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
  } catch {
    toast.error('Could not copy to clipboard')
  }
}

/** Neutral share targets for a job — the apply link carries ?src=shared so
 * applications arriving through it are attributed SHARED_LINK. */
function jobShareTargets(job: Job) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const link = `${origin}/?job=${job.id}&src=shared`
  const text = `${job.title} at ${job.company} — ${job.location}`
  return [
    {
      label: 'Professional network',
      url: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`,
      Icon: Linkedin,
      isMailto: false,
    },
    {
      label: 'Social post',
      url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`,
      Icon: Twitter,
      isMailto: false,
    },
    {
      label: 'Chat',
      url: `https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`,
      Icon: MessageCircle,
      isMailto: false,
    },
    {
      label: 'Email',
      url: `mailto:?subject=${encodeURIComponent(text)}&body=${encodeURIComponent(`${text}\n${link}`)}`,
      Icon: Mail,
      isMailto: true,
    },
  ]
}

/** Compact per-job share dropdown (apply link, neutral share targets, career
 * page link + embed snippet when the recruiter belongs to a client workspace). */
function JobShareMenu({
  job,
  clientId,
  company,
}: {
  job: Job
  clientId?: string | null
  company?: string | null
}) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const applyLink = `${origin}/?job=${job.id}&src=shared`
  const targets = jobShareTargets(job)
  const careerLink = clientId ? `${origin}/?career=${clientId}` : null
  const embedCode = careerLink
    ? `<iframe src="${careerLink}" width="100%" height="600" style="border:0;border-radius:12px" title="${company || 'Company'} careers"></iframe>`
    : null

  function openTarget(label: string, url: string, isMailto: boolean) {
    if (isMailto) {
      window.location.assign(url)
    } else {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
    toast.success(`Opening ${label.toLowerCase()} share…`)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Share ${job.title}`}
          title="Share this job"
          className="min-w-[44px] shrink-0 p-2 text-slate-400 dark:text-slate-500 hover:text-emerald-600 sm:min-w-[36px]"
        >
          <Share2 className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          onClick={() => void copyToClipboard(applyLink, '🔗 Apply link copied — anyone with it can apply')}
        >
          <Link2 className="text-emerald-600" aria-hidden /> Copy apply link
        </DropdownMenuItem>
        {targets.map(({ label, url, Icon, isMailto }) => (
          <DropdownMenuItem key={label} onClick={() => openTarget(label, url, isMailto)}>
            <Icon className="text-emerald-600" aria-hidden /> {label}
          </DropdownMenuItem>
        ))}
        {careerLink && embedCode && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void copyToClipboard(careerLink, '🔗 Career page link copied')}
            >
              <Building2 className="text-emerald-600" aria-hidden /> Copy career page link
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                void copyToClipboard(embedCode, '🧩 Embed code copied — paste it on any website')
            }
            >
              <Code2 className="text-emerald-600" aria-hidden /> Copy embed code
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface MyJobsPanelProps {
  onSelectJobForApplicants?: (jobId: string) => void
}

export function MyJobsPanel({ onSelectJobForApplicants }: MyJobsPanelProps) {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)

  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Job | null>(null)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  /** jobId → applications that arrived via a tracked channel (source ≠ DIRECT) */
  const [sharedCounts, setSharedCounts] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    if (!user || user.role !== 'RECRUITER') return
    setLoading(true)
    setError(null)
    try {
      // Jobs + a lightweight applications fetch in parallel; the latter only
      // feeds the per-job "via share" attribution counts and must never break
      // the panel if it fails.
      const [jobsRes, appsRes] = await Promise.all([
        fetch(`/api/jobs?recruiterId=${encodeURIComponent(user.id)}&limit=100`),
        fetch(`/api/applications?recruiterId=${encodeURIComponent(user.id)}`).catch(() => null),
      ])
      const json: { data?: { jobs?: Job[] }; error?: string } = await jobsRes.json()
      if (!jobsRes.ok || json.error) throw new Error(json.error || 'Failed to load jobs')
      setJobs(json.data?.jobs ?? [])

      if (appsRes?.ok) {
        const appsJson: { data?: { jobId: string; source?: string | null }[] } = await appsRes.json()
        const counts: Record<string, number> = {}
        for (const a of appsJson.data ?? []) {
          if (a.source && a.source !== 'DIRECT') {
            counts[a.jobId] = (counts[a.jobId] ?? 0) + 1
          }
        }
        setSharedCounts(counts)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const duplicateJob = async (job: Job) => {
    if (!user) return
    setBusyId(job.id)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recruiterId: user.id,
          title: `${job.title} (Copy)`,
          company: job.company,
          description: job.description,
          location: job.location,
          jobType: job.jobType,
          workMode: job.workMode,
          experienceMin: job.experienceMin,
          experienceMax: job.experienceMax,
          salaryMinLpa: job.salaryMinLpa ?? undefined,
          salaryMaxLpa: job.salaryMaxLpa ?? undefined,
          skills: job.skills,
          openings: job.openings,
          jdText: job.jdText ?? undefined,
        }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Duplicate failed')
      toast.success(`📋 "${job.title}" duplicated as a draft copy`, {
        description: 'Edit the details, then keep it Active or Pause it.',
      })
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not duplicate job')
    } finally {
      setBusyId(null)
    }
  }

  const changeStatus = async (job: Job, status: 'ACTIVE' | 'PAUSED' | 'CLOSED') => {
    setBusyId(job.id)
    try {
      const res = await fetch(`/api/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Update failed')
      toast.success(
        status === 'ACTIVE'
          ? `▶️ “${job.title}” is live again`
          : status === 'PAUSED'
            ? `⏸️ “${job.title}” paused`
            : `🔒 “${job.title}” closed`
      )
      bumpRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update job')
    } finally {
      setBusyId(null)
    }
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const job = pendingDelete
    setPendingDelete(null)
    setBusyId(job.id)
    try {
      const res = await fetch(`/api/jobs/${job.id}`, { method: 'DELETE' })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Delete failed')
      toast.success(`🗑️ “${job.title}” deleted`)
      bumpRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete job')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex gap-2 pt-2">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-4 w-2/3" />
              <div className="flex gap-1.5 pt-2">
                <Skeleton className="h-5 w-14 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-12 rounded-full" />
              </div>
              <Skeleton className="mt-2 h-8 w-full rounded-lg" />
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
          <SearchX className="size-10 text-rose-400" aria-hidden />
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>
          <Button variant="outline" onClick={() => void load()} className="h-11 sm:h-9">
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (jobs.length === 0) {
    return (
      <Card className="rounded-xl border-dashed border-blue-300 bg-blue-50/40 dark:bg-blue-950/40 shadow-sm">
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
            <Briefcase className="size-7 text-blue-600" aria-hidden />
          </span>
          <p className="font-semibold text-slate-800 dark:text-slate-200">No jobs posted yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Your openings live here. Hit the green{' '}
            <span className="font-medium text-blue-700">“Post a Job”</span> button above —
            once candidates apply you can shortlist them into an AI interview.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
      >
        {jobs.map((job) => {
          const statusMeta = JOB_STATUS_META[job.status] ?? JOB_STATUS_META.CLOSED
          const skills = skillsToArray(job.skills)
          const applicants = job._count?.applications ?? 0
          const sharedCount = sharedCounts[job.id] ?? 0
          const busy = busyId === job.id
          return (
            <Card
              key={job.id}
              className={`group flex flex-col rounded-xl border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:border-blue-200 hover:shadow-md ${
                busy ? 'opacity-60' : ''
              }`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate pr-1 font-semibold leading-tight text-slate-900 dark:text-slate-100 group-hover:text-blue-700">
                      {job.title}
                    </h3>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <Building2 className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{job.company}</span>
                    </p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        aria-label={`Actions for ${job.title}`}
                        className="min-w-[44px] shrink-0 p-2 text-slate-400 dark:text-slate-500 hover:text-blue-600 sm:min-w-[36px]"
                      >
                        <MoreVertical className="size-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem onClick={() => setEditingJob(job)}>
                        <PencilLine className="text-blue-600" aria-hidden /> Edit details
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void duplicateJob(job)} disabled={busy}>
                        <CopyPlus className="text-sky-600" aria-hidden /> Duplicate job
                      </DropdownMenuItem>
                      {job.status === 'ACTIVE' && (
                        <DropdownMenuItem onClick={() => void changeStatus(job, 'PAUSED')}>
                          <PauseCircle className="text-amber-500" aria-hidden /> Pause job
                        </DropdownMenuItem>
                      )}
                      {job.status === 'PAUSED' && (
                        <DropdownMenuItem onClick={() => void changeStatus(job, 'ACTIVE')}>
                          <PlayCircle className="text-blue-600" aria-hidden /> Activate job
                        </DropdownMenuItem>
                      )}
                      {job.status !== 'CLOSED' && (
                        <DropdownMenuItem onClick={() => void changeStatus(job, 'CLOSED')}>
                          <XCircle className="text-slate-400 dark:text-slate-500" aria-hidden /> Close job
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setPendingDelete(job)}
                        className="text-rose-600 dark:text-rose-300 focus:bg-rose-50 focus:text-rose-700"
                      >
                        <Trash2 aria-hidden /> Delete…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <Badge variant="outline" className="border-slate-200 text-slate-600 dark:text-slate-400">
                    {job.jobType}
                  </Badge>
                  <Badge variant="outline" className="border-slate-200 text-slate-600 dark:text-slate-400">
                    {job.workMode}
                  </Badge>
                  <Badge variant="outline" className={statusMeta.cls}>
                    ● {statusMeta.label}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="flex-1 space-y-2.5 pb-3">
                <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                    <span className="truncate">{job.location}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <GraduationCap className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                    {job.experienceMin}–{job.experienceMax} yrs
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Wallet className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                    <span className="truncate">{formatLpa(job.salaryMinLpa, job.salaryMaxLpa)}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Clock3 className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                    {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                  </span>
                </div>

                {skills.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {skills.slice(0, 5).map((s) => (
                      <span
                        key={s}
                        className="rounded-md bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200/70"
                      >
                        {s}
                      </span>
                    ))}
                    {skills.length > 5 && (
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        +{skills.length - 5} more
                      </span>
                    )}
                  </div>
                )}
              </CardContent>

              <CardFooter className="justify-between gap-2 border-t border-dashed border-slate-100 dark:border-slate-800/60 pt-3">
                <button
                  type="button"
                  onClick={() => onSelectJobForApplicants?.(job.id)}
                  aria-label={`View ${applicants} applicant${applicants === 1 ? '' : 's'} for ${job.title}`}
                  className="inline-flex h-9 min-w-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/40 sm:h-8"
                >
                  <Users className="size-4" aria-hidden />
                  {applicants} applicant{applicants === 1 ? '' : 's'}
                  <ChevronRight className="size-4" aria-hidden />
                </button>
                <div className="flex min-w-0 items-center gap-0.5">
                  {sharedCount > 0 && (
                    <span
                      title={`${sharedCount} application${sharedCount === 1 ? '' : 's'} came via shared links / career page`}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                    >
                      <Share2 className="size-3" aria-hidden /> {sharedCount} via share
                    </span>
                  )}
                  <JobShareMenu job={job} clientId={user?.clientId} company={user?.company} />
                  <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500">
                    <Eye className="size-3.5" aria-hidden /> {job.viewsCount}
                  </span>
                </div>
              </CardFooter>
            </Card>
          )
        })}
      </motion.div>

      {/* Edit job dialog */}
      <Dialog open={!!editingJob} onOpenChange={(open) => !open && setEditingJob(null)}>
        {/* Spacious two-pane dialog: fixed header + scrollable body (matches Post a Job).
            Outside/focus interactions never dismiss it — a stray click or the OS
            file picker must not eat the recruiter's edits mid-flight. */}
        <DialogContent
          className="grid h-[100dvh] max-h-[100dvh] w-full max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-clip rounded-none border-0 p-0 sm:h-auto sm:max-h-[94dvh] sm:max-w-3xl sm:rounded-2xl lg:max-w-5xl [&>button]:z-20"
          onScroll={clampDialogShellScroll}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="shrink-0 border-b border-slate-200 py-4 pr-14 pl-5 text-left dark:border-slate-800 sm:pl-6">
            <DialogTitle>Edit job — {editingJob?.title}</DialogTitle>
            <DialogDescription>
              Update any field below. Existing applications are kept; new applicants see the
              updated role immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-5 py-4 sm:px-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
            {editingJob && (
              <FormErrorBoundary resetKey={editingJob.id}>
              <PostJobForm
                recruiterId={user?.id ?? ''}
                editJob={{
                  id: editingJob.id,
                  title: editingJob.title,
                  description: editingJob.description,
                  location: editingJob.location,
                  jobType: editingJob.jobType,
                  workMode: editingJob.workMode,
                  openings: editingJob.openings,
                  experienceMin: editingJob.experienceMin,
                  experienceMax: editingJob.experienceMax,
                  salaryMinLpa: editingJob.salaryMinLpa,
                  salaryMaxLpa: editingJob.salaryMaxLpa,
                  skills: editingJob.skills,
                  jdText: editingJob.jdText,
                  // AI screening is OPTIONAL per job — the editor loads the
                  // recruiter's saved question set when the flag is on.
                  aiInterviewEnabled: editingJob.aiInterviewEnabled,
                  aiInterviewConfig: editingJob.aiInterviewConfig,
                }}
                onSaved={() => setEditingJob(null)}
              />
              </FormErrorBoundary>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent className="max-w-sm rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this job?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.title}” and all of its applications will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 rounded-lg sm:h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="h-11 rounded-lg bg-rose-600 text-white hover:bg-rose-700 sm:h-9"
            >
              <Trash2 className="size-4" aria-hidden /> Delete job
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
