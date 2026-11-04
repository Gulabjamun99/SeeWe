'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertCircle,
  AudioLines,
  Bot,
  ChevronDown,
  Download,
  MicOff,
  RefreshCw,
  ScrollText,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Video,
  VideoOff,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { AnswerRecord, InterviewQuestion } from '@/lib/types'

/* ------------------------------------------------------------------ */
/* Types & helpers                                                     */
/* ------------------------------------------------------------------ */

/** The GET /api/interview/[id] payload also carries the take-picker label */
type TranscriptAnswer = AnswerRecord & { takeLabel?: 'A' | 'B' | null }

interface TranscriptPayload {
  candidateName: string
  jobTitle: string
  domain?: string | null
  difficulty?: string | null
  overallScore?: number | null
  status: string
  questions: InterviewQuestion[]
  answers: TranscriptAnswer[]
}

function parseStringArray(raw: string | string[] | null | undefined): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.map((v) => String(v)).filter(Boolean)
  try {
    const arr: unknown = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map((v) => String(v)).filter(Boolean) : []
  } catch {
    return []
  }
}

function scoreTone(score: number): { cls: string; label: string } {
  if (score >= 7) return { cls: 'border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-700', label: 'Strong' }
  if (score >= 5.5) return { cls: 'border-sky-300 bg-sky-50 dark:bg-sky-950/40 text-sky-700', label: 'Decent' }
  if (score >= 4.5) return { cls: 'border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-700', label: 'Average' }
  return { cls: 'border-rose-300 bg-rose-50 dark:bg-rose-950/40 text-rose-600', label: 'Weak' }
}

