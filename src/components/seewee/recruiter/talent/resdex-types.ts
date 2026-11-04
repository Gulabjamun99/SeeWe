/**
 * resdex-types — shared state contract for the ResDex-style Talent Search
 * workspace (all strings, '' = filter off, so the state serialises cleanly
 * into URLs / saved searches).
 */
import type { User } from '@/lib/types'

export interface ResDexFilters {
  q: string
  booleanMode: boolean
  skillsMandatory: string
  skillsPreferred: string
  skillsExcluded: string
  designation: string
  employerCurrent: string
  employerPrevious: string
  industry: string
  functionalArea: string
  employmentType: string
  locations: string
  education: string
  institute: string
  minExperience: string
  maxExperience: string
  minCTC: string
  maxCTC: string
  minCurrentCTC: string
  maxCurrentCTC: string
  noticeMax: string
  languages: string
  lastActiveDays: string
  updatedWithinDays: string
  sort: string
}

export const RESDEX_DEFAULT_FILTERS: ResDexFilters = {
  q: '',
  booleanMode: false,
  skillsMandatory: '',
  skillsPreferred: '',
  skillsExcluded: '',
  designation: '',
  employerCurrent: '',
  employerPrevious: '',
  industry: '',
  functionalArea: '',
  employmentType: '',
  locations: '',
  education: '',
  institute: '',
  minExperience: '',
  maxExperience: '',
  minCTC: '',
  maxCTC: '',
  minCurrentCTC: '',
  maxCurrentCTC: '',
  noticeMax: '',
  languages: '',
  lastActiveDays: '',
  updatedWithinDays: '',
  sort: 'auto',
}

export const NOTICE_OPTIONS = [
  { value: 'any', label: 'Any notice period' },
  { value: '0', label: 'Immediate joiners' },
  { value: '15', label: '≤ 15 days' },
  { value: '30', label: '≤ 30 days' },
  { value: '60', label: '≤ 60 days' },
  { value: '90', label: '≤ 90 days' },
]

export const LAST_ACTIVE_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

export const UPDATED_OPTIONS = [
  { value: '', label: 'Any time' },
  { value: '7', label: 'Updated in last 7 days' },
  { value: '30', label: 'Updated in last 30 days' },
  { value: '90', label: 'Updated in last 90 days' },
]

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: '', label: 'Any employment type' },
  { value: 'Full-time', label: 'Full-time' },
  { value: 'Contract', label: 'Contract' },
  { value: 'Part-time', label: 'Part-time' },
  { value: 'Internship', label: 'Internship' },
]

export const SORT_OPTIONS = [
  { value: 'auto', label: 'Relevance (auto)' },
  { value: 'relevance', label: 'Relevance' },
  { value: 'recent', label: 'Newest profiles' },
  { value: 'freshness', label: 'Recently active' },
  { value: 'experience_desc', label: 'Experience: high → low' },
  { value: 'experience_asc', label: 'Experience: low → high' },
  { value: 'salary_desc', label: 'Expected CTC: high → low' },
  { value: 'salary_asc', label: 'Expected CTC: low → high' },
  { value: 'name_asc', label: 'Name (A → Z)' },
]

/** A candidate row as returned by GET /api/candidates (privacy-masked). */
export type ResDexCandidate = Omit<User, 'email' | 'phone'> & {
  emailMasked?: string | null
  phoneMasked?: string | null
  industry?: string | null
  functionalArea?: string | null
  employmentTypePref?: string | null
  preferredLocations?: string | null
  languages?: string | null
  lastActiveAt?: string | null
  profileSource?: string | null
  desiredRole?: string | null
  desiredLocations?: string | null
  desiredJobType?: string | null
  hasCv?: boolean
  resumeSnippet?: string
  relevance?: number
  workExperiences?: { title: string; company: string; isCurrent: boolean }[]
  educationEntries?: { degree: string; institution: string }[]
  certifications?: { name: string; issuer?: string | null; year?: string | null }[]
}

