'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import {
  Bot,
  ChevronDown,
  FileDown,
  FileSearch,
  FolderOpen,
  LayoutGrid,
  Mail,
  Medal,
  RefreshCw,
  Table2,
} from 'lucide-react'
import { useAppStore, VERDICT_META } from '@/store/app-store'
import { printElement } from '@/lib/print'
import { InterviewTranscript } from '@/components/seewee/interview/InterviewTranscript'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface ReportItem {
  interviewId: string
  candidateName: string
  candidateEmail: string
  jobTitle: string
  company: string | null
  clientName: string | null
  clientEmail: string | null
  clientDecision?: string | null
  clientFeedback?: string | null
  overallScore: number | null
  verdict: string | null
  aiSummary: string
  completedAt: string | null
}

const RING_COLORS: Record<string, string> = {
  STRONG_HIRE: '#2563eb',
  HIRE: '#0284c7',
  MAYBE: '#d97706',
  NO_HIRE: '#e11d48',
}

function VerdictBadge({ verdict }: { verdict: string | null }) {
  const meta = (verdict && VERDICT_META[verdict]) || {
    label: verdict ?? 'Unknown',
    className: 'border-slate-300 bg-slate-100 text-slate-600 dark:text-slate-400',
    emoji: '❔',
  }
  return (
    <Badge variant="outline" className={`${meta.className} gap-1`}>
      <span aria-hidden>{meta.emoji}</span>
      {meta.label}
    </Badge>
  )
}

/** Client-partner decision chip (Approve / Hold / Decline) shown after sharing */
function DecisionBadge({ decision }: { decision: string }) {
  const map: Record<string, { label: string; cls: string; icon: string }> = {
    APPROVED: { label: 'Client approved', cls: 'border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-700', icon: '👍' },
    ON_HOLD: { label: 'Client on hold', cls: 'border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-amber-700', icon: '⏸' },
    REJECTED: { label: 'Client declined', cls: 'border-rose-300 bg-rose-50 dark:bg-rose-950/40 text-rose-600', icon: '👎' },
  }
  const m = map[decision]
  if (!m) return null
  return (
    <Badge variant="outline" className={`${m.cls} gap-1`}>
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </Badge>
  )
}

