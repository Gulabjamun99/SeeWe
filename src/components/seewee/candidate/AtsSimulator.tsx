'use client'

/**
 * AtsSimulator — candidate-side "ATS check" widget (self-contained).
 *
 * Lets a candidate see how their own profile scores against a live job BEFORE
 * they apply: a match percentage ring, skill/context breakdown, honest
 * strengths & gaps, keywords missing from their profile, and concrete
 * profile-improvement suggestions. Uses only the candidate's own data — no
 * recruiter-side evaluation ever appears here.
 *
 * The dashboard wires this in with <AtsSimulator user={user} />. Nothing is
 * persisted server-side; the check can be re-run freely and switching jobs
 * resets the result.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Gauge,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

interface PickerJob {
  id: string
  title: string
  company: string
  skills?: string
  location?: string
}

interface AtsResult {
  matchPct: number
  skillPct: number | null
  contextPct: number
  strengths: string[]
  gaps: string[]
  suggestions: string[]
  missingKeywords: string[]
  verdictLine: string
  source: 'ai' | 'fallback'
  job: { id: string; title: string; company: string }
}

/** Ring colour + text colour by score band. */
function band(pct: number) {
  if (pct >= 75) {
    return { ring: 'stroke-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' }
  }
  if (pct >= 50) {
    return { ring: 'stroke-amber-500', text: 'text-amber-600 dark:text-amber-400' }
  }
  return { ring: 'stroke-rose-500', text: 'text-rose-600 dark:text-rose-400' }
}

