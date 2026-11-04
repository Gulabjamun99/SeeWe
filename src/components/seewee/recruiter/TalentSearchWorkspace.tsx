'use client'

/**
 * TalentSearchWorkspace — the STANDALONE Talent Search surface.
 *
 * This is deliberately NOT the Hiring Hub: when the recruiter clicks
 * "Talent Search" in the header they land here — a dedicated, full-page
 * CV-database hunting workspace with ONLY search features. No dashboard
 * hero, no analytics graphs, no hiring pipeline chrome. Hiring Hub keeps
 * its own tab set; this module is its own experience.
 *
 * Own chrome: a slim branded toolbar (back to Hiring Hub + module identity
 * + live usage) so the module is recognisably separate in the shell.
 */

import { useSyncExternalStore } from 'react'
import { ArrowLeft, Database, Search, Sparkles } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { TalentSearch } from './TalentSearch'

/** hydration-safe mounted gate (lint-friendly, no cascading render) */
const emptySubscribe = () => () => {}
function useMounted() {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
}

export function TalentSearchWorkspace() {
  const user = useAppStore((s) => s.user)
  const setView = useAppStore((s) => s.setView)
  const mounted = useMounted()

  if (!mounted) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
        <div className="h-9 w-72 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      </div>
    )
  }

  if (!user || user.role !== 'RECRUITER') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-teal-50 dark:bg-teal-950/50">
          <Search className="size-7 text-teal-600" aria-hidden />
        </div>
        <h1 className="mt-4 text-xl font-bold">Talent Search is a recruiter workspace</h1>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          Sign in with a recruiter account to hunt the CV database — Boolean queries, 16 structured
          filters, JD matching, talent pools and saved-search alerts.
        </p>
        <Button type="button" className="mt-5 bg-teal-600 text-white hover:bg-teal-700" onClick={() => useAppStore.getState().setAuthOpen(true)}>
          Sign in as recruiter
        </Button>
      </div>
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-slate-50/60 dark:bg-slate-950/40">
      {/* module toolbar — slim, clearly NOT the hiring-hub dashboard */}
      <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 px-2 text-xs text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
            onClick={() => setView('recruiter')}
            aria-label="Back to Hiring Hub"
          >
            <ArrowLeft className="size-3.5" aria-hidden /> Hiring Hub
          </Button>
          <div className="mx-1 hidden h-6 w-px bg-slate-200 sm:block dark:bg-slate-800" />
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 shadow-sm">
              <Database className="size-4.5 text-white" aria-hidden />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-slate-50">
                Talent Search
                <span className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-teal-700 dark:bg-teal-950/60 dark:text-teal-300">
                  CV Database
                </span>
              </p>
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                Advanced sourcing — Boolean · skills · industry · JD match
              </p>
            </div>
          </div>
          <div className="ml-auto hidden items-center gap-2 text-[11px] text-slate-400 lg:flex" aria-hidden>
            <Sparkles className="size-3.5 text-teal-500" />
            every filter below is backed by real stored data
          </div>
        </div>
      </div>

      {/* the search module itself — full bleed, dashboard-free */}
      <div className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-6">
        <TalentSearch />
      </div>
    </div>
  )
}
