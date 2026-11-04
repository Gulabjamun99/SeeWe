'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  BellRing,
  BriefcaseBusiness,
  Loader2,
  MapPin,
  Plus,
  SearchX,
  Trash2,
  Wallet,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

interface AlertSampleJob {
  id: string
  title: string
  company: string
  location: string
  createdAt: string
  salaryMaxLpa?: number | null
}

export interface JobAlertWithMatches {
  id: string
  keyword: string
  location: string
  minSalaryLpa?: number | null
  lastSeenAt: string
  createdAt: string
  newCount: number
  totalMatches: number
  sample: AlertSampleJob[]
}

/** Fetch alerts with live match counts (exported so the header bell can reuse it) */
export async function fetchJobAlerts(userId: string): Promise<JobAlertWithMatches[]> {
  const res = await fetch(`/api/job-alerts?userId=${encodeURIComponent(userId)}`)
  const json: { data?: JobAlertWithMatches[]; error?: string } = await res.json()
  if (!res.ok || json.error) throw new Error(json.error || 'Failed to load alerts')
  return json.data ?? []
}

export function JobAlertsTab() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const setPendingSearch = useAppStore((s) => s.setPendingSearch)
  const refreshKey = useAppStore((s) => s.refreshKey)

  const [alerts, setAlerts] = useState<JobAlertWithMatches[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [form, setForm] = useState({ keyword: '', location: '', minSalaryLpa: '' })

  const load = useCallback(async () => {
    if (!user || user.role !== 'CANDIDATE') {
      setAlerts([])
      return
    }
    setError(null)
    try {
      setAlerts(await fetchJobAlerts(user.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts')
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const browseWithAlert = (a: JobAlertWithMatches) => {
    setPendingSearch({ keyword: a.keyword, location: a.location })
    document.dispatchEvent(
      new CustomEvent('seewee:job-search', {
        detail: { keyword: a.keyword, location: a.location },
      })
    )
    setView('browse')
  }

  const createAlert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!user) return
    if (!form.keyword.trim() && !form.location.trim()) {
      toast.warning('Add at least a keyword or a location')
      return
    }
    setCreating(true)
    try {
      const salary = Number(form.minSalaryLpa)
      const res = await fetch('/api/job-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          keyword: form.keyword.trim(),
          location: form.location.trim(),
          minSalaryLpa: Number.isFinite(salary) && salary > 0 ? salary : undefined,
        }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to create alert')
      toast.success('🔔 Alert created — we\'ll watch for matching jobs!')
      setForm({ keyword: '', location: '', minSalaryLpa: '' })
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create alert')
    } finally {
      setCreating(false)
    }
  }

  const deleteAlert = async (a: JobAlertWithMatches) => {
    if (!user) return
    setBusyId(a.id)
    try {
      const res = await fetch(
        `/api/job-alerts?id=${encodeURIComponent(a.id)}&userId=${encodeURIComponent(user.id)}`,
        { method: 'DELETE' }
      )
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Delete failed')
      setAlerts((prev) => prev?.filter((x) => x.id !== a.id) ?? prev)
      toast.success('Alert removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete alert')
    } finally {
      setBusyId(null)
    }
  }

  if (!user) return null

  return (
    <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
      {/* -------- Create alert card -------- */}
      <Card className="h-fit rounded-2xl border-blue-200/70 dark:border-blue-900/60 bg-gradient-to-b from-blue-50/70 dark:from-blue-950/40 to-white shadow-sm">
        <CardContent className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-sky-600 shadow-md shadow-blue-200">
              <BellRing className="size-4.5 text-white" aria-hidden />
            </span>
            <div>
              <h3 className="font-bold leading-tight text-slate-900 dark:text-slate-100">Create a job alert</h3>
              <p className="text-xs text-muted-foreground">
                We\'ll count new matching jobs for you automatically
              </p>
            </div>
          </div>

          <form onSubmit={createAlert} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="ja-keyword">Keyword</Label>
              <Input
                id="ja-keyword"
                placeholder="e.g. React, Python, DevOps…"
                value={form.keyword}
                onChange={(e) => setForm((f) => ({ ...f, keyword: e.target.value }))}
                className="h-11 rounded-lg border-slate-200 dark:border-slate-800 sm:h-9"
              />
              <p className="text-[11px] text-muted-foreground">Matches job title, skills & description</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ja-location">Location</Label>
              <Input
                id="ja-location"
                placeholder="e.g. Bengaluru, Remote…"
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                className="h-11 rounded-lg border-slate-200 dark:border-slate-800 sm:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ja-salary">Min. salary (LPA)</Label>
              <Input
                id="ja-salary"
                type="number"
                min={0}
                placeholder="Optional — e.g. 15"
                value={form.minSalaryLpa}
                onChange={(e) => setForm((f) => ({ ...f, minSalaryLpa: e.target.value }))}
                className="h-11 rounded-lg border-slate-200 dark:border-slate-800 sm:h-9"
              />
            </div>
            <Button
              type="submit"
              disabled={creating}
              className="h-11 w-full rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-md transition-all hover:from-blue-700 hover:to-sky-600 hover:shadow-lg sm:h-10"
            >
              {creating ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Creating…
                </>
              ) : (
                <>
                  <Plus className="size-4" aria-hidden /> Create alert
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* -------- Alerts list -------- */}
      <div className="space-y-4">
        {alerts === null && !error && (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i} className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm">
                <CardContent className="space-y-3 p-5">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <div className="flex gap-2 pt-1">
                    <Skeleton className="h-6 w-20 rounded-full" />
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {error && (
          <Card className="rounded-2xl border-rose-200 dark:border-rose-900/60 bg-rose-50/50 dark:bg-rose-950/40 shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
              <SearchX className="size-10 text-rose-400" aria-hidden />
              <p className="text-sm font-medium text-rose-700">{error}</p>
              <Button variant="outline" onClick={() => void load()} className="h-11 sm:h-9">
                Try again
              </Button>
            </CardContent>
          </Card>
        )}

        {alerts !== null && !error && alerts.length === 0 && (
          <Card className="rounded-2xl border-dashed border-blue-300 bg-blue-50/40 dark:bg-blue-950/30 shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
                <BellRing className="size-7 text-blue-600" aria-hidden />
              </span>
              <p className="font-semibold text-slate-800 dark:text-slate-200">No alerts yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Create your first alert on the left — tell us what role and city you\'re
                targeting, and new matching openings will show up here with a counter.
              </p>
            </CardContent>
          </Card>
        )}

        {alerts !== null &&
          !error &&
          alerts.map((a, idx) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: idx * 0.05 }}
            >
              <Card
                className={`group overflow-hidden rounded-2xl border shadow-sm transition-all hover:shadow-md ${
                  a.newCount > 0 ? 'border-blue-300 ring-1 ring-blue-200/60' : 'border-slate-200 dark:border-slate-800'
                } ${busyId === a.id ? 'opacity-60' : ''}`}
              >
                <CardContent className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                          {a.keyword ? `“${a.keyword}”` : 'All roles'}
                          {a.location && (
                            <span className="font-normal text-slate-500 dark:text-slate-400"> in {a.location}</span>
                          )}
                        </h3>
                        {a.newCount > 0 ? (
                          <Badge className="animate-pulse border-transparent bg-blue-600 text-white">
                            🔔 {a.newCount} new
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400"
                          >
                            All caught up
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{a.totalMatches} total matches</span>
                        {a.minSalaryLpa != null && (
                          <span className="inline-flex items-center gap-1">
                            <Wallet className="size-3" aria-hidden /> ≥ ₹{a.minSalaryLpa} LPA
                          </span>
                        )}
                        <span>created {formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        onClick={() => browseWithAlert(a)}
                        className="h-11 rounded-lg border-blue-200 dark:border-blue-900/60 px-3 text-blue-700 hover:bg-blue-50 sm:h-9"
                      >
                        <BriefcaseBusiness className="size-4" aria-hidden /> Browse matches
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void deleteAlert(a)}
                        disabled={busyId === a.id}
                        aria-label={`Delete alert for ${a.keyword || a.location}`}
                        className="min-w-[44px] text-slate-400 dark:text-slate-500 hover:bg-rose-50 hover:text-rose-600 sm:min-w-[36px]"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </div>
                  </div>

                  {/* sample matches */}
                  {a.sample.length > 0 && (
                    <div className="mt-4 space-y-2 border-t border-dashed border-slate-100 dark:border-slate-800/60 pt-3">
                      {a.sample.map((j) => (
                        <button
                          key={j.id}
                          type="button"
                          onClick={() => browseWithAlert(a)}
                          className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-blue-50/60"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-gradient-to-br from-blue-100 to-sky-100 dark:from-blue-900/40 dark:to-sky-900/40 text-[10px] font-bold text-blue-700">
                              {j.company.slice(0, 2).toUpperCase()}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                                {j.title}
                              </span>
                              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                                <MapPin className="size-3" aria-hidden /> {j.location}
                              </span>
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                            {formatDistanceToNow(new Date(j.createdAt), { addSuffix: true })}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
      </div>
    </div>
  )
}
