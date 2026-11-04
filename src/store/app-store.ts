'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { User, Role } from '@/lib/types'

export type View =
  | 'home'
  | 'browse'
  | 'candidate'
  | 'recruiter'
  | 'talent'
  | 'reports'
  | 'client'
  | 'interview'
  | 'admin'
  | 'insights'
  | 'career'

/** Which channel an application came through — deep-link driven attribution.
 * Stored server-side on Application.source; reset after a successful apply. */
export const APPLY_SOURCES = ['DIRECT', 'SHARED_LINK', 'CAREER_PAGE', 'REFERRAL'] as const

/** Deep-link handoff: a notification (or any surface) can ask a dashboard to
 * focus a specific record after the view switch. Consumers must clear it. */
export type PendingFocus =
  | { kind: 'recruiter-applicants'; jobId?: string; applicationId?: string }
  | { kind: 'client-report'; shortlistId: string }
  | { kind: 'candidate-application'; applicationId: string }
  | { kind: 'messages'; peerId: string; peerName?: string }

/** Any component can bump this counter to tell panels to refetch */
interface AppStore {
  user: User | null
  view: View
  activeJobId: string | null
  activeShortlistId: string | null
  authOpen: boolean
  refreshKey: number
  savedJobIds: string[]
  savedLoaded: boolean
  /** filters to apply the next time the browse view mounts (search handoff) */
  pendingSearch: { keyword?: string; location?: string } | null
  /** one-shot deep-link target for dashboards (notification click-through) */
  pendingFocus: PendingFocus | null
  /** Public career page handoff: the client whose careers site is being viewed */
  careerClientId: string | null
  /** Attribution for the next application (set via ?src= deep link / career view).
   * Always one of APPLY_SOURCES; 'DIRECT' is the neutral default. */
  applySource: string

  setApplySource: (s: string | null) => void
  setCareerClientId: (id: string | null) => void
  setUser: (u: User | null) => void
  setView: (v: View) => void
  openJob: (jobId: string) => void
  closeJob: () => void
  startInterview: (shortlistId: string) => void
  exitInterview: () => void
  setAuthOpen: (open: boolean) => void
  bumpRefresh: () => void
  setPendingSearch: (s: { keyword?: string; location?: string } | null) => void
  setPendingFocus: (f: PendingFocus | null) => void

  /** Load the signed-in candidate's bookmarked job ids */
  loadSavedJobs: () => Promise<void>
  /** Toggle bookmark; resolves to the new saved state */
  toggleSavedJob: (jobId: string) => Promise<boolean>

  logout: () => void
  /** demo login against /api/auth/login (recruiters also send their company;
   * candidates with full-auth accounts also send their password) */
  login: (email: string, role: Role, name?: string, company?: string, password?: string) => Promise<User>
}

