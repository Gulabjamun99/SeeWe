'use client'

/**
 * NaukriProfileSections — the naukri.com-style structured profile blocks that
 * live in the candidate's Profile tab:
 *   1. Profile photo (upload / change / remove, client-side resized)
 *   2. Account verification badges (email ✓ / mobile ✓)
 *   3. Employment history (multiple companies — designation, period, details)
 *   4. Education, Key projects, Certifications
 *   5. Desired job preferences
 *   6. CV builder — generates a clean printable CV from the profile data
 *      (browser Print → Save as PDF), the naukri "create CV" feel.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import {
  Briefcase,
  Camera,
  CheckCircle2,
  FileDown,
  GraduationCap,
  Loader2,
  MailCheck,
  BadgeCheck as PhoneCheck,
  Pencil,
  Plus,
  Target,
  Trash2,
  Trophy,
  FolderKanban,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { printElement } from '@/lib/print'
import type { User } from '@/lib/types'
import { NaukriCvVersions } from './NaukriCvVersions'
import { CvOptimizer } from './CvOptimizer'

/* ------------------------------- types -------------------------------- */

interface WorkExperience {
  id: string
  title: string
  company: string
  isCurrent: boolean
  startDate: string
  endDate: string | null
  location: string | null
  description: string | null
}
interface UserProject {
  id: string
  title: string
  techStack: string | null
  startDate: string | null
  endDate: string | null
  description: string | null
  link: string | null
}
interface EducationEntry {
  id: string
  degree: string
  institution: string
  startYear: string | null
  endYear: string | null
  score: string | null
}
interface Certification {
  id: string
  name: string
  issuer: string | null
  year: string | null
  link: string | null
}
interface Sections {
  experiences: WorkExperience[]
  projects: UserProject[]
  education: EducationEntry[]
  certifications: Certification[]
}
const EMPTY: Sections = { experiences: [], projects: [], education: [], certifications: [] }

type SectionType = 'experience' | 'project' | 'education' | 'certification'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtYM(ym: string | null | undefined): string {
  if (!ym) return ''
  const [y, m] = ym.split('-')
  const idx = Number(m) - 1
  return `${MONTHS[idx] ?? m} ${y}`
}

function duration(start: string, end: string | null, isCurrent: boolean): string {
  if (!start) return ''
  const [sy, sm] = start.split('-').map(Number)
  let ey: number, em: number
  if (isCurrent || !end) {
    const now = new Date()
    ey = now.getFullYear()
    em = now.getMonth() + 1
  } else {
    const parts = end.split('-').map(Number)
    ey = parts[0]
    em = parts[1]
  }
  const months = Math.max(0, (ey - sy) * 12 + (em - sm))
  const yrs = Math.floor(months / 12)
  const mos = months % 12
  const bits: string[] = []
  if (yrs) bits.push(`${yrs} yr${yrs > 1 ? 's' : ''}`)
  if (mos) bits.push(`${mos} mo${mos > 1 ? 's' : ''}`)
  return bits.join(' ') || '<1 mo'
}

/* ----------------------------- main export ----------------------------- */

