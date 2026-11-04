'use client'

/**
 * SavedSearches — saved searches + talent alerts.
 * List, run (with "what's new since last time"), rename, duplicate, delete,
 * and per-search alert frequency (OFF / DAILY / WEEKLY).
 */

import { useState } from 'react'
import { toast } from 'sonner'
import {
  BellRing,
  Copy,
  Loader2,
  Pencil,
  Play,
  Save,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { savedQueryToFilters, type SavedSearchRow } from './talent-types'

interface SavedSearchesProps {
  saved: SavedSearchRow[]
  loading: boolean
  recruiterId: string
  onLoad: (row: SavedSearchRow) => void
  onRefresh: () => void
  /** persist the CURRENT filter state under a name */
  saveCurrent: (name: string, alert: string) => Promise<boolean>
  /** run a saved search — parent applies the filters + refreshes results */
  onRun: (row: SavedSearchRow, newIds: string[], total: number) => void
}

export function SavedSearches({
  saved,
  loading,
  recruiterId,
  onLoad,
  onRefresh,
  saveCurrent,
  onRun,
}: SavedSearchesProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [alert, setAlert] = useState('OFF')
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')

  const doSave = async () => {
    if (!name.trim()) {
      toast.error('Give this search a name')
      return
    }
    setSaving(true)
    const ok = await saveCurrent(name.trim(), alert)
    setSaving(false)
    if (ok) setName('')
  }

  const runSearch = async (row: SavedSearchRow) => {
    setRunningId(row.id)
    try {
      const res = await fetch(`/api/saved-searches/${row.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId }),
      })
      const json: {
        data?: { total: number; newCount: number; newCandidateIds: string[]; results: unknown[] }
        error?: string
      } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to run saved search')
      toast.success(`"${row.name}" ran`, {
        description: `${json.data!.total} matches · ${json.data!.newCount} new since last run`,
      })
      onRun(row, json.data!.newCandidateIds, json.data!.total)
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run saved search')
    } finally {
      setRunningId(null)
    }
  }

  const rename = async (row: SavedSearchRow) => {
    const next = renameVal.trim()
    if (!next) return
    try {
      const res = await fetch(`/api/saved-searches/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId, name: next }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Rename failed')
      toast.success('Renamed')
      setRenamingId(null)
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed')
    }
  }

  const duplicate = async (row: SavedSearchRow) => {
    try {
      const res = await fetch('/api/saved-searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recruiterId,
          name: `${row.name} (copy)`.slice(0, 60),
          query: row.query,
          alertFrequency: row.alertFrequency,
        }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Duplicate failed')
      toast.success('Duplicated')
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Duplicate failed')
    }
  }

  const setAlertFreq = async (row: SavedSearchRow, freq: string) => {
    try {
      const res = await fetch(`/api/saved-searches/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId, alertFrequency: freq }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to update alert')
      toast.success(freq === 'OFF' ? 'Alerts off' : `Alerts: ${freq.toLowerCase()}`)
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update alert')
    }
  }

  const remove = async (row: SavedSearchRow) => {
    try {
      const res = await fetch(`/api/saved-searches/${row.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Delete failed')
      toast.success(`Deleted "${row.name}"`)
      onRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-9 gap-1.5 text-xs" aria-label="Saved searches">
          <Save className="size-3.5" aria-hidden />
          Saved searches
          {saved.length > 0 && (
            <Badge variant="secondary" className="ml-0.5 px-1.5 text-[10px]">
              {saved.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-3">
        <p className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">Saved searches & alerts</p>

        {/* save current */}
        <div className="flex items-center gap-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this search…"
            className="h-8 flex-1 text-xs"
            aria-label="Saved search name"
            onKeyDown={(e) => e.key === 'Enter' && doSave()}
          />
          <Select value={alert} onValueChange={setAlert}>
            <SelectTrigger className="h-8 w-[92px] shrink-0 text-[11px]" aria-label="Alert frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="OFF">No alert</SelectItem>
              <SelectItem value="DAILY">Daily</SelectItem>
              <SelectItem value="WEEKLY">Weekly</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" size="sm" className="h-8 gap-1 bg-teal-600 px-2.5 text-[11px] text-white hover:bg-teal-700" onClick={doSave} disabled={saving}>
            {saving ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Save className="size-3" aria-hidden />}
            Save
          </Button>
        </div>

        <Separator className="my-2.5" />

        {loading ? (
          <p className="py-3 text-center text-xs text-slate-400">Loading…</p>
        ) : saved.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-slate-400">
            No saved searches yet — set filters, then save them here to rerun in one click.
          </p>
        ) : (
          <ul className="max-h-64 space-y-1.5 overflow-y-auto [scrollbar-width:thin]">
            {saved.map((row) => (
              <li key={row.id} className="rounded-lg border border-slate-100 p-2 dark:border-slate-800">
                {renamingId === row.id ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && rename(row)}
                      className="h-7 flex-1 text-xs"
                      aria-label="New name"
                    />
                    <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => rename(row)}>
                      OK
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200" title={row.name}>
                        {row.name}
                      </p>
                      <p className="truncate text-[10px] text-slate-400">
                        {row.alertFrequency !== 'OFF' ? `Alert: ${row.alertFrequency.toLowerCase()}` : 'No alert'}
                        {row.lastRunAt ? ` · last run ${new Date(row.lastRunAt).toLocaleDateString()}` : ''}
                      </p>
                    </div>
                    {row.newCount > 0 && (
                      <Badge className="bg-emerald-100 text-[10px] text-emerald-700" title="New matching candidates since last run">
                        <BellRing className="mr-0.5 size-2.5" aria-hidden /> {row.newCount} new
                      </Badge>
                    )}
                    <Button type="button" size="sm" variant="ghost" className="size-7 p-0" onClick={() => runSearch(row)} disabled={runningId === row.id} aria-label={`Run ${row.name}`}>
                      {runningId === row.id ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Play className="size-3.5 text-teal-600" aria-hidden />}
                    </Button>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button type="button" size="sm" variant="ghost" className="size-7 p-0" aria-label={`More actions for ${row.name}`}>
                          <Pencil className="size-3 text-slate-400" aria-hidden />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-44 p-1.5" side="left">
                        <button type="button" className="w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => { setRenamingId(row.id); setRenameVal(row.name) }}>
                          Rename
                        </button>
                        <button type="button" className="w-full rounded px-2 py-1.5 text-left text-[11px] hover:bg-slate-100 dark:hover:bg-slate-800" onClick={() => duplicate(row)}>
                          Duplicate
                        </button>
                        <div className="px-2 py-1.5">
                          <Select value={row.alertFrequency} onValueChange={(v) => setAlertFreq(row, v)}>
                            <SelectTrigger className="h-7 text-[11px]" aria-label="Alert frequency">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="OFF">No alert</SelectItem>
                              <SelectItem value="DAILY">Daily alert</SelectItem>
                              <SelectItem value="WEEKLY">Weekly alert</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <button type="button" className="w-full rounded px-2 py-1.5 text-left text-[11px] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40" onClick={() => remove(row)}>
                          Delete
                        </button>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Helper re-export: convert a saved row into filter state (used by parent). */
export { savedQueryToFilters }
