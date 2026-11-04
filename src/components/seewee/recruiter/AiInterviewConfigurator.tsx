'use client'

/**
 * AiInterviewConfigurator — the recruiter's AI-interview question designer.
 *
 * The recruiter stays in full control of the AI screening round:
 *  - add / edit / delete / reorder questions
 *  - per question: answer format (VOICE = spoken & auto-transcribed,
 *    TEXT = typed) and the answer time limit
 *  - one click "Suggest 10 questions" drafts from the JD via the AI — every
 *    suggestion still needs an explicit Add before it becomes part of the set
 *
 * Present in both the post-job form and the edit-job dialog.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowUp,
  Keyboard,
  Loader2,
  Mic,
  Plus,
  Sparkles,
  Timer,
  Trash2,
  Video,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { AiInterviewQuestion } from '@/lib/types'

const MAX_QUESTIONS = 20
/** Standard presets — capped at 3 minutes per the hiring-team request. */
const TIME_OPTIONS = [
  { value: '0', label: 'No time limit' },
  { value: '60', label: '1 minute' },
  { value: '90', label: '1.5 minutes' },
  { value: '120', label: '2 minutes' },
  { value: '180', label: '3 minutes' },
]
const PRESET_SECS = TIME_OPTIONS.map((o) => Number(o.value))
const CUSTOM_TIME = 'custom'
/** Custom window bounds (server clamps at 600s too) */
const CUSTOM_MIN_SEC = 30
const CUSTOM_MAX_SEC = 600

/** Human label for any window in seconds (0 = no limit). */
function fmtLimit(sec: number): string {
  if (!sec || sec <= 0) return 'no limit'
  if (sec < 60) return `${sec}s`
  if (sec % 60 === 0) return `${sec / 60} min`
  return `${Number((sec / 60).toFixed(1))} min`
}

interface Suggestion {
  text: string
  type: 'VOICE' | 'TEXT' | 'VIDEO'
  timeLimitSec: number
  focusArea: string
}

