'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  Check,
  ClipboardList,
  FileText,
  GraduationCap,
  Loader2,
  MapPin,
  Megaphone,
  Plus,
  Quote,
  Send,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { useAppStore, skillsToArray, formatLpa } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

/** ---------- shape returned by /api/requisitions ---------- */

interface Requisition {
  id: string
  title: string
  department: string | null
  location: string
  jobType: string
  workMode: string
  experienceMin: number
  experienceMax: number
  salaryMinLpa: number | null
  salaryMaxLpa: number | null
  openings: number
  skills: string
  justification: string | null
  budgetConfirmed: boolean
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'PUBLISHED'
  approverName: string | null
  approverNote: string | null
  decidedAt: string | null
  publishedJobId: string | null
  createdAt: string
  requestedBy: { id: string; name: string; email: string }
  client: { id: string; name: string }
  publishedJob?: { id: string; title: string; status: string } | null
}

/** ---------- status + tracker meta ---------- */

const STATUS_META: Record<Requisition['status'], { label: string; cls: string }> = {
  PENDING_APPROVAL: {
    label: 'Pending approval',
    cls: 'border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300',
  },
  APPROVED: {
    label: 'Approved',
    cls: 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300',
  },
  REJECTED: {
    label: 'Rejected',
    cls: 'border-rose-300 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
  },
  PUBLISHED: {
    label: 'Published',
    cls: 'border-violet-300 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300',
  },
}

const TRACKER_STEPS = ['Submitted', 'Leadership review', 'Approved', 'Published'] as const

/** Which tracker step is the "current" one for a given status (1-based). */
function currentStep(status: Requisition['status']): number {
  switch (status) {
    case 'PENDING_APPROVAL':
      return 2 // sitting with leadership
    case 'APPROVED':
      return 3 // signed off, ready to publish
    case 'PUBLISHED':
      return 4
    case 'REJECTED':
      return 3 // red marker lands on the approval step
  }
}

