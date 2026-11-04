'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BarChart3,
  ChevronRight,
  Filter,
  Gavel,
  Globe,
  Link2,
  Share2,
  TrendingUp,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import type { Application, Job } from '@/lib/types'

interface ReportLite {
  verdict?: string | null
  overallScore?: number | null
  clientDecision?: string | null
  clientName?: string | null
  candidateName?: string
  jobTitle?: string
  decidedAt?: string | null
  jobId?: string | null
}

/** One job's journey down the hiring funnel */
interface FunnelRow {
  jobId: string
  title: string
  applied: number
  shortlisted: number
  interviewed: number
  offered: number
  hired: number
  approved: number
}

/** 5-stage funnel: Applied → Shortlisted → Interviewed → Offer → Hired (stone/amber/violet/emerald palette) */
const FUNNEL_STAGES = [
  { key: 'applied', label: 'Applied', dot: 'bg-stone-400', bar: 'bg-stone-400' },
  { key: 'shortlisted', label: 'Shortlisted', dot: 'bg-amber-500', bar: 'bg-amber-500' },
  { key: 'interviewed', label: 'Interviewed', dot: 'bg-violet-500', bar: 'bg-violet-500' },
  { key: 'offered', label: 'Offer', dot: 'bg-emerald-500', bar: 'bg-emerald-500' },
  { key: 'hired', label: 'Hired', dot: 'bg-emerald-700', bar: 'bg-emerald-700' },
] as const

const STAGE_DOTS: Record<string, string> = Object.fromEntries(
  FUNNEL_STAGES.map((s) => [s.key, s.dot])
)

const SHORTLIST_SET = new Set([
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'SHARED_WITH_CLIENT',
  'OFFERED',
  'HIRED',
  'ONBOARDED',
])
const INTERVIEWED_SET = new Set([
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'SHARED_WITH_CLIENT',
  'OFFERED',
  'HIRED',
  'ONBOARDED',
])
const OFFERED_SET = new Set(['OFFERED', 'HIRED', 'ONBOARDED'])
const HIRED_SET = new Set(['HIRED', 'ONBOARDED'])

/* ---------------- Source ROI + velocity (fed by /api/analytics) ---------------- */

interface SourceRow {
  source: string
  label: string
  applications: number
  shortlisted: number
  interviewed: number
  hired: number
  hirePct: number
}

interface FunnelStage {
  key: string
  label: string
  count: number
}

interface AnalyticsPayload {
  bySource: SourceRow[]
  funnel: FunnelStage[]
  timeToOfferDays: number | null
  avgFirstResponseHours: number | null
  totalApplications: number
  generatedAt: string
}

const SOURCE_META: Record<
  string,
  { icon: React.ComponentType<{ className?: string }>; chip: string; bar: string }
> = {
  DIRECT: {
    icon: Users,
    chip: 'bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300',
    bar: 'bg-violet-500',
  },
  SHARED_LINK: {
    icon: Link2,
    chip: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
    bar: 'bg-emerald-500',
  },
  CAREER_PAGE: {
    icon: Globe,
    chip: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-500',
  },
  REFERRAL: {
    icon: UserPlus,
    chip: 'bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300',
    bar: 'bg-stone-500',
  },
}

const DECISION_META: Record<
  string,
  { label: string; color: string; chip: string; emoji: string }
> = {
  APPROVED: {
    label: 'Approved',
    color: '#2563eb',
    chip: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 ring-blue-200',
    emoji: '👍',
  },
  ON_HOLD: {
    label: 'On hold',
    color: '#d97706',
    chip: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 ring-amber-200',
    emoji: '⏸',
  },
  REJECTED: {
    label: 'Declined',
    color: '#e11d48',
    chip: 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 ring-rose-200',
    emoji: '👎',
  },
}

const VERDICT_COLORS: Record<string, string> = {
  STRONG_HIRE: '#2563eb', // blue-600
  HIRE: '#0284c7', // sky-600
  MAYBE: '#d97706', // amber-600
  NO_HIRE: '#e11d48', // rose-600
}

