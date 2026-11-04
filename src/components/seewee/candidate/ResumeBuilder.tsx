'use client'

/**
 * ResumeBuilder — orchestrator for the candidate's AI Resume Builder tab.
 *
 * Layout: header row (draft title + picker + new/delete) → two-column grid
 * (editor 7fr / live A4 preview 5fr, stacks on mobile) with a sticky action
 * bar over the preview column (Download PDF · Direct Apply · Save now).
 *
 * Persistence: 1.5s-debounced autosave → PATCH /api/resume-drafts (per-draft,
 * owner-scoped). Status text shows "Saving…" / "Saved · hh:mm".
 *
 * Direct Apply: lists the candidate's recommended/open jobs (GET /api/jobs,
 * already-applied excluded), search box, then submits through the SAME
 * endpoint the Easy-Apply dialog uses (POST /api/applications) with a
 * `coverNote` marking the resume source. This is candidate-side only — no
 * employer evaluation data ever appears here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Briefcase,
  CheckCircle2,
  FileDown,
  FileText,
  Loader2,
  Plus,
  Save,
  Search,
  Send,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { format } from 'date-fns'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAppStore, formatLpa, skillsToArray } from '@/store/app-store'
import type { Job } from '@/lib/types'
import { ResumeEditor, type ResumeBuilderDraft, type ResumeDraftPatch } from './ResumeEditor'
import { ResumeLivePreview } from './ResumeLivePreview'

const COVER_NOTE = 'Resume built with AI Resume Builder'

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved'

/** Profile fields the starter draft prefills from (nulls tolerated) */
interface DraftProfile {
  id: string
  name: string
  email?: string | null
  headline?: string | null
  phone?: string | null
  location?: string | null
}

/** Skeleton of a brand-new draft, prefilled from the signed-in profile */
function newDraftState(profile: DraftProfile): ResumeBuilderDraft {
  return {
    id: null,
    title: 'My Resume',
    basics: {
      fullName: profile.name,
      email: profile.email ?? undefined,
      headline: profile.headline ?? undefined,
      phone: profile.phone ?? undefined,
      location: profile.location ?? undefined,
      links: {},
      summary: '',
    },
    experience: [],
    education: [],
    skills: [],
    projects: [],
    targetJd: '',
    matchScore: null,
    matchGaps: null,
  }
}