function ScoreRing({ score, verdict }: { score: number | null; verdict: string | null }) {
  const color = RING_COLORS[verdict ?? ''] ?? '#94a3b8'
  const pct = Math.max(0, Math.min(100, Math.round((score ?? 0) * 10)))
  const r = 34
  const circ = 2 * Math.PI * r
  return (
    <svg
      width="88"
      height="88"
      viewBox="0 0 88 88"
      role="img"
      aria-label={`Overall AI score ${score ?? 'n/a'} out of 10`}
      className="shrink-0 -rotate-90"
    >
      <circle cx="44" cy="44" r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" className="stroke-slate-200 dark:stroke-slate-800" />
      <circle
        cx="44"
        cy="44"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * circ} ${circ}`}
      />
      <text
        x="44"
        y="42"
        textAnchor="middle"
        fontSize="19"
        fontWeight="700"
        fill="#0f172a" className="fill-slate-900 dark:fill-slate-50"
        transform="rotate(90 44 44)"
      >
        {score != null ? score.toFixed(1) : '—'}
      </text>
      <text
        x="44"
        y="57"
        textAnchor="middle"
        fontSize="9"
        fill="#64748b" className="fill-slate-500 dark:fill-slate-400"
        transform="rotate(90 44 44)"
      >
        / 10
      </text>
    </svg>
  )
}

export function ClientReports() {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)

  const [reports, setReports] = useState<ReportItem[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clientFilter, setClientFilter] = useState('ALL')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards')
  const [dossierFor, setDossierFor] = useState<ReportItem | null>(null)

  const load = useCallback(async () => {
    if (!user || user.role !== 'RECRUITER') return
    setLoading(true)
    setError(null)
    try {
      const rid = encodeURIComponent(user.id)
      const [rRes, cRes] = await Promise.all([
        fetch(`/api/interview/report?recruiterId=${rid}`),
        fetch('/api/clients'),
      ])
      const [rJson, cJson]: [
        { data?: ReportItem[]; error?: string },
        { data?: Client[]; error?: string },
      ] = await Promise.all([rRes.json(), cRes.json()])
      if (!rRes.ok || rJson.error) throw new Error(rJson.error || 'Failed to load reports')
      setReports(rJson.data ?? [])
      setClients(cJson.data ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const filtered = useMemo(
    () =>
      clientFilter === 'ALL'
        ? reports
        : reports.filter((r) => r.clientName === clientFilter),
    [reports, clientFilter]
  )

  /** In-house model: only the recruiter's own company appears as a filter
   *  option — other companies' names are never shown in their workspace. */
  const visibleClients = useMemo(
    () =>
      user?.clientId ? clients.filter((c) => c.id === user.clientId) : clients,
    [clients, user?.clientId]
  )

  const stats = useMemo(() => {
    const total = filtered.length
    const scored = filtered.filter((r) => r.overallScore != null)
    const avg =
      scored.length > 0
        ? scored.reduce((a, r) => a + (r.overallScore ?? 0), 0) / scored.length
        : null
    const strongHires = filtered.filter((r) => r.verdict === 'STRONG_HIRE').length
    return {
      total,
      avg,
      strongPct: total > 0 ? Math.round((strongHires / total) * 100) : 0,
    }
  }, [filtered])

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /* --------------------------------- views -------------------------------- */

  if (loading) {
    return (
      <div className="space-y-4">
        <Card className="rounded-xl border-slate-200 dark:border-slate-800 p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
        </Card>
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
            <CardContent className="flex items-center gap-4 p-5">
              <Skeleton className="h-[52px] w-[52px] shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-4 w-40" />
              </div>
              <Skeleton className="hidden h-[72px] w-[72px] rounded-full sm:block" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <Card className="rounded-xl border-rose-200 bg-rose-50/50 dark:bg-rose-950/40 shadow-sm">
        <CardContent className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300">{error}</p>
          <Button variant="outline" onClick={() => void load()} className="h-11 sm:h-9">
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Boardroom header */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
        <Card className="rounded-xl border-slate-200 dark:border-slate-800 bg-gradient-to-br from-white via-white to-blue-50/60 p-0 shadow-sm">
          <CardContent className="p-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-slate-100">
                  <Medal className="size-5 text-blue-600" aria-hidden />
                  AI Interview Reports
                  <span className="rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 text-xs font-semibold text-blue-700">
                    boardroom view
                  </span>
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Every interview our AI runs gets rated and lands here, ready to brief clients.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger
                    aria-label="Filter reports by client"
                    className="h-11 w-[180px] rounded-lg border-slate-200 bg-white dark:bg-slate-900 sm:h-9"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All reports</SelectItem>
                    {visibleClients.map((c) => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white dark:bg-slate-900" role="group" aria-label="Layout">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setViewMode('cards')}
                    aria-label="Card layout"
                    aria-pressed={viewMode === 'cards'}
                    className={`min-w-[44px] rounded-none p-2 sm:min-w-[36px] ${
                      viewMode === 'cards' ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    <LayoutGrid className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setViewMode('table')}
                    aria-label="Table layout"
                    aria-pressed={viewMode === 'table'}
                    className={`min-w-[44px] rounded-none border-l border-slate-200 dark:border-slate-800 p-2 sm:min-w-[36px] ${
                      viewMode === 'table' ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    <Table2 className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void load()}
                    aria-label="Refresh reports"
                    className="min-w-[44px] rounded-none border-l border-slate-200 p-2 text-slate-400 dark:text-slate-500 hover:text-blue-600 sm:min-w-[36px]"
                  >
                    <RefreshCw className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            </div>

            {/* stat tiles */}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 dark:bg-blue-950/40 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-blue-700">Total reports</p>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.total}</p>
              </div>
              <div className="rounded-xl border border-sky-100 bg-sky-50/60 dark:bg-sky-950/40 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-sky-700">Avg AI score</p>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {stats.avg != null ? `${stats.avg.toFixed(1)} / 10` : '—'}
                </p>
              </div>
              <div className="rounded-xl border border-amber-100 bg-amber-50/70 dark:bg-amber-950/40 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">Strong-hire rate</p>
                <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.strongPct}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {filtered.length === 0 ? (
        <Card className="rounded-xl border-dashed border-blue-300 bg-blue-50/40 dark:bg-blue-950/40 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
              <FileSearch className="size-7 text-blue-600" aria-hidden />
            </span>
            <p className="font-semibold text-slate-800 dark:text-slate-200">
              {reports.length === 0 ? 'No AI reports yet' : 'No reports for this company'}
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              {reports.length === 0
                ? 'Reports appear here as soon as candidates complete their AI interviews. Start one from the Applicants tab.'
                : 'Try selecting “All reports” or share an interview report with your company partner portal first.'}
            </p>
          </CardContent>
        </Card>
      ) : viewMode === 'table' ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          <Card className="overflow-hidden rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="max-h-[36rem] overflow-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-50">
                    <TableHead>Candidate</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Verdict</TableHead>
                    <TableHead className="hidden md:table-cell">Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r) => (
                    <TableRow key={r.interviewId} className="hover:bg-blue-50/40">
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => setDossierFor(r)}
                          className="text-left font-medium text-blue-700 underline-offset-2 hover:underline"
                          aria-label={`Open dossier for ${r.candidateName}`}
                        >
                          {r.candidateName}
                        </button>
                        <p className="text-xs text-muted-foreground">{r.candidateEmail}</p>
                      </TableCell>
                      <TableCell className="text-sm">{r.jobTitle}</TableCell>
                      <TableCell className="text-sm">{r.clientName ?? '—'}</TableCell>
                      <TableCell className="text-right font-semibold">{r.overallScore != null ? r.overallScore.toFixed(1) : '—'}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <VerdictBadge verdict={r.verdict} />
                          {r.clientDecision && <DecisionBadge decision={r.clientDecision} />}
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                        {r.completedAt
                          ? format(new Date(r.completedAt), 'MMM d, yyyy')
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="max-h-[38rem] space-y-4 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent"
        >
          {filtered.map((r) => {
            const isOpen = expanded.has(r.interviewId)
            return (
              <Card
                key={r.interviewId}
                className="rounded-xl border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:border-blue-200 hover:shadow-md"
              >
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    {/* medal */}
                    <div
                      className="grid h-11 w-11 shrink-0 place-items-center self-start rounded-full border text-lg sm:self-auto"
                      role="img"
                      aria-label={`Verdict ${VERDICT_META[r.verdict ?? '']?.label ?? r.verdict ?? 'unknown'}`}
                    >
                      {(r.verdict && VERDICT_META[r.verdict]?.emoji) || '❔'}
                    </div>

                    {/* identity */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{r.candidateName}</p>
                        <VerdictBadge verdict={r.verdict} />
                        {r.clientDecision && <DecisionBadge decision={r.clientDecision} />}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {r.jobTitle}
                        {r.company ? ` · ${r.company}` : ''}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                        <span className="flex items-center gap-1">
                          <Mail className="size-3 shrink-0" aria-hidden /> {r.candidateEmail}
                        </span>
                        <span>{r.clientName ? `Client · ${r.clientName}` : 'Not shared yet'}</span>
                        <span>
                          {r.completedAt
                            ? `Completed ${format(new Date(r.completedAt), 'MMM d, yyyy · hh:mm a')}`
                            : 'Completed recently'}
                        </span>
                      </div>
                    </div>

                    {/* ring */}
                    <div className="flex items-center justify-between gap-3 sm:block sm:text-right">
                      <ScoreRing score={r.overallScore} verdict={r.verdict} />
                    </div>
                  </div>

                  {isOpen && (
                    <div className="mt-4 space-y-3 border-t border-dashed border-slate-200 dark:border-slate-800 pt-4">
                      <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                        <p className="flex justify-between gap-2 rounded-md bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 sm:inline-flex">
                          <span className="font-medium text-slate-500 dark:text-slate-400">Candidate</span>
                          <span className="text-right text-slate-800 dark:text-slate-200">{r.candidateName}</span>
                        </p>
                        <p className="flex justify-between gap-2 rounded-md bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 sm:inline-flex">
                          <span className="font-medium text-slate-500 dark:text-slate-400">Role</span>
                          <span className="text-right text-slate-800 dark:text-slate-200">{r.jobTitle}</span>
                        </p>
                        <p className="flex justify-between gap-2 rounded-md bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 sm:inline-flex">
                          <span className="font-medium text-slate-500 dark:text-slate-400">Client</span>
                          <span className="text-right text-slate-800 dark:text-slate-200">
                            {r.clientEmail ?? '—'}
                          </span>
                        </p>
                        <p className="flex justify-between gap-2 rounded-md bg-slate-50 dark:bg-slate-800/60 px-3 py-1.5 sm:inline-flex">
                          <span className="font-medium text-slate-500 dark:text-slate-400">Interview ID</span>
                          <span className="max-w-[140px] truncate text-right font-mono text-slate-800 dark:text-slate-200">
                            {r.interviewId.slice(0, 12)}…
                          </span>
                        </p>
                      </div>

                      <div className="rounded-r-xl border-l-4 border-blue-400 bg-blue-50/50 dark:bg-blue-950/40 p-4">
                        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-700">
                          <Bot className="size-3.5" aria-hidden /> AI Summary
                        </p>
                        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                          {r.aiSummary || 'No summary captured for this interview.'}
                        </p>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDossierFor(r)}
                        className="h-11 rounded-lg border-blue-200 dark:border-blue-900/70 text-blue-700 hover:bg-blue-50 sm:h-8"
                      >
                        <FolderOpen className="size-4" aria-hidden /> Open Full Dossier
                      </Button>
                    </div>
                  )}

                  <div className="mt-3 flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleExpand(r.interviewId)}
                      aria-expanded={isOpen}
                      className="h-11 gap-1 text-xs text-slate-400 dark:text-slate-500 hover:text-blue-700 sm:h-8"
                    >
                      {isOpen ? 'Hide details' : 'View details'}
                      <ChevronDown
                        className={`size-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </motion.div>
      )}

      {/* Dossier dialog (informative) */}
      <Dialog
        open={!!dossierFor}
        onOpenChange={(open) => {
          if (!open) setDossierFor(null)
        }}
      >
        <DialogContent className="max-w-lg rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderOpen className="size-5 text-blue-600" aria-hidden />
              Interview Dossier — {dossierFor?.candidateName}
            </DialogTitle>
            <DialogDescription>
              {dossierFor?.jobTitle}
              {dossierFor?.company ? ` at ${dossierFor.company}` : ''}
            </DialogDescription>
          </DialogHeader>

          {dossierFor && (
            <div id="seewee-dossier-print" className="space-y-4">
              {/* print-only branded header */}
              <div className="hidden items-center justify-between border-b-2 border-blue-600 pb-3 [@media_print]:flex">
                <div className="flex items-center gap-2">
                  <img src="/seewee-logo.png" alt="SeeWe" className="h-8 w-auto rounded-md" />
                  <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
                    Interview Dossier
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500">
                  {dossierFor.candidateName} · {dossierFor.jobTitle} · Confidential
                </p>
              </div>

              <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-800/60 p-4">
                <ScoreRing score={dossierFor.overallScore} verdict={dossierFor.verdict} />
                <div className="grid gap-1.5">
                  <VerdictBadge verdict={dossierFor.verdict} />
                  <p className="text-xs text-muted-foreground">
                    {dossierFor.clientName
                      ? `Shared with ${dossierFor.clientName}`
                      : 'Visible only to you'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {dossierFor.completedAt
                      ? format(new Date(dossierFor.completedAt), 'PPPP · hh:mm a')
                      : ''}
                  </p>
                </div>
              </div>

              <div className="rounded-r-xl border-l-4 border-blue-400 bg-blue-50/50 dark:bg-blue-950/40 p-4">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-700">
                  <Bot className="size-3.5" aria-hidden /> AI Summary
                </p>
                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {dossierFor.aiSummary || 'No summary captured for this interview.'}
                </p>
              </div>

              <InterviewTranscript interviewId={dossierFor.interviewId} compact className="shadow-inner" viewerId={user?.id} />

              <p className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3 text-xs leading-relaxed text-muted-foreground">
                🔒 Transcripts are verbatim voice answers transcribed by our speech engine —
                expand the timeline above to read exactly what was said, scored per question.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                printElement('seewee-dossier-print', {
                  title: `SeeWe Dossier — ${dossierFor?.candidateName ?? 'candidate'} — ${dossierFor?.jobTitle ?? 'role'}`,
                })
              }
              className="h-11 gap-1.5 sm:h-9"
              aria-label="Download this dossier as PDF via the print dialog"
            >
              <FileDown className="size-4 text-blue-600" aria-hidden /> Download PDF
            </Button>
            <Button
              variant="outline"
              data-print-hide
              onClick={() => setDossierFor(null)}
              className="h-11 sm:h-9"
            >
              Close dossier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