/** 42 → "0:42", 385 → "6:25" */
function fmtDur(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Merge questions with their answers into one printable timeline row */
interface TranscriptRow {
  qIndex: number
  question: string
  focusArea: string
  answer: TranscriptAnswer | null
}

function buildRows(payload: TranscriptPayload): TranscriptRow[] {
  const byIndex = new Map<number, TranscriptAnswer>()
  for (const a of payload.answers ?? []) byIndex.set(a.qIndex, a)

  const rows: TranscriptRow[] = (payload.questions ?? []).map((q) => ({
    qIndex: q.qIndex,
    question: q.question,
    focusArea: q.focusArea,
    answer: byIndex.get(q.qIndex) ?? null,
  }))

  // Safety net: answers that have no matching question still deserve a row
  for (const a of payload.answers ?? []) {
    if (!rows.some((r) => r.qIndex === a.qIndex)) {
      rows.push({
        qIndex: a.qIndex,
        question: a.question || '(question unavailable)',
        focusArea: '',
        answer: a,
      })
    }
  }
  rows.sort((a, b) => a.qIndex - b.qIndex)
  return rows
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface InterviewTranscriptProps {
  interviewId: string
  /** Open the transcript on mount instead of lazy on click */
  defaultOpen?: boolean
  /** Shorter paddings for tight dialogs */
  compact?: boolean
  /**
   * Candidate privacy mode: fetches the score-free candidateView payload and
   * hides every AI evaluation surface (avg score, per-answer scores, feedback,
   * strengths/improvements). Recruiter & client surfaces keep the default.
   */
  candidateView?: boolean
  /** authorized viewer id (candidate self / job recruiter / client portal user) — sent as viewerId */
  viewerId?: string
  className?: string
}

/**
 * Collapsible, lazily-loaded per-question transcript of an AI interview —
 * chat-bubble timeline (AI question vs candidate voice answer), per-answer
 * score + feedback chips, audio-presence indicators.
 */
export function InterviewTranscript({
  interviewId,
  defaultOpen = false,
  compact = false,
  candidateView = false,
  viewerId,
  className = '',
}: InterviewTranscriptProps) {
  const [open, setOpen] = useState(defaultOpen)
  const [data, setData] = useState<TranscriptPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** qIndexes whose recording failed to load (404 / codec issue) → chip fallback */
  const [mediaErrors, setMediaErrors] = useState<Record<number, boolean>>({})

  /** media URLs ride the same viewerId the transcript fetch uses */
  const mediaQs = viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : ''

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams()
      if (candidateView) sp.set('candidateView', '1')
      if (viewerId) sp.set('viewerId', viewerId)
      const qs = sp.toString()
      const res = await fetch(
        `/api/interview/${encodeURIComponent(interviewId)}${qs ? `?${qs}` : ''}`
      )
      const json: { data?: TranscriptPayload; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Failed to load transcript')
      }
      setData(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transcript')
    } finally {
      setLoading(false)
    }
  }, [interviewId, candidateView, viewerId])

  /**
   * Mount-with-defaultOpen fix: when the component boots already expanded
   * (Recordings panel, candidate report re-entry) the user never clicks the
   * toggle, so the fetch must be kicked off from here instead.
   */
  const bootFetched = useRef(false)
  useEffect(() => {
    if (defaultOpen && !bootFetched.current) {
      bootFetched.current = true
      void load()
    }
  }, [defaultOpen, load])

  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next && !data && !loading && !error) void load()
    // allow retry after an error
    if (next && error) void load()
  }

  const rows = data ? buildRows(data) : []
  // Candidate privacy mode: evaluation chips stay hidden even if stale data
  // somehow reaches the browser — defence in depth on top of the API strip.
  const showScores = !candidateView
  const graded = showScores && data ? (data.answers ?? []).filter((a) => typeof a.score === 'number') : []
  const avg =
    graded.length > 0
      ? Math.round((graded.reduce((s, a) => s + (a.score as number), 0) / graded.length) * 10) / 10
      : null
  const withMedia = data ? (data.answers ?? []).filter((a) => !!a.mediaPath) : []
  const mediaCount = withMedia.length
  const mediaTotalSecs = withMedia.reduce(
    (s, a) => s + (typeof a.mediaSeconds === 'number' ? a.mediaSeconds : 0),
    0
  )
  // static literals so Tailwind can see both variants
  const listSpacing = compact ? 'space-y-3.5' : 'space-y-5'

  return (
    <section className={`overflow-hidden rounded-xl border border-slate-200 bg-white dark:bg-slate-900 ${className}`} aria-label="Interview transcript">
      {/* Toggle header */}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 bg-gradient-to-r from-slate-50 via-white to-blue-50/40 dark:to-blue-950/40 px-4 py-3 text-left transition-colors hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-sky-600 text-white shadow-sm">
          <ScrollText className="size-4" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-slate-800 dark:text-slate-200">Interview Transcript</span>
          <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">
            {loading
              ? 'Loading conversation…'
              : error
                ? 'Tap to retry'
                : data
                  ? `${rows.length} question${rows.length === 1 ? '' : 's'}${
                      avg != null ? ` · avg ${avg.toFixed(1)}/10` : ''
                    }${
                      mediaCount > 0
                        ? ` · ${mediaCount} recording${mediaCount === 1 ? '' : 's'} attached${
                            mediaTotalSecs > 0 ? ` · ${fmtDur(mediaTotalSecs)}` : ''
                          }`
                        : ' · AI asked · candidate answered by voice'
                    }`
                  : candidateView
                    ? 'Your questions and your answers'
                    : 'What exactly did the candidate say?'}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {/* Body */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="transcript-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className="overflow-hidden border-t border-dashed border-slate-200 dark:border-slate-800"
          >
            {/* Loading skeleton */}
            {loading && (
              <div className="space-y-4 p-4" aria-live="polite" aria-busy="true">
                {[0, 1].map((i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-8 w-2/3 animate-pulse rounded-full rounded-tl-sm bg-slate-100 dark:bg-slate-800" />
                    <div className="ml-auto h-14 w-3/4 animate-pulse rounded-2xl rounded-br-sm bg-slate-100 dark:bg-slate-800" />
                    <div className="h-6 w-32 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                  </div>
                ))}
              </div>
            )}

            {/* Error state */}
            {!loading && error && (
              <div className="flex flex-col items-center gap-2.5 p-6 text-center">
                <AlertCircle className="size-7 text-rose-400" aria-hidden />
                <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>
                <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void load()}>
                  <RefreshCw className="size-3.5" aria-hidden /> Retry
                </Button>
              </div>
            )}

            {/* Timeline */}
            {!loading && !error && data && (
              <ol
                className={`${listSpacing} max-h-[26rem] overflow-y-auto p-4 pr-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent`}
              >
                {rows.map((row, i) => {
                  const ans = row.answer
                  const ansText = ans?.transcript?.trim() ?? ''
                  const hasText = ansText.length > 0
                  const wordCount = hasText ? ansText.split(/\s+/).length : 0
                  const scored = showScores && ans && typeof ans.score === 'number'
                  const tone = scored ? scoreTone(ans.score as number) : null
                  const strengths = showScores ? parseStringArray(ans?.strengths) : []
                  const improvements = showScores ? parseStringArray(ans?.improvements) : []

                  return (
                    <motion.li
                      key={row.qIndex}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.05, 0.3), duration: 0.28 }}
                      className="space-y-1.5"
                      id={`transcript-q-${row.qIndex}`}
                    >
                      {/* Q-number rail */}
                      <div className="mb-1 flex items-center gap-2">
                        <span
                          className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-black ${
                            hasText ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400 dark:text-slate-500'
                          }`}
                          aria-hidden
                        >
                          {row.qIndex + 1}
                        </span>
                        {row.focusArea && (
                          <Badge
                            variant="outline"
                            className="max-w-[180px] truncate rounded-full border-sky-200 bg-sky-50/70 dark:bg-sky-950/40 px-2 py-0 text-[10px] font-semibold text-sky-700"
                            title={row.focusArea}
                          >
                            {row.focusArea}
                          </Badge>
                        )}
                        {ans?.takeLabel && (
                          <span
                            className="rounded-full border border-blue-200 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-700"
                            title={`Candidate submitted take ${ans.takeLabel} of up to 2 recorded takes`}
                          >
                            Take {ans.takeLabel}
                          </span>
                        )}
                        {ans && !hasText && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-300">
                            <MicOff className="size-3" aria-hidden /> no answer recorded
                          </span>
                        )}
                      </div>

                      {/* AI interviewer bubble */}
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-500 to-sky-600 text-white shadow-sm">
                          <Bot className="size-3.5" aria-hidden />
                        </span>
                        <div className="max-w-[85%] rounded-2xl rounded-tl-md border border-blue-100 bg-blue-50/80 dark:bg-blue-950/40 px-3.5 py-2.5 shadow-sm">
                          <p className="text-[13px] leading-relaxed text-slate-700 dark:text-slate-300">{row.question}</p>
                        </div>
                      </div>

                      {/* Candidate bubble */}
                      <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1 pl-8">
                        {/* Recorded answer playback — video when the camera was on,
                            audio otherwise. Hidden from print with a text note instead. */}
                        {ans?.mediaPath && !mediaErrors[row.qIndex] && (
                          <figure
                            data-print-hide
                            className="w-full overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-950 shadow-sm"
                          >
                            {ans.mediaKind === 'audio' ? (
                              <div className="flex items-center gap-3 bg-gradient-to-r from-slate-900 to-slate-800 px-3 py-2.5">
                                <span
                                  className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-500/20 text-sky-300"
                                  aria-hidden
                                >
                                  <AudioLines className="size-4" />
                                </span>
                                <audio
                                  controls
                                  preload="metadata"
                                  src={`/api/interview/media/${encodeURIComponent(ans.mediaPath)}${mediaQs}`}
                                  className="h-9 w-full min-w-0"
                                  aria-label={`Recorded audio answer for question ${row.qIndex + 1}`}
                                  onError={() =>
                                    setMediaErrors((prev) => ({ ...prev, [row.qIndex]: true }))
                                  }
                                />
                              </div>
                            ) : (
                              <video
                                controls
                                preload="metadata"
                                playsInline
                                src={`/api/interview/media/${encodeURIComponent(ans.mediaPath)}${mediaQs}`}
                                className="aspect-video w-full bg-slate-950"
                                aria-label={`Recorded video answer for question ${row.qIndex + 1}`}
                                onError={() =>
                                  setMediaErrors((prev) => ({ ...prev, [row.qIndex]: true }))
                                }
                              />
                            )}
                            <figcaption className="flex items-center justify-between gap-2 border-t border-white/10 bg-white px-3 py-1.5 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                              <span
                                className={`inline-flex items-center gap-1 font-semibold ${
                                  ans.mediaKind === 'audio' ? 'text-blue-700' : 'text-sky-700'
                                }`}
                              >
                                {ans.mediaKind === 'audio' ? (
                                  <AudioLines className="size-3" aria-hidden />
                                ) : (
                                  <Video className="size-3" aria-hidden />
                                )}
                                {ans.mediaKind === 'audio'
                                  ? 'Recorded audio answer'
                                  : 'Recorded video answer'}
                              </span>
                              <span className="inline-flex items-center gap-2">
                                {typeof ans.mediaSeconds === 'number' && (
                                  <span className="tabular-nums">{fmtDur(ans.mediaSeconds)}</span>
                                )}
                                <a
                                  href={`/api/interview/media/${encodeURIComponent(
                                    ans.mediaPath
                                  )}?download=1${viewerId ? `&viewerId=${encodeURIComponent(viewerId)}` : ''}`}
                                  download
                                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                  aria-label={`Download the ${
                                    ans.mediaKind === 'audio' ? 'audio' : 'video'
                                  } recording for question ${row.qIndex + 1}`}
                                  title="Download recording (.webm)"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Download className="size-3" aria-hidden /> Save
                                </a>
                              </span>
                            </figcaption>
                          </figure>
                        )}
                        {ans?.mediaPath && mediaErrors[row.qIndex] && (
                          <p className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                            <VideoOff className="size-3" aria-hidden /> Recording no longer
                            available
                          </p>
                        )}
                        {ans?.mediaPath && (
                          <p className="hidden text-[10px] italic text-slate-400 dark:text-slate-500 print:block">
                            🎬 Recorded answer available in the SeeWe app.
                          </p>
                        )}
                        {hasText ? (
                          <>
                            <div className="rounded-2xl rounded-br-md border border-slate-200 bg-white dark:bg-slate-900 px-3.5 py-2.5 shadow-sm">
                              <p className="text-[13px] leading-relaxed text-slate-600 dark:text-slate-400">
                                “{ansText}”
                              </p>
                              <p className="mt-1.5 flex items-center justify-end gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                                <span>{wordCount} words</span>
                                {ans?.mediaKind === 'video' ? (
                                  <span className="inline-flex items-center gap-0.5 font-medium text-sky-600">
                                    <Video className="size-3" aria-hidden /> video answer
                                    {typeof ans?.mediaSeconds === 'number'
                                      ? ` · ${fmtDur(ans.mediaSeconds)}`
                                      : ''}
                                  </span>
                                ) : ans?.audioPresent ? (
                                  <span className="inline-flex items-center gap-0.5 font-medium text-sky-600">
                                    <AudioLines className="size-3" aria-hidden /> voice answer
                                    {typeof ans?.mediaSeconds === 'number' && ans?.mediaPath
                                      ? ` · ${fmtDur(ans.mediaSeconds)}`
                                      : ''}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5">typed</span>
                                )}
                              </p>
                            </div>

                            {/* Score + feedback strip — hidden entirely in candidateView */}
                            {showScores &&
                              (scored || ans?.feedback || strengths.length > 0 || improvements.length > 0) && (
                              <div className="w-full rounded-xl border border-slate-100 dark:border-slate-800/60 bg-slate-50/80 p-2.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {scored && tone && (
                                    <Badge
                                      variant="outline"
                                      className={`${tone.cls} gap-1 rounded-full px-2 py-0 text-[11px] font-bold`}
                                    >
                                      <Sparkles className="size-3" aria-hidden /> {(ans!.score as number).toFixed(1)}/10 ·{' '}
                                      {tone.label}
                                    </Badge>
                                  )}
                                  {strengths.slice(0, 2).map((s, k) => (
                                    <span
                                      key={`s-${k}`}
                                      title={s}
                                      className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-full border border-blue-200 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-[10px] font-medium text-blue-700"
                                    >
                                      <ThumbsUp className="size-2.5 shrink-0" aria-hidden /> {s}
                                    </span>
                                  ))}
                                  {improvements.slice(0, 2).map((w, k) => (
                                    <span
                                      key={`w-${k}`}
                                      title={w}
                                      className="inline-flex max-w-[220px] items-center gap-1 truncate rounded-full border border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-medium text-amber-700"
                                    >
                                      <ThumbsDown className="size-2.5 shrink-0" aria-hidden /> {w}
                                    </span>
                                  ))}
                                </div>
                                {ans?.feedback && (
                                  <p className="mt-1.5 border-t border-dashed border-slate-200 pt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                                    <span className="font-semibold text-slate-600 dark:text-slate-400">AI feedback:</span>{' '}
                                    {ans.feedback}
                                  </p>
                                )}
                              </div>
                            )}
                          </>
                        ) : ans?.mediaPath ? (
                          <div className="w-full rounded-2xl rounded-br-md border border-dashed border-slate-200 bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2.5 text-right">
                            <p className="text-[12px] italic text-slate-400 dark:text-slate-500">
                              {ans.mediaKind === 'video' ? 'Video' : 'Audio'} answer recorded —
                              transcript was not captured.
                            </p>
                          </div>
                        ) : (
                          <div className="w-full rounded-2xl rounded-br-md border border-dashed border-slate-200 bg-slate-50 dark:bg-slate-800/60 px-3.5 py-2.5 text-right">
                            <p className="text-[12px] italic text-slate-400 dark:text-slate-500">
                              No answer was captured{ans?.audioPresent === false ? ' (silent recording)' : ''}.
                            </p>
                          </div>
                        )}
                      </div>
                    </motion.li>
                  )
                })}
                {rows.length === 0 && (
                  <li className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                    This interview has no questions or answers recorded yet.
                  </li>
                )}
              </ol>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