const VERDICT_LABELS: Record<string, string> = {
  STRONG_HIRE: 'Strong Hire',
  HIRE: 'Hire',
  MAYBE: 'Maybe',
  NO_HIRE: 'No Hire',
}

/** Compact analytics strip for the Hiring Hub: applicants per job + AI verdict mix. */
export function RecruiterAnalytics() {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const [loading, setLoading] = useState(true)
  const [perJob, setPerJob] = useState<{ name: string; applicants: number }[]>([])
  const [funnel, setFunnel] = useState<FunnelRow[]>([])
  const [srcRows, setSrcRows] = useState<SourceRow[]>([])
  const [overallFunnel, setOverallFunnel] = useState<FunnelStage[]>([])
  const [velocity, setVelocity] = useState<{
    timeToOfferDays: number | null
    avgFirstResponseHours: number | null
  }>({ timeToOfferDays: null, avgFirstResponseHours: null })
  const [verdicts, setVerdicts] = useState<{ name: string; count: number; key: string }[]>([])
  const [avgScore, setAvgScore] = useState<number | null>(null)
  const [decisions, setDecisions] = useState<{ key: string; count: number }[]>([])
  const [decisionTotal, setDecisionTotal] = useState(0)
  const [latestDecision, setLatestDecision] = useState<{
    candidateName?: string
    jobTitle?: string
    clientName?: string | null
    clientDecision?: string | null
  } | null>(null)

  useEffect(() => {
    if (!user || user.role !== 'RECRUITER') return
    let alive = true

    async function run() {
      setLoading(true)
      try {
        const [jJson, aJson, rJson, anJson] = (await Promise.all([
          fetch(`/api/jobs?recruiterId=${encodeURIComponent(user!.id)}&limit=50`).then((r) => r.json()),
          fetch(`/api/applications?recruiterId=${encodeURIComponent(user!.id)}`).then((r) => r.json()),
          fetch(`/api/interview/report?recruiterId=${encodeURIComponent(user!.id)}`).then((r) => r.json()),
          fetch(`/api/analytics?userId=${encodeURIComponent(user!.id)}`).then((r) => r.json()),
        ])) as [
          { data?: { jobs?: Job[] } },
          { data?: Application[] },
          { data?: ReportLite[] },
          { data?: AnalyticsPayload },
        ]
        if (!alive) return

        const jobs = jJson.data?.jobs ?? []
        const apps = aJson.data ?? []
        const reports = rJson.data ?? []

        // ----- Source ROI + hiring velocity + overall funnel (server-computed) -----
        const an = anJson.data
        if (an) {
          setSrcRows(an.bySource ?? [])
          setOverallFunnel(an.funnel ?? [])
          setVelocity({
            timeToOfferDays: an.timeToOfferDays ?? null,
            avgFirstResponseHours: an.avgFirstResponseHours ?? null,
          })
        }

        setPerJob(
          jobs
            .map((j) => ({
              name: j.title.length > 14 ? `${j.title.slice(0, 13)}…` : j.title,
              applicants: j._count?.applications ?? 0,
            }))
            .sort((a, b) => b.applicants - a.applicants)
            .slice(0, 6)
        )

        // ----- Per-job hiring funnel (Applied → Shortlisted → AI interviewed → Client ✓)
        const jobById = new Map(jobs.map((j) => [j.id, j]))
        const acc = new Map<string, FunnelRow>()
        for (const a of apps) {
          const job = jobById.get(a.jobId)
          if (!job) continue
          let row = acc.get(a.jobId)
          if (!row) {
            row = {
              jobId: a.jobId,
              title: job.title,
              applied: 0,
              shortlisted: 0,
              interviewed: 0,
              offered: 0,
              hired: 0,
              approved: 0,
            }
            acc.set(a.jobId, row)
          }
          const st = (a.status ?? '').toUpperCase()
          row.applied += 1
          if (SHORTLIST_SET.has(st)) row.shortlisted += 1
          if (INTERVIEWED_SET.has(st)) row.interviewed += 1
          if (OFFERED_SET.has(st)) row.offered += 1
          if (HIRED_SET.has(st)) row.hired += 1
        }
        for (const r of reports) {
          if ((r.clientDecision ?? '').toUpperCase() === 'APPROVED' && r.jobId) {
            const row = acc.get(r.jobId)
            if (row) row.approved += 1
          }
        }
        setFunnel(
          Array.from(acc.values())
            .sort((a, b) => b.applied - a.applied)
            .slice(0, 5)
        )

        const counts: Record<string, number> = {
          STRONG_HIRE: 0,
          HIRE: 0,
          MAYBE: 0,
          NO_HIRE: 0,
        }
        let scoreSum = 0
        let scoreN = 0
        for (const r of reports) {
          const key = (r.verdict ?? '').toUpperCase()
          if (key in counts) counts[key] += 1
          if (typeof r.overallScore === 'number') {
            scoreSum += r.overallScore
            scoreN += 1
          }
        }
        setVerdicts(
          Object.entries(counts).map(([key, count]) => ({
            key,
            name: VERDICT_LABELS[key] ?? key,
            count,
          }))
        )
        setAvgScore(scoreN > 0 ? Math.round((scoreSum / scoreN) * 10) / 10 : null)

        // Client decision funnel (from shared reports)
        const dCounts: Record<string, number> = { APPROVED: 0, ON_HOLD: 0, REJECTED: 0 }
        let latest: ReportLite | null = null
        for (const r of reports) {
          const key = (r.clientDecision ?? '').toUpperCase()
          if (key in dCounts) {
            dCounts[key] += 1
            if (!latest && typeof r.decidedAt === 'string') latest = r
          }
        }
        setDecisions(
          Object.entries(dCounts).map(([key, count]) => ({ key, count }))
        )
        setDecisionTotal(dCounts.APPROVED + dCounts.ON_HOLD + dCounts.REJECTED)
        setLatestDecision(
          latest
            ? {
                candidateName: latest.candidateName,
                jobTitle: latest.jobTitle,
                clientName: latest.clientName,
                clientDecision: latest.clientDecision,
              }
            : null
        )
      } catch {
        /* analytics are cosmetic */
      } finally {
        if (alive) setLoading(false)
      }
    }

    void run()
    return () => {
      alive = false
    }
  }, [user, refreshKey])

  const hasVerdicts = useMemo(() => verdicts.some((v) => v.count > 0), [verdicts])
  const hasFunnel = useMemo(() => funnel.some((f) => f.applied > 0), [funnel])

  /** Channel performance is only meaningful once ANY non-direct application exists */
  const nonDirectApps = useMemo(
    () => srcRows.reduce((acc, r) => acc + (r.source !== 'DIRECT' ? r.applications : 0), 0),
    [srcRows]
  )
  const maxSourceApps = useMemo(() => Math.max(1, ...srcRows.map((r) => r.applications)), [srcRows])
  const totalApps = useMemo(() => srcRows.reduce((acc, r) => acc + r.applications, 0), [srcRows])

  if (!user || user.role !== 'RECRUITER') return null

  if (loading) {
    return (
      <div className="grid gap-4 lg:grid-cols-2" aria-label="Loading analytics">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-24 rounded-2xl lg:col-span-2" />
      </div>
    )
  }

  return (
    <section aria-label="Hiring analytics" className="grid gap-4 lg:grid-cols-2">
      {/* Applicants per job */}
      <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm transition-shadow hover:shadow-md">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
              <span className="flex size-7 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/40">
                <BarChart3 className="size-4 text-blue-600" aria-hidden />
              </span>
              Applicants per job
            </h3>
            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">top {perJob.length || 0}</span>
          </div>
          {perJob.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
              Post your first job to see applicant analytics 📊
            </p>
          ) : (
            <div className="h-44 w-full" role="img" aria-label="Bar chart of applicants per job">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={perJob} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: 'var(--chart-tick)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                    height={44}
                  />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick-soft)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(59,130,246,0.06)' }}
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid var(--chart-tooltip-border)',
                      background: 'var(--chart-tooltip-bg)',
                      color: 'var(--chart-tooltip-text)',
                      fontSize: 12,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                    }}
                  />
                  <Bar dataKey="applicants" radius={[6, 6, 0, 0]} maxBarSize={38}>
                    {perJob.map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#2563eb' : i === 1 ? '#0284c7' : '#93c5fd'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI verdict mix */}
      <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm transition-shadow hover:shadow-md">
        <CardContent className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
              <span className="flex size-7 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/40">
                <TrendingUp className="size-4 text-sky-600" aria-hidden />
              </span>
              AI interview verdicts
            </h3>
            {avgScore != null && (
              <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                avg score {avgScore.toFixed(1)}/10
              </span>
            )}
          </div>
          {!hasVerdicts ? (
            <p className="py-10 text-center text-sm text-slate-400 dark:text-slate-500">
              Completed AI interviews will power this verdict mix 🤖
            </p>
          ) : (
            <div className="h-44 w-full" role="img" aria-label="Bar chart of AI verdict distribution">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={verdicts} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: 'var(--chart-tick)' }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--chart-tick-soft)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'rgba(2,132,199,0.06)' }}
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid var(--chart-tooltip-border)',
                      background: 'var(--chart-tooltip-bg)',
                      color: 'var(--chart-tooltip-text)',
                      fontSize: 12,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                    }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={38}>
                    {verdicts.map((v) => (
                      <Cell key={v.key} fill={VERDICT_COLORS[v.key] ?? '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Hiring funnel — full-width strip */}
      <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm transition-shadow hover:shadow-md lg:col-span-2">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
              <span className="flex size-7 items-center justify-center rounded-lg bg-cyan-50">
                <Filter className="size-4 text-cyan-600" aria-hidden />
              </span>
              Hiring funnel
            </h3>
            {/* legend */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-hidden>
              {FUNNEL_STAGES.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  <span className={`size-2 rounded-full ${s.dot}`} />
                  {s.label}
                </span>
              ))}
            </div>
          </div>

          {!hasFunnel ? (
            <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
              Once candidates start applying, each role&apos;s funnel — applied → shortlisted → interviewed → offer →
              hired — charts here 🪣
            </p>
          ) : (
            <ul className="space-y-5">
              {/* overall totals across every position (server-computed) */}
              {overallFunnel.length > 0 && overallFunnel[0].count > 0 && (
                <li
                  className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60"
                  aria-label={`All positions funnel: ${overallFunnel.map((s) => `${s.label} ${s.count}`).join(', ')}`}
                >
                  <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    All positions
                  </span>
                  {overallFunnel.map((s, i) => (
                    <span
                      key={s.key}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300"
                    >
                      {i > 0 && <ChevronRight className="size-3 text-slate-300 dark:text-slate-600" aria-hidden />}
                      <span className={`size-1.5 rounded-full ${STAGE_DOTS[s.key] ?? 'bg-slate-300'}`} aria-hidden />
                      {s.label}&nbsp;
                      <span className="tabular-nums">{s.count}</span>
                    </span>
                  ))}
                </li>
              )}
              {funnel.map((row) => {
                // approved candidates are a subset of shortlisted (they advance via the
                // shortlist → interview → client flow), so never add them on top.
                const advanceRate = row.applied > 0 ? Math.round((row.shortlisted / row.applied) * 100) : 0
                const counts: Record<string, number> = {
                  applied: row.applied,
                  shortlisted: row.shortlisted,
                  interviewed: row.interviewed,
                  offered: row.offered,
                  hired: row.hired,
                  approved: row.approved,
                }
                return (
                  <li key={row.jobId} className="print-section">
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <p className="truncate text-xs font-bold text-slate-700 dark:text-slate-300" title={row.title}>
                        {row.title}
                      </p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
                          advanceRate >= 50
                            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 ring-emerald-200'
                            : advanceRate >= 25
                              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 ring-amber-200'
                              : 'bg-stone-50 text-stone-500 dark:text-stone-400 ring-stone-200'
                        }`}
                        aria-label={`${advanceRate}% of applicants advanced past screening`}
                      >
                        {advanceRate}% advance
                      </span>
                    </div>

                    {/* segmented funnel bar — each stage's width = count / applied */}
                    <div
                      className="flex h-6 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                      role="img"
                      aria-label={`${row.title}: ${row.applied} applied, ${row.shortlisted} shortlisted, ${row.interviewed} interviewed, ${row.offered} offered, ${row.hired} hired`}
                    >
                      {FUNNEL_STAGES.map((s, i) => {
                        const n = counts[s.key]
                        if (!n) return null
                        const pct = Math.max(6, (n / Math.max(1, row.applied)) * 100)
                        return (
                          <div
                            key={s.key}
                            className={`relative h-full ${s.bar} transition-all duration-700 ${
                              i > 0 ? 'ml-px rounded-r-full' : 'rounded-l-full'
                            }`}
                            style={{ width: `${Math.min(100, pct)}%`, opacity: 1 - i * 0.1 }}
                            title={`${s.label}: ${n}`}
                          >
                            {pct >= 14 && (
                              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white">
                                {n}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* count chips */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      {FUNNEL_STAGES.map((s) => (
                        <span key={s.key} className="inline-flex items-center gap-1">
                          <span className={`size-1.5 rounded-full ${s.dot}`} aria-hidden />
                          {counts[s.key]} {s.label.toLowerCase()}
                          <span aria-hidden className="text-slate-300">·</span>
                        </span>
                      ))}
                      <span className="text-slate-400 dark:text-slate-500">
                        {Math.max(0, row.applied - row.shortlisted)} still awaiting review
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Source performance — channel ROI rows (server-computed via /api/analytics) */}
      <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm transition-shadow hover:shadow-md lg:col-span-2">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
              <span className="flex size-7 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-950/40">
                <Share2 className="size-4 text-violet-600" aria-hidden />
              </span>
              Source performance
            </h3>
            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {totalApps} application{totalApps === 1 ? '' : 's'}
            </span>
          </div>

          {nonDirectApps < 1 ? (
            <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
              Share your jobs to see channel performance — every shared link, career-page view and
              referral shows up here 📣
            </p>
          ) : (
            <ul className="space-y-3" aria-label="Applications and hires by source channel">
              {srcRows.map((row) => {
                const meta = SOURCE_META[row.source]
                const Icon = meta?.icon ?? Users
                const widthPct = row.applications > 0 ? Math.max(4, (row.applications / maxSourceApps) * 100) : 0
                return (
                  <li
                    key={row.source}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[9.5rem_1fr_auto] sm:gap-3"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`grid size-7 shrink-0 place-items-center rounded-lg ${meta?.chip ?? 'bg-slate-100 text-slate-600'}`}
                        aria-hidden
                      >
                        <Icon className="size-3.5" />
                      </span>
                      <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {row.label}
                      </span>
                      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-slate-400 dark:text-slate-500">
                        {row.applications}
                      </span>
                    </div>

                    <div
                      className="col-span-2 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 sm:col-span-1"
                      role="img"
                      aria-label={`${row.label}: ${row.applications} applications, ${row.hired} hired`}
                    >
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${meta?.bar ?? 'bg-slate-400'}`}
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>

                    <span
                      className={`justify-self-end rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
                        row.hired > 0
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 ring-emerald-200'
                          : 'bg-stone-50 text-stone-500 ring-stone-200 dark:text-stone-400'
                      }`}
                      aria-label={`${row.hirePct}% of ${row.label} applicants were hired`}
                    >
                      {row.hirePct}% hire
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Hiring velocity — honest time-to-offer + first-response SLA */}
      <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm transition-shadow hover:shadow-md lg:col-span-2">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
              <span className="flex size-7 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-950/40">
                <Zap className="size-4 text-amber-600" aria-hidden />
              </span>
              Hiring velocity
            </h3>
            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              measured application → offer sent
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-violet-50 p-3.5 dark:bg-violet-950/30">
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-700/70 dark:text-violet-300/70">
                Avg time-to-offer
              </p>
              <p className="mt-1 text-2xl font-black tabular-nums text-violet-700 dark:text-violet-300">
                {velocity.timeToOfferDays != null ? velocity.timeToOfferDays : '—'}
                <span className="ml-1 text-xs font-semibold text-violet-600/70 dark:text-violet-300/70">days</span>
              </p>
              <p className="mt-1 text-[11px] leading-snug text-violet-700/60 dark:text-violet-300/60">
                from application to offer sent
              </p>
            </div>
            <div className="rounded-xl bg-emerald-50 p-3.5 dark:bg-emerald-950/30">
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700/70 dark:text-emerald-300/70">
                First response
              </p>
              <p className="mt-1 text-2xl font-black tabular-nums text-emerald-700 dark:text-emerald-300">
                {velocity.avgFirstResponseHours != null ? velocity.avgFirstResponseHours : '—'}
                <span className="ml-1 text-xs font-semibold text-emerald-600/70 dark:text-emerald-300/70">hrs</span>
              </p>
              <p className="mt-1 text-[11px] leading-snug text-emerald-700/60 dark:text-emerald-300/60">
                avg wait before a recruiter view
              </p>
            </div>
          </div>

          {velocity.timeToOfferDays == null && velocity.avgFirstResponseHours == null && (
            <p className="mt-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
              Offers sent and first views will power this once pipeline activity picks up ⏱️
            </p>
          )}
        </CardContent>
      </Card>

      {/* Client decision funnel — full-width strip */}
      <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm transition-shadow hover:shadow-md lg:col-span-2">
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-200">
              <span className="flex size-7 items-center justify-center rounded-lg bg-violet-50">
                <Gavel className="size-4 text-violet-600" aria-hidden />
              </span>
              Client decisions
            </h3>
            <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              {decisionTotal} verdict{decisionTotal === 1 ? '' : 's'} received
            </span>
          </div>

          {decisionTotal === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400 dark:text-slate-500">
              Share AI reports with clients — their approve / hold / decline calls will chart here 🤝
            </p>
          ) : (
            <div className="space-y-4">
              {/* Stacked share bar */}
              <div
                className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                role="img"
                aria-label={`Client decisions: ${decisions.map((d) => `${DECISION_META[d.key]?.label ?? d.key} ${d.count}`).join(', ')}`}
              >
                {decisions.map(
                  (d) =>
                    d.count > 0 && (
                      <div
                        key={d.key}
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${(d.count / decisionTotal) * 100}%`,
                          backgroundColor: DECISION_META[d.key]?.color ?? '#94a3b8',
                        }}
                        title={`${DECISION_META[d.key]?.label ?? d.key}: ${d.count}`}
                      />
                    )
                )}
              </div>

              {/* Count chips */}
              <div className="flex flex-wrap items-center gap-2">
                {decisions.map((d) => (
                  <span
                    key={d.key}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${DECISION_META[d.key]?.chip ?? 'bg-slate-50 text-slate-600 dark:text-slate-400 ring-slate-200'}`}
                  >
                    <span aria-hidden>{DECISION_META[d.key]?.emoji}</span>
                    {DECISION_META[d.key]?.label ?? d.key}
                    <span className="rounded-full bg-white/70 px-1.5 text-[11px] font-bold">
                      {d.count}
                    </span>
                  </span>
                ))}
              </div>

              {/* Latest verdict line */}
              {latestDecision && (
                <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  <span className="font-semibold text-slate-600 dark:text-slate-400">Latest:</span>{' '}
                  {latestDecision.clientName ?? 'Client'}{' '}
                  {latestDecision.clientDecision === 'APPROVED'
                    ? 'approved'
                    : latestDecision.clientDecision === 'ON_HOLD'
                      ? 'parked'
                      : 'declined'}{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {latestDecision.candidateName}
                  </span>{' '}
                  for {latestDecision.jobTitle ?? 'a role'}.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
