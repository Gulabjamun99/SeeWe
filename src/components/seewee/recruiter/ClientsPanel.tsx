'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import {
  Blocks,
  Bot,
  Briefcase,
  Building2,
  CalendarPlus,
  Clock3,
  Download,
  FileSpreadsheet,
  Handshake,
  Loader2,
  Mail,
  NotebookPen,
  Plus,
  Send,
  ShieldCheck,
  Timer,
  Webhook,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import type { Client } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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

interface ClientRow extends Client {
  _count?: { shortlists: number }
  /** per-client recording retention override in days (null = platform default 45) */
  mediaRetentionDays?: number | null
}

/** Radix Select needs string values — 'default' is the null (platform 45d) sentinel */
const RETENTION_OPTIONS = [
  { value: 'default', label: 'Default (45d)' },
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
  { value: '60', label: '60 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '180 days' },
  { value: '365', label: '1 year (365d)' },
] as const

const CARD_TINTS = [
  'bg-blue-100 dark:bg-blue-900/40 text-blue-700',
  'bg-sky-100 dark:bg-sky-900/40 text-sky-700',
  'bg-amber-100 dark:bg-amber-900/40 text-amber-700',
  'bg-rose-100 dark:bg-rose-900/40 text-rose-700',
  'bg-cyan-100 text-cyan-700',
]

function tintFor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 33 + name.charCodeAt(i)) >>> 0
  return CARD_TINTS[h % CARD_TINTS.length]
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p.charAt(0).toUpperCase())
      .join('') || '?'
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Minimal ATS integration shape used by the Integrations hub status card */
interface AtsLite {
  id: string
  name: string
  active: boolean
}