export const useAppStore = create<AppStore>()(
  persist(
    (set, get) => ({
      user: null,
      view: 'home',
      activeJobId: null,
      activeShortlistId: null,
      authOpen: false,
      refreshKey: 0,
      savedJobIds: [],
      savedLoaded: false,
      pendingSearch: null,
      pendingFocus: null,
      careerClientId: null,
      applySource: 'DIRECT',

      setPendingSearch: (pendingSearch) => set({ pendingSearch }),
      setPendingFocus: (pendingFocus) => set({ pendingFocus }),
      // null resets to the neutral DIRECT channel
      setApplySource: (s) => set({ applySource: s ?? 'DIRECT' }),
      setCareerClientId: (careerClientId) => set({ careerClientId }),

      loadSavedJobs: async () => {
        const user = get().user
        if (!user || user.role !== 'CANDIDATE') {
          set({ savedJobIds: [], savedLoaded: true })
          return
        }
        try {
          const res = await fetch(`/api/saved-jobs?userId=${encodeURIComponent(user.id)}`)
          const json: { data?: { id: string }[] } = await res.json()
          set({ savedJobIds: (json.data ?? []).map((j) => j.id), savedLoaded: true })
        } catch {
          set({ savedLoaded: true })
        }
      },

      toggleSavedJob: async (jobId) => {
        const user = get().user
        if (!user) throw new Error('Sign in to save jobs')
        const prev = get().savedJobIds
        const isSaved = prev.includes(jobId)
        // optimistic update
        set({ savedJobIds: isSaved ? prev.filter((id) => id !== jobId) : [...prev, jobId] })
        try {
          const res = await fetch('/api/saved-jobs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, jobId }),
          })
          const json: { data?: { saved: boolean }; error?: string } = await res.json()
          if (!res.ok || json.error) throw new Error(json.error || 'Failed')
          // reconcile with server truth
          const saved = !!json.data?.saved
          set({
            savedJobIds: saved
              ? Array.from(new Set([...get().savedJobIds, jobId]))
              : get().savedJobIds.filter((id) => id !== jobId),
          })
          return saved
        } catch (err) {
          // rollback
          set({ savedJobIds: prev })
          throw err
        }
      },

      setUser: (user) => set({ user }),
      setView: (view) => set({ view }),
      openJob: (activeJobId) => set({ activeJobId }),
      closeJob: () => set({ activeJobId: null }),
      startInterview: (activeShortlistId) =>
        set({ activeShortlistId, view: 'interview' }),
      exitInterview: () => {
        // Route back to the signed-in role's home — a candidate leaving the
        // room should land on My Journey, not the marketing page.
        const role = get().user?.role
        set({
          activeShortlistId: null,
          view: role === 'CANDIDATE' ? 'candidate' : role === 'CLIENT' ? 'client' : 'recruiter',
          refreshKey: get().refreshKey + 1,
        })
      },
      setAuthOpen: (authOpen) => set({ authOpen }),
      bumpRefresh: () => set({ refreshKey: get().refreshKey + 1 }),

      logout: () =>
        set({
          user: null,
          view: 'home',
          savedJobIds: [],
          savedLoaded: false,
          pendingFocus: null, // don't leak a deep-link into the next session
          pendingSearch: null,
          careerClientId: null,
          applySource: 'DIRECT',
        }),

      login: async (email, role, name, company, password) => {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, role, name, company, password }),
        })
        const json = await res.json()
        if (!res.ok || json.error) throw new Error(json.error || 'Login failed')
        set({ user: json.data as User })
        return json.data as User
      },
    }),
    {
      name: 'seewee-session',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ user: s.user }),
    }
  )
)

export function skillsToArray(skillsCsv?: string | null): string[] {
  if (!skillsCsv) return []
  return skillsCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** One-shot channel consumption after a successful apply. Visitors still on a
 * public career page keep CAREER_PAGE attribution for their next application;
 * everywhere else the deep-link tag is spent and resets to DIRECT. */
export function consumeApplySource(): void {
  const { view, setApplySource } = useAppStore.getState()
  setApplySource(view === 'career' ? 'CAREER_PAGE' : null)
}

export function formatLpa(min?: number | null, max?: number | null): string {
  if (min && max) return `₹${min} – ₹${max} LPA`
  if (min) return `₹${min}+ LPA`
  if (max) return `Up to ₹${max} LPA`
  return 'Salary undisclosed'
}

export function matchColor(score?: number | null): string {
  if (score == null) return 'text-slate-400'
  if (score >= 70) return 'text-blue-600'
  if (score >= 40) return 'text-amber-600'
  return 'text-rose-500'
}

/** Human-friendly match pill text — "0% match" reads like a bug, so soften it */
export function matchLabel(score?: number | null): string {
  if (score == null) return 'No match data'
  if (score >= 90) return `${Math.round(score)}% match · excellent`
  if (score >= 70) return `${Math.round(score)}% match · strong`
  if (score > 0) return `${Math.round(score)}% match`
  return 'Low skill overlap'
}

export const VERDICT_META: Record<
  string,
  { label: string; className: string; emoji: string }
> = {
  // ADVICE, NOT VERDICT (user decision): the AI only SUGGESTS — the words are
  // phrased as suggestions so nobody reads them as an automatic rejection.
  // The final Advance/Hold/Reject always belongs to the recruiter.
  STRONG_HIRE: {
    label: 'AI suggests: Strong yes',
    className: 'bg-blue-100 text-blue-800 border-blue-300',
    emoji: '🚀',
  },
  HIRE: {
    label: 'AI suggests: Yes',
    className: 'bg-sky-100 text-sky-800 border-sky-300',
    emoji: '✅',
  },
  MAYBE: {
    label: 'AI suggests: Borderline',
    className: 'bg-amber-100 text-amber-800 border-amber-300',
    emoji: '🤔',
  },
  NO_HIRE: {
    label: 'AI suggests: Not fit',
    className: 'bg-rose-100 text-rose-700 border-rose-300',
    emoji: '⚠️',
  },
}
