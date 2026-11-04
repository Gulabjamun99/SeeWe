'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import {
  Bot,
  Briefcase,
  ClipboardList,
  FileVideo,
  Building2,
  FolderOpen,
  LogIn,
  MessageSquare,
  PlugZap,
  Plus,
  Star,
  UserRound,
  Users,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import type { Application, Job } from '@/lib/types'
import { clampDialogShellScroll } from '@/lib/dialog-scroll-guard'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApplicantsPanel } from './ApplicantsPanel'
import { AtsHub } from './AtsHub'
import { CandidateFolders } from './CandidateFolders'
import { ClientReports } from './ClientReports'
import { ClientsPanel } from './ClientsPanel'
import { InterviewHub } from './InterviewHub'
import { LatestResponses } from './LatestResponses'
import { MyJobsPanel } from './MyJobsPanel'
import { PostJobForm } from './PostJobForm'
import { FormErrorBoundary } from '@/components/seewee/FormErrorBoundary'
import { RecruiterProfile } from './RecruiterProfile'
import { RequisitionsPanel } from './RequisitionsPanel'
import { RecruiterAnalytics } from './RecruiterAnalytics'
import { RecordingsPanel } from './RecordingsPanel'
import { MessagesPanel } from '@/components/seewee/MessagesPanel'

interface ReportLite {
  interviewId: string
}

const PIPELINE_BEYOND_APPLIED = new Set([
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'SHARED_WITH_CLIENT',
  'HIRED',
])