/** One status card inside the Integrations & tools grid */
function IntegrationCard({
  icon: Icon,
  tint,
  name,
  statusLabel,
  statusDot,
  desc,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  tint: string
  name: string
  statusLabel: string
  statusDot: string
  desc: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
      <div className="flex items-center gap-2">
        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${tint}`} aria-hidden>
          <Icon className="size-4" />
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800 dark:text-slate-200">{name}</p>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-700">
          <span className={`size-1.5 rounded-full ${statusDot}`} aria-hidden />
          {statusLabel}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{desc}</p>
      {children}
    </div>
  )
}

export function ClientsPanel() {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)

  /** In-house model: a recruiter linked to a company sees ONLY that company.
   *  The workspace IS their employer — no cross-company directories. */
  const ownClientId = user?.role === 'RECRUITER' ? (user.clientId ?? null) : null

  const [clients, setClients] = useState<ClientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // add dialog
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [industry, setIndustry] = useState('')
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // per-client recording retention (auto-save on change)
  const [retentionBusyFor, setRetentionBusyFor] = useState<string | null>(null)

  // Integrations hub: ATS webhooks + applicant count (own-company workspace only)
  const [ats, setAts] = useState<AtsLite[] | null>(null)
  const [appCount, setAppCount] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/clients')
      const json: { data?: ClientRow[]; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load clients')
      setClients(json.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load clients')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  // Integrations hub data — only meaningful for a recruiter linked to a company workspace
  useEffect(() => {
    if (!user || user.role !== 'RECRUITER' || !ownClientId) {
      setAts(null)
      setAppCount(null)
      return
    }
    let alive = true

    async function run() {
      try {
        const [atsJson, anJson] = (await Promise.all([
          fetch(`/api/ats/integrations?recruiterId=${encodeURIComponent(user!.id)}`).then((r) => r.json()),
          fetch(`/api/analytics?userId=${encodeURIComponent(user!.id)}`).then((r) => r.json()),
        ])) as [{ data?: AtsLite[] }, { data?: { totalApplications?: number } }]
        if (!alive) return
        setAts(Array.isArray(atsJson.data) ? atsJson.data : [])
        setAppCount(
          typeof anJson.data?.totalApplications === 'number' ? anJson.data.totalApplications : null
        )
      } catch {
        if (alive) {
          setAts([])
          setAppCount(null)
        }
      }
    }

    void run()
    return () => {
      alive = false
    }
  }, [user, ownClientId, refreshKey])

  const openAdd = () => {
    setName('')
    setEmail('')
    setIndustry('')
    setNotes('')
    setFormError('')
    setAddOpen(true)
  }

  const submitAdd = async () => {
    if (!name.trim()) {
      setFormError('Client company name is required')
      return
    }
    if (!EMAIL_RE.test(email.trim())) {
      setFormError('A valid contact email is required')
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          contactEmail: email.trim(),
          industry: industry.trim() || undefined,
          notes: notes.trim() || undefined,
          addedBy: user?.id,
        }),
      })
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Could not add client')
      toast.success(`🤝 ${name.trim()} onboarded — share AI reports with them now`)
      setAddOpen(false)
      bumpRefresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add client')
    } finally {
      setSubmitting(false)
    }
  }

  const totalShares = clients.reduce((acc, c) => acc + (c._count?.shortlists ?? 0), 0)

  /** The recruiter's own company row (undefined while loading / if unlinked) */
  const ownCompany = ownClientId ? clients.find((c) => c.id === ownClientId) : undefined

  /** Auto-save the retention choice for one client (PATCH, then refresh list state). */
  const changeRetention = async (client: ClientRow, value: string) => {
    if (retentionBusyFor) return
    const days: number | null = value === 'default' ? null : Number(value)
    setRetentionBusyFor(client.id)
    try {
      const res = await fetch('/api/clients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: client.id, mediaRetentionDays: days, addedBy: user?.id }),
      })
      const json: { data?: ClientRow; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Could not update retention')
      }
      // server-authoritative refresh: swap the updated client into the list
      const updated = json.data
      setClients((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)))
      toast.success(
        days == null
          ? `Retention updated — ${client.name} uses the platform default (45 days)`
          : `Retention updated — ${client.name} keeps recordings for ${days} days`
      )
    } catch (err) {
      // select stays bound to state, so it snaps back to the saved value on failure
      toast.error(err instanceof Error ? err.message : 'Could not update retention')
    } finally {
      setRetentionBusyFor(null)
    }
  }

  /** In-house model: recruiters linked to a company land on the "My Company"
   *  view — their employer's workspace, not a directory of other companies. */
  const myCompanyMode = Boolean(ownClientId)

  const atsConnected = (ats?.length ?? 0) > 0

  /** Applicant CSV export — the API sets Content-Disposition, so a plain anchor
   *  click triggers the browser download without leaving the page. */
  const exportApplicantsCsv = () => {
    if (!user) return
    const a = document.createElement('a')
    a.href = `/api/export/applicants?userId=${encodeURIComponent(user.id)}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    toast.success('📄 Applicant CSV exported — check your downloads')
  }

  return (
    <div className="space-y-4">
      {/* header strip */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {myCompanyMode ? (
            <Badge
              variant="outline"
              className="border-blue-200 bg-blue-50 dark:bg-blue-950/40 px-3 py-1 text-blue-700"
            >
              <Building2 className="size-3.5" aria-hidden /> My company workspace
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-blue-200 bg-blue-50 dark:bg-blue-950/40 px-3 py-1 text-blue-700"
            >
              🤝 {clients.length} client{clients.length === 1 ? '' : 's'}
            </Badge>
          )}
          <Badge
            variant="outline"
            className="border-sky-200 bg-sky-50 dark:bg-sky-950/40 px-3 py-1 text-sky-700"
          >
            <Send className="size-3" aria-hidden />{' '}
            {myCompanyMode ? (ownCompany?._count?.shortlists ?? 0) : totalShares} profiles shared
          </Badge>
        </div>
        {!myCompanyMode && (
          <Button
            onClick={openAdd}
            className="h-11 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-md hover:from-blue-700 hover:to-sky-600 sm:h-9"
          >
            <Plus className="size-4" aria-hidden /> Add Client
          </Button>
        )}
      </div>

      {myCompanyMode ? (
        loading ? (
          <Card className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center gap-4">
                <Skeleton className="h-14 w-14 rounded-2xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-6 w-44" />
                  <Skeleton className="h-4 w-52" />
                </div>
              </div>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ) : error ? (
          <Card className="rounded-xl border-rose-200 bg-rose-50/50 dark:bg-rose-950/40 shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
              <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>
              <Button variant="outline" onClick={() => void load()} className="h-11 sm:h-9">
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : !ownCompany ? (
          <Card className="rounded-xl border-dashed border-amber-300 bg-amber-50/40 dark:bg-amber-950/20 shadow-sm">
            <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-100 dark:bg-amber-900/40">
                <Building2 className="size-7 text-amber-600" aria-hidden />
              </span>
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                Company workspace not linked
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                Your account isn&apos;t attached to a company workspace yet. Sign out and sign in
                again with your company name to relink it.
              </p>
            </CardContent>
          </Card>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-4"
          >
            {/* own company card */}
            <Card className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
              <CardContent className="space-y-4 p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                  <span
                    className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-base font-bold ${tintFor(ownCompany.name)}`}
                    aria-hidden
                  >
                    {initials(ownCompany.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                      Your employer
                    </p>
                    <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                      {ownCompany.name}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {ownCompany.industry && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-slate-200 text-slate-600 dark:text-slate-400"
                        >
                          <Briefcase className="size-3" aria-hidden /> {ownCompany.industry}
                        </Badge>
                      )}
                      <span className="flex items-center gap-1">
                        <Mail className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                        <span className="truncate">{ownCompany.contactEmail}</span>
                      </span>
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                  >
                    <Send className="size-3" aria-hidden /> {ownCompany._count?.shortlists ?? 0} shared
                  </Badge>
                </div>

                {/* recording retention — same auto-save control, scoped to own company */}
                <div className="space-y-1.5 rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-100 dark:bg-slate-900/60 dark:ring-slate-800">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Recording retention
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant="outline"
                      title={
                        ownCompany.mediaRetentionDays
                          ? `Recordings are kept ${ownCompany.mediaRetentionDays} days after the interview before automatic cleanup`
                          : 'Platform default — recordings are kept 45 days after the interview before automatic cleanup'
                      }
                      className={`gap-1 ${
                        ownCompany.mediaRetentionDays
                          ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-700'
                          : 'border-slate-200 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {retentionBusyFor === ownCompany.id ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                      ) : (
                        <Timer className="size-3" aria-hidden />
                      )}
                      {ownCompany.mediaRetentionDays ? `Keep ${ownCompany.mediaRetentionDays}d` : 'Default 45d'}
                    </Badge>
                    <Select
                      value={ownCompany.mediaRetentionDays ? String(ownCompany.mediaRetentionDays) : 'default'}
                      onValueChange={(v) => void changeRetention(ownCompany, v)}
                      disabled={retentionBusyFor === ownCompany.id}
                    >
                      <SelectTrigger
                        aria-label={`Recording retention for ${ownCompany.name}`}
                        className="h-8 w-[132px] rounded-lg border-slate-200 dark:border-slate-800 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RETENTION_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} className="text-xs">
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {ownCompany.notes && (
                  <p className="rounded-lg bg-slate-50 p-2 text-xs italic text-slate-500 dark:text-slate-400 ring-1 ring-inset ring-slate-100">
                    <NotebookPen className="mr-1 inline size-3 text-slate-400 dark:text-slate-500" aria-hidden />
                    {ownCompany.notes}
                  </p>
                )}

                {ownCompany.createdAt && (
                  <p className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                    <Clock3 className="size-3" aria-hidden /> Workspace since{' '}
                    {formatDistanceToNow(new Date(ownCompany.createdAt), { addSuffix: true })}
                  </p>
                )}
              </CardContent>
            </Card>

            {/* where reports go — in-house explainer */}
            <Card className="rounded-xl border-blue-100 bg-gradient-to-r from-blue-50 via-sky-50 to-white shadow-sm dark:border-blue-900/60 dark:from-blue-950/40 dark:via-sky-950/30 dark:to-slate-900">
              <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-start">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-sky-600 shadow-sm">
                  <ShieldCheck className="size-5 text-white" aria-hidden />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    Where your shared reports go
                  </p>
                  <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Every AI interview report you share lands in{' '}
                    <strong className="font-semibold">{ownCompany.name}</strong>&apos;s own partner
                    portal — your leadership reviews the rated candidates and sends verdicts
                    straight back to this workspace. Your team signs in with{' '}
                    <span className="font-semibold text-blue-700 dark:text-blue-300">
                      {ownCompany.contactEmail}
                    </span>
                    .
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Integrations & tools — what this workspace already connects to (and what's honest roadmap) */}
            <Card className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
              <CardContent className="space-y-4 p-5">
                <div className="flex items-center gap-2.5">
                  <span
                    className="grid size-8 shrink-0 place-items-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                    aria-hidden
                  >
                    <Blocks className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200">Integrations &amp; tools</p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      What your hiring workspace already talks to
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <IntegrationCard
                    icon={Bot}
                    tint="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                    name="AI interviews"
                    statusLabel="Built-in · Active"
                    statusDot="bg-emerald-500"
                    desc="Structured AI-led interviews with scored reports — built into every shortlist, no setup needed."
                  />
                  <IntegrationCard
                    icon={Webhook}
                    tint="bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                    name="ATS sync"
                    statusLabel={ats == null ? 'Checking…' : atsConnected ? 'Active' : 'Not connected'}
                    statusDot={atsConnected ? 'bg-emerald-500' : 'bg-stone-400'}
                    desc={
                      atsConnected
                        ? `Pushing interview dossiers to “${ats![0].name}” via webhook.`
                        : 'Not connected — open a completed interview in the Interview Hub and use the ATS panel to register your webhook.'
                    }
                  />
                  <IntegrationCard
                    icon={FileSpreadsheet}
                    tint="bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                    name="Applicant export"
                    statusLabel="LIVE"
                    statusDot="bg-emerald-500"
                    desc="Every applicant as CSV — status, source, screen verdict and match in one file."
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={exportApplicantsCsv}
                      disabled={appCount == null || appCount === 0}
                      title={appCount === 0 ? 'No applications yet' : 'Download all applicants as CSV'}
                      className="h-8 w-fit rounded-lg border-slate-200 text-xs dark:border-slate-700"
                    >
                      <Download className="size-3.5" aria-hidden /> Download CSV
                    </Button>
                    {appCount === 0 && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">
                        Unlocks with your first applicant.
                      </p>
                    )}
                  </IntegrationCard>
                  <IntegrationCard
                    icon={CalendarPlus}
                    tint="bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                    name="Interview calendar"
                    statusLabel="LIVE"
                    statusDot="bg-emerald-500"
                    desc="One-click .ics files for every interview — find them next to each interview in the Interview Hub."
                  />
                  <IntegrationCard
                    icon={Mail}
                    tint="bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300"
                    name="Process emails"
                    statusLabel="LIVE"
                    statusDot="bg-emerald-500"
                    desc="Automated status mails to candidates — application received, interview invite, offer and decisions."
                  />
                </div>

                {/* Honest roadmap — labelled Planned, never pretending to work */}
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-200 p-3 dark:border-slate-700">
                  <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Planned
                  </span>
                  {['E-signature', 'Background verification', 'HRMS sync'].map((tool) => (
                    <span
                      key={tool}
                      className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-500 dark:bg-stone-800/60 dark:text-stone-400"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )
      ) : loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-11 w-11 rounded-xl" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-3.5 w-36" />
                  </div>
                </div>
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-8 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <Card className="rounded-xl border-rose-200 bg-rose-50/50 dark:bg-rose-950/40 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
            <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>
            <Button variant="outline" onClick={() => void load()} className="h-11 sm:h-9">
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : clients.length === 0 ? (
        <Card className="rounded-xl border-dashed border-blue-300 bg-blue-50/40 dark:bg-blue-950/40 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
              <Handshake className="size-7 text-blue-600" aria-hidden />
            </span>
            <p className="font-semibold text-slate-800 dark:text-slate-200">No clients yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Register client companies here. When an AI interview report is ready you&apos;ll pick
              one of these as the destination for the rated dossier.
            </p>
            <Button
              onClick={openAdd}
              className="mt-1 h-11 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white hover:from-blue-700 hover:to-sky-600 sm:h-9"
            >
              <Plus className="size-4" aria-hidden /> Add your first client
            </Button>
          </CardContent>
        </Card>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
        >
          {clients.map((c) => (
            <Card
              key={c.id}
              className="group rounded-xl border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:border-blue-200 hover:shadow-md"
            >
              <CardContent className="space-y-3 p-5">
                <div className="flex items-start gap-3">
                  <span
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-sm font-bold ${tintFor(c.name)}`}
                    aria-hidden
                  >
                    {initials(c.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-700">
                      {c.name}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                      <Mail className="size-3.5 shrink-0 text-slate-400 dark:text-slate-500" aria-hidden />
                      <span className="truncate">{c.contactEmail}</span>
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="shrink-0 border-slate-200 text-[11px] text-slate-500 dark:text-slate-400"
                  >
                    <Send className="size-3" aria-hidden /> {c._count?.shortlists ?? 0}
                  </Badge>
                </div>

                {c.industry && (
                  <Badge variant="outline" className="gap-1 border-slate-200 text-slate-600 dark:text-slate-400">
                    <Briefcase className="size-3" aria-hidden /> {c.industry}
                  </Badge>
                )}

                {/* recording retention — effective policy chip + compact auto-save select */}
                <div className="space-y-1.5 pt-0.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    Recording retention
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant="outline"
                      title={
                        c.mediaRetentionDays
                          ? `Recordings are kept ${c.mediaRetentionDays} days after the interview before automatic cleanup`
                          : 'Platform default — recordings are kept 45 days after the interview before automatic cleanup'
                      }
                      className={`gap-1 ${
                        c.mediaRetentionDays
                          ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-700'
                          : 'border-slate-200 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {retentionBusyFor === c.id ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                      ) : (
                        <Timer className="size-3" aria-hidden />
                      )}
                      {c.mediaRetentionDays ? `Keep ${c.mediaRetentionDays}d` : 'Default 45d'}
                    </Badge>
                    <Select
                      value={c.mediaRetentionDays ? String(c.mediaRetentionDays) : 'default'}
                      onValueChange={(v) => void changeRetention(c, v)}
                      disabled={retentionBusyFor === c.id}
                    >
                      <SelectTrigger
                        aria-label={`Recording retention for ${c.name}`}
                        className="h-8 w-[132px] rounded-lg border-slate-200 dark:border-slate-800 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {RETENTION_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value} className="text-xs">
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {c.notes && (
                  <p className="line-clamp-2 rounded-lg bg-slate-50 p-2 text-xs italic text-slate-500 dark:text-slate-400 ring-1 ring-inset ring-slate-100">
                    <NotebookPen className="mr-1 inline size-3 text-slate-400 dark:text-slate-500" aria-hidden />
                    {c.notes}
                  </p>
                )}

                {c.createdAt && (
                  <p className="flex items-center gap-1 pt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                    <Clock3 className="size-3" aria-hidden /> Onboarded{' '}
                    {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </motion.div>
      )}

      {/* Add client dialog */}
      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!open) setAddOpen(false)
        }}
      >
        <DialogContent className="max-w-md rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Handshake className="size-5 text-blue-600" aria-hidden /> Add a client
            </DialogTitle>
            <DialogDescription>
              Companies that receive your candidates&apos; AI interview reports.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cl-name">
                Company name <span className="text-blue-600">*</span>
              </Label>
              <Input
                id="cl-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setFormError('')
                }}
                placeholder="e.g. Nova Financial"
                className="h-11 rounded-lg border-slate-200 dark:border-slate-800 sm:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-email">
                Contact email <span className="text-blue-600">*</span>
              </Label>
              <Input
                id="cl-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setFormError('')
                }}
                placeholder="talent@novafin.com"
                className="h-11 rounded-lg border-slate-200 dark:border-slate-800 sm:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-industry">Industry</Label>
              <Input
                id="cl-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder="Fintech · Retail · Healthcare…"
                className="h-11 rounded-lg border-slate-200 dark:border-slate-800 sm:h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cl-notes">Internal notes</Label>
              <Textarea
                id="cl-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What kind of roles do they hire for? SLAs, preferences…"
                className="resize-none rounded-lg border-slate-200 dark:border-slate-800"
              />
            </div>
            {formError && <p className="text-xs text-rose-600 dark:text-rose-300">{formError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} className="h-11 sm:h-9">
              Cancel
            </Button>
            <Button
              onClick={() => void submitAdd()}
              disabled={submitting}
              className="h-11 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white hover:from-blue-700 hover:to-sky-600 sm:h-9"
            >
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden /> Adding…
                </>
              ) : (
                <>🤝 Add client</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
