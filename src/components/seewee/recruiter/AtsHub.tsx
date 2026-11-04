'use client'

/**
 * AtsHub — recruiter-facing ATS Integration Hub (master spec §1).
 *
 * One place to register / test / pause / disconnect ATS webhooks
 * (Zoho Recruit, Greenhouse, Lever, SAP SuccessFactors or any custom
 * endpoint) and audit every candidate push with outcome + timestamps.
 *
 * Pushing itself lives in the Interview Hub (per completed interview,
 * via AtsPanel) — this hub is the control room.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Activity,
  Cable,
  CheckCircle2,
  Download,
  ExternalLink,
  Info,
  Loader2,
  PauseCircle,
  PlayCircle,
  PlugZap,
  Plus,
  RadioTower,
  Trash2,
  Unplug,
  XCircle,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { timeAgoShort } from './timeAgo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'

/* --------------------------------- types ---------------------------------- */

interface Integration {
  id: string
  name: string
  webhookUrl: string
  hasApiKey: boolean
  apiKey: string | null
  active: boolean
  createdAt: string
  pushCount: number
  lastPush: { status: 'SUCCESS' | 'FAILED'; createdAt: string } | null
}

interface PushLogRow {
  id: string
  interviewId: string
  candidateName: string | null
  jobTitle: string | null
  status: 'SUCCESS' | 'FAILED'
  httpStatus: number | null
  message: string | null
  integration: { id: string; name: string }
  createdAt: string
}

/** One-tap provider presets (name prefilled; any https endpoint works). */
const PROVIDER_PRESETS: Array<{ name: string; hint: string; accent: string }> = [
  { name: 'Zoho Recruit', hint: 'Recruit webhook URL', accent: 'from-rose-500 to-red-500' },
  { name: 'Greenhouse', hint: 'Inboard harvest URL', accent: 'from-emerald-500 to-green-500' },
  { name: 'Lever', hint: 'Posting webhook URL', accent: 'from-slate-600 to-slate-400' },
  { name: 'SAP SuccessFactors', hint: 'Integration center URL', accent: 'from-sky-500 to-blue-600' },
  { name: 'Custom Webhook', hint: 'Any https endpoint', accent: 'from-violet-500 to-purple-500' },
]

/* ------------------------------- component -------------------------------- */

