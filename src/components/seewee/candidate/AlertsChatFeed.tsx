'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  BellRing,
  BriefcaseBusiness,
  Check,
  CheckCheck,
  Link2,
  Mail,
  MessageSquareHeart,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * AlertsChatFeed — a WhatsApp-style "Updates" chat that merges everything the
 * candidate needs to see: platform notifications, process emails and fresh
 * matches from their job alerts (the emerald bubbles on the "you" side).
 * Self-contained: pass { user } at minimum; onOpenJob / onNavigate are optional
 * callbacks the host dashboard can wire for deeper integration.
 */

type FeedSource = 'platform' | 'mail' | 'job-alert'

interface FeedBubble {
  id: string
  source: FeedSource
  kind: string
  title: string
  body: string
  createdAt: string
  read: boolean
  jobId?: string
  alertId?: string
  meta?: { jobId?: string; applicationId?: string }
}

interface FeedApiResponse {
  data?: { feed: FeedBubble[]; unreadCount: number; generatedAt: string }
  error?: string
}

export interface AlertsChatFeedProps {
  user: { id: string; name?: string }
  /** Optional — called when the candidate taps "View job" on a match bubble */
  onOpenJob?: (jobId: string) => void
  /** Optional — called by the quick-reply chips: 'saved' | 'alerts' | 'jobs' */
  onNavigate?: (tab: 'saved' | 'alerts' | 'jobs') => void
}

const POLL_MS = 60_000

/* ------------------------------ helpers ------------------------------ */

function platformIconFor(kind: string): typeof Sparkles {
  const k = kind.toLowerCase()
  if (k.includes('verdict') || k.includes('transparen') || k.includes('shield'))
    return ShieldCheck
  if (k.includes('pipeline') || k.includes('shortlist')) return Star
  return Sparkles
}

function timeLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return format(d, 'HH:mm')
}

function dayKey(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '?'
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = d.getTime()
  if (t >= startOfToday) return 'Today'
  if (t >= startOfToday - 86_400_000) return 'Yesterday'
  const sameYear = d.getFullYear() === now.getFullYear()
  return sameYear ? format(d, 'MMM d') : format(d, 'MMM d, yyyy')
}

const QUICK_REPLIES: { tab: 'saved' | 'alerts' | 'jobs'; label: string; hint: string }[] = [
  {
    tab: 'saved',
    label: 'Show saved jobs',
    hint: 'Open the Saved tab in your dashboard to revisit the jobs you bookmarked.',
  },
  {
    tab: 'alerts',
    label: 'Alert settings',
    hint: 'Manage or create alerts from the Alerts tab in your dashboard.',
  },
  {
    tab: 'jobs',
    label: 'Find jobs',
    hint: 'Use Find jobs in the top navigation to search live openings.',
  },
]

/* ------------------------------ component ------------------------------ */

