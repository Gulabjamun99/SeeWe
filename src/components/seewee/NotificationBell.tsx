'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAppStore, type PendingFocus, type View } from '@/store/app-store'
import type { AppNotification, NotificationType } from '@/lib/types'
import {
  Bell,
  BellRing,
  CalendarDays,
  Check,
  CheckCheck,
  ClipboardList,
  FileBarChart,
  Gavel,
  Mail,
  MessageSquare,
  Sparkles,
  Star,
} from 'lucide-react'
import { DigestEmailDialog } from '@/components/seewee/DigestEmailDialog'

/** Visual identity per notification type */
const TYPE_META: Record<
  string,
  { icon: typeof Bell; wrap: string; label: string }
> = {
  APPLICATION: {
    icon: ClipboardList,
    wrap: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 ring-blue-100',
    label: 'Application',
  },
  SHORTLIST: {
    icon: Star,
    wrap: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 ring-amber-100',
    label: 'Pipeline',
  },
  INTERVIEW_DONE: {
    icon: Sparkles,
    wrap: 'bg-sky-50 dark:bg-sky-950/40 text-sky-600 ring-sky-100',
    label: 'AI Interview',
  },
  CLIENT_VERDICT: {
    icon: Gavel,
    wrap: 'bg-violet-50 text-violet-600 ring-violet-100',
    label: 'Client verdict',
  },
  REPORT_SHARED: {
    icon: FileBarChart,
    wrap: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
    label: 'Report shared',
  },
  MESSAGE: {
    icon: MessageSquare,
    wrap: 'bg-teal-50 text-teal-700 ring-teal-100',
    label: 'Message',
  },
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** Destination view per role when a notification is clicked */
function targetView(role: string | undefined): View {
  if (role === 'RECRUITER') return 'recruiter'
  if (role === 'CLIENT') return 'client'
  return 'candidate'
}

/** Safely parse the notification meta JSON */
function parseMeta(raw?: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const obj = JSON.parse(raw)
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Map a notification (role + meta) to a deep-link focus request */
function focusFor(role: string | undefined, meta: Record<string, unknown>): PendingFocus | null {
  const jobId = typeof meta.jobId === 'string' ? meta.jobId : undefined
  const applicationId = typeof meta.applicationId === 'string' ? meta.applicationId : undefined
  const shortlistId = typeof meta.shortlistId === 'string' ? meta.shortlistId : undefined
  const peerId = typeof meta.peerId === 'string' ? meta.peerId : undefined
  const peerName = typeof meta.peerName === 'string' ? meta.peerName : undefined
  // direct messages → open the sender's thread in the Messages tab
  if (peerId) return { kind: 'messages', peerId, peerName }
  if (role === 'RECRUITER') {
    if (!jobId && !applicationId) return null
    return { kind: 'recruiter-applicants', jobId, applicationId }
  }
  if (role === 'CLIENT' && shortlistId) return { kind: 'client-report', shortlistId }
  if (role === 'CANDIDATE' && applicationId)
    return { kind: 'candidate-application', applicationId }
  return null
}

const DIGEST_ORDER = ['APPLICATION', 'SHORTLIST', 'INTERVIEW_DONE', 'CLIENT_VERDICT', 'REPORT_SHARED'] as const

export function NotificationBell() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const setPendingFocus = useAppStore((s) => s.setPendingFocus)
  const [open, setOpen] = useState(false)
  const [digestOpen, setDigestOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  // starts true so the mount fetch shows the skeleton (component remounts per user via key)
  const [loading, setLoading] = useState(true)
  const prevUnread = useRef(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const res = await fetch(
        `/api/notifications?userId=${encodeURIComponent(user.id)}&limit=20`
      )
      if (!res.ok) return
      const json: { data?: { notifications: AppNotification[]; unread: number } } =
        await res.json()
      if (json.data) {
        setItems(json.data.notifications ?? [])
        setUnread(json.data.unread ?? 0)
        prevUnread.current = json.data.unread ?? 0
      }
    } catch {
      /* silent — the bell is passive */
    } finally {
      setLoading(false)
    }
  }, [user])

  // Initial load + 25s polling while signed in.
  // NOTE: component is keyed by user.id in Header, so state resets on account switch.
  useEffect(() => {
    if (!user) return
    void load()
    pollRef.current = setInterval(() => void load(), 25000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [user, load])

  // Weekly digest: per-type counts across the trailing 7 days
  const digest = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const counts: { type: string; count: number }[] = []
    let total = 0
    for (const type of DIGEST_ORDER) {
      const count = items.filter((n) => {
        if (n.type !== type) return false
        const t = new Date(n.createdAt).getTime()
        return !Number.isNaN(t) && t >= weekAgo
      }).length
      if (count > 0) {
        counts.push({ type, count })
        total += count
      }
    }
    return { counts, total }
  }, [items])

  // "New mail" cue: the bell icon swaps to BellRing + wiggles whenever unread > 0

  async function markRead(id: string) {
    if (!user) return
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
    setUnread((u) => Math.max(0, u - 1))
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, id }),
      })
    } catch {
      /* optimistic */
    }
  }

  async function markAllRead() {
    if (!user) return
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnread(0)
    try {
      await fetch('/api/notifications/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, all: true }),
      })
    } catch {
      /* optimistic */
    }
  }

  function onItemClick(n: AppNotification) {
    if (!n.read) void markRead(n.id)
    // Deep-link: hand the matching dashboard a one-shot focus target, then navigate.
    const focus = focusFor(user?.role, parseMeta(n.meta))
    if (focus) setPendingFocus(focus)
    bumpRefresh()
    setView(targetView(user?.role))
    setOpen(false)
  }

  if (!user) return null

  const pulse = unread > 0

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) void load() }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Notifications${unread > 0 ? ` — ${unread} unread` : ''}`}
          className="relative flex size-10 items-center justify-center rounded-full text-slate-600 dark:text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={pulse ? `ring-${unread}` : 'idle'}
              initial={pulse ? { rotate: -18, scale: 1.25 } : { scale: 1 }}
              animate={pulse ? { rotate: [0, -14, 12, -8, 0], scale: 1.12 } : { scale: 1 }}
              transition={{ duration: 0.55, ease: 'easeInOut' }}
              className="flex items-center justify-center"
            >
              {pulse ? (
                <BellRing className="size-[18px] text-blue-600" aria-hidden />
              ) : (
                <Bell className="size-[18px]" aria-hidden />
              )}
            </motion.span>
          </AnimatePresence>
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-red-500 px-1 text-[10px] font-bold text-white shadow-md ring-2 ring-white">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={10}
        collisionPadding={12}
        className="w-[min(92vw,380px)] rounded-2xl border-slate-200 dark:border-slate-800 p-0 shadow-xl shadow-slate-200/60"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 rounded-t-2xl border-b border-slate-100 dark:border-slate-800/60 bg-gradient-to-r from-blue-50/80 to-sky-50/60 px-4 py-3">
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Notifications</p>
            <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {unread > 0 ? `${unread} unread update${unread === 1 ? '' : 's'}` : 'All caught up ✨'}
            </p>
          </div>
          {unread > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void markAllRead()}
              className="h-8 gap-1 rounded-full px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100"
            >
              <CheckCheck className="size-3.5" aria-hidden /> Mark all read
            </Button>
          )}
        </div>

        {/* Weekly digest strip */}
        {digest.total > 0 && (
          <div
            className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/70 px-4 py-2"
            aria-label={`This week: ${digest.total} update${digest.total === 1 ? '' : 's'}`}
          >
            <span className="mr-0.5 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              <CalendarDays className="size-3" aria-hidden /> 7 days
            </span>
            {digest.counts.map(({ type, count }) => {
              const meta = TYPE_META[type] ?? TYPE_META.SHORTLIST
              const Icon = meta.icon
              return (
                <span
                  key={type}
                  title={`${meta.label}: ${count} this week`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${meta.wrap}`}
                >
                  <Icon className="size-3" aria-hidden />
                  {count}
                  <span className="sr-only">{meta.label}</span>
                </span>
              )
            })}
            <button
              type="button"
              onClick={() => setDigestOpen(true)}
              title="Preview & send this as a weekly email digest"
              className="ml-auto inline-flex min-h-[28px] items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold text-blue-600 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Mail className="size-3" aria-hidden /> Email digest
            </button>
          </div>
        )}

        {/* List */}
        <ScrollArea className="max-h-[min(60vh,420px)]">
          <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
            {loading && items.length === 0 ? (
              <div className="space-y-3 p-4">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="flex gap-3">
                    <div className="size-9 shrink-0 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
                    <div className="flex-1 space-y-1.5 py-0.5">
                      <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100 dark:bg-slate-800" />
                      <div className="h-3 w-1/2 animate-pulse rounded bg-slate-50 dark:bg-slate-800/60" />
                    </div>
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/40 ring-1 ring-blue-100">
                  <Bell className="size-5 text-blue-500" aria-hidden />
                </span>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Nothing yet</p>
                <p className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">
                  {user.role === 'RECRUITER'
                    ? 'New applications, AI interview scores and client verdicts will land here.'
                    : user.role === 'CLIENT'
                      ? 'Shared AI interview reports will appear here for review.'
                      : 'Shortlist updates, interview scores and client decisions will land here.'}
                </p>
              </div>
            ) : (
              items.map((n) => {
                const meta = TYPE_META[n.type] ?? TYPE_META.SHORTLIST
                const Icon = meta.icon
                const isNew = Date.now() - new Date(n.createdAt).getTime() < 120_000
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => onItemClick(n)}
                    className={`group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60 focus-visible:outline-none focus-visible:bg-blue-50/50 ${
                      n.read ? '' : 'bg-blue-50/40 dark:bg-blue-950/40'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ${meta.wrap}`}
                    >
                      <Icon className="size-4" aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={`truncate text-[13px] font-semibold ${n.read ? 'text-slate-600 dark:text-slate-400' : 'text-slate-900 dark:text-slate-100'}`}
                        >
                          {n.title}
                        </span>
                        {!n.read && (
                          <span
                            className={`size-2 shrink-0 rounded-full bg-blue-500 ${isNew ? 'animate-pulse ring-2 ring-blue-200' : ''}`}
                            aria-label={isNew ? 'new notification' : 'unread'}
                          />
                        )}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                          {n.body}
                        </span>
                      )}
                      <span className="mt-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        <span>{meta.label}</span>
                        <span aria-hidden>·</span>
                        <span>{relativeTime(n.createdAt)}</span>
                      </span>
                    </span>
                    {!n.read && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="Mark as read"
                        onClick={(e) => {
                          e.stopPropagation()
                          void markRead(n.id)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            e.stopPropagation()
                            void markRead(n.id)
                          }
                        }}
                        className="mt-1 hidden size-6 shrink-0 items-center justify-center rounded-full text-slate-400 dark:text-slate-500 hover:bg-blue-100 hover:text-blue-700 group-hover:flex"
                      >
                        <Check className="size-3.5" aria-hidden />
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
        </ScrollArea>
      </PopoverContent>

      {/* Weekly email digest simulation */}
      {user && (
        <DigestEmailDialog
          open={digestOpen}
          onOpenChange={setDigestOpen}
          items={items}
          userName={user.name}
          userEmail={user.email}
        />
      )}
    </Popover>
  )
}
