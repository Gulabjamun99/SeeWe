'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { format, formatDistanceToNow } from 'date-fns'
import {
  ArrowLeft,
  Bot,
  Briefcase,
  ClipboardList,
  Database,
  FileVideo,
  Flag,
  Handshake,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
  UserCog,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore, VERDICT_META, matchColor } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AdminUsersTab } from '@/components/seewee/AdminUsersTab'
import { AdminJobReportsTab } from '@/components/seewee/AdminJobReportsTab'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

// ---------- response types (mirror GET /api/admin/stats) ----------

interface DirectoryUser {
  id: string
  name: string
  email: string
  role: string
  company: string | null
  headline: string | null
  location: string | null
  createdAt: string
}

interface RecentApplicationRow {
  id: string
  candidateName: string
  jobTitle: string
  company: string
  status: string
  createdAt: string
}

interface RecentInterviewRow {
  id: string
  candidateName: string
  jobTitle: string
  overallScore: number | null
  verdict: string | null
  completedAt: string | null
}

interface RecentNotificationRow {
  id: string
  title: string
  type: string
  read: boolean
  createdAt: string
}

interface PlatformStats {
  usersTotal: number
  usersByRole: Record<string, number>
  jobsTotal: number
  jobsActive: number
  applicationsTotal: number
  applicationsByStatus: Record<string, number>
  shortlistsTotal: number
  shortlistsByStatus: Record<string, number>
  interviewsTotal: number
  interviewsCompleted: number
  answersRecorded: number
  recordingsBytesTotal: number
  clientsTotal: number
  notificationsUnread: number
  demoHealth: { seededUsers: boolean; dbPath: string }
}

interface AdminStats {
  platform: PlatformStats
  users: DirectoryUser[]
  recent: {
    applications: RecentApplicationRow[]
    interviews: RecentInterviewRow[]
    notifications: RecentNotificationRow[]
  }
}

// ---------- presentation meta ----------

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  CANDIDATE: { label: 'Candidate', className: 'border-blue-300 bg-blue-100 dark:bg-blue-900/40 text-blue-800' },
  RECRUITER: { label: 'Recruiter', className: 'border-sky-300 bg-sky-100 dark:bg-sky-900/40 text-sky-800' },
  CLIENT: { label: 'Client', className: 'border-amber-300 bg-amber-100 dark:bg-amber-900/40 text-amber-800' },
  ADMIN: { label: 'Admin', className: 'border-slate-700 bg-slate-800 text-white' },
}

const APPLICATION_STATUS_META: Record<string, { label: string; className: string }> = {
  APPLIED: { label: 'Applied', className: 'border-slate-300 bg-slate-100 text-slate-700 dark:text-slate-300' },
  SHORTLISTED: { label: 'Shortlisted', className: 'border-blue-300 bg-blue-100 dark:bg-blue-900/40 text-blue-800' },
  INTERVIEW_SCHEDULED: { label: 'Interview', className: 'border-cyan-300 bg-cyan-100 text-cyan-800' },
  INTERVIEWED: { label: 'Interviewed', className: 'border-sky-300 bg-sky-100 dark:bg-sky-900/40 text-sky-800' },
  SHARED_WITH_CLIENT: { label: 'Shared', className: 'border-teal-300 bg-teal-100 text-teal-800' },
  REJECTED: { label: 'Rejected', className: 'border-rose-300 bg-rose-100 dark:bg-rose-900/40 text-rose-700' },
  HIRED: { label: 'Hired', className: 'border-emerald-300 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800' },
}

const ROLE_FILTERS = ['ALL', 'CANDIDATE', 'RECRUITER', 'CLIENT', 'ADMIN'] as const

function statusMeta(status: string, map: Record<string, { label: string; className: string }>) {
  return map[status] ?? { label: status, className: 'border-slate-300 bg-slate-100 text-slate-700 dark:text-slate-300' }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 KB'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return '—'
  }
}

function joinedDate(iso: string): string {
  try {
    return format(new Date(iso), 'd MMM yyyy')
  } catch {
    return '—'
  }
}

