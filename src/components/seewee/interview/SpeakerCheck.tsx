'use client'

/**
 * SpeakerCheck — pre-interview OUTPUT-device test (the half every candidate
 * forgets until the interview starts in silence). Plays one short line in the
 * AI interviewer's fixed voice through /api/tts, then asks the candidate to
 * confirm they actually heard it.
 *
 * Standalone (no store access) so both entry paths share it:
 *  - InterviewRoom welcome screen (logged-in candidates)
 *  - TokenInterviewGate → SystemCheck (invited candidates)
 *
 * Fail-safe by design: TTS/network problems never crash the check — they land
 * in the same actionable "check your volume" hint.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Volume2,
  VolumeX,
} from 'lucide-react'

import { Button } from '@/components/ui/button'

type SpeakerState = 'idle' | 'playing' | 'pass' | 'fail'

/** The ONE fixed interviewer voice for every interview (see /api/tts) */
const INTERVIEWER_VOICE = 'arjun'

const TEST_LINE =
  'This is a quick sound test. If you can hear my voice clearly, your sound is ready and we can begin the interview.'

export function SpeakerCheck() {
  const [state, setState] = useState<SpeakerState>('idle')
  const [playedOnce, setPlayedOnce] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stopAudio = useCallback(() => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
      audioRef.current?.pause()
    } catch {
      /* noop */
    }
    audioRef.current = null
  }, [])

  // Leaving the check screen must never leave audio hanging
  useEffect(() => () => stopAudio(), [stopAudio])

  const playTestSound = useCallback(async () => {
    stopAudio()
    setState('playing')

    // 1. Try Browser Speech Synthesis with Indian Voice
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        const synth = window.speechSynthesis
        const voices = synth.getVoices()
        const indianVoice = voices.find(
          (v) =>
            v.lang.toLowerCase().replace('_', '-').startsWith('en-in') ||
            v.lang.toLowerCase().startsWith('hi') ||
            v.name.toLowerCase().includes('india') ||
            v.name.toLowerCase().includes('neerja') ||
            v.name.toLowerCase().includes('prabhat') ||
            v.name.toLowerCase().includes('heera') ||
            v.name.toLowerCase().includes('rishi')
        ) || voices.find((v) => v.lang.startsWith('en'))

        if (indianVoice || voices.length > 0) {
          synth.cancel()
          const utterance = new SpeechSynthesisUtterance(TEST_LINE)
          if (indianVoice) utterance.voice = indianVoice
          utterance.rate = 0.9
          utterance.pitch = 1.0
          utterance.onend = () => {
            setState((s) => (s === 'playing' ? 'idle' : s))
            setPlayedOnce(true)
          }
          utterance.onerror = () => {
            setState((s) => (s === 'playing' ? 'fail' : s))
          }
          synth.speak(utterance)
          setPlayedOnce(true)
          return
        }
      } catch (e) {
        console.warn('Speech synthesis test fallback:', e)
      }
    }

    // 2. Fallback to API TTS
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: TEST_LINE, voice: INTERVIEWER_VOICE, speed: 0.85 }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: string }
      if (!res.ok || !json.data?.startsWith('data:audio')) throw new Error('tts failed')
      const el = new Audio(json.data)
      audioRef.current = el
      el.onended = () => setState((s) => (s === 'playing' ? 'idle' : s))
      el.onerror = () => setState((s) => (s === 'playing' ? 'fail' : s))
      await el.play()
      setPlayedOnce(true)
    } catch {
      setState('fail')
    }
  }, [stopAudio])

  const rowCls =
    state === 'pass'
      ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30'
      : state === 'fail'
        ? 'border-rose-200 bg-rose-50 dark:border-rose-900/60 dark:bg-rose-950/30'
        : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-800/40'

  const pillCls =
    state === 'pass'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300'
      : state === 'fail'
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/60 dark:text-rose-300'
        : 'bg-slate-100 text-slate-500 dark:bg-slate-800'

  const description =
    state === 'pass'
      ? 'Sound confirmed — you will hear every question clearly.'
      : state === 'fail'
        ? 'No sound? Turn the volume up, unmute the browser tab (right-click the tab → Unmute), or plug in headphones — then press Replay.'
        : state === 'playing'
          ? 'Playing… listen for the interviewer’s voice.'
          : playedOnce
            ? 'Did you hear the test line clearly? Confirm below — this is the voice that will read your questions.'
            : 'Press “Play test sound” — you should hear a short line in the interviewer’s voice.'

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border px-4 py-3 sm:flex-row sm:items-center ${rowCls}`}
      role="status"
      aria-label="Speaker check"
    >
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-white shadow-sm dark:bg-slate-900"
        aria-hidden
      >
        {state === 'playing' ? (
          <Loader2 className="size-4 animate-spin text-blue-600" />
        ) : state === 'pass' ? (
          <CheckCircle2 className="size-4 text-emerald-600" />
        ) : state === 'fail' ? (
          <AlertTriangle className="size-4 text-rose-500" />
        ) : (
          <Volume2 className="size-4 text-slate-400" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
          Speakers
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${pillCls}`}
          >
            {state === 'idle' && playedOnce ? 'confirm' : state}
          </span>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          {description}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {state === 'fail' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void playTestSound()}
            className="h-8 rounded-lg text-xs"
            aria-label="Replay the sound test"
          >
            <RefreshCw className="size-3.5" aria-hidden /> Replay
          </Button>
        ) : state !== 'pass' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void playTestSound()}
            disabled={state === 'playing'}
            className="h-8 rounded-lg text-xs"
            aria-label="Play the sound test"
          >
            {state === 'playing' ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Volume2 className="size-3.5 text-blue-600" aria-hidden />
            )}
            {playedOnce ? 'Replay' : 'Play test sound'}
          </Button>
        ) : null}

        {playedOnce && state !== 'playing' && state !== 'pass' && (
          <>
            <Button
              size="sm"
              onClick={() => setState('pass')}
              className="h-8 rounded-lg bg-emerald-600 text-xs text-white hover:bg-emerald-700"
              aria-label="Confirm you heard the sound"
            >
              <CheckCircle2 className="size-3.5" aria-hidden /> Yes, I hear it
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setState('fail')}
              className="h-8 rounded-lg text-xs text-slate-500 hover:text-rose-600"
              aria-label="Report that the sound test failed"
            >
              <VolumeX className="size-3.5" aria-hidden /> No sound
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
