'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { format, isValid, parseISO } from 'date-fns'
import {
  Archive,
  AudioLines,
  ChevronDown,
  Clock3,
  Download,
  FileVideo,
  HardDrive,
  Inbox,
  Loader2,
  Recycle,
  RefreshCw,
  Users2,
  Video,
} from 'lucide-react'
import { useAppStore, VERDICT_META } from '@/store/app-store'
import type { MediaListItem } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { InterviewTranscript } from '@/components/seewee/interview/InterviewTranscript'

type KindFilter = 'ALL' | 'video' | 'audio'

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'Unknown date'
  try {
    const d = parseISO(iso)
    if (!isValid(d)) return 'Unknown date'
    return format(d, 'd MMM yyyy, h:mm a')
  } catch {
    return 'Unknown date'
  }
}

/**
 * Recruiter-side central recording inventory (completes the media loop:
 * record → store → stream → manage). Lists every recorded interview answer
 * across the recruiter's jobs with inline playback (via the transcript),
 * one-tap download, and kind/candidate filters.
 */
export function RecordingsPanel() {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<MediaListItem[]>([])
  const [kindFilter, setKindFilter] = useState<KindFilter>('ALL')
  const [candidateFilter, setCandidateFilter] = useState<string>('ALL')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [zipBusy, setZipBusy] = useState(false)
  const [gcBusy, setGcBusy] = useState(false)

  const load = useCallback(async () => {
    if (!user || user.role !== 'RECRUITER') return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/interview/media-list?recruiterId=${encodeURIComponent(user.id)}`
      )
      if (!res.ok) throw new Error(`Server responded ${res.status}`)
      const json: { data?: MediaListItem[] } = await res.json()
      setItems(json.data ?? [])
    } catch (err) {
      console.error('[RecordingsPanel] load failed:', err)
      setError('Could not load recordings. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const candidates = useMemo(() => {
    const map = new Map<string, string>()
    for (const it of items) map.set(it.candidateName, it.candidateEmail)
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [items])

  const filtered = useMemo(
    () =>
      items.filter(
        (it) =>
          (kindFilter === 'ALL' || it.mediaKind === kindFilter) &&
          (candidateFilter === 'ALL' || it.candidateName === candidateFilter)
      ),
    [items, kindFilter, candidateFilter]
  )

  const totals = useMemo(() => {
    const seconds = items.reduce((acc, it) => acc + (it.mediaSeconds ?? 0), 0)
    const videos = items.filter((it) => it.mediaKind === 'video').length
    const bytes = items.reduce((acc, it) => acc + (it.bytes ?? 0), 0)
    return {
      count: items.length,
      seconds,
      bytes,
      videos,
      audios: items.length - videos,
      candidates: candidates.length,
    }
  }, [items, candidates])

  /** Bulk-download the currently filtered set as one ZIP archive. */
  const downloadAll = async () => {
    if (!user || user.role !== 'RECRUITER' || filtered.length === 0) return
    setZipBusy(true)
    try {
      const params = new URLSearchParams({ recruiterId: user.id })
      if (kindFilter !== 'ALL') params.set('kind', kindFilter)
      if (candidateFilter !== 'ALL') params.set('candidateName', candidateFilter)
      const res = await fetch(`/api/interview/media-zip?${params.toString()}`)
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(json.error || `Server responded ${res.status}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `SeeWe-recordings-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 4000)
      toast.success(
        `Archive ready — ${filtered.length} recording${filtered.length === 1 ? '' : 's'} (${formatBytes(blob.size)})`
      )
    } catch (err) {
      console.error('[RecordingsPanel] zip failed:', err)
      toast.error(err instanceof Error ? err.message : 'Could not build the archive')
    } finally {
      setZipBusy(false)
    }
  }

  /** Storage hygiene: sweep orphan files + recordings past the TTL window. */
  const cleanStorage = async () => {
    if (!user || user.role !== 'RECRUITER' || gcBusy) return
    setGcBusy(true)
    try {
      const res = await fetch(
        `/api/interview/media-gc?recruiterId=${encodeURIComponent(user.id)}`,
        { method: 'POST' }
      )
      const json = (await res.json().catch(() => ({}))) as {
        data?: { orphanedDeleted?: number; expiredDeleted?: number; freedBytes?: number; ttlDays?: number }
        error?: string
      }
      if (!res.ok || json.error) throw new Error(json.error || `Server responded ${res.status}`)
      const d = json.data
      const removed = (d?.orphanedDeleted ?? 0) + (d?.expiredDeleted ?? 0)
      if (removed === 0) {
        toast.success('Storage already clean — nothing to remove')
      } else {
        toast.success(
          `Swept ${removed} file${removed === 1 ? '' : 's'} · freed ${formatBytes(d?.freedBytes ?? 0)}`
        )
        await load()
      }
    } catch (err) {
      console.error('[RecordingsPanel] gc failed:', err)
      toast.error(err instanceof Error ? err.message : 'Storage cleanup failed')
    } finally {
      setGcBusy(false)
    }
  }

  const download = (it: MediaListItem) => {
    // hidden anchor so the page never navigates away
    const a = document.createElement('a')
    a.href = `/api/interview/media/${encodeURIComponent(it.mediaFile)}?download=1${user?.id ? `&viewerId=${encodeURIComponent(user.id)}` : ''}`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success(`Downloading ${it.candidateName}'s Q${it.qIndex + 1} recording`)
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading recordings">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={`r-${i}`} className="h-24 rounded-xl" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card className="rounded-xl border-rose-200 bg-rose-50/60 dark:bg-rose-950/40">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="font-medium text-rose-800 dark:text-rose-200">{error}</p>
          <Button
            onClick={() => void load()}
            variant="outline"
            className="rounded-lg border-rose-300 dark:border-rose-700/60 text-rose-700 hover:bg-rose-100"
          >
            <RefreshCw className="size-4" aria-hidden /> Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" role="group" aria-label="Recording inventory summary">
        {[
          { label: 'Recordings', value: String(totals.count), icon: FileVideo, tint: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700' },
          { label: 'Total footage', value: formatDuration(totals.seconds), icon: Clock3, tint: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700' },
          { label: 'Video / Audio', value: `${totals.videos} / ${totals.audios}`, icon: Video, tint: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700' },
          { label: 'Candidates', value: String(totals.candidates), icon: Users2, tint: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700' },
          { label: 'On disk', value: formatBytes(totals.bytes), icon: HardDrive, tint: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700' },
        ].map(({ label, value, icon: Icon, tint }) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white dark:bg-slate-900 p-3 shadow-sm sm:p-4">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-xs">
              <span className={`grid size-5 place-items-center rounded-md ${tint}`} aria-hidden>
                <Icon className="size-3" />
              </span>
              {label}
            </p>
            <p className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">{value}</p>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-slate-200 bg-white dark:bg-slate-900 p-0.5 shadow-sm" role="group" aria-label="Filter by recording type">
          {(
            [
              { v: 'ALL' as KindFilter, label: `All (${totals.count})` },
              { v: 'video' as KindFilter, label: `Video (${totals.videos})` },
              { v: 'audio' as KindFilter, label: `Audio (${totals.audios})` },
            ]
          ).map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setKindFilter(v)}
              aria-pressed={kindFilter === v}
              className={`min-h-[36px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors sm:text-sm ${
                kindFilter === v
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <Select value={candidateFilter} onValueChange={setCandidateFilter}>
          <SelectTrigger className="h-9 w-[200px] rounded-lg border-slate-200 bg-white dark:bg-slate-900 text-sm shadow-sm" aria-label="Filter by candidate">
            <SelectValue placeholder="All candidates" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All candidates ({candidates.length})</SelectItem>
            {candidates.map(([name, email]) => (
              <SelectItem key={name} value={name}>
                {name}
                {email ? <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500">{email}</span> : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          size="sm"
          onClick={() => void downloadAll()}
          disabled={zipBusy || filtered.length === 0}
          className="h-9 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm hover:from-blue-700 hover:to-sky-600"
          aria-label={`Download all ${filtered.length} filtered recordings as a zip archive`}
        >
          {zipBusy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden /> Zipping…
            </>
          ) : (
            <>
              <Archive className="size-4" aria-hidden /> Download all ({filtered.length})
            </>
          )}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void cleanStorage()}
          disabled={gcBusy}
          className="h-9 rounded-lg border-slate-200 text-slate-600 dark:text-slate-400 hover:bg-blue-50 hover:text-blue-700"
          aria-label="Clean up old and orphaned recordings"
          title="Sweeps orphaned files and recordings older than 45 days after interview completion"
        >
          {gcBusy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Recycle className="size-4" aria-hidden />
          )}
          <span className="hidden sm:inline">Clean storage</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          className="h-9 rounded-lg border-slate-200 text-slate-600 dark:text-slate-400 hover:bg-slate-50"
          aria-label="Refresh recordings"
        >
          <RefreshCw className="size-4" aria-hidden /> Refresh
        </Button>
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <Card className="rounded-xl border-dashed border-slate-300 dark:border-slate-700">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800" aria-hidden>
              <Inbox className="size-7 text-slate-400 dark:text-slate-500" />
            </span>
            <p className="font-semibold text-slate-800 dark:text-slate-200">
              {items.length === 0 ? 'No recordings yet' : 'No recordings match these filters'}
            </p>
            <p className="max-w-sm text-sm text-slate-500 dark:text-slate-400">
              {items.length === 0
                ? 'When candidates finish their AI video interviews, their recorded answers will appear here — playable and downloadable.'
                : 'Try a different type or candidate filter to find the recording.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {filtered.map((it, idx) => {
            const key = `${it.interviewId}-q${it.qIndex}`
            const isOpen = expanded === key
            const verdict = it.verdict ? VERDICT_META[it.verdict] : null
            const kindMeta =
              it.mediaKind === 'video'
                ? { icon: Video, tile: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700', label: 'Video' }
                : { icon: AudioLines, tile: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700', label: 'Audio' }
            const KindIcon = kindMeta.icon
            return (
              <motion.li
                key={key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: Math.min(idx * 0.04, 0.3) }}
              >
                <Card
                  className={`overflow-hidden rounded-xl transition-colors ${
                    isOpen ? 'border-blue-300 ring-1 ring-blue-200' : 'hover:border-blue-200'
                  }`}
                >
                  <CardContent className="p-0">
                    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4">
                      {/* Kind tile */}
                      <span
                        className={`grid size-11 shrink-0 place-items-center rounded-xl ${kindMeta.tile}`}
                        role="img"
                        aria-label={`${kindMeta.label} recording`}
                      >
                        <KindIcon className="size-5" aria-hidden />
                      </span>

                      {/* Body */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{it.candidateName}</p>
                          <span className="text-sm text-slate-400 dark:text-slate-500">·</span>
                          <p className="truncate text-sm font-medium text-slate-600 dark:text-slate-400">
                            {it.jobTitle}
                            {it.company ? ` · ${it.company}` : ''}
                          </p>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                            Q{it.qIndex + 1}
                          </span>
                          {it.takeLabel && (
                            <span
                              className="rounded-full border border-blue-200 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700"
                              title={`Candidate submitted take ${it.takeLabel} of up to 2 recorded takes`}
                            >
                              Take {it.takeLabel}
                            </span>
                          )}
                        </div>

                        <p className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">
                          “{it.question}”
                        </p>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                            <Clock3 className="size-3" aria-hidden /> {formatDuration(it.mediaSeconds)}
                          </span>
                          {typeof it.score === 'number' && (
                            <span className="rounded-full bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                              {it.score.toFixed(1)}/10
                            </span>
                          )}
                          {verdict && (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${verdict.className}`}
                            >
                              {verdict.emoji} {verdict.label}
                            </span>
                          )}
                          {it.sharedWithClient && (
                            <span
                              className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:text-slate-400"
                              title={it.clientName ? `Shared with ${it.clientName}` : 'Shared with client'}
                            >
                              📤 Shared
                            </span>
                          )}
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">{formatWhen(it.recordedAt)}</span>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-2 self-stretch sm:self-center">
                        <Button
                          size="sm"
                          onClick={() => setExpanded(isOpen ? null : key)}
                          aria-expanded={isOpen}
                          className="h-9 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm hover:from-blue-700 hover:to-sky-600"
                        >
                          {isOpen ? (
                            <>
                              <ChevronDown className="size-4 rotate-180" aria-hidden /> Hide
                            </>
                          ) : (
                            <>
                              <KindIcon className="size-4" aria-hidden /> Watch
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => download(it)}
                          aria-label={`Download ${it.candidateName} question ${it.qIndex + 1} recording`}
                          title="Download recording"
                          className="h-9 rounded-lg border-slate-200 text-slate-600 dark:text-slate-400 hover:bg-blue-50 hover:text-blue-700"
                        >
                          <Download className="size-4" aria-hidden />
                        </Button>
                      </div>
                    </div>

                    {/* Expanded transcript with players */}
                    {isOpen && (
                      <div className="border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/60 p-4">
                        <InterviewTranscript interviewId={it.interviewId} defaultOpen compact viewerId={user?.id} />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
