'use client'

import { useState } from 'react'
import { useAppStore } from '@/store/app-store'
import Image from 'next/image'
import {
  Bot,
  Building2,
  BriefcaseBusiness,
  Github,
  Handshake,
  Instagram,
  LifeBuoy,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Twitter,
  UsersRound,
} from 'lucide-react'
import { LegalDialog, type LegalPage } from '@/components/seewee/LegalDialog'

export function Footer() {
  const setView = useAppStore((s) => s.setView)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const user = useAppStore((s) => s.user)
  const [legalPage, setLegalPage] = useState<LegalPage | null>(null)

  /* ---- Role-aware footer routing (was: every link opened the auth dialog,
   * even for signed-in users). Guests get the auth dialog; signed-in users
   * land in the dashboard that actually serves the link. ---- */
  const goCandidateArea = () => {
    if (!user) return setAuthOpen(true)
    if (user.role === 'CANDIDATE') setView('candidate')
    else setView('browse') // recruiters/clients/admins — neutral jobs feed
  }
  const goRecruiterArea = () => {
    if (!user) return setAuthOpen(true)
    if (user.role === 'RECRUITER') setView('recruiter')
    else if (user.role === 'CLIENT') setView('client')
    else if (user.role === 'ADMIN') setView('admin')
    else setView('browse')
  }

  const legalLinks: [LegalPage, string][] = [
    ['about', 'About Us'],
    ['privacy', 'Privacy Policy'],
    ['terms', 'Terms of Service'],
    ['contact', 'Contact'],
  ]

  return (
    <footer className="mt-auto border-t border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {/* Brand */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Image
                src="/seewee-logo.png"
                alt="SeeWe — AI Hiring Suite"
                width={200}
                height={110}
                className="h-9 w-auto rounded-lg ring-1 ring-slate-900/10 dark:ring-white/15"
              />
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Where talent meets opportunity — powered by AI. Post jobs, discover people,
              and let our AI interviewer find your next great hire.
            </p>
            <div className="flex gap-2 pt-1" aria-label="Social links">
              {[Instagram, Twitter, Github].map((Icon, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={['Instagram', 'Twitter', 'GitHub'][i]}
                  onClick={() => setLegalPage('contact')}
                  title={['Instagram', 'Twitter', 'GitHub'][i] + ' — see Contact page'}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-blue-700 dark:hover:text-sky-400"
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>

          {/* For job seekers */}
          <nav aria-label="For job seekers">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              <BriefcaseBusiness className="h-4 w-4 text-blue-600 dark:text-blue-400" /> For Job Seekers
            </h3>
            <ul className="space-y-2 text-sm text-slate-500">
              <li>
                <button type="button" className="transition-colors hover:text-blue-700" onClick={() => setView('browse')}>
                  Browse jobs
                </button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-blue-700" onClick={goCandidateArea}>
                  My applications
                </button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-blue-700" onClick={goCandidateArea}>
                  Build profile
                </button>
              </li>
            </ul>
          </nav>

          {/* For recruiters */}
          <nav aria-label="For recruiters">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              <UsersRound className="h-4 w-4 text-blue-600 dark:text-blue-400" /> For Recruiters
            </h3>
            <ul className="space-y-2 text-sm text-slate-500">
              <li>
                <button type="button" className="transition-colors hover:text-blue-700" onClick={goRecruiterArea}>
                  Post a job
                </button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-blue-700" onClick={goRecruiterArea}>
                  Search candidates
                </button>
              </li>
              <li>
                <button type="button" className="transition-colors hover:text-blue-700" onClick={goRecruiterArea}>
                  Manage clients
                </button>
              </li>
            </ul>
          </nav>

          {/* AI Suite */}
          <nav aria-label="AI suite">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" /> SeeWe AI
            </h3>
            <ul className="space-y-2 text-sm text-slate-500">
              <li className="flex items-center gap-2">
                <Building2 className="h-3.5 w-3.5 text-sky-500" /> Resume-aware questions
              </li>
              <li>🎙️ Spoken video interviews</li>
              <li>⭐ Instant candidate ratings</li>
              <li>📤 Client-ready score reports</li>
            </ul>
          </nav>

          {/* Company + legal (master spec §7) — opens the LegalDialog */}
          <nav aria-label="Company and legal">
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-700 dark:text-slate-200">
              <Handshake className="h-4 w-4 text-blue-600 dark:text-blue-400" /> Company
            </h3>
            <ul className="space-y-2 text-sm text-slate-500">
              <li>
                <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-blue-700" onClick={() => setLegalPage('about')}>
                  <Sparkles className="h-3.5 w-3.5 text-sky-500" aria-hidden /> About Us
                </button>
              </li>
              <li>
                <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-blue-700" onClick={() => setLegalPage('privacy')}>
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> Privacy
                </button>
              </li>
              <li>
                <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-blue-700" onClick={() => setLegalPage('terms')}>
                  <ScrollText className="h-3.5 w-3.5 text-amber-500" aria-hidden /> Terms
                </button>
              </li>
              <li>
                <button type="button" className="inline-flex items-center gap-1.5 transition-colors hover:text-blue-700" onClick={() => setLegalPage('contact')}>
                  <LifeBuoy className="h-3.5 w-3.5 text-violet-500" aria-hidden /> Contact
                </button>
              </li>
            </ul>
          </nav>
        </div>

        {/* Client partner strip */}
        <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-50 via-sky-50 to-white p-5 sm:flex-row sm:items-center dark:border-blue-900/60 dark:from-blue-950/40 dark:via-sky-950/30 dark:to-slate-900">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-sky-600 shadow-sm">
              <Handshake className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">Are you a client partner?</p>
              <p className="mt-0.5 max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Sign in with your registered email to review AI-rated candidate reports and share
                your verdict straight back with the hiring team.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (user?.role === 'CLIENT') setView('client')
              else setAuthOpen(true)
            }}
            className="inline-flex h-10 shrink-0 items-center rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 px-5 text-sm font-semibold text-white shadow-sm transition-all hover:from-blue-700 hover:to-sky-700 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {user?.role === 'CLIENT' ? 'Open Client Portal' : 'Client sign in'} →
          </button>
        </div>

        <div className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-slate-200 pt-6 sm:flex-row dark:border-slate-800">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            © {new Date().getFullYear()} SeeWe Technologies. All rights reserved.
          </p>
          <nav aria-label="Legal links" className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
            {legalLinks.map(([pg, label]) => (
              <button
                key={pg}
                type="button"
                onClick={() => setLegalPage(pg)}
                className="transition-colors hover:text-blue-700 hover:underline"
              >
                {label}
              </button>
            ))}
          </nav>
          <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
            Made with 💙 in India · Interviews conducted by{' '}
            <span className="font-semibold text-blue-600 dark:text-blue-400">SeeWe AI</span>
          </p>
        </div>
      </div>

      {/* Legal/info dialog — footer-owned instance (About · Privacy · Terms · Contact) */}
      <LegalDialog
        page={legalPage}
        onOpenChange={(open) => !open && setLegalPage(null)}
        onPageChange={setLegalPage}
      />
    </footer>
  )
}
