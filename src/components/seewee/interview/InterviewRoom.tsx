'use client'

/**
 * InterviewRoom — SeeWe's AI Video Interview takeover.
 *
 * Phase machine: booting → welcome → (listening ⇄ scoring per question) → finalize → done
 *
 * NOTE: This component assumes the app shell renders it fullscreen whenever
 * store.view === 'interview' (shell listens for the document event
 * 'seewee:start-interview' dispatched by CandidateDashboard and calls
 * store.startInterview(shortlistId)). Every browser/media API usage is wrapped
 * defensively so permission denial can never crash the room.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Camera,
  CheckCircle2,
  Eye,
  Film,
  Keyboard,
  ListChecks,
  Loader2,
  LockKeyhole,
  LogOut,
  Mic,
  Plus,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Video,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { toast } from 'sonner'

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
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAppStore } from '@/store/app-store'
import { InterviewTranscript } from './InterviewTranscript'
import { SpeakerCheck } from './SpeakerCheck'
import type {
  AnswerRecord,
  ApiResponse,
  InterviewQuestion,
} from '@/lib/types'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Phase = 'booting' | 'welcome' | 'listening' | 'scoring' | 'finalize' | 'done'

/**
 * What the candidate's own room remembers about a submitted answer.
 * Deliberately score-free — AI evaluation never reaches the candidate's
 * device (the API strips it server-side; see /api/interview/answer).
 */
interface SubmittedAnswer {
  qIndex: number
  answerText: string | null
  preliminary: boolean
  skipped?: boolean // candidate explicitly skipped (recorded server-side too)
}

interface RoomInterviewInfo {
  id: string
  candidateName: string
  jobTitle: string
  domain: string
  difficulty: string
}

/** Raw shape POST /api/interview/start responds with */
interface StartResponseData extends RoomInterviewInfo {
  questions?: string | InterviewQuestion[]
  status?: string
  answers?: AnswerRecord[]
  resumed?: boolean
}

/** Raw shape POST /api/interview/report responds with (candidate-safe) */
interface ReportResponseData {
  id: string
  candidateName?: string
  jobTitle?: string
  domain?: string
  difficulty?: string
  status?: string
  completedAt?: string | null
  candidateCopy?: boolean
}

interface SubmitAnswerData {
  qIndex: number
  saved?: boolean
  preliminary?: boolean
}

/** A captured recording awaiting upload with the next answer submission */
interface PendingMedia {
  base64: string
  kind: 'video' | 'audio'
  seconds: number
}

/**
 * One recorded take for the current question. Takes live ONLY in memory
 * (blob + object URL, never localStorage/IndexedDB) — a discarded take is
 * NEVER uploaded, and only the SELECTED take's blob leaves the browser on
 * submit (storage discipline: the media dir never accumulates rejected
 * takes).
 */
interface TakeBlob {
  blob: Blob
  url: string
  seconds: number
  kind: 'video' | 'audio'
}

/** Per-question take slot: at most two takes (A/B) + which one is selected.
 *  `transcripts` snapshots each take's ASR draft so switching pills
 *  restores the text that belongs to the take being previewed. */
interface QuestionTakes {
  A?: TakeBlob
  B?: TakeBlob
  selected: 'A' | 'B'
  transcripts?: { A?: string; B?: string }
}

/** The take that would actually be submitted for a question (null = none). */
function selectedTakeLabel(qt: QuestionTakes | null | undefined): 'A' | 'B' | null {
  if (!qt) return null
  if (qt.selected === 'A') return qt.A ? 'A' : null
  return qt.B ? 'B' : null
}

/** Best MediaRecorder mimeType for the tracks we actually recorded */
function pickRecorderMime(withVideo: boolean): string | undefined {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return undefined
  const candidates = withVideo
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm']
  return candidates.find((c) => MediaRecorder.isTypeSupported(c))
}

/**
 * Audio capture constraints tuned for spoken answers: single mono channel,
 * browser-side echo cancellation + noise suppression + auto gain so laptop
 * mics deliver intelligible ASR input.
 */
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
}

/** Are we inside an iframe (the preview panel)? Permission fixes differ. */
function isInIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top
  } catch {
    return true // cross-origin access threw — we are framed
  }
}

interface MicFailure {
  title: string
  hint: string
}

/**
 * Acquire the microphone with precise failure diagnosis. Every denial path
 * returns an actionable hint (address-bar allow, open in new tab, device
 * busy…) instead of a generic "mic unavailable" — the #1 interview blocker.
 */
async function acquireMic(): Promise<{ ok: true; stream: MediaStream } | { ok: false; failure: MicFailure }> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined'
  ) {
    return {
      ok: false,
      failure: {
        title: "This browser can't record audio",
        hint: 'Please switch to a recent version of Chrome, Edge or Firefox for the interview.',
      },
    }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS })
    return { ok: true, stream }
  } catch (err) {
    const name = err instanceof DOMException ? err.name : ''
    const framed = isInIframe()
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return {
        ok: false,
        failure: {
          title: 'Microphone access was blocked',
          hint: framed
            ? 'Open the app in a new tab, click the lock icon in the address bar and set Microphone + Camera to Allow — then start the interview again.'
            : 'Click the lock (🔒) icon in your address bar, set Microphone to Allow, then press Retry.',
        },
      }
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return {
        ok: false,
        failure: {
          title: 'No microphone detected',
          hint: 'Connect a headset or microphone (check it is not muted at the hardware switch), then press Retry.',
        },
      }
    }
    if (name === 'NotReadableError' || name === 'AbortError') {
      return {
        ok: false,
        failure: {
          title: 'Your microphone is busy or unavailable',
          hint: 'Close other apps that may be using the mic (meetings, calls) and press Retry.',
        },
      }
    }
    return {
      ok: false,
      failure: { title: 'Microphone could not start', hint: 'Press Retry — if it keeps failing, restart the browser and rejoin.' },
    }
  }
}

/** Soft cap for one answer take — 3 minutes keeps uploads < ~12 MB and graded */
const MAX_RECORDING_SECONDS = 180

/** Hard byte cap for one uploaded take — matches the answer API's 12 MB base64
 *  ceiling (~9 MB binary). Larger takes are dropped with a heads-up instead of
 *  failing the whole submission. */
const MAX_TAKE_BYTES = 9 * 1024 * 1024

/**
 * postJson with automatic retry for TRANSIENT failures only (network blips,
 * 5xx). 4xx validation errors return immediately — retrying can't fix those.
 * Used for the two uploads that hurt most when flaky: ASR + answer submit.
 */
async function postJsonRetry<T>(
  url: string,
  body?: unknown,
  retries = 2
): Promise<{ ok: boolean; data?: T; error?: string }> {
  let last: { ok: boolean; data?: T; error?: string } = { ok: false, error: 'Network error' }
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await postJson<T>(url, body)
    if (last.ok) return last
    const transient =
      /network|failed to fetch|fetch failed|load failed/i.test(last.error ?? '') ||
      /failed \(5\d\d\)/.test(last.error ?? '')
    if (!transient || attempt === retries) return last
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1))) // 600ms, 1200ms
  }
  return last
}

export interface InterviewRoomProps {
  className?: string
}

/**
 * ONE fixed AI interviewer voice for EVERY interview (user decision — the
 * candidate is never asked to choose). 'jam' is the engine's clearest English
 * speaker; the persona stays identical from the first question to the last.
 */
