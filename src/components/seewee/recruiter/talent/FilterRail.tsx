'use client'

/**
 * FilterRail — the left filter sidebar. Every section maps to a
 * real server-side filter (see /api/candidates). Sections with data-backed
 * option lists (industry, functional area, employers, languages) are fed by
 * GET /api/talent/meta so only filters that can actually match are offered.
 */

import { useState } from 'react'
import { ChevronDown, Filter, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  EMPLOYMENT_TYPE_OPTIONS,
  LAST_ACTIVE_OPTIONS,
  NOTICE_OPTIONS,
  UPDATED_OPTIONS,
  countActiveFilters,
  type TalentFilters,
  type TalentMeta,
} from './talent-types'

interface FilterRailProps {
  filters: TalentFilters
  setFilters: (updater: (prev: TalentFilters) => TalentFilters) => void
  meta: TalentMeta | null
  onClearAll: () => void
}

function Section({
  title,
  children,
  defaultOpen = true, // every filter is VISIBLE by default —
  count = 0,          // recruiters see exactly what they can filter on. Each
}: {                   // section stays collapsible for focus, but nothing hides.
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  count?: number
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-slate-100 py-2.5 last:border-0 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-700 dark:text-slate-200">
          {title}
          {count > 0 && (
            <span className="rounded-full bg-teal-100 px-1.5 text-[10px] font-bold text-teal-700 dark:bg-teal-900/60 dark:text-teal-300">
              {count}
            </span>
          )}
        </span>
        <ChevronDown className={`size-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  )
}

export function FilterRail({ filters, setFilters, meta, onClearAll }: FilterRailProps) {
  const set = (key: keyof TalentFilters) => (v: string) =>
    setFilters((prev) => ({ ...prev, [key]: v }))

  const active = countActiveFilters(filters)

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
        <span className="flex items-center gap-1.5 text-sm font-bold text-slate-800 dark:text-slate-100">
          <SlidersHorizontal className="size-4 text-teal-600" aria-hidden /> Filters
          {active > 0 && (
            <Badge className="bg-teal-600 px-1.5 text-[10px] text-white">{active}</Badge>
          )}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px] text-slate-500 hover:text-rose-600"
          onClick={onClearAll}
          disabled={active === 0}
        >
          <RotateCcw className="size-3" aria-hidden /> Clear all
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-1 [scrollbar-width:thin] max-h-[calc(100vh-330px)]">
        <Section title="Key skills" defaultOpen count={Number(!!filters.skillsMandatory) + Number(!!filters.skillsPreferred) + Number(!!filters.skillsExcluded)}>
          <div className="space-y-1">
            <Label className="text-[11px] text-slate-500">Mandatory (ALL of, comma separated)</Label>
            <Input value={filters.skillsMandatory} onChange={(e) => set('skillsMandatory')(e.target.value)} placeholder="react, redux" className="h-8 text-xs" aria-label="Mandatory skills" />
            <Label className="text-[11px] text-slate-500">Preferred (ANY of)</Label>
            <Input value={filters.skillsPreferred} onChange={(e) => set('skillsPreferred')(e.target.value)} placeholder="next.js, graphql" className="h-8 text-xs" aria-label="Preferred skills" />
            <Label className="text-[11px] text-slate-500">Exclude skills</Label>
            <Input value={filters.skillsExcluded} onChange={(e) => set('skillsExcluded')(e.target.value)} placeholder="php, drupal" className="h-8 text-xs" aria-label="Skills to exclude" />
            <p className="text-[10px] leading-snug text-slate-400">Token matching — &quot;Java&quot; will not match &quot;JavaScript&quot;.</p>
          </div>
        </Section>

        <Section title="Designation" count={filters.designation ? 1 : 0}>
          <Input value={filters.designation} onChange={(e) => set('designation')(e.target.value)} placeholder='e.g. "Maintenance Manager" or SDE' className="h-8 text-xs" aria-label="Designation" />
          <p className="text-[10px] text-slate-400">Matches current designation & headline; common synonyms (SDE ↔ Software Engineer) included.</p>
        </Section>

        <Section title="Experience (years)" count={Number(!!filters.minExperience) + Number(!!filters.maxExperience)}>
          <div className="flex items-center gap-2">
            <Input type="number" min={0} max={60} value={filters.minExperience} onChange={(e) => set('minExperience')(e.target.value)} placeholder="Min" className="h-8 text-xs" aria-label="Minimum experience" />
            <span className="text-xs text-slate-400">to</span>
            <Input type="number" min={0} max={60} value={filters.maxExperience} onChange={(e) => set('maxExperience')(e.target.value)} placeholder="Max" className="h-8 text-xs" aria-label="Maximum experience" />
          </div>
          <div className="flex flex-wrap gap-1">
            {[
              ['0', '3', 'Fresher 0-3'],
              ['3', '7', 'Mid 3-7'],
              ['7', '12', 'Senior 7-12'],
              ['12', '', '12+'],
            ].map(([min, max, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => setFilters((prev) => ({ ...prev, minExperience: min, maxExperience: max }))}
                className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:text-slate-400"
              >
                {label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Salary / CTC (LPA)" count={Number(!!filters.minCTC) + Number(!!filters.maxCTC) + Number(!!filters.minCurrentCTC) + Number(!!filters.maxCurrentCTC)}>
          <Label className="text-[11px] text-slate-500">Expected CTC</Label>
          <div className="flex items-center gap-2">
            <Input type="number" min={0} value={filters.minCTC} onChange={(e) => set('minCTC')(e.target.value)} placeholder="Min" className="h-8 text-xs" aria-label="Minimum expected CTC" />
            <span className="text-xs text-slate-400">to</span>
            <Input type="number" min={0} value={filters.maxCTC} onChange={(e) => set('maxCTC')(e.target.value)} placeholder="Max" className="h-8 text-xs" aria-label="Maximum expected CTC" />
          </div>
          <Label className="text-[11px] text-slate-500">Current CTC</Label>
          <div className="flex items-center gap-2">
            <Input type="number" min={0} value={filters.minCurrentCTC} onChange={(e) => set('minCurrentCTC')(e.target.value)} placeholder="Min" className="h-8 text-xs" aria-label="Minimum current CTC" />
            <span className="text-xs text-slate-400">to</span>
            <Input type="number" min={0} value={filters.maxCurrentCTC} onChange={(e) => set('maxCurrentCTC')(e.target.value)} placeholder="Max" className="h-8 text-xs" aria-label="Maximum current CTC" />
          </div>
        </Section>

        <Section title="Location" count={filters.locations ? 1 : 0}>
          <Input value={filters.locations} onChange={(e) => set('locations')(e.target.value)} placeholder="Bengaluru, Pune, Remote" className="h-8 text-xs" aria-label="Locations" />
          {meta && meta.locations.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {meta.locations.slice(0, 8).map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() =>
                    setFilters((prev) => {
                      const parts = prev.locations.split(',').map((s) => s.trim()).filter(Boolean)
                      const next = parts.includes(l.value) ? parts.filter((p) => p !== l.value) : [...parts, l.value]
                      return { ...prev, locations: next.join(', ') }
                    })
                  }
                  className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                    filters.locations.toLowerCase().includes(l.value.toLowerCase())
                      ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300'
                      : 'border-slate-200 text-slate-500 hover:border-teal-400 dark:border-slate-700'
                  }`}
                >
                  {l.value} ({l.count})
                </button>
              ))}
            </div>
          )}
          <p className="text-[10px] text-slate-400">Also matches preferred / desired locations.</p>
        </Section>

        <Section title="Industry" count={filters.industry ? 1 : 0}>
          <Select value={filters.industry || 'any'} onValueChange={(v) => set('industry')(v === 'any' ? '' : v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Industry">
              <SelectValue placeholder="Any industry" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any industry</SelectItem>
              {(meta?.industries ?? []).map((i) => (
                <SelectItem key={i.value} value={i.value}>
                  {i.value} ({i.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section title="Functional area" count={filters.functionalArea ? 1 : 0}>
          <Select value={filters.functionalArea || 'any'} onValueChange={(v) => set('functionalArea')(v === 'any' ? '' : v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Functional area">
              <SelectValue placeholder="Any functional area" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any functional area</SelectItem>
              {(meta?.functionalAreas ?? []).map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.value} ({f.count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section title="Employers" count={Number(!!filters.employerCurrent) + Number(!!filters.employerPrevious)}>
          <Label className="text-[11px] text-slate-500">Current employer</Label>
          <Input value={filters.employerCurrent} onChange={(e) => set('employerCurrent')(e.target.value)} placeholder="company name" className="h-8 text-xs" aria-label="Current employer" />
          <Label className="text-[11px] text-slate-500">Previous employer</Label>
          <Input value={filters.employerPrevious} onChange={(e) => set('employerPrevious')(e.target.value)} placeholder="company name" className="h-8 text-xs" aria-label="Previous employer" />
          {meta && meta.employers.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {meta.employers.slice(0, 6).map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setFilters((prev) => ({ ...prev, employerPrevious: c.value }))}
                  className="max-w-[150px] truncate rounded-full border border-slate-200 px-2 py-0.5 text-[10px] text-slate-500 hover:border-teal-400 dark:border-slate-700"
                  title={`Search previous employer: ${c.value}`}
                >
                  {c.value}
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Education" count={Number(!!filters.education) + Number(!!filters.institute)}>
          <Label className="text-[11px] text-slate-500">Degree / specialisation</Label>
          <Input value={filters.education} onChange={(e) => set('education')(e.target.value)} placeholder="B.Tech, MBA" className="h-8 text-xs" aria-label="Education" />
          <Label className="text-[11px] text-slate-500">Institute</Label>
          <Input value={filters.institute} onChange={(e) => set('institute')(e.target.value)} placeholder="IIT, NIT" className="h-8 text-xs" aria-label="Institute" />
        </Section>

        <Section title="Notice period" count={filters.noticeMax && filters.noticeMax !== 'any' ? 1 : 0}>
          <Select value={filters.noticeMax || 'any'} onValueChange={(v) => set('noticeMax')(v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Notice period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NOTICE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section title="Employment type" count={filters.employmentType ? 1 : 0}>
          <Select value={filters.employmentType || 'any'} onValueChange={(v) => set('employmentType')(v === 'any' ? '' : v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Employment type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value || 'any'}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section title="Languages" count={filters.languages ? 1 : 0}>
          <Input value={filters.languages} onChange={(e) => set('languages')(e.target.value)} placeholder="English, Hindi" className="h-8 text-xs" aria-label="Languages" />
          {meta && meta.languages.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-0.5">
              {meta.languages.slice(0, 6).map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() =>
                    setFilters((prev) => {
                      const parts = prev.languages.split(',').map((s) => s.trim()).filter(Boolean)
                      const next = parts.includes(l.value) ? parts.filter((p) => p !== l.value) : [...parts, l.value]
                      return { ...prev, languages: next.join(', ') }
                    })
                  }
                  className={`rounded-full border px-2 py-0.5 text-[10px] transition ${
                    filters.languages.toLowerCase().includes(l.value.toLowerCase())
                      ? 'border-teal-500 bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300'
                      : 'border-slate-200 text-slate-500 hover:border-teal-400 dark:border-slate-700'
                  }`}
                >
                  {l.value}
                </button>
              ))}
            </div>
          )}
        </Section>

        <Section title="Candidate freshness" count={Number(!!filters.lastActiveDays) + Number(!!filters.updatedWithinDays)}>
          <Label className="text-[11px] text-slate-500">Last active</Label>
          <Select value={filters.lastActiveDays || 'any'} onValueChange={(v) => set('lastActiveDays')(v === 'any' ? '' : v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Last active">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LAST_ACTIVE_OPTIONS.map((o) => (
                <SelectItem key={o.value || 'any'} value={o.value || 'any'}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label className="text-[11px] text-slate-500">Profile updated</Label>
          <Select value={filters.updatedWithinDays || 'any'} onValueChange={(v) => set('updatedWithinDays')(v === 'any' ? '' : v)}>
            <SelectTrigger className="h-8 text-xs" aria-label="Profile updated">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UPDATED_OPTIONS.map((o) => (
                <SelectItem key={o.value || 'any'} value={o.value || 'any'}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>
      </div>
    </div>
  )
}

/** Active-filter chips row + clear-all. */
export function ActiveFilterChips({
  filters,
  setFilters,
  onClearAll,
}: {
  filters: TalentFilters
  setFilters: (updater: (prev: TalentFilters) => TalentFilters) => void
  onClearAll: () => void
}) {
  const chips: { key: keyof TalentFilters; label: string }[] = []
  const push = (key: keyof TalentFilters, label: string) => {
    if (key === 'noticeMax') {
      if (filters.noticeMax && filters.noticeMax !== 'any') chips.push({ key, label })
    } else if (filters[key] && typeof filters[key] === 'string' && (filters[key] as string).trim()) {
      chips.push({ key, label })
    }
  }
  push('skillsMandatory', 'Must-have skills')
  push('skillsPreferred', 'Preferred skills')
  push('skillsExcluded', 'Excluded skills')
  push('designation', 'Designation')
  push('employerCurrent', 'Current employer')
  push('employerPrevious', 'Previous employer')
  push('industry', 'Industry')
  push('functionalArea', 'Functional area')
  push('employmentType', 'Employment type')
  push('locations', 'Locations')
  push('education', 'Education')
  push('institute', 'Institute')
  push('minExperience', 'Min experience')
  push('maxExperience', 'Max experience')
  push('minCTC', 'Min expected CTC')
  push('maxCTC', 'Max expected CTC')
  push('minCurrentCTC', 'Min current CTC')
  push('maxCurrentCTC', 'Max current CTC')
  push('languages', 'Languages')
  push('lastActiveDays', 'Recently active')
  push('updatedWithinDays', 'Recently updated')
  push('noticeMax', 'Notice period')

  if (chips.length === 0 && !filters.q.trim()) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Filter className="size-3.5 text-slate-400" aria-hidden />
      {filters.q.trim() && (
        <span className="inline-flex max-w-[280px] items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white dark:bg-slate-100 dark:text-slate-900">
          <span className="truncate">&quot;{filters.q.trim()}&quot;</span>
          <button type="button" onClick={() => setFilters((prev) => ({ ...prev, q: '' }))} aria-label="Remove keyword" className="ml-0.5 text-white/70 hover:text-white dark:text-slate-900/70">
            ×
          </button>
        </span>
      )}
      {chips.map(({ key, label }) => (
        <span key={String(key)} className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          <span className="text-slate-400">{label}:</span>
          <span className="truncate font-medium">{filters[key] as string}</span>
          <button
            type="button"
            onClick={() => setFilters((prev) => ({ ...prev, [key]: key === 'noticeMax' ? 'any' : '' }))}
            aria-label={`Remove ${label} filter`}
            className="ml-0.5 text-slate-400 hover:text-rose-500"
          >
            ×
          </button>
        </span>
      ))}
      {(chips.length > 0 || filters.q.trim()) && (
        <button type="button" onClick={onClearAll} className="ml-1 text-[11px] font-medium text-rose-500 underline-offset-2 hover:underline">
          Clear all
        </button>
      )}
    </div>
  )
}

