'use client'

/**
 * AtsIntegrationCenter — the recruiter's two-way ATS bridge, upgraded from the
 * old status-card grid into full provider cards.
 *
 * Outbound: completed AI interviews (with the multi-factor AiEvaluation) are
 * pushed into the recruiter's ATS webhook — per-interview pushes stay in the
 * Interview Hub; this panel is the control room (connect / test / audit).
 *
 * Inbound: each integration exposes a read-only webhook URL
 * (/api/v1/webhooks/ats/{id} + x-ats-api-key header) the recruiter configures
 * in their ATS so jobs can be pushed INTO SeeWe, plus a one-click
 * "Sync Jobs from ATS" pull (real webhook first, realistic demo batch when
 * the URL is unreachable / left empty — demo mode).
 *
 * Recruiter-only surface: everything here (scores, evaluations, push log)
 * must never be wired to a candidate-facing component.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  Blocks,
  Boxes,
  Briefcase,
  Building2,
  CheckCircle2,
  Copy,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plug2,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Webhook,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { timeAgoShort } from './timeAgo'
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
import { Switch } from '@/components/ui/switch'
import type { AtsIntegrationInfo } from '@/lib/types'

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

type Provider = {
  atsType: string
  name: string
  desc: string
  icon: LucideIcon
  tint: string
}

const PROVIDERS: Provider[] = [
  {
    atsType: 'ZOHO',
    name: 'Zoho Recruit',
    desc: 'Push interview dossiers into Zoho Recruit pipelines and pull job openings back.',
    icon: Briefcase,
    tint: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  {
    atsType: 'GREENHOUSE',
    name: 'Greenhouse',
    desc: 'Sync structured interview kits and candidate dossiers with your Greenhouse boards.',
    icon: Database,
    tint: 'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300',
  },
  {
    atsType: 'LEVER',
    name: 'Lever',
    desc: 'Keep Lever postings in step and forward rated candidates with one click.',
    icon: Boxes,
    tint: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  },
  {
    atsType: 'WORKDAY',
    name: 'Workday',
    desc: 'Bridge enterprise Workday requisitions with your SeeWe hiring workspace.',
    icon: Building2,
    tint: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  },
  {
    atsType: 'CUSTOM',
    name: 'Custom Webhook',
    desc: 'Any ATS or home-grown pipeline — point it at the webhook and go.',
    icon: Webhook,
    tint: 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  },
]

/** Sentinel used when the recruiter leaves the webhook URL empty ("demo mode").
 *  The .invalid TLD never resolves, so sync falls back to the realistic demo
 *  batch server-side while still satisfying the API's http(s) URL contract. */
const DEMO_WEBHOOK_URL = 'https://demo.ats.invalid/seewee-webhook'

const INBOUND_HEADER = 'x-ats-api-key'

interface AtsPushRow {
  id: string
  interviewId: string
  candidateName: string
  jobTitle: string
  status: string
  httpStatus: number | null
  message: string | null
  integration: { id: string; name: string }
  createdAt: string
}

function isDemoUrl(url: string | null | undefined): boolean {
  return !!url && url === DEMO_WEBHOOK_URL
}

