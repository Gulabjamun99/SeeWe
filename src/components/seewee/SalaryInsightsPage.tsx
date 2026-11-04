'use client'

/**
 * SalaryInsightsPage — dedicated, opt-in salary benchmark page.
 *
 * User ask: "salary insights kisi ko samne mat dikhaye, alag page hi bana de
 * taki salary insights dekh sake log" — so the old auto-rendered strip on
 * Find Jobs is gone; anyone who wants market numbers opens THIS page
 * deliberately (entry button on the Find Jobs toolbar).
 *
 * Data logic (mirrors /api/salary-insights):
 *   1. Live postings — declared salary bands from ACTIVE jobs.
 *   2. Candidate expectations — expected CTC of matching profiles, shown only
 *      in aggregate and only when ≥3 candidates share a role (k-anonymity).
 *   Roles are clustered by normalized titles (seniority words stripped) and
 *   stats are computed live — nothing is persisted.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Database,
  IndianRupee,
  Lock,
  MapPin,
  RefreshCw,
  Search,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import type { ApiResponse } from '@/lib/types'

interface SalaryRow {
  key: string
  label: string
  samplePostings: number
  sampleCandidates: number
  bandMin: number | null
  bandMax: number | null
  p25: number | null
  median: number | null
  p75: number | null
  candidateAskMedian: number | null
  candidateAskSample: number
  topSkills: string[]
  topLocations: string[]
  confidence: 'high' | 'medium' | 'low'
}

interface InsightsMeta {
  postingsScanned: number
  candidatesScanned: number
  clusterCount: number
  minSampleForAskMedian: number
  generatedAt: string
}

interface InsightsPayload {
  rows: SalaryRow[]
  overall: SalaryRow | null
  meta: InsightsMeta
}

const CONFIDENCE_META: Record<SalaryRow['confidence'], { label: string; cls: string }> = {
  high: {
    label: 'High confidence',
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  medium: {
    label: 'Medium confidence',
    cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300',
  },
  low: {
    label: 'Low confidence',
    cls: 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400',
  },
}

export function SalaryInsightsPage() {
  const setView = useAppStore((s) => s.setView)

  const [keyword, setKeyword] = useState('')
  const [location, setLocation] = useState('')
  const [data, setData] = useState<InsightsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const params = new URLSearchParams()
      if (keyword.trim()) params.set('keyword', keyword.trim())
      if (location.trim()) params.set('location', location.trim())
      const res = await fetch(`/api/salary-insights?${params.toString()}`)
      const json: ApiResponse<InsightsPayload> = await res.json()
      if (!res.ok || json.error || !json.data) throw new Error(json.error || 'Failed to load insights')
      setData(json.data)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load salary insights')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [keyword, location])

  useEffect(() => {
    const t = setTimeout(() => void load(), 280) // debounce typing
    return () => clearTimeout(t)
  }, [load])

  const scale = useMemo(() => {
    const rows = data?.rows ?? []
    const los = rows.map((r) => r.bandMin).filter((v): v is number => v != null)
    const his = rows.map((r) => r.bandMax).filter((v): v is number => v != null)
    if (los.length === 0 || his.length === 0) return null
    const lo = Math.min(...los)
    const hi = Math.max(...his)
    return hi > lo ? { lo, hi, span: hi - lo } : null
  }, [data])

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pb-16 pt-6 sm:px-6">
      {/* ------------------------------ header ------------------------------ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setView('browse')}
            className="mb-1 -ml-2 min-h-[40px] gap-1.5 rounded-lg text-slate-500 hover:text-blue-700"
          >
            <ArrowLeft className="size-4" aria-hidden /> Back to Find Jobs
          </Button>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            <span className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-sm">
              <TrendingUp className="size-5" aria-hidden />
            </span>
            Salary Insights
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Market pay bands by role — computed live from platform data. Open this page any
            time you want the numbers; they never interrupt your browsing.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={loading}
          className="min-h-[44px] gap-1.5 rounded-xl"
          aria-label="Recompute salary insights"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh
        </Button>
      </div>

      {/* --------------------------- data sources --------------------------- */}
      <Card className="rounded-2xl border-blue-100 dark:border-blue-900/50 bg-gradient-to-br from-white to-sky-50/40 dark:from-slate-900 dark:to-sky-950/10 shadow-sm">
        <CardContent className="space-y-2.5 p-5">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-200">
            <Database className="size-4 text-blue-600" aria-hidden /> Where this data comes
            from
          </h2>
          <ul className="space-y-1.5 text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
            <li className="flex gap-2">
              <Building2 className="mt-0.5 size-3.5 shrink-0 text-blue-500" aria-hidden />
              <span>
                <strong className="font-semibold text-slate-700 dark:text-slate-300">
                  Live job postings
                </strong>{' '}
                — the min→max LPA bands recruiters declare on every active role. This is what
                the market is offering right now.
              </span>
            </li>
            <li className="flex gap-2">
              <Users className="mt-0.5 size-3.5 shrink-0 text-sky-500" aria-hidden />
              <span>
                <strong className="font-semibold text-slate-700 dark:text-slate-300">
                  Candidate expectations
                </strong>{' '}
                — expected CTC from matching candidate profiles, shown only as a cluster median
                and only when <strong className="font-semibold">3+ candidates</strong> share the
                role, so no individual&apos;s number can ever be identified.
              </span>
            </li>
            <li className="flex gap-2">
              <Lock className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
              <span>
                <strong className="font-semibold text-slate-700 dark:text-slate-300">
                  Computed live, never stored
                </strong>{' '}
                — roles are clustered by title (seniority words stripped) and percentiles are
                calculated on request. Small samples are honestly labelled low-confidence.
              </span>
            </li>
          </ul>
          {data && (
            <p className="text-[11px] text-slate-400 dark:text-slate-500">
              Last computed {new Date(data.meta.generatedAt).toLocaleTimeString()} ·{' '}
              {data.meta.postingsScanned} posting{data.meta.postingsScanned === 1 ? '' : 's'} +{' '}
              {data.meta.candidatesScanned} profile
              {data.meta.candidatesScanned === 1 ? '' : 's'} scanned
            </p>
          )}
        </CardContent>
      </Card>

      {/* ----------------------------- search ------------------------------ */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void load()
        }}
        className="grid gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-card p-4 shadow-sm sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      >
        <div className="space-y-1.5">
          <Label htmlFor="si-keyword" className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
            Role or skill
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              id="si-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. frontend, python, HR"
              className="min-h-[44px] rounded-xl pl-9"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="si-location" className="text-[13px] font-medium text-slate-700 dark:text-slate-300">
            Location
          </Label>
          <div className="relative">
            <MapPin
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              id="si-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Bengaluru"
              className="min-h-[44px] rounded-xl pl-9"
            />
          </div>
        </div>
        <Button
          type="submit"
          className="min-h-[44px] rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 px-5 font-semibold text-white shadow-sm hover:from-blue-700 hover:to-sky-600"
        >
          Compute
        </Button>
      </form>

      {/* ------------------------------ states ----------------------------- */}
      {loadError && (
        <Card className="rounded-2xl border-rose-200 dark:border-rose-900/60 shadow-sm">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="text-sm font-medium text-rose-600">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void load()} className="min-h-[40px] rounded-lg">
              <RefreshCw className="size-4" aria-hidden /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {loading && !data && (
        <div className="space-y-3" aria-label="Loading salary insights" aria-busy="true">
          <Skeleton className="h-24 rounded-2xl" />
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      )}

      {data && data.rows.length === 0 && (
        <Card className="rounded-2xl border-dashed shadow-sm">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Search className="size-8 text-slate-300" aria-hidden />
            <h3 className="font-semibold text-slate-800 dark:text-slate-200">
              No salary data for this view
            </h3>
            <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
              No active postings matched. Clear the filters or try a broader role keyword —
              bands appear as soon as recruiters post salaries.
            </p>
          </CardContent>
        </Card>
      )}

      {/* --------------------------- market strip --------------------------- */}
      {data && data.overall && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            {
              label: 'Roles charted',
              value: String(data.rows.length),
              icon: TrendingUp,
            },
            {
              label: 'Market median',
              value: data.overall.median != null ? `₹${data.overall.median} LPA` : '—',
              icon: IndianRupee,
            },
            {
              label: 'Middle 50%',
              value:
                data.overall.p25 != null && data.overall.p75 != null
                  ? `₹${data.overall.p25}–${data.overall.p75} LPA`
                  : '—',
              icon: BadgeCheck,
            },
            {
              label: 'Talent ask (median)',
              value:
                data.overall.candidateAskMedian != null
                  ? `₹${data.overall.candidateAskMedian} LPA`
                  : `needs ${data.meta.minSampleForAskMedian}+ profiles`,
              icon: Users,
            },
          ].map(({ label, value, icon: Icon }) => (
            <Card
              key={label}
              className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm"
            >
              <CardContent className="p-4">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  <Icon className="size-3.5" aria-hidden /> {label}
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums text-slate-800 dark:text-slate-100">
                  {loading ? '…' : value}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* --------------------------- cluster cards -------------------------- */}
      {data && data.rows.length > 0 && (
        <ul className="space-y-3" aria-label="Salary bands by role">
          {data.rows.map((r) => {
            const pos = (v: number) =>
              scale ? Math.min(100, Math.max(0, ((v - scale.lo) / scale.span) * 100)) : 0
            const bandLeft = r.bandMin != null ? pos(r.bandMin) : 0
            const bandRight = r.bandMax != null ? pos(r.bandMax) : 0
            const bandWidth = Math.max(2.5, bandRight - bandLeft)
            const conf = CONFIDENCE_META[r.confidence]
            return (
              <li key={r.key}>
                <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm transition-shadow hover:shadow-md">
                  <CardContent className="space-y-3 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-[15px] font-bold tracking-tight text-slate-900 dark:text-slate-100">
                          {r.label}
                        </h3>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          <span>{r.samplePostings} posting{r.samplePostings === 1 ? '' : 's'}</span>
                          <span aria-hidden>·</span>
                          <span>
                            {r.sampleCandidates} matching profile{r.sampleCandidates === 1 ? '' : 's'}
                          </span>
                          {r.topLocations.length > 0 && (
                            <>
                              <span aria-hidden>·</span>
                              <span className="inline-flex items-center gap-0.5">
                                <MapPin className="size-3" aria-hidden />
                                {r.topLocations.join(', ')}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <Badge variant="outline" className={`shrink-0 rounded-full text-[10.5px] font-semibold ${conf.cls}`}>
                        {conf.label}
                      </Badge>
                    </div>

                    {/* range bar: posting band + p50/p75 markers */}
                    {scale && r.bandMin != null && r.bandMax != null && (
                      <div
                        className="relative h-3 w-full rounded-full bg-slate-100 shadow-inner dark:bg-slate-800"
                        role="img"
                        aria-label={`${r.label}: ₹${r.bandMin} to ₹${r.bandMax} LPA, median ₹${r.median ?? '—'} LPA`}
                      >
                        <span
                          className="absolute inset-y-0 rounded-full bg-gradient-to-r from-blue-400 to-sky-500 shadow-[0_1px_4px_rgba(59,130,246,0.45)]"
                          style={{ left: `${bandLeft}%`, width: `${bandWidth}%` }}
                          aria-hidden
                        />
                        {r.median != null && (
                          <span
                            className="absolute -top-1 -bottom-1 w-0.5 rounded bg-blue-700"
                            style={{ left: `${pos(r.median)}%` }}
                            title={`Median ₹${r.median} LPA`}
                            aria-hidden
                          />
                        )}
                        {r.candidateAskMedian != null && (
                          <span
                            className="absolute -top-1.5 size-2.5 -translate-x-1/2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-900"
                            style={{ left: `${pos(r.candidateAskMedian)}%` }}
                            title={`Talent ask median ₹${r.candidateAskMedian} LPA`}
                            aria-hidden
                          />
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <span className="font-bold tabular-nums text-blue-700 dark:text-blue-300">
                        ₹{r.bandMin ?? '—'} – ₹{r.bandMax ?? '—'} LPA
                      </span>
                      {r.p25 != null && r.p75 != null && (
                        <span className="text-slate-500 dark:text-slate-400">
                          middle 50%: ₹{r.p25}–{r.p75}
                        </span>
                      )}
                      <span className="text-slate-500 dark:text-slate-400">
                        median: <strong className="text-slate-700 dark:text-slate-300">₹{r.median ?? '—'} LPA</strong>
                      </span>
                      <span className="inline-flex items-center gap-1 text-slate-500 dark:text-slate-400">
                        <span
                          className="size-2 rounded-full bg-amber-500"
                          aria-hidden
                        />
                        talent asks:{' '}
                        {r.candidateAskMedian != null ? (
                          <strong className="text-slate-700 dark:text-slate-300">₹{r.candidateAskMedian} LPA</strong>
                        ) : (
                          <em className="text-slate-400" title={`Shown only when ${3}+ matching candidates share expectations`}>
                            not shown (fewer than 3 profiles)
                          </em>
                        )}
                      </span>
                    </div>

                    {r.topSkills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {r.topSkills.map((s) => (
                          <Badge
                            key={s}
                            variant="secondary"
                            className="rounded-full px-2 py-0.5 text-[10.5px]"
                          >
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
