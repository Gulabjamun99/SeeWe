'use client'

/**
 * Route-level error boundary — the white-screen killer.
 *
 * Why: previously ANY uncaught render error unmounted the whole React tree
 * and left the user staring at a blank white page with no way forward
 * ("screen white ho ja rhi hai"). This boundary catches those crashes,
 * logs them for the dev log, and hands the user a one-click recovery
 * (retry the failed render or reload the tab fresh).
 *
 * Note: this does NOT catch errors in the root layout itself — those fall
 * through to ./global-error.tsx.
 */

import { useEffect } from 'react'
import { AlertTriangle, RotateCcw, RefreshCw, Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface the real stack in the dev log / browser console
    console.error('[SeeWe] render error caught by boundary:', error)
  }, [error])

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <div
        role="alert"
        className="w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50/60 p-6 text-center shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20"
      >
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-amber-100 dark:bg-amber-900/50">
          <AlertTriangle className="size-7 text-amber-600 dark:text-amber-300" aria-hidden />
        </span>
        <h1 className="mt-4 text-lg font-bold text-slate-900 dark:text-slate-50">
          Something went wrong
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
          The page hit an unexpected error and stopped rendering. Your data is safe — try again,
          or reload for a fresh start.
        </p>
        {error.digest ? (
          <p className="mt-2 font-mono text-[11px] text-slate-400 dark:text-slate-500">
            ref: {error.digest}
          </p>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button
            onClick={reset}
            className="h-10 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm hover:from-blue-700 hover:to-sky-600"
          >
            <RotateCcw className="size-4" aria-hidden /> Try again
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.reload()}
            className="h-10 rounded-lg border-slate-300 dark:border-slate-700"
          >
            <RefreshCw className="size-4" aria-hidden /> Reload page
          </Button>
        </div>

        <button
          type="button"
          onClick={() => {
            window.location.href = '/'
          }}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline-offset-2 hover:underline dark:text-slate-400"
        >
          <Home className="size-3" aria-hidden /> Back to home
        </button>
      </div>
    </div>
  )
}
