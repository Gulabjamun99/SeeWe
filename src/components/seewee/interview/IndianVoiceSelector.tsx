'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2, Square, User, Volume2 } from 'lucide-react'
import {
  DEFAULT_INTERVIEW_VOICE,
  INDIAN_INTERVIEW_VOICES,
  pickFallbackEnglishVoice,
  pickIndianBrowserVoice,
  type IndianInterviewVoice,
  type IndianVoiceId,
} from '@/lib/interview-voices'
import { cn } from '@/lib/utils'

const SAMPLE_LINE =
  'Hello! Welcome to your SeeWe AI interview. Could you walk me through your most recent project and your key contributions?'

export function IndianVoiceSelector({
  value,
  onChange,
  compact = false,
  label = 'AI Interviewer Voice (Indian English)',
}: {
  value?: IndianVoiceId | string | null
  onChange: (voiceId: IndianVoiceId) => void
  compact?: boolean
  label?: string
}) {
  const selected = (value || DEFAULT_INTERVIEW_VOICE) as IndianVoiceId
  const [previewingId, setPreviewingId] = useState<IndianVoiceId | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const stopPreview = useCallback(() => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
      audioRef.current?.pause()
    } catch {
      /* noop */
    }
    audioRef.current = null
    setPreviewingId(null)
  }, [])

  useEffect(() => () => stopPreview(), [stopPreview])

  const previewVoice = useCallback(
    async (voice: IndianInterviewVoice, e: React.MouseEvent) => {
      e.stopPropagation()
      if (previewingId === voice.id) {
        stopPreview()
        return
      }
      stopPreview()
      setPreviewingId(voice.id)

      // 1. Check if OS/browser has a native Indian English voice matching this gender
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          const synth = window.speechSynthesis
          let voices = synth.getVoices()
          if (!voices.length) {
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, 250)
              synth.onvoiceschanged = () => {
                clearTimeout(t)
                resolve()
              }
            })
            voices = synth.getVoices()
          }
          const indianVoice = pickIndianBrowserVoice(voices, voice)
          if (indianVoice) {
            synth.cancel()
            const utt = new SpeechSynthesisUtterance(SAMPLE_LINE)
            utt.voice = indianVoice
            utt.pitch = voice.pitch
            utt.rate = voice.rate
            utt.onend = () => setPreviewingId((cur) => (cur === voice.id ? null : cur))
            utt.onerror = () => setPreviewingId((cur) => (cur === voice.id ? null : cur))
            synth.speak(utt)
            return
          }
        } catch {
          /* fall through to server TTS */
        }
      }

      // 2. Try server-side TTS (/api/tts)
      try {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: SAMPLE_LINE, voice: voice.id, speed: voice.rate }),
        })
        const json = (await res.json().catch(() => ({}))) as { data?: string }
        if (res.ok && json.data?.startsWith('data:audio')) {
          const el = new Audio(json.data)
          audioRef.current = el
          el.onended = () => setPreviewingId((cur) => (cur === voice.id ? null : cur))
          el.onerror = () => setPreviewingId((cur) => (cur === voice.id ? null : cur))
          await el.play()
          return
        }
      } catch {
        /* fall through to English browser voice */
      }

      // 3. Final fallback: any English browser voice with tuned pitch/rate
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          const synth = window.speechSynthesis
          const fallback = pickFallbackEnglishVoice(synth.getVoices(), voice.gender)
          if (fallback) {
            synth.cancel()
            const utt = new SpeechSynthesisUtterance(SAMPLE_LINE)
            utt.voice = fallback
            utt.pitch = voice.pitch
            utt.rate = voice.rate
            utt.onend = () => setPreviewingId((cur) => (cur === voice.id ? null : cur))
            utt.onerror = () => setPreviewingId((cur) => (cur === voice.id ? null : cur))
            synth.speak(utt)
            return
          }
        } catch {
          /* noop */
        }
      }

      setPreviewingId(null)
    },
    [previewingId, stopPreview]
  )

  const maleVoices = INDIAN_INTERVIEW_VOICES.filter((v) => v.gender === 'male')
  const femaleVoices = INDIAN_INTERVIEW_VOICES.filter((v) => v.gender === 'female')

  const renderGroup = (title: string, items: IndianInterviewVoice[], badgeCls: string) => (
    <div className="space-y-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {title}
      </p>
      <div className={cn('grid gap-2', compact ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-3')}>
        {items.map((v) => {
          const isSelected = selected === v.id
          const isPlaying = previewingId === v.id
          return (
            <div
              key={v.id}
              role="button"
              tabIndex={0}
              onClick={() => onChange(v.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onChange(v.id)
                }
              }}
              aria-pressed={isSelected}
              className={cn(
                'group flex cursor-pointer items-center justify-between gap-2 rounded-xl border p-2.5 text-left transition-all',
                isSelected
                  ? 'border-blue-500 bg-blue-50/70 ring-1 ring-blue-500/30 dark:border-blue-500 dark:bg-blue-950/40'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className={cn('inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', badgeCls)}>
                    <User className="size-3" aria-hidden />
                  </span>
                  <span className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {v.label}
                  </span>
                  {isSelected && (
                    <Check className="size-3.5 shrink-0 text-blue-600 dark:text-blue-400" aria-hidden />
                  )}
                </div>
                {!compact && (
                  <p className="mt-0.5 line-clamp-1 text-[10px] text-slate-500 dark:text-slate-400">
                    {v.tagline}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={(e) => void previewVoice(v, e)}
                aria-label={isPlaying ? `Stop ${v.label} preview` : `Preview ${v.label} voice`}
                title={isPlaying ? 'Stop preview' : 'Preview voice'}
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1 rounded-lg border px-2 text-[10px] font-semibold transition-colors',
                  isPlaying
                    ? 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                )}
              >
                {isPlaying ? (
                  <>
                    <Square className="size-2.5 fill-current" aria-hidden /> Stop
                  </>
                ) : (
                  <>
                    <Volume2 className="size-3" aria-hidden /> Play
                  </>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Volume2 className="size-4 text-blue-600" aria-hidden />
          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {label}
          </span>
        </div>
        <span className="text-[10px] text-slate-400">
          3 Indian Male · 3 Indian Female voices
        </span>
      </div>
      {renderGroup('Indian Male Voices', maleVoices, 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300')}
      {renderGroup('Indian Female Voices', femaleVoices, 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300')}
    </div>
  )
}