export function NaukriProfileSections({
  user,
  onProfileChanged,
}: {
  user: User
  onProfileChanged?: () => void
}) {
  const [sections, setSections] = useState<Sections | null>(null)
  const [dialog, setDialog] = useState<SectionType | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [cvOpen, setCvOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidates/${user.id}/sections`)
      const json = await res.json()
      if (res.ok && json.data) setSections({ ...EMPTY, ...json.data })
    } catch {
      setSections(EMPTY)
    }
  }, [user.id])

  useEffect(() => {
    void load()
  }, [load])

  const photoUrl = user.photoMime ? `/api/candidates/${user.id}/photo?v=${encodeURIComponent(user.photoUploadedAt ?? '')}` : null

  async function saveSection(type: SectionType, fields: Record<string, unknown>) {
    setSaving(true)
    try {
      const method = editingId ? 'PATCH' : 'POST'
      const payload = editingId ? { type, itemId: editingId, ...fields } : { type, ...fields }
      const res = await fetch(`/api/candidates/${user.id}/sections`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      setSections({ ...EMPTY, ...json.data })
      toast.success(
        type === 'experience'
          ? editingId
            ? 'Experience updated'
            : 'Experience added'
          : editingId
            ? 'Details updated'
            : 'Added successfully'
      )
      setDialog(null)
      setEditingId(null)
      onProfileChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteSection(type: SectionType, itemId: string) {
    try {
      const res = await fetch(
        `/api/candidates/${user.id}/sections?type=${type}&itemId=${encodeURIComponent(itemId)}`,
        { method: 'DELETE' }
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Delete failed')
      setSections({ ...EMPTY, ...json.data })
      toast.success('Removed')
      onProfileChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function handlePhoto(file: File) {
    setPhotoBusy(true)
    try {
      const dataUrl = await resizeImage(file, 384)
      const res = await fetch(`/api/candidates/${user.id}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Upload failed')
      toast.success('Profile photo updated 📸')
      onProfileChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setPhotoBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removePhoto() {
    setPhotoBusy(true)
    try {
      const res = await fetch(`/api/candidates/${user.id}/photo`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Remove failed')
      toast.success('Photo removed')
      onProfileChanged?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setPhotoBusy(false)
    }
  }

  return (
    <div className="space-y-6" data-testid="naukri-profile-sections">
      {/* ---------- photo + verification strip ---------- */}
      <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm">
        <CardContent className="flex flex-col items-center gap-5 p-6 sm:flex-row sm:items-center">
          <div className="relative">
            {photoUrl ? (
              <Image
                src={photoUrl}
                alt={`${user.name} profile photo`}
                width={96}
                height={96}
                unoptimized
                className="h-24 w-24 rounded-full object-cover ring-2 ring-blue-100 ring-offset-2"
              />
            ) : (
              <div
                aria-hidden
                className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-sky-500 text-3xl font-bold text-white ring-2 ring-blue-100 ring-offset-2"
              >
                {user.name?.slice(0, 1)?.toUpperCase() || '?'}
              </div>
            )}
            <button
              type="button"
              aria-label={photoUrl ? 'Change profile photo' : 'Upload profile photo'}
              onClick={() => fileRef.current?.click()}
              className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white shadow-md transition hover:bg-blue-700"
            >
              {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handlePhoto(f)
              }}
            />
          </div>
          <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
            <h3 className="truncate text-lg font-bold text-slate-900 dark:text-slate-100">{user.name}</h3>
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {user.emailVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  <MailCheck className="h-3 w-3" /> Email verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                  Email not verified
                </span>
              )}
              {user.phoneVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                  <PhoneCheck className="h-3 w-3" /> Mobile verified
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-slate-500">
                  Mobile not verified
                </span>
              )}
            </div>
            {photoUrl && (
              <button
                type="button"
                onClick={() => void removePhoto()}
                className="text-xs font-medium text-slate-400 underline-offset-2 hover:text-red-500 hover:underline"
              >
                Remove photo
              </button>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setCvOpen(true)}
            className="min-h-[44px] gap-2 rounded-xl"
          >
            <FileDown className="h-4 w-4" /> Create CV
          </Button>
        </CardContent>
      </Card>

      {/* ---------- employment history ---------- */}
      <SectionShell
        icon={<Briefcase className="h-4 w-4 text-blue-600" />}
        title="Employment history"
        subtitle="Every company you've worked at — recruiters see this first"
        count={sections?.experiences.length ?? 0}
        onAdd={() => {
          setEditingId(null)
          setDialog('experience')
        }}
        emptyText="Add your work experience — company, designation and what you built there."
      >
        {(sections?.experiences ?? []).map((ex) => (
          <div
            key={ex.id}
            className="group flex items-start gap-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-3.5"
          >
            <div
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-slate-600 shadow-sm ring-1 ring-slate-200"
            >
              {ex.company.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{ex.title}</p>
                {ex.isCurrent && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-600 ring-1 ring-emerald-200">
                    CURRENT
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {ex.company}
                {ex.location ? ` · ${ex.location}` : ''} · {fmtYM(ex.startDate)} —{' '}
                {ex.isCurrent ? 'Present' : fmtYM(ex.endDate) || '—'} · {duration(ex.startDate, ex.endDate, ex.isCurrent)}
              </p>
              {ex.description && (
                <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                  {ex.description}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <IconBtn
                label={`Edit experience at ${ex.company}`}
                onClick={() => {
                  setEditingId(ex.id)
                  setDialog('experience')
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn label={`Delete experience at ${ex.company}`} danger onClick={() => void deleteSection('experience', ex.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </div>
        ))}
      </SectionShell>

      {/* ---------- education ---------- */}
      <SectionShell
        icon={<GraduationCap className="h-4 w-4 text-violet-600" />}
        title="Education"
        subtitle="Degrees, institutions and scores"
        count={sections?.education.length ?? 0}
        onAdd={() => {
          setEditingId(null)
          setDialog('education')
        }}
        emptyText="Add your highest degree — college, year and score."
      >
        {(sections?.education ?? []).map((ed) => (
          <div
            key={ed.id}
            className="group flex items-start gap-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-3.5"
          >
            <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-violet-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{ed.degree}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {ed.institution}
                {ed.startYear || ed.endYear
                  ? ` · ${ed.startYear || '—'} – ${ed.endYear || '—'}`
                  : ''}
                {ed.score ? ` · ${ed.score}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <IconBtn
                label={`Edit ${ed.degree}`}
                onClick={() => {
                  setEditingId(ed.id)
                  setDialog('education')
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn label={`Delete ${ed.degree}`} danger onClick={() => void deleteSection('education', ed.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </div>
        ))}
      </SectionShell>

      {/* ---------- projects ---------- */}
      <SectionShell
        icon={<FolderKanban className="h-4 w-4 text-sky-600" />}
        title="Key projects"
        subtitle="Show the work you're proud of"
        count={sections?.projects.length ?? 0}
        onAdd={() => {
          setEditingId(null)
          setDialog('project')
        }}
        emptyText="Add projects — what you built, the tech stack and outcomes."
      >
        {(sections?.projects ?? []).map((p) => (
          <div
            key={p.id}
            className="group rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-3.5"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.title}</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {p.startDate ? `${fmtYM(p.startDate)}${p.endDate ? ` – ${fmtYM(p.endDate)}` : '+'}` : ''}
                  {p.link ? ` · ${p.link}` : ''}
                </p>
                {p.techStack && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.techStack.split(',').map((t) => t.trim()).filter(Boolean).map((t) => (
                      <span
                        key={t}
                        className="rounded-md bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-100"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                {p.description && (
                  <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    {p.description}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <IconBtn
                  label={`Edit project ${p.title}`}
                  onClick={() => {
                    setEditingId(p.id)
                    setDialog('project')
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </IconBtn>
                <IconBtn label={`Delete project ${p.title}`} danger onClick={() => void deleteSection('project', p.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconBtn>
              </div>
            </div>
          </div>
        ))}
      </SectionShell>

      {/* ---------- certifications ---------- */}
      <SectionShell
        icon={<Trophy className="h-4 w-4 text-amber-500" />}
        title="Certifications"
        subtitle="Courses and credentials you've earned"
        count={sections?.certifications.length ?? 0}
        onAdd={() => {
          setEditingId(null)
          setDialog('certification')
        }}
        emptyText="Add certifications — AWS, Scrum, anything you've earned."
      >
        {(sections?.certifications ?? []).map((c) => (
          <div
            key={c.id}
            className="group flex items-start gap-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-3.5"
          >
            <Trophy className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{c.name}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {[c.issuer, c.year].filter(Boolean).join(' · ')}
                {c.link ? ` · ${c.link}` : ''}
              </p>
            </div>
            <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <IconBtn
                label={`Edit ${c.name}`}
                onClick={() => {
                  setEditingId(c.id)
                  setDialog('certification')
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </IconBtn>
              <IconBtn label={`Delete ${c.name}`} danger onClick={() => void deleteSection('certification', c.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconBtn>
            </div>
          </div>
        ))}
      </SectionShell>

      {/* ---------- desired job ---------- */}
      <DesiredJobCard user={user} onSaved={onProfileChanged} />

      {/* ---------- section dialogs ---------- */}
      {/* ---------- CV version history + optimizer (master spec §6) ---------- */}
      <NaukriCvVersions user={user} />
      <CvOptimizer user={user} />

      {dialog === 'experience' && (
        <ExperienceDialog
          editing={
            editingId ? sections?.experiences.find((e) => e.id === editingId) ?? null : null
          }
          saving={saving}
          onClose={() => {
            setDialog(null)
            setEditingId(null)
          }}
          onSave={(fields) => void saveSection('experience', fields)}
        />
      )}
      {dialog === 'education' && (
        <EducationDialog
          editing={editingId ? sections?.education.find((e) => e.id === editingId) ?? null : null}
          saving={saving}
          onClose={() => {
            setDialog(null)
            setEditingId(null)
          }}
          onSave={(fields) => void saveSection('education', fields)}
        />
      )}
      {dialog === 'project' && (
        <ProjectDialog
          editing={editingId ? sections?.projects.find((p) => p.id === editingId) ?? null : null}
          saving={saving}
          onClose={() => {
            setDialog(null)
            setEditingId(null)
          }}
          onSave={(fields) => void saveSection('project', fields)}
        />
      )}
      {dialog === 'certification' && (
        <CertificationDialog
          editing={editingId ? sections?.certifications.find((c) => c.id === editingId) ?? null : null}
          saving={saving}
          onClose={() => {
            setDialog(null)
            setEditingId(null)
          }}
          onSave={(fields) => void saveSection('certification', fields)}
        />
      )}
      {cvOpen && <CvBuilderDialog user={user} sections={sections ?? EMPTY} onClose={() => setCvOpen(false)} />}
    </div>
  )
}

/* --------------------------- sub-components ---------------------------- */

function IconBtn({
  children,
  label,
  danger,
  onClick,
}: {
  children: React.ReactNode
  label: string
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:text-slate-800 ${
        danger ? 'hover:border-red-200 hover:bg-red-50 hover:text-red-600' : ''
      }`}
    >
      {children}
    </button>
  )
}

function SectionShell({
  icon,
  title,
  subtitle,
  count,
  onAdd,
  emptyText,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  count: number
  onAdd: () => void
  emptyText: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-700 dark:text-slate-300">
            {icon}
            {title}
            {count > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800">
                {count}
              </span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAdd}
          className="min-h-[36px] gap-1.5 rounded-lg text-xs font-semibold"
        >
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>
      {count === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-4 text-center text-xs text-slate-400">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-2.5">{children}</div>
      )}
    </section>
  )
}

/* ------------------------------ dialogs -------------------------------- */

function DialogShell({
  title,
  desc,
  saving,
  onClose,
  onSubmit,
  children,
}: {
  title: string
  desc: string
  saving: boolean
  onClose: () => void
  onSubmit: () => void
  children: React.ReactNode
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg rounded-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
          className="space-y-4"
        >
          {children}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="min-h-[44px] bg-blue-600 hover:bg-blue-700">
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ExperienceDialog({
  editing,
  saving,
  onClose,
  onSave,
}: {
  editing: WorkExperience | null
  saving: boolean
  onClose: () => void
  onSave: (fields: Record<string, unknown>) => void
}) {
  const [title, setTitle] = useState(editing?.title ?? '')
  const [company, setCompany] = useState(editing?.company ?? '')
  const [location, setLocation] = useState(editing?.location ?? '')
  const [startDate, setStartDate] = useState(editing?.startDate ?? '')
  const [endDate, setEndDate] = useState(editing?.endDate ?? '')
  const [isCurrent, setIsCurrent] = useState(editing?.isCurrent ?? false)
  const [description, setDescription] = useState(editing?.description ?? '')

  return (
    <DialogShell
      title={editing ? 'Edit employment' : 'Add employment'}
      desc="Naukri-style employment entry — designation, company, period and details."
      saving={saving}
      onClose={onClose}
      onSubmit={() =>
        onSave({
          title,
          company,
          location,
          startDate,
          endDate: isCurrent ? null : endDate,
          isCurrent,
          description,
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Designation / Job title *">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Frontend Engineer" required maxLength={120} />
        </Field>
        <Field label="Company *">
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="TechNova Solutions" required maxLength={120} />
        </Field>
        <Field label="Location">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bengaluru, India" maxLength={120} />
        </Field>
        <Field label="Started * (month & year)">
          <Input type="month" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </Field>
        <Field label="Worked till">
          {isCurrent ? (
            <Input value="Present" disabled />
          ) : (
            <Input type="month" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          )}
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={isCurrent}
            onChange={(e) => setIsCurrent(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          I currently work here
        </label>
      </div>
      <Field label="What did you build / deliver there?">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          placeholder="Owned the checkout rewrite serving 2M monthly users; cut page load by 38%…"
          maxLength={2000}
        />
      </Field>
    </DialogShell>
  )
}

function EducationDialog({
  editing,
  saving,
  onClose,
  onSave,
}: {
  editing: EducationEntry | null
  saving: boolean
  onClose: () => void
  onSave: (fields: Record<string, unknown>) => void
}) {
  const [degree, setDegree] = useState(editing?.degree ?? '')
  const [institution, setInstitution] = useState(editing?.institution ?? '')
  const [startYear, setStartYear] = useState(editing?.startYear ?? '')
  const [endYear, setEndYear] = useState(editing?.endYear ?? '')
  const [score, setScore] = useState(editing?.score ?? '')

  return (
    <DialogShell
      title={editing ? 'Edit education' : 'Add education'}
      desc="Degree, institution, years and score."
      saving={saving}
      onClose={onClose}
      onSubmit={() => onSave({ degree, institution, startYear, endYear, score })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Degree *">
          <Input value={degree} onChange={(e) => setDegree(e.target.value)} placeholder="B.Tech — Computer Science" required maxLength={160} />
        </Field>
        <Field label="Institution *">
          <Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="IIT Delhi" required maxLength={160} />
        </Field>
        <Field label="Started (year)">
          <Input value={startYear} onChange={(e) => setStartYear(e.target.value)} placeholder="2017" maxLength={9} />
        </Field>
        <Field label="Completed (year)">
          <Input value={endYear} onChange={(e) => setEndYear(e.target.value)} placeholder="2021" maxLength={9} />
        </Field>
        <Field label="Score / CGPA">
          <Input value={score} onChange={(e) => setScore(e.target.value)} placeholder="8.4 CGPA" maxLength={40} />
        </Field>
      </div>
    </DialogShell>
  )
}

function ProjectDialog({
  editing,
  saving,
  onClose,
  onSave,
}: {
  editing: UserProject | null
  saving: boolean
  onClose: () => void
  onSave: (fields: Record<string, unknown>) => void
}) {
  const [title, setTitle] = useState(editing?.title ?? '')
  const [techStack, setTechStack] = useState(editing?.techStack ?? '')
  const [startDate, setStartDate] = useState(editing?.startDate ?? '')
  const [endDate, setEndDate] = useState(editing?.endDate ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [link, setLink] = useState(editing?.link ?? '')

  return (
    <DialogShell
      title={editing ? 'Edit project' : 'Add project'}
      desc="What you built, the stack and the outcome."
      saving={saving}
      onClose={onClose}
      onSubmit={() => onSave({ title, techStack, startDate, endDate, description, link })}
    >
      <Field label="Project title *">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="UPI Payment Gateway" required maxLength={140} />
      </Field>
      <Field label="Tech stack (comma separated)">
        <Input value={techStack} onChange={(e) => setTechStack(e.target.value)} placeholder="React, Node.js, PostgreSQL, Redis" maxLength={300} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Started">
          <Input type="month" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Ended">
          <Input type="month" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
      </div>
      <Field label="About the project">
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Handled 2M+ transactions/month with 99.95% uptime…"
          maxLength={2000}
        />
      </Field>
      <Field label="Link (repo / live)">
        <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://github.com/…" maxLength={300} />
      </Field>
    </DialogShell>
  )
}

function CertificationDialog({
  editing,
  saving,
  onClose,
  onSave,
}: {
  editing: Certification | null
  saving: boolean
  onClose: () => void
  onSave: (fields: Record<string, unknown>) => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [issuer, setIssuer] = useState(editing?.issuer ?? '')
  const [year, setYear] = useState(editing?.year ?? '')
  const [link, setLink] = useState(editing?.link ?? '')

  return (
    <DialogShell
      title={editing ? 'Edit certification' : 'Add certification'}
      desc="Credentials that strengthen your profile."
      saving={saving}
      onClose={onClose}
      onSubmit={() => onSave({ name, issuer, year, link })}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Certification name *">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="AWS Certified Solutions Architect" required maxLength={160} />
        </Field>
        <Field label="Issuer">
          <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Amazon Web Services" maxLength={160} />
        </Field>
        <Field label="Year">
          <Input value={year} onChange={(e) => setYear(e.target.value)} placeholder="2024" maxLength={9} />
        </Field>
        <Field label="Credential link">
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" maxLength={300} />
        </Field>
      </div>
    </DialogShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</Label>
      {children}
    </div>
  )
}

/* ---------------------------- desired job ------------------------------ */

function DesiredJobCard({ user, onSaved }: { user: User; onSaved?: () => void }) {
  const [role, setRole] = useState(user.desiredRole ?? '')
  const [locations, setLocations] = useState(user.desiredLocations ?? '')
  const [jobType, setJobType] = useState(user.desiredJobType ?? '')
  const [industry, setIndustry] = useState(user.desiredIndustry ?? '')
  const [saving, setSaving] = useState(false)
  const dirty =
    role !== (user.desiredRole ?? '') ||
    locations !== (user.desiredLocations ?? '') ||
    jobType !== (user.desiredJobType ?? '') ||
    industry !== (user.desiredIndustry ?? '')

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(`/api/candidates/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          desiredRole: role || null,
          desiredLocations: locations || null,
          desiredJobType: jobType || null,
          desiredIndustry: industry || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Save failed')
      toast.success('Desired job saved 🎯')
      onSaved?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-label="Desired job">
      <div className="mb-3">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-700 dark:text-slate-300">
          <Target className="h-4 w-4 text-emerald-600" aria-hidden />
          Desired job
        </h3>
        <p className="mt-0.5 text-xs text-slate-400">
          What you're looking for next — powers job recommendations and alerts
        </p>
      </div>
      <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preferred role">
              <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior Frontend Engineer" maxLength={120} />
            </Field>
            <Field label="Preferred locations (comma separated)">
              <Input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="Bengaluru, Remote, Pune" maxLength={160} />
            </Field>
            <Field label="Employment type">
              <select
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 text-sm"
              >
                <option value="">Any</option>
                <option value="Full-time">Full-time</option>
                <option value="Part-time">Part-time</option>
                <option value="Contract">Contract</option>
                <option value="Internship">Internship</option>
              </select>
            </Field>
            <Field label="Preferred industry">
              <Input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="IT Services & Consulting" maxLength={120} />
            </Field>
          </div>
          {dirty && (
            <Button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="min-h-[44px] bg-blue-600 hover:bg-blue-700"
            >
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
              Save desired job
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

/* ----------------------------- CV builder ------------------------------ */

function CvBuilderDialog({
  user,
  sections,
  onClose,
}: {
  user: User
  sections: Sections
  onClose: () => void
}) {
  const [profile, setProfile] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/candidates/${user.id}?viewerId=${user.id}`)
        const json = await res.json()
        if (res.ok && json.data) setProfile(json.data)
      } catch {
        setProfile(null)
      }
    })()
  }, [user.id])

  const p = profile ?? user
  const skills = (p.skills ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileDown className="h-5 w-5 text-blue-600" /> Your generated CV
          </DialogTitle>
          <DialogDescription>
            Built live from your profile — employment, education, projects, skills. Press
            <strong> Download / Print as PDF</strong> and choose &quot;Save as PDF&quot;.
          </DialogDescription>
        </DialogHeader>

        {busy && (
          <div className="flex items-center justify-center py-10 text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading profile…
          </div>
        )}

        <div className="flex justify-end" data-print-hide>
          <Button
            type="button"
            onClick={() => {
              setBusy(true)
              // give the frame a tick, then print the sheet element
              setTimeout(() => {
                printElement('cv-sheet', { title: `${(p.name || 'candidate').replace(/\s+/g, '_')}_CV` })
                setBusy(false)
              }, 60)
            }}
            className="min-h-[44px] bg-blue-600 hover:bg-blue-700"
          >
            <FileDown className="mr-1.5 h-4 w-4" /> Download / Print as PDF
          </Button>
        </div>

        {/* printable sheet */}
        <div id="cv-sheet" className="print-section rounded-xl border border-slate-200 bg-white p-6 text-slate-900 shadow-inner">
          <header className="border-b-2 border-slate-800 pb-3">
            <h1 className="text-2xl font-extrabold tracking-tight">{p.name}</h1>
            <p className="mt-0.5 text-sm font-semibold text-slate-600">
              {p.headline || p.desiredRole || 'Professional'}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {[
                p.email,
                p.phone,
                p.location,
                p.experienceYears != null ? `${p.experienceYears} yrs experience` : null,
              ]
                .filter(Boolean)
                .join('  ·  ')}
            </p>
          </header>

          {p.resumeText && (
            <section className="print-section mt-4">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Profile summary</h2>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed">{p.resumeText}</p>
            </section>
          )}

          {skills.length > 0 && (
            <section className="print-section mt-4">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Key skills</h2>
              <p className="mt-1.5 text-sm font-medium">{skills.join('  ·  ')}</p>
            </section>
          )}

          {sections.experiences.length > 0 && (
            <section className="print-section mt-4">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Employment history</h2>
              <div className="mt-2 space-y-3">
                {sections.experiences.map((ex) => (
                  <div key={ex.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-bold">
                        {ex.title}
                        <span className="font-medium text-slate-600"> — {ex.company}</span>
                      </p>
                      <p className="whitespace-nowrap text-xs text-slate-500">
                        {fmtYM(ex.startDate)} — {ex.isCurrent ? 'Present' : fmtYM(ex.endDate) || '—'}
                      </p>
                    </div>
                    {ex.description && (
                      <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-slate-600">{ex.description}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {sections.projects.length > 0 && (
            <section className="print-section mt-4">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Projects</h2>
              <div className="mt-2 space-y-2">
                {sections.projects.map((pr) => (
                  <div key={pr.id}>
                    <p className="text-sm font-bold">
                      {pr.title}
                      {pr.techStack ? <span className="font-medium text-slate-600"> · {pr.techStack}</span> : null}
                    </p>
                    {pr.description && <p className="text-xs leading-relaxed text-slate-600">{pr.description}</p>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {(sections.education.length > 0 || p.education) && (
            <section className="print-section mt-4">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Education</h2>
              <div className="mt-2 space-y-1.5">
                {sections.education.map((ed) => (
                  <p key={ed.id} className="text-sm">
                    <strong>{ed.degree}</strong>
                    {ed.institution ? ` — ${ed.institution}` : ''}
                    {ed.endYear ? ` (${ed.startYear ? `${ed.startYear}–` : ''}${ed.endYear})` : ''}
                    {ed.score ? ` · ${ed.score}` : ''}
                  </p>
                ))}
                {!sections.education.length && p.education && <p className="text-sm">{p.education}</p>}
              </div>
            </section>
          )}

          {sections.certifications.length > 0 && (
            <section className="print-section mt-4">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-slate-500">Certifications</h2>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                {sections.certifications.map((c) => (
                  <li key={c.id} className="text-sm">
                    {c.name}
                    {c.issuer ? ` — ${c.issuer}` : ''}
                    {c.year ? ` (${c.year})` : ''}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------- image resizing ---------------------------- */

/** Resize any picked image to a square-cover avatar (max dimension `size`). */
function resizeImage(file: File, size: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the image'))
    reader.onload = () => {
      const img = new window.Image()
      img.onerror = () => reject(new Error('Could not load the image'))
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const scale = Math.min(size / img.width, size / img.height, 1)
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Canvas unavailable'))
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