function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function RecruiterDashboard() {
  const user = useAppStore((s) => s.user)
  const refreshKey = useAppStore((s) => s.refreshKey)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const view = useAppStore((s) => s.view)

  const [mounted, setMounted] = useState(false)
  const [tab, setTab] = useState('jobs')
  const [postOpen, setPostOpen] = useState(false)
  const [applicantFocus, setApplicantFocus] = useState<{ jobId: string; n: number } | null>(null)
  const [applicantHighlight, setApplicantHighlight] = useState<string | null>(null)

  // hero stats (light fetch, panels own their detailed data)
  const [statsLoading, setStatsLoading] = useState(true)
  const [activeJobs, setActiveJobs] = useState(0)
  const [totalApplicants, setTotalApplicants] = useState(0)
  const [shortlistedCount, setShortlistedCount] = useState(0)
  const [interviewsDone, setInterviewsDone] = useState(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  // 🧭 Talent Search is a STANDALONE module (see TalentSearchWorkspace) — the
  // Hiring Hub dashboard no longer hosts it as a tab. If the global view is
  // 'talent' the shell renders the workspace directly; nothing to sync here.
  const handleTabChange = (next: string) => {
    setTab(next)
  }

  const loadStats = useCallback(async () => {
    if (!user || user.role !== 'RECRUITER') return
    setStatsLoading(true)
    try {
      const rid = encodeURIComponent(user.id)
      const [jRes, aRes, rRes] = await Promise.all([
        fetch(`/api/jobs?recruiterId=${rid}&limit=100`),
        fetch(`/api/applications?recruiterId=${rid}`),
        fetch(`/api/interview/report?recruiterId=${rid}`),
      ])
      const jJson: { data?: { jobs?: Job[] } } = await jRes.json()
      const aJson: { data?: Application[] } = await aRes.json()
      const rJson: { data?: ReportLite[] } = await rRes.json()

      const jobs = jJson.data?.jobs ?? []
      const apps = aJson.data ?? []
      setActiveJobs(jobs.filter((j) => j.status === 'ACTIVE').length)
      setTotalApplicants(jobs.reduce((acc, j) => acc + (j._count?.applications ?? 0), 0))
      setShortlistedCount(apps.filter((a) => PIPELINE_BEYOND_APPLIED.has(a.status)).length)
      setInterviewsDone(rJson.data?.length ?? 0)
    } catch {
      /* stats are cosmetic — panels surface real errors */
    } finally {
      setStatsLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadStats()
  }, [loadStats, refreshKey])

  // 🔔 Deep-link handoff: a notification click can ask us to jump straight to a
  // job's applicants. One-shot — consume and clear.
  const pendingFocus = useAppStore((s) => s.pendingFocus)
  const setPendingFocus = useAppStore((s) => s.setPendingFocus)
  useEffect(() => {
    if (!pendingFocus) return
    if (pendingFocus.kind === 'recruiter-applicants') {
      if (pendingFocus.jobId) {
        setApplicantFocus((prev) => ({ jobId: pendingFocus.jobId!, n: (prev?.n ?? 0) + 1 }))
      }
      if (pendingFocus.applicationId) setApplicantHighlight(pendingFocus.applicationId)
      setTab('applicants')
      setPendingFocus(null)
    }
    // direct-message handoff — jump to the Messages tab (MessagesPanel opens the
    // thread itself via the same pendingFocus contract)
    if (pendingFocus.kind === 'messages') {
      setTab('messages')
    }
  }, [pendingFocus, setPendingFocus])

  if (!mounted) {
    return (
      <div className="space-y-6 p-1">
        <Skeleton className="h-36 rounded-2xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-10 w-[420px] max-w-full rounded-lg" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    )
  }

  if (!user || user.role !== 'RECRUITER') {
    return (
      <Card className="mx-auto mt-10 max-w-md rounded-xl border-blue-200 dark:border-blue-900/70 shadow-sm">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
            <Briefcase className="size-7 text-blue-600" aria-hidden />
          </span>
          <p className="font-semibold text-slate-800 dark:text-slate-200">Recruiter sign-in required</p>
          <p className="text-sm text-muted-foreground">
            Log in with your recruiter account to manage jobs, applicants and AI reports.
          </p>
          <Button
            onClick={() => setAuthOpen(true)}
            className="mt-1 h-11 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white hover:from-blue-700 hover:to-sky-600 sm:h-9"
          >
            <LogIn className="size-4" aria-hidden /> Sign in
          </Button>
        </CardContent>
      </Card>
    )
  }

  const openPostJob = () => setPostOpen(true)

  // LatestResponses → Applicants tab handoff. With a jobId we deep-link the
  // panel to that job's inbox; without one we simply switch tabs.
  const openApplicantsFor = (jobId: string) => {
    if (jobId) {
      setApplicantFocus((prev) => ({ jobId, n: (prev?.n ?? 0) + 1 }))
    }
    setTab('applicants')
    // the workspace (tabs) now sits ABOVE the analytics section — bring it back
    // into view so the handoff doesn't feel like a dead click
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <div className="space-y-5 p-1 pb-10">
      {/* Hero strip */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-blue-600 to-sky-500 p-5 text-white shadow-md sm:p-6"
      >
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden />

        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-blue-100/90">
              Recruiter suite · {format(new Date(), 'EEEE, d MMM yyyy')}
            </p>
            <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
              {greetingFor(new Date().getHours())}, {user.name.split(' ')[0]}! 👋
            </h1>
            <p className="mt-1 text-sm text-blue-50/95">
              Hiring @ <span className="font-semibold">{user.company || 'your company'}</span> —
              post roles, shortlist stars, and let the AI interview do the heavy lifting.
            </p>
          </div>

          <Button
            onClick={openPostJob}
            className="h-11 shrink-0 rounded-xl bg-white dark:bg-slate-900 px-4 font-semibold text-blue-700 shadow-sm transition-all hover:bg-blue-50 hover:shadow-md"
            aria-label="Post a job opening"
          >
            <Plus className="size-4" aria-hidden /> Post a Job
          </Button>
        </div>

        {/* quick stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: 'Active Jobs', value: activeJobs, icon: Briefcase },
            { label: 'Total Applicants', value: totalApplicants, icon: Users },
            { label: 'Shortlisted', value: shortlistedCount, icon: Star },
            { label: 'AI Interviews Done', value: interviewsDone, icon: Bot },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-xl border border-white/25 bg-white/15 p-3 backdrop-blur-sm sm:p-4"
            >
              <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-blue-50/90 sm:text-xs">
                <Icon className="size-3.5" aria-hidden /> {label}
              </p>
              {statsLoading ? (
                <div className="mt-1.5 h-7 w-10 animate-pulse rounded bg-white/30" aria-label={`Loading ${label}`} />
              ) : (
                <p className="mt-0.5 text-2xl font-bold">{value}</p>
              )}
            </div>
          ))}
        </div>
      </motion.section>

      {/* Latest candidate responses — the inbox glance sits right under the hero */}
      <LatestResponses onOpenApplicants={openApplicantsFor} />

      {/* Tabs — workspace first (nav + content), graphs & funnels live below */}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl bg-slate-100 dark:bg-slate-800 p-1 [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
          <TabsTrigger value="requisitions" className="gap-1.5 whitespace-nowrap px-3">
            <ClipboardList className="size-4" aria-hidden /> Requisitions
          </TabsTrigger>
          <TabsTrigger value="jobs" className="gap-1.5 whitespace-nowrap px-3">
            <Briefcase className="size-4" aria-hidden /> My Jobs
          </TabsTrigger>
          <TabsTrigger value="applicants" className="gap-1.5 whitespace-nowrap px-3">
            <Users className="size-4" aria-hidden /> Applicants
          </TabsTrigger>
          <TabsTrigger value="messages" className="gap-1.5 whitespace-nowrap px-3">
            <MessageSquare className="size-4" aria-hidden /> Messages
          </TabsTrigger>
          <TabsTrigger value="hub" className="gap-1.5 whitespace-nowrap px-3">
            <Bot className="size-4" aria-hidden /> Interview Hub
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5 whitespace-nowrap px-3">
            <Bot className="size-4" aria-hidden /> Client Reports
          </TabsTrigger>
          <TabsTrigger value="recordings" className="gap-1.5 whitespace-nowrap px-3">
            <FileVideo className="size-4" aria-hidden /> Recordings
          </TabsTrigger>
          <TabsTrigger value="clients" className="gap-1.5 whitespace-nowrap px-3">
            <Building2 className="size-4" aria-hidden /> My Company
          </TabsTrigger>
          <TabsTrigger value="ats" className="gap-1.5 whitespace-nowrap px-3">
            <PlugZap className="size-4" aria-hidden /> ATS Sync
          </TabsTrigger>
          <TabsTrigger value="profile" className="gap-1.5 whitespace-nowrap px-3">
            <UserRound className="size-4" aria-hidden /> My Profile
          </TabsTrigger>
          <TabsTrigger value="folders" className="gap-1.5 whitespace-nowrap px-3">
            <FolderOpen className="size-4" aria-hidden /> Folders
          </TabsTrigger>
        </TabsList>

        <TabsContent value="requisitions" className="mt-4 outline-none">
          <RequisitionsPanel />
        </TabsContent>

        <TabsContent value="jobs" className="mt-4 outline-none">
          <MyJobsPanel onSelectJobForApplicants={(jobId) => {
            setApplicantFocus((prev) => ({ jobId, n: (prev?.n ?? 0) + 1 }))
            setTab('applicants')
          }} />
        </TabsContent>

        <TabsContent value="applicants" className="mt-4 outline-none">
          <ApplicantsPanel
            focusRequest={applicantFocus}
            highlightId={applicantHighlight}
            onHighlightDone={() => setApplicantHighlight(null)}
          />
        </TabsContent>

        <TabsContent value="messages" className="mt-4 outline-none">
          <MessagesPanel role="RECRUITER" />
        </TabsContent>

        <TabsContent value="hub" className="mt-4 outline-none">
          <InterviewHub />
        </TabsContent>

        <TabsContent value="reports" className="mt-4 outline-none">
          <ClientReports />
        </TabsContent>

        <TabsContent value="recordings" className="mt-4 outline-none">
          <RecordingsPanel />
        </TabsContent>

        <TabsContent value="clients" className="mt-4 outline-none">
          <ClientsPanel />
        </TabsContent>

        <TabsContent value="ats" className="mt-4 outline-none">
          <AtsHub />
        </TabsContent>

        <TabsContent value="profile" className="mt-4 outline-none">
          <RecruiterProfile />
        </TabsContent>

        <TabsContent value="folders" className="mt-4 outline-none">
          <CandidateFolders />
        </TabsContent>
      </Tabs>

      {/* Analytics graphs & hiring funnels — kept below the workspace tabs */}
      <RecruiterAnalytics />

      {/* Post a Job dialog */}
      <Dialog
        open={postOpen}
        onOpenChange={(open) => {
          if (!open) setPostOpen(false)
        }}
      >
        {/* Spacious two-pane dialog: fixed header + scrollable body. Full-screen
            on mobile, up to 5xl on desktop so the form breathes without drag-scroll.
            Outside/focus interactions NEVER dismiss it — opening the OS file
            picker (logo upload) must not eat the recruiter's half-written post. */}
        <DialogContent
          className="grid h-[100dvh] max-h-[100dvh] w-full max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-clip rounded-none border-0 p-0 sm:h-auto sm:max-h-[94dvh] sm:max-w-3xl sm:rounded-2xl lg:max-w-5xl [&>button]:z-20"
          onScroll={clampDialogShellScroll}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="shrink-0 border-b border-slate-200 py-4 pr-14 pl-5 text-left dark:border-slate-800 sm:pl-6">
            <DialogTitle>Post a Job</DialogTitle>
            <DialogDescription>
              Goes live instantly. The richer the JD, the sharper the AI interview questions.
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-5 py-4 sm:px-6 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
            {/* Boundary = even an unknown render crash can never show a white
                dialog; the draft auto-restores on remount. */}
            <FormErrorBoundary resetKey={String(postOpen)}>
              <PostJobForm recruiterId={user.id} onPosted={() => setPostOpen(false)} />
            </FormErrorBoundary>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
