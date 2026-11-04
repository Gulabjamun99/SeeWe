'use client'

/**
 * ApplicationHistory — master spec §10 stage-history timeline (recruiter view).
 *
 * Fetches GET /api/applications/[id]/events?viewerId=<recruiterId> and renders
 * a vertical timeline: dot + type icon + label + actor + relative time + note.
 * The recruiter receives the FULL trail (STATUS_CHANGE, VIEWED, NOTE, OFFER,
 * OFFER_RESPONSE, AI_SCREEN, AI_INVITE, SHARED_WITH_CLIENT, CLIENT_DECISION,
 * ATS_PUSH, ONBOARD). Candidate-facing surfaces use the same API with the
 * candidate as viewerId — the server filters to STATUS_CHANGE/OFFER only.
 */

import { useEffect, useState } from 'react'
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Building2,
  CheckCircle2,
  ClipboardList,
  Eye,
  History,
  Rocket,
  Send,
  ShieldCheck,
  Sparkles,
  StickyNote,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { timeAgoShort } from './timeAgo'
import { statusMetaFor } from './statusMeta'

interface ApplicationEventRow {
  id: string
  type: string
  fromStatus: string | null
  toStatus: string | null
  actorRole: string | null
  actorName: string | null
  note: string | null
  createdAt: string
}