const AI_VOICE = 'jam'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function postJson<T>(
  url: string,
  body?: unknown
): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const json = (await res.json().catch(() => ({}))) as ApiResponse<T>
    if (!res.ok || json.error) {
      return { ok: false, error: json.error ?? `Request failed (${res.status})` }
    }
    return { ok: true, data: json.data ?? undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

/** Read a Blob as a base64 data URL (the wire format for media upload + ASR). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('file-read-failed'))
    reader.readAsDataURL(blob)
  })
}

function parseQuestions(raw: unknown): InterviewQuestion[] {
  let obj: unknown = raw
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      obj = null
    }
  }
  if (!Array.isArray(obj)) return []
  return obj
    .filter((q): q is Record<string, unknown> => !!q && typeof q === 'object')
    .map((q, i) => {
      const limit = Number(q.timeLimitSec)
      return {
        qIndex: Number.isFinite(Number(q.qIndex)) ? Number(q.qIndex) : i,
        question: String(q.question ?? '').trim(),
        focusArea: String(q.focusArea ?? '').trim(),
        modelAnswerPoints: Array.isArray(q.modelAnswerPoints)
          ? q.modelAnswerPoints.map((p) => String(p)).filter(Boolean)
          : [],
        // Recruiter-authored answer format: VOICE = speak only, TEXT = type only,
        // VIDEO = on-camera answer (video+audio recorded, audio auto-transcribed)
        type:
          q.type === 'TEXT'
            ? ('TEXT' as const)
            : q.type === 'VIDEO'
              ? ('VIDEO' as const)
              : q.type === 'VOICE'
                ? ('VOICE' as const)
                : undefined,
        timeLimitSec: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      }
    })
    .filter((q) => q.question.length > 0)
}

function fmtClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const DIFFICULTY_META: Record<string, string> = {
  EASY: 'border-blue-200 bg-blue-50 dark:bg-blue-950/40 text-blue-700',
  MEDIUM: 'border-amber-200 bg-amber-50 dark:bg-amber-950/40 text-amber-700',
  HARD: 'border-slate-700 bg-slate-900 text-blue-300',
}

const FINALIZE_STEPS = [
  'Securing your recordings…',
  'Uploading your responses…',
  'Notifying the hiring team…',
]

/* ------------------------------------------------------------------ */
/* Small presentational bits                                           */
/* ------------------------------------------------------------------ */

/** Speaking equalizer — framer-motion bars */
function EqualizerBars({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex h-5 items-end gap-[3px] ${className}`} aria-label="AI is speaking">
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          className="w-1 origin-bottom rounded-full bg-blue-400"
          style={{ height: '100%' }}
          animate={{ scaleY: [0.25, 1, 0.35, 0.9, 0.25] }}
          transition={{
            duration: 1.05,
            repeat: Infinity,
            delay: i * 0.11,
            ease: 'easeInOut',
          }}
        />
      ))}
    </span>
  )
}

/** Shimmer sweep used while the AI evaluates an answer */
function ShimmerCard({ children }: { children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 p-8 shadow-lg">
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-blue-100/70 to-transparent"
        initial={{ x: '-140%' }}
        animate={{ x: '380%' }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function InterviewRoom({ className }: InterviewRoomProps) {
  const activeShortlistId = useAppStore((s) => s.activeShortlistId)
  const exitInterview = useAppStore((s) => s.exitInterview)
  // signed-in user (the candidate in this browser session) — used as the
  // viewerId for the score-free transcript re-entry (server tenant guard)
  const sessionUser = useAppStore((s) => s.user)

  /* ------------------------------ core state ------------------------------ */
  const [phase, setPhase] = useState<Phase>('booting')
  const [retryToken, setRetryToken] = useState(0)
  const [bootError, setBootError] = useState<string | null>(null)
  const [info, setInfo] = useState<RoomInterviewInfo | null>(null)
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [answers, setAnswers] = useState<Record<number, SubmittedAnswer>>({})
  const [currentIdx, setCurrentIdx] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [audioPresent, setAudioPresent] = useState(false)
  const [revealed, setRevealed] = useState<number | null>(null) // qIndex whose confirmation card is open
  // [build-batch-3] explicit skip — candidate can pass on a question they can't
  // answer (no mic, blank mind); the skip is recorded so the report distinguishes
  // "skipped by choice" from "no meaningful answer".
  const [skipping, setSkipping] = useState(false)
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false)
  // Master spec §18/§37 — explicit recording/transcription consent gate on the
  // welcome screen; Begin stays disabled until the candidate opts in.
  const [consentGiven, setConsentGiven] = useState(false)

  /* ------------------------------ finalize -------------------------------- */
  const [finalizeStep, setFinalizeStep] = useState(0)
  const [reportFailed, setReportFailed] = useState(false)
  /** Minimal completion info — the candidate never receives score/verdict data */
  const [finalInterview, setFinalInterview] = useState<{ id: string; jobTitle: string } | null>(null)

  /* --------------------------- AI interviewer voice ----------------------- */
  // One fixed voice for everyone — no picker, no asking (user decision).
  const aiVoiceRef = useRef(AI_VOICE)

  /* ------------------------------ media / voice --------------------------- */
  const [camState, setCamState] = useState<'off' | 'on' | 'denied'>('off')
  const [recording, setRecording] = useState(false)
  const [recHasVideo, setRecHasVideo] = useState(false)
  const [takes, setTakes] = useState<Record<string, QuestionTakes>>({})
  const [transcribing, setTranscribing] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [ttsMuted, setTtsMuted] = useState(false)
  const [ttsDead, setTtsDead] = useState(false)
  const [sessionSecs, setSessionSecs] = useState(0)
  const [recSecs, setRecSecs] = useState(0)

  /* ------------------- device pre-flight (welcome screen) ------------------ */
  // Mic check runs BEFORE the interview starts so a blocked mic is diagnosed
  // with a fix-it hint instead of being discovered mid-answer.
  type MicCheck = 'idle' | 'checking' | 'ok' | 'fail'
  const [micCheck, setMicCheck] = useState<MicCheck>('idle')
  const [micCheckHint, setMicCheckHint] = useState<string | null>(null)
  const [micCheckLevel, setMicCheckLevel] = useState(0)
  // Live issue surfaced from the recording path (listening phase banner)
  const [micIssue, setMicIssue] = useState<MicFailure | null>(null)

  /* ------------------------------ refs ------------------------------------ */
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const welcomeVideoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const audioStreamRef = useRef<MediaStream | null>(null)
  /** guards against two concurrent getUserMedia(video) acquisitions */
  const camStartingRef = useRef(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recHasVideoRef = useRef(false)
  const recStartTsRef = useRef<number | null>(null)
  /** A/B take-picker: ref mirror for reads inside async callbacks */
  const takesRef = useRef<Record<string, QuestionTakes>>({})
  /** question key the in-flight recording belongs to (nav is locked mid-rec) */
  const recQuestionKeyRef = useRef('')
  /** preview <video>/<audio> — paused before a new recording starts */
  const previewMediaRef = useRef<HTMLMediaElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  /** bump-to-invalidate: any killVoice() aborts an in-flight speak() fetch */
  const speakEpochRef = useRef(0)
  const mutedRef = useRef(false)
  const deadRef = useRef(false)
  /** confirmation card anchor — mobile auto-scrolls here after submission */
  const scoreCardRef = useRef<HTMLDivElement | null>(null)
  const inputCardRef = useRef<HTMLDivElement | null>(null)

  const infoRef = useRef<RoomInterviewInfo | null>(null)
  useEffect(() => {
    infoRef.current = info
  }, [info])

  /* ======================================================================== */
  /* AI interviewer voice — ONE fixed voice for everyone. No catalog fetch,   */
  /* no picker, no asking: every interview sounds the same, start to finish.  */
  /* ======================================================================== */



  /* ======================================================================== */
  /* Take picker — per-question A/B takes (in-memory only, max 2 per Q)        */
  /* ======================================================================== */
  const mutateTakes = useCallback((next: Record<string, QuestionTakes>) => {
    takesRef.current = next
    setTakes(next)
  }, [])

  /** Drop one question's takes — revokes BOTH object URLs (memory discipline:
  *  takes that never leave this room must not leak blob URLs). */
  const clearTakesFor = useCallback((qKey: string) => {
    const qt = takesRef.current[qKey]
    if (!qt) return
    if (qt.A) URL.revokeObjectURL(qt.A.url)
    if (qt.B) URL.revokeObjectURL(qt.B.url)
    const next = { ...takesRef.current }
    delete next[qKey]
    mutateTakes(next)
  }, [mutateTakes])

  /** Room teardown: revoke every still-alive take URL. */
  const revokeAllTakes = useCallback(() => {
    for (const key of Object.keys(takesRef.current)) {
      const qt = takesRef.current[key]
      if (qt.A) URL.revokeObjectURL(qt.A.url)
      if (qt.B) URL.revokeObjectURL(qt.B.url)
    }
    takesRef.current = {}
    setTakes({})
  }, [])

  /**
   * File a freshly recorded blob into the current question's take slot.
   * State machine: no takes → Take A; only A exists → the re-record becomes
   * Take B automatically; both exist → the recording REPLACES whichever take
   * is selected (max 2 takes; a third recording overwrites the selection).
   * Returns the label the new take received. Default selection = newest take.
   */
  function commitTake(blob: Blob, seconds: number, kind: 'video' | 'audio'): 'A' | 'B' {
    const qKey = recQuestionKeyRef.current
    const url = URL.createObjectURL(blob)
    const take: TakeBlob = { blob, url, seconds, kind }
    const prev = takesRef.current[qKey]
    let label: 'A' | 'B'
    let next: QuestionTakes
    if (!prev?.A && !prev?.B) {
      label = 'A'
      next = { A: take, selected: 'A', transcripts: { A: '' } }
    } else if (prev.A && !prev.B) {
      label = 'B'
      next = {
        A: prev.A,
        B: take,
        selected: 'B',
        transcripts: { A: prev.transcripts?.A ?? '', B: '' },
      }
    } else {
      label = prev.selected
      const old = prev[label]
      if (old) URL.revokeObjectURL(old.url) // replaced take is discarded, never uploaded
      const nextTranscripts = { ...prev.transcripts }
      if (label === 'A') nextTranscripts.A = ''
      else nextTranscripts.B = ''
      next = { A: prev.A, B: prev.B, selected: label, transcripts: nextTranscripts }
      if (label === 'A') next.A = take
      else next.B = take
    }
    mutateTakes({ ...takesRef.current, [qKey]: next })
    return label
  }

  const q = questions[currentIdx]
  const revealedAnswer = revealed != null ? answers[revealed] ?? null : null
  const answeredCount = Object.keys(answers).length
  const isLastQuestion = questions.length > 0 && currentIdx === questions.length - 1

  /** live word count with a friendly length guide (spoken answers ≈ 40–160w) */
  const wordCount = transcript.trim() ? transcript.trim().split(/\s+/).length : 0

  /* ======================================================================== */
  /* BOOT — create-or-resume via POST /api/interview/start                     */
  /* ======================================================================== */
  useEffect(() => {
    let cancelled = false
    async function boot() {
      setPhase('booting')
      setBootError(null)
      if (!activeShortlistId) {
        setBootError('No shortlisted application is selected for this interview.')
        return
      }
      const { ok, data, error } = await postJson<StartResponseData>('/api/interview/start', {
        // The store field may hold either a real shortlist id or an application id
        // (recruiter panels start from the application). Send both — the backend
        // prefers a real shortlist match and falls back to resolving by application.
        shortlistId: activeShortlistId,
        applicationId: activeShortlistId,
      })
      if (cancelled) return
      if (!ok || !data) {
        setBootError(error ?? 'Could not start the interview room.')
        return
      }
      const qs = parseQuestions(data.questions)
      const nextInfo: RoomInterviewInfo = {
        id: data.id,
        candidateName: data.candidateName,
        jobTitle: data.jobTitle,
        domain: data.domain,
        difficulty: data.difficulty ?? 'MEDIUM',
      }
      setInfo(nextInfo)
      setQuestions(qs)

      // Hydrate previously-submitted answers on resume (score-free — the API
      // strips AI evaluation from the candidate payload entirely)
      const priorAnswers: Record<number, SubmittedAnswer> = {}
      let firstUnanswered = 0
      qs.forEach((question, qi) => {
        const record = data.answers?.find((a) => a.qIndex === question.qIndex)
        if (record) {
          priorAnswers[question.qIndex] = {
            qIndex: question.qIndex,
            answerText: record.transcript ?? null,
            preliminary: question.kind === 'PRELIMINARY',
          }
          if (qi === firstUnanswered) firstUnanswered = Math.min(qi + 1, qs.length - 1)
        }
      })
      setAnswers(priorAnswers)

      // Completed interviews boot straight to the completion screen so the
      // candidate can review their own answers any time — never their AI
      // evaluation, which stays private to the hiring team.
      if (data.status === 'COMPLETED') {
        setFinalInterview({ id: data.id, jobTitle: data.jobTitle })
        setCurrentIdx(0)
        setPhase('done')
        return
      }

      if (data.resumed && Object.keys(priorAnswers).length > 0 && qs.length > 0) {
        const resumeIdx = Math.min(firstUnanswered, qs.length - 1)
        setCurrentIdx(resumeIdx)
        setPhase('listening')
        // Already finished everything before disconnecting? Drop them onto
        // the last confirmation card instead of an empty input box.
        if (Object.keys(priorAnswers).length >= qs.length) {
          setRevealed(qs[resumeIdx].qIndex)
        }
      } else {
        setCurrentIdx(0)
        setPhase('welcome')
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [activeShortlistId, retryToken])
  /* ======================================================================== */
  /* Timers                                                                    */
  /* ======================================================================== */
  useEffect(() => {
    const t = window.setInterval(() => setSessionSecs((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    if (!recording) return
    setRecSecs(0)
    const t = window.setInterval(() => setRecSecs((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [recording])

  /* ======================================================================== */
  /* Focus flow — after grading (or landing on a fresh question) keep the     */
  /* relevant card in view on small screens instead of stranding the user.    */
  /* ======================================================================== */
  useEffect(() => {
    if (phase !== 'listening') return
    if (typeof window === 'undefined') return
    const target = revealed != null ? scoreCardRef.current : inputCardRef.current
    if (!target) return
    // Only rescue small viewports — desktop's two-column layout keeps
    // everything above the fold already.
    if (window.innerWidth >= 1024) return
    const t = window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 420) // let the entrance spring begin first
    return () => window.clearTimeout(t)
  }, [phase, revealed, currentIdx])

  /* ======================================================================== */
  /* TTS — spoken questions (graceful degradation to reading mode)             */
  /* ======================================================================== */
  const killVoice = useCallback((permanent: boolean) => {
    // Invalidate ANY in-flight speak(): without this, a Stop pressed while the
    // TTS audio was still downloading would be overridden when it arrived and
    // the AI would start talking again — the exact "won't stop talking" bug.
    speakEpochRef.current += 1
    audioElRef.current?.pause()
    audioElRef.current = null
    setSpeaking(false)
    if (permanent) {
      deadRef.current = true
      setTtsDead(true)
    }
  }, [])

  const speak = useCallback(
    async (text: string) => {
      if (mutedRef.current || deadRef.current) return
      if (typeof window === 'undefined') return
      // The candidate is already answering — never talk over them
      if (recorderRef.current) return
      killVoice(false)
      const epoch = speakEpochRef.current
      try {
        // Slow, clear voice (user request: the AI must not rush the
        // questions). Speed 0.85 ≈ 15% slower. One fixed interviewer voice
        // (AI_VOICE) for every interview — the candidate is never asked.
        const { ok, data, error } = await postJson<string>('/api/tts', {
          text,
          voice: aiVoiceRef.current,
          speed: 0.85,
        })
        const url = typeof data === 'string' ? data : ''
        if (!ok || !url.startsWith('data:audio')) throw new Error(error ?? 'TTS failed')
        // Epoch changed → the user stopped/muted/superseded us while fetching.
        // Barge-in always wins over the spoken question.
        if (epoch !== speakEpochRef.current) return
        // Muted / voice dead / candidate STARTED ANSWERING while the audio was
        // being fetched — same rule.
        if (mutedRef.current || deadRef.current || recorderRef.current) return
        const el = new Audio(url)
        audioElRef.current = el
        el.onended = () => {
          if (audioElRef.current === el) setSpeaking(false)
        }
        el.onerror = () => {
          if (audioElRef.current === el) killVoice(true)
        }
        setSpeaking(true)
        await el.play() // rejection bubbles into the silent-mode branch below
      } catch {
        killVoice(true) // latch → '🔇 Voice unavailable — reading mode'
      }
    },
    [killVoice]
  )

  /** Auto-speak each question exactly once on its entrance — never mid-answer */
  useEffect(() => {
    if (phase !== 'listening') return
    const question = questions[currentIdx]
    if (question && !recorderRef.current) void speak(question.question)
  }, [phase, currentIdx])

  function toggleMute() {
    const next = !ttsMuted
    mutedRef.current = next
    setTtsMuted(next)
    if (next) killVoice(false)
    toast[next ? 'success' : 'info'](next ? 'AI voice muted' : 'AI voice on')
  }

  /* ---------------------------------------------------------------------- */
  /* Barge-in — the AI stops talking the moment the candidate starts        */
  /* answering (typing OR recording). The question stays on screen, so a    */
  /* half-heard question never blocks the answer.                           */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    if (phase === 'listening' && speaking && transcript.trim().length > 0) {
      killVoice(false)
    }
  }, [phase, speaking, transcript, killVoice])

  useEffect(() => {
    if (recording && speaking) {
      killVoice(false)
    }
  }, [recording, speaking, killVoice])

  /* ======================================================================== */
  /* Per-question answer format + time limit (recruiter-authored)              */
  /* ======================================================================== */
  // VOICE = spoken answer only (recording + ASR, no typing surface);
  // TEXT = typed answer only (no mic); VIDEO = on-camera answer (video+audio
  // recorded). The recruiter picks this per question when designing the
  // interview — the candidate cannot change it (camera-less fallback exists).
  const currentMode: 'VOICE' | 'TEXT' | 'VIDEO' =
    q?.type === 'TEXT' ? 'TEXT' : q?.type === 'VIDEO' ? 'VIDEO' : 'VOICE'
  // Mercy hatch: a device with no camera can still answer a VIDEO question
  // audio-only, clearly labelled. Resets on every question change.
  const [videoFallback, setVideoFallback] = useState(false)
  useEffect(() => {
    setVideoFallback(false)
  }, [currentIdx, phase])
  const videoMode = currentMode === 'VIDEO' && !videoFallback

  /* -------- per-question countdown (recruiter-set answer window) -------- */
  const [qTimeLeft, setQTimeLeft] = useState<number | null>(null)
  const autoSubmitRef = useRef<string>('') // guards one auto-submit per question

  const qLimit = q?.timeLimitSec ?? 0
  const qAnswered = q ? Boolean(answers[q.qIndex]) : false

  // (Re)arm the window whenever a fresh question opens
  useEffect(() => {
    if (phase === 'listening' && !revealed && !qAnswered && qLimit > 0) {
      autoSubmitRef.current = ''
      setQTimeLeft(qLimit)
    } else {
      setQTimeLeft(null)
    }
     
  }, [phase, revealed, currentIdx, qLimit])

  useEffect(() => {
    const timerActive = qTimeLeft != null && qTimeLeft > 0
    if (!timerActive) return
    const t = window.setInterval(() => {
      setQTimeLeft((s) => (s == null ? null : Math.max(0, s - 1)))
    }, 1000)
    return () => window.clearInterval(t)
  }, [qTimeLeft])

  // Time up → auto-submit (a running recording is stopped instead so the take
  // is preserved and the candidate can still press Submit).
  useEffect(() => {
    if (qTimeLeft !== 0 || phase !== 'listening' || revealed != null) return
    if (autoSubmitRef.current === String(q?.qIndex ?? '')) return
    autoSubmitRef.current = String(q?.qIndex ?? '')
    if (recording) {
      const rec = recorderRef.current
      recorderRef.current = null
      setRecording(false)
      teardownVisualizer()
      try {
        if (rec && rec.state !== 'inactive') rec.stop()
      } catch {
        /* noop */
      }
      setQTimeLeft(null)
      toast.warning('Time is up — recording stopped. Press Submit to send your answer.')
      return
    }
    setQTimeLeft(null)
    if (transcript.trim()) {
      toast.warning('Time is up — submitting your answer.')
      void submitAnswer(true)
    } else {
      toast.warning('Time is up — moving on to keep the interview fair.')
      void submitAnswer(true)
    }
     
  }, [qTimeLeft, phase, revealed])

  /* ======================================================================== */
  /* Media plumbing — camera, mic, visualizer (all fail-safe)                  */
  /* ======================================================================== */
  const releaseAudioStream = useCallback(() => {
    audioStreamRef.current?.getTracks().forEach((t) => t.stop())
    audioStreamRef.current = null
  }, [])

  const teardownVisualizer = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    try {
      void audioCtxRef.current?.close()
    } catch {
      /* noop */
    }
    audioCtxRef.current = null
    analyserRef.current = null
  }, [])

  /** 3-minute soft cap — auto-stop the take so uploads stay small + gradable */
  useEffect(() => {
    if (!recording || recSecs < MAX_RECORDING_SECONDS) return
    const rec = recorderRef.current
    recorderRef.current = null
    setRecording(false)
    teardownVisualizer()
    try {
      if (rec && rec.state !== 'inactive') rec.stop()
    } catch {
      /* noop */
    }
    toast.info(
      `Recording hit the ${Math.round(MAX_RECORDING_SECONDS / 60)}-minute limit — take saved, please submit or re-record.`
    )
  }, [recording, recSecs, teardownVisualizer])

  const setupVisualizer = useCallback(
    (stream: MediaStream) => {
      try {
        const canvas = canvasRef.current
        const Ctx =
          typeof window !== 'undefined'
            ? window.AudioContext ??
              (window as unknown as { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext
            : undefined
        if (!canvas || !Ctx) return
        const ctx = new Ctx()
        audioCtxRef.current = ctx
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 128
        ctx.createMediaStreamSource(stream).connect(analyser)
        analyserRef.current = analyser

        const dpr = window.devicePixelRatio || 1
        const w = Math.max(160, canvas.clientWidth || 280)
        const h = 44
        canvas.width = w * dpr
        canvas.height = h * dpr
        const g2d = canvas.getContext('2d')
        if (!g2d) return
        g2d.scale(dpr, dpr)
        const hasRoundRect = typeof g2d.roundRect === 'function'

        const buf = new Uint8Array(analyser.frequencyBinCount)
        const draw = () => {
          rafRef.current = requestAnimationFrame(draw)
          try {
            analyser.getByteFrequencyData(buf)
            g2d.clearRect(0, 0, w, h)
            const bars = 28
            const step = Math.floor(buf.length / bars) || 1
            const bw = w / bars - 2
            for (let i = 0; i < bars; i++) {
              const v = (buf[i * step] ?? 0) / 255
              const bh = Math.max(2, v * (h - 4))
              g2d.fillStyle = v > 0.55 ? '#60a5fa' : '#3b82f699'
              if (hasRoundRect) {
                g2d.beginPath()
                g2d.roundRect(i * (bw + 2), h - bh, bw, bh, 2)
                g2d.fill()
              } else {
                g2d.fillRect(i * (bw + 2), h - bh, bw, bh)
              }
            }
          } catch {
            /* frame errors are non-fatal */
          }
        }
        draw()
      } catch {
        /* visualizer is decorative — never fatal */
      }
    },
    []
  )

  /** Best-effort camera preview; denial falls back to the animated placeholder.
   *  Idempotent: a live stream is reused, so welcome-screen → interview never
   *  double-acquires the camera (a second getUserMedia would leak the first). */
  const startCamera = useCallback(async () => {
    if (
      cameraStreamRef.current &&
      cameraStreamRef.current.getVideoTracks().some((t) => t.readyState === 'live')
    ) {
      setCamState('on')
      return
    }
    if (camStartingRef.current) return // an acquisition is already in flight
    camStartingRef.current = true
    try {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices?.getUserMedia ||
        typeof window === 'undefined' ||
        !window.HTMLVideoElement
      ) {
        setCamState('denied')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, facingMode: 'user' },
        audio: false,
      })
      cameraStreamRef.current = stream
      setCamState('on')
    } catch {
      setCamState('denied')
    } finally {
      camStartingRef.current = false
    }
  }, [])

  /** Attach/re-attach the preview stream whenever a <video> actually mounts
   *  (the in-interview preview AND the welcome-screen camera test) */
  useEffect(() => {
    if (camState === 'on' && cameraStreamRef.current) {
      for (const el of [videoRef.current, welcomeVideoRef.current]) {
        if (el && el.srcObject !== cameraStreamRef.current) {
          try {
            el.srcObject = cameraStreamRef.current
            void el.play().catch(() => undefined)
          } catch {
            /* noop */
          }
        }
      }
    }
  }, [camState, phase])

  // Pre-interview system test: the camera starts on the WELCOME screen so the
  // candidate sees themselves (and fixes permissions) BEFORE question one.
  useEffect(() => {
    if (phase === 'welcome') void startCamera()
  }, [phase, startCamera])

  // VIDEO question active → make sure the camera preview is live (the
  // recording folds the camera track in). One auto-request per question;
  // a denial lands in the banner with the audio-only mercy option.
  useEffect(() => {
    if (phase === 'listening' && !revealed && videoMode && camState === 'off') {
      void startCamera()
    }
  }, [phase, revealed, videoMode, camState, startCamera])

  async function handleBegin() {
    // Master spec §18/§37 — record recording/transcription consent BEFORE the
    // interview starts. The start route is idempotent: this second call rides
    // the resume path and writes the ConsentRecord ledger exactly once.
    if (activeShortlistId) {
      try {
        await postJson('/api/interview/start', {
          shortlistId: activeShortlistId,
          applicationId: activeShortlistId,
          consent: true,
        })
      } catch {
        /* best-effort — a ledger hiccup must never block the interview */
      }
    }
    await startCamera()
    setPhase('listening')
  }

  /* ------------------------- device pre-flight check ----------------------- */
  /**
   * Probe the mic on the welcome screen: request access, sample ~1.2s of
   * level through an AnalyserNode, then release the stream. Reports OK only
   * when permission is granted AND the device produces audible signal —
   * everything else lands in a specific, actionable failure hint.
   */
  const runMicCheck = useCallback(async () => {
    setMicCheck('checking')
    setMicCheckHint(null)
    setMicCheckLevel(0)
    const result = await acquireMic()
    if (!result.ok) {
      setMicCheck('fail')
      setMicCheckHint(result.failure.hint)
      setMicIssue(result.failure)
      return
    }
    const stream = result.stream
    try {
      const Ctx =
        typeof window !== 'undefined'
          ? window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined
      if (!Ctx) throw new Error('no-audio-ctx')
      const ctx = new Ctx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(stream).connect(analyser)
      const buf = new Uint8Array(analyser.frequencyBinCount)
      let peak = 0
      const startedAt = Date.now()
      await new Promise<void>((resolve) => {
        const tick = () => {
          analyser.getByteFrequencyData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i]
          const avg = sum / buf.length / 255
          if (avg > peak) peak = avg
          setMicCheckLevel(avg)
          if (Date.now() - startedAt > 1200) resolve()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      try {
        void ctx.close()
      } catch {
        /* noop */
      }
      stream.getTracks().forEach((t) => t.stop())
      if (peak < 0.01) {
        setMicCheck('fail')
        setMicCheckHint(
          'Mic connected, but no sound was picked up — check the input device / hardware mute switch, then press Retry and say a few words.'
        )
        return
      }
      setMicCheck('ok')
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      // Access worked; level sampling failed — still safe to proceed
      setMicCheck('ok')
    }
  }, [])

  // Auto-run the mic probe when the welcome screen appears
  useEffect(() => {
    if (phase !== 'welcome') return
    void runMicCheck()
  }, [phase, runMicCheck])

  /* ---------------------------- recording ---------------------------- */
  async function handleRecordingStop(rec: MediaRecorder) {
    const mime = rec.mimeType || 'audio/webm'
    const kind: 'video' | 'audio' = mime.startsWith('video') ? 'video' : 'audio'
    const blob = new Blob(chunksRef.current, { type: mime })
    const seconds = Math.max(
      1,
      Math.round(((Date.now() - (recStartTsRef.current ?? Date.now())) / 1000) * 10) / 10
    )
    releaseAudioStream()
    if (blob.size < 1200) {
      toast.warning('Captured audio was too quiet — please record your answer again.')
      return
    }
    // File the take FIRST (A → B → replace-selected) so the recording survives
    // even if transcription hiccups; the ASR text is bound to it below.
    const takeLabel = commitTake(blob, seconds, kind)
    setTranscribing(true)
    try {
      const dataUrl = await blobToDataUrl(blob)
      try {
        const { ok, data, error } = await postJsonRetry<string>('/api/asr', {
          file_base64: dataUrl,
        })
        if (!ok || !data || !data.trim()) throw new Error(error ?? 'ASR returned nothing')
        // Bind the transcript to THIS take so switching pills later restores
        // the text that belongs to the take being previewed.
        const qKey = recQuestionKeyRef.current
        const qt = takesRef.current[qKey]
        if (qt) {
          const nextTranscripts = { ...qt.transcripts }
          if (takeLabel === 'A') nextTranscripts.A = data
          else nextTranscripts.B = data
          mutateTakes({
            ...takesRef.current,
            [qKey]: { ...qt, transcripts: nextTranscripts },
          })
        }
        setTranscript(data)
        setAudioPresent(true)
        toast.success(
          kind === 'video'
            ? `Take ${takeLabel} captured — transcript ready.`
            : `Take ${takeLabel} captured — ready to submit.`
        )
      } catch {
        setAudioPresent(false)
        toast.warning(
          kind === 'video'
            ? 'Recording kept, but transcription failed — please record the answer again.'
            : 'Transcription unavailable — please record again'
        )
      }
    } catch {
      setAudioPresent(false)
      toast.warning('Transcription unavailable — please record again')
    } finally {
      setTranscribing(false)
    }
  }

  async function toggleRecording() {
    if (recording) {
      const rec = recorderRef.current
      recorderRef.current = null
      setRecording(false)
      teardownVisualizer()
      try {
        if (rec && rec.state !== 'inactive') rec.stop()
      } catch {
        /* noop */
      }
      return
    }
    // Stop any take preview first so playback never fights the new recording
    try {
      previewMediaRef.current?.pause()
    } catch {
      /* noop */
    }
    // Remember which question this take belongs to (navigation is locked
    // while recording, but a ref keeps stop-time state accurate regardless)
    recQuestionKeyRef.current = String(questions[currentIdx]?.qIndex ?? '')

    // VIDEO question → the camera must be live so the answer records as video.
    // Try to start it on the spot; without it the candidate is pointed at the
    // audio-only mercy option instead of silently recording the wrong format.
    if (videoMode) {
      const camLive = () =>
        !!cameraStreamRef.current &&
        cameraStreamRef.current.getVideoTracks().some((t) => t.readyState === 'live')
      if (!camLive()) {
        await startCamera()
        if (!camLive()) {
          toast.error('Camera is required for a video answer — allow camera access, or use “Record audio only”.')
          return
        }
      }
    }

    // Classified mic acquisition — a blocked/broken mic now explains exactly
    // how to fix it instead of a generic toast.
    const mic = await acquireMic()
    if (!mic.ok) {
      setMicIssue(mic.failure)
      toast.warning(mic.failure.title, { description: mic.failure.hint })
      return
    }
    const stream = mic.stream
    audioStreamRef.current = stream
    setMicIssue(null)
    setupVisualizer(stream)

    // If the camera preview is live, fold its video track into the recording
    // so the answer is stored as a real video (not just audio).
    const camStream = cameraStreamRef.current
    const withVideo =
      !!camStream && camStream.getVideoTracks().some((t) => t.readyState === 'live')
    let recStream: MediaStream = stream
    if (withVideo && camStream) {
      recStream = new MediaStream([
        ...stream.getAudioTracks(),
        ...camStream.getVideoTracks(),
      ])
    }
    recHasVideoRef.current = withVideo
    setRecHasVideo(withVideo)
    recStartTsRef.current = Date.now()

    const mime = pickRecorderMime(withVideo)
    const rec = mime
      ? new MediaRecorder(recStream, { mimeType: mime })
      : new MediaRecorder(recStream)
    chunksRef.current = []
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onstop = () => void handleRecordingStop(rec)
    rec.start(250)
    recorderRef.current = rec
    setRecording(true)
  }

  /* ======================================================================== */
  /* Answer submission → neutral confirmation card (never shows evaluation)    */
  /* ======================================================================== */
  async function submitAnswer(force = false) {
    const question = questions[currentIdx]
    const room = infoRef.current
    if (!room || !question) return
    if (!transcript.trim() && !force) {
      toast.error(
        currentMode === 'TEXT'
          ? 'Please type your answer before submitting.'
          : 'Please record a spoken answer before submitting.'
      )
      return
    }
    killVoice(false) // answer is in — the AI never keeps talking into the next screen
    setPhase('scoring')
    // Upload ONLY the SELECTED take's blob (storage discipline: discarded
    // takes never leave the browser). Oversize takes are dropped with a
    // heads-up rather than failing the whole submission.
    const qKey = String(question.qIndex)
    const qt = takesRef.current[qKey]
    const takeLabel = selectedTakeLabel(qt)
    const take =
      takeLabel === 'A' ? qt?.A : takeLabel === 'B' ? qt?.B : undefined
    let media: PendingMedia | null = null
    if (take) {
      if (take.blob.size > MAX_TAKE_BYTES) {
        toast.info('Recording too long to attach — the transcript was submitted without it.')
      } else {
        try {
          media = {
            base64: await blobToDataUrl(take.blob),
            kind: take.kind,
            seconds: take.seconds,
          }
        } catch {
          toast.info('Recording could not be attached — the transcript was submitted without it.')
        }
      }
    }
    // Transient network blips get 2 automatic retries before we surface an error
    const answerPayload = {
      interviewId: room.id,
      qIndex: question.qIndex,
      transcript: transcript.trim(),
      audioPresent,
      ...(media ? { media_base64: media.base64, mediaSeconds: media.seconds } : {}),
      // takeLabel rides along only when its media actually attached — a
      // take-less (dropped-media) answer stays a legacy null-label row
      ...(media && takeLabel ? { takeLabel } : {}),
    }
    let { ok, data, error } = await postJsonRetry<SubmitAnswerData>(
      '/api/interview/answer',
      answerPayload
    )

    // RESILIENCE: an oversized recording must never block the spoken answer.
    // If the upload failed while carrying media (413/payload/too-large or any
    // non-validation failure), retry ONCE transcript-only — the recording is
    // sacrificed, the answer text (what ASR graded) still lands.
    if (!ok && media) {
      console.warn('[interview] media attach failed, retrying transcript-only:', error)
      const retry = await postJsonRetry<SubmitAnswerData>('/api/interview/answer', {
        interviewId: room.id,
        qIndex: question.qIndex,
        transcript: transcript.trim(),
        audioPresent,
      })
      if (retry.ok) {
        ok = retry.ok
        data = retry.data
        toast.info('Recording too large to attach — your spoken answer was submitted without it.')
      } else {
        error = retry.error
      }
    }
    if (!ok || !data) {
      toast.error(error ?? 'Submission failed — please retry.')
      setPhase('listening')
      return
    }
    // Submitted — free this question's take memory (blob refs + object URLs).
    // Takes are keyed per question, so the next question starts clean.
    clearTakesFor(qKey)

    setAnswers((prev) => ({
      ...prev,
      [question.qIndex]: {
        qIndex: question.qIndex,
        answerText: transcript.trim(),
        preliminary: question.kind === 'PRELIMINARY',
      },
    }))
    setRevealed(question.qIndex)
    setPhase('listening')

    // Score-free confirmation — evaluation stays with the hiring team
    if (question.kind === 'PRELIMINARY') {
      toast.success('Response saved to your profile')
    } else {
      toast.success('Answer submitted')
    }
  }

  /* ---------------------------------------------------------------------- */
  /* [build-batch-3] Explicit skip — recorded as a deliberate skip (score 0,  */
  /* "Candidate skipped this question") so the report tells skips apart from */
  /* weak answers. No media upload, no LLM call.                            */
  /* ---------------------------------------------------------------------- */
  async function skipQuestion() {
    const question = questions[currentIdx]
    const room = infoRef.current
    if (!room || !question || skipping) return
    if (recording) {
      toast.error('Stop the recording first, then skip the question.')
      return
    }
    setSkipping(true)
    try {
      const { ok, error } = await postJsonRetry<SubmitAnswerData>('/api/interview/answer', {
        interviewId: room.id,
        qIndex: question.qIndex,
        transcript: '',
        audioPresent: false,
        skipped: true,
      })
      if (!ok) {
        toast.error(error ?? 'Could not skip — please retry.')
        return
      }
      // Same cleanup as a normal submit: takes never leave the browser
      clearTakesFor(String(question.qIndex))
      setAnswers((prev) => ({
        ...prev,
        [question.qIndex]: {
          qIndex: question.qIndex,
          answerText: '',
          preliminary: question.kind === 'PRELIMINARY',
          skipped: true,
        },
      }))
      setRevealed(question.qIndex)
      setPhase('listening')
      toast.info('Question skipped — the hiring team will see that you chose to skip it.')
    } finally {
      setSkipping(false)
    }
  }

  /** Navigator jump — answered questions reopen on their confirmation card
   *  (review mode); unanswered ones open a fresh input box. Skipped questions
   *  also reopen fresh — answering one overwrites the skip record. */
  function gotoQuestion(idx: number) {
    const target = questions[idx]
    const currentQ = questions[currentIdx]
    if (!target) return
    // Self-click on the open (unanswered) question is a no-op — it must not
    // wipe the take/transcript the candidate just recorded.
    if (currentQ && currentQ.qIndex === target.qIndex && !answers[target.qIndex]) return
    // Takes belong to their question only: leaving discards + revokes them
    // (a take that never leaves the room is never uploaded).
    if (currentQ) clearTakesFor(String(currentQ.qIndex))
    const prior = answers[target.qIndex]
    setRevealed(prior && !prior.skipped ? target.qIndex : null)
    setTranscript('')
    setAudioPresent(false)
    setCurrentIdx(idx)
  }

  /** Select/preview a take pill: stash the current draft into the outgoing
   *  take, restore the incoming take's transcript. Pills are disabled while
   *  recording/transcribing, so this can never race an in-flight ASR. */
  function selectTake(label: 'A' | 'B') {
    const currentQ = questions[currentIdx]
    if (!currentQ) return
    const qKey = String(currentQ.qIndex)
    const qt = takesRef.current[qKey]
    if (!qt || qt.selected === label) return
    const incoming = label === 'A' ? qt.A : qt.B
    if (!incoming) return
    const nextTranscripts = { ...qt.transcripts }
    if (qt.selected === 'A') nextTranscripts.A = transcript
    else nextTranscripts.B = transcript
    mutateTakes({
      ...takesRef.current,
      [qKey]: { ...qt, selected: label, transcripts: nextTranscripts },
    })
    setTranscript(nextTranscripts[label] ?? '')
    setAudioPresent(Boolean(nextTranscripts[label]))
  }

  /** Throw away the SELECTED take (+ its transcript draft). With two takes
   *  the other one survives and becomes the selection; with none left it's a
   *  fresh start for this question. Discarded takes are never uploaded. */
  function discardTake() {
    const currentQ = questions[currentIdx]
    if (!currentQ) return
    const qKey = String(currentQ.qIndex)
    const qt = takesRef.current[qKey]
    const label = selectedTakeLabel(qt)
    if (!qt || !label) {
      // stale-draft case — original behavior: clear it
      setTranscript('')
      setAudioPresent(false)
      toast.info('Take discarded — record a fresh answer.')
      return
    }
    const doomed = label === 'A' ? qt.A : qt.B
    if (doomed) URL.revokeObjectURL(doomed.url)
    const other: 'A' | 'B' = label === 'A' ? 'B' : 'A'
    const survivor = other === 'A' ? qt.A : qt.B
    if (survivor) {
      mutateTakes({
        ...takesRef.current,
        [qKey]: {
          A: other === 'A' ? survivor : undefined,
          B: other === 'B' ? survivor : undefined,
          selected: other,
          transcripts: {
            A: other === 'A' ? qt.transcripts?.A ?? '' : undefined,
            B: other === 'B' ? qt.transcripts?.B ?? '' : undefined,
          },
        },
      })
      setTranscript(qt.transcripts?.[other] ?? '')
      setAudioPresent(Boolean(qt.transcripts?.[other]))
      toast.info(`Take ${label} discarded — Take ${other} is now selected.`)
    } else {
      clearTakesFor(qKey)
      setTranscript('')
      setAudioPresent(false)
      toast.info('Take discarded — record a fresh answer.')
    }
  }

  function handleNext() {
    if (isLastQuestion) {
      void generateReport()
      return
    }
    gotoQuestion(Math.min(currentIdx + 1, questions.length - 1))
  }

  /* ======================================================================== */
  /* Finalize — staged report generation                                       */
  /* ======================================================================== */
  const generateReport = useCallback(async () => {
    const room = infoRef.current
    if (!room) return
    setPhase('finalize')
    setReportFailed(false)
    setFinalizeStep(0)
    // The interview is ending — no take recorded from here on gets uploaded.
    revokeAllTakes()
    const ticker = window.setInterval(
      () => setFinalizeStep((s) => s + 1),
      1700
    )
    const { ok, data, error } = await postJson<ReportResponseData>('/api/interview/report', {
      interviewId: room.id,
    })
    window.clearInterval(ticker)
    if (!ok || !data) {
      setReportFailed(true)
      toast.error(error ?? 'Submission failed — you can retry below.')
      return
    }
    setFinalInterview({
      id: data.id,
      jobTitle: data.jobTitle ?? infoRef.current?.jobTitle ?? 'your interview',
    })
    setPhase('done')
    useAppStore.getState().bumpRefresh()
  }, [revokeAllTakes])

  /* ======================================================================== */
  /* Teardown                                                                  */
  /* ======================================================================== */
  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      try {
        void audioCtxRef.current?.close()
      } catch {
        /* noop */
      }
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
      audioStreamRef.current?.getTracks().forEach((t) => t.stop())
      try {
        audioElRef.current?.pause()
      } catch {
        /* noop */
      }
      revokeAllTakes()
    },
    [revokeAllTakes]
  )

  function handleExit() {
    killVoice(false)
    teardownVisualizer()
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop())
    audioStreamRef.current?.getTracks().forEach((t) => t.stop())
    revokeAllTakes() // blob URLs of unsent takes die with the room
    exitInterview()
  }

  /* ======================================================================== */
  /* Render                                                                    */
  /* ======================================================================== */

  /* ------------------------------ take picker ------------------------------ */
  /** A/B takes recorded for the CURRENT question (in-memory only) */
  const currentTakes = q ? takes[String(q.qIndex)] ?? null : null
  const selLabel = selectedTakeLabel(currentTakes)
  const selTake =
    selLabel === 'A' ? currentTakes?.A : selLabel === 'B' ? currentTakes?.B : undefined
  const hasBothTakes = Boolean(currentTakes?.A && currentTakes?.B)

  /** friendly length guide under the answer box (spoken answers ≈ 40–160w) */
  const wordHint =
    wordCount === 0
      ? { text: '', cls: 'text-slate-300' }
      : wordCount < 12
        ? { text: ' · aim for 40–150 words', cls: 'text-amber-600 dark:text-amber-300' }
        : wordCount <= 180
          ? { text: ' · good length', cls: 'text-blue-600' }
          : { text: ' · quite long — trim if you can', cls: 'text-amber-600 dark:text-amber-300' }

  return (
    <div
      className={`flex min-h-screen flex-col bg-gradient-to-b from-blue-50/40 dark:from-blue-950/40 via-white to-sky-50/30 ${className ?? ''}`}
      role="region"
      aria-label="AI interview room"
    >
      {/* ------------------------------ HEADER ------------------------------ */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-slate-200 dark:border-slate-800 bg-white/80 px-3 backdrop-blur-md sm:gap-3 sm:px-6">
        <div
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-sky-600 text-white shadow-sm"
          aria-hidden
        >
          <Eye className="size-4" />
        </div>
        <span className="truncate text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          SeeWe
        </span>
        <Badge className="hidden shrink-0 rounded-full border-blue-200 bg-blue-50 dark:bg-blue-950/40 px-2.5 text-blue-700 sm:inline-flex">
          AI Mock Room
        </Badge>
        <span className="hidden items-center gap-1 text-[11px] font-medium text-slate-400 dark:text-slate-500 md:flex">
          <LockKeyhole className="size-3 text-blue-600" aria-hidden /> Secure session
        </span>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold tabular-nums text-slate-600 dark:text-slate-400">
            <Timer className="size-3.5 text-slate-400 dark:text-slate-500" aria-hidden />
            {fmtClock(sessionSecs)}
          </span>
          {ttsMuted ? (
            <Badge
              variant="outline"
              className="rounded-full border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500"
            >
              Muted
            </Badge>
          ) : ttsDead ? (
            <Badge
              variant="outline"
              className="rounded-full border-amber-200 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] text-amber-700"
            >
              🔇 Voice unavailable — reading mode
            </Badge>
          ) : null}
          <Button
            variant="outline"
            size="icon"
            onClick={toggleMute}
            aria-label={ttsMuted ? 'Unmute AI voice' : 'Mute AI voice'}
            className="size-9 rounded-lg border-slate-200 dark:border-slate-800"
          >
            {ttsMuted ? (
              <VolumeX className="size-4 text-rose-500" />
            ) : (
              <Volume2 className="size-4 text-blue-600" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExit}
            className="min-h-[36px] rounded-lg text-slate-500 dark:text-slate-400 hover:text-slate-800"
          >
            <LogOut className="size-4" aria-hidden />
            <span className="hidden sm:inline">Exit</span>
          </Button>
        </div>
      </header>

      {/* ------------------------------ BODY ------------------------------- */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-16 pt-4 sm:px-6 lg:pt-8">
        {/* ============================ BOOTING ============================ */}
        {phase === 'booting' && (
          <div className="mx-auto max-w-md space-y-6 pt-20 text-center">
            <Loader2 className="mx-auto size-8 animate-spin text-blue-600" aria-hidden />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
              Preparing your interview room…
            </p>
            <div className="space-y-2.5 pt-4">
              <Skeleton className="h-5 w-2/3 mx-auto rounded-full" />
              <Skeleton className="h-5 w-1/2 mx-auto rounded-full" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
            {bootError && (
              <Card className="border-rose-200 dark:border-rose-900/60 text-left shadow-lg">
                <CardContent className="space-y-3 p-5">
                  <p className="flex items-center gap-2 text-sm font-medium text-rose-600 dark:text-rose-300">
                    <AlertTriangle className="size-4" aria-hidden /> {bootError}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => setRetryToken((t) => t + 1)}
                      className="min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700"
                    >
                      <RefreshCw className="size-4" aria-hidden /> Retry
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleExit}
                      className="min-h-[44px] rounded-xl"
                    >
                      Back
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* ============================ WELCOME =========================== */}
        {phase === 'welcome' && info && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="mx-auto max-w-xl"
          >
            <Card className="overflow-hidden rounded-2xl border-slate-200 dark:border-slate-800 shadow-lg">
              <div className="h-1.5 w-full bg-gradient-to-r from-blue-500 to-sky-500" aria-hidden />
              <CardContent className="space-y-6 p-6 sm:p-8">
                <div className="text-center">
                  <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">
                    You have been shortlisted 🎉
                  </p>
                  <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    {info.candidateName}
                  </h1>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    AI video interview ·{' '}
                    <span className="font-medium text-slate-700 dark:text-slate-300">{info.jobTitle}</span>
                  </p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    {info.domain && (
                      <Badge
                        variant="outline"
                        className="rounded-full border-sky-200 bg-sky-50 dark:bg-sky-950/40 text-sky-700"
                      >
                        {info.domain}
                      </Badge>
                    )}
                    <Badge
                      variant="outline"
                      className={`rounded-full ${DIFFICULTY_META[info.difficulty] ?? DIFFICULTY_META.MEDIUM}`}
                    >
                      {info.difficulty} level
                    </Badge>
                    <Badge
                      variant="outline"
                      className="rounded-full border-slate-200 bg-slate-50 text-slate-500 dark:text-slate-400"
                    >
                      {questions.length} questions
                    </Badge>
                  </div>
                </div>

                {/* question-format summary — the hiring team set exactly how each
                    answer is captured; the AI only reads the questions aloud. */}
                {questions.length > 0 && (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-950/20">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700 dark:text-blue-300">
                      How this interview works
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                      {(() => {
                        const voice = questions.filter((x) => x.type !== 'TEXT').length
                        const text = questions.length - voice
                        const parts: string[] = []
                        if (voice > 0) parts.push(`🎤 ${voice} spoken answer${voice > 1 ? 's' : ''}`)
                        if (text > 0) parts.push(`⌨️ ${text} typed answer${text > 1 ? 's' : ''}`)
                        return `The hiring team designed this interview: ${parts.join(' + ')}. The AI reads each question aloud slowly and clearly — you answer exactly in the format shown on every question.`
                      })()}
                    </p>
                  </div>
                )}

                {/* ONE fixed interviewer voice — no picker, no asking (user
                    decision). Also sets the expectation for barge-in: the AI
                    stops talking the moment the candidate starts answering. */}
                <div className="rounded-xl border border-sky-100 bg-sky-50/50 px-4 py-3 dark:border-sky-900/50 dark:bg-sky-950/20">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">
                    Your interviewer today
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    One clear, steady AI voice reads every question aloud — the
                    same voice from the first question to the last. The moment
                    you start answering (typing or speaking), the AI stops
                    talking and listens to you.
                  </p>
                </div>

                {/* pre-interview camera test — see yourself BEFORE you begin */}
                <div
                  className="relative h-44 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-800 sm:h-52"
                  aria-label={camState === 'on' ? 'Camera test — live preview' : 'Camera test'}
                >
                  <video
                    ref={welcomeVideoRef}
                    autoPlay
                    muted
                    playsInline
                    className={`absolute inset-0 size-full scale-x-[-1] object-cover ${
                      camState === 'on' ? '' : 'hidden'
                    }`}
                  />
                  {camState !== 'on' && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-slate-400 dark:text-slate-500">
                      <Camera className="size-6" aria-hidden />
                      <p className="max-w-[260px] text-center text-xs">
                        {camState === 'denied'
                          ? 'Camera unavailable — voice answers still count fully'
                          : 'Starting your camera test…'}
                      </p>
                    </div>
                  )}
                  {camState === 'on' && (
                    <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
                      <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
                      Camera ready — this is what the team sees
                    </span>
                  )}
                </div>

                {/* device pre-flight — mic + camera + speakers BEFORE the interview */}
                <div
                  className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 p-4"
                  role="status"
                  aria-label="Device check"
                >
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Device check
                  </p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                    {/* microphone */}
                    <div
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${
                        micCheck === 'ok'
                          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                          : micCheck === 'fail'
                            ? 'border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30'
                            : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                      }`}
                    >
                      {micCheck === 'checking' ? (
                        <Loader2 className="size-4 shrink-0 animate-spin text-blue-600" aria-hidden />
                      ) : micCheck === 'ok' ? (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
                      ) : (
                        <AlertTriangle className="size-4 shrink-0 text-rose-500" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                          Microphone{' '}
                          {micCheck === 'checking'
                            ? '· checking…'
                            : micCheck === 'ok'
                              ? '· ready'
                              : micCheck === 'fail'
                                ? '· needs attention'
                                : ''}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {micCheck === 'ok'
                            ? 'Your voice will be captured clearly'
                            : micCheck === 'checking'
                              ? 'Sampling your mic level…'
                              : micCheckHint ?? 'Waiting to check'}
                        </p>
                      </div>
                    </div>
                    {/* camera */}
                    <div
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 ${
                        camState === 'on'
                          ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                          : camState === 'denied'
                            ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30'
                            : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
                      }`}
                    >
                      {camState === 'on' ? (
                        <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-hidden />
                      ) : camState === 'denied' ? (
                        <AlertTriangle className="size-4 shrink-0 text-amber-500" aria-hidden />
                      ) : (
                        <Camera className="size-4 shrink-0 text-slate-400" aria-hidden />
                      )}
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                          Camera{' '}
                          {camState === 'on'
                            ? '· ready'
                            : camState === 'denied'
                              ? '· unavailable'
                              : '· will start on begin'}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          {camState === 'on'
                            ? 'Video preview will appear beside your answers'
                            : camState === 'denied'
                              ? 'Optional — voice-only answers still count fully'
                              : 'Camera turns on when the interview begins'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* speakers — hear the actual interviewer voice before Q1 */}
                  <div className="mt-2.5">
                    <SpeakerCheck />
                  </div>
                  {micCheck === 'fail' && (
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-rose-700 dark:text-rose-400">
                        You can still begin — but answers need your voice, so fixing the mic first is strongly recommended.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void runMicCheck()}
                        className="min-h-[32px] shrink-0 rounded-lg text-xs"
                        aria-label="Retry microphone check"
                      >
                        <RefreshCw className="size-3.5" aria-hidden /> Retry mic
                      </Button>
                    </div>
                  )}
                </div>

                <ul className="space-y-2.5 rounded-xl bg-slate-50/80 p-4 text-sm text-slate-600 dark:text-slate-400">
                  <li className="flex items-center gap-2.5">
                    <Mic className="size-4 shrink-0 text-blue-500" aria-hidden />
                    Answer out loud — your words are transcribed automatically.
                  </li>
                  <li className="flex items-center gap-2.5">
                    <Volume2 className="size-4 shrink-0 text-sky-500" aria-hidden />
                    Voice-only room — just speak; no typing needed.
                  </li>
                  <li className="flex items-center gap-2.5">
                    <ListChecks className="size-4 shrink-0 text-blue-500" aria-hidden />
                    {questions.length} questions · answer each one out loud, at your own pace.
                  </li>
                </ul>
                <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-blue-500" aria-hidden />
                  Private room. Nothing is broadcast live — your answers are shared only
                  with the hiring team reviewing your application.
                </p>

                {/* ---- recording + transcription consent (master spec §18/§37) ---- */}
                <label
                  htmlFor="interview-consent"
                  className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs leading-relaxed text-slate-700 transition-colors hover:bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-slate-300"
                >
                  <input
                    id="interview-consent"
                    type="checkbox"
                    checked={consentGiven}
                    onChange={(e) => setConsentGiven(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 cursor-pointer accent-amber-600"
                    aria-describedby="interview-consent-help"
                  />
                  <span>
                    <span className="font-semibold">
                      I consent to my audio/video being recorded and transcribed for this
                      interview.
                    </span>{' '}
                    The recording and transcript are shared only with the authorized hiring team
                    for recruitment review.
                    <span id="interview-consent-help" className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                      Consent is logged before recording begins. You can report a technical issue
                      to support at any time.
                    </span>
                  </span>
                </label>

                <motion.div
                  animate={{ scale: [1, 1.02, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Button
                    onClick={() => void handleBegin()}
                    disabled={questions.length === 0 || !consentGiven}
                    className="h-12 w-full rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 text-base font-semibold text-white shadow-lg shadow-blue-600/20 hover:from-blue-700 hover:to-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles className="size-5" aria-hidden />
                    Begin AI Interview ✨
                  </Button>
                  {!consentGiven && (
                    <p className="mt-1.5 text-center text-[11px] text-slate-400 dark:text-slate-500">
                      Tick the consent box above to begin — recording starts only after your yes.
                    </p>
                  )}
                </motion.div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* ====================== INTERVIEW IN PROGRESS ===================== */}
        {(phase === 'listening' || phase === 'scoring') && info && (
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-6">
            {/* ------------------------- LEFT PANE ------------------------- */}
            {/* Mobile: camera PiP + progress share one compact row so the
                question lands above the fold. Desktop (lg+): stacked sidebar. */}
            <aside className="lg:sticky lg:top-[72px] lg:w-[330px] lg:shrink-0">
              <div className="grid grid-cols-[6.25rem_1fr] items-stretch gap-3 sm:grid-cols-[8rem_1fr] lg:flex lg:flex-col lg:gap-4">
              {/* camera / placeholder */}
              <div
                className={`relative aspect-[4/5] overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-900 shadow-lg transition-shadow sm:aspect-[4/3] lg:aspect-auto lg:h-[min(40vw,224px)] ${
                  recording ? 'border-rose-300 dark:border-rose-700/60 ring-2 ring-rose-400/80' : ''
                }`}
                aria-label={
                  camState === 'on' ? 'Your camera preview' : 'Camera preview unavailable'
                }
              >
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className={`absolute inset-0 size-full scale-x-[-1] object-cover ${
                    camState === 'on' ? '' : 'hidden'
                  }`}
                />
                {camState !== 'on' && (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 sm:gap-3"
                    style={{
                      backgroundImage:
                        'radial-gradient(60% 80% at 20% 20%, rgba(59,130,246,0.35), transparent 70%), radial-gradient(50% 70% at 85% 75%, rgba(2,132,199,0.45), transparent 70%), radial-gradient(40% 60% at 50% 100%, rgba(96,165,250,0.25), transparent 70%)',
                      backgroundColor: '#0f172a',
                    }}
                  >
                    <Bot
                      className="size-6 animate-pulse text-blue-300 drop-shadow-[0_0_12px_rgba(96,165,250,0.8)] sm:size-10"
                      aria-hidden
                    />
                    <p className="hidden max-w-[220px] text-center text-xs font-medium leading-relaxed text-blue-100/80 sm:block">
                      Camera off — your voice answers still count
                    </p>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-blue-200/70 sm:hidden">
                      Cam off
                    </span>
                  </div>
                )}

                {/* rec indicator */}
                {recording && (
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-300 backdrop-blur-sm">
                    <span className="size-1.5 animate-pulse rounded-full bg-rose-500" />
                    Rec {recHasVideo ? '· video' : ''} {fmtClock(recSecs)}
                  </span>
                )}
                {/* "You" badge so candidates always know which side is live */}
                {camState === 'on' && (
                  <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
                    <span className="size-1.5 rounded-full bg-blue-400" aria-hidden />
                    You
                  </span>
                )}
                {/* audio level canvas */}
                <canvas
                  ref={canvasRef}
                  className={`absolute inset-x-0 bottom-0 h-11 w-full transition-opacity ${
                    recording ? 'opacity-90' : 'opacity-0'
                  }`}
                  aria-hidden
                />
              </div>

              {/* progress through questions — compact strip on mobile */}
              <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-md">
                <CardContent className="flex h-full flex-col justify-center gap-2 p-3 sm:p-3.5 lg:gap-3 lg:p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 lg:text-xs">
                      Progress
                    </p>
                    <p className="text-[11px] font-semibold tabular-nums text-blue-700 lg:text-xs">
                      {answeredCount}/{questions.length} answered
                    </p>
                  </div>
                  <Progress
                    value={questions.length ? (answeredCount / questions.length) * 100 : 0}
                    className="h-1 bg-slate-100 dark:bg-slate-800 lg:h-1.5 [&>[data-slot=progress-indicator]]:bg-gradient-to-r [&>[data-slot=progress-indicator]]:from-blue-500 [&>[data-slot=progress-indicator]]:to-sky-400"
                  />
                  {/* navigator — tap any dot to jump; answered ones reopen
                      their score card for review */}
                  <div
                    className="flex flex-wrap items-center gap-1.5 lg:gap-2 lg:pt-1"
                    aria-label="Question navigator"
                  >
                    {questions.map((_, i) => {
                      const qi = questions[i]?.qIndex ?? i
                      const done = Boolean(answers[qi])
                      const current = i === currentIdx
                      const navDisabled = phase !== 'listening' || recording || transcribing
                      return (
                        <button
                          key={i}
                          type="button"
                          onClick={() => gotoQuestion(i)}
                          disabled={navDisabled}
                          aria-label={`Question ${i + 1}${done ? ' · answered — review your answer' : ''}`}
                          aria-current={current ? 'step' : undefined}
                          title={`Question ${i + 1}${done ? ' · answered' : ''}`}
                          className={`grid size-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold tabular-nums transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 lg:size-7 lg:text-[11px] ${
                            current
                              ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                              : done
                                ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-700 hover:border-blue-400 hover:shadow-sm'
                                : 'border-dashed border-slate-300 bg-white text-slate-400 dark:text-slate-500 hover:border-blue-400 hover:text-blue-600'
                          }`}
                        >
                          {done && !current ? (
                            <CheckCircle2 className="size-3.5 lg:size-4" aria-hidden />
                          ) : (
                            <span className="relative grid place-items-center">
                              {current && (
                                <span
                                  className="absolute inset-0 animate-ping rounded-full bg-blue-400/40"
                                  aria-hidden
                                />
                              )}
                              <span className="relative">{i + 1}</span>
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
              </div>
            </aside>

            {/* ------------------------- RIGHT PANE ------------------------ */}
            <section className="min-w-0 flex-1 space-y-5">
              {/* AI persona (allowed dark exception) — slim strip on mobile */}
              <div className="relative flex items-center gap-3 overflow-hidden rounded-2xl bg-slate-900 p-3.5 shadow-lg ring-1 ring-blue-500/40 shadow-[0_0_28px_-10px_rgba(59,130,246,0.5)] sm:gap-4 sm:p-5">
                <div className="relative shrink-0">
                  <div className="grid size-10 place-items-center rounded-full bg-gradient-to-br from-blue-400 to-sky-500 text-slate-900 dark:text-slate-100 shadow-[0_0_18px_-2px_rgba(96,165,250,0.8)] sm:size-12">
                    <Bot className="size-5 text-slate-900 dark:text-slate-100 sm:size-6" aria-hidden />
                  </div>
                  <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-slate-900 bg-blue-400 sm:size-3" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold text-white">
                      SeeWe AI Interviewer
                    </p>
                    {info.domain && (
                      <span className="hidden shrink-0 rounded-full border border-blue-400/30 bg-blue-400/10 px-2 py-0.5 text-[10px] font-semibold text-blue-300 sm:inline">
                        {info.domain}
                      </span>
                    )}
                  </div>
                  <p className="flex items-center gap-1.5 truncate text-[11px] text-slate-400 dark:text-slate-500 sm:text-xs">
                    <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-blue-400" aria-hidden />
                    Online · evaluating in real-time
                  </p>
                </div>
                {speaking ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <EqualizerBars />
                    <button
                      type="button"
                      onClick={() => killVoice(false)}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-blue-400/40 bg-blue-400/10 px-2.5 text-[11px] font-bold text-blue-200 transition-colors hover:bg-blue-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                      aria-label="Stop the AI voice"
                      title="The AI also stops by itself the moment you start answering"
                    >
                      <VolumeX className="size-3.5" aria-hidden /> Stop
                    </button>
                  </div>
                ) : (
                  <Volume2 className="size-4 shrink-0 text-blue-400/70" aria-label="Voice ready" />
                )}
              </div>

              {/* SCORING shimmer state replaces input area */}
              {phase === 'scoring' && (
                <ShimmerCard>
                  <div className="flex flex-col items-center gap-4 py-6 text-center">
                    <Loader2 className="size-7 animate-spin text-blue-600" aria-hidden />
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">AI evaluating…</p>
                    <div className="w-full max-w-sm space-y-2 pt-2">
                      <Skeleton className="h-4 w-3/4 rounded-full" />
                      <Skeleton className="h-4 w-2/3 rounded-full" />
                      <Skeleton className="h-4 w-1/2 rounded-full" />
                    </div>
                  </div>
                </ShimmerCard>
              )}

              {/* ---------------------- QUESTION CARD ----------------------- */}
              {phase === 'listening' && q && (
                <>
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={q.qIndex}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.25 }}
                      className="space-y-5"
                    >
                      <Card className="rounded-2xl border-slate-200 dark:border-slate-800 p-0 shadow-lg">
                        <CardContent className="space-y-4 p-6">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                              Question {currentIdx + 1} of {questions.length}
                            </span>
                            <div className="flex flex-wrap items-center gap-2">
                              {/* recruiter-authored answer format chip */}
                              <Badge
                                variant="outline"
                                className={`rounded-full px-2.5 text-[11px] font-semibold ${
                                  currentMode === 'VOICE'
                                    ? 'border-blue-200 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/40 text-blue-700'
                                    : currentMode === 'VIDEO'
                                      ? 'border-violet-200 bg-violet-50 dark:border-violet-900/60 dark:bg-violet-950/40 text-violet-700'
                                      : 'border-teal-200 bg-teal-50 dark:border-teal-900/60 dark:bg-teal-950/40 text-teal-700'
                                }`}
                              >
                                {currentMode === 'VOICE' ? (
                                  <>🎤 Voice answer — speak, no typing</>
                                ) : currentMode === 'VIDEO' ? (
                                  <>📹 Video answer — the team watches your recording</>
                                ) : (
                                  <>⌨️ Typed answer — type below</>
                                )}
                              </Badge>
                              {/* recruiter-set answer window */}
                              {qTimeLeft != null && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tabular-nums ${
                                    qTimeLeft <= 30
                                      ? 'border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/40 text-rose-600 animate-pulse'
                                      : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900 text-slate-500'
                                  }`}
                                  aria-live="off"
                                >
                                  <Timer className="size-3" aria-hidden />
                                  {fmtClock(qTimeLeft)}
                                </span>
                              )}
                              {q.focusArea && (
                                <Badge
                                  variant="outline"
                                  className="rounded-full border-sky-200 bg-sky-50 dark:bg-sky-950/40 text-sky-700"
                                >
                                  {q.focusArea}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <p className="text-lg font-medium leading-relaxed text-slate-900 dark:text-slate-100">
                            {q.question}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={ttsDead || ttsMuted || recording}
                              onClick={() =>
                                speaking ? killVoice(false) : void speak(q.question)
                              }
                              className="min-h-[38px] rounded-lg"
                              aria-label={
                                speaking ? 'Stop the AI voice' : 'Replay the question aloud'
                              }
                            >
                              {speaking ? (
                                <>
                                  <VolumeX className="size-4 text-rose-500" aria-hidden /> Stop
                                  voice
                                </>
                              ) : (
                                <>
                                  <Volume2 className="size-4 text-blue-600" aria-hidden /> Replay
                                </>
                              )}
                            </Button>
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">
                              {speaking
                                ? 'Start answering any time — the AI stops talking automatically.'
                                : 'The AI reads every question aloud — slowly and clearly.'}
                            </span>
                          </div>
                        </CardContent>
                      </Card>

                      {/* ------- ANSWER-RECEIVED CARD (score-free) or INPUT ------- */}
                      {revealedAnswer ? (
                        <motion.div
                          ref={scoreCardRef}
                          initial={{ opacity: 0, scale: 0.94, y: 12 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          transition={{ type: 'spring', stiffness: 220, damping: 18 }}
                          className="scroll-mt-20"
                        >
                          <Card className="rounded-2xl border border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
                            <CardContent className="space-y-5 p-6">
                              <div className="flex items-center gap-4">
                                <span
                                  className={`grid size-14 shrink-0 place-items-center rounded-2xl text-white shadow-md ${
                                    revealedAnswer.skipped
                                      ? 'bg-gradient-to-br from-slate-500 to-slate-700 shadow-slate-600/25'
                                      : 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-600/25'
                                  }`}
                                  aria-hidden
                                >
                                  {revealedAnswer.skipped ? (
                                    <SkipForward className="size-7" />
                                  ) : (
                                    <CheckCircle2 className="size-7" />
                                  )}
                                </span>
                                <div>
                                  {revealedAnswer.skipped ? (
                                    <>
                                      <p className="text-sm font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">
                                        Question skipped
                                      </p>
                                      <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                                        No problem — you chose to skip this one. You can still go
                                        back and answer it before finishing the interview.
                                      </p>
                                    </>
                                  ) : (
                                    <>
                                      <p className="text-sm font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                                        Answer received
                                      </p>
                                      <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                                        {revealedAnswer.preliminary
                                          ? 'Saved — this response syncs straight to your candidate profile.'
                                          : 'Your response is safely recorded. The hiring team reviews every answer after the interview.'}
                                      </p>
                                    </>
                                  )}
                                </div>
                              </div>

                              {/* review: what the candidate actually said */}
                              {revealedAnswer.answerText && (
                                <details className="group rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4" open>
                                  <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 group-open:text-slate-600">
                                    Your answer
                                  </summary>
                                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                                    {revealedAnswer.answerText}
                                  </p>
                                </details>
                              )}

                              <div className="flex justify-end">
                                <Button
                                  onClick={handleNext}
                                  className="min-h-[48px] rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 px-6 text-sm font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700"
                                >
                                  {isLastQuestion ? (
                                    <>Finish &amp; Submit</>
                                  ) : (
                                    <>Next Question ➜</>
                                  )}
                                  {!isLastQuestion && (
                                    <ArrowRight className="size-4" aria-hidden />
                                  )}
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        </motion.div>
                      ) : (
                        <Card
                          ref={inputCardRef}
                          className="scroll-mt-20 rounded-2xl border-slate-200 dark:border-slate-800 shadow-lg"
                        >
                          <CardContent className="space-y-3 p-6">
                            {/* ============ TYPED-ANSWER QUESTION (recruiter set TEXT) ============ */}
                            {currentMode === 'TEXT' ? (
                              <>
                                <div
                                  aria-live="polite"
                                  aria-label="Type your answer"
                                  className="space-y-2"
                                >
                                  <Textarea
                                    value={transcript}
                                    onChange={(e) => {
                                      setTranscript(e.target.value)
                                      setAudioPresent(false)
                                    }}
                                    rows={6}
                                    maxLength={4000}
                                    placeholder="Type your answer here — take your time and be specific."
                                    aria-label="Your typed answer"
                                    className="min-h-[150px] resize-y rounded-xl border-slate-200 text-[15px] leading-relaxed dark:border-slate-800"
                                  />
                                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                                    ⌨️ The hiring team set this as a typed question — your written answer
                                    is what gets reviewed.
                                  </p>
                                </div>
                                <div className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className={`font-medium tabular-nums ${wordHint.cls}`}>
                                    {wordCount} {wordCount === 1 ? 'word' : 'words'}
                                    {wordHint.text}
                                  </span>
                                  <span className="hidden items-center gap-1 text-slate-300 sm:inline-flex">
                                    <Keyboard className="size-3" aria-hidden /> Typed answer
                                  </span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2.5">
                                  {/* [build-batch-3] explicit skip (typed question) */}
                                  <Button
                                    variant="ghost"
                                    onClick={() => setSkipConfirmOpen(true)}
                                    disabled={skipping || recording}
                                    className="ml-auto min-h-[44px] rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                                  >
                                    <SkipForward className="size-4" aria-hidden /> Skip question
                                  </Button>
                                  <Button
                                    onClick={() => void submitAnswer()}
                                    disabled={transcribing || recording}
                                    className="min-h-[44px] rounded-xl bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700"
                                  >
                                    Submit Answer ➜
                                    <ArrowRight className="size-4" aria-hidden />
                                  </Button>
                                </div>
                              </>
                            ) : (
                              <>
                            {/* ============ VIDEO-ANSWER banner (camera gate) ============ */}
                            {videoMode && camState !== 'on' && (
                              <div
                                role="status"
                                className="flex flex-col gap-2 rounded-xl border border-violet-200 bg-violet-50 p-3.5 dark:border-violet-900/60 dark:bg-violet-950/30 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="flex min-w-0 items-start gap-2.5">
                                  <Video className="mt-0.5 size-4 shrink-0 text-violet-600" aria-hidden />
                                  <div className="min-w-0">
                                    <p className="text-[13px] font-semibold text-violet-800 dark:text-violet-300">
                                      {camState === 'denied'
                                        ? 'Camera blocked — a video answer needs it'
                                        : 'This is a video question — turn on your camera'}
                                    </p>
                                    <p className="mt-0.5 text-xs leading-relaxed text-violet-700/90 dark:text-violet-400/90">
                                      The hiring team set this as an on-camera answer. Your face +
                                      voice get recorded together. No camera? Audio-only is allowed.
                                    </p>
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-wrap items-center gap-2">
                                  <Button
                                    size="sm"
                                    onClick={() => void startCamera()}
                                    className="min-h-[34px] rounded-lg bg-violet-600 text-xs text-white hover:bg-violet-700"
                                    aria-label="Enable camera for video answer"
                                  >
                                    <Video className="size-3.5" aria-hidden /> Enable camera
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setVideoFallback(true)
                                      toast.info('Recording audio only for this question.')
                                    }}
                                    className="min-h-[34px] rounded-lg text-xs text-violet-700 hover:bg-violet-100 dark:text-violet-300"
                                  >
                                    Record audio only
                                  </Button>
                                </div>
                              </div>
                            )}
                            {currentMode === 'VIDEO' && !videoMode && (
                              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
                                ⚠️ Audio-only mode — the hiring team asked for a video answer, but the
                                camera is unavailable on this device.
                              </p>
                            )}
                            {/* mic problem? actionable banner with retry guidance */}
                            {micIssue && (
                              <div
                                role="alert"
                                className="flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 dark:border-rose-900/60 dark:bg-rose-950/30 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="flex min-w-0 items-start gap-2.5">
                                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-500" aria-hidden />
                                  <div className="min-w-0">
                                    <p className="text-[13px] font-semibold text-rose-800 dark:text-rose-300">
                                      {micIssue.title}
                                    </p>
                                    <p className="mt-0.5 text-xs leading-relaxed text-rose-700/90 dark:text-rose-400/90">
                                      {micIssue.hint}
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void toggleRecording()}
                                  className="min-h-[34px] shrink-0 rounded-lg text-xs"
                                  aria-label="Retry microphone"
                                >
                                  <RefreshCw className="size-3.5" aria-hidden /> Try mic again
                                </Button>
                              </div>
                            )}
                            {/* Voice-only room: the ASR transcript is read-only — no typing surface */}
                            <div
                              aria-live="polite"
                              aria-label="Auto-transcribed answer preview"
                              className={`min-h-[140px] rounded-xl border p-4 text-[15px] leading-relaxed ${
                                transcript.trim()
                                  ? 'border-blue-200 bg-blue-50/60 text-slate-700 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-slate-200'
                                  : 'border-dashed border-slate-300 bg-slate-50/60 text-slate-400 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-500'
                              }`}
                            >
                              {transcript.trim() ? (
                                <p className="whitespace-pre-wrap">{transcript}</p>
                              ) : (
                                <span className="flex min-h-[110px] flex-col items-center justify-center gap-2 text-center text-sm">
                                  <Mic className="size-5 text-blue-400" aria-hidden />
                                  Press “Record Answer” and speak — your words appear here
                                  automatically.
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[11px]">
                              <span className={`font-medium tabular-nums ${wordHint.cls}`}>
                                {wordCount} {wordCount === 1 ? 'word' : 'words'}
                                {wordHint.text}
                              </span>
                              <span className="hidden items-center gap-1 text-slate-300 sm:inline-flex">
                                {videoMode ? (
                                  <>
                                    <Video className="size-3" aria-hidden /> Video answer — on camera
                                  </>
                                ) : (
                                  <>
                                    <Volume2 className="size-3" aria-hidden /> Voice-only interview
                                  </>
                                )}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2.5">
                              <Button
                                type="button"
                                variant={recording ? 'default' : 'outline'}
                                onClick={() => void toggleRecording()}
                                disabled={transcribing}
                                aria-label={
                                  recording
                                    ? 'Stop recording'
                                    : hasBothTakes
                                      ? `Re-record over Take ${selLabel ?? ''}`
                                      : currentTakes?.A
                                        ? 'Record a second take (Take B)'
                                        : 'Start recording your answer'
                                }
                                title={
                                  recording
                                    ? undefined
                                    : hasBothTakes
                                      ? `Records over Take ${selLabel ?? ''} — max 2 takes; submit your best`
                                      : currentTakes?.A
                                        ? 'Records Take B — then compare both and submit your best'
                                        : undefined
                                }
                                className={`min-h-[44px] rounded-xl ${
                                  recording
                                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                                    : 'border-slate-200 text-slate-700 dark:text-slate-300'
                                }`}
                              >
                                {recording ? (
                                  <>
                                    <Square className="size-4 text-rose-400" aria-hidden />
                                    Stop ({fmtClock(recSecs)})
                                  </>
                                ) : hasBothTakes ? (
                                  <>
                                    {videoMode ? (
                                      <Video className="size-4 text-blue-600" aria-hidden />
                                    ) : (
                                      <Mic className="size-4 text-blue-600" aria-hidden />
                                    )}
                                    Re-record Take {selLabel}
                                  </>
                                ) : currentTakes?.A ? (
                                  <>
                                    <Plus className="size-4 text-blue-600" aria-hidden />
                                    Add Take B
                                  </>
                                ) : (
                                  <>
                                    {videoMode ? (
                                      <Video className="size-4 text-blue-600" aria-hidden />
                                    ) : (
                                      <Mic className="size-4 text-blue-600" aria-hidden />
                                    )}
                                    {videoMode ? '📹 Record Video Answer' : '🎙 Record Answer'}
                                  </>
                                )}
                              </Button>
                              {transcribing && (
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                                  <Loader2 className="size-3.5 animate-spin text-blue-600" aria-hidden />
                                  Transcribing…
                                </span>
                              )}
                              {recording && (
                                <span
                                  className={`inline-flex flex-col gap-1 rounded-xl border px-2.5 py-1.5 ${
                                    recSecs >= MAX_RECORDING_SECONDS - 30
                                      ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/40'
                                      : 'border-rose-200 bg-rose-50 dark:bg-rose-950/40'
                                  }`}
                                  aria-live="polite"
                                >
                                  <span
                                    className={`inline-flex items-center gap-1.5 text-[11px] font-bold tabular-nums ${
                                      recSecs >= MAX_RECORDING_SECONDS - 30
                                        ? 'text-amber-700 dark:text-amber-300'
                                        : 'text-rose-600 dark:text-rose-300'
                                    }`}
                                  >
                                    <span
                                      className={`size-1.5 animate-pulse rounded-full ${
                                        recSecs >= MAX_RECORDING_SECONDS - 30
                                          ? 'bg-amber-500'
                                          : 'bg-rose-500'
                                      }`}
                                      aria-hidden
                                    />
                                    REC {recHasVideo ? 'video' : 'audio'} · {fmtClock(recSecs)}
                                    <span className="font-medium text-slate-400 dark:text-slate-500">
                                      / {fmtClock(MAX_RECORDING_SECONDS)}
                                    </span>
                                  </span>
                                  {/* time-used progress rail — turns amber near the cap */}
                                  <span className="block h-1 w-36 overflow-hidden rounded-full bg-rose-100 dark:bg-rose-900/40" aria-hidden>
                                    <span
                                      className={`block h-full rounded-full transition-all duration-1000 ease-linear ${
                                        recSecs >= MAX_RECORDING_SECONDS - 30
                                          ? 'bg-amber-500'
                                          : 'bg-rose-500'
                                      }`}
                                      style={{
                                        width: `${Math.min(100, (recSecs / MAX_RECORDING_SECONDS) * 100)}%`,
                                      }}
                                    />
                                  </span>
                                </span>
                              )}
                              {/* [build-batch-3] explicit skip (voice question — no mic / blank mind) */}
                              <Button
                                variant="ghost"
                                onClick={() => setSkipConfirmOpen(true)}
                                disabled={skipping || recording || transcribing}
                                className="min-h-[44px] rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                              >
                                <SkipForward className="size-4" aria-hidden /> Skip question
                              </Button>
                              <Button
                                onClick={() => void submitAnswer()}
                                disabled={transcribing || recording}
                                className="ml-auto min-h-[44px] rounded-xl bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700"
                              >
                                {selTake ? `Submit Take ${selLabel}` : 'Submit Answer'} ➜
                                <ArrowRight className="size-4" aria-hidden />
                              </Button>
                            </div>

                            {/* ------------- TAKE STRIP (A/B picker) -------------
                                Appears once a take exists for this question.
                                Takes live only in memory; only the SELECTED
                                take is uploaded on submit. Hidden while
                                recording/transcribing to keep the card calm. */}
                            {!recording && !transcribing && selTake && currentTakes && (
                              <div className="space-y-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="inline-flex min-w-0 items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                                    {selTake.kind === 'video' ? (
                                      <Video className="size-3 shrink-0 text-sky-600" aria-hidden />
                                    ) : (
                                      <Film className="size-3 shrink-0 text-blue-600" aria-hidden />
                                    )}
                                    <span className="truncate">
                                      Preview · Take {selLabel} · {fmtClock(Math.round(selTake.seconds))}
                                    </span>
                                  </span>
                                  <button
                                    type="button"
                                    onClick={discardTake}
                                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold text-slate-400 dark:text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                                    aria-label={`Discard Take ${selLabel}`}
                                    title={`Discard Take ${selLabel}${hasBothTakes ? ' — your other take stays' : ''}`}
                                  >
                                    <Trash2 className="size-3" aria-hidden /> Discard
                                  </button>
                                </div>
                                {selTake.kind === 'video' ? (
                                  <video
                                    key={selTake.url}
                                    ref={(el) => {
                                      previewMediaRef.current = el
                                    }}
                                    src={selTake.url}
                                    controls
                                    playsInline
                                    className="max-h-56 w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-950"
                                    aria-label={`Preview of Take ${selLabel} (video)`}
                                  />
                                ) : (
                                  <audio
                                    key={selTake.url}
                                    ref={(el) => {
                                      previewMediaRef.current = el
                                    }}
                                    src={selTake.url}
                                    controls
                                    className="w-full"
                                    aria-label={`Preview of Take ${selLabel} (audio)`}
                                  />
                                )}
                                {hasBothTakes && (
                                  <>
                                    <div
                                      className="flex flex-wrap items-center gap-1.5"
                                      role="group"
                                      aria-label="Choose which take to submit"
                                    >
                                      {(['A', 'B'] as const).map((label) => {
                                        const t =
                                          label === 'A' ? currentTakes.A : currentTakes.B
                                        if (!t) return null
                                        const active = selLabel === label
                                        return (
                                          <button
                                            key={label}
                                            type="button"
                                            onClick={() => selectTake(label)}
                                            aria-pressed={active}
                                            title={`Preview Take ${label} — the selected take is the one submitted`}
                                            className={`inline-flex min-h-[30px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 ${
                                              active
                                                ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                                                : 'border-slate-200 bg-white text-slate-600 dark:text-slate-400 hover:border-blue-400 hover:text-blue-700'
                                            }`}
                                          >
                                            {t.kind === 'video' ? (
                                              <Video className="size-3" aria-hidden />
                                            ) : (
                                              <Mic className="size-3" aria-hidden />
                                            )}
                                            Take {label} · {fmtClock(Math.round(t.seconds))}
                                          </button>
                                        )
                                      })}
                                    </div>
                                    <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                                      Compare both takes, then submit your best.
                                    </p>
                                  </>
                                )}
                              </div>
                            )}
                              </>
                            )}
                          </CardContent>
                        </Card>
                      )}
                    </motion.div>
                  </AnimatePresence>
                </>
              )}
            </section>
          </div>
        )}

        {/* ============================ FINALIZE ========================== */}
        {phase === 'finalize' && (
          <div className="mx-auto max-w-lg space-y-6 pt-16 text-center">
            <ShimmerCard>
              <div className="flex flex-col items-center gap-5 py-8">
                <div className="relative">
                  <Bot className="size-12 text-blue-600" aria-hidden />
                  <Sparkles className="absolute -right-2 -top-2 size-5 animate-pulse text-sky-500" aria-hidden />
                </div>
                <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  Wrapping up your interview
                </p>
                <Progress
                  value={Math.min(92, ((finalizeStep % FINALIZE_STEPS.length) + 1) * 31)}
                  className="h-2 w-full max-w-xs [&>[data-slot=progress-indicator]]:bg-blue-500"
                />
                <AnimatePresence mode="wait">
                  <motion.p
                    key={finalizeStep % FINALIZE_STEPS.length}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="text-xs font-medium text-slate-400 dark:text-slate-500"
                  >
                    {FINALIZE_STEPS[finalizeStep % FINALIZE_STEPS.length]}
                  </motion.p>
                </AnimatePresence>
                {reportFailed && (
                  <div className="space-y-3 pt-2">
                    <p className="flex items-center justify-center gap-1.5 text-xs text-rose-600 dark:text-rose-300">
                      <AlertTriangle className="size-3.5" aria-hidden />
                      Something interrupted the submission.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => void generateReport()}
                      className="min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700"
                    >
                      <RefreshCw className="size-4" aria-hidden /> Retry submission
                    </Button>
                  </div>
                )}
              </div>
            </ShimmerCard>
          </div>
        )}

        {/* ============================== DONE ============================= */}
        {phase === 'done' && finalInterview && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="mx-auto max-w-3xl"
          >
            <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Interview complete 🎉
                </h1>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Your responses are on their way to the hiring team for {finalInterview.jobTitle}.
                </p>
              </div>
              <Button
                onClick={handleExit}
                variant="outline"
                className="min-h-[44px] shrink-0 rounded-xl border-slate-200 dark:border-slate-800"
              >
                <LogOut className="size-4" aria-hidden /> Exit to Dashboard
              </Button>
            </div>

            {/* Score-free completion summary — what happens next. AI evaluation
                (score / verdict / report) is private to the hiring team. */}
            <Card className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-lg dark:border-slate-800 dark:bg-slate-900">
              <CardContent className="space-y-5 p-6">
                <div className="flex items-center gap-4">
                  <span
                    className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-600/25"
                    aria-hidden
                  >
                    <CheckCircle2 className="size-7" />
                  </span>
                  <div>
                    <p className="text-base font-bold text-slate-900 dark:text-slate-100">
                      All responses submitted
                    </p>
                    <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                      {Object.keys(answers).length} of {questions.length} answered · session {fmtClock(sessionSecs)}
                    </p>
                  </div>
                </div>
                <ol className="space-y-2.5">
                  {[
                    'Your recordings and transcripts are securely stored.',
                    'The hiring team reviews every answer individually.',
                    'Updates and next steps arrive in My Journey & your notifications.',
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-400">
                      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300" aria-hidden>
                        {i + 1}
                      </span>
                      {step}
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

            {/* Self-review: candidates rewatch their own recordings and read
                their own answers — score-free (candidateView transcript) */}
            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2">
                <Video className="size-4 text-sky-600" aria-hidden />
                <h2 className="text-sm font-bold tracking-tight text-slate-800 dark:text-slate-200">
                  Review your answers
                </h2>
                <span className="text-[11px] text-slate-400 dark:text-slate-500">
                  watch your recordings and read what you said
                </span>
              </div>
              <InterviewTranscript
                interviewId={finalInterview.id}
                candidateView
                viewerId={sessionUser?.id ?? undefined}
              />
            </div>
          </motion.div>
        )}
      </main>

      {/* [build-batch-3] Skip confirmation — the skip is recorded and shown to
          the hiring team, so make it a deliberate two-step action */}
      <AlertDialog open={skipConfirmOpen} onOpenChange={setSkipConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip this question?</AlertDialogTitle>
            <AlertDialogDescription>
              The hiring team will see that you chose to skip it, and it will
              count as unanswered in your report. You can still go back to it
              later from the question navigator — before finishing the
              interview.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep answering</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void skipQuestion()}
              className="bg-slate-600 text-white hover:bg-slate-700"
            >
              <SkipForward className="mr-1.5 size-4" aria-hidden /> Skip question
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
