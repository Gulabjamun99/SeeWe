'use client'

/**
 * CvVersions — CV VERSION HISTORY (master spec §6).
 *
 * The candidate keeps several resume documents; the ACTIVE one is what the
 * profile CV card shows and what gets snapshotted onto every application.
 * Actions per version: set active (switch back), download, delete (confirm).
 * "Add new version" reads the file via FileReader (client-side 4 MB cap) and
 * POSTs base64 to /api/candidates/[id]/resume-versions.
 *
 * Candidate-private by design — nothing in this card is recruiter-visible.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Download,
  FileText,
  History,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  UploadCloud,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useAppStore } from '@/store/app-store'
import { CV_ACCEPT as cvAccept, cvFileError, formatBytes } from '@/lib/cv-client'
import type { ApiResponse, User } from '@/lib/types'

interface CvVersion {
  id: string
  label: string
  fileName: string
  mimeType: string
  sizeBytes: number | null
  isActive: boolean
  note: string | null
  createdAt: string
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

export function CvVersions({ user }: { user: User }) {
  const setUser = useAppStore((s) => s.setUser)
  const [versions, setVersions] = useState<CvVersion[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [deleting, setDeleting] = useState<CvVersion | null>(null)
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null)

  // add-version form state
  const fileRef = useRef<HTMLInputElement>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [label, setLabel] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${encodeURIComponent(user.id)}/resume-versions`)
      const json = (await res.json().catch(() => ({}))) as ApiResponse<CvVersion[]>
      if (!res.ok || json.error) throw new Error(json.error ?? 'Failed to load versions')
      setVersions(json.data ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load CV versions')
      setVersions([])
    } finally {
      setLoading(false)
    }
  }, [user.id])

  useEffect(() => {
    void load()
  }, [load])

  /** Mirror the active version into the store so the header CV chip stays honest. */
  function syncStoreFromList(list: CvVersion[]) {
    const active = list.find((v) => v.isActive)
    if (active) {
      setUser({
        ...user,
        cvFileName: active.fileName,
        cvMimeType: active.mimeType,
        cvUploadedAt: active.createdAt,
      })
    }
  }

  function pickFile(file: File) {
    const problem = cvFileError(file) // extension + 4 MB cap, same rules as the server
    if (problem) {
      toast.error(problem)
      return
    }
    setPendingFile(file)
    if (!label.trim()) setLabel(file.name.replace(/\.[^.]+$/, '').slice(0, 80))
  }

  async function saveVersion() {
    if (!pendingFile || !label.trim()) {
      toast.error('Choose a file and give this version a label')
      return
    }
    setSaving(true)
    try {
      // FileReader → data URL (base64); server validates + decodes.
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('Could not read the file'))
        reader.readAsDataURL(pendingFile)
      })
      const res = await fetch(`/api/candidates/${encodeURIComponent(user.id)}/resume-versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: label.trim(),
          fileName: pendingFile.name,
          mimeType: pendingFile.type || undefined,
          data: dataUrl,
          note: note.trim() || undefined,
        }),
      })
      const json = (await res.json().catch(() => ({}))) as ApiResponse<CvVersion>
      if (!res.ok || json.error || !json.data) throw new Error(json.error ?? 'Upload failed')
      toast.success(
        json.data.isActive
          ? `Saved — "${json.data.label}" is now your active CV`
          : `Version "${json.data.label}" saved to your history`
      )
      setAddOpen(false)
      setPendingFile(null)
      setLabel('')
      setNote('')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the version')
    } finally {
      setSaving(false)
    }
  }

  async function makeActive(version: CvVersion) {
    setBusyVersionId(version.id)
    try {
      const res = await fetch(
        `/api/candidates/${encodeURIComponent(user.id)}/resume-versions/${encodeURIComponent(version.id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ makeActive: true }),
        }
      )
      const json = (await res.json().catch(() => ({}))) as ApiResponse<CvVersion>
      if (!res.ok || json.error) throw new Error(json.error ?? 'Switch failed')
      toast.success(`"${version.label}" is now your active CV`)
      const list = (versions ?? []).map((v) => ({ ...v, isActive: v.id === version.id }))
      setVersions(list)
      syncStoreFromList(list)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not switch versions')
    } finally {
      setBusyVersionId(null)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    const target = deleting
    setBusyVersionId(target.id)
    try {
      const res = await fetch(
        `/api/candidates/${encodeURIComponent(user.id)}/resume-versions/${encodeURIComponent(target.id)}`,
        { method: 'DELETE' }
      )
      const json = (await res.json().catch(() => ({}))) as ApiResponse<{ remainingVersions: number }>
      if (!res.ok || json.error) throw new Error(json.error ?? 'Delete failed')
      toast.success(`Version "${target.label}" deleted`)
      const list = (versions ?? []).filter((v) => v.id !== target.id)
      setVersions(list)
      // If the profile CV was this version and nothing remains, clear the chip.
      if ((json.data?.remainingVersions ?? 1) === 0 && user.cvFileName === target.fileName) {
        setUser({ ...user, cvFileName: null, cvMimeType: null, cvUploadedAt: null })
      } else {
        syncStoreFromList(list)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the version')
    } finally {
      setBusyVersionId(null)
      setDeleting(null)
    }
  }

  return (
    <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-md">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-700 dark:text-slate-300">
              <History className="size-4 text-blue-600" aria-hidden />
              CV versions
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Keep multiple resumes and switch the one recruiters receive. The{' '}
              <span className="font-semibold text-emerald-700 dark:text-emerald-400">ACTIVE</span>{' '}
              version is snapshotted onto every application.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setAddOpen(true)}
            className="min-h-[36px] gap-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-sky-600 text-white hover:from-blue-700 hover:to-sky-700"
          >
            <Plus className="size-4" aria-hidden /> Add new version
          </Button>
        </div>

        {/* version list — scrollable with a slim custom scrollbar */}
        <div className="mt-4 max-h-72 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700">
          {loading ? (
            <div className="space-y-2 py-2">
              <div className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" />
              <div className="h-16 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" />
            </div>
          ) : !versions || versions.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 px-4 py-8 text-center">
              <FileText className="size-5 text-slate-300 dark:text-slate-600" aria-hidden />
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">No CV versions yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Add your first resume — it becomes your active CV automatically.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className={`flex items-start gap-3 rounded-xl border p-3.5 transition-colors ${
                    v.isActive
                      ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                      : 'border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40'
                  }`}
                >
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-blue-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
                  >
                    <FileText className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{v.label}</p>
                      {v.isActive && (
                        <Badge className="gap-1 rounded-full border-none bg-emerald-100 px-2 py-0 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                          <CheckCircle2 className="size-3" aria-hidden /> ACTIVE
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
                      {v.fileName}
                      {v.sizeBytes ? ` · ${formatBytes(v.sizeBytes)}` : ''} · {fmtDate(v.createdAt)}
                      {v.mimeType?.includes('pdf') ? ' · PDF' : ' · Word'}
                    </p>
                    {v.note && (
                      <p className="mt-1 truncate text-[11px] italic text-slate-400 dark:text-slate-500">“{v.note}”</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {!v.isActive && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyVersionId === v.id}
                          onClick={() => void makeActive(v)}
                          className="min-h-[30px] gap-1 rounded-lg px-2.5 text-[11px]"
                        >
                          {busyVersionId === v.id ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <RotateCcw className="size-3.5" aria-hidden />
                          )}
                          Set as active
                        </Button>
                      )}
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="min-h-[30px] gap-1 rounded-lg px-2.5 text-[11px]"
                      >
                        <a
                          href={`/api/candidates/${encodeURIComponent(user.id)}/resume-versions/${encodeURIComponent(v.id)}/download`}
                          aria-label={`Download ${v.label}`}
                        >
                          <Download className="size-3.5" aria-hidden /> Download
                        </a>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyVersionId === v.id}
                        onClick={() => setDeleting(v)}
                        aria-label={`Delete ${v.label}`}
                        className="min-h-[30px] gap-1 rounded-lg border-rose-200 px-2.5 text-[11px] text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:hover:bg-rose-950/40"
                      >
                        <Trash2 className="size-3.5" aria-hidden /> Delete
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>

      {/* ---------- add version dialog ---------- */}
      <Dialog open={addOpen} onOpenChange={(o) => !o && setAddOpen(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a CV version</DialogTitle>
            <DialogDescription>
              PDF, DOC or DOCX up to 4 MB. Tick “make active” by adding your first version — after
              that new versions stay in history until you switch.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <input
              ref={fileRef}
              type="file"
              accept={cvAccept}
              className="hidden"
              aria-label="Choose CV file for the new version"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) pickFile(f)
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/40 px-4 py-5 text-center transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              {pendingFile ? (
                <>
                  <FileText className="size-5 text-blue-600" aria-hidden />
                  <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">{pendingFile.name}</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{formatBytes(pendingFile.size)} — tap to change</span>
                </>
              ) : (
                <>
                  <UploadCloud className="size-5 text-blue-600" aria-hidden />
                  <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">Choose file</span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">PDF, DOC or DOCX · max 4 MB</span>
                </>
              )}
            </button>
            <div className="space-y-1.5">
              <Label htmlFor="cv-version-label">Version label</Label>
              <Input
                id="cv-version-label"
                value={label}
                maxLength={80}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Frontend-focused v2"
                className="min-h-[44px] rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cv-version-note">Note (optional)</Label>
              <Textarea
                id="cv-version-note"
                value={note}
                maxLength={200}
                rows={2}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. added AWS project bullet"
                className="resize-none rounded-xl"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveVersion()}
              disabled={saving || !pendingFile || !label.trim()}
              className="gap-1.5 bg-gradient-to-r from-blue-600 to-sky-600 text-white hover:from-blue-700 hover:to-sky-700"
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
              {saving ? 'Saving…' : 'Save version'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- delete confirm ---------- */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.label}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {deleting?.fileName} from your version history. If it was your active CV
              and other versions remain, your profile keeps the current document — nothing is sent
              to recruiters from this screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              Delete version
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