export interface FacetItem {
  value: string
  count: number
}

export interface ResDexFacets {
  locations: FacetItem[]
  industries: FacetItem[]
  functionalAreas: FacetItem[]
  notice: { immediate: number; d15: number; d30: number; d60: number; d90: number; unknown: number }
  experience: { junior: number; mid: number; senior: number; veteran: number }
}

export interface TalentMeta {
  industries: FacetItem[]
  functionalAreas: FacetItem[]
  locations: FacetItem[]
  employers: FacetItem[]
  languages: FacetItem[]
  poolSize: number
}

export interface SavedSearchRow {
  id: string
  name: string
  query: string
  alertFrequency: 'OFF' | 'DAILY' | 'WEEKLY'
  lastRunAt?: string | null
  lastNotifiedAt?: string | null
  newCount: number
  createdAt: string
  updatedAt: string
}

export interface SourcingRow {
  id: string
  candidateId: string
  status: string
  note?: string | null
  tags?: string | null
  assignedToName?: string | null
  lastContactedAt?: string | null
  followUpAt?: string | null
  history: { at: string; actor: string; action: string }[]
}

/** Count active structured filters (for the chips row + badge on the rail). */
export function countActiveFilters(f: ResDexFilters): number {
  let n = 0
  for (const key of [
    'skillsMandatory', 'skillsPreferred', 'skillsExcluded', 'designation',
    'employerCurrent', 'employerPrevious', 'industry', 'functionalArea',
    'employmentType', 'locations', 'education', 'institute',
    'minExperience', 'maxExperience', 'minCTC', 'maxCTC', 'minCurrentCTC',
    'maxCurrentCTC', 'languages',
  ] as const) {
    if (f[key].trim()) n++
  }
  if (f.noticeMax && f.noticeMax !== 'any') n++
  if (f.lastActiveDays) n++
  if (f.updatedWithinDays) n++
  return n
}

/** Serialise filters → query params for GET /api/candidates. */
export function filtersToParams(f: ResDexFilters, page: number, within: string[]): URLSearchParams {
  const sp = new URLSearchParams()
  if (f.q.trim()) sp.set('q', f.q.trim())
  for (const key of [
    'skillsMandatory', 'skillsPreferred', 'skillsExcluded', 'designation',
    'employerCurrent', 'employerPrevious', 'industry', 'functionalArea',
    'employmentType', 'locations', 'education', 'institute',
    'minExperience', 'maxExperience', 'minCTC', 'maxCTC', 'minCurrentCTC',
    'maxCurrentCTC', 'languages',
  ] as const) {
    const v = f[key].trim()
    if (v) sp.set(key, v)
  }
  if (f.noticeMax && f.noticeMax !== 'any') sp.set('noticeMax', f.noticeMax)
  if (f.lastActiveDays) sp.set('lastActiveDays', f.lastActiveDays)
  if (f.updatedWithinDays) sp.set('updatedWithinDays', f.updatedWithinDays)
  if (f.sort && f.sort !== 'auto') sp.set('sort', f.sort)
  if (within.length > 0) sp.set('within', within.join(','))
  sp.set('page', String(page))
  sp.set('pageSize', '12')
  sp.set('facets', '1')
  return sp
}

/** Parse a saved-search query JSON into a filter state (safe merge). */
export function savedQueryToFilters(query: string): ResDexFilters {
  const base = { ...RESDEX_DEFAULT_FILTERS }
  try {
    const raw = JSON.parse(query) as Record<string, unknown>
    for (const key of Object.keys(base) as (keyof ResDexFilters)[]) {
      const v = raw[key]
      if (typeof v === 'string') base[key] = v
      if (typeof v === 'boolean') (base[key] as unknown) = v
    }
    if (typeof raw.q === 'string') base.q = raw.q
    if (typeof raw.booleanMode === 'boolean') base.booleanMode = raw.booleanMode
  } catch {
    /* corrupted saved search → defaults */
  }
  return base
}