async function readApi<T>(res: Response): Promise<T> {
  const json: { data?: T; error?: string } = await res.json().catch(() => ({}))
  if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`)
  return json.data as T
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export function AtsIntegrationCenter() {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const recruiterId = user?.role === 'RECRUITER' ? user.id : ''

  const [integrations, setIntegrations] = useState<AtsIntegrationInfo[] | null>(null)
  const [pushes, setPushes] = useState<AtsPushRow[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // connect / edit dialog
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AtsIntegrationInfo | null>(null)
  const [provider, setProvider] = useState<Provider | null>(null)
  const [name, setName] = useState('')
  const [webhookUrl, setWebhookUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [autoSync, setAutoSync] = useState(true)
  const [saving, setSaving] = useState(false)

  // per-row busy states
  const [testingId, setTestingId] = useState<string | null>(null)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!recruiterId) return
    setLoadError(null)
    try {
      const [intg, pushLog] = await Promise.all([
        readApi<AtsIntegrationInfo[]>(
          await fetch(`/api/ats/integrations?recruiterId=${encodeURIComponent(recruiterId)}`)
        ),
        readApi<AtsPushRow[]>(
          await fetch(`/api/ats/push?recruiterId=${encodeURIComponent(recruiterId)}`)
        ),
      ])
      setIntegrations(intg)
      setPushes(pushLog)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load integrations')
      setIntegrations((prev) => prev ?? [])
    }
  }, [recruiterId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  /* ---------------- connect / edit dialog ---------------- */

  const openConnect = (p: Provider) => {
    const existing = integrations?.find((i) => i.atsType === p.atsType)
    if (existing) {
      openEdit(existing)
      return
    }
    setEditing(null)
    setProvider(p)
    setName('')
    setWebhookUrl('')
    setApiKey('')
    setShowKey(false)
    setAutoSync(true)
    setDialogOpen(true)
  }

  const openEdit = (integration: AtsIntegrationInfo) => {
    const p = PROVIDERS.find((x) => x.atsType === integration.atsType) ?? PROVIDERS[4]
    setEditing(integration)
    setProvider(p)
    setName(integration.name)
    setWebhookUrl(isDemoUrl(integration.webhookUrl) ? '' : (integration.webhookUrl ?? ''))
    setApiKey(integration.apiKey ?? '')
    setShowKey(false)
    setAutoSync(integration.autoSyncResults)
    setDialogOpen(true)
  }

  const saveIntegration = async () => {
    if (!provider || !recruiterId) return
    if (!name.trim()) {
      toast.error('Give the integration a name')
      return
    }
    setSaving(true)
    try {
      const url = webhookUrl.trim() || DEMO_WEBHOOK_URL
      if (editing) {
        await readApi(
          await fetch('/api/ats/integrations', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: editing.id,
              name: name.trim(),
              webhookUrl: url,
              apiKey: apiKey.trim(),
              atsType: provider.atsType,
              autoSyncResults: autoSync,
            }),
          })
        )
        toast.success(`${provider.name} integration updated`)
      } else {
        await readApi(
          await fetch('/api/ats/integrations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recruiterId,
              name: name.trim(),
              webhookUrl: url,
              apiKey: apiKey.trim(),
              atsType: provider.atsType,
              autoSyncResults: autoSync,
            }),
          })
        )
        toast.success(
          webhookUrl.trim()
            ? `${provider.name} connected`
            : `${provider.name} connected in demo mode — jobs sync from a demo batch`
        )
      }
      setDialogOpen(false)
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the integration')
    } finally {
      setSaving(false)
    }
  }

  /* ---------------- per-card actions ---------------- */

  const testConnection = async (integration: AtsIntegrationInfo) => {
    setTestingId(integration.id)
    const started = performance.now()
    try {
      const res = await fetch(`/api/v1/webhooks/ats/${encodeURIComponent(integration.id)}`, {
        headers: integration.apiKey ? { [INBOUND_HEADER]: integration.apiKey } : undefined,
        cache: 'no-store',
      })
      const json: { ok?: boolean; integrationName?: string; atsType?: string; error?: string } =
        await res.json()
      const ms = Math.max(1, Math.round(performance.now() - started))
      if (res.ok && json.ok) {
        toast.success(`Handshake OK — ${json.integrationName ?? integration.name}`, {
          description: `${json.atsType ?? integration.atsType} · ${ms}ms · inbound webhook answered`,
        })
      } else {
        toast.error(`Handshake failed (${res.status})`, {
          description: json.error ?? 'The inbound webhook rejected the credentials',
        })
      }
    } catch {
      toast.error('Handshake failed — network error reaching the webhook')
    } finally {
      setTestingId(null)
    }
  }

  const syncJobs = async (integration: AtsIntegrationInfo) => {
    setSyncingId(integration.id)
    try {
      const data = await readApi<{
        created: number
        updated: number
        total: number
        skipped: number
        source: 'webhook' | 'demo'
      }>(
        await fetch('/api/ats/sync-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ integrationId: integration.id, recruiterId }),
        })
      )
      toast.success(
        `${data.total} job${data.total === 1 ? '' : 's'} synced (${data.created} new, ${data.updated} updated)`,
        {
          description:
            data.source === 'demo'
              ? 'Demo batch — add a real webhook URL to pull from your ATS'
              : `Pulled live from ${integration.name}`,
        }
      )
      bumpRefresh() // My Jobs / dashboard stats refetch on refreshKey
      await load() // lastSyncAt + syncedJobsCount changed
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncingId(null)
    }
  }

  const toggleActive = async (integration: AtsIntegrationInfo) => {
    setTogglingId(integration.id)
    try {
      await readApi(
        await fetch('/api/ats/integrations', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: integration.id, active: !integration.active }),
        })
      )
      toast.success(integration.active ? 'Integration paused' : 'Integration resumed')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setTogglingId(null)
    }
  }

  const removeIntegration = async (integration: AtsIntegrationInfo) => {
    if (
      !window.confirm(
        `Remove “${integration.name}”? The push audit log for this integration is removed too.`
      )
    )
      return
    setDeletingId(integration.id)
    try {
      await readApi(
        await fetch(`/api/ats/integrations?id=${encodeURIComponent(integration.id)}`, {
          method: 'DELETE',
        })
      )
      toast.success('Integration removed')
      await load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeletingId(null)
    }
  }

  const copyInboundUrl = async (integration: AtsIntegrationInfo) => {
    try {
      const absolute = `${window.location.origin}/api/v1/webhooks/ats/${integration.id}`
      await navigator.clipboard.writeText(absolute)
      toast.success('Inbound webhook URL copied', {
        description: `Configure it in your ATS with the ${INBOUND_HEADER} header`,
      })
    } catch {
      toast.error('Copy failed — select the URL manually')
    }
  }

  /* ---------------- render ---------------- */

  if (!user || user.role !== 'RECRUITER') return null

  const busy = saving || !!testingId || !!syncingId
  const connectedCount = integrations?.length ?? 0
  const activeCount = integrations?.filter((i) => i.active).length ?? 0

  return (
    <div className="space-y-4">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
            aria-hidden
          >
            <Blocks className="size-4" />
          </span>
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 sm:text-base">
              ATS Integration Center
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Two-way bridge — pull jobs in, push evaluated candidates out.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="rounded-full border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300"
          >
            {connectedCount === 0
              ? 'No ATS connected'
              : `${connectedCount} connected${activeCount < connectedCount ? ` · ${activeCount} active` : ''}`}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-8 gap-1.5 rounded-lg border-slate-200 text-xs dark:border-slate-700"
            aria-label="Refresh integrations and push log"
          >
            <RefreshCw className="size-3.5" aria-hidden /> Refresh
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> {loadError}
        </div>
      )}

      {/* provider cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {PROVIDERS.map((p) => {
          const connected = (integrations ?? []).filter((i) => i.atsType === p.atsType)
          const primary = connected[0]
          const Icon = p.icon
          return (
            <div
              key={p.atsType}
              className={`flex flex-col gap-2.5 rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-900 ${
                primary
                  ? 'border-emerald-200 dark:border-emerald-900/70'
                  : 'border-slate-200 dark:border-slate-800'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${p.tint}`} aria-hidden>
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-200">{p.name}</p>
                  <span
                    className={`mt-0.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${
                      primary
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900'
                        : 'bg-slate-50 text-slate-500 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:ring-slate-700'
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        primary?.active ? 'bg-emerald-500' : primary ? 'bg-amber-500' : 'bg-stone-400'
                      }`}
                      aria-hidden
                    />
                    {primary
                      ? `Connected · ${primary.atsType}${connected.length > 1 ? ` (+${connected.length - 1})` : ''}`
                      : 'Not connected'}
                  </span>
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{p.desc}</p>

              {primary && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                  <span>{primary.syncedJobsCount} jobs synced</span>
                  <span>· last sync {primary.lastSyncAt ? timeAgoShort(primary.lastSyncAt) : 'never'}</span>
                  <span>· {primary.pushCount ?? 0} pushes</span>
                  {isDemoUrl(primary.webhookUrl) && (
                    <Badge
                      variant="outline"
                      className="rounded-full border-dashed border-amber-300 bg-amber-50 px-1.5 py-0 text-[9px] font-bold uppercase text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                    >
                      Demo mode
                    </Badge>
                  )}
                </div>
              )}

              {/* inbound webhook row — how their ATS pushes jobs INTO SeeWe */}
              {primary && primary.active && (
                <div className="space-y-1 rounded-lg border border-dashed border-slate-200 bg-slate-50/70 p-2 dark:border-slate-700 dark:bg-slate-800/40">
                  <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    <ArrowUpRight className="size-3" aria-hidden /> Inbound webhook — jobs come IN here
                  </p>
                  <div className="flex items-center gap-1.5">
                    <code className="min-w-0 flex-1 truncate rounded bg-white px-1.5 py-1 font-mono text-[10px] text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                      /api/v1/webhooks/ats/{primary.id}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-6 shrink-0 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={() => void copyInboundUrl(primary)}
                      aria-label={`Copy inbound webhook URL for ${p.name}`}
                    >
                      <Copy className="size-3" aria-hidden />
                    </Button>
                  </div>
                  <p className="text-[9px] text-slate-400 dark:text-slate-500">
                    Header <code className="font-mono">{INBOUND_HEADER}</code>:{' '}
                    {primary.apiKey ? '••••••••' : 'not set (open endpoint)'}
                  </p>
                </div>
              )}

              {/* actions */}
              <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                {primary ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void testConnection(primary)}
                      className="h-7 gap-1 rounded-md px-2 text-[11px] font-semibold text-sky-700 dark:text-sky-300"
                      aria-label={`Test connection for ${p.name}`}
                    >
                      {testingId === primary.id ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                      ) : (
                        <Zap className="size-3" aria-hidden />
                      )}
                      Test Connection
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !primary.active}
                      onClick={() => void syncJobs(primary)}
                      className="h-7 gap-1 rounded-md px-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                      aria-label={`Sync jobs from ${p.name}`}
                    >
                      {syncingId === primary.id ? (
                        <Loader2 className="size-3 animate-spin" aria-hidden />
                      ) : (
                        <RefreshCw className="size-3" aria-hidden />
                      )}
                      Sync Jobs
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEdit(primary)}
                      className="h-7 gap-1 rounded-md px-1.5 text-[11px] text-slate-500 dark:text-slate-400"
                      aria-label={`Edit ${p.name} integration`}
                    >
                      <Pencil className="size-3" aria-hidden /> Edit
                    </Button>
                    <div className="ml-auto flex items-center gap-0.5">
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={togglingId === primary.id}
                        onClick={() => void toggleActive(primary)}
                        className="size-7 rounded-md text-slate-400 hover:text-slate-700"
                        aria-label={primary.active ? `Pause ${p.name} integration` : `Resume ${p.name} integration`}
                      >
                        {togglingId === primary.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : primary.active ? (
                          <PauseCircle className="size-3.5" aria-hidden />
                        ) : (
                          <PlayCircle className="size-3.5" aria-hidden />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={deletingId === primary.id}
                        onClick={() => void removeIntegration(primary)}
                        className="size-7 rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                        aria-label={`Remove ${p.name} integration`}
                      >
                        {deletingId === primary.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="size-3.5" aria-hidden />
                        )}
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => openConnect(p)}
                    disabled={busy}
                    className="h-7 w-fit gap-1 rounded-md bg-gradient-to-r from-blue-600 to-sky-500 px-2.5 text-[11px] font-semibold text-white hover:from-blue-700 hover:to-sky-600"
                    aria-label={`Connect ${p.name}`}
                  >
                    <Plus className="size-3" aria-hidden /> Connect
                  </Button>
                )}
              </div>
            </div>
          )
        })}

        {/* what flows out — explainer card fills the grid nicely */}
        <div className="flex flex-col gap-2.5 rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/80 via-sky-50/60 to-white p-4 shadow-sm dark:border-blue-900/60 dark:from-blue-950/30 dark:via-sky-950/20 dark:to-slate-900">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-sky-600 text-white" aria-hidden>
            <Plug2 className="size-4" />
          </span>
          <p className="text-sm font-bold text-slate-800 dark:text-slate-200">What gets pushed out?</p>
          <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            When an AI interview completes, the full dossier lands in your ATS: candidate profile,
            per-question transcript and recordings, the 4-factor evaluation (technical ·
            communication · problem solving · presentation) and the verdict. Per-interview pushes
            live in the Interview Hub; auto-sync fires here when enabled.
          </p>
          <p className="mt-auto flex items-center gap-1.5 text-[10px] font-medium text-slate-400 dark:text-slate-500">
            <CheckCircle2 className="size-3 text-emerald-500" aria-hidden />
            {autoSync ? 'Auto-sync of new evaluations is ON for new connections' : 'Audit trail on every push'}
          </p>
        </div>
      </div>

      {/* push activity log */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={() => setLogOpen((v) => !v)}
          aria-expanded={logOpen}
          className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
        >
          <Webhook className="size-4 shrink-0 text-teal-600" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-slate-800 dark:text-slate-200">
              Sync &amp; push activity
            </span>
            <span className="block text-[11px] text-slate-400 dark:text-slate-500">
              {pushes.length === 0
                ? 'No pushes yet — send an evaluated candidate from the Leaderboard or Interview Hub'
                : `${pushes.length} recent push${pushes.length === 1 ? '' : 'es'} · newest ${timeAgoShort(pushes[0]?.createdAt)}`}
            </span>
          </span>
          <span
            className={`text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-transform ${
              logOpen ? 'rotate-180' : ''
            }`}
            aria-hidden
          >
            ▾
          </span>
        </button>
        {logOpen && (
          <div className="max-h-72 overflow-y-auto border-t border-dashed border-slate-200 p-3 dark:border-slate-800 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
            {pushes.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                Nothing pushed yet. Evaluate a candidate in the Leaderboard and hit “Sync to ATS”.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {pushes.map((p) => {
                  const ok = p.status === 'SUCCESS'
                  const skipped = p.status === 'SKIPPED'
                  return (
                    <li
                      key={p.id}
                      className="flex items-center gap-2.5 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800"
                    >
                      <span
                        className={`size-2 shrink-0 rounded-full ${ok ? 'bg-emerald-500' : skipped ? 'bg-slate-400' : 'bg-rose-500'}`}
                        title={p.status}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                          {p.candidateName || 'Unknown candidate'}
                          <span className="font-normal text-slate-400 dark:text-slate-500">
                            {' '}→ {p.jobTitle || 'unknown job'}
                          </span>
                        </p>
                        <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">
                          {p.integration?.name ?? 'integration'} ·{' '}
                          {p.httpStatus != null ? `HTTP ${p.httpStatus} · ` : ''}
                          {p.message ?? p.status}
                        </p>
                      </div>
                      <span className="shrink-0 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                        {timeAgoShort(p.createdAt)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* connect / edit dialog */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && !saving) setDialogOpen(false)
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-lg overflow-y-auto rounded-xl sm:rounded-xl [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Plug2 className="size-4 text-blue-600" aria-hidden />
              {editing ? 'Edit' : 'Connect'} {provider?.name ?? 'ATS'}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the webhook, credentials or auto-sync behaviour of this integration.'
                : 'Link your ATS to pull job openings in and push evaluated candidates out.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="ats-int-name" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Integration name
              </Label>
              <Input
                id="ats-int-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={`e.g. ${provider?.name ?? 'ATS'} — hiring pipeline`}
                className="h-10 rounded-lg sm:h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ats-int-url" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Webhook URL <span className="font-normal text-slate-400">(outbound — optional)</span>
              </Label>
              <Input
                id="ats-int-url"
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://ats.yourcompany.com/hooks/seewee"
                className="h-10 rounded-lg sm:h-9"
              />
              <p className="text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
                Where evaluated candidates are POSTed. Leave empty for demo mode — job syncs then
                return a realistic demo batch.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ats-int-key" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                API key <span className="font-normal text-slate-400">(shared secret)</span>
              </Label>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
                <Input
                  id="ats-int-key"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sent as x-ats-api-key header"
                  autoComplete="off"
                  className="h-10 rounded-lg pl-8 pr-9 sm:h-9"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                >
                  {showKey ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/40">
              <label
                htmlFor="ats-int-autosync"
                className="min-w-0 cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                Auto-sync results when AI evaluation completes
                <span className="block text-[10px] font-normal text-slate-400 dark:text-slate-500">
                  New evaluations are pushed to this ATS automatically
                </span>
              </label>
              <Switch
                id="ats-int-autosync"
                checked={autoSync}
                onCheckedChange={setAutoSync}
                aria-label="Auto-sync evaluation results"
                className="shrink-0"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
              className="h-10 rounded-lg sm:h-9"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void saveIntegration()}
              disabled={saving || !name.trim()}
              className="h-10 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white hover:from-blue-700 hover:to-sky-600 sm:h-9"
            >
              {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              {editing ? 'Save changes' : 'Connect'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
