'use client'

/**
 * CvUploadCard — the candidate's attached CV document.
 *
 * Lives in My Profile. Uploads a PDF/DOC/DOCX (≤ 4 MB) to
 * POST /api/candidates/[id]/cv, shows the attached file with preview
 * (inline PDF) / download / remove actions. Recruiters receive this exact
 * document (snapshotted onto every application) — so the card also states
 * where the CV travels.
 */

import { useRef, useState } from 'react'
import {
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Loader2,
  Paperclip,
  Trash2,
  UploadCloud,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useAppStore } from '@/store/app-store'
import { CV_ACCEPT as cvAccept, cvFileError, fileToCvPayload, formatBytes } from '@/lib/cv-client'
import type { ApiResponse } from '@/lib/types'

export function CvUploadCard() {
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  if (!user || user.role !== 'CANDIDATE') return null

  const hasCv = Boolean(user.cvFileName)

  async function handleFile(file: File) {
    if (!user) return
    const problem = cvFileError(file)
    if (problem) {
      toast.error(problem)
      return
    }
    setBusy(true)
    try {
      const payload = await fileToCvPayload(file)
      const res = await fetch(`/api/candidates/${encodeURIComponent(user.id)}/cv`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json().catch(() => ({}))) as ApiResponse<{
        cvFileName: string
        sizeBytes: number
      }>
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error ?? 'Upload failed')
      }
      setUser({
        ...user,
        cvFileName: json.data.cvFileName,
        cvMimeType: payload.mimeType,
        cvUploadedAt: new Date().toISOString(),
      })
      toast.success(`CV attached — recruiters will receive ${json.data.cvFileName}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload the CV')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function removeCv() {
    if (!user || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/candidates/${encodeURIComponent(user.id)}/cv`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Remove failed')
      setUser({ ...user, cvFileName: null, cvMimeType: null, cvUploadedAt: null })
      toast.success('CV removed from your profile')
    } catch {
      toast.error('Could not remove the CV')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-md">
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-700 dark:text-slate-300">
            <Paperclip className="size-4 text-blue-600" aria-hidden />
            Attached CV document
          </h3>
          {hasCv && (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              <CheckCircle2 className="size-3.5" aria-hidden /> Attached
            </span>
          )}
        </div>

        <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          PDF, DOC or DOCX up to 4 MB. This exact file is snapshotted onto every job you
          apply for — recruiters and their ATS receive it with your application.
        </p>

        {hasCv ? (
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/40 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-100 to-sky-100 text-blue-700 dark:from-blue-900/40 dark:to-sky-900/40">
                <FileText className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {user.cvFileName}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {user.cvMimeType?.includes('pdf') ? 'PDF document' : 'Word document'}
                  {user.cvUploadedAt
                    ? ` · added ${new Date(user.cvUploadedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
                    : ''}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                asChild
                size="sm"
                variant="outline"
                className="min-h-[36px] rounded-lg"
              >
                <a
                  href={`/api/candidates/${encodeURIComponent(user.id)}/cv?inline=1`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Preview ${user.cvFileName}`}
                >
                  <Eye className="size-4" aria-hidden /> View
                </a>
              </Button>
              <Button asChild size="sm" variant="outline" className="min-h-[36px] rounded-lg">
                <a
                  href={`/api/candidates/${encodeURIComponent(user.id)}/cv`}
                  aria-label={`Download ${user.cvFileName}`}
                >
                  <Download className="size-4" aria-hidden /> Download
                </a>
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className="min-h-[36px] rounded-lg"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <UploadCloud className="size-4" aria-hidden />
                )}
                Replace
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void removeCv()}
                aria-label={`Remove ${user.cvFileName}`}
                className="min-h-[36px] rounded-lg border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:hover:bg-rose-950/40"
              >
                <Trash2 className="size-4" aria-hidden /> Remove
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            aria-label="Upload your CV document"
            className="mt-4 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/40 px-4 py-7 text-center transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20 dark:hover:border-blue-700 dark:hover:bg-blue-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {busy ? (
              <Loader2 className="size-6 animate-spin text-blue-600" aria-hidden />
            ) : (
              <UploadCloud className="size-6 text-blue-600" aria-hidden />
            )}
            <span className="text-sm font-semibold text-blue-800 dark:text-blue-300">
              {busy ? 'Uploading…' : 'Upload your CV'}
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              One file, always ready — apply faster with your CV pre-attached
            </span>
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept={cvAccept}
          className="hidden"
          aria-label="Choose CV file"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleFile(f)
          }}
        />
      </CardContent>
    </Card>
  )
}

/**
 * InlineCvAttach — compact CV status + change control for apply surfaces
 * (job dialog / Easy Apply). Shows the profile CV (or a freshly chosen file)
 * and lets the candidate swap it before submitting.
 */
export function InlineCvAttach({
  pendingCv,
  onPendingChange,
}: {
  pendingCv: File | null
  onPendingChange: (f: File | null) => void
}) {
  const user = useAppStore((s) => s.user)
  const inputRef = useRef<HTMLInputElement>(null)
  const profileCvName = user?.cvFileName ?? null
  const effectiveName = pendingCv ? pendingCv.name : profileCvName

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-3 dark:border-slate-800 dark:bg-slate-800/40">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-slate-700 dark:text-slate-300">
          CV attachment
        </p>
        {effectiveName && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <CheckCircle2 className="size-3" aria-hidden />
            {pendingCv ? formatBytes(pendingCv.size) : 'from profile'}
          </span>
        )}
      </div>
      {effectiveName ? (
        <p className="mt-1 truncate text-xs text-slate-600 dark:text-slate-400">
          <FileText className="mr-1 inline size-3.5 text-blue-600" aria-hidden />
          {effectiveName}
          {!pendingCv && (
            <span className="text-slate-400"> — your profile CV goes with this application</span>
          )}
        </p>
      ) : (
        <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          No CV attached — recruiters see applications with a CV first. Upload one now or apply without.
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-[32px] rounded-lg text-xs"
          onClick={() => inputRef.current?.click()}
        >
          <UploadCloud className="size-3.5" aria-hidden />
          {effectiveName ? 'Use a different file' : 'Attach CV (PDF/DOC)'}
        </Button>
        {pendingCv && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="min-h-[32px] rounded-lg text-xs text-rose-600 hover:bg-rose-50"
            onClick={() => onPendingChange(null)}
          >
            Revert to profile CV
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={cvAccept}
        className="hidden"
        aria-label="Choose CV file to attach"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          if (f) {
            const problem = cvFileError(f)
            if (problem) {
              toast.error(problem)
              return
            }
          }
          onPendingChange(f)
          if (inputRef.current) inputRef.current.value = ''
        }}
      />
    </div>
  )
}
