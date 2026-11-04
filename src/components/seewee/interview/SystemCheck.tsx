'use client'

/**
 * SystemCheck — pre-interview device permission test (mic + camera).
 *
 * Two pass/fail rows probe the real hardware: the microphone row samples
 * ~1.2s of live level (permission granted AND signal detected = PASS), the
 * camera row just needs a live video track. Every failure lands in a
 * specific, actionable hint instead of a generic "device unavailable".
 *
 * Used by TokenInterviewGate before the interview room opens in token mode;
 * it is deliberately standalone (no store access) so it also works logged-out.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  Mic,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SpeakerCheck } from './SpeakerCheck'

type CheckState = 'idle' | 'checking' | 'pass' | 'fail'

interface CheckFailure {
  hint: string
}

const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
}

/** Same failure taxonomy as the interview room — consistent candidate guidance */
function diagnose(err: unknown, device: 'microphone' | 'camera'): CheckFailure {
  const name = err instanceof DOMException ? err.name : ''
  const label = device === 'microphone' ? 'Microphone' : 'Camera'
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      hint: `Click the lock (🔒) icon in your address bar, set ${label} to Allow, then press Retry. In the preview panel, open this page in a new tab first.`,
    }
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return { hint: `No ${device} detected — connect one (check hardware mute/privacy shutters), then press Retry.` }
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return { hint: `Your ${device} is busy — close other apps using it (meetings, calls), then press Retry.` }
  }
  return { hint: `${label} could not start — press Retry; if it keeps failing, restart your browser.` }
}

interface SystemCheckProps {
  /** Called when the candidate presses Continue (regardless of failures) */
  onContinue: () => void
  jobTitle?: string
  companyName?: string
  candidateName?: string
}

