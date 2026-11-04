'use client'

/**
 * RecommendedJobs — AI-era discovery strip on the candidate dashboard.
 *
 * Fetches /api/jobs/recommendations (skill overlap + experience fit +
 * location affinity) and shows the top matches the candidate has NOT applied
 * to yet. Every card explains WHY it is recommended (matched skills, gaps,
 * exp fit) and closes the loop in one tap via ⚡ Easy Apply (same dialog and
 * contract as the jobs search) or "Details" (global job dialog).
 *
 * Renders nothing when there is nothing to show — the Applications tab stays
 * clean for candidates with no profile data or with everything applied.
 */

import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  AlertTriangle,
  Briefcase,
  CalendarClock,
  GraduationCap,
  MapPin,
  RefreshCw,
  Sparkles,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore, formatLpa } from '@/store/app-store'
import { EasyApplyDialog } from '@/components/seewee/EasyApplyDialog'
import { matchBadgeClass, matchBadgeText } from '@/lib/match-ui'
import type { Job } from '@/lib/types'

interface Recommendation extends Job {
  matchPct: number | null
  matchedSkills: string[]
  missingSkills: string[]
  experienceFit: boolean | null
  locationMatch: boolean
}

export function RecommendedJobs({ onApplied }: { onApplied?: () => void }) {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const openJob = useAppStore((s) => s.openJob)

  const [recs, setRecs] = useState<Recommendation[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [easyApplyJob, setEasyApplyJob] = useState<Recommendation | null>(null)

  const isCandidate = user?.role === 'CANDIDATE'

  const fetchRecs = useCallback(async () => {
    if (!user?.id || user.role !== 'CANDIDATE') return
    setRecs(null)
    setLoadError(null)
    try {
      const res = await fetch(`/api/jobs/recommendations?userId=${encodeURIComponent(user.id)}`)
      const json: { data?: { recommendations?: Recommendation[] }; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load recommendations')
      setRecs(json.data?.recommendations ?? [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load recommendations')
    }
  }, [user?.id, user?.role])

  useEffect(() => {
    if (isCandidate) void fetchRecs()
  }, [isCandidate, fetchRecs, refreshKey])

  if (!isCandidate) return null

  // Still loading → show a light skeleton strip so layout doesn't jump.
  if (recs === null && !loadError) {
    return (
      <section aria-label="Loading recommended jobs" aria-busy="true">
        <Card className="rounded-2xl border-blue-100 dark:border-blue-900/50 shadow-sm">
          <CardContent className="space-y-3 p-5">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-blue-600" aria-hidden />
              <Skeleton className="h-4 w-44 rounded-full" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          </CardContent>
        </Card>
      </section>
    )
  }

  if (loadError) {
    return (
      <Card className="rounded-2xl border-amber-200 dark:border-amber-900/60 shadow-sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="size-4" aria-hidden /> {loadError}
          </p>
          <Button size="sm" variant="outline" onClick={() => void fetchRecs()} className="min-h-[40px] rounded-lg">
            <RefreshCw className="size-4" aria-hidden /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  // Nothing to recommend (no profile data, everything applied, or no active
  // jobs) → stay silent; the rest of the tab carries the flow.
  if (!recs || recs.length === 0) return null

  return (
    <section aria-labelledby="recommended-jobs-heading">
      <Card className="overflow-hidden rounded-2xl border-blue-100 dark:border-blue-900/50 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100/70 dark:border-blue-900/40 bg-gradient-to-r from-blue-50/70 to-sky-50/50 dark:from-blue-950/20 dark:to-sky-950/10 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-sm">
              <Sparkles className="size-4" aria-hidden />
            </span>
            <div>
              <h2
                id="recommended-jobs-heading"
                className="text-sm font-bold tracking-tight text-slate-800 dark:text-slate-100"
              >
                Recommended for you
              </h2>
              <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                AI-matched to your skills, experience and location — apply in one tap
              </p>
            </div>
          </div>
          <Badge
            variant="outline"
            className="rounded-full border-blue-200 bg-white/70 dark:border-blue-900/60 dark:bg-blue-950/30 px-2.5 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300"
          >
            {recs.length} new match{recs.length === 1 ? '' : 'es'}
          </Badge>
        </div>

        <CardContent className="grid gap-3 p-4 sm:grid-cols-2">
          {recs.map((job) => (
            <article
              key={job.id}
              className="group flex flex-col gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-card p-4 transition-all hover:border-blue-300 hover:shadow-md dark:hover:border-blue-800"
            >
              {/* title row */}
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => openJob(job.id)}
                    className="block max-w-full truncate text-left text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 transition-colors hover:text-blue-700 dark:hover:text-blue-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                    aria-label={`View details for ${job.title}`}
                  >
                    {job.title}
                  </button>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-medium text-slate-600 dark:text-slate-300">{job.company}</span>
                    {job.location ? (
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="size-3" aria-hidden /> {job.location}
                      </span>
                    ) : null}
                    {job.workMode ? <span>· {job.workMode}</span> : null}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 gap-1 rounded-full ${matchBadgeClass(job.matchPct)}`}
                >
                  <Sparkles className="size-3" aria-hidden />
                  {matchBadgeText(job.matchPct)}
                </Badge>
              </div>

              {/* why recommended — matched skills + gaps */}
              <div className="flex flex-wrap items-center gap-1.5">
                {job.matchedSkills.map((s) => (
                  <span
                    key={`m-${s}`}
                    className="rounded-full border border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/40 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300"
                  >
                    ✓ {s}
                  </span>
                ))}
                {job.missingSkills.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 dark:border-slate-700 px-2 py-0.5 text-[10.5px] text-slate-500 dark:text-slate-400">
                    <GraduationCap className="size-3" aria-hidden />
                    gap: {job.missingSkills.join(', ')}
                  </span>
                )}
                {job.matchPct == null && job.matchedSkills.length === 0 && (
                  <span className="text-[10.5px] text-slate-400 dark:text-slate-500">
                    Add skills in My Profile to sharpen these matches
                  </span>
                )}
              </div>

              {/* meta + actions */}
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800/70 pt-2.5">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-blue-700 dark:text-blue-300">
                    {formatLpa(job.salaryMinLpa, job.salaryMaxLpa)}
                  </span>
                  {job.experienceFit === true ? (
                    <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                      <Briefcase className="size-3" aria-hidden /> fits your experience
                    </span>
                  ) : job.experienceFit === false ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Briefcase className="size-3" aria-hidden /> asks{' '}
                      {job.experienceMin ?? 0}
                      {job.experienceMax ? `-${job.experienceMax}` : '+'} yrs
                    </span>
                  ) : null}
                  <span className="inline-flex items-center gap-0.5">
                    <CalendarClock className="size-3" aria-hidden />
                    {timeAgo(job.createdAt)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openJob(job.id)}
                    className="h-8 min-h-[36px] rounded-lg px-2.5 text-xs font-medium text-slate-500 hover:text-blue-700"
                  >
                    Details
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setEasyApplyJob(job)}
                    aria-label={`Easy apply to ${job.title}`}
                    className="h-8 min-h-[36px] gap-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-3 text-xs font-semibold text-white shadow-sm hover:from-amber-600 hover:to-orange-600"
                  >
                    <Zap className="size-3.5" aria-hidden /> Easy Apply
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </CardContent>
      </Card>

      {/* same one-tap apply flow as job search — contract identical.
          onApplied closes the dialog FIRST so the refetch's loading
          skeleton can never unmount it mid-done-state and pop it back
          open as a fresh (already-applied) dialog. */}
      <EasyApplyDialog
        job={easyApplyJob}
        onClose={() => setEasyApplyJob(null)}
        onApplied={() => {
          setEasyApplyJob(null)
          toast('Recommendations refreshed', {
            description: 'Applied roles move to your Applications list below.',
          })
          void fetchRecs()
          onApplied?.()
        }}
      />
    </section>
  )
}

function timeAgo(iso?: string | null): string {
  if (!iso) return ''
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}
