'use client'

/**
 * TalentSearch — the SeeWe Talent Sourcing workspace (advanced Boolean + filter sourcing).
 *
 * A dedicated top-level recruiter tab (NOT part of the Interview Hub): a
 * permission-based CV-database search with
 *   • keyword + full Boolean query language (AND/OR/NOT/phrases/parens)
 *   • guided Boolean builder for non-technical users
 *   • 15+ structured filters fed by real stored data (skills, designation,
 *     experience, current/expected CTC, current/previous employer, industry,
 *     functional area, education, institute, notice, employment type,
 *     languages, freshness)
 *   • search-within-results, relevance/recency sorting, server-side
 *     pagination, facet counts, active-filter chips
 *   • candidate preview with contact reveal (logged + quota'd), sourcing
 *     status workflow, team assignment, follow-up reminders
 *   • saved searches + talent alerts, talent-pool folders, bulk actions,
 *     permission-gated CSV export, and a usage/quota dashboard
 *
 * DATA INTEGRITY: the demo database contains clearly-labelled synthetic
 * profiles (profileSource=SYNTHETIC_SEED, @synthetic.seewee.test emails).
 * Nothing here pretends to be real people.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Braces,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSearch,
  FileText,
  FlaskConical,
  Info,
  LayoutList,
  Loader2,
  Megaphone,
  Rows3,
  Search,
  Sparkles,
  Star,
  Tag,
  UserCog,
  X,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { SOURCING_STATUSES, SOURCING_STATUS_META, TALENT_QUOTAS } from '@/lib/talent-constants'
import { parseBooleanQuery } from '@/lib/talent-search-engine'
import { BooleanPanel, compileGuided } from './talent/BooleanPanel'
import { ActiveFilterChips, FilterRail } from './talent/FilterRail'
import { CandidateCard, type SkillBadgeLite, type JdMatchInfo } from './talent/CandidateCard'
import { CandidatePreview } from './talent/CandidatePreview'
import { SavedSearches } from './talent/SavedSearches'
import {
  TALENT_DEFAULT_FILTERS,
  SORT_OPTIONS,
  countActiveFilters,
  filtersToParams,
  savedQueryToFilters,
  type TalentCandidate,
  type TalentFacets,
  type TalentFilters,
  type SavedSearchRow,
  type TalentMeta,
} from './talent/talent-types'

/** A synthetic, brand-free sample JD so recruiters can feel the AI parser
 *  before pasting their own description. Matches the HR-domain seed pool. */
const SAMPLE_JD = `Senior HR Business Partner — People & Culture

We are looking for a Senior HR Business Partner to act as a strategic
partner to business leaders across our technology and operations groups.

Experience: 10–15 years in HR, with at least 5 years as an HR Business
Partner supporting senior leadership.

Must-have skills:
- Performance management and calibration cycles
- Compensation benchmarking and total rewards
- Organisation design and change management
- Employee relations and conflict resolution
- HR strategy and workforce planning

Good to have: HR analytics, engagement survey design, L&D coordination.

Responsibilities:
- Act as a trusted advisor to business leaders on org health and talent decisions
- Run the annual performance management and compensation cycle end to end
- Coach managers on employee relations and difficult conversations
- Lead change management for restructuring and growth programmes
- Translate business goals into an actionable HR strategy

Education: MBA or post-graduate degree in HR preferred. Location: Mumbai (hybrid).`

interface JobLite {
  id: string
  title: string
  company: string
}
interface TeammateLite {
  id: string
  name: string
  company?: string | null
}
interface FolderLite {
  id: string
  name: string
  memberCount: number
  memberUserIds: string[]
}
interface UsageRow {
  kind: string
  label: string
  used: number
  limit: number
}
interface UsageData {
  quotas: UsageRow[]
  recent: { id: string; kind: string; createdAt: string; meta?: string | null }[]
}

interface TalentAdRow {
  id: string
  company: string
  headline: string
  body: string
  ctaLabel: string
  ctaUrl: string
  accent: string
  kind: string
}

interface JdSearchInfo {
  jdParsed: {
    roleTitle: string
    minYears: number | null
    maxYears: number | null
    mustHaveSkills: string[]
    goodToHaveSkills: string[]
    responsibilities: string[]
    location: string
  }
  parseEngine: 'AI' | 'keyword'
  scanned: number
  screenedOut: number
  returned: number
  totalFit: number
  coreGateNote: string
}

type JdResultRow = TalentCandidate & {
  overall: number
  verdictLabel: string
  verdict: string
  matchedSkills: { skill: string; evidence: string }[]
  missingSkills: string[]
  roleDetail: string
  respCoverage: number | null
}

