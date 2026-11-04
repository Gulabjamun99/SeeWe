'use client'

import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { useAppStore } from '@/store/app-store'
import { Header } from '@/components/seewee/Header'
import { Footer } from '@/components/seewee/Footer'
import { HomeView } from '@/components/seewee/HomeView'
import { JobsView } from '@/components/seewee/JobsView'
import { SalaryInsightsPage } from '@/components/seewee/SalaryInsightsPage'
import { JobDetailDialog } from '@/components/seewee/JobDetailDialog'
import { AuthDialog } from '@/components/seewee/AuthDialog'
import { AdminView } from '@/components/seewee/AdminView'
import { DeepLinkController } from '@/components/seewee/DeepLinkController'
import { CareerPageView } from '@/components/seewee/CareerPageView'
import { RecruiterDashboard } from '@/components/seewee/recruiter/RecruiterDashboard'
import { TalentSearchWorkspace } from '@/components/seewee/recruiter/TalentSearchWorkspace'
import { CandidateDashboard } from '@/components/seewee/candidate/CandidateDashboard'
import { ClientPortalView } from '@/components/seewee/client/ClientPortalView'
import { InterviewRoom } from '@/components/seewee/interview/InterviewRoom'
import { installCrashReporter } from '@/lib/report-error'

// Wire client-side crash telemetry before anything else can render/crash.
if (typeof window !== 'undefined') installCrashReporter()

export default function SeeWeApp() {
  const user = useAppStore((s) => s.user)
  const view = useAppStore((s) => s.view)
  const startInterview = useAppStore((s) => s.startInterview)
  const loadSavedJobs = useAppStore((s) => s.loadSavedJobs)

  // 🖥️ Scroll to top whenever the view changes — landing mid-page on a new
  // section (e.g. footer showing after clicking "Find Jobs") felt broken.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
    }
  }, [view])

  // Hydrate bookmarked jobs whenever the signed-in user changes
  useEffect(() => {
    void loadSavedJobs()
  }, [loadSavedJobs, user?.id])

  // Seed the database once per browser session (idempotent server-side too)
  useEffect(() => {
    try {
      if (sessionStorage.getItem('seewee-seeded')) return
      sessionStorage.setItem('seewee-seeded', '1')
      void fetch('/api/seed', { method: 'POST' })
        .then((r) => r.json())
        .catch(() => {})
    } catch {
      /* private mode guard */
    }
  }, [])

  // Listen for candidate dashboard's "Resume AI Interview" custom event
  useEffect(() => {
    function onStart(e: Event) {
      const detail = (e as CustomEvent<string | { id?: string; shortlistId?: string }>).detail
      const id =
        typeof detail === 'string'
          ? detail
          : detail?.shortlistId ?? detail?.id ?? ''
      if (id) startInterview(id)
    }
    document.addEventListener('seewee:start-interview', onStart)
    return () => document.removeEventListener('seewee:start-interview', onStart)
  }, [startInterview])

  // Full-screen AI interview takeover
  if (view === 'interview') {
    return (
      <div className="min-h-screen bg-background">
        <InterviewRoom />
        {/* toasts + hidden dialogs still needed */}
        <AuthDialog />
        <JobDetailDialog />
      </div>
    )
  }

  // Full-screen public career page takeover (deep link ?career={clientId}) —
  // company-branded, works signed-out; dialogs stay mounted for Easy Apply.
  if (view === 'career') {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <CareerPageView />
        <JobDetailDialog />
        <AuthDialog />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DeepLinkController />
      <Header />
      <main id="main" className="flex-1">
        <motion.div
          key={view === 'reports' ? 'recruiter' : view}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {view === 'browse' ? (
            <JobsView />
          ) : view === 'insights' ? (
            <SalaryInsightsPage />
          ) : view === 'recruiter' || view === 'reports' ? (
            user?.role === 'RECRUITER' ? (
              <RecruiterDashboard />
            ) : (
              <HomeView />
            )
          ) : view === 'talent' ? (
            user?.role === 'RECRUITER' ? (
              <TalentSearchWorkspace />
            ) : (
              <HomeView />
            )
          ) : view === 'candidate' && user ? (
            user.role === 'CANDIDATE' ? (
              <CandidateDashboard />
            ) : (
              <HomeView />
            )
          ) : view === 'client' && user ? (
            user.role === 'CLIENT' ? (
              <ClientPortalView />
            ) : (
              <HomeView />
            )
          ) : view === 'admin' && user ? (
            user.role === 'ADMIN' ? (
              <AdminView />
            ) : (
              <HomeView />
            )
          ) : (
            <HomeView />
          )}
        </motion.div>
      </main>
      <Footer />

      {/* Global overlays */}
      <JobDetailDialog />
      <AuthDialog />
    </div>
  )
}
