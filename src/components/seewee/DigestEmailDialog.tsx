'use client'

import { useMemo, useState } from 'react'
import { format, isValid, parseISO } from 'date-fns'
import {
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  FileBarChart,
  Gavel,
  Loader2,
  Mail,
  Send,
  Sparkles,
  Star,
} from 'lucide-react'
import Image from 'next/image'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import type { AppNotification } from '@/lib/types'

const TYPE_META: Record<
  string,
  { icon: typeof Mail; wrap: string; label: string; blurb: string }
> = {
  APPLICATION: {
    icon: ClipboardList,
    wrap: 'bg-blue-50 dark:bg-blue-950/40 text-blue-600 ring-blue-100',
    label: 'New applications',
    blurb: 'Candidates who applied to your openings',
  },
  SHORTLIST: {
    icon: Star,
    wrap: 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 ring-amber-100',
    label: 'Pipeline moves',
    blurb: 'Shortlists, interview invites and scheduling',
  },
  INTERVIEW_DONE: {
    icon: Sparkles,
    wrap: 'bg-sky-50 dark:bg-sky-950/40 text-sky-600 ring-sky-100',
    label: 'AI interviews',
    blurb: 'Completed AI interviews with scores',
  },
  CLIENT_VERDICT: {
    icon: Gavel,
    wrap: 'bg-violet-50 text-violet-600 ring-violet-100',
    label: 'Client verdicts',
    blurb: 'Approvals, holds and declines from clients',
  },
  REPORT_SHARED: {
    icon: FileBarChart,
    wrap: 'bg-cyan-50 text-cyan-700 ring-cyan-100',
    label: 'Reports shared',
    blurb: 'Dossiers shared with client partners',
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

interface DigestEmailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Full notification list (the dialog slices the trailing 7 days itself) */
  items: AppNotification[]
  userName: string
  userEmail: string
}

/**
 * Weekly email digest — simulated. Renders a realistic email-client preview of
 * the user's trailing-7-day activity, then fakes a send (loading → sent) with
 * a toast. No backend email is actually dispatched.
 */
export function DigestEmailDialog({
  open,
  onOpenChange,
  items,
  userName,
  userEmail,
}: DigestEmailDialogProps) {
  const [sending, setSending] = useState(false)
  const [sentAt, setSentAt] = useState<Date | null>(null)

  const weekItems = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    return items
      .filter((n) => {
        const t = new Date(n.createdAt).getTime()
        return !Number.isNaN(t) && t >= weekAgo
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }, [items])

  const sections = useMemo(() => {
    const order = ['APPLICATION', 'SHORTLIST', 'INTERVIEW_DONE', 'CLIENT_VERDICT', 'REPORT_SHARED']
    return order
      .map((type) => {
        const of = weekItems.filter((n) => n.type === type)
        return { type, meta: TYPE_META[type], of: of.slice(0, 3), more: Math.max(0, of.length - 3), count: of.length }
      })
      .filter((s) => s.count > 0)
  }, [weekItems])

  const subject = `Your SeeWe weekly digest · ${weekItems.length} update${weekItems.length === 1 ? '' : 's'}`

  function send() {
    if (sending) return
    setSending(true)
    // Simulated dispatch latency for realism
    window.setTimeout(() => {
      setSending(false)
      setSentAt(new Date())
      toast.success(`Digest sent to ${userEmail} 📬`)
    }, 1200)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSentAt(null) }}>
      <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto rounded-2xl [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Mail className="size-4 text-blue-600" aria-hidden /> Weekly digest email
          </DialogTitle>
          <DialogDescription>
            A preview of the digest email SeeWe can send every week. (Demo — no real email goes out.)
          </DialogDescription>
        </DialogHeader>

        {/* Email chrome */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:bg-slate-900 shadow-sm" aria-label="Email preview">
          {/* Header rows */}
          <div className="space-y-1 border-b border-slate-100 dark:border-slate-800/60 bg-slate-50/80 px-4 py-3 text-xs">
            <p className="flex gap-2">
              <span className="w-12 shrink-0 font-semibold text-slate-400 dark:text-slate-500">From</span>
              <span className="font-medium text-slate-700 dark:text-slate-300">SeeWe Notifications &lt;digest@seewee.ai&gt;</span>
            </p>
            <p className="flex gap-2">
              <span className="w-12 shrink-0 font-semibold text-slate-400 dark:text-slate-500">To</span>
              <span className="truncate font-medium text-slate-700 dark:text-slate-300">{userName} &lt;{userEmail}&gt;</span>
            </p>
            <p className="flex gap-2">
              <span className="w-12 shrink-0 font-semibold text-slate-400 dark:text-slate-500">Subject</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">{subject}</span>
            </p>
          </div>

          {/* Body */}
          <div className="px-5 py-5">
            {/* Brand */}
            <div className="flex items-center justify-between gap-3 border-b border-dashed border-slate-200 dark:border-slate-800 pb-4">
              <Image
                src="/seewee-logo.png"
                alt="SeeWe"
                width={200}
                height={110}
                className="h-9 w-auto rounded-lg ring-1 ring-slate-900/10"
              />
              <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <CalendarDays className="size-3.5" aria-hidden />
                Last 7 days
              </p>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Hi {userName.split(' ')[0]}, here is what happened in your SeeWe workspace this week —{' '}
              <span className="font-bold text-slate-900 dark:text-slate-100">
                {weekItems.length} update{weekItems.length === 1 ? '' : 's'}
              </span>{' '}
              across {sections.length} categor{sections.length === 1 ? 'y' : 'ies'}.
            </p>

            {sections.length === 0 ? (
              <p className="mt-6 rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Nothing this week yet — your next digest will fill up as activity happens. 🌱
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {sections.map(({ type, meta, of, more, count }) => {
                  const Icon = meta.icon
                  return (
                    <section key={type} className="print-section rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
                      <div className="flex items-center gap-2.5">
                        <span className={`grid size-8 place-items-center rounded-lg ring-1 ${meta.wrap}`} aria-hidden>
                          <Icon className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{meta.label}</p>
                          <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">{meta.blurb}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${meta.wrap}`}>
                          {count}
                        </span>
                      </div>
                      <ul className="mt-2.5 space-y-1.5">
                        {of.map((n) => (
                          <li key={n.id} className="flex items-baseline gap-2 text-xs leading-snug">
                            <span className="size-1 shrink-0 translate-y-[-2px] rounded-full bg-slate-300" aria-hidden />
                            <span className="min-w-0 flex-1 truncate font-medium text-slate-700 dark:text-slate-300">{n.title}</span>
                            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                              {relativeTime(n.createdAt)}
                            </span>
                          </li>
                        ))}
                        {more > 0 && (
                          <li className="pl-3 text-[11px] font-medium text-blue-600">+{more} more this week</li>
                        )}
                      </ul>
                    </section>
                  )
                })}
              </div>
            )}

            <p className="mt-5 border-t border-dashed border-slate-200 pt-3 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
              You are receiving this because you have a SeeWe account. Manage digest frequency from
              notification settings. · SeeWe Technologies, India
            </p>
          </div>
        </div>

        {/* Simulated send footer */}
        <div className="flex items-center justify-between gap-3">
          <p aria-live="polite" className="text-xs text-slate-500 dark:text-slate-400">
            {sentAt && isValid(sentAt) ? (
              <span className="inline-flex items-center gap-1 font-medium text-blue-700">
                <CheckCircle2 className="size-3.5" aria-hidden /> Sent to {userEmail} at{' '}
                {format(sentAt, 'h:mm a')}
              </span>
            ) : (
              'Recipients: just you (simulation)'
            )}
          </p>
          <Button
            onClick={send}
            disabled={sending || sentAt !== null}
            className="h-10 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm hover:from-blue-700 hover:to-sky-600 disabled:opacity-70"
          >
            {sending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden /> Sending…
              </>
            ) : sentAt ? (
              <>
                <CheckCircle2 className="size-4" aria-hidden /> Sent
              </>
            ) : (
              <>
                <Send className="size-4" aria-hidden /> Send digest
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
