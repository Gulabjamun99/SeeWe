// SeeWe - Shared UI helpers for skill-match badges.
// Used by the candidate dashboard (application cards) and the
// "Recommended for you" cards so match visuals stay consistent.

export function matchBadgeClass(score?: number | null): string {
  if (score == null)
    return 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
  if (score >= 70) return 'border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950/40'
  if (score >= 40)
    return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
  if (score > 0) return 'border-rose-300 bg-rose-50 text-rose-600 dark:bg-rose-950/40'
  return 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400'
}

export function matchBadgeText(score?: number | null): string {
  if (score == null) return 'No match data'
  if (score > 0) return `${Math.round(score)}% match`
  return 'Low match'
}
