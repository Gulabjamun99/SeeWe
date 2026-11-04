'use client'

/**
 * ResumeEditor — LEFT column of the AI Resume Builder.
 *
 * Collapsible sections (Basics / Experience / Skills / Projects / Education /
 * Target JD) over a single draft object owned by ResumeBuilder. Every edit
 * bubbles up through `onChange(patch)` — persistence (debounced autosave)
 * lives in the orchestrator, this file is pure editing + AI controls.
 *
 * AI controls (candidate's OWN self-improvement tool — never any employer
 * evaluation data):
 *  - "✨ Enhance bullets" per experience entry → POST /api/ai/enhance-resume
 *    (bullets keep count/order; one-level Undo per entry)
 *  - "✨ Enhance all" across every entry (each entry gets its own undo slot)
 *  - "🎯 JD Match Score" → POST /api/ai/jd-match with the compiled resume
 *    text + pasted JD; renders a score ring + matched/missing keyword chips
 *    + suggestions; result is saved onto the draft (matchScore/matchGaps).
 */

import { useCallback, useMemo, useState } from 'react'
import {
  Briefcase,
  ChevronDown,
  CornerUpLeft,
  GraduationCap,
  Loader2,
  Plus,
  Sparkles,
  Target,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { JdMatchResult, ResumeExperienceItem, ResumeProjectItem } from '@/lib/types'
import type { ResumeBasicsWithSummary, ResumePreviewDraft } from './ResumeLivePreview'

/** Full editable draft shape shared by editor / preview / orchestrator */
export interface ResumeBuilderDraft extends ResumePreviewDraft {
  id: string | null
  targetJd: string
  matchScore: number | null
  matchGaps: JdMatchResult | null
  /** server timestamp of the last persist (ISO) */
  updatedAt?: string
}

export type ResumeDraftPatch = Partial<Omit<ResumeBuilderDraft, 'id'>>

const MAX_JD_CHARS = 6000 // mirrors the server-side targetJd clamp

/** Compile the draft into plain text for the JD-match AI call */
export function compileResumeText(draft: ResumePreviewDraft): string {
  const b = draft.basics ?? {}
  const parts: string[] = []
  if (b.fullName) parts.push(b.fullName)
  if (b.headline) parts.push(b.headline)
  const contact = [b.email, b.phone, b.location].filter(Boolean).join(' | ')
  if (contact) parts.push(contact)
  if (b.summary) parts.push(`Summary: ${b.summary}`)
  for (const e of draft.experience ?? []) {
    parts.push(
      `${e.role ?? ''} at ${e.company ?? ''} (${e.start ?? ''} - ${e.end ?? ''}): ${(e.bullets ?? [])
        .filter(Boolean)
        .join(' ')}`
    )
  }
  for (const p of draft.projects ?? []) {
    parts.push(
      `Project ${p.name ?? ''}: ${p.description ?? ''} ${(p.bullets ?? []).filter(Boolean).join(' ')}`
    )
  }
  if ((draft.skills ?? []).length) parts.push(`Skills: ${draft.skills.join(', ')}`)
  for (const ed of draft.education ?? []) {
    parts.push(`${ed.degree ?? ''}, ${ed.school ?? ''} (${ed.end ?? ed.start ?? ''})`)
  }
  return parts.join('\n').slice(0, 6000)
}

/* ---------------------------------------------------------------- */
/* Collapsible section shell                                         */
/* ---------------------------------------------------------------- */

function EditorSection({
  icon,
  title,
  hint,
  defaultOpen = false,
  children,
  action,
}: {
  icon: React.ReactNode
  title: string
  hint?: string
  defaultOpen?: boolean
  children: React.ReactNode
  action?: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
            {icon}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
              {title}
            </span>
            {hint && (
              <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">
                {hint}
              </span>
            )}
          </span>
          <ChevronDown className="ml-auto size-4 shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        {action}
      </div>
      <CollapsibleContent>
        <div className="border-t border-slate-100 px-3 py-3.5 dark:border-slate-800">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{children}</Label>
}

/* ---------------------------------------------------------------- */
/* Small helpers                                                     */
/* ---------------------------------------------------------------- */

function emptyExperience(): ResumeExperienceItem {
  return { role: '', company: '', start: '', end: '', bullets: [''] }
}

function emptyProject(): ResumeProjectItem {
  return { name: '', description: '', bullets: [''] }
}

/** JD-match score ring (SVG, color shifts with the score) */
function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const r = 30
  const c = 2 * Math.PI * r
  const filled = (clamped / 100) * c
  const color = clamped >= 70 ? '#059669' : clamped >= 40 ? '#d97706' : '#e11d48'
  return (
    <div className="relative grid size-[84px] shrink-0 place-items-center" role="img" aria-label={`JD match score ${clamped} out of 100`}>
      <svg viewBox="0 0 80 80" className="size-[84px] -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c - filled}`}
        />
      </svg>
      <div className="absolute text-center">
        <span className="block text-xl font-extrabold tabular-nums text-slate-900 dark:text-slate-100">{clamped}</span>
        <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400">/ 100</span>
      </div>
    </div>
  )
}

function KeywordChips({ words, tone }: { words: string[]; tone: 'match' | 'missing' }) {
  if (!words.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {words.slice(0, 24).map((w) => (
        <Badge
          key={w}
          variant="outline"
          className={`rounded-full text-[11px] font-medium ${
            tone === 'match'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
          }`}
        >
          {tone === 'match' ? '✓ ' : '+ '}
          {w}
        </Badge>
      ))}
    </div>
  )
}

/* ---------------------------------------------------------------- */
/* Main editor                                                       */
/* ---------------------------------------------------------------- */

interface ResumeEditorProps {
  draft: ResumeBuilderDraft
  onChange: (patch: ResumeDraftPatch) => void
}

export function ResumeEditor({ draft, onChange }: ResumeEditorProps) {
  /* ---------------- AI working state ---------------- */
  const [enhancingIdx, setEnhancingIdx] = useState<number | null>(null)
  const [enhancingAll, setEnhancingAll] = useState(false)
  /** one-level undo per experience entry: index → bullets before last enhance */
  const [undoMap, setUndoMap] = useState<Record<number, string[]>>({})
  const [matching, setMatching] = useState(false)

  const basics = draft.basics ?? {}
  const experience = useMemo(() => draft.experience ?? [], [draft.experience])
  const skills = draft.skills ?? []
  const projects = draft.projects ?? []
  const education = draft.education ?? []
  const matchGaps = draft.matchGaps ?? null

  const patchBasics = useCallback(
    (patch: Partial<ResumeBasicsWithSummary>) => {
      onChange({ basics: { ...basics, ...patch } })
    },
    [basics, onChange]
  )

  const patchExperience = useCallback(
    (next: ResumeExperienceItem[]) => onChange({ experience: next }),
    [onChange]
  )

  /* ---------------- bullet-level editing ---------------- */
  function setBullet(idx: number, bi: number, value: string) {
    const next = experience.map((e, i) =>
      i === idx ? { ...e, bullets: (e.bullets ?? []).map((b, j) => (j === bi ? value : b)) } : e
    )
    patchExperience(next)
  }

  function addBullet(idx: number) {
    const next = experience.map((e, i) => (i === idx ? { ...e, bullets: [...(e.bullets ?? []), ''] } : e))
    patchExperience(next)
  }

  function removeBullet(idx: number, bi: number) {
    const next = experience.map((e, i) =>
      i === idx ? { ...e, bullets: (e.bullets ?? []).filter((_, j) => j !== bi) } : e
    )
    patchExperience(next)
  }

  /* ---------------- AI enhance ---------------- */
  async function enhanceBullets(idx: number) {
    const entry = experience[idx]
    const bullets = (entry?.bullets ?? []).map((b) => b.trim()).filter(Boolean)
    if (bullets.length === 0) {
      toast.warning('Add at least one bullet before enhancing.')
      return
    }
    setEnhancingIdx(idx)
    try {
      const res = await fetch('/api/ai/enhance-resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bullets,
          context: [entry.role, entry.company].filter(Boolean).join(' at '),
        }),
      })
      const json: { data?: { bullets?: string[]; note?: string }; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data?.bullets) {
        throw new Error(json.error || 'Enhance failed')
      }
      const enhanced = json.data.bullets
      // spread enhanced bullets back over the SAME slots (count/order preserved
      // by the API — extra empty slots stay untouched)
      let ei = 0
      const next = experience.map((e, i) => {
        if (i !== idx) return e
        return {
          ...e,
          bullets: (e.bullets ?? []).map((b) => (b.trim() ? enhanced[ei++] ?? b : b)),
        }
      })
      setUndoMap((m) => ({ ...m, [idx]: experience[idx].bullets ?? [] }))
      patchExperience(next)
      if (json.data.note) toast.info(json.data.note)
      else toast.success('Bullets enhanced — review and Undo if you prefer your originals.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not enhance bullets — please retry.')
    } finally {
      setEnhancingIdx(null)
    }
  }

  function undoEnhance(idx: number) {
    const prev = undoMap[idx]
    if (!prev) return
    const next = experience.map((e, i) => (i === idx ? { ...e, bullets: prev } : e))
    patchExperience(next)
    setUndoMap(({ [idx]: _dropped, ...rest }) => rest)
    toast.info('Reverted to your original bullets.')
  }

  async function enhanceAll() {
    const usable = experience
      .map((e, i) => ({ i, bullets: (e.bullets ?? []).map((b) => b.trim()).filter(Boolean) }))
      .filter((x) => x.bullets.length > 0)
    if (usable.length === 0) {
      toast.warning('Write some bullets first — then let the AI polish them.')
      return
    }
    setEnhancingAll(true)
    try {
      const results = await Promise.all(
        usable.map(async ({ i, bullets }) => {
          const entry = experience[i]
          const res = await fetch('/api/ai/enhance-resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bullets,
              context: [entry.role, entry.company].filter(Boolean).join(' at '),
            }),
          })
          const json: { data?: { bullets?: string[] }; error?: string } = await res.json()
          return { i, before: experience[i].bullets ?? [], after: json.data?.bullets ?? null }
        })
      )
      let changed = 0
      const next = [...experience]
      const undos: Record<number, string[]> = { ...undoMap }
      for (const r of results) {
        if (!r.after) continue
        let ei = 0
        next[r.i] = {
          ...next[r.i],
          bullets: (next[r.i].bullets ?? []).map((b) => (b.trim() ? r.after![ei++] ?? b : b)),
        }
        undos[r.i] = r.before
        changed++
      }
      if (changed === 0) throw new Error('Enhance failed for every entry — please retry.')
      setUndoMap(undos)
      patchExperience(next)
      toast.success(`Enhanced bullets across ${changed} experience ${changed === 1 ? 'entry' : 'entries'}.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not enhance all bullets.')
    } finally {
      setEnhancingAll(false)
    }
  }

  /* ---------------- skills chip input ---------------- */
  const [skillDraft, setSkillDraft] = useState('')
  function commitSkill() {
    const v = skillDraft.trim().replace(/,$/, '')
    if (!v) return
    if (skills.some((s) => s.toLowerCase() === v.toLowerCase())) {
      setSkillDraft('')
      return
    }
    onChange({ skills: [...skills, v].slice(0, 30) })
    setSkillDraft('')
  }

  /* ---------------- projects / education ---------------- */
  function setProjectBullet(pi: number, bi: number, value: string) {
    onChange({
      projects: projects.map((p, i) =>
        i === pi ? { ...p, bullets: (p.bullets ?? []).map((b, j) => (j === bi ? value : b)) } : p
      ),
    })
  }

  /* ---------------- JD match ---------------- */
  async function runJdMatch() {
    const jdText = (draft.targetJd ?? '').trim()
    if (jdText.length < 40) {
      toast.warning('Paste the job description first (at least a few lines).')
      return
    }
    const resumeText = compileResumeText(draft)
    if (resumeText.trim().length < 40) {
      toast.warning('Your resume is still empty — fill in a few sections first.')
      return
    }
    setMatching(true)
    try {
      const res = await fetch('/api/ai/jd-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, jdText: jdText.slice(0, MAX_JD_CHARS) }),
      })
      const json: { data?: JdMatchResult; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) throw new Error(json.error || 'JD match failed')
      const result = json.data
      onChange({
        matchScore: result.matchScore,
        matchGaps: result,
      })
      toast.success(`JD match computed — ${Math.round(result.matchScore)}/100`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not compute the JD match.')
    } finally {
      setMatching(false)
    }
  }

  /* ============================== render ============================== */
  return (
    <div className="space-y-3">
      {/* ------------------------------ BASICS ------------------------------ */}
      <EditorSection icon={<User className="size-3.5" />} title="Basics" hint="Name, headline, contact, summary" defaultOpen>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <FieldLabel>Full name</FieldLabel>
            <Input
              value={basics.fullName ?? ''}
              onChange={(e) => patchBasics({ fullName: e.target.value })}
              placeholder="Arjun Mehta"
              className="h-9 rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Headline</FieldLabel>
            <Input
              value={basics.headline ?? ''}
              onChange={(e) => patchBasics({ headline: e.target.value })}
              placeholder="Senior Frontend Engineer"
              className="h-9 rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Email</FieldLabel>
            <Input
              type="email"
              value={basics.email ?? ''}
              onChange={(e) => patchBasics({ email: e.target.value })}
              placeholder="you@example.com"
              className="h-9 rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Phone</FieldLabel>
            <Input
              value={basics.phone ?? ''}
              onChange={(e) => patchBasics({ phone: e.target.value })}
              placeholder="+91 98765 43210"
              className="h-9 rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Location</FieldLabel>
            <Input
              value={basics.location ?? ''}
              onChange={(e) => patchBasics({ location: e.target.value })}
              placeholder="Bengaluru, India"
              className="h-9 rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>LinkedIn</FieldLabel>
            <Input
              value={basics.links?.linkedin ?? ''}
              onChange={(e) => patchBasics({ links: { ...basics.links, linkedin: e.target.value } })}
              placeholder="linkedin.com/in/you"
              className="h-9 rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>GitHub</FieldLabel>
            <Input
              value={basics.links?.github ?? ''}
              onChange={(e) => patchBasics({ links: { ...basics.links, github: e.target.value } })}
              placeholder="github.com/you"
              className="h-9 rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <FieldLabel>Portfolio</FieldLabel>
            <Input
              value={basics.links?.portfolio ?? ''}
              onChange={(e) => patchBasics({ links: { ...basics.links, portfolio: e.target.value } })}
              placeholder="yoursite.dev"
              className="h-9 rounded-lg"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <FieldLabel>Professional summary</FieldLabel>
            <Textarea
              value={basics.summary ?? ''}
              onChange={(e) => patchBasics({ summary: e.target.value })}
              rows={4}
              maxLength={1200}
              placeholder="Two or three lines on who you are, your strongest stack and the impact you bring."
              className="resize-y rounded-lg text-sm"
            />
          </div>
        </div>
      </EditorSection>

      {/* ---------------------------- EXPERIENCE ---------------------------- */}
      <EditorSection
        icon={<Briefcase className="size-3.5" />}
        title="Experience"
        hint={`${experience.length} ${experience.length === 1 ? 'entry' : 'entries'} · AI bullet enhancer`}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void enhanceAll()}
            disabled={enhancingAll || enhancingIdx != null}
            className="h-8 shrink-0 rounded-lg text-xs"
            aria-label="Enhance bullets in every experience entry with AI"
          >
            {enhancingAll ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5 text-blue-600" />}
            <span className="ml-1 hidden sm:inline">✨ Enhance all</span>
          </Button>
        }
      >
        <div className="space-y-4">
          {experience.map((exp, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40"
            >
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <FieldLabel>Role</FieldLabel>
                  <Input
                    value={exp.role ?? ''}
                    onChange={(e) => patchExperience(experience.map((x, i) => (i === idx ? { ...x, role: e.target.value } : x)))}
                    placeholder="Senior Frontend Engineer"
                    className="h-9 rounded-lg bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Company</FieldLabel>
                  <Input
                    value={exp.company ?? ''}
                    onChange={(e) => patchExperience(experience.map((x, i) => (i === idx ? { ...x, company: e.target.value } : x)))}
                    placeholder="TechNova Solutions"
                    className="h-9 rounded-lg bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Start</FieldLabel>
                  <Input
                    value={exp.start ?? ''}
                    onChange={(e) => patchExperience(experience.map((x, i) => (i === idx ? { ...x, start: e.target.value } : x)))}
                    placeholder="Jan 2021"
                    className="h-9 rounded-lg bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>End</FieldLabel>
                  <Input
                    value={exp.end ?? ''}
                    onChange={(e) => patchExperience(experience.map((x, i) => (i === idx ? { ...x, end: e.target.value } : x)))}
                    placeholder="Present"
                    className="h-9 rounded-lg bg-white dark:bg-slate-900"
                  />
                </div>
              </div>

              {/* bullets */}
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <FieldLabel>Bullets</FieldLabel>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => addBullet(idx)}
                    className="h-7 rounded-lg px-2 text-[11px] text-blue-600 hover:text-blue-700"
                  >
                    <Plus className="size-3" /> Add bullet
                  </Button>
                </div>
                {(exp.bullets ?? []).map((b, bi) => (
                  <div key={bi} className="group relative">
                    <Textarea
                      value={b}
                      onChange={(e) => setBullet(idx, bi, e.target.value)}
                      rows={2}
                      maxLength={400}
                      placeholder="Shipped X that improved Y by Z…"
                      className="resize-y rounded-lg bg-white pr-8 text-[13px] dark:bg-slate-900"
                      aria-label={`Bullet ${bi + 1}`}
                    />
                    {(exp.bullets ?? []).length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeBullet(idx, bi)}
                        aria-label={`Remove bullet ${bi + 1}`}
                        className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* per-entry AI controls */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void enhanceBullets(idx)}
                  disabled={enhancingIdx === idx || enhancingAll}
                  className="h-8 rounded-lg bg-blue-600 text-xs font-semibold text-white hover:bg-blue-700"
                  aria-label="Enhance this entry's bullets with AI"
                >
                  {enhancingIdx === idx ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  ✨ Enhance bullets
                </Button>
                {undoMap[idx] && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => undoEnhance(idx)}
                    className="h-8 rounded-lg text-xs"
                    aria-label="Undo the last AI enhance for this entry"
                  >
                    <CornerUpLeft className="size-3.5" /> Undo enhance
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    patchExperience(experience.filter((_, i) => i !== idx))
                    setUndoMap(({ [idx]: _drop, ...rest }) => rest)
                  }}
                  className="ml-auto h-8 rounded-lg text-xs text-slate-400 hover:text-rose-600"
                  aria-label={`Remove experience entry ${idx + 1}`}
                >
                  <Trash2 className="size-3.5" /> Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => patchExperience([...experience, emptyExperience()])}
            className="w-full rounded-xl border-dashed"
          >
            <Plus className="size-4" /> Add experience
          </Button>
        </div>
      </EditorSection>

      {/* ------------------------------ SKILLS ------------------------------ */}
      <EditorSection icon={<Sparkles className="size-3.5" />} title="Skills" hint={`${skills.length} skills · press Enter to add`}>
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <Input
              value={skillDraft}
              onChange={(e) => setSkillDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitSkill()
                }
              }}
              onBlur={commitSkill}
              placeholder="Type a skill and press Enter…"
              className="h-9 rounded-lg"
              aria-label="Add a skill"
            />
          </div>
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <Badge
                  key={s}
                  variant="secondary"
                  className="gap-1 rounded-full py-1 pr-1.5 text-xs font-medium"
                >
                  {s}
                  <button
                    type="button"
                    onClick={() => onChange({ skills: skills.filter((x) => x !== s) })}
                    aria-label={`Remove skill ${s}`}
                    className="grid size-4 place-items-center rounded-full text-slate-400 hover:bg-rose-100 hover:text-rose-600"
                  >
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </EditorSection>

      {/* ----------------------------- PROJECTS ----------------------------- */}
      <EditorSection icon={<Target className="size-3.5" />} title="Projects" hint={`${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}>
        <div className="space-y-4">
          {projects.map((p, pi) => (
            <div key={pi} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="grid gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <FieldLabel>Name</FieldLabel>
                  <Input
                    value={p.name ?? ''}
                    onChange={(e) => onChange({ projects: projects.map((x, i) => (i === pi ? { ...x, name: e.target.value } : x)) })}
                    placeholder="Realtime dashboard"
                    className="h-9 rounded-lg bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <FieldLabel>Link (optional)</FieldLabel>
                  <Input
                    value={p.link ?? ''}
                    onChange={(e) => onChange({ projects: projects.map((x, i) => (i === pi ? { ...x, link: e.target.value } : x)) })}
                    placeholder="github.com/you/project"
                    className="h-9 rounded-lg bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <FieldLabel>Description</FieldLabel>
                  <Textarea
                    value={p.description ?? ''}
                    onChange={(e) => onChange({ projects: projects.map((x, i) => (i === pi ? { ...x, description: e.target.value } : x)) })}
                    rows={2}
                    maxLength={500}
                    placeholder="One line on what it does and the tech behind it."
                    className="resize-y rounded-lg bg-white text-[13px] dark:bg-slate-900"
                  />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <FieldLabel>Bullets</FieldLabel>
                {(p.bullets ?? []).map((b, bi) => (
                  <div key={bi} className="relative">
                    <Textarea
                      value={b}
                      onChange={(e) => setProjectBullet(pi, bi, e.target.value)}
                      rows={2}
                      maxLength={400}
                      placeholder="Built X with Y achieving Z…"
                      className="resize-y rounded-lg bg-white pr-8 text-[13px] dark:bg-slate-900"
                      aria-label={`Project bullet ${bi + 1}`}
                    />
                    {(p.bullets ?? []).length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          onChange({
                            projects: projects.map((x, i) =>
                              i === pi ? { ...x, bullets: (x.bullets ?? []).filter((_, j) => j !== bi) } : x
                            ),
                          })
                        }
                        aria-label={`Remove project bullet ${bi + 1}`}
                        className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-md text-slate-300 transition-colors hover:bg-rose-50 hover:text-rose-500"
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    onChange({
                      projects: projects.map((x, i) => (i === pi ? { ...x, bullets: [...(x.bullets ?? []), ''] } : x)),
                    })
                  }
                  className="h-7 rounded-lg px-2 text-[11px] text-blue-600 hover:text-blue-700"
                >
                  <Plus className="size-3" /> Add bullet
                </Button>
              </div>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange({ projects: projects.filter((_, i) => i !== pi) })}
                  className="h-8 rounded-lg text-xs text-slate-400 hover:text-rose-600"
                  aria-label={`Remove project ${pi + 1}`}
                >
                  <Trash2 className="size-3.5" /> Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => onChange({ projects: [...projects, emptyProject()] })}
            className="w-full rounded-xl border-dashed"
          >
            <Plus className="size-4" /> Add project
          </Button>
        </div>
      </EditorSection>

      {/* ---------------------------- EDUCATION ----------------------------- */}
      <EditorSection icon={<GraduationCap className="size-3.5" />} title="Education" hint={`${education.length} ${education.length === 1 ? 'record' : 'records'}`}>
        <div className="space-y-3">
          {education.map((ed, ei) => (
            <div key={ei} className="grid gap-2.5 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="space-y-1">
                <FieldLabel>Degree</FieldLabel>
                <Input
                  value={ed.degree ?? ''}
                  onChange={(e) => onChange({ education: education.map((x, i) => (i === ei ? { ...x, degree: e.target.value } : x)) })}
                  placeholder="B.Tech CSE"
                  className="h-9 rounded-lg bg-white dark:bg-slate-900"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>School</FieldLabel>
                <Input
                  value={ed.school ?? ''}
                  onChange={(e) => onChange({ education: education.map((x, i) => (i === ei ? { ...x, school: e.target.value } : x)) })}
                  placeholder="VIT Vellore"
                  className="h-9 rounded-lg bg-white dark:bg-slate-900"
                />
              </div>
              <div className="space-y-1">
                <FieldLabel>Year</FieldLabel>
                <Input
                  value={ed.end ?? ''}
                  onChange={(e) => onChange({ education: education.map((x, i) => (i === ei ? { ...x, end: e.target.value } : x)) })}
                  placeholder="2022"
                  className="h-9 rounded-lg bg-white dark:bg-slate-900"
                />
              </div>
              <div className="flex sm:col-span-3">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onChange({ education: education.filter((_, i) => i !== ei) })}
                  className="ml-auto h-7 rounded-lg text-xs text-slate-400 hover:text-rose-600"
                  aria-label={`Remove education record ${ei + 1}`}
                >
                  <Trash2 className="size-3.5" /> Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => onChange({ education: [...education, { degree: '', school: '', end: '' }] })}
            className="w-full rounded-xl border-dashed"
          >
            <Plus className="size-4" /> Add education
          </Button>
        </div>
      </EditorSection>

      {/* ---------------------------- TARGET JD + MATCH ---------------------------- */}
      <EditorSection
        icon={<Target className="size-3.5" />}
        title="Target job description"
        hint="Paste a JD, then check your match score"
      >
        <div className="space-y-3">
          <Textarea
            value={draft.targetJd ?? ''}
            onChange={(e) => onChange({ targetJd: e.target.value.slice(0, MAX_JD_CHARS) })}
            rows={7}
            placeholder="Paste the full job description here — responsibilities, requirements, skills…"
            className="resize-y rounded-lg text-[13px]"
            aria-label="Target job description"
          />
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              onClick={() => void runJdMatch()}
              disabled={matching}
              className="min-h-[42px] rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700"
              aria-label="Compute JD match score for this resume"
            >
              {matching ? <Loader2 className="size-4 animate-spin" /> : <Target className="size-4" />}
              🎯 JD Match Score
            </Button>
            <span className="text-[11px] leading-snug text-slate-400 dark:text-slate-500">
              Your private self-improvement tool — compares <em>your</em> resume against any JD.
            </span>
          </div>

          {/* -------- match result panel -------- */}
          {matchGaps && (
            <div className="space-y-3.5 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-800/40">
              <div className="flex items-center gap-4">
                <ScoreRing score={matchGaps.matchScore} />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {matchGaps.matchScore >= 70
                      ? 'Strong match 🎯'
                      : matchGaps.matchScore >= 40
                        ? 'Partial match — room to grow'
                        : 'Low match — significant gaps'}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {matchGaps.source === 'fallback'
                      ? 'Keyword-overlap analysis (AI scorer was unavailable).'
                      : 'AI analysis of your resume against this job description.'}
                  </p>
                </div>
              </div>
              {matchGaps.matched.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                    Matched keywords
                  </p>
                  <KeywordChips words={matchGaps.matched} tone="match" />
                </div>
              )}
              {matchGaps.missing.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                    Missing keywords — consider adding
                  </p>
                  <KeywordChips words={matchGaps.missing} tone="missing" />
                </div>
              )}
              {matchGaps.suggestions.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Suggestions
                  </p>
                  <ul className="space-y-1.5">
                    {matchGaps.suggestions.slice(0, 6).map((s, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                        <span className="mt-1.5 size-1 shrink-0 rounded-full bg-blue-400" aria-hidden />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </EditorSection>
    </div>
  )
}