function ProgressTracker({ status }: { status: Requisition['status'] }) {
  const cur = currentStep(status)
  const rejected = status === 'REJECTED'
  return (
    <div className="flex flex-wrap items-center gap-y-1.5 pt-1" aria-label={`Requisition progress: ${status.replaceAll('_', ' ').toLowerCase()}`}>
      {TRACKER_STEPS.map((label, i) => {
        const stepNo = i + 1
        const done = !rejected && stepNo < cur
        const isCurrent = rejected ? stepNo === 3 : stepNo === cur
        const failed = rejected && stepNo === 3
        const future = !done && !isCurrent
        return (
          <div key={label} className="flex items-center">
            {i > 0 && (
              <span
                className={`mx-1 h-0.5 w-4 rounded-full sm:w-6 ${
                  done || (isCurrent && !future) ? 'bg-emerald-400' : 'bg-slate-200 dark:bg-slate-700'
                } ${failed ? 'bg-rose-400' : ''}`}
                aria-hidden
              />
            )}
            <span className="flex items-center gap-1">
              <span
                className={`grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold ${
                  failed
                    ? 'bg-rose-500 text-white'
                    : done
                      ? 'bg-emerald-500 text-white'
                      : isCurrent
                        ? 'border-2 border-emerald-500 bg-white text-emerald-600 dark:bg-slate-900'
                        : 'border-2 border-slate-200 bg-white text-transparent dark:border-slate-700 dark:bg-slate-900'
                }`}
                aria-hidden
              >
                {failed ? <X className="size-2.5" strokeWidth={3.5} /> : done ? <Check className="size-2.5" strokeWidth={3.5} /> : '·'}
              </span>
              <span
                className={`text-[10px] font-medium sm:text-[11px] ${
                  failed
                    ? 'text-rose-600 dark:text-rose-300'
                    : done || isCurrent
                      ? 'text-slate-700 dark:text-slate-300'
                      : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {label}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** ---------- create form state ---------- */

const JOB_TYPES = ['Full-time', 'Part-time', 'Contract', 'Internship']
const WORK_MODES = ['On-site', 'Hybrid', 'Remote']

const EMPTY_FORM = {
  title: '',
  department: '',
  location: '',
  jobType: 'Full-time',
  workMode: 'On-site',
  experienceMin: '0',
  experienceMax: '5',
  salaryMinLpa: '',
  salaryMaxLpa: '',
  openings: '1',
  skills: '',
  justification: '',
}

function numeric(v: string): number | undefined {
  const t = v.trim()
  if (t === '') return undefined
  const n = Number(t)
  return Number.isFinite(n) ? n : undefined
}

/** ---------- main panel ---------- */

export function RequisitionsPanel() {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)

  const [requisitions, setRequisitions] = useState<Requisition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [budgetConfirmed, setBudgetConfirmed] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [publishingId, setPublishingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user || user.role !== 'RECRUITER') return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/requisitions?userId=${encodeURIComponent(user.id)}`)
      const json: { data?: Requisition[]; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load requisitions')
      setRequisitions(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load requisitions')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const set = (key: keyof typeof EMPTY_FORM, value: string) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e))
  }

  const validate = (): boolean => {
    const e: Record<string, string> = {}
    if (!form.title.trim()) e.title = 'Role title is required'
    if (!form.location.trim()) e.location = 'Location is required'
    if (!form.skills.trim()) e.skills = 'Add at least one skill'

    const expMin = numeric(form.experienceMin)
    const expMax = numeric(form.experienceMax)
    if (expMin !== undefined && expMin < 0) e.experienceMin = 'Cannot be negative'
    if (expMin !== undefined && expMax !== undefined && expMax < expMin)
      e.experienceMax = 'Max must be ≥ min'

    const salMin = numeric(form.salaryMinLpa)
    const salMax = numeric(form.salaryMaxLpa)
    if (salMin !== undefined && salMin <= 0) e.salaryMinLpa = 'Must be a positive LPA figure'
    if (salMin !== undefined && salMax !== undefined && salMax < salMin)
      e.salaryMaxLpa = 'Max must be ≥ min'

    if ((numeric(form.openings) ?? 1) < 1) e.openings = 'At least 1 opening'
    if (!budgetConfirmed) e.budgetConfirmed = 'Budget confirmation is required before sending for approval'

    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!user) return
    if (!validate()) return

    setSubmitting(true)
    try {
      const res = await fetch('/api/requisitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          title: form.title.trim(),
          department: form.department.trim() || undefined,
          location: form.location.trim(),
          jobType: form.jobType,
          workMode: form.workMode,
          experienceMin: numeric(form.experienceMin) ?? 0,
          experienceMax: numeric(form.experienceMax) ?? 5,
          salaryMinLpa: numeric(form.salaryMinLpa),
          salaryMaxLpa: numeric(form.salaryMaxLpa),
          openings: numeric(form.openings) ?? 1,
          skills: form.skills.trim(),
          justification: form.justification.trim() || undefined,
          budgetConfirmed,
        }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to raise requisition')

      toast.success(`Sent to ${user.company || 'company'} leadership for approval`, {
        description: `“${form.title.trim()}” is now pending sign-off — you can publish it once approved.`,
      })
      setForm(EMPTY_FORM)
      setBudgetConfirmed(false)
      setCreateOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  const publish = async (req: Requisition) => {
    if (!user) return
    setPublishingId(req.id)
    try {
      const res = await fetch(`/api/requisitions/${req.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, action: 'PUBLISH' }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to publish requisition')
      toast.success(`📢 ${req.title} is live`, {
        description: 'The approved requisition is now a job on your My Jobs tab.',
      })
      bumpRefresh() // My Jobs panel refetches via refreshKey
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not publish requisition')
    } finally {
      setPublishingId(null)
    }
  }

  const fieldCls = 'space-y-1.5'
  const inputCls = 'h-11 sm:h-9 rounded-lg border-slate-200 dark:border-slate-800 focus-visible:ring-blue-500/40'

  return (
    <div className="space-y-4">
      {/* header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
            <ClipboardList className="size-5 text-blue-600" aria-hidden /> Requisitions
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Raise headcount, get leadership sign-off, publish as a job.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="h-11 shrink-0 rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-md transition-all hover:from-blue-700 hover:to-sky-600 sm:h-9"
        >
          <Plus className="size-4" aria-hidden /> New requisition
        </Button>
      </div>

      {/* list */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Card key={i} className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
              <CardContent className="space-y-3 p-5">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-5 w-16 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="rounded-xl border-rose-200 bg-rose-50/50 dark:bg-rose-950/40 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <ClipboardList className="size-10 text-rose-400" aria-hidden />
            <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>
            <Button variant="outline" onClick={() => void load()} className="h-11 sm:h-9">
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : requisitions.length === 0 ? (
        <Card className="rounded-xl border-dashed border-blue-300 bg-blue-50/40 dark:bg-blue-950/40 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
              <ClipboardList className="size-7 text-blue-600" aria-hidden />
            </span>
            <p className="font-semibold text-slate-800 dark:text-slate-200">No requisitions yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Need a new team member? Raise a requisition — your company leadership validates the
              budget and approves it, then you publish it as a live job in one click.
            </p>
            <Button
              onClick={() => setCreateOpen(true)}
              className="mt-1 h-11 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white hover:from-blue-700 hover:to-sky-600 sm:h-9"
            >
              <Plus className="size-4" aria-hidden /> Raise your first requisition
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1 pb-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
          {requisitions.map((req) => {
            const statusMeta = STATUS_META[req.status] ?? STATUS_META.PENDING_APPROVAL
            const skills = skillsToArray(req.skills)
            const mine = req.requestedBy.id === user?.id
            const busy = publishingId === req.id
            return (
              <motion.div
                key={req.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <Card
                  className={`rounded-xl border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:border-blue-200 hover:shadow-md ${
                    busy ? 'opacity-60' : ''
                  }`}
                >
                  <CardContent className="space-y-3 p-4 sm:p-5">
                    {/* title + chips */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold leading-tight text-slate-900 dark:text-slate-100">
                          {req.title}
                        </h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {req.department && (
                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                              {req.department}
                            </span>
                          )}
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusMeta.cls}`}
                          >
                            ● {statusMeta.label}
                          </span>
                        </div>
                      </div>
                      {req.status === 'APPROVED' && (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => void publish(req)}
                          className="h-11 shrink-0 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-500 text-white shadow-md hover:from-emerald-700 hover:to-teal-600 sm:h-8"
                        >
                          {busy ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Megaphone className="size-4" aria-hidden />
                          )}
                          Publish as job
                        </Button>
                      )}
                    </div>

                    {/* meta row */}
                    <div className="grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <span className="flex items-center gap-1.5">
                        <MapPin className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                        <span className="truncate">{req.location} · {req.workMode} · {req.jobType}</span>
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Users className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                        {req.openings} opening{req.openings === 1 ? '' : 's'}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <GraduationCap className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                        {req.experienceMin}–{req.experienceMax} yrs
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Wallet className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                        <span className="truncate">{formatLpa(req.salaryMinLpa, req.salaryMaxLpa)}</span>
                      </span>
                    </div>

                    {/* skills */}
                    {skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {skills.slice(0, 6).map((s) => (
                          <span
                            key={s}
                            className="rounded-md bg-blue-50 dark:bg-blue-950/40 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-200/70 dark:text-blue-300"
                          >
                            {s}
                          </span>
                        ))}
                        {skills.length > 6 && (
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
                            +{skills.length - 6} more
                          </span>
                        )}
                      </div>
                    )}

                    {/* justification */}
                    {req.justification && (
                      <blockquote className="flex gap-2 rounded-lg border-l-2 border-blue-300 bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-xs italic leading-relaxed text-slate-600 dark:text-slate-300">
                        <Quote className="size-3.5 shrink-0 text-blue-400" aria-hidden />
                        <span className="line-clamp-3">{req.justification}</span>
                      </blockquote>
                    )}

                    {/* rejection callout */}
                    {req.status === 'REJECTED' && req.approverNote && (
                      <div className="rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 px-3 py-2">
                        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                          Leadership note{req.approverName ? ` · ${req.approverName}` : ''}:
                        </p>
                        <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-300/90">{req.approverNote}</p>
                      </div>
                    )}

                    {/* progress tracker + raised-by */}
                    <div className="flex flex-col gap-2 border-t border-dashed border-slate-100 dark:border-slate-800/60 pt-3">
                      <ProgressTracker status={req.status} />
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">
                        {mine ? 'Raised by you' : `Raised by ${req.requestedBy.name}`} ·{' '}
                        {format(new Date(req.createdAt), 'd MMM yyyy')}
                        {req.status === 'PUBLISHED' && req.publishedJob && (
                          <span className="text-violet-600 dark:text-violet-300">
                            {' '}· live job on My Jobs
                          </span>
                        )}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) setCreateOpen(false)
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto rounded-xl [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
          <DialogHeader>
            <DialogTitle className="text-left">New requisition</DialogTitle>
            <DialogDescription className="text-left">
              Describe the headcount you need. Leadership reviews the budget and approves — then you
              publish it as a job.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className={fieldCls}>
                <Label htmlFor="rq-title">
                  Role title <span className="text-blue-600">*</span>
                </Label>
                <Input
                  id="rq-title"
                  placeholder="e.g. Senior Backend Engineer"
                  value={form.title}
                  onChange={(e) => set('title', e.target.value)}
                  className={inputCls}
                  aria-invalid={!!errors.title}
                />
                {errors.title && <p className="text-xs text-rose-600 dark:text-rose-300">{errors.title}</p>}
              </div>

              <div className={fieldCls}>
                <Label htmlFor="rq-dept">Department</Label>
                <Input
                  id="rq-dept"
                  placeholder="e.g. Engineering"
                  value={form.department}
                  onChange={(e) => set('department', e.target.value)}
                  className={inputCls}
                />
              </div>

              <div className={fieldCls}>
                <Label htmlFor="rq-location">
                  Location <span className="text-blue-600">*</span>
                </Label>
                <Input
                  id="rq-location"
                  placeholder="e.g. Bengaluru, India"
                  value={form.location}
                  onChange={(e) => set('location', e.target.value)}
                  className={inputCls}
                  aria-invalid={!!errors.location}
                />
                {errors.location && <p className="text-xs text-rose-600 dark:text-rose-300">{errors.location}</p>}
              </div>

              <div className={fieldCls}>
                <Label htmlFor="rq-openings">Openings</Label>
                <Input
                  id="rq-openings"
                  type="number"
                  min={1}
                  value={form.openings}
                  onChange={(e) => set('openings', e.target.value)}
                  className={inputCls}
                />
                {errors.openings && <p className="text-xs text-rose-600 dark:text-rose-300">{errors.openings}</p>}
              </div>

              <div className={fieldCls}>
                <Label htmlFor="rq-jobtype">Job type</Label>
                <Select value={form.jobType} onValueChange={(v) => set('jobType', v)}>
                  <SelectTrigger id="rq-jobtype" className="w-full rounded-lg border-slate-200 dark:border-slate-800">
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
                <Label htmlFor="rq-workmode">Work mode</Label>
                <Select value={form.workMode} onValueChange={(v) => set('workMode', v)}>
                  <SelectTrigger id="rq-workmode" className="w-full rounded-lg border-slate-200 dark:border-slate-800">
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

              <div className="grid grid-cols-2 gap-3">
                <div className={fieldCls}>
                  <Label htmlFor="rq-expmin">Exp. min (yrs)</Label>
                  <Input
                    id="rq-expmin"
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
                  <Label htmlFor="rq-expmax">Exp. max (yrs)</Label>
                  <Input
                    id="rq-expmax"
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

              <div className="grid grid-cols-2 gap-3">
                <div className={fieldCls}>
                  <Label htmlFor="rq-salmin">Salary min (LPA)</Label>
                  <Input
                    id="rq-salmin"
                    type="number"
                    min={0}
                    placeholder="Optional"
                    value={form.salaryMinLpa}
                    onChange={(e) => set('salaryMinLpa', e.target.value)}
                    className={inputCls}
                  />
                  {errors.salaryMinLpa && (
                    <p className="text-xs text-rose-600 dark:text-rose-300">{errors.salaryMinLpa}</p>
                  )}
                </div>
                <div className={fieldCls}>
                  <Label htmlFor="rq-salmax">Salary max (LPA)</Label>
                  <Input
                    id="rq-salmax"
                    type="number"
                    min={0}
                    placeholder="Optional"
                    value={form.salaryMaxLpa}
                    onChange={(e) => set('salaryMaxLpa', e.target.value)}
                    className={inputCls}
                  />
                  {errors.salaryMaxLpa && (
                    <p className="text-xs text-rose-600 dark:text-rose-300">{errors.salaryMaxLpa}</p>
                  )}
                </div>
              </div>

              <div className={`${fieldCls} md:col-span-2`}>
                <Label htmlFor="rq-skills">
                  Skills <span className="text-blue-600">*</span>{' '}
                  <span className="font-normal text-muted-foreground">(comma separated)</span>
                </Label>
                <Input
                  id="rq-skills"
                  placeholder="Node.js, PostgreSQL, AWS"
                  value={form.skills}
                  onChange={(e) => set('skills', e.target.value)}
                  className={inputCls}
                  aria-invalid={!!errors.skills}
                />
                {errors.skills && <p className="text-xs text-rose-600 dark:text-rose-300">{errors.skills}</p>}
              </div>

              <div className={`${fieldCls} md:col-span-2`}>
                <Label htmlFor="rq-just" className="leading-snug">
                  Justification{' '}
                  <span className="font-normal text-muted-foreground">
                    (why this headcount, business impact — helps leadership approve faster)
                  </span>
                </Label>
                <Textarea
                  id="rq-just"
                  rows={4}
                  placeholder="e.g. Payments team is onboarding two enterprise accounts in Q3 — current team of 4 cannot cover the on-call rotation and delivery timeline without an additional backend engineer."
                  value={form.justification}
                  onChange={(e) => set('justification', e.target.value)}
                  className="resize-y rounded-lg border-slate-200 dark:border-slate-800"
                />
              </div>

              <div className={`${fieldCls} md:col-span-2`}>
                <label
                  htmlFor="rq-budget"
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 p-3"
                >
                  <Checkbox
                    id="rq-budget"
                    checked={budgetConfirmed}
                    onCheckedChange={(v) => {
                      setBudgetConfirmed(v === true)
                      setErrors((e) => ({ ...e, budgetConfirmed: '' }))
                    }}
                    className="mt-0.5"
                  />
                  <span className="text-sm leading-snug text-slate-700 dark:text-slate-300">
                    I confirm the manpower budget for this role is validated
                  </span>
                </label>
                {errors.budgetConfirmed && (
                  <p className="text-xs text-rose-600 dark:text-rose-300">{errors.budgetConfirmed}</p>
                )}
              </div>
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="h-11 w-full rounded-xl bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-md transition-all hover:from-blue-700 hover:to-sky-600 hover:shadow-lg sm:h-10"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Sending…
                </>
              ) : (
                <>
                  <Send className="size-4" aria-hidden /> Send for approval
                </>
              )}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* hint when nothing actionable */}
      {!loading && !error && requisitions.length > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
          <FileText className="size-3.5" aria-hidden />
          Requisitions are visible to your company workspace only — leadership approves from the
          client partner portal, and candidates never see them.
        </p>
      )}
    </div>
  )
}
