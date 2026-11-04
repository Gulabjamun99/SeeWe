'use client'

/**
 * CareerPageView — public, company-branded careers site (deep link
 * ?career={clientId}). Renders the client's open roles with the company's own
 * branding and a "Powered by SeeWe" credit, works fully signed-out.
 *
 * Attribution: any application started from this page is tagged CAREER_PAGE —
 * the source is set on mount and only cleared when the visitor leaves
 * (successful applies re-assert it so multi-apply stays attributed).
 */

import { useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Clock3,
  Compass,
  GraduationCap,
  MapPin,
  SearchX,
  UsersRound,
  Wallet,
} from 'lucide-react'

import { useAppStore, skillsToArray, formatLpa } from '@/store/app-store'
import type { CareerPageJob, CareerPageResponse } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export function CareerPageView() {
  const careerClientId = useAppStore((s) => s.careerClientId)
  const setCareerClientId = useAppStore((s) => s.setCareerClientId)
  const setApplySource = useAppStore((s) => s.setApplySource)
  const setView = useAppStore((s) => s.setView)
  const openJob = useAppStore((s) => s.openJob)
  const user = useAppStore((s) => s.user)

  /** Client-tagged load result — `clientId` lets the render derive loading vs
   * current data without synchronous state resets inside the effect. */
  const [loaded, setLoaded] = useState<{
    clientId: string
    company: CareerPageResponse['company']
    jobs: CareerPageJob[]
  } | null>(null)
  const [failed, setFailed] = useState<{ clientId: string; message: string } | null>(null)

  // While the visitor is on this career page, applications attribute to it.
  // (Deep-link ?src=career sets the same value — this covers in-app entries too.)
  useEffect(() => {
    setApplySource('CAREER_PAGE')
    return () => setApplySource(null)
  }, [setApplySource])

  useEffect(() => {
    if (!careerClientId) return
    let cancelled = false
    fetch(`/api/career-page?clientId=${encodeURIComponent(careerClientId)}`)
      .then(
        (res) =>
          res.json() as Promise<{ data?: CareerPageResponse; error?: string }>
      )
      .then((json) => {
        if (cancelled) return
        if (json.error || !json.data) {
          throw new Error(json.error || 'Career page not found')
        }
        setFailed(null)
        setLoaded({
          clientId: careerClientId,
          company: json.data.company,
          jobs: json.data.jobs,
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoaded(null)
        setFailed({
          clientId: careerClientId,
          message: err instanceof Error ? err.message : 'Could not load this career page',
        })
      })
    return () => {
      cancelled = true
    }
  }, [careerClientId])

  const isLoaded = loaded?.clientId === careerClientId
  const loadError = failed?.clientId === careerClientId ? failed.message : null
  const company = isLoaded ? loaded.company : null
  const jobs = isLoaded ? loaded.jobs : null // null = loading / not this client's data
  const companyName = company?.name ?? '…'

  /** Leave the career page and land somewhere sensible for this visitor */
  function leaveCareerPage(target: 'back' | 'explore') {
    setCareerClientId(null)
    setApplySource(null)
    if (target === 'explore') {
      setView('browse')
      return
    }
    const role = user?.role
    setView(
      role === 'RECRUITER'
        ? 'recruiter'
        : role === 'CLIENT'
          ? 'client'
          : role === 'ADMIN'
            ? 'admin'
            : role === 'CANDIDATE'
              ? 'browse'
              : 'home'
    )
  }

  // Missing/unknown clientId handoff — friendly dead end with a way out
  if (!careerClientId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <Compass className="size-10 text-emerald-600" aria-hidden />
        <p className="text-lg font-bold text-stone-800 dark:text-stone-100">Career page not found</p>
        <p className="max-w-sm text-sm text-stone-500 dark:text-stone-400">
          This careers link is missing its company identifier. Ask the hiring team for a fresh link.
        </p>
        <Button variant="outline" className="rounded-xl" onClick={() => leaveCareerPage('back')}>
          <ArrowLeft className="size-4" aria-hidden /> Go to SeeWe
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur dark:border-stone-800 dark:bg-stone-950/70">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => leaveCareerPage('back')}
            className="inline-flex h-9 min-w-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800/70 dark:hover:text-stone-50"
          >
            <ArrowLeft className="size-4" aria-hidden />
            <span className="hidden sm:inline">Back</span>
          </button>
          <span className="truncate text-xs font-bold uppercase tracking-[0.2em] text-emerald-700 dark:text-emerald-400">
            Careers
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {/* Hero */}
        <section className="overflow-hidden rounded-3xl border border-stone-200 bg-gradient-to-br from-emerald-50 via-white to-amber-50/60 p-6 sm:p-10 dark:border-stone-800 dark:from-stone-900 dark:via-stone-900 dark:to-emerald-950/40">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
            <span
              aria-hidden
              className="grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-2xl font-black text-white shadow-md"
            >
              {companyName.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
                Careers at {companyName}
              </p>
              <h1 className="mt-1 break-words text-3xl font-black leading-tight text-stone-900 sm:text-4xl dark:text-stone-50">
                {companyName}
              </h1>
              {company?.industry && (
                <Badge
                  variant="outline"
                  className="mt-3 rounded-full border-emerald-300 bg-emerald-50/80 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                >
                  <Building2 className="mr-1 size-3" aria-hidden /> {company.industry}
                </Badge>
              )}
            </div>
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-stone-200/70 pt-5 text-sm font-semibold text-stone-600 dark:border-stone-700/60 dark:text-stone-300">
            <span className="inline-flex items-center gap-1.5">
              <BriefcaseBusiness className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              Open positions ({jobs?.length ?? 0})
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs font-normal text-stone-400 dark:text-stone-500">
              <Clock3 className="size-3.5" aria-hidden /> Roles update in real time
            </span>
          </div>
        </section>

        {/* Listings */}
        <section aria-label="Open positions" className="mt-8">
          {loadError ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/60 p-12 text-center dark:border-rose-900/60 dark:bg-rose-950/30">
              <SearchX className="size-10 text-rose-400" aria-hidden />
              <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{loadError}</p>
              <Button variant="outline" className="rounded-xl" onClick={() => leaveCareerPage('back')}>
                Go to SeeWe
              </Button>
            </div>
          ) : jobs === null ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-stone-200 p-5 dark:border-stone-800">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="mt-2 h-4 w-1/2" />
                  <div className="mt-4 flex gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="mt-4 h-9 w-full rounded-lg" />
                </div>
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-12 text-center dark:border-stone-700 dark:bg-stone-900/50">
              <span className="grid size-14 place-items-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/40">
                <BriefcaseBusiness className="size-7 text-emerald-600 dark:text-emerald-400" aria-hidden />
              </span>
              <p className="font-semibold text-stone-800 dark:text-stone-100">
                No open roles right now — check back soon
              </p>
              <p className="max-w-sm text-sm text-stone-500 dark:text-stone-400">
                New openings at {companyName} will appear here the moment the hiring team posts them.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {jobs.map((job) => (
                <CareerJobCard key={job.id} job={job} onApply={() => openJob(job.id)} />
              ))}
            </div>
          )}
        </section>

        {/* Cross-link for candidates who want the wider marketplace */}
        <div className="mt-10 text-center">
          <button
            type="button"
            onClick={() => leaveCareerPage('explore')}
            className="text-sm font-semibold text-emerald-700 underline-offset-4 transition-colors hover:text-emerald-800 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            Explore more jobs on SeeWe →
          </button>
        </div>
      </main>

      {/* Powered-by footer (sticky bottom via flex + mt-auto) */}
      <footer className="mt-auto border-t border-stone-200 bg-stone-50 py-5 dark:border-stone-800 dark:bg-stone-950/60">
        <p className="text-center text-xs text-stone-400 dark:text-stone-500">
          Powered by{' '}
          <span className="font-bold text-emerald-700 dark:text-emerald-400">SeeWe</span> — where
          talent meets opportunity
        </p>
      </footer>
    </div>
  )
}

/** One open role on the public career page */
function CareerJobCard({ job, onApply }: { job: CareerPageJob; onApply: () => void }) {
  const skills = skillsToArray(job.skills)

  return (
    <article className="flex flex-col rounded-2xl border border-stone-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-stone-800 dark:bg-stone-900">
      <div className="min-w-0">
        <h3 className="break-words text-base font-bold leading-snug text-stone-900 dark:text-stone-50">
          {job.title}
        </h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-stone-500 dark:text-stone-400">
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5 shrink-0" aria-hidden /> {job.location}
          </span>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
          </span>
        </p>
      </div>

      {/* Meta chips */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge variant="outline" className="rounded-full border-stone-300 text-stone-600 dark:border-stone-700 dark:text-stone-300">
          {job.jobType}
        </Badge>
        <Badge className="rounded-full border-0 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
          {job.workMode}
        </Badge>
        {job.openings > 1 && (
          <Badge variant="secondary" className="rounded-full bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            <UsersRound className="mr-1 size-3" aria-hidden /> {job.openings} openings
          </Badge>
        )}
      </div>

      {/* Salary + experience */}
      <div className="mt-3 grid grid-cols-1 gap-1 text-xs text-stone-600 dark:text-stone-300 sm:grid-cols-2">
        <span className="inline-flex items-center gap-1.5">
          <Wallet className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <span className="truncate">{formatLpa(job.salaryMinLpa, job.salaryMaxLpa)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <GraduationCap className="size-3.5 shrink-0 text-stone-400 dark:text-stone-500" aria-hidden />
          {job.experienceMin}–{job.experienceMax} yrs
        </span>
      </div>

      {/* Skills */}
      {skills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {skills.slice(0, 5).map((s) => (
            <span
              key={s}
              className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200/70 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900/60"
            >
              {s}
            </span>
          ))}
          {skills.length > 5 && (
            <span className="rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              +{skills.length - 5} more
            </span>
          )}
        </div>
      )}

      <div className="mt-auto pt-4">
        <Button
          onClick={onApply}
          aria-label={`Apply to ${job.title} at ${job.company}`}
          className="h-10 w-full rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-sm font-semibold text-white shadow-sm hover:from-emerald-700 hover:to-emerald-600"
        >
          Apply
        </Button>
      </div>
    </article>
  )
}
