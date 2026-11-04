'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Building2, ImagePlus, Loader2, Megaphone, PencilLine, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AiInterviewConfigurator } from './AiInterviewConfigurator'
import { SkillSuggestions } from './SkillSuggestions'
import { LOGO_INPUT_MAX_BYTES, processLogoFile } from '@/lib/image'
import type { AiInterviewQuestion } from '@/lib/types'

const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship']
const WORK_MODES = ['On-site', 'Hybrid', 'Remote']

/** Company branding — saved on the recruiter account, shown on every job listing */
interface Branding {
  about: string
  website: string
  logoData: string // base64 without the data: prefix ('' = clear)
  logoMime: string
  color: string
}
const EMPTY_BRANDING: Branding = { about: '', website: '', logoData: '', logoMime: '', color: '' }

/**
 * Draft auto-save — the recruiter's half-written post survives EVERYTHING:
 * dialog close, page refresh, even a tab crash. Stored client-side only
 * (new posts), restored on reopen with a toast, discarded on demand.
 */
const DRAFT_KEY = 'seewee.postJobDraft.v1'
interface StoredDraft {
  form: ReturnType<typeof initialState>
  branding: Branding
  aiQuestions: AiInterviewQuestion[]
  savedAt: number
}

function uid(): string {
  return `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function draftIsPristine(
  form: ReturnType<typeof initialState>,
  branding: Branding,
  questions: AiInterviewQuestion[],
): boolean {
  return (
    !form.title.trim() &&
    !form.location.trim() &&
    !form.description.trim() &&
    !form.skills.trim() &&
    !form.jdText.trim() &&
    !form.salaryMinLpa.trim() &&
    !form.salaryMaxLpa.trim() &&
    !branding.about.trim() &&
    !branding.logoData &&
    !branding.website.trim() &&
    !branding.color.trim() &&
    questions.length === 0
  )
}

function loadDraft(): StoredDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<StoredDraft>
    if (!d || typeof d !== 'object' || !d.form) return null
    return {
      form: { ...initialState(), ...d.form },
      branding: { ...EMPTY_BRANDING, ...(d.branding ?? {}) },
      aiQuestions: Array.isArray(d.aiQuestions)
        ? d.aiQuestions
            .filter((q) => q && typeof q.text === 'string')
            .map((q) => ({
              id: typeof q.id === 'string' && q.id ? q.id : uid(),
              text: String(q.text),
              type: q.type === 'TEXT' ? 'TEXT' : q.type === 'VIDEO' ? 'VIDEO' : 'VOICE',
              timeLimitSec: Number(q.timeLimitSec) || 0,
            }))
        : [],
      savedAt: Number(d.savedAt) || 0,
    }
  } catch {
    return null
  }
}

function fmtAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

interface PostJobFormProps {
  recruiterId: string
  onPosted?: () => void
  /** when provided the form edits an existing job via PATCH */
  editJob?: {
    id: string
    title: string
    description: string
    location: string
    jobType: string
    workMode: string
    openings: number
    experienceMin: number
    experienceMax: number
    salaryMinLpa?: number | null
    salaryMaxLpa?: number | null
    skills: string
    jdText?: string | null
    aiInterviewEnabled?: boolean
    aiInterviewConfig?: string | null
  }
  onSaved?: () => void
}

function numeric(v: string): number | undefined {
  const t = v.trim()
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

function initialState(edit?: PostJobFormProps['editJob']) {
  let aiProfile = true
  if (edit?.aiInterviewConfig) {
    try {
      const cfg = JSON.parse(edit.aiInterviewConfig) as {
        includeProfileQuestions?: boolean
      }
      aiProfile = cfg.includeProfileQuestions !== false
    } catch {
      /* ignore corrupt config */
    }
  }
  return {
    title: edit?.title ?? '',
    location: edit?.location ?? '',
    description: edit?.description ?? '',
    skills: edit?.skills ?? '',
    jobType: edit?.jobType || 'Full-time',
    workMode: edit?.workMode || 'On-site',
    openings: String(edit?.openings ?? 1),
    experienceMin: String(edit?.experienceMin ?? 0),
    experienceMax: String(edit?.experienceMax ?? 5),
    salaryMinLpa: edit?.salaryMinLpa != null ? String(edit.salaryMinLpa) : '',
    salaryMaxLpa: edit?.salaryMaxLpa != null ? String(edit.salaryMaxLpa) : '',
    jdText: edit?.jdText ?? '',
    aiEnabled: edit?.aiInterviewEnabled === true,
    aiProfile,
  }
}

/** Parse the editJob's stored AI question set for the configurator. */
function parseEditQuestions(config: string | null | undefined): AiInterviewQuestion[] {
  if (!config) return []
  try {
    const cfg = JSON.parse(config) as { questions?: AiInterviewQuestion[] }
    return Array.isArray(cfg.questions)
      ? cfg.questions.map((q) => ({
          id: q.id,
          text: q.text,
          type: q.type === 'TEXT' ? 'TEXT' : q.type === 'VIDEO' ? 'VIDEO' : 'VOICE',
          timeLimitSec: Number(q.timeLimitSec) || 0,
        }))
      : []
  } catch {
    return []
  }
}

export function PostJobForm({ recruiterId, onPosted, editJob, onSaved }: PostJobFormProps) {
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const isEdit = !!editJob

  const [form, setForm] = useState(() => initialState(editJob))
  const [aiQuestions, setAiQuestions] = useState<AiInterviewQuestion[]>(() =>
    parseEditQuestions(editJob?.aiInterviewConfig)
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  // ---- company branding (loaded from the recruiter profile, saved with the job) ----
  const [branding, setBranding] = useState<Branding>(EMPTY_BRANDING)
  const [brandingOpen, setBrandingOpen] = useState(false)
  const [brandLoaded, setBrandLoaded] = useState(false)
  // ---- draft auto-save (new posts only; edits always start from the job row) ----
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const hydratedRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const draftRestoredRef = useRef(false)

  const clearDraft = () => {
    try {
      window.localStorage.removeItem(DRAFT_KEY)
    } catch {
      /* storage unavailable */
    }
    setDraftSavedAt(null)
    setDraftRestored(false)
  }

  // Restore once on mount — the recruiter continues exactly where they left off.
  useEffect(() => {
    if (isEdit) {
      hydratedRef.current = true
      return
    }
    const stored = loadDraft()
    if (stored && !draftIsPristine(stored.form, stored.branding, stored.aiQuestions)) {
      setForm(stored.form)
      setBranding(stored.branding)
      setAiQuestions(stored.aiQuestions)
      setDraftSavedAt(stored.savedAt || null)
      setDraftRestored(true)
      draftRestoredRef.current = true
      toast.info('📝 Draft restored — continue where you left off')
    }
    hydratedRef.current = true
  }, [isEdit])

  // Debounced autosave — every keystroke lands in localStorage half a second
  // after typing stops, so a crash/close/refresh never eats finished work.
  useEffect(() => {
    if (!hydratedRef.current || isEdit) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      try {
        if (draftIsPristine(form, branding, aiQuestions)) {
          window.localStorage.removeItem(DRAFT_KEY)
          setDraftSavedAt(null)
        } else {
          const savedAt = Date.now()
          window.localStorage.setItem(
            DRAFT_KEY,
            JSON.stringify({ form, branding, aiQuestions, savedAt })
          )
          setDraftSavedAt(savedAt)
        }
      } catch {
        /* storage full/blocked — autosave is best-effort */
      }
    }, 500)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [form, branding, aiQuestions, isEdit])

  const discardDraft = () => {
    clearDraft()
    setForm(initialState())
    setAiQuestions([])
    setBranding(EMPTY_BRANDING)
    toast.info('Draft discarded — blank form ready')
  }

  /* ---------- AI writing assistant (pointers → description + JD draft) ----------
     Advisory by design: the AI only SUGGESTS copy; nothing reaches the form
     fields until the recruiter approves, and they can demand changes first. */
  const [pointers, setPointers] = useState('')
  const [draftGen, setDraftGen] = useState(false)
  const [draftSuggestion, setDraftSuggestion] = useState<{
    description: string
    jdText: string
    source: 'ai' | 'fallback'
  } | null>(null)
  const [changeMode, setChangeMode] = useState(false)
  const [changeFeedback, setChangeFeedback] = useState('')

  const generateDraft = async () => {
    if (!pointers.trim()) {
      toast.error('Add at least one pointer first — the AI drafts from those')
      return
    }
    if (changeMode && !changeFeedback.trim()) {
      toast.error('Write what should change before regenerating')
      return
    }
    setDraftGen(true)
    try {
      const res = await fetch('/api/ai/draft-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pointers: pointers.trim(),
          title: form.title.trim(),
          skills: form.skills.trim(),
          currentDescription: form.description.trim(),
          currentJd: form.jdText.trim(),
          feedback: changeMode ? changeFeedback.trim() : '',
        }),
      })
      const json: {
        data?: { description: string; jdText: string; source?: 'ai' | 'fallback' }
        error?: string
      } = await res.json()
      if (!res.ok || json.error || !json.data)
        throw new Error(json.error || 'Draft generation failed')
      setDraftSuggestion({
        description: json.data.description,
        jdText: json.data.jdText,
        source: json.data.source ?? 'ai',
      })
      setChangeMode(false)
      setChangeFeedback('')
      toast.success('Draft ready — review, then approve or ask for changes')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Draft generation failed')
    } finally {
      setDraftGen(false)
    }
  }

  const approveDraft = () => {
    if (!draftSuggestion) return
    const merge = (cur: string, next: string) =>
      cur.trim() ? `${cur.trimEnd()}\n\n${next.trim()}` : next.trim()
    set('description', merge(form.description, draftSuggestion.description))
    set('jdText', merge(form.jdText, draftSuggestion.jdText))
    setDraftSuggestion(null)
    setChangeFeedback('')
    setChangeMode(false)
    toast.success('✅ Fed into Description & Full JD — edit freely')
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/recruiters/profile?userId=${encodeURIComponent(recruiterId)}`)
        const json: { data?: Record<string, unknown> } = await res.json()
        if (!alive || !res.ok || !json.data) return
        const d = json.data
        // A restored draft carries the recruiter's in-progress branding — the
        // profile defaults must NOT clobber it mid-work.
        if (draftRestoredRef.current) return
        setBranding({
          about: typeof d.companyAbout === 'string' ? d.companyAbout : '',
          website: typeof d.companyWebsite === 'string' ? d.companyWebsite : '',
          logoData: typeof d.companyLogoData === 'string' ? d.companyLogoData : '',
          logoMime: typeof d.companyLogoMime === 'string' ? d.companyLogoMime : '',
          color: typeof d.brandColor === 'string' ? d.brandColor : '',
        })
      } catch {
        /* branding stays empty — optional fields */
      } finally {
        if (alive) setBrandLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [recruiterId])

  const [logoBusy, setLogoBusy] = useState(false)

  /**
   * Any photo works now: 8MB phone snaps and HEIC shots get downscaled to a
   * 512px JPEG in-browser (see lib/image.ts) — no more 300KB rejection dance,
   * and nothing ever leaves the device. The whole flow is wrapped so no
   * failure mode can ever take the dialog down (the "white box" bug).
   */
  const pickLogo = async (file: File | null) => {
    if (!file || logoBusy) return
    setLogoBusy(true)
    try {
      // Phone cameras can hand us 20MB+ shots — bounce those politely BEFORE
      // any canvas work.
      if (file.size > LOGO_INPUT_MAX_BYTES) {
        toast.error('That file is over 25 MB — please pick a smaller image')
        return
      }
      const processed = await processLogoFile(file)
      if (!processed) {
        toast.error('That file could not be read as an image — try a JPG or PNG')
        return
      }
      setBranding((b) => ({ ...b, logoData: processed.data, logoMime: processed.mime }))
      setBrandingOpen(true)
      toast.success(
        `Logo ready (${Math.max(1, Math.round(processed.bytes / 1024))} KB) — it will show on your job listing`
      )
    } catch (err) {
      // Absolutely nothing may crash the form while the recruiter works.
      console.error('[postjob] logo processing failed:', err)
      toast.error('Logo processing failed — try a different image')
    } finally {
      setLogoBusy(false)
    }
  }

  const set = (key: keyof ReturnType<typeof initialState>, value: string | boolean) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e))
  }

  /* ---------- mandatory salary band (transparency policy) ----------
   * Every published listing must show its pay range upfront. New posts
   * need both bounds (> 0 LPA, min ≤ max). Edits validate only the
   * values actually provided so legacy rows keep their stored band. */
  const salMin = numeric(form.salaryMinLpa)
  const salMax = numeric(form.salaryMaxLpa)
  const salaryErrors = useMemo(() => {
    const e: Record<string, string> = {}
    const transparencyMsg = 'Pay range is required — listings must show pay upfront'
    if (isEdit) {
      if (form.salaryMinLpa.trim() !== '' && (salMin === undefined || salMin <= 0))
        e.salaryMinLpa = 'Must be a positive LPA figure'
      if (form.salaryMaxLpa.trim() !== '' && (salMax === undefined || salMax <= 0))
        e.salaryMaxLpa = 'Must be a positive LPA figure'
    } else {
      if (salMin === undefined || salMin <= 0) e.salaryMinLpa = transparencyMsg
      if (salMax === undefined || salMax <= 0) e.salaryMaxLpa = transparencyMsg
    }
    if (salMin !== undefined && salMax !== undefined && salMax < salMin)
      e.salaryMaxLpa = 'Max must be ≥ min'
    return e
  }, [form.salaryMinLpa, form.salaryMaxLpa, salMin, salMax, isEdit])
  const salaryReady = Object.keys(salaryErrors).length === 0

  const addSkill = (s: string) => {
    const cur = form.skills.trim()
    if (cur.toLowerCase().split(',').map((x) => x.trim()).includes(s.toLowerCase())) return
    set('skills', cur ? `${cur}, ${s}` : s)
  }

  const validate = (qs: AiInterviewQuestion[]): boolean => {
    const e: Record<string, string> = { ...salaryErrors }
    if (!form.title.trim()) e.title = 'Job title is required'
    if (!form.location.trim()) e.location = 'Location is required'
    if (!form.description.trim()) e.description = 'Describe the role in a few lines'
    if (!form.skills.trim()) e.skills = 'Add at least one skill'

    const expMin = numeric(form.experienceMin)
    const expMax = numeric(form.experienceMax)
    if (expMin !== undefined && expMin < 0) e.experienceMin = 'Cannot be negative'
    if (expMin !== undefined && expMax !== undefined && expMax < expMin)
      e.experienceMax = 'Max must be ≥ min'

    const openings = numeric(form.openings)
    if (openings !== undefined && openings < 1) e.openings = 'At least 1 opening'

    // AI screening is OPTIONAL — but when it's ON, the recruiter must author
    // at least one complete question (the AI only suggests, never decides).
    // NOTE: empty rows are auto-removed before this runs (see handleSubmit),
    // so this only fires when every row was left blank.
    if (form.aiEnabled) {
      if (qs.length === 0) {
        e.aiQuestions = 'Add at least one interview question (or use AI suggestions)'
      } else if (qs.some((q) => !q.text.trim())) {
        e.aiQuestions = 'Every question needs text — fill in or remove the empty ones'
      }
    }

    setErrors(e)
    return Object.keys(e).length === 0
  }

  const reset = () => {
    setForm(initialState(editJob))
    setAiQuestions(parseEditQuestions(editJob?.aiInterviewConfig))
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()

    // ---- Auto-remove empty question rows instead of blocking the post ----
    // The recruiter keeps momentum: blank rows are dropped with a heads-up
    // toast, and the error only fires when NOTHING is left to ask.
    const filledQuestions = aiQuestions.filter((q) => q.text.trim())
    if (form.aiEnabled && filledQuestions.length < aiQuestions.length) {
      const dropped = aiQuestions.length - filledQuestions.length
      setAiQuestions(filledQuestions)
      toast.info(
        dropped === 1
          ? '1 empty question was removed automatically'
          : `${dropped} empty questions were removed automatically`
      )
    }
    if (!validate(filledQuestions)) return

    setSubmitting(true)
    try {
      const jd = form.jdText.trim()
      const payload = {
        title: form.title.trim(),
        description: form.description.trim(),
        location: form.location.trim(),
        skills: form.skills.trim(),
        jobType: form.jobType,
        workMode: form.workMode,
        openings: numeric(form.openings) ?? 1,
        experienceMin: numeric(form.experienceMin) ?? 0,
        experienceMax: numeric(form.experienceMax) ?? 5,
        salaryMinLpa: numeric(form.salaryMinLpa),
        salaryMaxLpa: numeric(form.salaryMaxLpa),
        jdText: jd ? jd : undefined,
        // ---- company branding (saved on the recruiter account, shown on listings) ----
        companyBranding: {
          companyAbout: branding.about.trim(),
          companyWebsite: branding.website.trim(),
          brandColor: branding.color.trim(),
          companyLogoData: branding.logoData, // '' clears a previously saved logo
          companyLogoMime: branding.logoMime,
        },
        // ---- AI screening (OPTIONAL per job) ----
        aiInterviewEnabled: form.aiEnabled,
        ...(form.aiEnabled
          ? {
              aiInterviewConfig: {
                questions: filledQuestions.map((q) => ({
                  id: q.id,
                  text: q.text.trim(),
                  type: q.type,
                  timeLimitSec: q.timeLimitSec,
                })),
                includeProfileQuestions: form.aiProfile,
              },
            }
          : {}),
      }

      const res = isEdit
        ? await fetch(`/api/jobs/${editJob!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/api/jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recruiterId, ...payload }),
          })
      const json: { data?: unknown; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || (isEdit ? 'Failed to update job' : 'Failed to post job'))

      if (isEdit) {
        toast.success('✏️ Job updated successfully!')
        onSaved?.()
      } else {
        toast.success('🎉 Job posted successfully!')
        clearDraft()
        reset()
        onPosted?.()
      }
      bumpRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  const fieldCls = 'space-y-1.5'
  const inputCls = 'h-11 sm:h-9 rounded-lg border-slate-200 dark:border-slate-800 focus-visible:ring-blue-500/40'

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-blue-700">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
            {isEdit ? <PencilLine className="size-4" aria-hidden /> : <Megaphone className="size-4" aria-hidden />}
          </span>
          <p className="text-sm font-medium">
            {isEdit
              ? 'Update this role — candidates see changes instantly.'
              : 'Publish a role — you decide how candidates get screened.'}
          </p>
        </div>
        {!isEdit && (draftSavedAt || draftRestored) && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            💾 Draft auto-saved{draftSavedAt ? ` · ${fmtAgo(draftSavedAt)}` : ''}
            <button
              type="button"
              onClick={discardDraft}
              className="ml-0.5 rounded-full px-1.5 text-[11px] font-semibold text-rose-600 underline-offset-2 hover:underline dark:text-rose-400"
              aria-label="Discard the saved draft and reset the form"
            >
              Discard
            </button>
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={fieldCls}>
          <Label htmlFor="pj-title">
            Job title <span className="text-blue-600">*</span>
          </Label>
          <Input
            id="pj-title"
            placeholder="e.g. Senior Frontend Engineer"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            className={inputCls}
            aria-invalid={!!errors.title}
          />
          {errors.title && <p className="text-xs text-rose-600 dark:text-rose-300">{errors.title}</p>}
        </div>

        <div className={fieldCls}>
          <Label htmlFor="pj-location">
            Location <span className="text-blue-600">*</span>
          </Label>
          <Input
            id="pj-location"
            placeholder="e.g. Bengaluru, India"
            value={form.location}
            onChange={(e) => set('location', e.target.value)}
            className={inputCls}
            aria-invalid={!!errors.location}
          />
          {errors.location && <p className="text-xs text-rose-600 dark:text-rose-300">{errors.location}</p>}
        </div>

        <div className={fieldCls}>
          <Label htmlFor="pj-jobtype">Job type</Label>
          <Select value={form.jobType} onValueChange={(v) => set('jobType', v)}>
            <SelectTrigger id="pj-jobtype" className="w-full rounded-lg border-slate-200 dark:border-slate-800">
              <SelectValue placeholder="Select job type" />
            </SelectTrigger>
            <SelectContent>
              {JOB_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className={fieldCls}>
          <Label htmlFor="pj-workmode">Work mode</Label>
          <Select value={form.workMode} onValueChange={(v) => set('workMode', v)}>
            <SelectTrigger id="pj-workmode" className="w-full rounded-lg border-slate-200 dark:border-slate-800">
              <SelectValue placeholder="Select work mode" />
            </SelectTrigger>
            <SelectContent>
              {WORK_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Description + full JD sit side-by-side on wide screens — halves the vertical scroll */}
        <div className="grid gap-4 md:col-span-2 lg:grid-cols-2">
          <div className={fieldCls}>
            <Label htmlFor="pj-desc">
              Description <span className="text-blue-600">*</span>
            </Label>
            <Textarea
              id="pj-desc"
              rows={6}
              placeholder="What will this person own? Team, stack, growth path…"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className="resize-y rounded-lg border-slate-200 dark:border-slate-800"
              aria-invalid={!!errors.description}
            />
            {errors.description && <p className="text-xs text-rose-600 dark:text-rose-300">{errors.description}</p>}
          </div>

          <div className={fieldCls}>
            <Label htmlFor="pj-jd" className="leading-snug">
              Full JD{' '}
              <span className="block font-normal text-muted-foreground sm:inline">
                (powers AI question suggestions &amp; candidate matching)
              </span>
            </Label>
            <Textarea
              id="pj-jd"
              rows={6}
              placeholder="Paste the complete job description here — responsibilities, requirements, nice-to-haves… The richer this is, the sharper the AI question suggestions become."
              value={form.jdText}
              onChange={(e) => set('jdText', e.target.value)}
              className="resize-y rounded-lg border-slate-200 dark:border-slate-800 bg-blue-50/30 focus-visible:ring-blue-500/40"
            />
          </div>
        </div>

        <div className={`${fieldCls} md:col-span-2`}>
          <Label htmlFor="pj-skills">
            Skills <span className="text-blue-600">*</span>{' '}
            <span className="font-normal text-muted-foreground">(comma separated — tap a suggestion or type your own)</span>
          </Label>
          <Input
            id="pj-skills"
            placeholder="e.g. Patient Care, Tally, SEO, Cold Calling — role ke hisaab se"
            value={form.skills}
            onChange={(e) => set('skills', e.target.value)}
            className={inputCls}
            aria-invalid={!!errors.skills}
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            <SkillSuggestions title={form.title} description={form.description} onAdd={addSkill} />
          </div>
          {errors.skills && <p className="text-xs text-rose-600 dark:text-rose-300">{errors.skills}</p>}
        </div>

        <div className={fieldCls}>
          <Label htmlFor="pj-openings">Openings</Label>
          <Input
            id="pj-openings"
            type="number"
            min={1}
            value={form.openings}
            onChange={(e) => set('openings', e.target.value)}
            className={inputCls}
          />
          {errors.openings && <p className="text-xs text-rose-600 dark:text-rose-300">{errors.openings}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className={fieldCls}>
            <Label htmlFor="pj-expmin">Exp. min (yrs)</Label>
            <Input
              id="pj-expmin"
              type="number"
              min={0}
              value={form.experienceMin}
              onChange={(e) => set('experienceMin', e.target.value)}
              className={inputCls}
            />
            {errors.experienceMin && (
              <p className="text-xs text-rose-600 dark:text-rose-300">{errors.experienceMin}</p>
            )}
          </div>
          <div className={fieldCls}>
            <Label htmlFor="pj-expmax">Exp. max (yrs)</Label>
            <Input
              id="pj-expmax"
              type="number"
              min={0}
              value={form.experienceMax}
              onChange={(e) => set('experienceMax', e.target.value)}
              className={inputCls}
            />
            {errors.experienceMax && (
              <p className="text-xs text-rose-600 dark:text-rose-300">{errors.experienceMax}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:col-span-2">
          <div className={fieldCls}>
            <Label htmlFor="pj-salmin">
              Salary min (LPA) <span className="text-rose-500" aria-hidden>*</span>
            </Label>
            <Input
              id="pj-salmin"
              type="number"
              min={0}
              placeholder="e.g. 8"
              value={form.salaryMinLpa}
              onChange={(e) => set('salaryMinLpa', e.target.value)}
              className={inputCls}
              aria-invalid={!!(errors.salaryMinLpa || salaryErrors.salaryMinLpa)}
            />
            {(errors.salaryMinLpa || salaryErrors.salaryMinLpa) && (
              <p className="text-xs text-rose-600 dark:text-rose-300">
                {errors.salaryMinLpa || salaryErrors.salaryMinLpa}
              </p>
            )}
          </div>
          <div className={fieldCls}>
            <Label htmlFor="pj-salmax">
              Salary max (LPA) <span className="text-rose-500" aria-hidden>*</span>
            </Label>
            <Input
              id="pj-salmax"
              type="number"
              min={0}
              placeholder="e.g. 14"
              value={form.salaryMaxLpa}
              onChange={(e) => set('salaryMaxLpa', e.target.value)}
              className={inputCls}
              aria-invalid={!!(errors.salaryMaxLpa || salaryErrors.salaryMaxLpa)}
            />
            {(errors.salaryMaxLpa || salaryErrors.salaryMaxLpa) && (
              <p className="text-xs text-rose-600 dark:text-rose-300">
                {errors.salaryMaxLpa || salaryErrors.salaryMaxLpa}
              </p>
            )}
          </div>
          <p className="col-span-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            <span className="font-semibold text-rose-500" aria-hidden>*</span> Required — every
            listing shows its pay range upfront (transparency policy)
          </p>
        </div>

      </div>

      {/* ================= AI WRITING ASSISTANT (pointers → draft) =================
          The recruiter lists plain pointers; the AI turns them into a suggested
          Description + Full JD. NOTHING is filled without an explicit approve,
          and the recruiter can request targeted changes before approving. */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-teal-500 text-white shadow-sm">
            <Sparkles className="size-4.5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              AI writing assistant{' '}
              <span className="ml-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Optional
              </span>
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Type a few pointers of what you want — the AI drafts your Description and Full JD
              from them. You approve it, request changes, or ignore it: nothing lands in the form
              without your OK.
            </p>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          <Label htmlFor="pj-pointers" className="text-xs">
            Your pointers{' '}
            <span className="font-normal text-muted-foreground">(one per line or comma separated)</span>
          </Label>
          <Textarea
            id="pj-pointers"
            rows={3}
            value={pointers}
            onChange={(e) => setPointers(e.target.value)}
            placeholder="e.g. hybrid Gurgaon, 4-day week option, equity for early hires, owns the payments pod, urgent joining, Python + AWS team of 6"
            aria-label="Pointers for the AI writing assistant"
            className="resize-y rounded-lg border-slate-200 text-[13px] dark:border-slate-800"
            maxLength={1500}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void generateDraft()}
              disabled={draftGen}
              className="min-h-9 rounded-lg border-blue-200 bg-blue-50/60 text-blue-700 hover:bg-blue-100 hover:text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300"
            >
              {draftGen ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-4" aria-hidden />
              )}
              {draftSuggestion ? 'Regenerate draft' : 'Suggest Description & JD'}
            </Button>
            {draftSuggestion && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraftSuggestion(null)
                  setChangeFeedback('')
                  setChangeMode(false)
                }}
                className="min-h-9 rounded-lg text-slate-500"
              >
                Dismiss
              </Button>
            )}
          </div>
        </div>

        {draftSuggestion && (
          <div className="mt-3 space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3 dark:border-blue-900/60 dark:bg-blue-950/20">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-blue-800 dark:text-blue-200">
              <Sparkles className="size-3.5" aria-hidden /> AI draft — review, then approve or ask
              for changes
              {draftSuggestion.source === 'fallback' ? (
                <span
                  className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
                  title="The AI model was unavailable — this is a template built from your pointers."
                >
                  offline template
                </span>
              ) : (
                <span
                  className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                  title="Generated live from your pointers, title and skills."
                >
                  AI-generated
                </span>
              )}
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="min-w-0 space-y-1 rounded-lg border border-blue-100 bg-white p-2.5 dark:border-blue-900/50 dark:bg-slate-900">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Description preview
                </p>
                <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
                  {draftSuggestion.description}
                </p>
              </div>
              <div className="min-w-0 space-y-1 rounded-lg border border-blue-100 bg-white p-2.5 dark:border-blue-900/50 dark:bg-slate-900">
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Full JD preview
                </p>
                <p className="max-h-56 overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-slate-700 dark:text-slate-200">
                  {draftSuggestion.jdText}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={approveDraft}
                className="h-9 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm hover:from-blue-700 hover:to-sky-600"
              >
                ✅ Approve — feed into Description &amp; JD
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setChangeMode((v) => !v)}
                className="h-9 rounded-lg border-blue-200 bg-white text-blue-700 hover:bg-blue-50 dark:border-blue-900 dark:bg-slate-900 dark:text-blue-300"
              >
                🔁 Request changes
              </Button>
            </div>
            {changeMode && (
              <div className="space-y-2 rounded-lg border border-blue-100 bg-white p-2.5 dark:border-blue-900/50 dark:bg-slate-900">
                <Label htmlFor="pj-change-feedback" className="text-xs">
                  What should change, and where?
                </Label>
                <Textarea
                  id="pj-change-feedback"
                  rows={2}
                  value={changeFeedback}
                  onChange={(e) => setChangeFeedback(e.target.value)}
                  placeholder="e.g. remove the equity line from the description, mention relocation support in the JD, make the tone more formal…"
                  aria-label="Change request for the AI draft"
                  className="resize-y rounded-lg border-slate-200 text-[13px] dark:border-slate-800"
                  maxLength={600}
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void generateDraft()}
                    disabled={draftGen || !changeFeedback.trim()}
                    className="h-8 rounded-lg border-blue-200 text-blue-700 dark:border-blue-900 dark:text-blue-300"
                  >
                    {draftGen ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="size-3.5" aria-hidden />
                    )}
                    Regenerate with my changes
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ================= COMPANY BRANDING ================= */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 shadow-sm">
        <button
          type="button"
          onClick={() => setBrandingOpen((o) => !o)}
          className="flex w-full items-center gap-3 p-4 text-left"
          aria-expanded={brandingOpen}
        >
          {branding.logoData ? (
             
            <img
              src={`data:${branding.logoMime || 'image/png'};base64,${branding.logoData}`}
              alt={`${form.title ? 'Company' : 'Your'} logo preview`}
              className="size-9 shrink-0 rounded-lg border border-slate-200 object-cover dark:border-slate-700"
            />
          ) : (
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-sm">
              <Building2 className="size-4.5" aria-hidden />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Company branding
              {branding.about.trim() || branding.logoData ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  On your listing
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                  Optional
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
              About the company, logo, website &amp; brand colour — shown to candidates on your job
              posts. {brandLoaded ? 'Pre-filled from your profile.' : ''}
            </span>
          </span>
          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
            {brandingOpen ? 'Hide' : 'Edit'}
          </span>
        </button>

        {brandingOpen && (
          <div className="space-y-4 border-t border-slate-100 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-start gap-4">
              {/* logo picker — the input is focus-immune (tabIndex=-1 + pinned
                  to the viewport): the OS file-picker handoff can never
                  focus-scroll a dialog ancestor into a blank region, which is
                  what blanked the whole dialog at click time. */}
              <div className="flex items-center gap-3">
                <div
                  className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700"
                  style={branding.color ? { borderColor: branding.color } : undefined}
                  aria-busy={logoBusy}
                >
                  {logoBusy ? (
                    <Loader2 className="size-5 animate-spin text-slate-400" aria-hidden />
                  ) : branding.logoData ? (
                    <img
                      src={`data:${branding.logoMime || 'image/png'};base64,${branding.logoData}`}
                      alt="Company logo preview"
                      className="size-full object-cover"
                    />
                  ) : (
                    <Building2 className="size-6 text-slate-300 dark:text-slate-600" aria-hidden />
                  )}
                </div>
                <div className="space-y-1.5">
                  <label
                    className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors ${
                      logoBusy
                        ? 'cursor-wait opacity-60'
                        : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <ImagePlus className="size-3.5" aria-hidden />
                    {logoBusy ? 'Processing…' : 'Upload logo'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      // Pinned to the viewport + non-focusable: a fixed element
                      // has no scrollable ancestor inside the dialog, so
                      // Chrome's scroll-into-view on picker-close is a no-op.
                      className="pointer-events-none fixed top-0 left-0 size-px opacity-0"
                      tabIndex={-1}
                      disabled={logoBusy}
                      onChange={(e) => {
                        const picked = e.target.files?.[0] ?? null
                        e.currentTarget.value = ''
                        void pickLogo(picked)
                      }}
                      aria-label="Upload company logo"
                    />
                  </label>
                  {branding.logoData && (
                    <button
                      type="button"
                      onClick={() => setBranding((b) => ({ ...b, logoData: '', logoMime: '' }))}
                      className="flex items-center gap-1 text-[11px] text-rose-600 hover:underline dark:text-rose-400"
                    >
                      <X className="size-3" aria-hidden /> Remove logo
                    </button>
                  )}
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">PNG/JPG/WebP · under 300KB</p>
                </div>
              </div>

              {/* brand colour */}
              <div className="space-y-1.5">
                <Label htmlFor="pj-brandcolor" className="text-xs">
                  Brand colour
                </Label>
                <div className="flex items-center gap-2">
                  <input
                    id="pj-brandcolor"
                    type="color"
                    value={branding.color || '#0f766e'}
                    onChange={(e) => setBranding((b) => ({ ...b, color: e.target.value }))}
                    className="size-9 cursor-pointer rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900"
                    aria-label="Pick brand colour"
                  />
                  <Input
                    value={branding.color}
                    onChange={(e) => {
                      const v = e.target.value
                      setBranding((b) => ({ ...b, color: v.startsWith('#') ? v : v ? `#${v.replace(/#/g, '')}` : '' }))
                    }}
                    placeholder="#0f766e"
                    maxLength={7}
                    className="h-9 w-28 rounded-lg border-slate-200 text-xs dark:border-slate-800"
                    aria-label="Brand colour hex value"
                  />
                </div>
              </div>

              {/* website */}
              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="pj-website" className="text-xs">
                  Company website
                </Label>
                <Input
                  id="pj-website"
                  value={branding.website}
                  onChange={(e) => setBranding((b) => ({ ...b, website: e.target.value }))}
                  placeholder="https://yourcompany.com"
                  className="h-9 rounded-lg border-slate-200 text-xs dark:border-slate-800"
                  aria-label="Company website URL"
                />
              </div>
            </div>

            {/* about the company */}
            <div className="space-y-1.5">
              <Label htmlFor="pj-about" className="text-xs">
                About the company{' '}
                <span className="font-normal text-muted-foreground">
                  (what candidates read on your job post)
                </span>
              </Label>
              <Textarea
                id="pj-about"
                rows={4}
                maxLength={1200}
                value={branding.about}
                onChange={(e) => setBranding((b) => ({ ...b, about: e.target.value }))}
                placeholder="What does your company do? Culture, mission, products, team size, growth story… e.g. “TechNova builds AI-powered logistics software used by 400+ warehouses across India. 120 people, hybrid culture, backed by Sequoia.”"
                className="resize-y rounded-lg border-slate-200 text-[13px] dark:border-slate-800"
                aria-label="About the company"
              />
              <p className="text-right text-[11px] text-slate-400">{branding.about.length}/1200</p>
            </div>
          </div>
        )}
      </div>

      {/* ================= AI SCREENING (OPTIONAL PER JOB) ================= */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-teal-500 text-white shadow-sm">
              <Bot className="size-4.5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                AI Screening Interview{' '}
                <span className="ml-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Optional
                </span>
              </p>
              <p className="mt-0.5 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Turn on to let the AI interview shortlisted candidates with YOUR questions — you
                add, edit and delete them, set voice or typed answers and the time limit for each.
                Leave it off to skip AI screening for this role.
              </p>
            </div>
          </div>
          <Switch
            checked={form.aiEnabled}
            onCheckedChange={(v) => set('aiEnabled', v)}
            aria-label="Enable AI screening interview for this job"
            className="mt-1 data-[state=checked]:bg-blue-600"
          />
        </div>

        {form.aiEnabled && (
          <div className="mt-4 space-y-3">
            <AiInterviewConfigurator
              questions={aiQuestions}
              onChange={setAiQuestions}
              jobId={editJob?.id}
              draft={{ title: form.title, skills: form.skills, jdText: form.jdText || form.description }}
            />
            <label className="flex items-center gap-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 px-3 py-2.5">
              <Switch
                checked={form.aiProfile}
                onCheckedChange={(v) => set('aiProfile', v)}
                aria-label="Include closing profile questions"
                className="data-[state=checked]:bg-blue-600"
              />
              <span className="text-xs leading-snug text-slate-600 dark:text-slate-300">
                Also ask the standard closing profile questions (location, total experience, notice
                period, salary expectations) — answers auto-fill the candidate profile.
              </span>
            </label>
            {errors.aiQuestions && (
              <p className="text-xs font-medium text-rose-600 dark:text-rose-300">{errors.aiQuestions}</p>
            )}
          </div>
        )}
      </div>

      {/* Sticky submit — the action button stays visible while the form scrolls.
          Transparency policy: a listing without a pay band cannot be published. */}
      <div className="sticky bottom-0 z-10 -mx-1 bg-gradient-to-t from-background via-background/95 to-transparent px-1 pb-1 pt-4">
        <Button
          type="submit"
          disabled={submitting || (!isEdit && !salaryReady)}
          className="h-11 w-full rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-md transition-all hover:from-blue-700 hover:to-sky-600 hover:shadow-lg sm:h-10"
        >
          {submitting ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden /> {isEdit ? 'Saving…' : 'Posting…'}
            </>
          ) : isEdit ? (
            <>💾 Save changes</>
          ) : (
            <>🚀 Post Job</>
          )}
        </Button>
      </div>
    </form>
  )
}
