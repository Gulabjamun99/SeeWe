'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useAppStore, formatLpa } from '@/store/app-store'
import type { Job } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  MapPin,
  RefreshCw,
  SearchX,
  Send,
  UsersRound,
  X,
} from 'lucide-react'

interface CompanyDialogProps {
  /** Company name to show, or null to render nothing */
  company: string | null
  onClose: () => void
}

interface CompanyPayload {
  name: string
  jobs: Job[]
}

// Deterministic blue→sky gradients — hashed from the company name so each
// company always gets the same avatar color (brand palette only, no indigo).
const AVATAR_GRADIENTS = [
  'from-blue-500 to-sky-600',
  'from-sky-500 to-blue-700',
  'from-blue-600 to-cyan-500',
  'from-cyan-500 to-sky-600',
  'from-blue-400 to-sky-500',
  'from-sky-600 to-blue-500',
]

function gradientFor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash += name.charCodeAt(i)
  return AVATAR_GRADIENTS[hash % AVATAR_GRADIENTS.length]
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Company profile dialog — shows every ACTIVE job at one company.
 * Self-contained overlay (no store state): opened from anywhere a company
 * name is clickable (job cards, job detail header). "View & apply" hands the
 * job id to the global JobDetailDialog via the app store and closes this one.
 */
