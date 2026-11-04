/**
 * statusMeta — shared application-status presentation map for recruiter panels.
 *
 * Kept dependency-free on purpose: callers that need icons render their own;
 * callers that just need label + pill classes use STATUS_META.
 */

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  APPLIED: {
    label: 'Applied',
    cls: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
  SHORTLISTED: {
    label: 'Shortlisted',
    cls: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  },
  INTERVIEW_SCHEDULED: {
    label: 'AI Interview · live',
    cls: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
  },
  INTERVIEWED: {
    label: 'AI Interviewed',
    cls: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300',
  },
  SHARED_WITH_CLIENT: {
    label: 'Shared',
    cls: 'border-sky-600 bg-sky-600 text-white',
  },
  OFFERED: {
    label: 'Offer sent',
    cls: 'border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300',
  },
  HIRED: {
    label: 'Hired',
    cls: 'border-emerald-600 bg-emerald-600 text-white',
  },
  ONBOARDED: {
    label: 'Onboarded 🎉',
    cls: 'border-violet-600 bg-violet-600 text-white',
  },
  REJECTED: {
    label: 'Rejected',
    cls: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300',
  },
}

export function statusMetaFor(status: string): { label: string; cls: string } {
  return STATUS_META[status] ?? { label: status, cls: 'border-slate-200 bg-slate-50 text-slate-600' }
}
