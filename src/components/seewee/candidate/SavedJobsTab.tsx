'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAppStore, skillsToArray, formatLpa } from '@/store/app-store'
import type { Job } from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { SaveJobButton } from '@/components/seewee/SaveJobButton'
import {
  AlertTriangle,
  Bookmark,
  BriefcaseBusiness,
  CalendarClock,
  IndianRupee,
  MapPin,
  RefreshCw,
  SearchX,
} from 'lucide-react'

type SavedJob = Job & { savedAt?: string }

/** Bookmarked jobs tab for the candidate dashboard. */
export function SavedJobsTab() {
  const user = useAppStore((s) => s.user)
  const savedJobIds = useAppStore((s) => s.savedJobIds)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const openJob = useAppStore((s) => s.openJob)

  const [jobs, setJobs] = useState<SavedJob[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user || user.role !== 'CANDIDATE') return
    setError(null)
    try {
      const res = await fetch(`/api/saved-jobs?userId=${encodeURIComponent(user.id)}`)
      const json: { data?: SavedJob[]; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load')
      setJobs(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load saved jobs')
      setJobs([])
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load, refreshKey, savedJobIds.length])

  if (!user || user.role !== 'CANDIDATE') return null

  return (
    <div className="space-y-4">
      {/* loading */}
      {jobs === null && !error && (
        <div className="grid gap-4 sm:grid-cols-2" aria-label="Loading saved jobs">
          {[0, 1].map((i) => (
            <Card key={i} className="rounded-2xl shadow-md">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3 rounded-full" />
                    <Skeleton className="h-3 w-1/3 rounded-full" />
                  </div>
                </div>
                <Skeleton className="h-8 w-full rounded-xl" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* error */}
      {error && (
        <Card className="rounded-2xl border-rose-200 dark:border-rose-900/60 shadow-md">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-rose-600">
              <AlertTriangle className="size-4" aria-hidden /> {error}
            </p>
            <Button size="sm" variant="outline" onClick={() => void load()} className="min-h-[40px]">
              <RefreshCw className="size-4" aria-hidden /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* empty */}
      {jobs !== null && !error && jobs.length === 0 && (
        <Card className="rounded-2xl border-dashed shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-blue-50 dark:bg-blue-950/40">
              <Bookmark className="size-6 text-blue-500" aria-hidden />
            </span>
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">No saved jobs yet</h3>
            <p className="max-w-xs text-sm text-slate-500 dark:text-slate-400">
              Tap the 🔖 bookmark on any job card to keep it here for later.
            </p>
            <Button
              onClick={() => useAppStore.getState().setView('browse')}
              className="mt-1 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700"
            >
              Discover jobs
            </Button>
          </CardContent>
        </Card>
      )}

      {/* saved job cards */}
      {jobs !== null && !error && jobs.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {jobs.map((job) => (
            <Card
              key={job.id}
              className="group cursor-pointer rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
              onClick={() => openJob(job.id)}
            >
              <CardContent className="p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-10">
                      <AvatarFallback className="bg-gradient-to-br from-blue-100 to-sky-100 dark:from-blue-900/40 dark:to-sky-900/40 text-sm font-bold text-blue-700">
                        {job.company.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <h3 className="truncate font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-700">
                        {job.title}
                      </h3>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">{job.company}</p>
                    </div>
                  </div>
                  {/* stopPropagation handled inside SaveJobButton */}
                  <div onClick={(e) => e.stopPropagation()}>
                    <SaveJobButton jobId={job.id} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                    <span className="truncate">{job.location}</span>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <BriefcaseBusiness className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                    {job.experienceMin}–{job.experienceMax} yrs
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <IndianRupee className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                    {formatLpa(job.salaryMinLpa, job.salaryMaxLpa)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                    {job.savedAt
                      ? `Saved ${new Date(job.savedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                      : ''}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {skillsToArray(job.skills).slice(0, 4).map((s) => (
                    <Badge
                      key={s}
                      variant="secondary"
                      className="rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-600 dark:text-slate-400"
                    >
                      {s}
                    </Badge>
                  ))}
                  <Badge className="rounded-full bg-sky-50 dark:bg-sky-950/40 text-[11px] text-sky-700">
                    {job.workMode}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* quiet helper for screen readers when list present */}
      {jobs !== null && jobs.length > 0 && (
        <p className="sr-only">
          <SearchX className="inline size-3" /> {jobs.length} saved jobs listed
        </p>
      )}
    </div>
  )
}
