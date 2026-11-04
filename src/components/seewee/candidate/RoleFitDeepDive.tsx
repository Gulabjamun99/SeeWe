'use client'

/**
 * RoleFitDeepDive — candidate-side "Contextual role-fit deep-dive" widget
 * (self-contained).
 *
 * The narrative companion to AtsSimulator (which shows a % keyword match):
 * this maps the candidate's ACTUAL projects and story onto one live job —
 * how to pitch their past work for this specific role, what transfers,
 * where the honest gaps are, and how to prepare for the likely interview
 * questions. Everything here is the candidate's own self-assessment; no
 * recruiter-side evaluation is ever shown or requested.
 *
 * The dashboard wires this in with <RoleFitDeepDive user={user} />. Nothing
 * is persisted server-side; the deep-dive can be re-run freely and switching
 * jobs resets the result.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  Compass,
  Hammer,
  Layers,
  Loader2,
  MessagesSquare,
  Mountain,
  RefreshCw,
  Search,
  Timer,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
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

type Readiness = 'READY_NOW' | 'READY_SOON' | 'STRETCH'

interface DeepDiveResult {
  fitSummary: string
  projectAngles: { title: string; pitch: string }[]
  transferableStrengths: string[]
  riskFlags: string[]
  interviewPrep: { question: string; angle: string }[]
  readiness: Readiness
  readinessLine: string
  source: 'ai' | 'heuristic'
  job: { id: string; title: string; company: string }
}

const READINESS_META: Record<
  Readiness,
  { label: string; banner: string; icon: React.ReactNode; badge: string }
> = {
  READY_NOW: {
    label: 'Ready now',
    banner:
      'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
    icon: <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />,
    badge: 'bg-emerald-600 text-white',
  },
  READY_SOON: {
    label: 'Ready soon',
    banner:
      'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
    icon: <Timer className="size-5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />,
    badge: 'bg-amber-500 text-white',
  },
  STRETCH: {
    label: 'Stretch',
    banner:
      'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200',
    icon: <Mountain className="size-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />,
    badge: 'bg-rose-600 text-white',
  },
}

export default function RoleFitDeepDive({ user }: { user: { id: string; name?: string } }) {
  const [jobs, setJobs] = useState<PickerJob[] | null>(null)
  const [jobsError, setJobsError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [selectedJobId, setSelectedJobId] = useState('')

  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<DeepDiveResult | null>(null)
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

  // Switching jobs resets the previous result — always a fresh deep-dive.
  useEffect(() => {
    setResult(null)
    setRunError(null)
  }, [selectedJobId])

  const runDeepDive = useCallback(async () => {
    if (!selectedJobId || !user?.id) return
    setRunning(true)
    setRunError(null)
    setResult(null)
    try {
      const res = await fetch('/api/ai/role-fit-deepdive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, jobId: selectedJobId }),
      })
      const json: { data?: DeepDiveResult; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Could not run the deep-dive right now')
      }
      setResult(json.data)
      toast.success('Deep-dive ready', {
        description: `Your honest read on ${json.data.job.title} · ${json.data.job.company}.`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not run the deep-dive right now'
      setRunError(msg)
      toast.error('Deep-dive failed', { description: msg })
    } finally {
      setRunning(false)
    }
  }, [selectedJobId, user?.id])

  const selectedLabel = selectedJob ? `${selectedJob.title} · ${selectedJob.company}` : 'a job'
  const loadingCopy = selectedJob
    ? `Mapping your experience to ${selectedJob.title}…`
    : 'Mapping your experience…'
  const readinessMeta = result ? READINESS_META[result.readiness] : null

  return (
    <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-sm dark:border-slate-800">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-violet-50/80 to-fuchsia-50/50 px-5 py-4 dark:border-slate-800 dark:from-violet-950/30 dark:to-fuchsia-950/20">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 text-white shadow-sm">
          <Compass className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold tracking-tight text-slate-800 dark:text-slate-100">
            Role-fit deep-dive
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Beyond keywords — how your actual projects and story map to a specific role.
          </p>
        </div>
      </div>

      <CardContent className="space-y-4 p-5">
        {/* Job picker */}
        <div className="space-y-2">
          <Label
            htmlFor="rfd-job-filter"
            className="text-xs font-medium text-slate-600 dark:text-slate-300"
          >
            Pick a live job
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              id="rfd-job-filter"
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
              <Label htmlFor="rfd-job-select" className="sr-only">
                Choose a job
              </Label>
              <select
                id="rfd-job-select"
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
                  There are no open roles to map against yet — check back soon.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Run */}
        <Button
          type="button"
          disabled={!selectedJobId || running}
          onClick={() => void runDeepDive()}
          className="min-h-[44px] w-full rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white shadow-sm hover:from-violet-500 hover:to-fuchsia-400 sm:w-auto"
        >
          {running ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {loadingCopy}
            </>
          ) : (
            <>
              <Compass className="size-4" aria-hidden />
              Run deep-dive
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
            {!runError.includes('no longer active') && !runError.includes('Add skills') && (
              <div className="mt-2.5 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void runDeepDive()}
                  className="min-h-[38px] rounded-lg"
                >
                  <RefreshCw className="size-4" aria-hidden /> Retry
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Loading skeleton */}
        {running && (
          <div className="space-y-3" aria-busy="true" aria-label="Deep-dive in progress">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <div className="grid gap-3 md:grid-cols-2">
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
            <p className="text-center text-xs text-slate-500 dark:text-slate-400">{loadingCopy}</p>
          </div>
        )}

        {/* Results */}
        {result && !running && readinessMeta && (
          <div className="space-y-4" aria-live="polite">
            {/* Readiness banner */}
            <div
              className={`flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-start sm:gap-3 ${readinessMeta.banner}`}
            >
              {readinessMeta.icon}
              <div className="min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={`rounded-full text-[11px] font-bold ${readinessMeta.badge}`}>
                    {readinessMeta.label}
                  </Badge>
                  <span className="text-xs font-medium opacity-80">
                    self-assessment for {result.job.title}
                  </span>
                </div>
                <p className="text-sm font-medium">{result.readinessLine}</p>
              </div>
            </div>

            {/* Fit summary */}
            <section
              aria-label="Fit summary"
              className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <h3 className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Fit summary
              </h3>
              <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                {result.fitSummary}
              </p>
            </section>

            {/* Pitch these projects */}
            <section aria-label="Pitch these projects" className="space-y-2.5">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-400">
                <Hammer className="size-4" aria-hidden /> Pitch these projects
              </h3>
              <div className="grid gap-3 md:grid-cols-2">
                {result.projectAngles.map((a, i) => (
                  <article
                    key={i}
                    className="rounded-xl border border-violet-200/70 bg-violet-50/50 p-4 dark:border-violet-900/50 dark:bg-violet-950/20"
                  >
                    <h4 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                      {a.title}
                    </h4>
                    <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      {a.pitch}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Transferable strengths */}
              <section
                aria-label="Transferable strengths"
                className="rounded-xl border border-emerald-200/70 bg-emerald-50/50 p-4 dark:border-emerald-900/50 dark:bg-emerald-950/20"
              >
                <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                  <Layers className="size-4" aria-hidden /> Transferable strengths
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {result.transferableStrengths.map((s, i) => (
                    <Badge
                      key={i}
                      className="rounded-full bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/50 dark:text-emerald-200"
                    >
                      {s}
                    </Badge>
                  ))}
                </div>
              </section>

              {/* Honest gaps */}
              <section
                aria-label="Honest gaps"
                className="rounded-xl border border-amber-200/70 bg-amber-50/50 p-4 dark:border-amber-900/50 dark:bg-amber-950/20"
              >
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="size-4" aria-hidden /> Honest gaps
                </h3>
                <ul className="space-y-1.5">
                  {result.riskFlags.length > 0 ? (
                    result.riskFlags.map((g, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-1.5 text-sm text-slate-700 dark:text-slate-200"
                      >
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
                        <span>{g}</span>
                      </li>
                    ))
                  ) : (
                    <li className="text-sm text-slate-700 dark:text-slate-200">
                      No obvious gaps flagged — depth in the interview is what to focus on.
                    </li>
                  )}
                </ul>
              </section>
            </div>

            {/* Likely interview questions */}
            <section
              aria-label="Likely interview questions"
              className="rounded-xl border border-stone-200/70 bg-stone-50/60 p-4 dark:border-stone-800 dark:bg-stone-900/30"
            >
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                <MessagesSquare className="size-4" aria-hidden /> Likely interview questions
              </h3>
              <Accordion type="single" collapsible className="w-full">
                {result.interviewPrep.map((p, i) => (
                  <AccordionItem key={i} value={`prep-${i}`} className="border-stone-200/80 dark:border-stone-800">
                    <AccordionTrigger className="min-h-11 py-3 text-left text-sm font-medium text-slate-800 hover:no-underline dark:text-slate-100">
                      <span className="flex items-start gap-2 pr-2">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-stone-300/80 text-[11px] font-bold text-stone-700 dark:bg-stone-700 dark:text-stone-200">
                          {i + 1}
                        </span>
                        <span>{p.question}</span>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-1.5 pb-3 pl-7">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-violet-600 dark:text-violet-400">
                        <BookOpenCheck className="size-3.5" aria-hidden /> Your angle
                      </p>
                      <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                        {p.angle}
                      </p>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </section>

            {/* Footer: source + re-run */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-400 dark:text-slate-500">
                Mapped against {result.job.title} · {result.job.company}
                {result.source === 'heuristic'
                  ? ' · simplified mode (keyword + band heuristics, no narrative AI)'
                  : ' · narrative AI, your own self-assessment only'}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runDeepDive()}
                disabled={running}
                className="min-h-[38px] rounded-lg"
              >
                <RefreshCw className="size-4" aria-hidden />
                {running ? 'Mapping…' : 'Run again'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
