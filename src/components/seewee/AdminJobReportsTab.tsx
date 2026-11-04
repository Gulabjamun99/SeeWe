'use client'

/**
 * AdminJobReportsTab — job-report moderation queue (master spec §33).
 * Filter chips (OPEN / REVIEWED / ACTIONED / All), report cards with reason
 * colour map, and two actions: "Mark reviewed" and "Close job + actioned"
 * (closing sets the reported Job to CLOSED so it leaves public browsing).
 */

import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Briefcase, Flag, Loader2, RefreshCw, ShieldCheck, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface JobReportRow {
  id: string
  reason: string
  details: string | null
  reporterEmail: string | null
  status: string
  adminNote: string | null
  createdAt: string
  job: { id: string; title: string; company: string; status: string }
}

type ReportFilter = 'OPEN' | 'REVIEWED' | 'ACTIONED' | 'ALL'

const REASON_META: Record<string, { label: string; className: string }> = {
  FAKE_JOB: { label: 'Fake job', className: 'border-rose-300 bg-rose-100 dark:bg-rose-900/40 text-rose-700' },
  SPAM: { label: 'Spam', className: 'border-amber-300 bg-amber-100 dark:bg-amber-900/40 text-amber-800' },
  EXPIRED: { label: 'Expired', className: 'border-slate-300 bg-slate-100 text-slate-700 dark:text-slate-300' },
  FEE_ASKED: { label: 'Fee asked', className: 'border-rose-300 bg-rose-100 dark:bg-rose-900/40 text-rose-700' },
  DISCRIMINATORY: { label: 'Discriminatory', className: 'border-rose-300 bg-rose-100 dark:bg-rose-900/40 text-rose-700' },
  OTHER: { label: 'Other', className: 'border-violet-300 bg-violet-100 dark:bg-violet-900/40 text-violet-700' },
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  OPEN: { label: 'Open', className: 'border-rose-300 bg-rose-50 dark:bg-rose-950/40 text-rose-700' },
  REVIEWED: { label: 'Reviewed', className: 'border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-700' },
  ACTIONED: { label: 'Actioned', className: 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700' },
}

const JOB_STATUS_META: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Active', className: 'border-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800' },
  PAUSED: { label: 'Paused', className: 'border-amber-300 bg-amber-100 dark:bg-amber-900/40 text-amber-800' },
  CLOSED: { label: 'Closed', className: 'border-slate-400 bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
}

const FILTERS: { value: ReportFilter; label: string }[] = [
  { value: 'OPEN', label: 'Open' },
  { value: 'REVIEWED', label: 'Reviewed' },
  { value: 'ACTIONED', label: 'Actioned' },
  { value: 'ALL', label: 'All' },
]

export function AdminJobReportsTab() {
  const user = useAppStore((s) => s.user)
  const [filter, setFilter] = useState<ReportFilter>('OPEN')
  const [reports, setReports] = useState<JobReportRow[] | null>(null)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [actingId, setActingId] = useState<string | null>(null)
  // "Close job + actioned" awaits confirmation here
  const [pendingClose, setPendingClose] = useState<JobReportRow | null>(null)

  const loadReports = useCallback(async () => {
    if (!user || user.role !== 'ADMIN') return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/job-reports?adminId=${encodeURIComponent(user.id)}&status=${filter}`
      )
      const json = (await res.json().catch(() => ({}))) as {
        data?: { reports: JobReportRow[]; counts: Record<string, number> }
        error?: string
      }
      if (!res.ok || json.error || !json.data) throw new Error(json.error ?? 'Failed to load reports')
      setReports(json.data.reports)
      setCounts(json.data.counts ?? {})
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load reports')
      setReports((prev) => prev ?? [])
    } finally {
      setLoading(false)
    }
  }, [user, filter])

  useEffect(() => {
    void loadReports()
  }, [loadReports])

  async function markReviewed(report: JobReportRow) {
    await patchReport(report, { status: 'REVIEWED' }, 'Report marked as reviewed')
  }

  async function closeJobAndAction(report: JobReportRow) {
    await patchReport(
      report,
      { status: 'ACTIONED', closeJob: true },
      'Job closed and report actioned'
    )
    setPendingClose(null)
  }

  async function patchReport(
    report: JobReportRow,
    body: { status: 'REVIEWED' | 'ACTIONED'; closeJob?: boolean },
    successMsg: string
  ) {
    if (!user) return
    setActingId(report.id)
    try {
      const res = await fetch(`/api/admin/job-reports/${report.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: user.id, ...body }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: JobReportRow; error?: string }
      if (!res.ok || json.error || !json.data) throw new Error(json.error ?? 'Update failed')
      toast.success(successMsg)
      const updated = json.data
      setReports((prev) =>
        prev
          ? prev
              .map((r) => (r.id === updated.id ? updated : r))
              .filter((r) => filter === 'ALL' || r.status === filter)
          : prev
      )
      setCounts((prev) => ({
        ...prev,
        OPEN: prev.OPEN ?? 0,
        REVIEWED: prev.REVIEWED ?? 0,
        ACTIONED: prev.ACTIONED ?? 0,
      }))
      void loadReports() // refresh chip counts from source of truth
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setActingId(null)
    }
  }

  const rows = reports ?? []
  const openCount = counts.OPEN ?? 0

  return (
    <Card className="rounded-xl">
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
          <Flag className="size-4 text-rose-500" aria-hidden /> Job reports
          {openCount > 0 && (
            <Badge variant="outline" className="border-rose-300 bg-rose-100 text-rose-700">
              {openCount} open
            </Badge>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          <div
            role="radiogroup"
            aria-label="Filter reports by status"
            className="flex flex-wrap items-center gap-1.5"
          >
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                role="radio"
                aria-checked={filter === f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  filter === f.value
                    ? 'border-slate-700 bg-slate-800 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                {f.label}
                {counts[f.value] !== undefined && (
                  <span className="ml-1 opacity-70">{counts[f.value]}</span>
                )}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadReports()}
            disabled={loading}
            aria-label="Refresh reports"
            className="rounded-lg"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading && !reports ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-full bg-emerald-100 dark:bg-emerald-950/40">
              <ShieldCheck className="size-6 text-emerald-600" aria-hidden />
            </span>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {filter === 'ALL' ? 'No reports yet' : 'Queue is clean'}
            </p>
            <p className="max-w-sm text-xs text-slate-400">
              {filter === 'ALL'
                ? 'No job has been reported so far. Reports from the “Report this job” action on any listing appear here.'
                : `No ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase()} reports right now — switch the filter to see the rest.`}
            </p>
          </div>
        ) : (
          <div className="max-h-96 space-y-3 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent">
            {rows.map((r) => {
              const reason = REASON_META[r.reason] ?? {
                label: r.reason,
                className: 'border-violet-300 bg-violet-100 text-violet-700',
              }
              const status = STATUS_META[r.status] ?? STATUS_META.OPEN
              const jobStatus = JOB_STATUS_META[r.job.status] ?? JOB_STATUS_META.ACTIVE
              const isBusy = actingId === r.id
              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={reason.className}>
                      <Flag className="mr-1 size-3" aria-hidden /> {reason.label}
                    </Badge>
                    <Badge variant="outline" className={status.className}>
                      {status.label}
                    </Badge>
                    <span className="ml-auto text-[11px] text-slate-400">
                      {timeAgo(r.createdAt)}
                    </span>
                  </div>

                  <div className="mt-2.5 flex items-start gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-100 dark:bg-slate-800">
                      <Briefcase className="size-4 text-slate-500" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                        {r.job.title}
                        <Badge variant="outline" className={`px-1.5 py-0 text-[10px] ${jobStatus.className}`}>
                          {jobStatus.label}
                        </Badge>
                      </p>
                      <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                        {r.job.company}
                      </p>
                    </div>
                  </div>

                  {r.details && (
                    <p className="mt-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      “{r.details}”
                    </p>
                  )}
                  {r.adminNote && (
                    <p className="mt-1.5 text-xs italic text-slate-500 dark:text-slate-400">
                      Admin note: {r.adminNote}
                    </p>
                  )}

                  <div className="mt-3 flex flex-col gap-2.5 border-t border-slate-100 pt-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                    <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <UserRound className="size-3.5" aria-hidden />
                      {r.reporterEmail ? r.reporterEmail : <span className="italic">Anonymous report</span>}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {r.status === 'OPEN' && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isBusy}
                          onClick={() => void markReviewed(r)}
                          className="rounded-lg"
                        >
                          {isBusy ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <ShieldCheck className="mr-1.5 size-3.5" aria-hidden />
                          )}
                          Mark reviewed
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={isBusy || r.job.status === 'CLOSED'}
                        onClick={() => setPendingClose(r)}
                        className="rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                      >
                        <Flag className="mr-1.5 size-3.5" aria-hidden />
                        {r.job.status === 'CLOSED' ? 'Job already closed' : 'Close job + actioned'}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>

      {/* Confirm close-job-and-action */}
      <AlertDialog open={pendingClose !== null} onOpenChange={(open) => !open && setPendingClose(null)}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Close this job and action the report?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingClose?.job.title}” at {pendingClose?.job.company} will be set to CLOSED and
              disappear from public job browsing. The report is marked ACTIONED. The posting
              recruiter keeps their other jobs — you can re-open the listing from the recruiter
              workspace if this was a mistake.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pendingClose && void closeJobAndAction(pendingClose)}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              Close job + action report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return '—'
  }
}
