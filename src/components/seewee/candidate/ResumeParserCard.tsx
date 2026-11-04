'use client'

/**
 * ResumeParserCard — "Instant resume import" for candidates.
 *
 * Flow: paste resume text OR upload a plain-text file → POST /api/resume/parse
 * → review AI-extracted fields (editable preview) → apply the chosen ones to
 * the candidate profile via PATCH /api/candidates/[id].
 *
 * This component owns no shared state: it reports success through onApplied()
 * so the host screen can refresh/reload the profile however it wants.
 */

import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BadgeCheck,
  FileUp,
  Info,
  Loader2,
  Plus,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ParsedResume {
  headline: string
  skills: string[]
  experienceYears: number
  location: string | null
  currentCompany: string | null
  education: string | null
  summary: string
  suggestedCategories: string[]
}

interface ParseResponse {
  data?: { extracted: ParsedResume; source: 'ai' | 'heuristic'; text?: string }
  error?: string
}

type FieldKey = 'headline' | 'location' | 'experienceYears' | 'currentCompany' | 'education' | 'skills'

const MAX_CHARS = 12000
const MIN_CHARS = 30
const MAX_FILE_BYTES = 3 * 1024 * 1024 // 3 MB — resumes are text documents
const ALLOWED_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.text', '.pdf', '.docx']
const DOC_EXTENSIONS = ['.pdf', '.docx']

/** Editable fields rendered in the review step, in display order. */
const FIELD_LABELS: Record<FieldKey, string> = {
  headline: 'Headline',
  location: 'Location',
  experienceYears: 'Experience (years)',
  currentCompany: 'Current company',
  education: 'Education',
  skills: 'Skills',
}

interface ReviewState {
  headline: string
  location: string
  experienceYears: string
  currentCompany: string
  education: string
  skills: string[]
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function looksBinary(text: string): boolean {
  // NUL bytes are a dead giveaway; also flag runs of unusual control chars.
  let suspicious = 0
  const sample = text.slice(0, 2048)
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i)
    if (code === 0) return true
    if ((code < 9 && code !== 0) || (code > 13 && code < 32)) suspicious++
  }
  return suspicious / Math.max(sample.length, 1) > 0.05
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('file-read-failed'))
    reader.readAsDataURL(file)
  })
}

