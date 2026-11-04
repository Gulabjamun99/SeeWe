'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAppStore, skillsToArray, formatLpa, matchColor } from '@/store/app-store'
import { computeMatchScore } from '@/lib/match'
import type { Job } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { SaveJobButton } from '@/components/seewee/SaveJobButton'
import { CompanyDialog } from '@/components/seewee/CompanyDialog'
import { EasyApplyDialog } from '@/components/seewee/EasyApplyDialog'
import { toast } from 'sonner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowUpDown,
  BellRing,
  Bookmark,
  BookmarkPlus,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FilterX,
  IndianRupee,
  MapPin,
  Search,
  SearchX,
  TrendingUp,
  Wallet,
  X,
  Zap,
} from 'lucide-react'

const PAGE_SIZE = 9

// ------------------------------ saved searches ---------------------------
// Client-side convenience: recent filter combos kept in localStorage so a
// job seeker can re-run a favorite search in one tap. No server round-trip.
type SavedSearch = {
  id: string
  label: string
  keyword: string
  location: string
  jobType: string
  workMode: string
  experience: string
  salaryMin: string
  postedWithin: string
  sort: string
}

const SAVED_SEARCHES_KEY = 'seewee-saved-searches-v1'
const MAX_SAVED_SEARCHES = 8

const EXPERIENCE_PRESETS: Record<string, { min?: number; max?: number }> = {
  any: {},
  fresher: { min: 0, max: 0 },
  '0-2': { min: 0, max: 2 },
  '2-5': { min: 2, max: 5 },
  '5-10': { min: 5, max: 10 },
  '10+': { min: 10 },
}

const EXPERIENCE_LABELS: Record<string, string> = {
  any: 'Any experience',
  fresher: 'Fresher',
  '0-2': '0–2 yrs',
  '2-5': '2–5 yrs',
  '5-10': '5–10 yrs',
  '10+': '10+ yrs',
}

const SALARY_LABELS: Record<string, string> = {
  any: 'Any salary',
  '5': '5 LPA+',
  '10': '10 LPA+',
  '15': '15 LPA+',
  '20': '20 LPA+',
  '30': '30 LPA+',
}

// Freshness-first ranking: only roles created within the window
const POSTED_LABELS: Record<string, string> = {
  any: 'Any time',
  '3': 'Last 3 days',
  '7': 'Last 7 days',
  '15': 'Last 15 days',
  '30': 'Last 30 days',
}

const SORT_LABELS: Record<string, string> = {
  recent: 'Newest first',
  salary_desc: 'Salary · High → Low',
  salary_asc: 'Salary · Low → High',
}

