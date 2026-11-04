'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { reportClientError } from '@/lib/report-error'

interface Props {
  children: ReactNode
  /** Changes whenever the parent remounts the form (dialog reopened etc.). */
  resetKey?: string
}

interface State {
  failed: boolean
}

/**
 * Local render boundary for big in-dialog forms (Post a Job / Edit job).
 *
 * The last line of defence for the recurring "white screen" report: even if
 * an unknown bug ever throws during the form's render, the user gets a small
 * recoverable panel here — NOT a white dialog. Remounting restores the
 * auto-saved draft from localStorage, so no work is lost.
 */
export class FormErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[FormErrorBoundary] form render crashed:', error, info.componentStack)
    reportClientError(error, { scope: 'post-job-form', componentStack: info.componentStack })
  }

  componentDidUpdate(prev: Props) {
    // Re-arm when the dialog reopens with a fresh form instance.
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex flex-col items-center gap-3 p-10 text-center" role="alert">
        <span className="grid size-12 place-items-center rounded-2xl bg-amber-100 dark:bg-amber-950/50">
          <AlertTriangle className="size-6 text-amber-600 dark:text-amber-300" aria-hidden />
        </span>
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          The form hit a snag while rendering
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          Your work is auto-saved — restoring the form brings back your draft, including any logo
          you added.
        </p>
        <Button
          size="sm"
          onClick={() => this.setState({ failed: false })}
          className="h-9 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm hover:from-blue-700 hover:to-sky-600"
        >
          <RotateCcw className="size-3.5" aria-hidden /> Restore my form
        </Button>
      </div>
    )
  }
}