/** True when the field carries an applyable value (hides empty/null rows). */
function fieldValue(review: ReviewState, key: FieldKey): string | null {
  switch (key) {
    case 'headline':
      return review.headline.trim() || null
    case 'location':
      return review.location.trim() || null
    case 'experienceYears': {
      const n = Number.parseFloat(review.experienceYears)
      return Number.isFinite(n) && n >= 0 ? String(n) : null
    }
    case 'currentCompany':
      return review.currentCompany.trim() || null
    case 'education':
      return review.education.trim() || null
    case 'skills':
      return review.skills.length > 0 ? review.skills.join(', ') : null
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function ResumeParserCard({
  candidateId,
  onApplied,
}: {
  candidateId: string
  onApplied?: () => void
}) {
  /* ------------------------------- state ------------------------------ */
  const [mode, setMode] = useState<'idle' | 'parsing' | 'review'>('idle')
  const [inputTab, setInputTab] = useState<'paste' | 'upload'>('paste')
  const [text, setText] = useState('')
  const [readingFile, setReadingFile] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null)
  /** kept separately so "Save resume text" always sends what was analyzed */
  const analyzedTextRef = useRef('')

  const [source, setSource] = useState<'ai' | 'heuristic'>('ai')
  const [review, setReview] = useState<ReviewState>({
    headline: '', location: '', experienceYears: '', currentCompany: '', education: '', skills: [],
  })
  const [summary, setSummary] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [checks, setChecks] = useState<Record<FieldKey, boolean>>({
    headline: true, location: true, experienceYears: true, currentCompany: true, education: true, skills: true,
  })
  const [saveResume, setSaveResume] = useState(true)
  const [newSkill, setNewSkill] = useState('')
  const [applying, setApplying] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  /* ----------------------------- derived ------------------------------ */
  const visibleFields = useMemo(
    () =>
      (Object.keys(FIELD_LABELS) as FieldKey[]).filter((key) => fieldValue(review, key) !== null),
    [review]
  )
  const applyCount = visibleFields.filter((key) => checks[key]).length
  const canSubmitApply =
    !applying && (applyCount > 0 || (saveResume && analyzedTextRef.current.trim().length >= MIN_CHARS))

  /* ---------------------------- file input ---------------------------- */
  async function handleFileChosen(file: File | undefined | null) {
    if (!file) return
    const lower = file.name.toLowerCase()
    if (!ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      toast.error(`Unsupported file “${file.name}”. Pick a PDF, DOCX, .txt, .md, .csv or .json file`)
      return
    }
    if (lower.endsWith('.doc')) {
      toast.error('Legacy .doc files are not supported — save as .docx or PDF and retry')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error('File is larger than 3 MB — export a lighter copy and retry')
      return
    }

    /* PDF / DOCX → server extracts the text, then AI parses it in one go */
    if (DOC_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      setReadingFile(true)
      setLoadedFileName(file.name)
      try {
        const dataUrl = await readFileAsDataUrl(file)
        await analyze({
          filePayload: { file_base64: dataUrl, filename: file.name },
        })
      } catch {
        toast.error('Could not read that file — try again or paste the text')
      } finally {
        setReadingFile(false)
      }
      return
    }

    /* plain-text flow (unchanged) */
    setReadingFile(true)
    try {
      const content = await file.text()
      if (looksBinary(content)) {
        toast.error('That looks like a binary file. Try a PDF/DOCX export or paste the text')
        return
      }
      const clipped = content.slice(0, MAX_CHARS)
      setText(clipped)
      setLoadedFileName(file.name)
      setInputTab('paste')
      toast.success(`Loaded ${file.name} (${clipped.length.toLocaleString()} chars)`)
    } catch {
      toast.error('Could not read that file — try again or paste the text')
    } finally {
      setReadingFile(false)
    }
  }

  /* ----------------------------- analyze ------------------------------ */
  /** Paste flow: analyze() with no args. Upload flow: pass a filePayload —
   *  the server extracts the text (PDF/DOCX) before running the parser and
   *  returns it so we can keep it for “Save resume text”. */
  async function analyze(opts?: {
    filePayload: { file_base64: string; filename: string }
  }) {
    const trimmed = text.trim()
    if (!opts && trimmed.length < MIN_CHARS) {
      toast.error(`Add a bit more text first (at least ${MIN_CHARS} characters)`)
      return
    }
    setMode('parsing')
    try {
      const res = await fetch('/api/resume/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          opts ? opts.filePayload : { resumeText: trimmed }
        ),
      })
      const json = (await res.json().catch(() => ({}))) as ParseResponse
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Failed to parse resume')
      }
      const ex = json.data.extracted
      // Server echoes the exact text it analyzed (extracted for uploads) —
      // reuse it so “Save resume text” persists what was actually parsed.
      const analyzedText = (json.data.text ?? trimmed).slice(0, MAX_CHARS)
      analyzedTextRef.current = analyzedText
      if (opts) setText(analyzedText) // surface extracted text in the paste tab
      setSource(json.data.source)
      setReview({
        headline: ex.headline ?? '',
        location: ex.location ?? '',
        experienceYears:
          typeof ex.experienceYears === 'number' && Number.isFinite(ex.experienceYears)
            ? String(ex.experienceYears)
            : '',
        currentCompany: ex.currentCompany ?? '',
        education: ex.education ?? '',
        skills: Array.isArray(ex.skills) ? [...ex.skills] : [],
      })
      setSummary(ex.summary ?? '')
      setCategories(Array.isArray(ex.suggestedCategories) ? ex.suggestedCategories : [])
      setChecks({ headline: true, location: true, experienceYears: true, currentCompany: true, education: true, skills: true })
      setMode('review')
    } catch (err) {
      setMode('idle')
      toast.error(err instanceof Error ? err.message : 'Failed to parse resume')
    }
  }

  function resetToInput() {
    setMode('idle')
    setText('')
    setLoadedFileName(null)
    analyzedTextRef.current = ''
    setNewSkill('')
  }

  /* ------------------------------ apply ------------------------------- */
  async function applyFields() {
    if (!canSubmitApply) return
    setApplying(true)
    try {
      const payload: Record<string, unknown> = {}
      for (const key of visibleFields) {
        if (!checks[key]) continue
        const value = fieldValue(review, key)
        if (value === null) continue
        if (key === 'currentCompany') payload['company'] = value // profile field is `company`
        else if (key === 'experienceYears') payload['experienceYears'] = Number(value)
        else payload[key] = value
      }
      if (saveResume && analyzedTextRef.current.trim()) {
        payload['resumeText'] = analyzedTextRef.current
      }
      if (Object.keys(payload).length === 0) {
        toast.error('Nothing selected — tick at least one field')
        return
      }

      const res = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to update profile')

      toast.success('Profile updated with AI-extracted details ✨')
      onApplied?.()
      resetToInput()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setApplying(false)
    }
  }

  /* ---------------------------- skills edit --------------------------- */
  function updateReview(key: Exclude<FieldKey, 'skills'>, value: string) {
    setReview((r) => {
      if (key === 'headline') return { ...r, headline: value }
      if (key === 'location') return { ...r, location: value }
      if (key === 'experienceYears') return { ...r, experienceYears: value }
      if (key === 'currentCompany') return { ...r, currentCompany: value }
      return { ...r, education: value }
    })
  }

  function removeSkill(skill: string) {
    setReview((r) => ({ ...r, skills: r.skills.filter((s) => s !== skill) }))
  }
  function addSkill() {
    const s = newSkill.trim().replace(/\s+/g, ' ')
    if (!s) return
    setReview((r) => {
      if (r.skills.some((existing) => existing.toLowerCase() === s.toLowerCase())) {
        toast.info(`“${s}” is already in the list`)
        return r
      }
      return { ...r, skills: [...r.skills, s].slice(0, 15) }
    })
    setNewSkill('')
  }

  /* ============================== render ============================== */

  return (
    <Card className="overflow-hidden rounded-xl border-blue-200/70 dark:border-blue-900/60 bg-gradient-to-br from-blue-50/80 dark:from-blue-950/40 via-white to-sky-50/60 dark:to-sky-950/40 shadow-sm">
      <CardContent className="space-y-4 p-5 sm:p-6">
        {/* --------------------------- header --------------------------- */}
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-600 text-white shadow-md">
            <Wand2 className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              AI Resume Parser
              {mode === 'review' && (
                <Badge
                  variant="outline"
                  className={
                    source === 'ai'
                      ? 'rounded-full border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-[11px] text-blue-700'
                      : 'rounded-full border-amber-300 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 text-[11px] text-amber-700 dark:text-amber-300'
                  }
                >
                  {source === 'ai' ? (
                    <>
                      <BadgeCheck className="size-3" aria-hidden /> AI parsed
                    </>
                  ) : (
                    'Heuristic parse'
                  )}
                </Badge>
              )}
            </h3>
            <p className="mt-0.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Paste your resume or upload a PDF / DOCX — SeeWe extracts your headline, skills,
              experience and more, then applies them to your profile.
            </p>
          </div>
        </div>

        {/* ============================ IDLE ============================ */}
        {mode === 'idle' && (
          <div className="space-y-3">
            {/* input-mode tabs */}
            <div
              role="tablist"
              aria-label="Resume input method"
              className="inline-flex h-9 items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1"
            >
              {(['paste', 'upload'] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={inputTab === t}
                  onClick={() => setInputTab(t)}
                  className={`inline-flex min-h-[28px] items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${
                    inputTab === t
                      ? 'bg-card text-blue-700 shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'
                  }`}
                >
                  {t === 'paste' ? (
                    <Sparkles className="size-3.5" aria-hidden />
                  ) : (
                    <FileUp className="size-3.5" aria-hidden />
                  )}
                  {t === 'paste' ? 'Paste text' : 'Upload file'}
                </button>
              ))}
            </div>

            {inputTab === 'paste' ? (
              <div className="space-y-1.5">
                <Label htmlFor="rp-text" className="sr-only">
                  Resume text
                </Label>
                <Textarea
                  id="rp-text"
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
                  placeholder={`Paste your resume here…

Example:
Senior React Developer with 6+ years building fintech products.
Skills: React, TypeScript, Node.js, GraphQL, AWS…
Experience: Senior Engineer at Razorpay (2021–present)…`}
                  aria-describedby="rp-char-count"
                  className="min-h-[140px] resize-y rounded-xl border-slate-200 dark:border-slate-800 bg-card/90 text-sm leading-relaxed focus-visible:ring-blue-300 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-blue-200 [&::-webkit-scrollbar]:w-1.5"
                />
                <div className="flex items-center justify-between gap-2">
                  <span id="rp-char-count" className="text-[11px] text-slate-400 dark:text-slate-500">
                    {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
                    {text.trim().length > 0 && text.trim().length < MIN_CHARS
                      ? ` · minimum ${MIN_CHARS}`
                      : ''}
                  </span>
                  {loadedFileName && (
                    <span className="truncate text-[11px] font-medium text-blue-700">
                      from {loadedFileName}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div
                  role="button"
                  tabIndex={readingFile ? -1 : 0}
                  aria-disabled={readingFile}
                  aria-label="Choose or drop a resume file (PDF, DOCX, TXT, MD, CSV or JSON)"
                  onClick={() => {
                    if (!readingFile) fileInputRef.current?.click()
                  }}
                  onKeyDown={(e) => {
                    if (readingFile) return
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      fileInputRef.current?.click()
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (!readingFile) setDragOver(true)
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(false)
                    if (!readingFile) void handleFileChosen(e.dataTransfer.files?.[0])
                  }}
                  className={`flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 ${
                    dragOver
                      ? 'scale-[1.01] border-blue-500 bg-blue-100/80 dark:bg-blue-900/40 shadow-inner'
                      : 'border-blue-300 bg-blue-50/50 dark:bg-blue-950/30 hover:border-blue-400 hover:bg-blue-50'
                  } ${readingFile ? 'pointer-events-none opacity-60' : ''}`}
                >
                  {readingFile ? (
                    <Loader2 className="size-6 animate-spin text-blue-600" aria-hidden />
                  ) : (
                    <span className="grid size-11 place-items-center rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 transition-transform group-hover:scale-105">
                      <FileUp className="size-5" aria-hidden />
                    </span>
                  )}
                  <span className="text-sm font-medium text-blue-800">
                    {readingFile
                      ? 'Extracting text…'
                      : dragOver
                        ? 'Drop to upload 📥'
                        : 'Click or drag & drop your resume'}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    PDF, DOCX, TXT, MD, CSV or JSON · up to 3 MB
                  </span>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.csv,.json,.text,.pdf,.docx,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    void handleFileChosen(e.target.files?.[0])
                    e.target.value = '' // allow re-picking the same file
                  }}
                />
                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-slate-500">
                  <Info className="mt-0.5 size-3.5 shrink-0 text-sky-600" aria-hidden />
                  PDF &amp; DOCX are parsed on the server. Scanned or image-only PDFs may return
                  no text — paste it manually as a fallback.
                </p>
              </div>
            )}

            <Button
              onClick={() => void analyze()}
              disabled={text.trim().length < MIN_CHARS}
              className="min-h-11 w-full rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700"
            >
              <Sparkles className="size-4" aria-hidden /> ✨ Analyze with AI
            </Button>
          </div>
        )}

        {/* =========================== PARSING ========================== */}
        {mode === 'parsing' && (
          <div
            className="space-y-3 rounded-xl border border-blue-100 dark:border-blue-900/60 bg-card/70 p-4"
            role="status"
            aria-live="polite"
            aria-label="Analyzing resume"
          >
            <p className="flex items-center gap-2 text-sm font-medium text-blue-800">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Reading your resume
              <span className="inline-flex gap-0.5" aria-hidden>
                <span className="size-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-sky-500 [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-blue-500 [animation-delay:300ms]" />
              </span>
            </p>
            <div className="space-y-2">
              <div className="h-3 w-2/3 animate-pulse rounded-full bg-blue-100 dark:bg-blue-900/40" />
              <div className="h-3 w-full animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
              <div className="h-3 w-5/6 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
              <div className="h-3 w-1/2 animate-pulse rounded-full bg-sky-100 dark:bg-sky-900/40" />
            </div>
          </div>
        )}

        {/* ============================ REVIEW ========================== */}
        {mode === 'review' && (
          <div className="space-y-4">
            {/* --- checkbox list of editable fields --- */}
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {(Object.keys(FIELD_LABELS) as FieldKey[]).map((key) => {
                const value = fieldValue(review, key)
                if (value === null) return null // hide empty extractable fields entirely
                const id = `rp-field-${key}`
                return (
                  <div key={key} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={checks[key]}
                        onCheckedChange={(v) =>
                          setChecks((c) => ({ ...c, [key]: v === true }))
                        }
                        aria-label={`Include ${FIELD_LABELS[key]} in applied fields`}
                        className="border-blue-300 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white"
                      />
                      <Label htmlFor={id} className="cursor-pointer text-[13px] font-medium text-slate-700 dark:text-slate-300">
                        {FIELD_LABELS[key]}
                      </Label>
                    </div>
                    {key === 'skills' ? (
                      renderSkillsPreview()
                    ) : (
                      <Input
                        value={
                          key === 'headline'
                            ? review.headline
                            : key === 'location'
                              ? review.location
                              : key === 'experienceYears'
                                ? review.experienceYears
                                : key === 'currentCompany'
                                  ? review.currentCompany
                                  : review.education
                        }
                        onChange={(e) => {
                          const raw = e.target.value
                          const clean =
                            key === 'experienceYears' ? raw.replace(/[^\d.]/g, '') : raw
                          if (key === 'headline') updateReview('headline', clean)
                          else if (key === 'location') updateReview('location', clean)
                          else if (key === 'experienceYears') updateReview('experienceYears', clean)
                          else if (key === 'currentCompany') updateReview('currentCompany', clean)
                          else if (key === 'education') updateReview('education', clean)
                        }}
                        inputMode={key === 'experienceYears' ? 'decimal' : undefined}
                        aria-label={`Edit extracted ${FIELD_LABELS[key]}`}
                        className="min-h-[40px] rounded-xl border-slate-200 dark:border-slate-800 bg-card/90 focus-visible:ring-blue-300"
                      />
                    )}
                  </div>
                )
              })}
            </div>

            {/* --- summary --- */}
            {summary && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Professional summary
                </p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">{summary}</p>
              </div>
            )}

            {/* --- suggested categories (non-editable) --- */}
            {categories.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Suggested job categories
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <Badge
                      key={c}
                      variant="outline"
                      className="rounded-full border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/40 px-2.5 py-0.5 text-sky-700"
                    >
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* --- actions --- */}
            <div className="space-y-3 border-t border-dashed border-blue-200 dark:border-blue-900/60 pt-3">
              <div className="flex items-start gap-2">
                <Checkbox
                  id="rp-save-resume"
                  checked={saveResume}
                  onCheckedChange={(v) => setSaveResume(v === true)}
                  aria-label="Also save the full resume text to my profile"
                  className="mt-0.5 border-blue-300 data-[state=checked]:border-blue-600 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white"
                />
                <Label
                  htmlFor="rp-save-resume"
                  className="cursor-pointer text-[13px] leading-snug text-slate-600 dark:text-slate-400"
                >
                  Also save the full resume text{' '}
                  <span className="text-slate-400 dark:text-slate-500">(powers better AI interviews)</span>
                </Label>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  onClick={resetToInput}
                  disabled={applying}
                  className="min-h-11 rounded-xl border-slate-200 dark:border-slate-800 bg-card text-slate-600 dark:text-slate-400 hover:bg-slate-50 sm:min-h-[44px]"
                >
                  <RotateCcw className="size-4" aria-hidden /> Start over
                </Button>
                <Button
                  onClick={() => void applyFields()}
                  disabled={!canSubmitApply}
                  className="min-h-11 flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700"
                >
                  {applying ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden /> Applying…
                    </>
                  ) : applyCount > 0 ? (
                    <>
                      <BadgeCheck className="size-4" aria-hidden /> Apply {applyCount}{' '}
                      field{applyCount === 1 ? '' : 's'} to my profile
                    </>
                  ) : (
                    <>Save resume text to my profile</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )

  /* -------- nested renderer for the skills chip editor -------- */
  function renderSkillsPreview() {
    return (
      <div className="space-y-2">
        {review.skills.length > 0 ? (
          <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-card/90 p-2.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-blue-200 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent">
            <div className="flex flex-wrap gap-1.5">
              {review.skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 py-0.5 pl-2.5 pr-1 text-xs font-medium text-blue-800"
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => removeSkill(skill)}
                    aria-label={`Remove skill ${skill}`}
                    className="grid size-4 place-items-center rounded-full text-blue-500 transition-colors hover:bg-blue-200/70 hover:text-blue-800"
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 px-3 py-2 text-xs text-slate-400 dark:text-slate-500">
            No skills detected — add some below.
          </p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            addSkill()
          }}
        >
          <Input
            value={newSkill}
            onChange={(e) => setNewSkill(e.target.value)}
            placeholder="Add a skill…"
            aria-label="Add a skill"
            className="min-h-[36px] flex-1 rounded-lg border-slate-200 dark:border-slate-800 bg-card text-sm focus-visible:ring-blue-300"
          />
          <Button
            type="submit"
            size="sm"
            aria-label="Add skill to list"
            className="min-h-[36px] rounded-lg bg-blue-600 px-3 text-white hover:bg-blue-700"
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </form>
      </div>
    )
  }
}
