'use client'

import { Award, Medal, Trophy } from 'lucide-react'

/**
 * Verified Skill Badge chip — the visual unit of the skill-first architecture.
 * GOLD  = amber gradient + Trophy   (>= 90%)
 * SILVER = stone/zinc + Medal       (>= 75%)
 * BRONZE = orange + Award           (>= 60%)
 * NONE / unset = neutral outline "Unverified"
 */

export type SkillBadgeLevel = 'GOLD' | 'SILVER' | 'BRONZE' | 'NONE'

const BADGE_LABELS: Record<SkillBadgeLevel, string> = {
  GOLD: 'Gold',
  SILVER: 'Silver',
  BRONZE: 'Bronze',
  NONE: 'Unverified',
}

/** Sort helper — higher rank = better badge. Unknown/null sorts lowest. */
export function badgeRank(badge?: string | null): number {
  switch (badge) {
    case 'GOLD':
      return 4
    case 'SILVER':
      return 3
    case 'BRONZE':
      return 2
    case 'NONE':
      return 1
    default:
      return 0
  }
}

/** Compact display name for the six assessment domains (chips stay narrow). */
export function shortDomainName(domain: string): string {
  switch (domain) {
    case 'React & Frontend':
      return 'React'
    case 'JavaScript & TypeScript':
      return 'JavaScript/TS'
    case 'Python':
      return 'Python'
    case 'SQL & Databases':
      return 'SQL'
    case 'Java Backend':
      return 'Java'
    case 'Aptitude & Logic':
      return 'Aptitude'
    default:
      return domain.length > 14 ? `${domain.slice(0, 13)}…` : domain
  }
}

export type SkillBadgeSize = 'xs' | 'sm' | 'lg'

const SIZE_CLASSES: Record<SkillBadgeSize, { chip: string; icon: string }> = {
  xs: { chip: 'gap-1 px-1.5 py-0.5 text-[10px]', icon: 'size-3' },
  sm: { chip: 'gap-1 px-2 py-0.5 text-xs', icon: 'size-3.5' },
  lg: { chip: 'gap-1.5 px-3 py-1 text-sm', icon: 'size-4' },
}

const LEVEL_CLASSES: Record<SkillBadgeLevel, string> = {
  GOLD:
    'border-amber-500/60 bg-gradient-to-r from-amber-300 to-amber-400 text-amber-950 shadow-sm',
  SILVER:
    'border-stone-300 bg-gradient-to-r from-stone-100 to-stone-300 text-stone-700 dark:border-stone-500 dark:from-stone-700 dark:to-stone-600 dark:text-stone-100',
  BRONZE:
    'border-orange-700 bg-orange-700 text-white shadow-sm dark:border-orange-600 dark:bg-orange-600',
  NONE:
    'border-stone-300 bg-transparent text-stone-500 dark:border-stone-600 dark:text-stone-400',
}

const LEVEL_ICONS: Partial<Record<SkillBadgeLevel, typeof Trophy>> = {
  GOLD: Trophy,
  SILVER: Medal,
  BRONZE: Award,
}

export function SkillBadge({
  badge,
  size = 'sm',
  domain,
}: {
  badge?: SkillBadgeLevel | string | null
  size?: SkillBadgeSize
  /** optional domain shown before the level, e.g. "React · Gold" */
  domain?: string
}) {
  const level: SkillBadgeLevel =
    badge === 'GOLD' || badge === 'SILVER' || badge === 'BRONZE' || badge === 'NONE'
      ? badge
      : 'NONE'

  const sizeCls = SIZE_CLASSES[size] ?? SIZE_CLASSES.sm
  const Icon = LEVEL_ICONS[level]
  const label = BADGE_LABELS[level]

  return (
    <span
      data-skill-badge={level}
      className={`inline-flex max-w-full shrink-0 items-center overflow-hidden whitespace-nowrap rounded-full border font-semibold uppercase tracking-wide ${LEVEL_CLASSES[level]} ${sizeCls.chip}`}
      title={domain ? `${domain}: ${label} verified skill badge` : `${label} skill badge`}
    >
      {Icon && <Icon className={`${sizeCls.icon} shrink-0`} aria-hidden />}
      <span className="truncate">
        {domain ? `${shortDomainName(domain)} · ` : ''}
        {label}
      </span>
    </span>
  )
}
