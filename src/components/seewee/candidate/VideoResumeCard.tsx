'use client'

/**
 * VideoResumeCard — the candidate's 90-second video resume.
 *
 * Two ways to add it: record straight in the browser (MediaRecorder with live
 * preview, a 90-second hard stop, re-record, "Use this take") or upload a
 * .webm/.mp4 file (≤ 8 MB). Shows the current video, its duration, an
 * editable one-line intro caption and a two-step delete.
 *
 * Storage + privacy: the file lives on the server's media store (never in
 * git, never public) and is shared only with recruiters who view the
 * profile — never publicly.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Pencil,
  RotateCcw,
  Square,
  Trash2,
  UploadCloud,
  Video,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ApiResponse } from '@/lib/types'

const MAX_SECONDS = 90
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB — mirrors the server guard
const MAX_INTRO_CHARS = 160

interface VideoMeta {
  hasVideo: boolean
  seconds: number | null
  intro: string | null
  uploadedAt: string | null
  streamUrl: string | null
}

type Mode = 'idle' | 'recording' | 'review'

/** mm:ss for the timer / duration chip */
function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** First supported recording container for this browser. */
function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ]
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? null
}

/** Browser supports in-browser recording (camera + mic)? */
function recordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    pickRecorderMime() !== null
  )
}

/** Read a File/Blob into the base64 data URL the upload API accepts. */
function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the video file'))
    reader.readAsDataURL(blob)
  })
}

/**
 * Best-effort duration probe for uploaded files. Chrome records webm blobs
 * with an "Infinity" duration until seeked far past the end — the classic
 * currentTime trick fixes that before we trust the number.
 */
function probeSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    let settled = false
    const done = (d: number | null) => {
      if (settled) return
      settled = true
      URL.revokeObjectURL(url)
      resolve(d)
    }
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        done(v.duration)
      } else {
        v.currentTime = 1e101 // force the browser to compute the real duration
      }
    }
    v.ontimeupdate = () => {
      done(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null)
    }
    v.onerror = () => done(null)
    v.src = url
  })
}