export function CompanyDialog({ company, onClose }: CompanyDialogProps) {
  // ----- escape closes only the top-most dialog. Radix's useEscapeKeydown
  // also listens on document (capture) and registered earlier, so we listen
  // one level up (window capture) to run before it — otherwise Escape would
  // close the job detail dialog underneath as well. -----
  useEffect(() => {
    if (!company) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [company, onClose])

  // ----- lock background scroll only if no other dialog already did -----
  useEffect(() => {
    if (!company) return
    const body = document.body
    if (body.style.overflow === 'hidden') return
    const prev = body.style.overflow
    body.style.overflow = 'hidden'
    return () => {
      body.style.overflow = prev
    }
  }, [company])

  if (!company) return null

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${company} company profile`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {/* Backdrop */}
      <motion.div
        aria-hidden
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
      />

      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 shadow-2xl"
      >
        {/* key remounts the profile per company — fresh loading/data state */}
        <CompanyProfile key={company} company={company} onClose={onClose} />

        {/* Footer */}
        <div className="border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/60 px-5 py-3">
          <p className="text-center text-xs text-slate-500 dark:text-slate-400">
            Showing all active roles at <span className="font-semibold text-slate-700 dark:text-slate-300">{company}</span> on
            SeeWe
          </p>
        </div>
      </motion.div>
    </div>
  )
}

/** Header + scrollable job list; own fetch lifecycle (remounted per company). */
function CompanyProfile({ company, onClose }: { company: string; onClose: () => void }) {
  const [data, setData] = useState<CompanyPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const closeRef = useRef<HTMLButtonElement | null>(null)

  // Focus the close button on open; restore focus to the trigger on close
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const t = window.setTimeout(() => closeRef.current?.focus(), 30)
    return () => {
      window.clearTimeout(t)
      previous?.focus?.()
    }
  }, [])

  // ----- data fetch (async state updates only — never sync in the effect) -----
  useEffect(() => {
    let cancelled = false
    fetch(`/api/companies?name=${encodeURIComponent(company)}`)
      .then(async (r) => {
        const json: { data?: CompanyPayload; error?: string } = await r.json()
        if (!r.ok || json.error) throw new Error(json.error || 'Failed to load company')
        return json
      })
      .then((json) => {
        if (!cancelled) setData(json.data ?? null)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [company, attempt])

  const retry = useCallback(() => {
    setLoading(true)
    setFailed(false)
    setAttempt((a) => a + 1)
  }, [])

  const handleViewAndApply = useCallback(
    (job: Job) => {
      useAppStore.getState().openJob(job.id)
      onClose()
    },
    [onClose]
  )

  const jobs = data?.jobs ?? []
  const totalOpenings = jobs.reduce((sum, j) => sum + j.openings, 0)
  const locations = Array.from(new Set(jobs.map((j) => j.location).filter(Boolean)))

  return (
    <>
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-100 dark:border-slate-800/60 p-5 sm:p-6">
        <span
          aria-hidden
          className={`grid size-12 shrink-0 place-items-center rounded-full bg-gradient-to-br ${gradientFor(company)} text-sm font-black text-white shadow-md`}
        >
          {initialsFor(company)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">{data?.name ?? company}</h2>
          {!loading && !failed && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-medium">
              <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 dark:bg-blue-950/40 px-2.5 py-1 text-blue-700">
                <Building2 className="h-3.5 w-3.5" aria-hidden />
                {jobs.length} open role{jobs.length === 1 ? '' : 's'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 dark:bg-sky-950/40 px-2.5 py-1 text-sky-700">
                <UsersRound className="h-3.5 w-3.5" aria-hidden />
                {totalOpenings} total opening{totalOpenings === 1 ? '' : 's'}
              </span>
              {locations.length > 0 && (
                <span
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-600 dark:text-slate-400"
                  title={locations.join(', ')}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{locations.join(' · ')}</span>
                </span>
              )}
            </div>
          )}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close company profile"
          className="grid size-8 shrink-0 place-items-center rounded-full text-slate-400 dark:text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[60vh] overflow-y-auto px-4 py-4 sm:px-5">
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading company jobs">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4">
                <Skeleton className="h-5 w-2/3" />
                <div className="mt-3 flex gap-2">
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-28 rounded-full" />
                </div>
              </div>
            ))}
          </div>
        ) : failed ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 dark:bg-slate-800/60 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Could not load this company&apos;s jobs.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={retry}
              className="border-blue-200 dark:border-blue-900/70 text-blue-700 hover:bg-blue-50"
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden /> Try again
            </Button>
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 dark:bg-slate-800/60 py-12 text-center">
            <SearchX className="h-8 w-8 text-slate-300" aria-hidden />
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">No open roles right now</p>
            <p className="max-w-xs text-xs text-slate-500 dark:text-slate-400">
              {company} has no active postings on SeeWe at the moment — check back soon.
            </p>
          </div>
        ) : (
          <ul className="space-y-3" aria-label={`Open jobs at ${company}`}>
            {jobs.map((job) => (
              <li
                key={job.id}
                className="rounded-xl border border-slate-200 bg-white dark:bg-slate-900 p-4 transition-colors hover:border-blue-300 hover:bg-blue-50/30"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold text-slate-900 dark:text-slate-100">{job.title}</h3>
                    <p className="mt-0.5 flex items-center gap-1 text-xs font-semibold text-blue-700">
                      {formatLpa(job.salaryMinLpa, job.salaryMaxLpa)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="rounded-full text-[11px]">
                        <MapPin className="mr-1 h-3 w-3" aria-hidden />
                        {job.location}
                      </Badge>
                      <Badge variant="outline" className="rounded-full text-[11px]">
                        {job.jobType}
                      </Badge>
                      <Badge className="rounded-full bg-sky-50 dark:bg-sky-950/40 text-[11px] text-sky-700">{job.workMode}</Badge>
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                        <CalendarClock className="h-3 w-3" aria-hidden />
                        Posted {new Date(job.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        <UsersRound className="h-3 w-3" aria-hidden />
                        {job._count?.applications ?? 0} applied
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleViewAndApply(job)}
                    aria-label={`View and apply to ${job.title}`}
                    className="shrink-0 bg-gradient-to-r from-blue-600 to-sky-600 text-white hover:from-blue-700 hover:to-sky-700"
                  >
                    <Send className="mr-1.5 h-3.5 w-3.5" aria-hidden /> View &amp; apply
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