export function TalentSearch() {
  const user = useAppStore((s) => s.user)
  const recruiterId = user?.id ?? ''

  // ── filter state (draft edits + committed value that drives the query) ──
  const [filters, setFilters] = useState(TALENT_DEFAULT_FILTERS)
  const [committed, setCommitted] = useState(TALENT_DEFAULT_FILTERS)
  const [booleanOpen, setBooleanOpen] = useState(false)
  const [must, setMust] = useState('')
  const [anyOf, setAnyOf] = useState('')
  const [not, setNot] = useState('')

  // ── search mode + privacy gate ─────────────────────────────────────────
  // The candidate database stays HIDDEN until the recruiter runs their first
  // search — before that the panel shows search guidance + sponsored slots.
  const [mode, setMode] = useState<'keyword' | 'jd'>('keyword')
  const [armed, setArmed] = useState(false)
  const [jdText, setJdText] = useState('')
  const [jdLoading, setJdLoading] = useState(false)
  const [jdError, setJdError] = useState<string | null>(null)
  const [jdInfo, setJdInfo] = useState<JdSearchInfo | null>(null)
  const [jdResults, setJdResults] = useState<JdResultRow[]>([])
  const [jdLoc, setJdLoc] = useState('')
  const [jdMinExp, setJdMinExp] = useState('')
  const [jdMaxExp, setJdMaxExp] = useState('')
  const [jdMaxCtc, setJdMaxCtc] = useState('')
  const [jdMaxNotice, setJdMaxNotice] = useState('')
  const [ads, setAds] = useState<TalentAdRow[]>([])

  // ── results ──────────────────────────────────────────────────────────────
  const [results, setResults] = useState<TalentCandidate[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [facets, setFacets] = useState<TalentFacets | null>(null)
  const [booleanSummary, setBooleanSummary] = useState<string | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syntaxError, setSyntaxError] = useState<string | null>(null)
  const [withinIds, setWithinIds] = useState<string[]>([])
  const [withinInput, setWithinInput] = useState('')
  const [withinActive, setWithinActive] = useState(false)
  const [compactView, setCompactView] = useState(false)

  // ── reference data ───────────────────────────────────────────────────────
  const [meta, setMeta] = useState<TalentMeta | null>(null)
  const [badges, setBadges] = useState<Record<string, SkillBadgeLite[]>>({})
  const [sourcingByCandidate, setSourcingByCandidate] = useState<Record<string, string>>({})
  const [jobs, setJobs] = useState<JobLite[]>([])
  const [teammates, setTeammates] = useState<TeammateLite[]>([])
  const [folders, setFolders] = useState<FolderLite[]>([])
  const [saved, setSaved] = useState<SavedSearchRow[]>([])
  const [savedLoading, setSavedLoading] = useState(false)
  const [usage, setUsage] = useState<UsageData | null>(null)

  // ── selection / dialogs ──────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkMode, setBulkMode] = useState(false)
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null)
  const [folderPicker, setFolderPicker] = useState<{ ids: string[]; newMode: boolean } | null>(null)
  const [folderNewName, setFolderNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const armedRef = useRef(armed)
  armedRef.current = armed

  /* ───────────────────────── data loading ───────────────────────────── */

  const loadMeta = useCallback(async () => {
    if (!recruiterId) return
    try {
      const res = await fetch(`/api/talent/meta?recruiterId=${encodeURIComponent(recruiterId)}`)
      const json: { data?: TalentMeta; error?: string } = await res.json()
      if (res.ok && json.data) setMeta(json.data)
    } catch {
      /* non-critical */
    }
  }, [recruiterId])

  const loadSourcingMap = useCallback(async (ids: string[]) => {
    if (!recruiterId || ids.length === 0) return
    try {
      const res = await fetch(
        `/api/sourcing?recruiterId=${encodeURIComponent(recruiterId)}&candidateIds=${encodeURIComponent(ids.join(','))}`
      )
      const json: { data?: { candidateId: string; status: string }[] } = await res.json()
      const map: Record<string, string> = {}
      for (const row of json.data ?? []) map[row.candidateId] = row.status
      setSourcingByCandidate((prev) => ({ ...prev, ...map }))
    } catch {
      /* non-critical */
    }
  }, [recruiterId])

  const loadBadges = useCallback(async (ids: string[]) => {
    if (!recruiterId || ids.length === 0) return
    try {
      const res = await fetch(
        `/api/assessments?candidateIds=${encodeURIComponent(ids.slice(0, 100).join(','))}&badgesOnly=1&recruiterId=${encodeURIComponent(recruiterId)}`
      )
      const json: { byUser?: Record<string, SkillBadgeLite[]> } = await res.json()
      if (json.byUser) setBadges((prev) => ({ ...prev, ...json.byUser }))
    } catch {
      /* non-critical */
    }
  }, [recruiterId])

  const loadSideData = useCallback(async () => {
    if (!recruiterId) return
    try {
      const [jobsRes, matesRes, foldersRes, usageRes] = await Promise.all([
        fetch(`/api/jobs?recruiterId=${encodeURIComponent(recruiterId)}`),
        fetch(`/api/talent/teammates?recruiterId=${encodeURIComponent(recruiterId)}`),
        fetch(`/api/recruiters/folders?recruiterId=${encodeURIComponent(recruiterId)}`),
        fetch(`/api/talent/usage?recruiterId=${encodeURIComponent(recruiterId)}`),
      ])
      const jobsJson: { data?: { jobs?: JobLite[] } } = await jobsRes.json()
      setJobs(jobsJson.data?.jobs?.slice(0, 50) ?? [])
      const matesJson: { data?: TeammateLite[] } = await matesRes.json()
      setTeammates(matesJson.data ?? [])
      const foldersJson: { data?: FolderLite[] } = await foldersRes.json()
      setFolders(foldersJson.data ?? [])
      const usageJson: { data?: UsageData } = await usageRes.json()
      setUsage(usageJson.data ?? null)
    } catch {
      /* side data is non-critical */
    }
  }, [recruiterId])

  const loadSaved = useCallback(async () => {
    if (!recruiterId) return
    setSavedLoading(true)
    try {
      const res = await fetch(`/api/saved-searches?recruiterId=${encodeURIComponent(recruiterId)}`)
      const json: { data?: SavedSearchRow[] } = await res.json()
      setSaved(json.data ?? [])
    } catch {
      /* non-critical */
    } finally {
      setSavedLoading(false)
    }
  }, [recruiterId])

  /* ───────────────────────── search execution ───────────────────────── */

  const runSearch = useCallback(
    async (f: TalentFilters, targetPage: number, within: string[]) => {
      if (!recruiterId) return
      // client-side validation mirrors the server (no silent fallbacks)
      const q = f.booleanMode ? f.q.trim() : f.q.trim()
      if (q) {
        const parsed = parseBooleanQuery(q)
        if (!parsed.ok) {
          setSyntaxError(parsed.error.message)
          setError(null)
          setLoading(false)
          return
        }
      }
      setSyntaxError(null)
      setLoading(true)
      setError(null)
      try {
        const sp = filtersToParams(f, targetPage, within)
        sp.set('recruiterId', recruiterId)
        const res = await fetch(`/api/candidates?${sp.toString()}`)
        const json: {
          data?: TalentCandidate[]
          total?: number
          page?: number
          pages?: number
          facets?: TalentFacets
          booleanSummary?: string
          error?: string
          syntaxError?: { message: string }
        } = await res.json()
        if (!res.ok) {
          if (res.status === 400 && json.syntaxError) {
            setSyntaxError(json.syntaxError.message)
            setResults([])
            setTotal(0)
            setPages(1)
          } else {
            throw new Error(json.error || 'Search failed')
          }
          return
        }
        setResults(json.data ?? [])
        setTotal(json.total ?? 0)
        setPages(json.pages ?? 1)
        setPage(json.page ?? targetPage)
        setFacets(json.facets ?? null)
        setBooleanSummary(json.booleanSummary)
        const ids = (json.data ?? []).map((c) => c.id)
        loadBadges(ids)
        loadSourcingMap(ids)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Search failed')
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [recruiterId, loadBadges, loadSourcingMap]
  )

  // initial + committed-filter searches — NEVER before the first explicit
  // search (privacy: the database stays hidden until the recruiter acts)
  useEffect(() => {
    if (!recruiterId || !armedRef.current) return
    runSearch(committed, 1, withinIds)
  }, [committed, recruiterId])

  // Sourcing-engine behaviour: structured filter changes apply automatically
  // (debounced) — but only once the recruiter has run their first search.
  // The keyword box is the exception — it commits on Enter / Search button.
  useEffect(() => {
    const stripQ = (f: typeof filters) => JSON.stringify({ ...f, q: '' })
    if (!recruiterId || !armedRef.current) return
    if (stripQ(filters) === stripQ(committed)) return
    const t = setTimeout(() => setCommitted((prev) => ({ ...filtersRef.current, q: prev.q })), 600)
    return () => clearTimeout(t)
  }, [filters, committed, recruiterId])

  // Guided Boolean rows auto-compile into the query box AND auto-run (only
  // when the box holds the previous compilation or is empty — never clobbers
  // a raw query the recruiter typed themselves).
  const lastCompiledRef = useRef('')
  useEffect(() => {
    if (!booleanOpen) return
    const compiled = compileGuided(must, anyOf, not)
    if (!compiled) return
    armedRef.current = true
    setArmed(true)
    const q = filtersRef.current.q.trim()
    if (!q || q === lastCompiledRef.current) {
      lastCompiledRef.current = compiled
      setFilters((prev) => ({ ...prev, q: compiled }))
      const t = setTimeout(() => {
        setCommitted((prev) => ({ ...filtersRef.current, q: compiled }))
      }, 700)
      return () => clearTimeout(t)
    }
  }, [booleanOpen, must, anyOf, not])

  // sponsored landing slots (house + demo advertisers) for the pre-search panel
  useEffect(() => {
    let alive = true
    fetch('/api/talent/ads')
      .then((r) => r.json())
      .then((json: { data?: TalentAdRow[] }) => {
        if (alive) setAds(json.data ?? [])
      })
      .catch(() => {
        /* landing degrades gracefully without ads */
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!recruiterId) return
    loadMeta()
    loadSideData()
    loadSaved()
  }, [recruiterId, loadMeta, loadSideData, loadSaved])

  const commit = () => {
    armedRef.current = true
    setArmed(true)
    let next = { ...filters }
    if (booleanOpen) {
      const compiled = compileGuided(must, anyOf, not)
      if (compiled && !next.q.trim()) next.q = compiled
    }
    setCommitted(next)
  }

  const clearAll = () => {
    setFilters({ ...TALENT_DEFAULT_FILTERS })
    setCommitted({ ...TALENT_DEFAULT_FILTERS })
    setMust('')
    setAnyOf('')
    setNot('')
    setWithinIds([])
    setWithinActive(false)
    setWithinInput('')
    setSelected(new Set())
    // back to the private landing state — the database hides again
    armedRef.current = false
    setArmed(false)
    setMode('keyword')
    setJdResults([])
    setJdInfo(null)
    setJdError(null)
  }

  /* ───────────────── AI JD search — paste a JD, we find the CVs ───── */

  const runJdSearch = async () => {
    if (!jdText.trim()) {
      setJdError('Paste the job description first.')
      return
    }
    setJdLoading(true)
    setJdError(null)
    try {
      const payload: Record<string, unknown> = { recruiterId, jdText: jdText.trim() }
      const f: Record<string, unknown> = {}
      if (jdLoc.trim()) f.location = jdLoc.trim()
      if (jdMinExp && Number(jdMinExp) >= 0) f.minExperience = Number(jdMinExp)
      if (jdMaxExp && Number(jdMaxExp) > 0) f.maxExperience = Number(jdMaxExp)
      if (jdMaxCtc && Number(jdMaxCtc) > 0) f.maxExpectedCtc = Number(jdMaxCtc)
      if (jdMaxNotice && Number(jdMaxNotice) > 0) f.maxNoticeDays = Number(jdMaxNotice)
      if (Object.keys(f).length > 0) payload.filters = f
      const res = await fetch('/api/talent/jd-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json: { data?: JdSearchInfo & { results: JdResultRow[] }; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'JD search failed')
      const rows = json.data?.results ?? []
      setJdInfo(json.data ?? null)
      setJdResults(rows)
      const ids = rows.map((r) => r.id)
      loadBadges(ids)
      loadSourcingMap(ids)
      if (rows.length === 0) {
        toast.info('No profile passed the JD core — try widening the JD or removing overlays.')
      }
    } catch (err) {
      setJdError(err instanceof Error ? err.message : 'JD search failed')
      setJdResults([])
      setJdInfo(null)
    } finally {
      setJdLoading(false)
    }
  }

  /* ───────────────────────── saved searches ─────────────────────────── */

  const saveCurrentSearch = async (name: string, alert: string): Promise<boolean> => {
    try {
      const res = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId, name, query: JSON.stringify({ ...filtersRef.current, booleanMode: filtersRef.current.booleanMode }), alertFrequency: alert }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to save')
      toast.success('Search saved', { description: name })
      loadSaved()
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save search')
      return false
    }
  }

  const runSaved = (row: SavedSearchRow, _newIds: string[], _total: number) => {
    const f = savedQueryToFilters(row.query)
    armedRef.current = true
    setArmed(true)
    setMode('keyword')
    setFilters(f)
    setCommitted(f)
    setBooleanOpen(f.booleanMode)
    setWithinIds([])
    setWithinActive(false)
    setSelected(new Set())
    loadSaved()
  }

  /* ───────────────────────── folders / bulk ─────────────────────────── */

  const saveToFolder = async (folder: FolderLite, ids: string[]) => {
    if (ids.length === 0) return
    setBusy(true)
    let okCount = 0
    for (const id of ids) {
      try {
        const res = await fetch(`/api/recruiters/folders/${folder.id}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recruiterId, userId: id }),
        })
        if (res.ok) okCount++
      } catch {
        /* per-item failures counted */
      }
    }
    setBusy(false)
    setFolderPicker(null)
    setFolderNewName('')
    if (okCount === ids.length) {
      toast.success(`Saved ${okCount} candidate${okCount > 1 ? 's' : ''} to ${folder.name}`)
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folder.id
            ? { ...f, memberCount: f.memberCount + okCount, memberUserIds: [...new Set([...f.memberUserIds, ...ids])] }
            : f
        )
      )
      setSelected(new Set())
    } else if (okCount > 0) {
      toast.info(`${okCount}/${ids.length} saved (duplicates skipped)`)
    } else {
      toast.error('Could not save — check folder membership')
    }
  }

  const createFolderAndSave = async (name: string, ids: string[]) => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Give the folder a name first')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/recruiters/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId, name: trimmed }),
      })
      const json: { data?: { id: string; name: string }; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) {
        if (res.status === 409) {
          const existing = folders.find((f) => f.name.toLowerCase() === trimmed.toLowerCase())
          if (existing) {
            await saveToFolder(existing, ids)
            return
          }
        }
        throw new Error(json.error || 'Failed to create folder')
      }
      const created: FolderLite = { id: json.data.id, name: json.data.name, memberCount: 0, memberUserIds: [] }
      setFolders((prev) => [created, ...prev])
      await saveToFolder(created, ids)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create folder')
      setBusy(false)
    }
  }

  const bulkSetStatus = async (status: string) => {
    const ids = [...selected]
    if (ids.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/sourcing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId, candidateIds: ids, status }),
      })
      const json: { data?: { ok: boolean; error?: string }[]; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to update')
      const map = { ...sourcingByCandidate }
      for (const id of ids) map[id] = status
      setSourcingByCandidate(map)
      toast.success(`${ids.length} candidate${ids.length > 1 ? 's' : ''} → ${SOURCING_STATUS_META[status as keyof typeof SOURCING_STATUS_META]?.label || status}`)
      setSelected(new Set())
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setBusy(false)
    }
  }

  const exportCsv = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    setBusy(true)
    try {
      const res = await fetch('/api/sourcing/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId, candidateIds: ids }),
      })
      if (res.status === 429) {
        const json: { error?: string } = await res.json()
        throw new Error(json.error || 'Export limit reached')
      }
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `seewee-talent-export-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`Exported ${ids.length} candidates (contacts masked by policy)`)
      loadSideData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  const startWithin = async () => {
    const term = withinInput.trim().toLowerCase()
    if (!term) return
    // fetch all matching ids for the CURRENT filters (idsOnly mode)
    armedRef.current = true
    setArmed(true)
    setBusy(true)
    try {
      const sp = filtersToParams(committed, 1, [])
      sp.set('pageSize', '50')
      const ids: string[] = []
      let p = 1
      let pagesN = 1
      do {
        sp.set('page', String(p))
        const res = await fetch(`/api/candidates?${sp.toString()}`)
        const json: { data?: TalentCandidate[]; pages?: number; total?: number } = await res.json()
        if (!res.ok) throw new Error('Could not collect result set')
        ids.push(...(json.data ?? []).map((c) => c.id))
        pagesN = json.pages ?? 1
        p++
      } while (p <= pagesN && ids.length < 400)
      setWithinIds(ids)
      setWithinActive(true)
      // apply the within-term as the new keyword over the captured set
      const next = { ...committed, q: withinInput.trim() }
      setFilters(next)
      setCommitted(next)
      toast.info(`Searching within ${ids.length} results for “${withinInput.trim()}”`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Search within failed')
    } finally {
      setBusy(false)
    }
  }

  const activeCount = countActiveFilters(committed)
  const syntheticInResults = useMemo(
    () => results.some((r) => r.profileSource === 'SYNTHETIC_SEED'),
    [results]
  )

  const quickSearch = (term: string) => {
    const next = { ...TALENT_DEFAULT_FILTERS, q: term }
    armedRef.current = true
    setArmed(true)
    setFilters(next)
    setCommitted(next)
  }

  const AD_ACCENT: Record<string, string> = {
    teal: 'border-teal-200 from-teal-50 to-white dark:border-teal-900 dark:from-teal-950/40 dark:to-slate-900',
    amber: 'border-amber-200 from-amber-50 to-white dark:border-amber-900 dark:from-amber-950/40 dark:to-slate-900',
    rose: 'border-rose-200 from-rose-50 to-white dark:border-rose-900 dark:from-rose-950/40 dark:to-slate-900',
    slate: 'border-slate-200 from-slate-50 to-white dark:border-slate-700 dark:from-slate-800/60 dark:to-slate-900',
  }

  const adGrid =
    ads.length > 0 ? (
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          <Megaphone className="size-3" aria-hidden /> Sponsored spotlight · employer branding
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {ads.map((ad) => (
            <div
              key={ad.id}
              className={`flex flex-col rounded-xl border bg-gradient-to-br p-4 ${AD_ACCENT[ad.accent] ?? AD_ACCENT.teal}`}
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="truncate text-xs font-bold text-slate-800 dark:text-slate-100" title={ad.company}>
                  {ad.company}
                </p>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                    ad.kind === 'house'
                      ? 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                      : 'bg-slate-200/80 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                  }`}
                >
                  {ad.kind === 'house' ? 'SeeWe' : 'Sponsored'}
                </span>
              </div>
              <p className="text-[13px] font-semibold leading-snug text-slate-800 dark:text-slate-100">{ad.headline}</p>
              <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{ad.body}</p>
              <button
                type="button"
                className="mt-3 inline-flex items-center gap-1 self-start text-[11px] font-semibold text-teal-700 hover:underline dark:text-teal-300"
              >
                {ad.ctaLabel} <ArrowRight className="size-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </div>
    ) : null


  if (!user || user.role !== 'RECRUITER') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        Talent Search is available to recruiter accounts only.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* data lineage banner */}
      {syntheticInResults && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <FlaskConical className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <p>
            <strong>Demo database:</strong> most profiles here are clearly-labelled synthetic test data
            (email domain <code>@synthetic.seewee.test</code>) — never real candidates. Production deployments
            connect this same engine to the live candidate database.
          </p>
        </div>
      )}

      {/* ── search header ─────────────────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {/* mode switch: keyword · boolean vs AI JD search */}
        <div className="mb-2 flex flex-wrap items-center gap-2" role="tablist" aria-label="Search mode">
          <div className="flex overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'keyword'}
              onClick={() => setMode('keyword')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition ${
                mode === 'keyword'
                  ? 'bg-teal-600 text-white'
                  : 'bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Search className="size-3.5" aria-hidden /> Keyword / Boolean
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'jd'}
              onClick={() => setMode('jd')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold transition ${
                mode === 'jd'
                  ? 'bg-teal-600 text-white'
                  : 'bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              <Sparkles className="size-3.5" aria-hidden /> AI JD match
            </button>
          </div>
          <span className="hidden text-[10px] text-slate-400 sm:inline">
            {mode === 'keyword'
              ? 'Search the database by keywords, Boolean logic and filters.'
              : 'Paste a job description — the engine reads it and finds the matching CVs for you.'}
          </span>
        </div>

        {mode === 'keyword' ? (
          <>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              value={filters.q}
              onChange={(e) => setFilters((prev) => ({ ...prev, q: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && commit()}
              placeholder={filters.booleanMode ? 'Boolean: ("Plant Head" OR OEE) AND SAP NOT intern' : 'Search name, skills, company, resume…'}
              className="h-11 pl-9 pr-24 text-sm"
              aria-label="Keyword search"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2">
              {booleanOpen && (
                <Badge variant="outline" className="mr-1 border-teal-300 bg-teal-50 text-[10px] text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                  <Braces className="mr-0.5 inline size-3" aria-hidden /> BOOL
                </Badge>
              )}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              className="h-9 gap-1.5 bg-teal-600 px-5 text-xs font-semibold text-white hover:bg-teal-700"
              onClick={commit}
              aria-label="Run search"
            >
              <Search className="size-3.5" aria-hidden /> Search
            </Button>
            <SavedSearches
              saved={saved}
              loading={savedLoading}
              recruiterId={recruiterId}
              onLoad={() => undefined}
              onRefresh={loadSaved}
              saveCurrent={saveCurrentSearch}
              onRun={runSaved}
            />
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="Usage & quotas">
                  <BarChart3 className="size-4" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-3">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">Today&apos;s sourcing usage</p>
                <p className="mb-2 text-[10px] text-slate-400">Server-enforced quotas reset at midnight.</p>
                {usage ? (
                  <ul className="space-y-1.5">
                    {usage.quotas.map((q) => (
                      <li key={q.kind} className="text-[11px]">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-600 dark:text-slate-300">{q.label}</span>
                          <span className={`font-semibold ${q.used >= q.limit ? 'text-rose-600' : 'text-slate-700 dark:text-slate-200'}`}>
                            {q.used}/{q.limit}
                          </span>
                        </div>
                        <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className={`h-full rounded-full ${q.used >= q.limit ? 'bg-rose-500' : q.used / q.limit > 0.7 ? 'bg-amber-500' : 'bg-teal-500'}`}
                            style={{ width: `${Math.min(100, (q.used / q.limit) * 100)}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-400">Loading…</p>
                )}
                <p className="mt-2 border-t border-slate-100 pt-2 text-[10px] text-slate-400 dark:border-slate-800">
                  Contact reveals are individually logged. Resume downloads and bulk exports are permission-gated.
                </p>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <div className="mt-2">
          <BooleanPanel
            enabled={booleanOpen}
            onToggle={(on) => {
              setBooleanOpen(on)
              if (!on) return
              // prefill guided rows from a current raw query is not reversible — start clean
            }}
            rawQuery={filters.q}
            onRawQuery={(q) => setFilters((prev) => ({ ...prev, q }))}
            must={must}
            anyOf={anyOf}
            not={not}
            onMust={setMust}
            onAnyOf={setAnyOf}
            onNot={setNot}
          />
        </div>
          </>
        ) : (
          /* ── AI JD match panel ─────────────────────────────────────── */
          <div className="space-y-2.5">
            <Textarea
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              placeholder={'Paste the full job description here…\n\nThe parser extracts the role title, must-have skills, responsibilities and experience band, then ranks every CV in the database against them.'}
              className="min-h-[160px] text-sm"
              aria-label="Job description text"
            />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Optional overlays</span>
              <Input value={jdLoc} onChange={(e) => setJdLoc(e.target.value)} placeholder="Location" className="h-8 w-28 text-[11px]" aria-label="JD search location filter" />
              <Input value={jdMinExp} onChange={(e) => setJdMinExp(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Min yrs" className="h-8 w-20 text-[11px]" aria-label="JD search minimum experience" />
              <Input value={jdMaxExp} onChange={(e) => setJdMaxExp(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Max yrs" className="h-8 w-20 text-[11px]" aria-label="JD search maximum experience" />
              <Input value={jdMaxCtc} onChange={(e) => setJdMaxCtc(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Max CTC LPA" className="h-8 w-24 text-[11px]" aria-label="JD search maximum CTC" />
              <Input value={jdMaxNotice} onChange={(e) => setJdMaxNotice(e.target.value.replace(/[^0-9]/g, ''))} placeholder="Max notice days" className="h-8 w-28 text-[11px]" aria-label="JD search maximum notice days" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                className="h-9 gap-1.5 bg-teal-600 px-5 text-xs font-semibold text-white hover:bg-teal-700"
                onClick={runJdSearch}
                disabled={jdLoading || !jdText.trim()}
                aria-label="Find matching CVs"
              >
                {jdLoading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Sparkles className="size-3.5" aria-hidden />}
                Find matching CVs
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-1.5 px-3 text-xs"
                onClick={() => {
                  setJdText(SAMPLE_JD)
                  setJdError(null)
                }}
                disabled={jdLoading}
                aria-label="Load a sample job description"
              >
                <FileText className="size-3.5" aria-hidden /> Try a sample JD
              </Button>
              <p className="text-[10px] text-slate-400">
                Role · skills · responsibilities decide the match. Experience and location are boosters — they can never rescue a core mismatch.
              </p>
            </div>
            {jdError && (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {jdError}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── landing (pre-search): the database stays private until the first search ── */}
      {mode === 'keyword' && !armed && (
        <section className="space-y-4" aria-label="Search landing">
          <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 text-center dark:border-slate-800 dark:from-slate-900 dark:to-slate-900">
            <FileSearch className="mx-auto mb-3 size-10 text-teal-600 dark:text-teal-400" aria-hidden />
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Search the CV database</h2>
            <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Candidate profiles stay private until you run a search. Use the keyword bar, the guided
              Boolean builder, or switch to <strong className="text-teal-700 dark:text-teal-300">AI JD match</strong> and
              let the engine read a full job description for you.
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Try:</span>
              {[
                '("Maintenance Manager" OR "Plant Head") AND OEE NOT intern',
                'React Node "team lead"',
                'WMS fulfilment Mumbai',
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => quickSearch(s)}
                  className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 transition hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-teal-600 dark:hover:text-teal-300"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {adGrid}
        </section>
      )}

      {/* ── JD mode: parsed-JD summary + ranked CVs, or the pre-search prompt ── */}
      {mode === 'jd' && (
        <section className="space-y-2.5" aria-label="JD search results">
          {jdInfo && (
            <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-900 dark:bg-teal-950/30">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge className="bg-teal-600 text-[10px] text-white">JD read by {jdInfo.parseEngine === 'AI' ? 'AI parser' : 'keyword parser'}</Badge>
                {jdInfo.jdParsed.roleTitle && <Badge variant="outline" className="border-teal-300 text-[10px] text-teal-800 dark:border-teal-700 dark:text-teal-300">Role: {jdInfo.jdParsed.roleTitle}</Badge>}
                {jdInfo.jdParsed.minYears !== null && (
                  <Badge variant="outline" className="border-teal-300 text-[10px] text-teal-800 dark:border-teal-700 dark:text-teal-300">
                    Exp: {jdInfo.jdParsed.minYears}
                    {jdInfo.jdParsed.maxYears !== null ? `–${jdInfo.jdParsed.maxYears}` : '+'} yrs
                  </Badge>
                )}
                {jdInfo.jdParsed.location && <Badge variant="outline" className="border-teal-300 text-[10px] text-teal-800 dark:border-teal-700 dark:text-teal-300">Loc: {jdInfo.jdParsed.location}</Badge>}
                {jdInfo.jdParsed.mustHaveSkills.slice(0, 6).map((s) => (
                  <span key={s} className="rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">{s}</span>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                <strong>{jdInfo.totalFit}</strong> of <strong>{jdInfo.scanned}</strong> profiles matched the JD core
                {' · '}{jdInfo.screenedOut} screened out (role/skills/responsibilities did not match)
                {' · '}{jdInfo.returned} shown, best first.
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">{jdInfo.coreGateNote}</p>
            </div>
          )}

          {jdLoading && (
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex gap-3">
                    <Skeleton className="size-11 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!jdLoading && jdResults.length > 0 && (
            <div className="space-y-2.5">
              {jdResults.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  badges={badges[c.id] ?? []}
                  sourcingStatus={sourcingByCandidate[c.id]}
                  jdMatch={{
                    percent: c.overall,
                    verdictLabel: c.verdictLabel,
                    matched: c.matchedSkills.map((m) => m.skill),
                    missing: c.missingSkills,
                    roleDetail: c.roleDetail,
                  }}
                  onView={() => setPreview({ id: c.id, name: c.name })}
                  onSaveToFolder={() => setFolderPicker({ ids: [c.id], newMode: false })}
                  onTrack={() => setPreview({ id: c.id, name: c.name })}
                />
              ))}
            </div>
          )}

          {!jdLoading && !jdInfo && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
              <Sparkles className="mx-auto mb-2 size-8 text-teal-500" aria-hidden />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Paste a JD above — the engine finds the CVs</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                Every profile is scored on role fit, must-have skills and responsibilities. Profiles that miss
                the JD core are excluded even if their experience or location looks right — no fallback matching.
              </p>
            </div>
          )}

          {!jdLoading && jdInfo && jdResults.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
              <Search className="mx-auto mb-2 size-8 text-slate-300" aria-hidden />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">No profile passed the JD core</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
                {jdInfo.screenedOut} profiles were screened out because the role, skills or responsibilities did not
                match. Try softening the must-have list or removing the optional overlays.
              </p>
            </div>
          )}

          {!jdLoading && adGrid}
        </section>
      )}

      {/* ── body: rail + results (keyword mode, after the first search) ── */}
      {mode === 'keyword' && armed && (
      <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <FilterRail filters={filters} setFilters={setFilters} meta={meta} onClearAll={clearAll} />
        </aside>

        <section className="min-w-0 space-y-2.5" aria-live="polite">
          {/* toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ActiveFilterChips filters={committed} setFilters={(updater) => setCommitted(updater)} onClearAll={clearAll} />
            <div className="flex items-center gap-1.5">
              {booleanSummary && (
                <span className="hidden max-w-[280px] truncate rounded-full bg-teal-50 px-2.5 py-1 text-[10px] font-medium text-teal-700 dark:bg-teal-950/50 dark:text-teal-300 xl:inline" title={booleanSummary}>
                  {booleanSummary}
                </span>
              )}
              <span className="text-xs text-slate-500">
                <strong className="text-slate-800 dark:text-slate-100">{total.toLocaleString()}</strong> candidate{total === 1 ? '' : 's'}
                {activeCount > 0 && <span className="text-slate-400"> · {activeCount} filter{activeCount > 1 ? 's' : ''}</span>}
              </span>
              <Select value={committed.sort || 'auto'} onValueChange={(v) => {
                const next = { ...committed, sort: v }
                setFilters(next)
                setCommitted(next)
              }}>
                <SelectTrigger className="h-8 w-[150px] text-[11px]" aria-label="Sort results">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => setCompactView(true)}
                  className={`px-1.5 py-1.5 ${compactView ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800'}`}
                  aria-label="Compact view"
                  aria-pressed={compactView}
                >
                  <LayoutList className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setCompactView(false)}
                  className={`px-1.5 py-1.5 ${!compactView ? 'bg-teal-600 text-white' : 'bg-white text-slate-500 hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800'}`}
                  aria-label="Detailed view"
                  aria-pressed={!compactView}
                >
                  <Rows3 className="size-3.5" aria-hidden />
                </button>
              </div>
              <Button
                type="button"
                variant={bulkMode ? 'default' : 'outline'}
                className={`h-8 gap-1 text-[11px] ${bulkMode ? 'bg-teal-600 text-white hover:bg-teal-700' : ''}`}
                onClick={() => {
                  setBulkMode((b) => !b)
                  setSelected(new Set())
                }}
                aria-pressed={bulkMode}
              >
                <Tag className="size-3" aria-hidden /> Bulk select
              </Button>
            </div>
          </div>

          {/* search-within-results */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-slate-800/50">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Search within results</span>
            {withinActive ? (
              <>
                <Badge className="bg-teal-100 text-[10px] text-teal-700 dark:bg-teal-900/60 dark:text-teal-300">
                  narrowed to {withinIds.length} profiles
                </Badge>
                <button
                  type="button"
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium text-rose-500 hover:underline"
                  onClick={() => {
                    setWithinIds([])
                    setWithinActive(false)
                    setWithinInput('')
                    runSearch(committed, 1, [])
                  }}
                >
                  <X className="size-3" aria-hidden /> exit
                </button>
              </>
            ) : (
              <>
                <Input
                  value={withinInput}
                  onChange={(e) => setWithinInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && startWithin()}
                  placeholder="add a keyword to narrow these results…"
                  className="h-7 w-56 bg-white text-[11px] dark:bg-slate-900"
                  aria-label="Search within results"
                />
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={startWithin} disabled={busy || !withinInput.trim()}>
                  Narrow
                </Button>
              </>
            )}
          </div>

          {/* syntax error state */}
          {syntaxError && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <p className="font-semibold">Boolean syntax error</p>
                <p>{syntaxError}</p>
                <p className="mt-1 text-[11px] opacity-80">
                  Fix the query above, or switch off Boolean mode for plain keyword search.
                </p>
              </div>
            </div>
          )}

          {/* error state */}
          {error && !syntaxError && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
              <span className="flex items-center gap-2">
                <AlertTriangle className="size-4" aria-hidden /> {error}
              </span>
              <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => runSearch(committed, page, withinIds)}>
                Retry
              </Button>
            </div>
          )}

          {/* loading state */}
          {loading && (
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                  <div className="flex gap-3">
                    <Skeleton className="size-11 rounded-lg" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-2/3" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* no-results / empty state */}
          {!loading && !error && !syntaxError && results.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900">
              <Search className="mx-auto mb-2 size-8 text-slate-300" aria-hidden />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                {total === 0 && (activeCount > 0 || committed.q) ? 'No candidates match these criteria' : 'Start your candidate search'}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
                {total === 0 && (activeCount > 0 || committed.q)
                  ? 'Loosen a filter or clear the keyword — the database updates in real time as candidates join and update profiles.'
                  : 'Use the keyword bar, Boolean builder, or the filter rail to find talent. Every search runs against the live permission-based database.'}
              </p>
              {(activeCount > 0 || committed.q) && (
                <Button type="button" variant="outline" size="sm" className="mt-3 text-xs" onClick={clearAll}>
                  Clear all filters
                </Button>
              )}
            </div>
          )}

          {/* bulk action bar */}
          {!loading && bulkMode && selected.size > 0 && (
            <div className="sticky top-1 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-xs dark:border-teal-800 dark:bg-teal-950/50">
              <span className="font-semibold text-teal-800 dark:text-teal-300">{selected.size} selected</span>
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={() => setFolderPicker({ ids: [...selected], newMode: false })} disabled={busy}>
                <Star className="size-3" aria-hidden /> Save to folder
              </Button>
              <Select onValueChange={(v) => v && bulkSetStatus(v)}>
                <SelectTrigger className="h-7 w-[130px] text-[11px]" aria-label="Bulk set sourcing status">
                  <SelectValue placeholder="Set status…" />
                </SelectTrigger>
                <SelectContent>
                  {SOURCING_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SOURCING_STATUS_META[s].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-[11px]" onClick={exportCsv} disabled={busy}>
                <Download className="size-3" aria-hidden /> Export CSV
              </Button>
              <span className="text-[10px] text-slate-500">
                export caps at {TALENT_QUOTAS.EXPORT_ROWS} rows/day · contacts stay masked
              </span>
              <button type="button" className="ml-auto text-[11px] font-medium text-slate-500 hover:text-slate-800" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </div>
          )}

          {/* results */}
          {!loading && results.length > 0 && (
            <div className="space-y-2.5">
              {results.map((c) => (
                <CandidateCard
                  key={c.id}
                  candidate={c}
                  badges={badges[c.id] ?? []}
                  sourcingStatus={sourcingByCandidate[c.id]}
                  compact={compactView}
                  selected={selected.has(c.id)}
                  busy={busy}
                  onSelect={bulkMode ? (checked) => setSelected((prev) => {
                    const next = new Set(prev)
                    if (checked) next.add(c.id)
                    else next.delete(c.id)
                    return next
                  }) : undefined}
                  onView={() => setPreview({ id: c.id, name: c.name })}
                  onSaveToFolder={() => setFolderPicker({ ids: [c.id], newMode: false })}
                  onTrack={() => setPreview({ id: c.id, name: c.name })}
                />
              ))}

              {/* pagination */}
              {pages > 1 && (
                <nav className="flex items-center justify-center gap-1.5 pt-2" aria-label="Pagination">
                  <Button type="button" variant="outline" size="icon" className="size-8" disabled={page <= 1} onClick={() => runSearch(committed, page - 1, withinIds)} aria-label="Previous page">
                    <ChevronLeft className="size-4" aria-hidden />
                  </Button>
                  {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
                    const start = Math.max(1, Math.min(page - 3, pages - 6))
                    return start + i
                  })
                    .filter((p) => p >= 1 && p <= pages)
                    .map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => runSearch(committed, p, withinIds)}
                        className={`size-8 rounded-md text-xs font-semibold transition ${
                          p === page
                            ? 'bg-teal-600 text-white'
                            : 'border border-slate-200 bg-white text-slate-600 hover:border-teal-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                        aria-current={p === page ? 'page' : undefined}
                      >
                        {p}
                      </button>
                    ))}
                  <Button type="button" variant="outline" size="icon" className="size-8" disabled={page >= pages} onClick={() => runSearch(committed, page + 1, withinIds)} aria-label="Next page">
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                  <span className="ml-1 text-[11px] text-slate-400">
                    page {page} of {pages}
                  </span>
                </nav>
              )}
            </div>
          )}
        </section>
      </div>
      )}

      {/* folder picker popover (anchored to a fixed bottom sheet) */}
      {folderPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center" role="dialog" aria-label="Save to folder">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-bold">
                Save {folderPicker.ids.length > 1 ? `${folderPicker.ids.length} candidates` : 'candidate'} to folder
              </p>
              <button type="button" onClick={() => setFolderPicker(null)} aria-label="Close" className="text-slate-400 hover:text-slate-700">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="max-h-52 space-y-1 overflow-y-auto [scrollbar-width:thin]">
              {folders.map((f) => {
                const already = folderPicker.ids.every((id) => f.memberUserIds.includes(id))
                return (
                  <button
                    key={f.id}
                    type="button"
                    disabled={busy || already}
                    onClick={() => saveToFolder(f, folderPicker.ids)}
                    className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-left text-xs hover:border-teal-300 hover:bg-teal-50/50 disabled:opacity-40 dark:border-slate-800 dark:hover:bg-teal-950/30"
                  >
                    <span className="font-medium">{f.name}</span>
                    <span className="text-[10px] text-slate-400">{already ? 'added' : `${f.memberCount} saved`}</span>
                  </button>
                )
              })}
              {folders.length === 0 && <p className="py-2 text-center text-xs text-slate-400">No folders yet — create one below.</p>}
            </div>
            <div className="mt-3 flex items-center gap-1.5 border-t border-slate-100 pt-3 dark:border-slate-800">
              <Input value={folderNewName} onChange={(e) => setFolderNewName(e.target.value)} placeholder="New folder name (job, client, role…)" className="h-8 flex-1 text-xs" aria-label="New folder name" />
              <Button type="button" size="sm" className="h-8 bg-teal-600 px-3 text-[11px] text-white hover:bg-teal-700" onClick={() => createFolderAndSave(folderNewName, folderPicker.ids)} disabled={busy || !folderNewName.trim()}>
                {busy ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Star className="size-3" aria-hidden />} Create & save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* candidate preview — keyed so "Similar candidates → View profile"
          remounts the dialog onto the new candidate (fresh state, no leaks) */}
      {preview && (
        <CandidatePreview
          key={preview.id}
          candidateId={preview.id}
          candidateName={preview.name}
          recruiterId={recruiterId}
          jobs={jobs}
          teammates={teammates}
          onClose={() => setPreview(null)}
          onSourcingChanged={() => loadSourcingMap(results.map((r) => r.id))}
          onOpenCandidate={(id, name) => setPreview({ id, name })}
        />
      )}
    </div>
  )
}
