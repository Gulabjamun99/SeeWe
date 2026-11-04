/**
 * talent-constants — CLIENT-SAFE sourcing configuration constants.
 * (No database imports — safe for client components; the server-side quota
 * enforcement lives in talent-config.ts.)
 */

export const TALENT_QUOTAS = {
  SEARCH: 500, // searches per day
  SAVED_SEARCH_RUN: 100, // explicit saved-search runs per day
  PROFILE_VIEW: 200, // full profile views per day
  CONTACT_REVEAL: 60, // contact reveals per day
  EXPORT: 10, // CSV exports per day
  EXPORT_ROWS: 300, // max rows per export
  OUTREACH: 150, // outreach messages per day
} as const

export type QuotaKind = keyof typeof TALENT_QUOTAS

/** Sourcing workflow statuses (master spec). Admin-configurable later. */
export const SOURCING_STATUSES = [
  'NEW',
  'REVIEWED',
  'SHORTLISTED',
  'CONTACTED',
  'RESPONDED',
  'INTERESTED',
  'NOT_INTERESTED',
  'SUBMITTED_TO_CLIENT',
  'INTERVIEWING',
  'HIRED',
  'ON_HOLD',
] as const

export type SourcingStatus = (typeof SOURCING_STATUSES)[number]

export const SOURCING_STATUS_META: Record<SourcingStatus, { label: string; tone: string; step: number }> = {
  NEW: { label: 'New', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300', step: 0 },
  REVIEWED: { label: 'Reviewed', tone: 'bg-sky-100 text-sky-800', step: 1 },
  SHORTLISTED: { label: 'Shortlisted', tone: 'bg-teal-100 text-teal-800', step: 2 },
  CONTACTED: { label: 'Contacted', tone: 'bg-amber-100 text-amber-800', step: 3 },
  RESPONDED: { label: 'Responded', tone: 'bg-lime-100 text-lime-800', step: 4 },
  INTERESTED: { label: 'Interested', tone: 'bg-green-100 text-green-800', step: 5 },
  NOT_INTERESTED: { label: 'Not interested', tone: 'bg-rose-100 text-rose-700', step: 5 },
  SUBMITTED_TO_CLIENT: { label: 'Submitted to client', tone: 'bg-violet-100 text-violet-800', step: 6 },
  INTERVIEWING: { label: 'Interviewing', tone: 'bg-fuchsia-100 text-fuchsia-800', step: 7 },
  HIRED: { label: 'Hired', tone: 'bg-emerald-100 text-emerald-800', step: 8 },
  ON_HOLD: { label: 'On hold', tone: 'bg-orange-100 text-orange-800', step: 8 },
}
