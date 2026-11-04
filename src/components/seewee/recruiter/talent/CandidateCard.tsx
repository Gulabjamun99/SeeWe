'use client'

/**
 * CandidateCard — one search result. Compact and detailed variants. Sourcing
 * style: identity first, current role, hard signals (experience / CTC /
 * notice / freshness), verified skill badges, sourcing status, and per-card
 * actions. Contact details are intentionally NOT shown here (masked until
 * revealed through the logged endpoint).
 */

import { memo } from 'react'
import {
  Award,
  Briefcase,
  Clock3,
  Eye,
  FileSearch,
  FileText,
  FlaskConical,
  MapPin,
  Star,
  Timer,
  Video,
  Wallet,
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { SOURCING_STATUS_META, type SourcingStatus } from '@/lib/talent-constants'
import type { TalentCandidate } from './talent-types'

const AVATAR_STYLES = [
  'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-300',
  'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300',
  'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-300',
  'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-300',
  'bg-lime-100 text-lime-800 dark:bg-lime-900/50 dark:text-lime-300',
  'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300',
]

/** Render a snippet with every occurrence of the search terms highlighted. */
function HighlightedText({ text, terms }: { text: string; terms: string[] }) {
  const set = new Set(terms.map((t) => t.toLowerCase()).filter(Boolean))
  if (set.size === 0) return <>{text}</>
  const esc = [...set].map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(${esc.join('|')})`, 'gi')
  const parts = text.split(re)
  return (
    <>
      {parts.map((p, i) =>
        set.has(p.toLowerCase()) ? (
          <mark
            key={i}
            className="rounded bg-teal-200/70 px-0.5 font-semibold text-teal-900 dark:bg-teal-700/50 dark:text-teal-100"
          >
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

function initials(name?: string | null): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('')
}

function avatarStyle(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return AVATAR_STYLES[h % AVATAR_STYLES.length]
}

export function noticeLabel(days?: number | null): string {
  if (days === null || days === undefined) return 'Notice N/A'
  if (days === 0) return 'Immediate joiner'
  if (days <= 15) return `${days} days notice`
  return `${days} days notice`
}

function freshness(days?: string | null): { label: string; tone: string } {
  if (!days) return { label: 'Active: unknown', tone: 'text-slate-400' }
  const d = new Date(days)
  const diff = Date.now() - d.getTime()
  const daysAgo = Math.floor(diff / 86400000)
  if (daysAgo <= 1) return { label: 'Active today', tone: 'text-emerald-600' }
  if (daysAgo <= 7) return { label: `Active ${daysAgo}d ago`, tone: 'text-emerald-600' }
  if (daysAgo <= 30) return { label: `Active ${daysAgo}d ago`, tone: 'text-amber-600' }
  if (daysAgo <= 90) return { label: `Active ${daysAgo}d ago`, tone: 'text-orange-500' }
  return { label: `Active ${daysAgo}d ago`, tone: 'text-rose-500' }
}

export interface SkillBadgeLite {
  domain: string
  badge: 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE'
  percentage: number
}

const BADGE_STYLE: Record<string, string> = {
  GOLD: 'bg-amber-100 text-amber-800 border-amber-300',
  SILVER: 'bg-slate-100 text-slate-700 border-slate-300',
  BRONZE: 'bg-orange-100 text-orange-800 border-orange-300',
}

/** JD-search match evidence rendered as a scored band on top of the card. */
export interface JdMatchInfo {
  percent: number
  verdictLabel: string
  matched: string[]
  missing: string[]
  roleDetail: string
}

interface CandidateCardProps {
  candidate: TalentCandidate
  badges: SkillBadgeLite[]
  sourcingStatus?: string | null
  selected?: boolean
  compact?: boolean
  busy?: boolean
  onSelect?: (checked: boolean) => void
  onView: () => void
  onSaveToFolder: () => void
  onTrack: () => void
  /** present when the card is a result of the AI JD search */
  jdMatch?: JdMatchInfo
}

export const CandidateCard = memo(function CandidateCard({
  candidate: c,
  badges,
  sourcingStatus,
  selected,
  compact,
  busy,
  onSelect,
  onView,
  onSaveToFolder,
  onTrack,
  jdMatch,
}: CandidateCardProps) {
  const current = c.workExperiences?.find((w) => w.isCurrent)
  const fresh = freshness(c.lastActiveAt)
  const statusMeta = sourcingStatus ? SOURCING_STATUS_META[sourcingStatus as SourcingStatus] : null
  const skills = [...new Set((c.skills || '').split(',').map((s) => s.trim()).filter(Boolean))]

  return (
    <Card
      className={`group relative overflow-hidden border-slate-200 transition hover:border-teal-300 hover:shadow-md dark:border-slate-800 dark:hover:border-teal-700 ${
        selected ? 'ring-2 ring-teal-500' : ''
      }`}
    >
      {jdMatch && (
        <div
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-1.5 text-[11px] ${
            jdMatch.percent >= 75
              ? 'border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950/40'
              : jdMatch.percent >= 50
                ? 'border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40'
                : 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40'
          }`}
        >
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              jdMatch.percent >= 75
                ? 'bg-teal-600 text-white'
                : jdMatch.percent >= 50
                  ? 'bg-sky-600 text-white'
                  : 'bg-amber-500 text-white'
            }`}
          >
            {jdMatch.percent}% JD match
          </span>
          <span className="font-semibold text-slate-700 dark:text-slate-200">{jdMatch.verdictLabel}</span>
          {jdMatch.matched.length > 0 && (
            <span className="text-teal-700 dark:text-teal-300">
              ✓ {jdMatch.matched.slice(0, 4).join(', ')}
              {jdMatch.matched.length > 4 && ` +${jdMatch.matched.length - 4}`}
            </span>
          )}
          {jdMatch.missing.length > 0 && (
            <span className="text-rose-600 dark:text-rose-400" title={`Missing: ${jdMatch.missing.join(', ')}`}>
              ✗ missing: {jdMatch.missing.slice(0, 3).join(', ')}
              {jdMatch.missing.length > 3 && ` +${jdMatch.missing.length - 3}`}
            </span>
          )}
        </div>
      )}
      <div className="flex gap-3 p-4">
        {onSelect && (
          <div className="flex items-start pt-1">
            <Checkbox
              checked={!!selected}
              onCheckedChange={(v) => onSelect(v === true)}
              aria-label={`Select ${c.name}`}
              className="mt-1"
            />
          </div>
        )}

        <Avatar className="size-11 shrink-0 rounded-lg">
          <AvatarFallback className={`rounded-lg text-sm font-bold ${avatarStyle(c.avatarSeed || c.id)}`}>
            {initials(c.name)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <button
                type="button"
                onClick={onView}
                className="flex items-center gap-1.5 text-sm font-bold text-slate-900 hover:text-teal-700 dark:text-slate-100 dark:hover:text-teal-300"
              >
                <span className="truncate">{c.name}</span>
                <span className="sr-only">Open profile preview</span>
              </button>
              <p className="truncate text-[12px] text-slate-600 dark:text-slate-400" title={c.headline || undefined}>
                {c.headline || 'No headline'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {statusMeta && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusMeta.tone}`}>
                  {statusMeta.label}
                </span>
              )}
              {c.profileSource === 'SYNTHETIC_SEED' && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400" title="Synthetic test profile — demo data">
                  <FlaskConical className="mr-0.5 inline size-3" aria-hidden /> synthetic
                </span>
              )}
            </div>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            {current && (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="size-3" aria-hidden />
                <span className="max-w-[210px] truncate">
                  {current.title} @ {current.company}
                </span>
              </span>
            )}
            {c.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3" aria-hidden /> {c.location}
              </span>
            )}
            {c.experienceYears !== null && c.experienceYears !== undefined && (
              <span className="inline-flex items-center gap-1">
                <Clock3 className="size-3" aria-hidden /> {c.experienceYears} yrs
              </span>
            )}
            {c.expectedSalary !== null && c.expectedSalary !== undefined && (
              <span className="inline-flex items-center gap-1">
                <Wallet className="size-3" aria-hidden /> ₹{c.expectedSalary} LPA
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Timer className="size-3" aria-hidden /> {noticeLabel(c.noticePeriodDays)}
            </span>
            <span className={`inline-flex items-center gap-1 ${fresh.tone}`}>● {fresh.label}</span>
          </div>

          {skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {skills.slice(0, compact ? 5 : 8).map((s) => (
                <span key={s} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {s}
                </span>
              ))}
              {skills.length > (compact ? 5 : 8) && (
                <span className="text-[10px] text-slate-400">+{skills.length - (compact ? 5 : 8)}</span>
              )}
            </div>
          )}

          {!compact && (c.matchedSnippets?.length ?? 0) > 0 ? (
            <div className="mt-2 space-y-1">
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-teal-700 dark:text-teal-400">
                <FileSearch className="size-3" aria-hidden /> Matched in CV
              </p>
              {c.matchedSnippets!.slice(0, 2).map((m) => (
                <div
                  key={m.term}
                  className="rounded-md border border-teal-100 bg-teal-50/50 px-2 py-1 text-[11px] leading-relaxed text-slate-600 dark:border-teal-900/60 dark:bg-teal-950/20 dark:text-slate-300"
                >
                  {m.snippet ? (
                    <HighlightedText text={m.snippet} terms={[m.term]} />
                  ) : (
                    <span className="italic text-slate-500 dark:text-slate-400">
                      no CV text for this profile
                    </span>
                  )}
                  <span className="ml-1.5 inline-block rounded bg-white px-1 py-px align-middle text-[9px] font-semibold uppercase tracking-wide text-teal-700 ring-1 ring-teal-200 dark:bg-slate-900 dark:text-teal-300 dark:ring-teal-800">
                    {m.term} · {m.where.join(' + ')}
                  </span>
                </div>
              ))}
            </div>
          ) : !compact && c.resumeSnippet ? (
            <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{c.resumeSnippet}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {badges.slice(0, 3).map((b) => (
              <span
                key={b.domain}
                className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${BADGE_STYLE[b.badge] || ''}`}
                title={`${b.domain} — verified assessment (${b.percentage}%)`}
              >
                <Award className="size-3" aria-hidden /> {b.badge} · {b.domain}
              </span>
            ))}
            {c.videoResumePath && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                <Video className="size-3" aria-hidden /> video CV
              </span>
            )}
            {c.hasCv && (
              <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                <FileText className="size-3" aria-hidden /> CV
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <Button type="button" size="sm" variant="default" className="h-7 gap-1 bg-teal-600 px-2.5 text-[11px] text-white hover:bg-teal-700" onClick={onView}>
              <Eye className="size-3" aria-hidden /> View profile
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2.5 text-[11px]" onClick={onSaveToFolder} disabled={busy}>
              <Star className="size-3" aria-hidden /> Save
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-7 gap-1 px-2.5 text-[11px]" onClick={onTrack} disabled={busy}>
              Track
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
})
