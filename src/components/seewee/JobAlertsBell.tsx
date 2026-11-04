'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  Bell,
  BellRing,
  BriefcaseBusiness,
  MapPin,
  Settings2,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  fetchJobAlerts,
  type JobAlertWithMatches,
} from '@/components/seewee/candidate/JobAlertsTab'

export function JobAlertsBell() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const setPendingSearch = useAppStore((s) => s.setPendingSearch)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const refreshKey = useAppStore((s) => s.refreshKey)

  const [alerts, setAlerts] = useState<JobAlertWithMatches[]>([])
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const markingRef = useRef(false)

  const isCandidate = user?.role === 'CANDIDATE'

  const load = useCallback(async () => {
    if (!user || user.role !== 'CANDIDATE') return
    try {
      setAlerts(await fetchJobAlerts(user.id))
      setLoaded(true)
    } catch {
      // silent — bell is secondary chrome
    }
  }, [user])

  useEffect(() => {
    if (!isCandidate) {
      setAlerts([])
      setLoaded(false)
      return
    }
    void load()
    // poll every 60s so fresh matches surface without a reload
    const t = setInterval(() => void load(), 60_000)
    return () => clearInterval(t)
  }, [isCandidate, load, refreshKey])

  const unread = alerts.reduce((sum, a) => sum + a.newCount, 0)

  const markAllSeen = useCallback(async () => {
    if (!user || markingRef.current) return
    const dirty = alerts.filter((a) => a.newCount > 0)
    if (dirty.length === 0) return
    markingRef.current = true
    // optimistic clear
    setAlerts((prev) => prev.map((a) => ({ ...a, newCount: 0 })))
    try {
      await Promise.all(
        dirty.map((a) =>
          fetch('/api/job-alerts', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: a.id, userId: user.id }),
          }).catch(() => undefined)
        )
      )
    } finally {
      markingRef.current = false
    }
  }, [alerts, user])

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      void load()
    } else {
      void markAllSeen()
    }
  }

  const openManage = () => {
    setOpen(false)
    document.dispatchEvent(new CustomEvent('seewee:candidate-tab', { detail: { tab: 'alerts' } }))
    setView('candidate')
  }

  const browseAlert = (a: JobAlertWithMatches) => {
    setOpen(false)
    void markAllSeen()
    setPendingSearch({ keyword: a.keyword, location: a.location })
    document.dispatchEvent(
      new CustomEvent('seewee:job-search', {
        detail: { keyword: a.keyword, location: a.location },
      })
    )
    setView('browse')
  }

  if (!isCandidate) return null

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Job alerts${unread > 0 ? ` — ${unread} new matches` : ''}`}
          className="relative grid h-10 w-10 place-items-center rounded-full text-slate-500 dark:text-slate-400 transition-colors hover:bg-slate-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {unread > 0 ? (
            <BellRing className="size-5 text-blue-600" aria-hidden />
          ) : (
            <Bell className="size-5" aria-hidden />
          )}
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-sky-600 px-1 text-[10px] font-bold text-white shadow-md ring-2 ring-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl border-slate-200 dark:border-slate-800 p-0 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/60 px-4 py-3">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Job alerts</p>
          <button
            type="button"
            onClick={openManage}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/40"
          >
            <Settings2 className="size-3.5" aria-hidden /> Manage
          </button>
        </div>

        {!loaded && (
          <div className="space-y-3 p-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
          </div>
        )}

        {loaded && alerts.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 dark:bg-blue-950/40">
              <Bell className="size-5 text-blue-500" aria-hidden />
            </span>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No alerts yet</p>
            <p className="text-xs text-muted-foreground">
              Tell us what you\'re looking for and we\'ll ping you when new matching jobs go live.
            </p>
            <Button
              size="sm"
              onClick={openManage}
              className="mt-1 h-9 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white"
            >
              <BriefcaseBusiness className="size-3.5" aria-hidden /> Create your first alert
            </Button>
          </div>
        )}

        {loaded && alerts.length > 0 && (
          <div className="max-h-80 overflow-y-auto p-2">
            {alerts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => browseAlert(a)}
                className={`mb-1 block w-full rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-blue-50/70 ${
                  a.newCount > 0 ? 'bg-blue-50/50 dark:bg-blue-950/40' : ''
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {a.keyword ? `“${a.keyword}”` : 'All roles'}
                    {a.location && <span className="font-normal text-slate-500 dark:text-slate-400"> · {a.location}</span>}
                  </span>
                  {a.newCount > 0 ? (
                    <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
                      {a.newCount} new
                    </span>
                  ) : (
                    <span className="shrink-0 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                      {a.totalMatches} matches
                    </span>
                  )}
                </span>
                {a.sample.length > 0 && (
                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                    {a.sample[0].title} · {a.sample[0].company}
                    <span className="inline-flex items-center gap-0.5"> <MapPin className="inline size-3" aria-hidden /> {a.sample[0].location}</span>
                    {a.sample.length > 1 ? ` +${a.sample.length - 1} more` : ''}
                  </span>
                )}
                {a.newCount > 0 && a.sample[0] && (
                  <span className="mt-0.5 block text-[10px] font-medium text-blue-600">
                    latest {formatDistanceToNow(new Date(a.sample[0].createdAt), { addSuffix: true })}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