function loadSavedSearches(): SavedSearch[] {
  try {
    const raw = window.localStorage.getItem(SAVED_SEARCHES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return (parsed as unknown[])
      .filter(
        (s): s is SavedSearch =>
          !!s && typeof s === 'object' && typeof (s as SavedSearch).id === 'string'
      )
      .map((s) => ({
        // older chips predate the experience/salary/sort fields — normalize
        id: s.id,
        label: s.label ?? '',
        keyword: s.keyword ?? '',
        location: s.location ?? '',
        jobType: s.jobType ?? 'all',
        workMode: s.workMode ?? 'all',
        experience: s.experience ?? 'any',
        salaryMin: s.salaryMin ?? 'any',
        postedWithin: s.postedWithin ?? 'any',
        sort: s.sort ?? 'recent',
      }))
  } catch {
    return []
  }
}

function searchSignature(
  s: Pick<
    SavedSearch,
    'keyword' | 'location' | 'jobType' | 'workMode' | 'experience' | 'salaryMin' | 'postedWithin'
  >
) {
  return `${s.keyword.trim().toLowerCase()}|${s.location.trim().toLowerCase()}|${s.jobType}|${s.workMode}|${s.experience}|${s.salaryMin}|${s.postedWithin}`
}

export function JobsView() {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const openJob = useAppStore((s) => s.openJob)
  const setView = useAppStore((s) => s.setView)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const pendingSearch = useAppStore((s) => s.pendingSearch)
  const setPendingSearch = useAppStore((s) => s.setPendingSearch)

  const [keyword, setKeyword] = useState(() => pendingSearch?.keyword ?? '')
  const [location, setLocation] = useState(() => pendingSearch?.location ?? '')
  const [jobType, setJobType] = useState('all')
  const [workMode, setWorkMode] = useState('all')
  const [experience, setExperience] = useState('any')
  const [salaryMin, setSalaryMin] = useState('any')
  const [postedWithin, setPostedWithin] = useState('any')
  const [sort, setSort] = useState('recent')
  const [page, setPage] = useState(1)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  // company name currently shown in the CompanyDialog (null = closed)
  const [companyDialog, setCompanyDialog] = useState<string | null>(null)
  // ⚡ Easy apply: the job currently open in the quick-apply dialog + which
  // jobs this candidate already applied to (localStorage cache, refreshed on
  // refreshKey so applications made elsewhere show up instantly)
  const [easyApplyJob, setEasyApplyJob] = useState<Job | null>(null)
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const map = JSON.parse(localStorage.getItem('seewee-applied-jobs') ?? '{}') as Record<string, boolean>
      const localIds = new Set(Object.keys(map).filter((k) => map[k]))
      setAppliedIds(localIds)
    } catch {
      setAppliedIds(new Set())
    }
    // Server truth merge (QA queue fix): applications made in other sessions /
    // via API must also render the "Applied" state, not just localStorage ones.
    if (user?.role === 'CANDIDATE') {
      let cancelled = false
      fetch(`/api/applications?candidateId=${encodeURIComponent(user.id)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json: { data?: Array<{ jobId?: string }> } | null) => {
          if (cancelled || !json?.data) return
          const serverIds = new Set(
            json.data.map((a) => a.jobId).filter((id): id is string => Boolean(id))
          )
          setAppliedIds((prev) => new Set([...prev, ...serverIds]))
        })
        .catch(() => undefined)
      return () => {
        cancelled = true
      }
    }
  }, [refreshKey, user?.id, user?.role])

  // Consume a search handed over from another view (hero search, job alerts…).
  // State above initializes from the store at mount; this effect clears the
  // handoff and also covers updates while this view is already mounted.
  useEffect(() => {
    if (!pendingSearch) return
    if (pendingSearch.keyword !== undefined) setKeyword(pendingSearch.keyword)
    if (pendingSearch.location !== undefined) setLocation(pendingSearch.location || '')
    setPage(1)
    setPendingSearch(null)
  }, [pendingSearch, setPendingSearch])

  // Listen for hero search events
  useEffect(() => {
    function onSearch(e: Event) {
      const detail = (e as CustomEvent<{ keyword?: string; location?: string }>).detail ?? {}
      if (detail.keyword !== undefined) setKeyword(detail.keyword)
      if (detail.location !== undefined) setLocation(detail.location || '')
      setPage(1)
    }
    document.addEventListener('seewee:job-search', onSearch)
    return () => document.removeEventListener('seewee:job-search', onSearch)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('limit', String(PAGE_SIZE))
      if (keyword.trim()) params.set('keyword', keyword.trim())
      if (location.trim()) params.set('location', location.trim())
      if (jobType !== 'all') params.set('jobType', jobType)
      if (workMode !== 'all') params.set('workMode', workMode)
      const exp = EXPERIENCE_PRESETS[experience] ?? {}
      if (exp.min !== undefined) params.set('minExperience', String(exp.min))
      if (exp.max !== undefined) params.set('maxExperience', String(exp.max))
      if (salaryMin !== 'any') params.set('minSalaryLpa', salaryMin)
      if (postedWithin !== 'any') params.set('postedWithin', postedWithin)
      if (sort !== 'recent') params.set('sort', sort)

      const res = await fetch(`/api/jobs?${params.toString()}`)
      const json: { data?: { jobs?: Job[]; total?: number }; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error)
      setJobs(json.data?.jobs ?? [])
      setTotal(json.data?.total ?? 0)
    } catch {
      setJobs([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [keyword, location, jobType, workMode, experience, salaryMin, postedWithin, sort, page])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilters =
    keyword.trim() ||
    location.trim() ||
    jobType !== 'all' ||
    workMode !== 'all' ||
    experience !== 'any' ||
    salaryMin !== 'any' ||
    postedWithin !== 'any'

  // --------------------------- saved search chips ------------------------
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  useEffect(() => setSavedSearches(loadSavedSearches()), [])

  const currentSignature = searchSignature({
    keyword,
    location,
    jobType,
    workMode,
    experience,
    salaryMin,
    postedWithin,
  })
  const alreadySaved = savedSearches.some((s) => searchSignature(s) === currentSignature)

  const persistSearches = (next: SavedSearch[]) => {
    try {
      window.localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable — chips stay in memory for this session */
    }
  }

  const saveCurrentSearch = () => {
    if (alreadySaved) {
      toast.info('This search is already saved')
      return
    }
    const label = [
      keyword.trim() || 'All roles',
      location.trim(),
      jobType !== 'all' ? jobType : '',
      workMode !== 'all' ? workMode : '',
      experience !== 'any' ? (EXPERIENCE_LABELS[experience] ?? experience) : '',
      salaryMin !== 'any' ? (SALARY_LABELS[salaryMin] ?? `${salaryMin} LPA+`) : '',
      postedWithin !== 'any' ? (POSTED_LABELS[postedWithin] ?? postedWithin) : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const entry: SavedSearch = {
      id: `ss-${Date.now().toString(36)}`,
      label,
      keyword: keyword.trim(),
      location: location.trim(),
      jobType,
      workMode,
      experience,
      salaryMin,
      postedWithin,
      sort,
    }
    let next = [entry, ...savedSearches]
    if (next.length > MAX_SAVED_SEARCHES) {
      next = next.slice(0, MAX_SAVED_SEARCHES)
      toast.info(`Keeping the ${MAX_SAVED_SEARCHES} most recent searches`)
    }
    setSavedSearches(next)
    persistSearches(next)
    toast.success(`Search saved — “${label}”`)
  }

  const applySavedSearch = (s: SavedSearch) => {
    setKeyword(s.keyword)
    setLocation(s.location)
    setJobType(s.jobType)
    setWorkMode(s.workMode)
    setExperience(s.experience ?? 'any')
    setSalaryMin(s.salaryMin ?? 'any')
    setPostedWithin(s.postedWithin ?? 'any')
    setSort(s.sort ?? 'recent')
    setPage(1)
  }

  const removeSavedSearch = (id: string) => {
    const next = savedSearches.filter((s) => s.id !== id)
    setSavedSearches(next)
    persistSearches(next)
    toast.success('Saved search removed')
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
      {/* Heading */}
      <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
            Browse jobs
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {loading ? 'Finding opportunities…' : `${total} live ${total === 1 ? 'opening' : 'openings'} waiting for you`}
          </p>
        </div>
        <CreateAlertInline keyword={keyword} location={location} />
      </div>

      {/* Filters */}
      <form
        role="search"
        aria-label="Filter jobs"
        className="mb-6 grid gap-3 rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 p-4 shadow-sm md:grid-cols-[1fr_1fr_auto_auto_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          setPage(1)
          void load()
        }}
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden />
          <Input
            aria-label="Keyword filter"
            placeholder="Role, skill or company…"
            className="h-11 pl-9"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden />
          <Input
            aria-label="Location filter"
            placeholder="City…"
            className="h-11 pl-9"
            value={location}
            onChange={(e) => {
              setLocation(e.target.value)
              setPage(1)
            }}
          />
        </div>
        <Select value={jobType} onValueChange={(v) => { setJobType(v); setPage(1) }}>
          <SelectTrigger aria-label="Job type filter" className="h-11 w-full md:w-[140px]">
            <SelectValue placeholder="Job type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="Full-time">Full-time</SelectItem>
            <SelectItem value="Part-time">Part-time</SelectItem>
            <SelectItem value="Contract">Contract</SelectItem>
            <SelectItem value="Internship">Internship</SelectItem>
          </SelectContent>
        </Select>
        <Select value={workMode} onValueChange={(v) => { setWorkMode(v); setPage(1) }}>
          <SelectTrigger aria-label="Work mode filter" className="h-11 w-full md:w-[130px]">
            <SelectValue placeholder="Work mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All modes</SelectItem>
            <SelectItem value="Remote">Remote</SelectItem>
            <SelectItem value="Hybrid">Hybrid</SelectItem>
            <SelectItem value="On-site">On-site</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" className="h-11 bg-blue-600 text-white hover:bg-blue-700">
          Search
        </Button>

        {/* Advanced filters: experience, salary floor, sort order */}
        <div className="flex flex-wrap items-end gap-3 md:col-span-2 lg:col-span-5">
          <div className="flex min-w-[160px] flex-1 flex-col gap-1 sm:flex-none">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <CalendarClock className="size-3" aria-hidden /> Experience
            </span>
            <Select
              value={experience}
              onValueChange={(v) => {
                setExperience(v)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Experience filter" className="h-10 w-full sm:w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(EXPERIENCE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-[150px] flex-1 flex-col gap-1 sm:flex-none">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <Wallet className="size-3" aria-hidden /> Salary
            </span>
            <Select
              value={salaryMin}
              onValueChange={(v) => {
                setSalaryMin(v)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Minimum salary filter" className="h-10 w-full sm:w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SALARY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-[140px] flex-1 flex-col gap-1 sm:flex-none">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <CalendarClock className="size-3" aria-hidden /> Posted
            </span>
            <Select
              value={postedWithin}
              onValueChange={(v) => {
                setPostedWithin(v)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Posted within filter" className="h-10 w-full sm:w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(POSTED_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex min-w-[190px] flex-1 flex-col gap-1 sm:flex-none">
            <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <ArrowUpDown className="size-3" aria-hidden /> Sort by
            </span>
            <Select
              value={sort}
              onValueChange={(v) => {
                setSort(v)
                setPage(1)
              }}
            >
              <SelectTrigger aria-label="Sort results" className="h-10 w-full sm:w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </form>

      {/* Saved search chips */}
      {(savedSearches.length > 0 || (hasFilters && !alreadySaved)) && (
        <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Saved searches">
          {savedSearches.map((s) => {
            const active = searchSignature(s) === currentSignature
            return (
              <span
                key={s.id}
                className={`inline-flex max-w-full items-center gap-0.5 rounded-full border py-0.5 pl-1 pr-1 text-xs font-medium shadow-sm transition-colors ${
                  active
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 dark:text-slate-300 hover:border-blue-300 hover:bg-blue-50 dark:hover:border-blue-700 dark:hover:bg-blue-950/40'
                }`}
              >
                <button
                  type="button"
                  onClick={() => applySavedSearch(s)}
                  aria-pressed={active}
                  title={`Apply “${s.label}”`}
                  className="flex min-h-[28px] items-center gap-1.5 rounded-full py-0.5 pl-1.5 pr-1 text-left"
                >
                  <Bookmark className={`size-3.5 shrink-0 ${active ? 'fill-white' : 'text-blue-500'}`} aria-hidden />
                  <span className="max-w-[220px] truncate">{s.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeSavedSearch(s.id)}
                  aria-label={`Remove saved search ${s.label}`}
                  title="Remove"
                  className={`grid size-6 shrink-0 place-items-center rounded-full transition-colors ${
                    active ? 'hover:bg-white/20' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            )
          })}
          {hasFilters && !alreadySaved && (
            <button
              type="button"
              onClick={saveCurrentSearch}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-dashed border-blue-300 bg-blue-50/60 dark:bg-blue-950/30 px-3 py-1 text-xs font-semibold text-blue-700 transition-colors hover:border-blue-400 hover:bg-blue-100 dark:hover:border-blue-700 dark:hover:bg-blue-950/40"
            >
              <BookmarkPlus className="size-3.5" aria-hidden /> Save this search
            </button>
          )}
        </div>
      )}

      {/* 📊 Opt-in salary insights — a dedicated page, never pushed inline.
          Deliberate click takes interested users to the full benchmark view. */}
      <button
        type="button"
        onClick={() => setView('insights')}
        aria-label="Open the salary insights page"
        className="group mb-6 flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50/40 px-4 py-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/20 dark:hover:bg-blue-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-sky-600 text-white shadow-sm">
            <TrendingUp className="size-4" aria-hidden />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
              Salary insights
            </span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
              Market pay bands by role — open the dedicated page any time
            </span>
          </span>
        </span>
        <ChevronRight
          className="size-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </button>

      {/* Results */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 dark:bg-slate-800/60 py-20 text-center">
          <SearchX className="mb-3 h-12 w-12 text-slate-300" aria-hidden />
          <h3 className="text-lg font-bold text-slate-700 dark:text-slate-300">No jobs found</h3>
          <p className="mt-1 max-w-sm text-sm text-slate-500 dark:text-slate-400">
            Try different keywords or clear the filters — new roles get posted every day.
          </p>
          {hasFilters && (
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setKeyword('')
                setLocation('')
                setJobType('all')
                setWorkMode('all')
                setExperience('any')
                setSalaryMin('any')
                setPostedWithin('any')
                setSort('recent')
                setPage(1)
              }}
            >
              <FilterX className="mr-2 h-4 w-4" /> Clear all filters
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {jobs.map((job) => {
              const myMatch =
                user?.role === 'CANDIDATE'
                  ? computeMatchScore(job.skills, user.skills)
                  : null
              return (
                <div
                  key={job.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openJob(job.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      openJob(job.id)
                    }
                  }}
                  aria-label={`Open job ${job.title} at ${job.company}`}
                  className="group relative flex min-h-[196px] cursor-pointer flex-col rounded-xl border border-slate-200 bg-white dark:bg-slate-900 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:border-blue-700"
                >
                  {myMatch != null && (
                    <span
                      className={`absolute right-16 top-4 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                        myMatch >= 70
                          ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/40'
                          : myMatch >= 40
                            ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/40'
                            : 'border-slate-300 bg-slate-50 dark:bg-slate-800/60'
                      } ${matchColor(myMatch)}`}
                    >
                      ⚡ {myMatch > 0 ? `${Math.round(myMatch)}% match` : 'Low match'}
                    </span>
                  )}
                  <div className="absolute right-4 top-3.5 z-10">
                    <SaveJobButton jobId={job.id} />
                  </div>
                  <div className="mb-3 flex items-center gap-3 pr-24">
                    <Avatar className="h-10 w-10">
                      {job.recruiter?.companyLogoData ? (
                         
                        <img
                          src={`data:${job.recruiter.companyLogoMime || 'image/png'};base64,${job.recruiter.companyLogoData}`}
                          alt={`${job.company} logo`}
                          className="size-full rounded-full object-cover"
                        />
                      ) : (
                        <AvatarFallback
                          className="bg-gradient-to-br from-blue-100 to-sky-100 text-sm font-bold text-blue-700"
                          style={
                            job.recruiter?.brandColor
                              ? { background: `${job.recruiter.brandColor}1a`, color: job.recruiter.brandColor }
                              : undefined
                          }
                        >
                          {job.company.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      )}
                    </Avatar>
                    <div className="min-w-0">
                      <h3 className="line-clamp-1 font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-700">
                        {job.title}
                      </h3>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation() // card click opens the job — don't double-trigger
                          setCompanyDialog(job.company)
                        }}
                        onKeyDown={(e) =>
                          e.stopPropagation() /* Enter/Space here shouldn't open the card's job */
                        }
                        title={`View all ${job.company} jobs`}
                        className="max-w-full cursor-pointer truncate rounded text-left text-xs text-slate-500 dark:text-slate-400 transition-colors hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      >
                        {job.company}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                      <span className="truncate">{job.location}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <BriefcaseBusiness className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                      {job.experienceMin}–{job.experienceMax} yrs
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <IndianRupee className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                      {formatLpa(job.salaryMinLpa, job.salaryMaxLpa)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500" />
                      {new Date(job.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    </span>
                  </div>

                  <div className="mt-auto pt-3">
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {skillsToArray(job.skills).slice(0, 4).map((s) => (
                        <Badge key={s} variant="secondary" className="rounded-full bg-slate-100 text-[11px] text-slate-600 dark:text-slate-400">
                          {s}
                        </Badge>
                      ))}
                    </div>

                    {/* ⚡ Easy Apply — one-tap application straight from the
                        result card (guests are routed to sign-in first) */}
                    {(!user || user.role === 'CANDIDATE') &&
                      (appliedIds.has(job.id) ? (
                        <div className="mb-2 flex h-9 items-center justify-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-[13px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-400">
                          <CheckCircle2 className="size-4" aria-hidden /> Applied
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          className="mb-2 h-9 w-full rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-[13px] font-bold text-white shadow-sm transition-all hover:from-amber-600 hover:to-orange-600 hover:shadow-md focus-visible:ring-amber-400"
                          onClick={(e) => {
                            e.stopPropagation() // card click would open the job dialog
                            if (!user) {
                              setAuthOpen(true)
                              toast.info('Sign in as a Job Seeker to easy apply ⚡')
                              return
                            }
                            setEasyApplyJob(job)
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          aria-label={`Easy apply to ${job.title} at ${job.company}`}
                        >
                          <Zap className="size-4" aria-hidden /> Easy Apply
                        </Button>
                      ))}

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="rounded-full text-[11px]">{job.jobType}</Badge>
                      <Badge className="rounded-full bg-sky-50 dark:bg-sky-950/40 text-[11px] text-sky-700">{job.workMode}</Badge>
                      {(job._count?.applications ?? 0) > 0 && (
                        <span className="ml-auto text-[11px] font-medium text-slate-400 dark:text-slate-500">
                          {job._count?.applications} applied · {job.openings} opening{job.openings > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <nav aria-label="Pagination" className="mt-8 flex items-center justify-center gap-2">
              <Button
                variant="outline"
                size="icon"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {[...Array(totalPages)].map((_, i) => (
                <Button
                  key={i}
                  variant={page === i + 1 ? 'default' : 'outline'}
                  size="sm"
                  className={page === i + 1 ? 'h-10 min-w-10 bg-blue-600 text-white' : 'h-10 min-w-10'}
                  onClick={() => setPage(i + 1)}
                  aria-current={page === i + 1 ? 'page' : undefined}
                >
                  {i + 1}
                </Button>
              ))}
              <Button
                variant="outline"
                size="icon"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </nav>
          )}
        </>
      )}

      {/* Company profile dialog — opened by clicking a company name on any job card */}
      <CompanyDialog company={companyDialog} onClose={() => setCompanyDialog(null)} />

      {/* ⚡ Easy apply — quick one-tap application confirmation */}
      <EasyApplyDialog
        job={easyApplyJob}
        onClose={() => setEasyApplyJob(null)}
        onApplied={(jobId) => setAppliedIds((prev) => new Set(prev).add(jobId))}
      />
    </div>
  )
}

/** Small header CTA — creates a job alert from the current keyword/location filters */
function CreateAlertInline({ keyword, location }: { keyword: string; location: string }) {
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const setView = useAppStore((s) => s.setView)
  const [busy, setBusy] = useState(false)

  const create = async () => {
    if (!user) {
      setAuthOpen(true)
      return
    }
    if (!keyword.trim() && !location.trim()) {
      toast.info('Type a keyword or location first — then hit the alert bell 🔔')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/job-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, keyword: keyword.trim(), location: location.trim() }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed')
      toast.success('🔔 Alert created! New matching jobs will show in your bell.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create alert')
    } finally {
      setBusy(false)
    }
  }

  if (user?.role === 'RECRUITER') {
    return (
      <Button
        variant="outline"
        onClick={() => setView('recruiter')}
        className="h-11 rounded-xl border-blue-200 dark:border-blue-900/70 px-4 font-medium text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 sm:h-10"
      >
        <BriefcaseBusiness className="size-4" aria-hidden /> Go to Hiring Hub
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      onClick={() => void create()}
      disabled={busy}
      className="h-11 rounded-xl border-blue-200 dark:border-blue-900/70 px-4 font-medium text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 sm:h-10"
    >
      <BellRing className={`size-4 ${busy ? 'animate-pulse' : ''}`} aria-hidden />
      Alert me about these jobs
    </Button>
  )
}

