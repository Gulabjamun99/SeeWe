'use client'

/**
 * LatestResponses — "who responded to my jobs" strip on the recruiter dashboard.
 *
 * Sits between the analytics strip and the tabs so the recruiter immediately
 * sees the newest candidate responses without opening the Applicants tab.
 * Each row deep-links into the Applicants tab focused on that job.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  Inbox,
  Loader2,
  RefreshCw,
  UserPlus,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore } from '@/store/app-store'
import { STATUS_META } from './statusMeta'
import { timeAgoShort } from './timeAgo'

interface ResponseRow {
  id: string
  jobId: string
  status: string
  matchScore?: number | null
  source?: string | null
  createdAt: string
  candidate: { id: string; name: string; headline?: string | null; avatarSeed?: string | null }
  job: { id: string; title: string; company?: string | null }
}

const MAX_ROWS = 6

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function LatestResponses({ onOpenApplicants }: { onOpenApplicants: (jobId: string) => void }) {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)

  const [rows, setRows] = useState<ResponseRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  const load = useCallback(async () => {
    if (!user || user.role !== 'RECRUITER') return
    setReloading(true)
    setError(null)
    try {
      const res = await fetch(`/api/applications?recruiterId=${encodeURIComponent(user.id)}`)
      const json: { data?: ResponseRow[]; error?: string } = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not load responses')
      setRows((json.data ?? []).slice(0, MAX_ROWS))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load responses')
      setRows([])
    } finally {
      setReloading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  if (!user || user.role !== 'RECRUITER') return null

  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
            <Inbox className="size-4 text-blue-600" aria-hidden />
          </span>
          Latest responses
          {rows && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              newest {Math.min(MAX_ROWS, rows.length)} of your inbox
            </span>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            disabled={reloading}
            aria-label="Refresh latest responses"
            className="h-8 rounded-lg"
          >
            {reloading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RefreshCw className="size-4" aria-hidden />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenApplicants('')}
            className="h-8 rounded-lg"
          >
            View all applicants <ArrowRight className="ml-1 size-3.5" aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {rows === null ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
            {error}
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800">
              <UserPlus className="size-5 text-slate-400" aria-hidden />
            </span>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No responses yet
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Share your jobs or post a new opening — every candidate response lands here first.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => {
              const meta = STATUS_META[r.status as keyof typeof STATUS_META]
              return (
                <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 text-xs font-bold text-white">
                    {initialsOf(r.candidate?.name || '?')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {r.candidate?.name || 'Candidate'}
                      {r.candidate?.headline ? (
                        <span className="ml-1.5 truncate text-xs font-normal text-slate-500 dark:text-slate-400">
                          · {r.candidate.headline}
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      applied for <span className="font-medium">{r.job?.title || 'a job'}</span>
                      {typeof r.matchScore === 'number' ? (
                        <span className="ml-1.5 text-emerald-600 dark:text-emerald-400">
                          · {Math.round(r.matchScore)}% match
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <span
                    className={`hidden shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium sm:inline ${
                      meta?.cls ?? 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    {meta?.label ?? r.status}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[11px] text-slate-400">
                    {timeAgoShort(r.createdAt)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenApplicants(r.jobId)}
                    aria-label={`Open applicants for ${r.job?.title || 'this job'}`}
                    className="h-8 shrink-0 rounded-lg px-2"
                  >
                    <ArrowRight className="size-4" aria-hidden />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