function uid(): string {
  return `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export interface AiInterviewConfiguratorProps {
  questions: AiInterviewQuestion[]
  onChange: (questions: AiInterviewQuestion[]) => void
  /** saved job → suggestion API loads JD straight from the DB */
  jobId?: string
  /** unsaved draft context for the suggestion API */
  draft?: { title?: string; skills?: string; jdText?: string }
}

export function AiInterviewConfigurator({
  questions,
  onChange,
  jobId,
  draft,
}: AiInterviewConfiguratorProps) {
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  // [build-batch-3] provenance of the last suggestion run ('ai' = live model,
  // 'fallback' = offline preset set) — surfaced as an honesty badge.
  const [suggestSource, setSuggestSource] = useState<'ai' | 'fallback' | null>(null)
  const [addedIdx, setAddedIdx] = useState<Record<number, boolean>>({})
  // index of the row whose custom-time input is open (CUSTOM_TIME picked)
  const [customTimeIdx, setCustomTimeIdx] = useState<number | null>(null)

  const update = (idx: number, patch: Partial<AiInterviewQuestion>) => {
    onChange(questions.map((q, i) => (i === idx ? { ...q, ...patch } : q)))
  }

  const move = (idx: number, dir: -1 | 1) => {
    const to = idx + dir
    if (to < 0 || to >= questions.length) return
    const next = [...questions]
    const [row] = next.splice(idx, 1)
    next.splice(to, 0, row)
    onChange(next)
  }

  const addQuestion = (preset?: Partial<AiInterviewQuestion>) => {
    if (questions.length >= MAX_QUESTIONS) {
      toast.warning(`Up to ${MAX_QUESTIONS} questions per interview`)
      return
    }
    onChange([
      ...questions,
      {
        id: uid(),
        text: preset?.text ?? '',
        type: preset?.type ?? 'VOICE',
        timeLimitSec: preset?.timeLimitSec ?? 120,
      },
    ])
  }

  const removeQuestion = (idx: number) => {
    onChange(questions.filter((_, i) => i !== idx))
    if (customTimeIdx === idx) setCustomTimeIdx(null)
  }

  const runSuggest = async () => {
    setSuggesting(true)
    try {
      const body = jobId ? { jobId } : { title: draft?.title, skills: draft?.skills, jdText: draft?.jdText }
      const res = await fetch('/api/ai/suggest-questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json: { data?: { suggestions?: Suggestion[]; source?: 'ai' | 'fallback' }; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data?.suggestions) {
        throw new Error(json.error || 'Could not generate suggestions')
      }
      setSuggestions(json.data.suggestions)
      setSuggestSource(json.data.source ?? 'ai')
      setAddedIdx({})
      toast.success(`${json.data.suggestions.length} suggestions ready — add the ones you like`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Suggestion failed')
    } finally {
      setSuggesting(false)
    }
  }

  const addSuggestion = (idx: number) => {
    const s = suggestions?.[idx]
    if (!s) return
    addQuestion({ text: s.text, type: s.type, timeLimitSec: s.timeLimitSec })
    setAddedIdx((prev) => ({ ...prev, [idx]: true }))
  }

  const addAllSuggestions = () => {
    if (!suggestions) return
    const fresh = suggestions.filter((_, i) => !addedIdx[i])
    const room = MAX_QUESTIONS - questions.length
    const take = fresh.slice(0, room)
    if (take.length === 0) {
      toast.warning('All suggestions are already added')
      return
    }
    onChange([
      ...questions,
      ...take.map((s) => ({
        id: uid(),
        text: s.text,
        type: s.type,
        timeLimitSec: s.timeLimitSec,
      })),
    ])
    setAddedIdx(Object.fromEntries(suggestions.map((_, i) => [i, true])))
    toast.success(`${take.length} questions added — edit them freely`)
  }

  const voiceCount = questions.filter((q) => q.type === 'VOICE').length
  const videoCount = questions.filter((q) => q.type === 'VIDEO').length
  const textCount = questions.filter((q) => q.type === 'TEXT').length

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-4">
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Your interview questions
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            You decide what the AI asks — it never invents questions. Voice answers are spoken
            and auto-transcribed; video answers are recorded on camera; text answers are typed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {questions.length > 0 && (
            <Badge variant="outline" className="rounded-full border-slate-300 text-[11px] font-medium">
              {questions.length}/{MAX_QUESTIONS} · 🎤 {voiceCount} · 📹 {videoCount} · ⌨️ {textCount}
            </Badge>
          )}
        </div>
      </div>

      {/* question rows */}
      {questions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-5 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No questions yet — add your own or ask the AI to suggest from the JD.
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {questions.map((q, idx) => (
            <li
              key={q.id}
              className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 shadow-sm"
            >
              <div className="mb-2 flex items-center gap-1.5">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-300">
                  {idx + 1}
                </span>
                <Badge
                  variant="outline"
                  className={`gap-1 rounded-full px-2 text-[10px] font-semibold uppercase tracking-wide ${
                    q.type === 'VOICE'
                      ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/40 text-blue-700'
                      : q.type === 'VIDEO'
                        ? 'border-violet-200 bg-violet-50 dark:bg-violet-950/40 text-violet-700'
                        : 'border-teal-200 bg-teal-50 dark:bg-teal-950/40 text-teal-700'
                  }`}
                >
                  {q.type === 'VOICE' ? (
                    <><Mic className="size-3" aria-hidden /> Voice answer</>
                  ) : q.type === 'VIDEO' ? (
                    <><Video className="size-3" aria-hidden /> Video answer</>
                  ) : (
                    <><Keyboard className="size-3" aria-hidden /> Typed answer</>
                  )}
                </Badge>
                <span className="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                  <Timer className="size-3" aria-hidden />
                  {fmtLimit(q.timeLimitSec)}
                </span>
                <div className="ml-auto flex items-center gap-0.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    aria-label={`Move question ${idx + 1} up`}
                    className="size-7 rounded-md text-slate-400 hover:text-slate-700"
                  >
                    <ArrowUp className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => move(idx, 1)}
                    disabled={idx === questions.length - 1}
                    aria-label={`Move question ${idx + 1} down`}
                    className="size-7 rounded-md text-slate-400 hover:text-slate-700"
                  >
                    <ArrowDown className="size-3.5" aria-hidden />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeQuestion(idx)}
                    aria-label={`Delete question ${idx + 1}`}
                    className="size-7 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </div>

              <Textarea
                rows={2}
                value={q.text}
                onChange={(e) => update(idx, { text: e.target.value })}
                placeholder={`What should the AI ask? e.g. "Walk me through your experience with the core skills of this role."`}
                aria-label={`Question ${idx + 1} text`}
                className={`resize-y rounded-lg text-[13px] ${
                  q.text.trim()
                    ? 'border-slate-200 dark:border-slate-800'
                    : 'border-rose-300 ring-1 ring-rose-200 dark:border-rose-800'
                }`}
                maxLength={600}
              />
              {!q.text.trim() && (
                <p className="mt-1 text-[11px] text-rose-500">
                  Empty — type the question or it will be removed automatically when you post.
                </p>
              )}

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Answer format
                  </Label>
                  <Select
                    value={q.type}
                    onValueChange={(v) =>
                      update(idx, {
                        type: v === 'TEXT' ? 'TEXT' : v === 'VIDEO' ? 'VIDEO' : 'VOICE',
                      })
                    }
                  >
                    <SelectTrigger className="h-9 w-full rounded-lg border-slate-200 dark:border-slate-800" aria-label={`Answer format for question ${idx + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VOICE">🎤 Voice — candidate speaks</SelectItem>
                      <SelectItem value="VIDEO">📹 Video — candidate answers on camera</SelectItem>
                      <SelectItem value="TEXT">⌨️ Text — candidate types</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Answer time limit
                  </Label>
                  <Select
                    value={PRESET_SECS.includes(q.timeLimitSec) ? String(q.timeLimitSec) : CUSTOM_TIME}
                    onValueChange={(v) => {
                      if (v === CUSTOM_TIME) {
                        // open the custom input; prefill a sane value when currently unlimited
                        if (q.timeLimitSec === 0) update(idx, { timeLimitSec: 120 })
                        setCustomTimeIdx(idx)
                      } else {
                        update(idx, { timeLimitSec: Number(v) })
                        if (customTimeIdx === idx) setCustomTimeIdx(null)
                      }
                    }}
                  >
                    <SelectTrigger className="h-9 w-full rounded-lg border-slate-200 dark:border-slate-800" aria-label={`Time limit for question ${idx + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                      <SelectItem value={CUSTOM_TIME}>
                        Custom… (set your own, up to 10 min)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {customTimeIdx === idx && (
                    <div className="flex items-center gap-1.5 pt-0.5">
                      <Input
                        type="number"
                        min={CUSTOM_MIN_SEC / 60}
                        max={CUSTOM_MAX_SEC / 60}
                        step={0.5}
                        value={q.timeLimitSec > 0 ? q.timeLimitSec / 60 : ''}
                        onChange={(e) => {
                          const mins = Number(e.target.value)
                          if (!Number.isFinite(mins) || mins <= 0) return
                          const sec = Math.min(CUSTOM_MAX_SEC, Math.max(CUSTOM_MIN_SEC, Math.round(mins * 60)))
                          update(idx, { timeLimitSec: sec })
                        }}
                        aria-label={`Custom time limit in minutes for question ${idx + 1}`}
                        className="h-8 w-24 rounded-lg border-slate-200 text-[13px] dark:border-slate-800"
                      />
                      <span className="text-[11px] text-slate-400">minutes</span>
                      <span className="ml-auto rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-300">
                        = {fmtLimit(q.timeLimitSec)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => addQuestion()}
          disabled={questions.length >= MAX_QUESTIONS}
          className="min-h-9 rounded-lg border-slate-300 dark:border-slate-700"
        >
          <Plus className="size-4" aria-hidden /> Add question
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void runSuggest()}
          disabled={suggesting}
          className="min-h-9 rounded-lg border-blue-200 bg-blue-50/60 text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
        >
          {suggesting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          )}
          Suggest 10 questions from JD
        </Button>
      </div>

      {/* AI suggestions */}
      {suggestions && suggestions.length > 0 && (
        <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 dark:text-blue-200">
              <Sparkles className="size-3.5" aria-hidden /> AI suggestions — pick what fits,
              edit after adding
              {/* [build-batch-3] provenance badge: live model vs offline fallback */}
              {suggestSource === 'fallback' && (
                <span
                  className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                  title="The AI model was unavailable — these are standard preset questions, not JD-specific ones."
                >
                  offline set
                </span>
              )}
              {suggestSource === 'ai' && (
                <span
                  className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  title="Generated live from this job's title, skills and description."
                >
                  JD-matched
                </span>
              )}
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={addAllSuggestions}
              className="h-7 rounded-md text-xs text-blue-700 hover:bg-blue-100 dark:text-blue-300"
            >
              Add all
            </Button>
          </div>
          <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {suggestions.map((s, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-md border border-blue-100 bg-white p-2 dark:border-blue-900/50 dark:bg-slate-900"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-snug text-slate-700 dark:text-slate-200">
                    {s.text}
                  </p>
                  <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {s.type === 'VOICE' ? '🎤 voice' : s.type === 'VIDEO' ? '📹 video' : '⌨️ text'} ·{' '}
                    {fmtLimit(s.timeLimitSec)}
                    {s.focusArea ? ` · ${s.focusArea}` : ''}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={addedIdx[i] ? 'ghost' : 'outline'}
                  disabled={addedIdx[i]}
                  onClick={() => addSuggestion(i)}
                  className="h-7 shrink-0 rounded-md px-2 text-xs"
                  aria-label={`Add suggestion ${i + 1}`}
                >
                  {addedIdx[i] ? 'Added ✓' : '+ Add'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