export function AdminView() {
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const setView = useAppStore((s) => s.setView)

  const [mounted, setMounted] = useState(false)
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roleFilter, setRoleFilter] = useState<string>('ALL')
  const [reseeding, setReseeding] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const isAdmin = !!user && user.role === 'ADMIN'

  const loadStats = useCallback(async () => {
    if (!user || user.role !== 'ADMIN') return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/stats?adminId=${encodeURIComponent(user.id)}`)
      const json = (await res.json().catch(() => ({}))) as { data?: AdminStats; error?: string }
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error ?? 'Failed to load admin stats')
      }
      setStats(json.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load admin stats')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    if (mounted && isAdmin) void loadStats()
  }, [mounted, isAdmin, loadStats])

  // Danger zone: re-run the idempotent demo seeder (POST /api/seed is already
  // 404-guarded in production — this console only exists in the demo anyway).
  async function handleReseed() {
    setReseeding(true)
    try {
      const res = await fetch('/api/seed', { method: 'POST' })
      const json = (await res.json().catch(() => ({}))) as {
        data?: { seeded?: boolean; message?: string }
        error?: string
      }
      if (!res.ok || json.error) throw new Error(json.error ?? 'Reseed failed')
      if (json.data?.seeded === false) {
        toast.success('Demo data already in place — nothing missing to recreate')
      } else {
        toast.success('Demo data reseeded successfully')
      }
      await loadStats()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reseed failed')
    } finally {
      setReseeding(false)
    }
  }

  if (!mounted) {
    return (
      <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-8 sm:px-6">
        <Skeleton className="h-24 rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-10 w-72 max-w-full rounded-lg" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    )
  }

  // Client-side guard — mirrors page.tsx (admin view only renders for ADMIN)
  if (!user || user.role !== 'ADMIN') {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <Card className="mx-auto mt-10 max-w-md rounded-xl border-blue-200 dark:border-blue-900/70 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
              <ShieldCheck className="size-7 text-blue-600" aria-hidden />
            </span>
            <p className="font-semibold text-slate-800 dark:text-slate-200">Admin access</p>
            <p className="text-sm text-muted-foreground">
              This console is restricted to the SeeWe platform administrator.
            </p>
            <Button
              onClick={() => setAuthOpen(true)}
              className="mt-1 h-11 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white hover:from-blue-700 hover:to-sky-600 sm:h-9"
            >
              <LogIn className="size-4" aria-hidden /> Sign in as admin
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const p = stats?.platform

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-8 sm:px-6">
      {/* Header row */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-md">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 sm:text-2xl">Platform admin</h1>
            <Badge
              variant="outline"
              className="mt-0.5 border-blue-200 bg-blue-50 dark:bg-blue-950/40 font-medium text-blue-800"
            >
              {user.name} · {user.email}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => void loadStats()}
            disabled={loading}
            className="rounded-lg border-blue-200 dark:border-blue-900/70 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="size-4" aria-hidden />
            )}
            Refresh
          </Button>
          <Button
            variant="ghost"
            onClick={() => setView('home')}
            className="rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900"
          >
            <ArrowLeft className="size-4" aria-hidden /> Back to home
          </Button>
        </div>
      </motion.section>

      {/* Error card */}
      {error && (
        <Card className="border-rose-200 dark:border-rose-900/60">
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 size-5 shrink-0 text-rose-600 dark:text-rose-300" aria-hidden />
              <div>
                <p className="font-semibold text-rose-800 dark:text-rose-200">Couldn&apos;t load platform stats</p>
                <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => void loadStats()}
              className="shrink-0 rounded-lg border-rose-300 dark:border-rose-700/60 text-rose-700 hover:bg-rose-50"
            >
              <RefreshCw className="size-4" aria-hidden /> Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {loading && !stats
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)
          : p && (
              <>
                <StatCard
                  index={0}
                  icon={Users}
                  label="Users"
                  value={p.usersTotal}
                  sub={
                    [
                      `${p.usersByRole['CANDIDATE'] ?? 0} cand`,
                      `${p.usersByRole['RECRUITER'] ?? 0} rec`,
                      `${p.usersByRole['CLIENT'] ?? 0} client`,
                      `${p.usersByRole['ADMIN'] ?? 0} admin`,
                    ].join(' · ')
                  }
                />
                <StatCard
                  index={1}
                  icon={Briefcase}
                  label="Active jobs"
                  value={p.jobsActive}
                  sub={`of ${p.jobsTotal} total`}
                />
                <StatCard
                  index={2}
                  icon={ClipboardList}
                  label="Applications"
                  value={p.applicationsTotal}
                  sub={
                    <span className="flex flex-wrap gap-1">
                      {Object.entries(p.applicationsByStatus).map(([status, count]) => {
                        const meta = statusMeta(status, APPLICATION_STATUS_META)
                        return (
                          <span
                            key={status}
                            title={`${meta.label}: ${count}`}
                            className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${meta.className}`}
                          >
                            {meta.label} {count}
                          </span>
                        )
                      })}
                      {Object.keys(p.applicationsByStatus).length === 0 && '—'}
                    </span>
                  }
                />
                <StatCard
                  index={3}
                  icon={Bot}
                  label="Interviews completed"
                  value={p.interviewsCompleted}
                  sub={`of ${p.interviewsTotal} total · ${p.shortlistsTotal} shortlists`}
                />
                <StatCard
                  index={4}
                  icon={FileVideo}
                  label="Recordings stored"
                  value={p.answersRecorded}
                  sub={formatBytes(p.recordingsBytesTotal)}
                />
                <StatCard
                  index={5}
                  icon={Handshake}
                  label="Clients"
                  value={p.clientsTotal}
                  sub={`${p.notificationsUnread} unread notifications`}
                />
              </>
            )}
      </div>

      {/* Tabs */}
      <Tabs defaultValue="directory">
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-slate-100 dark:bg-slate-800 p-1 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
          <TabsTrigger value="directory" className="gap-1.5 whitespace-nowrap px-3">
            <Users className="size-4" aria-hidden /> Directory
          </TabsTrigger>
          <TabsTrigger value="users" className="gap-1.5 whitespace-nowrap px-3">
            <UserCog className="size-4" aria-hidden /> Users
          </TabsTrigger>
          <TabsTrigger value="job-reports" className="gap-1.5 whitespace-nowrap px-3">
            <Flag className="size-4" aria-hidden /> Job reports
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5 whitespace-nowrap px-3">
            <ClipboardList className="size-4" aria-hidden /> Activity
          </TabsTrigger>
          <TabsTrigger value="danger" className="gap-1.5 whitespace-nowrap px-3">
            <ShieldAlert className="size-4" aria-hidden /> Danger zone
          </TabsTrigger>
        </TabsList>

        {/* ---------------- Directory ---------------- */}
        <TabsContent value="directory" className="mt-4 outline-none">
          <Card className="rounded-xl">
            <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                User directory
                {stats && (
                  <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
                    {roleFilter === 'ALL'
                      ? `${stats.users.length} accounts`
                      : `${stats.users.filter((u) => u.role === roleFilter).length} of ${stats.users.length}`}
                  </span>
                )}
              </CardTitle>
              <Select value={roleFilter} onValueChange={setRoleFilter}>
                <SelectTrigger className="w-full rounded-lg sm:w-44" aria-label="Filter users by role">
                  <SelectValue placeholder="Filter by role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_FILTERS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r === 'ALL' ? 'All roles' : ROLE_BADGE[r]?.label ?? r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="max-h-96 overflow-y-auto rounded-lg border pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead className="text-right">Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats &&
                      stats.users
                        .filter((u) => roleFilter === 'ALL' || u.role === roleFilter)
                        .map((u) => {
                          const roleBadge = ROLE_BADGE[u.role] ?? {
                            label: u.role,
                            className: 'border-slate-300 bg-slate-100 text-slate-700 dark:text-slate-300',
                          }
                          return (
                            <TableRow key={u.id}>
                              <TableCell className="max-w-44">
                                <p className="truncate font-medium text-slate-800 dark:text-slate-200">{u.name}</p>
                                {u.headline && (
                                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">{u.headline}</p>
                                )}
                              </TableCell>
                              <TableCell className="max-w-52">
                                <span className="block truncate text-slate-600 dark:text-slate-400">{u.email}</span>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={roleBadge.className}>
                                  {roleBadge.label}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <span className="block max-w-40 truncate text-slate-600 dark:text-slate-400">
                                  {u.company || '—'}
                                </span>
                              </TableCell>
                              <TableCell className="whitespace-nowrap text-right text-slate-500 dark:text-slate-400">
                                {joinedDate(u.createdAt)}
                              </TableCell>
                            </TableRow>
                          )
                        })}
                    {stats && stats.users.filter((u) => roleFilter === 'ALL' || u.role === roleFilter).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                          No users match this role filter.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- User management ---------------- */}
        <TabsContent value="users" className="mt-4 outline-none">
          <AdminUsersTab />
        </TabsContent>

        {/* ---------------- Job reports moderation ---------------- */}
        <TabsContent value="job-reports" className="mt-4 outline-none">
          <AdminJobReportsTab />
        </TabsContent>

        {/* ---------------- Activity ---------------- */}
        <TabsContent value="activity" className="mt-4 outline-none">
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Recent applications */}
            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Recent applications
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {stats && stats.recent.applications.length > 0 ? (
                  stats.recent.applications.map((a, i) => {
                    const meta = statusMeta(a.status, APPLICATION_STATUS_META)
                    return (
                      <motion.div
                        key={a.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, delay: i * 0.04 }}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white dark:bg-slate-900 p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                            {a.candidateName}
                          </p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                            {a.jobTitle}
                            {a.company ? ` · ${a.company}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <Badge variant="outline" className={meta.className}>
                            {meta.label}
                          </Badge>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">
                            {relativeTime(a.createdAt)}
                          </span>
                        </div>
                      </motion.div>
                    )
                  })
                ) : (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    No applications recorded yet.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Recent interviews */}
            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Recent interviews
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {stats && stats.recent.interviews.length > 0 ? (
                  stats.recent.interviews.map((iv, i) => {
                    const verdict = iv.verdict ? VERDICT_META[iv.verdict] : null
                    return (
                      <motion.div
                        key={iv.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, delay: i * 0.04 }}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white dark:bg-slate-900 p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-200">
                            {iv.candidateName}
                          </p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{iv.jobTitle}</p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <div className="flex items-center gap-1.5">
                            {iv.overallScore != null && (
                              <span className={`text-xs font-bold ${matchColor(iv.overallScore)}`}>
                                {Math.round(iv.overallScore)}/10
                              </span>
                            )}
                            {verdict && (
                              <Badge variant="outline" className={verdict.className}>
                                {verdict.emoji} {verdict.label}
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">
                            {relativeTime(iv.completedAt)}
                          </span>
                        </div>
                      </motion.div>
                    )
                  })
                ) : (
                  <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                    No completed interviews yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------------- Danger zone ---------------- */}
        <TabsContent value="danger" className="mt-4 outline-none">
          <Card className="rounded-xl border-rose-200 dark:border-rose-900/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-rose-900">
                Demo data maintenance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <Alert className="border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40">
                <ShieldAlert className="size-4 text-rose-600 dark:text-rose-300" aria-hidden />
                <AlertTitle className="text-rose-900">Reseed demo data</AlertTitle>
                <AlertDescription className="text-rose-800 dark:text-rose-200">
                  SeeWe is a demo platform: the seeder recreates its canonical demo accounts, jobs,
                  applications and sample interviews. Existing demo rows stay, missing ones are
                  recreated — but this is still a write operation against the live demo database,
                  so confirm before running it.
                </AlertDescription>
              </Alert>

              {p && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1">
                    <Database className="size-3.5 text-slate-500 dark:text-slate-400" aria-hidden />
                    DB: {p.demoHealth.dbPath}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                      p.demoHealth.seededUsers
                        ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700'
                        : 'border-amber-200 bg-amber-50 dark:bg-amber-950/40 text-amber-700'
                    }`}
                  >
                    Seeder state: {p.demoHealth.seededUsers ? 'demo users present' : 'below expected baseline'}
                  </span>
                </div>
              )}

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    disabled={reseeding || loading}
                    className="w-full rounded-lg sm:w-auto"
                  >
                    {reseeding ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden /> Reseeding…
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="size-4" aria-hidden /> Reseed demo data
                      </>
                    )}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="rounded-xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reseed demo data?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This re-runs the idempotent demo seeder. Existing demo rows stay, missing
                      ones are recreated. Nothing is deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void handleReseed()}>
                      Run seeder
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------- stat card ----------

function StatCard({
  index,
  icon: Icon,
  label,
  value,
  sub,
}: {
  index: number
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
  label: string
  value: number
  sub: React.ReactNode
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Card className="h-full rounded-xl border-slate-200 dark:border-slate-800 shadow-sm">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center gap-1.5">
            <span className="grid size-6 place-items-center rounded-md bg-blue-100 dark:bg-blue-900/40">
              <Icon className="size-3.5 text-blue-600" aria-hidden />
            </span>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 sm:text-[11px]">
              {label}
            </p>
          </div>
          <p className="mt-1.5 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
          <div className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{sub}</div>
        </CardContent>
      </Card>
    </motion.div>
  )
}