function MatchRing({ pct }: { pct: number }) {
  const size = 132
  const stroke = 11
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  const { ring, text } = band(clamped)

  return (
    <div className="relative inline-grid place-items-center" role="img" aria-label={`Match score ${clamped} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-slate-200 dark:stroke-slate-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - clamped / 100)}
          className={`${ring} transition-[stroke-dashoffset] duration-700 ease-out`}
        />
      </svg>
      <div className="absolute text-center">
        <div className={`text-3xl font-extrabold tabular-nums ${text}`}>{clamped}%</div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
          match
        </div>
      </div>
    </div>
  )
}

export default function AtsSimulator({ user }: { user: { id: string; name?: string } }) {
  const [jobs, setJobs] = useState<PickerJob[] | null>(null)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<AtsResult | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const selectedJob = useMemo(
    () => jobs?.find((j) => j.id === selectedJobId) ?? null,
    [jobs, selectedJobId]
  )

  const fetchJobs = useCallback(async () => {
    setJobs(null)
    setJobsError(null)
    setSelectedJobId('')
    try {
      // Public listing — ACTIVE jobs only.
      const res = await fetch('/api/jobs?limit=30&sort=recent')
      const json: { data?: { jobs?: PickerJob[] }; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Could not load jobs')
      const list = json.data?.jobs ?? []
      setJobs(list)
    } catch (err) {
      setJobsError(err instanceof Error ? err.message : 'Could not load jobs right now')
    }
  }, [])

  useEffect(() => {
    void fetchJobs()
  }, [fetchJobs])

  const filteredJobs = useMemo(() => {
    if (!jobs) return []
    const f = filter.trim().toLowerCase()
    if (!f) return jobs.slice(0, 30)
    return jobs
      .filter((j) =>
        [j.title, j.company, j.skills, j.location]
          .map((x) => (x || '').toLowerCase())
          .some((x) => x.includes(f))
      )
      .slice(0, 30)
  }, [jobs, filter])

  // Switching jobs resets the previous result — always a fresh check.
  useEffect(() => {
    setResult(null)
    setRunError(null)
  }, [selectedJobId])

  const runCheck = useCallback(async () => {
    if (!selectedJobId || !user?.id) return
    setRunning(true)
    setRunError(null)
    setResult(null)
    try {
      const res = await fetch('/api/ai/ats-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, jobId: selectedJobId }),
      })
      const json: { data?: AtsResult; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Could not run the check right now')
      }
      setResult(json.data)
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Could not run the check right now')
    } finally {
      setRunning(false)
    }
  }, [selectedJobId, user?.id])

  const selectedLabel = selectedJob ? `${selectedJob.title} · ${selectedJob.company}` : 'a job'

  return (
    <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-indigo-50/80 to-sky-50/50 px-5 py-4 dark:border-slate-800 dark:from-indigo-950/30 dark:to-sky-950/20">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-sky-500 text-white shadow-sm">
          <Target className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-tight text-slate-800 dark:text-slate-100">
            ATS check
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            See how your profile scores against a live job — before you apply.
          </p>
        </div>
      </div>

      <CardContent className="space-y-4 p-5">
        {/* Job picker */}
        <div className="space-y-2">
          <Label htmlFor="ats-job-filter" className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Pick a live job
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              id="ats-job-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search by title, company or skill…"
              className="min-h-[42px] rounded-lg pl-9"
              autoComplete="off"
            />
          </div>

          {jobs === null && !jobsError && (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-[42px] w-full rounded-lg" />
            </div>
          )}

          {jobsError && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/60 dark:bg-amber-950/30">
              <p className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" aria-hidden /> {jobsError}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void fetchJobs()}
                className="min-h-[36px] rounded-lg"
              >
                <RefreshCw className="size-4" aria-hidden /> Retry
              </Button>
            </div>
          )}

          {jobs !== null && !jobsError && (
            <div className="space-y-1.5">
              <Label htmlFor="ats-job-select" className="sr-only">
                Choose a job
              </Label>
              <select
                id="ats-job-select"
                value={selectedJobId}
                onChange={(e) => setSelectedJobId(e.target.value)}
                className="min-h-[42px] w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              >
                <option value="">
                  {filteredJobs.length > 0
                    ? '— choose a job —'
                    : filter.trim()
                      ? 'No jobs match your search'
                      : 'No active jobs right now'}
                </option>
                {filteredJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} · {j.company}
                  </option>
                ))}
              </select>
              {jobs.length === 0 && !filter.trim() && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  There are no open roles to check against yet — check back soon.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Run */}
        <Button
          type="button"
          disabled={!selectedJobId || running}
          onClick={() => void runCheck()}
          className="min-h-[44px] w-full rounded-lg bg-gradient-to-r from-indigo-600 to-sky-500 text-white shadow-sm hover:from-indigo-500 hover:to-sky-400 sm:w-auto"
        >
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Reading your profile against {selectedLabel}…
            </>
          ) : (
            <>
              <Gauge className="size-4" aria-hidden />
              Run check
            </>
          )}
        </Button>

        {/* Honest error state */}
        {runError && !running && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-3 dark:border-rose-900/60 dark:bg-rose-950/30">
            <p className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{runError}</span>
            </p>
          </div>
        )}

        {/* Results */}
        {result && !running && (
          <div className="space-y-4" aria-live="polite">
            {/* Score ring + stats */}
            <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40 sm:flex-row sm:items-center sm:gap-6">
              <MatchRing pct={result.matchPct} />
              <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
                <p className="text-sm text-slate-600 dark:text-slate-300">{result.verdictLine}</p>
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <Badge variant="outline" className="rounded-full font-semibold">
                    Skill match: {result.skillPct === null ? '—' : `${result.skillPct}%`}
                  </Badge>
                  <Badge variant="outline" className="rounded-full font-semibold">
                    Context fit: {result.contextPct}%
                  </Badge>
                </div>
                {result.skillPct === null && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Add skills to your profile to get a skill-match percentage.
                  </p>
                )}
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Checked against {result.job.title} · {result.job.company}
                  {result.source === 'fallback' ? ' · basic keyword check (simplified mode)' : ''}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Strengths */}
              <section
                aria-label="Strengths"
                className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20"
              >
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" aria-hidden /> Strengths
                </h3>
                <ul className="space-y-1.5">
                  {result.strengths.map((s, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Gaps */}
              <section
                aria-label="Gaps"
                className="rounded-xl border border-rose-200/70 bg-rose-50/50 p-4 dark:border-rose-900/50 dark:bg-rose-950/20"
              >
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-rose-700 dark:text-rose-400">
                  <XCircle className="size-4" aria-hidden /> Gaps
                </h3>
                <ul className="space-y-1.5">
                  {result.gaps.map((g, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-sm text-slate-700 dark:text-slate-200">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-rose-500" aria-hidden />
                      <span>{g}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            {/* Missing keywords */}
            {result.missingKeywords.length > 0 && (
              <section
                aria-label="Missing keywords"
                className="rounded-xl border border-stone-200/70 bg-stone-50/60 p-4 dark:border-stone-800 dark:bg-stone-900/30"
              >
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Missing keywords — in the job, not in your profile
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {result.missingKeywords.map((k, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="rounded-full bg-stone-200/80 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                    >
                      {k}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Only add the ones you can honestly speak to.
                </p>
              </section>
            )}

            {/* Suggestions */}
            <section
              aria-label="Make your profile stronger"
              className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20"
            >
              <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                <Sparkles className="size-4" aria-hidden /> Make your profile stronger
              </h3>
              <ol className="space-y-2">
                {result.suggestions.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 rounded-lg border border-amber-200/60 bg-white/70 p-2.5 dark:border-amber-900/40 dark:bg-slate-900/50"
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-amber-500/90 text-[11px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="text-sm text-slate-700 dark:text-slate-200">{s}</span>
                  </li>
                ))}
              </ol>
            </section>

            {/* Re-run */}
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runCheck()}
                disabled={running}
                className="min-h-[38px] rounded-lg"
              >
                <ListChecks className="size-4" aria-hidden />
                {running ? 'Checking…' : 'Run again'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
