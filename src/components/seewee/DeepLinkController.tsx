'use client'

/**
 * DeepLinkController — one-shot URL query-param handler for share-kit deep links.
 *
 * Supported params on `/` (direct subpaths 404 by design):
 *   ?career={clientId} → public, company-branded career page view
 *                         (works signed-out AND signed-in)
 *   ?job={jobId}       → candidate jobs view with the global job detail
 *                         dialog opened for that job
 *   ?src={shared|career} → tags the next application's source channel
 *                         (SHARED_LINK | CAREER_PAGE) for attribution
 *
 * After handling, the URL is cleaned so refreshes never re-trigger the handoff.
 * With no params present this component is a no-op and the app renders exactly
 * as before. The global JobDetailDialog fetches the job itself from
 * activeJobId, so opening a deep-linked job needs no waiting on list fetches.
 */

import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'

export function DeepLinkController() {
  const setView = useAppStore((s) => s.setView)
  const openJob = useAppStore((s) => s.openJob)
  const setApplySource = useAppStore((s) => s.setApplySource)
  const setCareerClientId = useAppStore((s) => s.setCareerClientId)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const career = sp.get('career')
    const job = sp.get('job')
    const src = sp.get('src')
    if (!career && !job && !src) return

    // Channel attribution (applies to the next application submitted)
    if (src === 'shared') setApplySource('SHARED_LINK')
    else if (src === 'career') setApplySource('CAREER_PAGE')

    if (career) {
      // Public career page takes over the whole screen (works signed-out)
      setCareerClientId(career)
      setView('career')
    } else if (job) {
      setView('browse')
      // The dialog resolves the job via GET /api/jobs/{id} on its own, so this
      // works even before the jobs list has fetched.
      openJob(job)
    }

    // Clean the URL — refreshes must not re-trigger the deep link
    window.history.replaceState({}, '', '/')
  }, [setView, openJob, setApplySource, setCareerClientId])

  return null
}