export function SystemCheck({ onContinue, jobTitle, companyName, candidateName }: SystemCheckProps) {
  const [micState, setMicState] = useState<CheckState>('idle')
  const [micHint, setMicHint] = useState<string | null>(null)
  const [micLevel, setMicLevel] = useState(0)
  const [camState, setCamState] = useState<CheckState>('idle')
  const [camHint, setCamHint] = useState<string | null>(null)

  const levelRafRef = useRef<number | null>(null)
  const camPreviewRef = useRef<HTMLVideoElement | null>(null)
  const camStreamRef = useRef<MediaStream | null>(null)

  /** Run both probes once on mount (StrictMode-safe via a run ref) */
  const startedRef = useRef(false)

  const stopCamera = useCallback(() => {
    camStreamRef.current?.getTracks().forEach((t) => t.stop())
    camStreamRef.current = null
  }, [])

  const runMicCheck = useCallback(async () => {
    setMicState('checking')
    setMicHint(null)
    setMicLevel(0)
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS })
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
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
          setMicLevel(avg)
          if (Date.now() - startedAt > 1200) resolve()
          else levelRafRef.current = requestAnimationFrame(tick)
        }
        levelRafRef.current = requestAnimationFrame(tick)
      })
      try {
        void ctx.close()
      } catch {
        /* noop */
      }
      stream.getTracks().forEach((t) => t.stop())
      if (peak < 0.01) {
        setMicState('fail')
        setMicHint(
          'Mic connected, but no sound was picked up — check the input device / hardware mute switch, then press Retry and say a few words.'
        )
        return
      }
      setMicState('pass')
    } catch (err) {
      setMicState('fail')
      setMicHint(diagnose(err, 'microphone').hint)
    }
  }, [])

  const runCamCheck = useCallback(async () => {
    setCamState('checking')
    setCamHint(null)
    stopCamera()
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, facingMode: 'user' },
        audio: false,
      })
      camStreamRef.current = stream
      setCamState('pass')
      // live preview while the check screen is open
      if (camPreviewRef.current) {
        camPreviewRef.current.srcObject = stream
        void camPreviewRef.current.play().catch(() => undefined)
      }
    } catch (err) {
      setCamState('fail')
      setCamHint(
        `${diagnose(err, 'camera').hint} The interview can continue without a camera, but the hiring team expects to see you — treat this as important.`
      )
    }
  }, [stopCamera])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void runMicCheck()
    void runCamCheck()
    return () => {
      if (levelRafRef.current != null) cancelAnimationFrame(levelRafRef.current)
      stopCamera()
    }
  }, [runMicCheck, runCamCheck, stopCamera])

  const allDone = micState !== 'idle' && micState !== 'checking' && camState !== 'idle' && camState !== 'checking'

  return (
    <Card className="w-full overflow-hidden rounded-2xl border-slate-200 shadow-lg dark:border-slate-800">
      <div className="h-1.5 w-full bg-gradient-to-r from-blue-500 to-sky-500" aria-hidden />
      <CardContent className="space-y-5 p-6 sm:p-8">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600">
            System check
          </p>
          <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Let&apos;s test your devices
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {candidateName ? `${candidateName} · ` : ''}
            {jobTitle ? (
              <>
                AI interview for <span className="font-medium text-slate-700 dark:text-slate-300">{jobTitle}</span>
                {companyName ? ` at ${companyName}` : ''}
              </>
            ) : (
              'A quick 10-second check of your microphone and camera'
            )}
          </p>
        </div>

        {/* ---------------- check rows ---------------- */}
        <div className="grid gap-2.5">
          {/* microphone row */}
          <div
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
              micState === 'pass'
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                : micState === 'fail'
                  ? 'border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30'
                  : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40'
            }`}
            role="status"
          >
            <span
              className={`grid size-9 shrink-0 place-items-center rounded-lg ${
                micState === 'pass' ? 'bg-emerald-100 dark:bg-emerald-900/50' : 'bg-white dark:bg-slate-900'
              }`}
              aria-hidden
            >
              {micState === 'checking' ? (
                <Loader2 className="size-4 animate-spin text-blue-600" />
              ) : micState === 'pass' ? (
                <CheckCircle2 className="size-4 text-emerald-600" />
              ) : micState === 'fail' ? (
                <AlertTriangle className="size-4 text-rose-500" />
              ) : (
                <Mic className="size-4 text-slate-400" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                Microphone
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    micState === 'pass'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300'
                      : micState === 'fail'
                        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                  }`}
                >
                  {micState === 'idle' ? 'waiting' : micState}
                </span>
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {micHint ??
                  (micState === 'pass'
                    ? 'Permission granted and your voice is coming through clearly.'
                    : micState === 'checking'
                      ? 'Say a few words — sampling your mic level…'
                      : 'We will ask for microphone permission and sample the level.')}
              </p>
              {micState === 'checking' && (
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden>
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-150"
                    style={{ width: `${Math.min(100, Math.round(micLevel * 260))}%` }}
                  />
                </div>
              )}
            </div>
            {micState === 'fail' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runMicCheck()}
                className="h-8 shrink-0 rounded-lg text-xs"
                aria-label="Retry microphone check"
              >
                <RefreshCw className="size-3.5" aria-hidden /> Retry
              </Button>
            )}
          </div>

          {/* camera row */}
          <div
            className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
              camState === 'pass'
                ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                : camState === 'fail'
                  ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30'
                  : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40'
            }`}
            role="status"
          >
            <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-slate-900" aria-hidden>
              {camState === 'pass' ? (
                <video
                  ref={camPreviewRef}
                  autoPlay
                  muted
                  playsInline
                  className="size-full scale-x-[-1] object-cover"
                />
              ) : camState === 'checking' ? (
                <Loader2 className="size-4 animate-spin text-blue-400" />
              ) : camState === 'fail' ? (
                <AlertTriangle className="size-4 text-amber-400" />
              ) : (
                <Camera className="size-4 text-slate-400" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                Camera
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                    camState === 'pass'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300'
                      : camState === 'fail'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800'
                  }`}
                >
                  {camState === 'idle' ? 'waiting' : camState}
                </span>
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {camHint ??
                  (camState === 'pass'
                    ? 'Camera is live — this is what the hiring team will see.'
                    : camState === 'checking'
                      ? 'Requesting camera permission…'
                      : 'We will ask for camera permission for the live preview.')}
              </p>
            </div>
            {camState === 'fail' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void runCamCheck()}
                className="h-8 shrink-0 rounded-lg text-xs"
                aria-label="Retry camera check"
              >
                <RefreshCw className="size-3.5" aria-hidden /> Retry
              </Button>
            )}
          </div>
        </div>

        {/* speaker test — the interview is useless in silence; hear the real
            interviewer voice before question one */}
        <SpeakerCheck />

        <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-blue-500" aria-hidden />
          Private room — nothing is broadcast live. Your answers are shared only with the hiring
          team reviewing your application.
        </p>

        <Button
          onClick={() => {
            stopCamera()
            onContinue()
          }}
          className="h-12 w-full rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 text-base font-semibold text-white shadow-lg shadow-blue-600/20 hover:from-blue-700 hover:to-sky-700"
        >
          {allDone ? 'Continue to the interview →' : 'Continue anyway →'}
        </Button>
      </CardContent>
    </Card>
  )
}