/** Server ISO timestamp → Date, falling back to "now" when absent */
function fromIsoOrNow(iso?: string): Date {
  const d = iso ? new Date(iso) : new Date()
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function draftToPayload(d: ResumeBuilderDraft): Record<string, unknown> {
  return {
    basics: d.basics ?? {},
    experience: d.experience ?? [],
    education: d.education ?? [],
    skills: d.skills ?? [],
    projects: d.projects ?? [],
    targetJd: d.targetJd?.trim() ? d.targetJd : null,
    matchScore: d.matchScore ?? null,
    matchGaps: d.matchGaps ?? null,
  }
}

/* ==================================================================== */
/* Direct Apply dialog                                                  */
/* ==================================================================== */

function DirectApplyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const user = useAppStore((s) => s.user)
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const [appliedJobIds, setAppliedJobIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [justAppliedIds, setJustAppliedIds] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !user) return
    let cancelled = false
    setJobs(null)
    setLoadError(null)
    setQuery('')
    setJustAppliedIds(new Set())
    void (async () => {
      try {
        const [jobsRes, appsRes] = await Promise.all([
          fetch('/api/jobs'),
          fetch(`/api/applications?candidateId=${encodeURIComponent(user.id)}`),
        ])
        const jobsJson: { data?: Job[] | { jobs?: Job[] } } = await jobsRes.json()
        const appsJson: { data?: { jobId: string }[] } = await appsRes.json()
        if (cancelled) return
        // /api/jobs may return {data:{jobs:[...]}} or {data:[...]} — accept both.
        const rawJobs = jobsJson.data
        const jobList: Job[] = Array.isArray(rawJobs)
          ? rawJobs
          : Array.isArray((rawJobs as { jobs?: Job[] } | undefined)?.jobs)
            ? ((rawJobs as { jobs: Job[] }).jobs)
            : []
        const openJobs = jobList.filter((j) => j.status === 'ACTIVE')
        setJobs(openJobs)
        setAppliedJobIds(new Set((appsJson.data ?? []).map((a) => a.jobId)))
      } catch {
        if (!cancelled) setLoadError('Could not load jobs — please close and retry.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, user])

  const eligible = useMemo(() => {
    const skip = new Set([...appliedJobIds, ...justAppliedIds])
    const q = query.trim().toLowerCase()
    return (jobs ?? [])
      .filter((j) => !skip.has(j.id))
      .filter((j) =>
        !q
          ? true
          : `${j.title} ${j.company} ${j.location} ${j.skills}`.toLowerCase().includes(q)
      )
      .slice(0, 40)
  }, [jobs, appliedJobIds, justAppliedIds, query])

  async function applyTo(job: Job) {
    if (!user) return
    setApplyingId(job.id)
    try {
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          candidateId: user.id,
          coverNote: COVER_NOTE,
        }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to apply')
      setJustAppliedIds((prev) => new Set([...prev, job.id]))
      useAppStore.getState().bumpRefresh()
      toast.success(`Applied to ${job.title} — resume sent with your application!`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not apply — please retry.')
    } finally {
      setApplyingId(null)
    }
  }

  function goToApplications() {
    onOpenChange(false)
    document.dispatchEvent(new CustomEvent('seewee:candidate-tab', { detail: { tab: 'applications' } }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-5 text-blue-600" aria-hidden /> Direct Apply
          </DialogTitle>
          <DialogDescription>
            Pick a role — your current resume draft is attached as your application note.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, company, skill…"
            className="h-10 rounded-xl pl-9"
            aria-label="Search jobs"
          />
        </div>

        <div className="max-h-[46vh] min-h-[180px] space-y-2 overflow-y-auto pr-1 seewee-scroll">
          {jobs === null && !loadError && (
            <>
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </>
          )}
          {loadError && (
            <p className="py-6 text-center text-sm text-rose-600">{loadError}</p>
          )}
          {jobs !== null && eligible.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">
              {jobs.length === 0
                ? 'No open jobs on the platform right now — check back soon.'
                : 'No matching jobs — every result is either applied or filtered out.'}
            </p>
          )}
          {eligible.map((job) => {
            const applied = justAppliedIds.has(job.id)
            return (
              <div
                key={job.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition-colors hover:border-blue-300 dark:border-slate-800 dark:hover:border-blue-800"
              >
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-50 to-sky-100 text-xs font-bold text-blue-700 dark:from-blue-950/60 dark:to-sky-950/60 dark:text-blue-300"
                  aria-hidden
                >
                  {job.company.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{job.title}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {job.company} · {job.location} · {formatLpa(job.salaryMinLpa, job.salaryMaxLpa)}
                  </p>
                  <div className="mt-1 hidden flex-wrap gap-1 sm:flex">
                    {skillsToArray(job.skills).slice(0, 3).map((s) => (
                      <Badge key={s} variant="outline" className="rounded-full px-1.5 py-0 text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
                {applied ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-emerald-600">
                    <CheckCircle2 className="size-4" aria-hidden /> Applied
                  </span>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => void applyTo(job)}
                    disabled={applyingId === job.id}
                    className="h-8 shrink-0 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700"
                    aria-label={`Apply to ${job.title}`}
                  >
                    {applyingId === job.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    Apply
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Your application note: “{COVER_NOTE}”
          </p>
          {justAppliedIds.size > 0 && (
            <Button size="sm" variant="outline" onClick={goToApplications} className="h-8 rounded-lg text-xs">
              <Briefcase className="size-3.5" /> View Applications
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ==================================================================== */
/* Main orchestrator                                                    */
/* ==================================================================== */

export function ResumeBuilder() {
  const user = useAppStore((s) => s.user)

  const [draft, setDraft] = useState<ResumeBuilderDraft | null>(null)
  const [drafts, setDrafts] = useState<ResumeBuilderDraft[]>([])
  const [booting, setBooting] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [applyOpen, setApplyOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ResumeBuilderDraft | null>(null)
  const [creating, setCreating] = useState(false)

  /** JSON snapshot considered persisted — autosave skips when equal */
  const savedSnapshotRef = useRef<string>('')
  const saveTimerRef = useRef<number | null>(null)
  const latestDraftRef = useRef<ResumeBuilderDraft | null>(null)
  useEffect(() => {
    latestDraftRef.current = draft
  }, [draft])

  const draftJson = useMemo(
    () => (draft ? JSON.stringify(draftToPayload(draft)) : ''),
    [draft]
  )

  /* ------------------------------ save ------------------------------ */
  const saveDraft = useCallback(
    async (d: ResumeBuilderDraft): Promise<boolean> => {
      if (!d.id || !user) return false
      setSaveStatus('saving')
      try {
        const res = await fetch('/api/resume-drafts', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: d.id, userId: user.id, ...draftToPayload(d) }),
        })
        const json: { data?: ResumeBuilderDraft; error?: string } = await res.json()
        if (!res.ok || json.error || !json.data) throw new Error(json.error || 'Save failed')
        savedSnapshotRef.current = JSON.stringify(draftToPayload(d))
        setLastSavedAt(new Date())
        setSaveStatus('saved')
        setDrafts((prev) => prev.map((x) => (x.id === d.id ? { ...d, updatedAt: json.data!.updatedAt } : x)))
        return true
      } catch (err) {
        setSaveStatus('dirty')
        toast.error(err instanceof Error ? err.message : 'Autosave failed — press “Save now”.')
        return false
      }
    },
    [user]
  )

  /* --------------------------- initial boot -------------------------- */
  useEffect(() => {
    if (!user) return
    let cancelled = false
    void (async () => {
      setBooting(true)
      setBootError(null)
      try {
        const res = await fetch(`/api/resume-drafts?userId=${encodeURIComponent(user.id)}`)
        const json: { data?: ResumeBuilderDraft[]; error?: string } = await res.json()
        if (cancelled) return
        if (!res.ok || json.error) throw new Error(json.error || 'Could not load drafts')
        const list = json.data ?? []
        if (list.length > 0) {
          setDrafts(list)
          const first = list[0]
          savedSnapshotRef.current = JSON.stringify(draftToPayload(first))
          setDraft(first)
          setSaveStatus('saved')
          setLastSavedAt(fromIsoOrNow(first.updatedAt))
        } else {
          // First visit — create a starter draft prefilled from the profile
          const created = await createDraft('My Resume')
          if (cancelled) return
          setDrafts(created ? [created] : [])
          setDraft(created ?? newDraftState(user))
        }
      } catch (err) {
        if (!cancelled) {
          setBootError(err instanceof Error ? err.message : 'Could not load your drafts')
          setDraft(newDraftState(user))
        }
      } finally {
        if (!cancelled) setBooting(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  /** Create a draft server-side and return it as the client shape */
  const createDraft = useCallback(
    async (title: string): Promise<ResumeBuilderDraft | null> => {
      if (!user) return null
      setCreating(true)
      try {
        const base = newDraftState(user)
        const res = await fetch('/api/resume-drafts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, title, ...draftToPayload(base) }),
        })
        const json: { data?: ResumeBuilderDraft; error?: string } = await res.json()
        if (!res.ok || json.error || !json.data) throw new Error(json.error || 'Could not create draft')
        const created = json.data
        savedSnapshotRef.current = JSON.stringify(draftToPayload(created))
        setLastSavedAt(fromIsoOrNow(created.updatedAt))
        setSaveStatus('saved')
        return created
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not create a new draft')
        return null
      } finally {
        setCreating(false)
      }
    },
    [user]
  )

  /* --------------------- debounced autosave (1.5s) -------------------- */
  useEffect(() => {
    if (!draft || !draft.id || booting) return
    if (draftJson === savedSnapshotRef.current) return
    setSaveStatus('dirty')
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      const d = latestDraftRef.current
      if (d) void saveDraft(d)
    }, 1500)
    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
    }
  }, [draftJson, draft, booting, saveDraft])

  useEffect(() => () => {
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current)
  }, [])

  /* ------------------------------ actions ----------------------------- */
  function handleChange(patch: ResumeDraftPatch) {
    setDraft((d) => (d ? { ...d, ...patch } : d))
  }

  async function handleSwitchDraft(id: string) {
    if (!draft || draft.id === id) return
    // flush pending edits on the outgoing draft before switching
    if (draftJson !== savedSnapshotRef.current) await saveDraft(draft)
    const target = drafts.find((d) => d.id === id)
    if (!target) return
    savedSnapshotRef.current = JSON.stringify(draftToPayload(target))
    setDraft(target)
    setLastSavedAt(fromIsoOrNow(target.updatedAt))
    setSaveStatus('saved')
  }

  async function handleNewDraft() {
    const n = drafts.length + 1
    const created = await createDraft(`My Resume ${n}`)
    if (!created) return
    setDrafts((prev) => [created, ...prev])
    setDraft(created)
  }

  async function confirmDelete() {
    const target = deleteTarget
    if (!target?.id || !user) return
    setDeleteTarget(null)
    try {
      const res = await fetch(
        `/api/resume-drafts?id=${encodeURIComponent(target.id)}&userId=${encodeURIComponent(user.id)}`,
        { method: 'DELETE' }
      )
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Delete failed')
      const remaining = drafts.filter((d) => d.id !== target.id)
      setDrafts(remaining)
      if (draft?.id === target.id) {
        if (remaining.length > 0) {
          const next = remaining[0]
          savedSnapshotRef.current = JSON.stringify(draftToPayload(next))
          setDraft(next)
          setLastSavedAt(fromIsoOrNow(next.updatedAt))
        } else {
          setDraft(null)
          const created = await createDraft('My Resume')
          setDrafts(created ? [created] : [])
          setDraft(created)
        }
      }
      toast.success('Draft deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the draft')
    }
  }

  /* ------------------------------ render ------------------------------ */
  if (!user) return null

  return (
    <div className="space-y-4">
      {/* --------------------------- header row --------------------------- */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">
            <FileText className="size-5 text-blue-600" aria-hidden />
            AI Resume Builder
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Draft, polish with AI, match against a JD — then apply or download a clean PDF.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {drafts.length > 0 && draft && (
            <Select value={draft.id ?? undefined} onValueChange={(v) => void handleSwitchDraft(v)}>
              <SelectTrigger
                className="h-9 w-[170px] rounded-lg bg-card text-xs font-semibold"
                aria-label="Choose resume draft"
              >
                <SelectValue placeholder="Draft" />
              </SelectTrigger>
              <SelectContent>
                {drafts.map((d) => (
                  <SelectItem key={d.id} value={d.id!} className="text-xs">
                    {d.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleNewDraft()}
            disabled={creating}
            className="h-9 rounded-lg text-xs"
          >
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            New draft
          </Button>
          {draft?.id && drafts.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeleteTarget(draft)}
              className="h-9 rounded-lg text-xs text-slate-500 hover:text-rose-600"
              aria-label="Delete current draft"
            >
              <Trash2 className="size-3.5" />
              <span className="hidden sm:inline">Delete draft</span>
            </Button>
          )}
        </div>
      </div>

      {bootError && (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300">
          {bootError} — your edits still work, but saving is unavailable until reload.
        </p>
      )}

      {booting && !draft ? (
        <div className="grid gap-5 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-7">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
          <div className="lg:col-span-5">
            <Skeleton className="mx-auto aspect-[210/297] w-full max-w-md rounded-md" />
          </div>
        </div>
      ) : draft ? (
        <div className="grid items-start gap-5 lg:grid-cols-12">
          {/* ------------------------------ EDITOR (7fr) ------------------------------ */}
          <div className="min-w-0 lg:col-span-7">
            <ResumeEditor draft={draft} onChange={handleChange} />
          </div>

          {/* ------------------------- PREVIEW (5fr) + actions ------------------------ */}
          <div className="min-w-0 lg:col-span-5">
            <div className="lg:sticky lg:top-[76px]">
              {/* sticky action bar */}
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/90 p-2 shadow-sm backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
                <Button
                  onClick={() => window.print()}
                  className="h-9 flex-1 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 sm:flex-none"
                  aria-label="Download resume as PDF via the print dialog"
                >
                  <FileDown className="size-4" aria-hidden /> ⬇️ Download PDF
                </Button>
                <Button
                  onClick={() => setApplyOpen(true)}
                  className="h-9 flex-1 rounded-lg bg-gradient-to-r from-blue-600 to-sky-600 text-xs font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700 sm:flex-none"
                  aria-label="Directly apply with this resume to an open job"
                >
                  <Send className="size-4" aria-hidden /> 🚀 Direct Apply
                </Button>
                <Button
                  variant="outline"
                  onClick={() => draft && void saveDraft(draft)}
                  disabled={saveStatus === 'saving' || !draft.id}
                  className="h-9 rounded-lg text-xs"
                  aria-label="Save draft now"
                >
                  {saveStatus === 'saving' ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Save className="size-4" aria-hidden />
                  )}
                  Save now
                </Button>
                <span
                  className={`ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium ${
                    saveStatus === 'dirty' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {saveStatus === 'saving' && (
                    <>
                      <Loader2 className="size-3 animate-spin" aria-hidden /> Saving…
                    </>
                  )}
                  {saveStatus === 'dirty' && 'Unsaved changes…'}
                  {saveStatus === 'saved' &&
                    (lastSavedAt ? `Saved · ${format(lastSavedAt, 'HH:mm')}` : 'Saved')}
                  {saveStatus === 'idle' && 'Autosave on'}
                </span>
              </div>

              <div className="mx-auto w-full max-w-md lg:max-w-none">
                <ResumeLivePreview draft={draft} />
                <p className="mt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
                  A4 preview · “Download PDF” prints exactly this sheet
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-500">
            No resume draft available — press “New draft” to start one.
          </CardContent>
        </Card>
      )}

      <DirectApplyDialog open={applyOpen} onOpenChange={setApplyOpen} />

      {/* delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the draft and all of its sections. Your other drafts stay untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="rounded-lg bg-rose-600 text-white hover:bg-rose-700"
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