export default function VideoResumeCard({
  user,
}: {
  user: { id: string; name?: string }
}) {
  const [meta, setMeta] = useState<VideoMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>('idle')
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [reviewUrl, setReviewUrl] = useState<string | null>(null)
  const [reviewSeconds, setReviewSeconds] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editingIntro, setEditingIntro] = useState(false)
  const [introDraft, setIntroDraft] = useState('')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startedAtRef = useRef(0)
  const stoppingRef = useRef(false)
  const reviewMimeRef = useRef<string>('video/webm')

  const loadMeta = useCallback(async () => {
    if (!user?.id) return
    setLoading(true)
    try {
      const res = await fetch(
        `/api/candidates/video-resume?userId=${encodeURIComponent(user.id)}`
      )
      const json = (await res.json().catch(() => ({}))) as ApiResponse<VideoMeta>
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error ?? 'Could not load your video resume')
      }
      setMeta(json.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load your video resume')
    } finally {
      setLoading(false)
    }
  }, [user?.id])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  /** Free camera/mic + timers + blob URLs. */
  const teardown = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    stoppingRef.current = false
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  // Unmount safety: never leave the camera light on.
  useEffect(() => {
    return () => {
      teardown()
      if (reviewUrl) URL.revokeObjectURL(reviewUrl)
    }
  }, [])

  const resetReview = useCallback(() => {
    setReviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setReviewSeconds(0)
  }, [])

  /* ----------------------------- recording ------------------------------ */

  const stopRecording = useCallback(() => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    try {
      recorderRef.current?.stop()
    } catch {
      teardown()
      setMode('idle')
    }
  }, [teardown])

  const startRecording = useCallback(async () => {
    resetReview()
    const mime = pickRecorderMime()
    if (!mime || !navigator.mediaDevices?.getUserMedia) {
      toast.error(
        'Recording is not supported in this browser — you can upload a video file instead'
      )
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: true,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        try {
          await videoRef.current.play()
        } catch {
          /* autoplay of a muted preview is generally allowed; ignore */
        }
      }

      const recorder = new MediaRecorder(stream, { mimeType: mime })
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onstop = () => {
        const seconds = Math.min(
          MAX_SECONDS,
          Math.max(0.5, (Date.now() - startedAtRef.current) / 1000)
        )
        const type = (recorder.mimeType || 'video/webm').split(';')[0]
        reviewMimeRef.current = type
        const blob = new Blob(chunksRef.current, { type })
        chunksRef.current = []
        teardown()
        if (blob.size === 0) {
          toast.error('The recording came out empty — please try again')
          setMode('idle')
          return
        }
        setReviewSeconds(Math.round(seconds * 10) / 10)
        setReviewUrl(URL.createObjectURL(blob))
        setMode('review')
      }
      recorder.start(500)

      startedAtRef.current = Date.now()
      setElapsed(0)
      setMode('recording')
      timerRef.current = setInterval(() => {
        const secs = (Date.now() - startedAtRef.current) / 1000
        setElapsed(secs)
        if (secs >= MAX_SECONDS) stopRecording() // hard stop at 90s
      }, 250)
    } catch {
      teardown()
      setMode('idle')
      toast.error(
        'Could not access your camera or microphone — check permissions, or upload a file instead'
      )
    }
  }, [resetReview, stopRecording, teardown])

  /* ------------------------------ uploading ------------------------------ */

  const postVideo = useCallback(
    async (payload: { data: string; mimeType: string; seconds: number; intro?: string }) => {
      if (!user?.id) return false
      setUploading(true)
      try {
        const res = await fetch('/api/candidates/video-resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id, ...payload }),
        })
        const json = (await res.json().catch(() => ({}))) as ApiResponse<{
          videoResumePath: string
          seconds: number
          intro: string | null
          uploadedAt: string
        }>
        if (!res.ok || json.error || !json.data) {
          throw new Error(json.error ?? 'Upload failed')
        }
        await loadMeta()
        toast.success('Video resume saved — recruiters on your profile can now watch it')
        return true
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not save the video')
        return false
      } finally {
        setUploading(false)
      }
    },
    [loadMeta, user?.id]
  )

  const applyTake = useCallback(async () => {
    if (!reviewUrl) return
    try {
      const blob = await fetch(reviewUrl).then((r) => r.blob())
      const dataUrl = await toDataUrl(blob)
      const ok = await postVideo({
        data: dataUrl,
        mimeType: reviewMimeRef.current,
        seconds: reviewSeconds,
      })
      if (ok) {
        resetReview()
        setMode('idle')
      }
    } catch {
      toast.error('Could not read the recording — please try again')
    }
  }, [postVideo, resetReview, reviewSeconds, reviewUrl])

  const handleUploadFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase()
      const type = (file.type || '').toLowerCase()
      const okType = type === 'video/webm' || type === 'video/mp4' || lower.endsWith('.webm') || lower.endsWith('.mp4')
      if (!okType) {
        toast.error('Unsupported format — please use a WebM or MP4 video')
        return
      }
      if (file.size > MAX_BYTES) {
        toast.error('Video is too large — keep it under 8 MB (about 60–90 seconds at normal quality)')
        return
      }
      if (file.size < 1024) {
        toast.error('The file looks empty — please choose a valid video')
        return
      }
      setUploading(true)
      try {
        const seconds = await probeSeconds(file)
        if (seconds == null) {
          toast.error('Could not read the video duration — please re-export the file and try again')
          return
        }
        if (seconds > MAX_SECONDS) {
          toast.error(`Video is too long — the limit is ${MAX_SECONDS} seconds`)
          return
        }
        const dataUrl = await toDataUrl(file)
        await postVideo({
          data: dataUrl,
          mimeType: type === 'video/mp4' || lower.endsWith('.mp4') ? 'video/mp4' : 'video/webm',
          seconds: Math.round(seconds * 10) / 10,
        })
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [postVideo]
  )

  /* --------------------------- intro + delete ---------------------------- */

  const saveIntro = useCallback(async () => {
    if (!user?.id) return
    setBusy(true)
    try {
      const res = await fetch('/api/candidates/video-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, intro: introDraft }),
      })
      const json = (await res.json().catch(() => ({}))) as ApiResponse<VideoMeta>
      if (!res.ok || json.error) {
        throw new Error(json.error ?? 'Could not save the caption')
      }
      setMeta((prev) => (prev ? { ...prev, intro: json.data?.intro ?? null } : prev))
      setEditingIntro(false)
      toast.success('Caption updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the caption')
    } finally {
      setBusy(false)
    }
  }, [introDraft, user?.id])

  // Two-step delete: the confirm state self-resets so a stray click never
  // leaves the destructive mode armed forever.
  useEffect(() => {
    if (!confirmDelete) return
    const t = setTimeout(() => setConfirmDelete(false), 5000)
    return () => clearTimeout(t)
  }, [confirmDelete])

  const deleteVideo = useCallback(async () => {
    if (!user?.id || busy) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setConfirmDelete(false)
    setBusy(true)
    try {
      const res = await fetch(
        `/api/candidates/video-resume?userId=${encodeURIComponent(user.id)}`,
        { method: 'DELETE' }
      )
      const json = (await res.json().catch(() => ({}))) as ApiResponse<{ cleared: boolean }>
      if (!res.ok || json.error) {
        throw new Error(json.error ?? 'Remove failed')
      }
      setMeta({ hasVideo: false, seconds: null, intro: null, uploadedAt: null, streamUrl: null })
      setEditingIntro(false)
      toast.success('Video resume removed from your profile')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the video')
    } finally {
      setBusy(false)
    }
  }, [busy, confirmDelete, user?.id])

  /* -------------------------------- view -------------------------------- */

  const canRecord = recordingSupported()
  const hasVideo = Boolean(meta?.hasVideo)

  return (
    <Card className="rounded-2xl border-stone-200 shadow-md dark:border-stone-800">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-stone-700 dark:text-stone-300">
            <Video className="size-4 text-violet-600" aria-hidden />
            Video resume
          </h3>
          {loading ? null : hasVideo ? (
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" aria-hidden />
              {meta?.seconds != null ? `${fmtClock(meta.seconds)} added` : 'Added'}
            </span>
          ) : (
            <span className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-0.5 text-[11px] font-semibold text-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400">
              Optional
            </span>
          )}
        </div>

        <p className="mt-1.5 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
          Record or upload a short video (up to {MAX_SECONDS} seconds, under 8 MB) introducing
          yourself — your pitch, personality and communication, in your own words.
        </p>

        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-stone-50 px-3 py-2 text-[11px] leading-relaxed text-stone-600 dark:bg-stone-900/60 dark:text-stone-400">
          <Lock className="mt-0.5 size-3.5 shrink-0 text-stone-400" aria-hidden />
          Your video resume is shared only with recruiters who view your profile — never
          publicly.
        </p>

        {loading ? (
          <div className="mt-4 space-y-3" aria-hidden>
            <div className="aspect-video w-full animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800/60" />
            <div className="h-9 w-40 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-800/60" />
          </div>
        ) : (
          <>
            {/* ---------------- current video ---------------- */}
            {hasVideo && meta?.streamUrl && (
              <div className="mt-4 space-y-3">
                <video
                  key={meta.streamUrl}
                  controls
                  playsInline
                  preload="metadata"
                  src={meta.streamUrl}
                  aria-label="Your video resume"
                  className="aspect-video w-full rounded-xl bg-stone-900"
                />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                  {meta.seconds != null && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" aria-hidden /> {fmtClock(meta.seconds)}
                    </span>
                  )}
                  {meta.uploadedAt && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="size-3.5" aria-hidden />
                      added{' '}
                      {new Date(meta.uploadedAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </span>
                  )}
                </div>

                {/* intro caption / editor */}
                {editingIntro ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <Input
                        value={introDraft}
                        maxLength={MAX_INTRO_CHARS}
                        onChange={(e) => setIntroDraft(e.target.value)}
                        placeholder="What recruiters should notice"
                        aria-label="Caption for your video resume"
                        className="h-11 pr-16 sm:h-10"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-stone-400">
                        {introDraft.length}/{MAX_INTRO_CHARS}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void saveIntro()}
                        className="h-11 flex-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 sm:h-9"
                      >
                        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
                        Save caption
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setEditingIntro(false)
                          setIntroDraft(meta?.intro ?? '')
                        }}
                        className="h-11 rounded-lg sm:h-9"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2 rounded-r-lg border-l-2 border-violet-300 bg-violet-50/50 py-1.5 pl-3 pr-2 dark:border-violet-700 dark:bg-violet-950/30">
                    {meta.intro ? (
                      <p className="text-xs italic leading-relaxed text-stone-600 dark:text-stone-300">
                        “{meta.intro}”
                      </p>
                    ) : (
                      <p className="text-xs italic text-stone-400 dark:text-stone-500">
                        No caption yet — tell recruiters what to notice.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setIntroDraft(meta?.intro ?? '')
                        setEditingIntro(true)
                      }}
                      aria-label="Edit the video caption"
                      className="inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-violet-700 transition-colors hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-950/60"
                    >
                      <Pencil className="size-3" aria-hidden /> Edit
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ---------------- record / review / upload ---------------- */}

            {mode === 'recording' && (
              <div className="mt-4 space-y-3">
                <div className="relative overflow-hidden rounded-xl bg-stone-900">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    aria-label="Live camera preview"
                    className="aspect-video w-full scale-x-[-1] object-cover"
                  />
                  <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-stone-900/80 px-2.5 py-1 text-[11px] font-semibold text-white">
                    <span className="size-2 animate-pulse rounded-full bg-rose-500" aria-hidden />
                    Recording · {fmtClock(elapsed)} / {fmtClock(MAX_SECONDS)}
                  </div>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 transition-all duration-200"
                    style={{ width: `${Math.min(100, (elapsed / MAX_SECONDS) * 100)}%` }}
                  />
                </div>
                <Button
                  type="button"
                  onClick={stopRecording}
                  className="h-11 w-full rounded-lg bg-rose-600 text-white hover:bg-rose-700 sm:h-10"
                  aria-label="Stop recording"
                >
                  <Square className="size-4" aria-hidden /> Stop ({fmtClock(elapsed)})
                </Button>
                <p className="text-center text-[11px] text-stone-400">
                  Recording stops automatically at {fmtClock(MAX_SECONDS)}.
                </p>
              </div>
            )}

            {mode === 'review' && reviewUrl && (
              <div className="mt-4 space-y-3">
                <video
                  controls
                  playsInline
                  src={reviewUrl}
                  aria-label="Preview of your recording"
                  className="aspect-video w-full rounded-xl bg-stone-900"
                />
                <p className="text-[11px] text-stone-500 dark:text-stone-400">
                  Take length: {fmtClock(reviewSeconds)} · nothing is saved until you choose
                  “Use this take”.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => {
                      resetReview()
                      setMode('idle')
                    }}
                    className="h-11 flex-1 rounded-lg sm:h-10"
                  >
                    <RotateCcw className="size-4" aria-hidden /> Re-record
                  </Button>
                  <Button
                    type="button"
                    disabled={uploading}
                    onClick={() => void applyTake()}
                    className="h-11 flex-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 sm:h-10"
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <CheckCircle2 className="size-4" aria-hidden />
                    )}
                    {uploading ? 'Saving…' : 'Use this take'}
                  </Button>
                </div>
              </div>
            )}

            {mode === 'idle' && (
              <div className="mt-4 space-y-3">
                {!canRecord && (
                  <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    In-browser recording is not available here (unsupported browser or no
                    camera access) — you can still upload a video file below.
                  </p>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  {canRecord && (
                    <Button
                      type="button"
                      disabled={uploading}
                      onClick={() => void startRecording()}
                      className="h-11 flex-1 rounded-lg bg-violet-600 text-white hover:bg-violet-700 sm:h-10"
                    >
                      <Video className="size-4" aria-hidden />
                      {hasVideo ? 'Record a new take' : 'Record your video'}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="h-11 flex-1 rounded-lg sm:h-10"
                  >
                    {uploading ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <UploadCloud className="size-4" aria-hidden />
                    )}
                    {uploading ? 'Uploading…' : hasVideo ? 'Upload a file instead' : 'Upload a video file'}
                  </Button>
                </div>
                <p className="text-[11px] text-stone-400 dark:text-stone-500">
                  WebM or MP4 · up to {MAX_SECONDS} seconds · under 8 MB
                </p>
              </div>
            )}

            {/* ---------------- delete (two-step confirm) ---------------- */}
            {hasVideo && mode === 'idle' && (
              <div className="mt-4 border-t border-dashed border-stone-200 pt-3 dark:border-stone-800">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void deleteVideo()}
                  aria-label={confirmDelete ? 'Confirm removing the video resume' : 'Remove the video resume'}
                  className={`h-11 w-full rounded-lg sm:h-9 sm:w-auto ${
                    confirmDelete
                      ? 'border-rose-500 bg-rose-600 text-white hover:bg-rose-700'
                      : 'border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:hover:bg-rose-950/40'
                  }`}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-4" aria-hidden />
                  )}
                  {confirmDelete ? 'Tap again to confirm delete' : 'Delete video'}
                </Button>
              </div>
            )}
          </>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="video/webm,video/mp4,.webm,.mp4"
          className="hidden"
          aria-label="Choose a video file to upload"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleUploadFile(f)
          }}
        />
      </CardContent>
    </Card>
  )
}