export default function AlertsChatFeed({ user, onOpenJob, onNavigate }: AlertsChatFeedProps) {
  const [feed, setFeed] = useState<FeedBubble[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const firstLoadDone = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const unread = useMemo(
    () => (feed ?? []).filter((b) => !b.read).length,
    [feed]
  )

  /* -------- load / poll -------- */

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!user?.id) return
      if (!opts?.silent) setRefreshing(true)
      try {
        const res = await fetch(
          `/api/alerts/feed?userId=${encodeURIComponent(user.id)}`
        )
        const json: FeedApiResponse = await res.json()
        if (!res.ok || json.error) {
          throw new Error(json.error || 'Could not load your updates')
        }
        setFeed(json.data?.feed ?? [])
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load your updates')
      } finally {
        setRefreshing(false)
      }
    },
    [user?.id]
  )

  useEffect(() => {
    firstLoadDone.current = false
    void load()
    const t = setInterval(() => void load({ silent: true }), POLL_MS)
    return () => clearInterval(t)
  }, [load])

  // Chat behaviour: newest at the bottom — pin the view there on first load,
  // and whenever a poll lands while the reader is already near the bottom.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !feed) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140
    if (!firstLoadDone.current || nearBottom) {
      el.scrollTop = el.scrollHeight
      firstLoadDone.current = true
    }
  }, [feed])

  /* -------- seen actions -------- */

  const applySeen = useCallback((ids: string[]) => {
    const idSet = new Set(ids)
    setFeed((prev) =>
      prev
        ? prev.map((b) => (idSet.has(b.id) ? { ...b, read: true } : b))
        : prev
    )
  }, [])

  const postSeen = useCallback(
    async (ids: string[]): Promise<boolean> => {
      if (!user?.id || ids.length === 0) return true
      try {
        const res = await fetch('/api/alerts/feed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, action: 'seen', ids }),
        })
        const json: { data?: { marked: number; alertSeen: string[] }; error?: string } =
          await res.json()
        if (!res.ok || json.error) {
          throw new Error(json.error || 'Could not mark as seen')
        }
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not mark as seen')
        void load({ silent: true }) // re-sync with the server state
        return false
      }
    },
    [user?.id, load]
  )

  const markBubbleSeen = useCallback(
    async (b: FeedBubble) => {
      if (b.read) return
      applySeen([b.id]) // optimistic — bubble fades to read
      const ok = await postSeen([b.id])
      if (ok) {
        if (b.source === 'job-alert') {
          toast.success('Marked as seen', {
            description: 'This alert stops counting these matches as new.',
          })
        }
      } else {
        // postSeen already re-synced from the server, which restores truth
        setFeed((prev) =>
          prev ? prev.map((x) => (x.id === b.id ? { ...x, read: false } : x)) : prev
        )
      }
    },
    [applySeen, postSeen]
  )

  const markAllSeen = useCallback(async () => {
    if (!user?.id || markingAll) return
    const unreadBubbles = (feed ?? []).filter((b) => !b.read)
    if (unreadBubbles.length === 0) return
    setMarkingAll(true)
    const prevFeed = feed
    applySeen(unreadBubbles.map((b) => b.id)) // optimistic
    try {
      // seen-all clears notifications (incl. older ones outside this window)…
      const res = await fetch('/api/alerts/feed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, action: 'seen-all' }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Could not mark all as seen')
      // …and the alert bubbles reset their alert's lastSeenAt so matches stop re-surfacing
      const alertIds = unreadBubbles
        .filter((b) => b.source === 'job-alert')
        .map((b) => b.id)
      if (alertIds.length > 0) await postSeen(alertIds)
      toast.success('All caught up \u2728')
    } catch (err) {
      setFeed(prevFeed) // revert on failure
      toast.error(err instanceof Error ? err.message : 'Could not mark all as seen')
    } finally {
      setMarkingAll(false)
    }
  }, [user?.id, feed, markingAll, applySeen, postSeen])

  /* -------- chip actions -------- */

  const viewJob = useCallback(
    (b: FeedBubble) => {
      if (b.jobId && onOpenJob) {
        onOpenJob(b.jobId)
        return
      }
      // No handler wired — copy the portal link as an honest fallback
      const link = typeof window !== 'undefined' ? window.location.origin : ''
      const jobTitle = b.title.split(' \u00b7 ')[0] ?? b.title
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(link)
          .then(() =>
            toast.success('Link copied', {
              description: `Open it in your browser and search \u201c${jobTitle}\u201d in Find jobs.`,
            })
          )
          .catch(() =>
            toast.error('Could not copy the link \u2014 search the job title in Find jobs instead.')
          )
      } else {
        toast.info(`Search \u201c${jobTitle}\u201d in Find jobs to open this role.`)
      }
    },
    [onOpenJob]
  )

  const quickReply = useCallback(
    (tab: 'saved' | 'alerts' | 'jobs') => {
      if (onNavigate) {
        onNavigate(tab)
        return
      }
      const item = QUICK_REPLIES.find((q) => q.tab === tab)
      if (item) toast.info(item.hint)
    },
    [onNavigate]
  )

  /* -------- day grouping -------- */

  const groups = useMemo(() => {
    const out: { label: string; bubbles: FeedBubble[] }[] = []
    for (const b of feed ?? []) {
      const label = dayLabel(b.createdAt)
      const last = out[out.length - 1]
      if (last && last.label === label) {
        last.bubbles.push(b)
      } else {
        out.push({ label, bubbles: [b] })
      }
    }
    return out
  }, [feed])

  /* ------------------------------ render ------------------------------ */

  if (!user?.id) return null

  return (
    <section
      aria-label="Updates chat"
      className="flex max-w-full flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-950"
    >
      <style>{`
        .alerts-chat-scroll { scrollbar-width: thin; scrollbar-color: rgb(214 211 209) transparent; }
        .alerts-chat-scroll::-webkit-scrollbar { width: 6px; }
        .alerts-chat-scroll::-webkit-scrollbar-track { background: transparent; }
        .alerts-chat-scroll::-webkit-scrollbar-thumb { background: rgb(214 211 209); border-radius: 9999px; }
        .dark .alerts-chat-scroll::-webkit-scrollbar-thumb { background: rgb(68 64 60); }
      `}</style>

      {/* Header */}
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-gradient-to-r from-violet-50/80 to-stone-50 px-4 py-3 dark:border-stone-800 dark:from-violet-950/30 dark:to-stone-900">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-sm">
          <MessageSquareHeart className="size-4.5 text-white" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold leading-tight text-stone-900 dark:text-stone-100">
            Updates
          </h3>
          <p className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
            {unread > 0
              ? `${unread} unread update${unread === 1 ? '' : 's'}`
              : 'All caught up \u2728'}
          </p>
        </div>

        {unread > 0 && (
          <span
            aria-label={`${unread} unread updates`}
            className="inline-flex min-h-6 items-center rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm"
          >
            {unread > 99 ? '99+' : unread} new
          </span>
        )}

        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          aria-label="Refresh updates"
          className="grid size-11 place-items-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-50 dark:hover:bg-stone-800 sm:size-9"
        >
          <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
        </button>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => void markAllSeen()}
          disabled={markingAll || unread === 0}
          className="min-h-11 gap-1 rounded-full px-3 text-xs font-semibold text-violet-700 hover:bg-violet-100 disabled:opacity-45 dark:text-violet-300 dark:hover:bg-violet-950/60 sm:min-h-9"
        >
          <CheckCheck className="size-3.5" aria-hidden />
          Mark all seen
        </Button>
      </header>

      {/* Feed */}
      <div
        ref={scrollRef}
        role="log"
        aria-label="Update messages"
        className="alerts-chat-scroll max-h-[30rem] min-h-[12rem] overflow-y-auto bg-stone-50/60 px-3 py-4 dark:bg-stone-900/40"
      >
        <p aria-live="polite" className="sr-only">
          {feed === null
            ? 'Loading updates'
            : unread > 0
              ? `You have ${unread} unread update${unread === 1 ? '' : 's'}`
              : 'No unread updates'}
        </p>

        {/* Loading skeleton */}
        {feed === null && !error && (
          <div className="space-y-4" aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className={i % 2 === 1 ? 'flex justify-end' : 'flex'}>
                <div className="w-4/5 max-w-[85%] space-y-2 rounded-2xl bg-white p-3 shadow-sm dark:bg-stone-900">
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3.5 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {error && feed === null && (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{error}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="min-h-11 rounded-full border-stone-200 dark:border-stone-700 sm:min-h-9"
            >
              Try again
            </Button>
          </div>
        )}

        {/* Empty state — honest & friendly */}
        {feed !== null && !error && feed.length === 0 && (
          <div className="flex flex-col items-center gap-2.5 px-6 py-10 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-violet-100 dark:bg-violet-950/50">
              <Sparkles className="size-5 text-violet-600 dark:text-violet-300" aria-hidden />
            </span>
            <p className="text-sm font-semibold text-stone-700 dark:text-stone-200">
              You&rsquo;re all caught up — new updates will appear here like a chat.
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-stone-500 dark:text-stone-400">
              Shortlist news, interview invites, process emails and fresh matches from
              your job alerts all land in this one thread.
            </p>
          </div>
        )}

        {/* Bubbles grouped by day */}
        {feed !== null &&
          groups.map((group) => (
            <div key={group.label}>
              {/* Day divider */}
              <div className="my-3 flex items-center gap-3" role="separator" aria-label={group.label}>
                <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
                <span className="rounded-full bg-stone-200/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                  {group.label}
                </span>
                <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
              </div>

              <ul className="space-y-2.5">
                <AnimatePresence initial={false}>
                  {group.bubbles.map((b) => {
                    const isMatch = b.source === 'job-alert'
                    const isMail = b.source === 'mail'
                    const Icon = isMatch
                      ? BellRing
                      : isMail
                        ? Mail
                        : platformIconFor(b.kind)
                    return (
                      <motion.li
                        key={b.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.22 }}
                        className={`flex ${isMatch ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`flex max-w-[92%] items-start gap-2.5 sm:max-w-[85%] ${
                            isMatch ? 'flex-row-reverse' : ''
                          }`}
                        >
                          {/* avatar-ish icon chip */}
                          <span
                            className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl ring-1 ${
                              isMatch
                                ? 'bg-emerald-100 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900'
                                : isMail
                                  ? 'bg-stone-200/80 text-stone-600 ring-stone-300/70 dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700'
                                  : 'bg-violet-100 text-violet-700 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-900'
                            }`}
                            aria-hidden
                          >
                            <Icon className="size-4" />
                          </span>

                          <div
                            className={`min-w-0 rounded-2xl border px-3.5 py-2.5 shadow-sm transition-all duration-300 ${
                              isMatch
                                ? 'rounded-br-md border-emerald-200 bg-emerald-50 dark:border-emerald-900/70 dark:bg-emerald-950/40'
                                : isMail
                                  ? 'rounded-bl-md border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900'
                                  : 'rounded-bl-md border-violet-200/80 bg-violet-50/90 dark:border-violet-900/60 dark:bg-violet-950/30'
                            } ${
                              b.read
                                ? 'opacity-70'
                                : 'ring-2 ring-violet-300/70 dark:ring-violet-700/60'
                            }`}
                          >
                            {/* micro-label row */}
                            <div
                              className={`mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide ${
                                isMatch
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : isMail
                                    ? 'text-stone-400 dark:text-stone-500'
                                    : 'text-violet-500 dark:text-violet-400'
                              }`}
                            >
                              <span>
                                {isMatch
                                  ? 'New match'
                                  : isMail
                                    ? `Email update \u00b7 ${b.kind}`
                                    : b.kind}
                              </span>
                              {!b.read && (
                                <span
                                  className={`size-1.5 rounded-full ${
                                    isMatch ? 'bg-emerald-500' : 'bg-violet-500'
                                  }`}
                                  aria-label="unread"
                                />
                              )}
                            </div>

                            <p className="break-words text-[13px] font-semibold leading-snug text-stone-800 dark:text-stone-100">
                              {b.title}
                            </p>
                            {b.body && (
                              <p className="mt-0.5 break-words text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                                {b.body}
                              </p>
                            )}

                            {/* meta / actions row */}
                            <div
                              className={`mt-1.5 flex flex-wrap items-center gap-1.5 ${
                                isMatch ? 'justify-end' : ''
                              }`}
                            >
                              <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">
                                {timeLabel(b.createdAt)}
                              </span>

                              {isMatch && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => viewJob(b)}
                                    className="inline-flex min-h-11 items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:min-h-8"
                                  >
                                    <BriefcaseBusiness className="size-3" aria-hidden /> View job
                                  </button>
                                  {b.read ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600/80 dark:text-emerald-500/80">
                                      <Check className="size-3" aria-hidden /> Seen
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => void markBubbleSeen(b)}
                                      className="inline-flex min-h-11 items-center gap-1 rounded-full border border-emerald-300 px-2.5 py-1 text-[11px] font-bold text-emerald-700 transition-colors hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/60 sm:min-h-8"
                                    >
                                      <CheckCheck className="size-3" aria-hidden /> Seen
                                    </button>
                                  )}
                                </>
                              )}

                              {!isMatch && !b.read && (
                                <button
                                  type="button"
                                  onClick={() => void markBubbleSeen(b)}
                                  aria-label="Mark this update as seen"
                                  className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold text-violet-600 transition-colors hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:text-violet-300 dark:hover:bg-violet-950/60 sm:min-h-8"
                                >
                                  <Check className="size-3" aria-hidden /> Mark seen
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </ul>
            </div>
          ))}
      </div>

      {/* Quick-reply strip (chat-input affordance) */}
      <footer
        aria-label="Quick actions"
        className="flex flex-wrap items-center gap-2 border-t border-stone-100 bg-white px-3 py-2.5 dark:border-stone-800 dark:bg-stone-950"
      >
        {QUICK_REPLIES.map((q) => (
          <button
            key={q.tab}
            type="button"
            onClick={() => quickReply(q.tab)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3.5 text-xs font-semibold text-stone-600 transition-all hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-violet-800 dark:hover:bg-violet-950/40 dark:hover:text-violet-300"
          >
            <Link2 className="size-3.5 opacity-60" aria-hidden />
            {q.label}
          </button>
        ))}
      </footer>
    </section>
  )
}
