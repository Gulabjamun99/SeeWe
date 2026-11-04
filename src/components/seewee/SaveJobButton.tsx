'use client'

import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Bookmark, BookmarkCheck } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Bookmark toggle for jobs. Appears on job cards + detail dialog.
 * - Signed-out users get the auth dialog.
 * - Optimistic toggle with server reconciliation + rollback.
 */
export function SaveJobButton({
  jobId,
  withLabel = false,
  className = '',
}: {
  jobId: string
  withLabel?: boolean
  className?: string
}) {
  const user = useAppStore((s) => s.user)
  const saved = useAppStore((s) => s.savedJobIds.includes(jobId))
  const toggleSavedJob = useAppStore((s) => s.toggleSavedJob)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)

  async function onClick(e: React.MouseEvent) {
    e.stopPropagation() // don't trigger parent card click
    if (!user) {
      setAuthOpen(true)
      toast.info('Sign in to bookmark jobs 🔖')
      return
    }
    try {
      const nowSaved = await toggleSavedJob(jobId)
      if (nowSaved) toast.success('Job saved to your bookmarks 🔖')
      else toast('Removed from saved jobs', { icon: '🗑️' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update bookmark')
    }
  }

  const label = saved ? 'Saved' : 'Save'

  if (withLabel) {
    return (
      <Button
        type="button"
        variant={saved ? 'default' : 'outline'}
        aria-pressed={saved}
        aria-label={saved ? `Remove ${label} bookmark` : `Save this job`}
        onClick={(e) => void onClick(e)}
        className={`h-11 min-w-[44px] ${
          saved
            ? 'border-transparent bg-gradient-to-r from-blue-600 to-sky-600 text-white hover:from-blue-700 hover:to-sky-700'
            : 'border-slate-300 text-slate-700 dark:text-slate-300 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700'
        } ${className}`}
      >
        {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
        {label}
      </Button>
    )
  }

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? 'Remove bookmark from this job' : 'Bookmark this job'}
      onClick={(e) => void onClick(e)}
      className={`flex h-9 w-9 min-w-[36px] items-center justify-center rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
        saved
          ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-600 shadow-sm'
          : 'border-slate-200 bg-white/90 text-slate-400 dark:text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600'
      } ${className}`}
    >
      {saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
    </button>
  )
}