const EVENT_META: Record<string, { label: string; icon: LucideIcon; dot: string; chip: string }> = {
  STATUS_CHANGE: {
    label: 'Stage change',
    icon: ArrowRight,
    dot: 'bg-blue-500',
    chip: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  },
  VIEWED: {
    label: 'Viewed',
    icon: Eye,
    dot: 'bg-slate-400',
    chip: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  },
  NOTE: {
    label: 'Private note',
    icon: StickyNote,
    dot: 'bg-amber-500',
    chip: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  },
  OFFER: {
    label: 'Offer',
    icon: BadgeCheck,
    dot: 'bg-violet-500',
    chip: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
  },
  OFFER_RESPONSE: {
    label: 'Offer response',
    icon: CheckCircle2,
    dot: 'bg-violet-600',
    chip: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
  },
  AI_SCREEN: {
    label: 'AI screen',
    icon: Sparkles,
    dot: 'bg-fuchsia-500',
    chip: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-900 dark:bg-fuchsia-950/40 dark:text-fuchsia-300',
  },
  AI_INVITE: {
    label: 'AI interview invite',
    icon: Bot,
    dot: 'bg-sky-500',
    chip: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  },
  SHARED_WITH_CLIENT: {
    label: 'Shared with client',
    icon: Send,
    dot: 'bg-cyan-600',
    chip: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300',
  },
  CLIENT_DECISION: {
    label: 'Client decision',
    icon: Building2,
    dot: 'bg-teal-600',
    chip: 'border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300',
  },
  RECRUITER_DECISION: {
    label: 'Recruiter final decision',
    icon: BadgeCheck,
    dot: 'bg-indigo-500',
    chip: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300',
  },
  ATS_PUSH: {
    label: 'ATS push',
    icon: Rocket,
    dot: 'bg-orange-500',
    chip: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300',
  },
  ONBOARD: {
    label: 'Onboarding',
    icon: ClipboardList,
    dot: 'bg-emerald-500',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
}

const ACTOR_ROLE_ICON: Record<string, LucideIcon> = {
  RECRUITER: UserRound,
  CANDIDATE: UserRound,
  SYSTEM: Bot,
  CLIENT: Building2,
  ADMIN: ShieldCheck,
}

function metaFor(type: string) {
  return (
    EVENT_META[type] ?? {
      label: type,
      icon: History,
      dot: 'bg-slate-400',
      chip: 'border-slate-200 bg-slate-50 text-slate-600',
    }
  )
}

function StatusPill({ status }: { status: string }) {
  const m = statusMetaFor(status)
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${m.cls}`}
    >
      {m.label}
    </span>
  )
}

export function ApplicationHistory({
  applicationId,
  viewerId,
}: {
  applicationId: string
  viewerId: string
}) {
  const [events, setEvents] = useState<ApplicationEventRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setEvents(null)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(
          `/api/applications/${applicationId}/events?viewerId=${encodeURIComponent(viewerId)}`
        )
        const json: { data?: ApplicationEventRow[]; error?: string } = await res.json()
        if (!alive) return
        if (!res.ok || json.error) throw new Error(json.error || 'Failed to load history')
        setEvents(json.data ?? [])
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Could not load history')
      }
    })()
    return () => {
      alive = false
    }
  }, [applicationId, viewerId])

  if (error) {
    return (
      <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50/50 p-3 dark:border-rose-900/60 dark:bg-rose-950/20">
        <p className="text-xs font-medium text-rose-700 dark:text-rose-300">{error}</p>
      </div>
    )
  }

  if (events === null) {
    return (
      <div className="mt-3 space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-2.5">
            <Skeleton className="size-2.5 shrink-0 rounded-full" />
            <Skeleton className={`h-3.5 ${i === 1 ? 'w-44' : 'w-32'}`} />
          </div>
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-4 text-center dark:border-slate-700 dark:bg-slate-900/40">
        <History className="mx-auto size-4 text-slate-400" aria-hidden />
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          No history yet
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Stage changes, notes, offers and AI actions will appear here as they happen.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <History className="size-3.5" aria-hidden /> Stage history
        <span className="font-medium normal-case tracking-normal text-slate-400">
          · {events.length} event{events.length === 1 ? '' : 's'}
        </span>
      </p>

      <ol
        className="relative max-h-72 space-y-3 overflow-y-auto pl-4 pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent"
        aria-label="Application stage history"
      >
        {/* vertical rail */}
        <span
          className="pointer-events-none absolute bottom-2 left-[5px] top-2 w-px bg-slate-200 dark:bg-slate-700"
          aria-hidden
        />
        {events.map((ev) => {
          const meta = metaFor(ev.type)
          const Icon = meta.icon
          const RoleIcon = ACTOR_ROLE_ICON[ev.actorRole ?? ''] ?? null
          return (
            <li key={ev.id} className="relative">
              <span
                className={`absolute -left-4 top-1 grid size-2.5 place-items-center rounded-full ring-2 ring-white dark:ring-slate-900 ${meta.dot}`}
                aria-hidden
              />
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${meta.chip}`}
                >
                  <Icon className="size-3" aria-hidden />
                  {meta.label}
                </span>
                {(ev.fromStatus || ev.toStatus) && (
                  <span className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {ev.fromStatus ? <StatusPill status={ev.fromStatus} /> : <span>start</span>}
                    <ArrowRight className="size-3 text-slate-300" aria-hidden />
                    {ev.toStatus && <StatusPill status={ev.toStatus} />}
                  </span>
                )}
                <time
                  dateTime={ev.createdAt}
                  title={new Date(ev.createdAt).toLocaleString()}
                  className="ml-auto text-[10px] tabular-nums text-slate-400 dark:text-slate-500"
                >
                  {timeAgoShort(ev.createdAt)}
                </time>
              </div>
              {ev.note && (
                <p className="mt-0.5 break-words text-[11px] leading-snug text-slate-600 dark:text-slate-300">
                  {ev.note}
                </p>
              )}
              {(ev.actorName || ev.actorRole) && (
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                  {RoleIcon && <RoleIcon className="size-3" aria-hidden />}
                  {ev.actorName ? ev.actorName : ev.actorRole}
                  {ev.actorName && ev.actorRole ? (
                    <Badge
                      variant="outline"
                      className="ml-0.5 border-slate-200 px-1 py-0 text-[9px] uppercase text-slate-400"
                    >
                      {ev.actorRole.toLowerCase()}
                    </Badge>
                  ) : null}
                </p>
              )}
            </li>
          )
        })}
      </ol>

      <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
        Immutable audit trail · newest first
      </p>
    </div>
  )
}