export function AtsHub() {
  const user = useAppStore((s) => s.user)
  const recruiterId = user?.id ?? ''

  const [integrations, setIntegrations] = useState<Integration[] | null>(null)
  const [pushes, setPushes] = useState<PushLogRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // connect dialog
  const [connectOpen, setConnectOpen] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formKey, setFormKey] = useState('')
  const [saving, setSaving] = useState(false)

  // per-row busy + test results + delete confirm
  const [busyId, setBusyId] = useState<string | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Integration | null>(null)

  const load = useCallback(async () => {
    if (!recruiterId) return
    setError(null)
    try {
      const [iRes, pRes] = await Promise.all([
        fetch(`/api/ats/integrations?recruiterId=${encodeURIComponent(recruiterId)}`),
        fetch(`/api/ats/push?recruiterId=${encodeURIComponent(recruiterId)}`).catch(() => null),
      ])
      const iJson = (await iRes.json()) as { data?: Integration[]; error?: string }
      if (!iRes.ok) throw new Error(iJson.error ?? 'Failed to load integrations')
      setIntegrations(Array.isArray(iJson.data) ? iJson.data : [])
      if (pRes && pRes.ok) {
        const pJson = (await pRes.json()) as { data?: PushLogRow[] }
        setPushes(Array.isArray(pJson.data) ? pJson.data : [])
      } else {
        setPushes([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load integrations')
      setIntegrations([])
      setPushes([])
    }
  }, [recruiterId])

  useEffect(() => {
    void load()
  }, [load])

  /* ------------------------------ mutations ------------------------------- */

  const openConnect = (name?: string) => {
    setPresetName(name ?? '')
    setFormName(name ?? '')
    setFormUrl('')
    setFormKey('')
    setConnectOpen(true)
  }

  const saveIntegration = async () => {
    if (!recruiterId) return
    if (!formName.trim()) {
      toast.error('Give the integration a name')
      return
    }
    if (!/^https?:\/\/.+/i.test(formUrl.trim())) {
      toast.error('Webhook URL must be a valid http(s) URL')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/ats/integrations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recruiterId,
          name: formName.trim(),
          webhookUrl: formUrl.trim(),
          apiKey: formKey.trim() || undefined,
        }),
      })
      const json = (await res.json()) as { data?: Integration; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Could not save integration')
      toast.success(`${formName.trim()} connected 🎉 — send a test ping to verify`)
      setConnectOpen(false)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save integration')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (it: Integration) => {
    setBusyId(it.id)
    try {
      const res = await fetch('/api/ats/integrations', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: it.id, active: !it.active }),
      })
      const json = (await res.json()) as { data?: Integration; error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Update failed')
      toast.success(it.active ? `${it.name} paused` : `${it.name} resumed`)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const testConnection = async (it: Integration) => {
    setTestingId(it.id)
    try {
      const res = await fetch('/api/ats/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recruiterId, integrationId: it.id }),
      })
      const json = (await res.json()) as {
        data?: { ok: boolean; httpStatus: number | null; message: string }
        error?: string
      }
      if (!res.ok) throw new Error(json.error ?? 'Test failed')
      const d = json.data
      if (d?.ok) toast.success(`✅ ${it.name}: ${d.message}`)
      else toast.error(`❌ ${it.name}: ${d?.message ?? 'Test failed'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed')
    } finally {
      setTestingId(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setBusyId(deleteTarget.id)
    try {
      const res = await fetch(
        `/api/ats/integrations?id=${encodeURIComponent(deleteTarget.id)}`,
        { method: 'DELETE' }
      )
      const json = (await res.json()) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Delete failed')
      toast.success(`${deleteTarget.name} disconnected — push log removed too`)
      setDeleteTarget(null)
      void load()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setBusyId(null)
    }
  }

  /* ------------------------------- render --------------------------------- */

  const loading = integrations === null && !error

  return (
    <div className="space-y-5">
      {/* how it works */}
      <div className="flex flex-wrap items-start gap-3 rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50/80 to-sky-50/50 p-4 text-xs text-slate-600 dark:border-blue-900/50 dark:from-blue-950/30 dark:to-sky-950/20 dark:text-slate-300">
        <Info className="mt-0.5 size-4 shrink-0 text-blue-500" aria-hidden />
        <p className="min-w-0 flex-1 leading-relaxed">
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            How ATS sync works:
          </span>{' '}
          ① Register your ATS webhook below (Zoho / Greenhouse / Lever / any https endpoint) · ②
          Run an AI interview in the <span className="font-medium">Interview Hub</span> · ③ Open
          the ATS panel on a completed interview and <span className="font-medium">Push</span> —
          the full dossier (scores, transcript, verdict) lands in your ATS, and every attempt is
          audit-logged here.
        </p>
      </div>

      {/* provider presets */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <Cable className="size-4 text-blue-500" aria-hidden /> Connect an ATS
          </h3>
          <Button size="sm" variant="ghost" onClick={() => openConnect()} className="h-8">
            <Plus className="size-3.5" aria-hidden /> Custom
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {PROVIDER_PRESETS.map((p) => {
            const connected = integrations?.some((i) => i.name === p.name) ?? false
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => openConnect(p.name)}
                className="group relative flex flex-col items-start gap-1.5 rounded-xl border border-slate-200 bg-white p-3 text-left transition-all hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-blue-800"
                aria-label={`Connect ${p.name}`}
              >
                <span
                  className={`inline-flex size-8 items-center justify-center rounded-lg bg-gradient-to-br ${p.accent} text-white shadow-sm`}
                >
                  <PlugZap className="size-4" aria-hidden />
                </span>
                <span className="text-xs font-semibold leading-tight text-slate-800 dark:text-slate-100">
                  {p.name}
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground">{p.hint}</span>
                {connected && (
                  <span className="absolute right-2 top-2">
                    <CheckCircle2 className="size-3.5 text-emerald-500" aria-hidden />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* registered integrations */}
      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <RadioTower className="size-4 text-blue-500" aria-hidden /> Your integrations
          {integrations && integrations.length > 0 && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {integrations.length}
            </span>
          )}
        </h3>

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        )}

        {!loading && error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
          >
            {error}
            <Button variant="outline" size="sm" className="ml-3 h-7" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {!loading && !error && integrations?.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white/50 p-6 text-center dark:border-slate-700 dark:bg-slate-900/30">
            <Unplug className="mx-auto mb-2 size-6 text-slate-300" aria-hidden />
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              No ATS connected yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick a provider above — completed interviews can then be pushed into your pipeline
              in one click.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {integrations?.map((it) => (
            <Card
              key={it.id}
              className={`rounded-xl border-slate-200 dark:border-slate-800 shadow-sm ${
                busyId === it.id ? 'opacity-60' : ''
              } ${!it.active ? 'border-dashed' : ''}`}
            >
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                <span
                  className={`inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${
                    it.active
                      ? 'bg-gradient-to-br from-blue-500 to-sky-500'
                      : 'bg-gradient-to-br from-slate-400 to-slate-300'
                  }`}
                >
                  <PlugZap className="size-5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {it.name}
                    {it.active ? (
                      <Badge className="rounded-full bg-emerald-100 px-1.5 py-0 text-[9px] font-bold uppercase text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                        Active
                      </Badge>
                    ) : (
                      <Badge className="rounded-full bg-stone-100 px-1.5 py-0 text-[9px] font-bold uppercase text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                        Paused
                      </Badge>
                    )}
                    {it.hasApiKey && (
                      <Badge variant="outline" className="rounded-full px-1.5 py-0 text-[9px]">
                        🔑 API key
                      </Badge>
                    )}
                  </p>
                  <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <ExternalLink className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{it.webhookUrl}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Download className="size-3" aria-hidden /> {it.pushCount} push
                      {it.pushCount === 1 ? '' : 'es'}
                    </span>
                    {it.lastPush ? (
                      <span
                        className={`inline-flex items-center gap-1 ${
                          it.lastPush.status === 'SUCCESS'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {it.lastPush.status === 'SUCCESS' ? (
                          <CheckCircle2 className="size-3" aria-hidden />
                        ) : (
                          <XCircle className="size-3" aria-hidden />
                        )}
                        last push {it.lastPush.status.toLowerCase()} ·{' '}
                        {timeAgoShort(it.lastPush.createdAt)}
                      </span>
                    ) : (
                      <span>no pushes yet</span>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={testingId === it.id || busyId === it.id}
                    onClick={() => void testConnection(it)}
                    aria-label={`Test connection to ${it.name}`}
                  >
                    {testingId === it.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Activity className="size-3.5 text-blue-500" aria-hidden />
                    )}
                    Test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg"
                    disabled={busyId === it.id}
                    onClick={() => void toggleActive(it)}
                    aria-label={it.active ? `Pause ${it.name}` : `Resume ${it.name}`}
                  >
                    {it.active ? (
                      <PauseCircle className="size-3.5 text-amber-500" aria-hidden />
                    ) : (
                      <PlayCircle className="size-3.5 text-emerald-500" aria-hidden />
                    )}
                    {it.active ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/40"
                    disabled={busyId === it.id}
                    onClick={() => setDeleteTarget(it)}
                    aria-label={`Disconnect ${it.name}`}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* push audit log */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
            <Download className="size-4 text-blue-500" aria-hidden /> Push history
            {pushes && pushes.length > 0 && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                {pushes.length}
              </span>
            )}
          </h3>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => void load()}>
            <Activity className="size-3.5" aria-hidden /> Refresh
          </Button>
        </div>

        {pushes?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white/50 p-4 text-center text-xs text-muted-foreground dark:border-slate-700 dark:bg-slate-900/30">
            No candidate pushes yet — complete an AI interview and push from the Interview Hub.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {pushes?.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/60"
              >
                {p.status === 'SUCCESS' ? (
                  <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                ) : (
                  <XCircle className="size-3.5 shrink-0 text-rose-500" aria-hidden />
                )}
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  {p.candidateName ?? 'Candidate'}
                </span>
                {p.jobTitle && (
                  <>
                    <span className="text-slate-300 dark:text-slate-600">›</span>
                    <span className="text-slate-600 dark:text-slate-300">{p.jobTitle}</span>
                  </>
                )}
                <span className="text-slate-300 dark:text-slate-600">›</span>
                <span className="text-slate-500 dark:text-slate-400">{p.integration.name}</span>
                <Badge
                  variant="outline"
                  className={`ml-auto rounded-full px-1.5 py-0 text-[9px] font-bold uppercase ${
                    p.status === 'SUCCESS'
                      ? 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300'
                      : 'border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300'
                  }`}
                >
                  {p.status}
                  {p.httpStatus ? ` ${p.httpStatus}` : ''}
                </Badge>
                <span className="w-full text-[10px] text-muted-foreground sm:w-auto">
                  {timeAgoShort(p.createdAt)}
                  {p.message ? ` · ${p.message}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* connect dialog */}
      <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <PlugZap className="size-4 text-blue-500" aria-hidden />
              Connect {presetName || 'a custom ATS webhook'}
            </DialogTitle>
            <DialogDescription>
              SeeWe POSTs each completed interview dossier (scores, transcript, verdict) to this
              endpoint as JSON.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5">
            <div className="space-y-1.5">
              <Label htmlFor="ats-name">Integration name</Label>
              <Input
                id="ats-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. Zoho Recruit — India"
                maxLength={60}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ats-url">Webhook URL</Label>
              <Input
                id="ats-url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="https://your-ats.example.com/webhooks/seewee"
                inputMode="url"
              />
              <p className="text-[10px] text-muted-foreground">
                Must start with https:// (or http:// for local testing).
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ats-key">API key (optional)</Label>
              <Input
                id="ats-key"
                value={formKey}
                onChange={(e) => setFormKey(e.target.value)}
                placeholder="Sent as x-ats-api-key header"
                type="password"
                autoComplete="off"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConnectOpen(false)} className="h-9">
              Cancel
            </Button>
            <Button
              onClick={() => void saveIntegration()}
              disabled={saving}
              className="h-9 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-md hover:from-blue-700 hover:to-sky-600"
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Connect ATS
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* disconnect confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {deleteTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The webhook registration and its full push log will be removed. You can reconnect
              anytime — past pushes cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-9 rounded-lg">Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              className="h-9 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
            >
              <Trash2 className="size-4" aria-hidden /> Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Separator className="opacity-0" />
    </div>
  )
}
