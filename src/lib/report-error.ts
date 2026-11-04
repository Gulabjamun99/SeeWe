'use client'

/**
 * Client-side crash telemetry — the diagnostics for the recurring
 * "white screen" reports that could never be reproduced headlessly.
 *
 * Every uncaught error / rejection is POSTed to /api/client-log, which
 * console.errors it into the dev log with a full stack. The next time
 * anything blanks out on a recruiter's device, the actual stack lands in
 * dev.log instead of dying silently.
 *
 * Also wires a watchdog: if the React root container is ever emptied while
 * the tab is visible (true white screen), that is reported too.
 */

let wired = false

export function installCrashReporter(): void {
  if (wired || typeof window === 'undefined') return
  wired = true

  const send = (payload: Record<string, unknown>) => {
    try {
      const body = JSON.stringify({
        ...payload,
        url: location.href,
        ua: navigator.userAgent,
        viewport: `${window.innerWidth}x${window.innerHeight}`,
        ts: new Date().toISOString(),
      })
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/client-log', new Blob([body], { type: 'application/json' }))
      } else {
        void fetch('/api/client-log', { method: 'POST', body, keepalive: true })
      }
    } catch {
      /* telemetry must never break the app */
    }
  }

  window.addEventListener('error', (e) => {
    send({
      kind: 'error',
      message: e.message,
      source: `${e.filename}:${e.lineno}:${e.colno}`,
      stack: e.error?.stack ?? null,
    })
  })

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason
    send({
      kind: 'unhandledrejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack ?? null : null,
    })
  })

  // True-white-screen watchdog: React 19 clears the root on an unrecoverable
  // render crash in production. Catch that exact moment.
  const root = document.getElementById('__next') ?? document.getElementById('root')
  if (root) {
    let lastChildCount = root.childElementCount
    const check = () => {
      const now = root.childElementCount
      if (lastChildCount > 0 && now === 0 && document.visibilityState === 'visible') {
        send({ kind: 'root-unmounted', message: 'React root emptied while page visible' })
      }
      lastChildCount = now
    }
    new MutationObserver(check).observe(root, { childList: true })
  }
}

/** One-liner for boundaries / catch blocks. */
export function reportClientError(error: unknown, extra?: Record<string, unknown>): void {
  try {
    const err = error instanceof Error ? error : new Error(String(error))
    const body = JSON.stringify({
      kind: 'reported',
      message: err.message,
      stack: err.stack ?? null,
      ...extra,
      url: location.href,
      ts: new Date().toISOString(),
    })
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/client-log', new Blob([body], { type: 'application/json' }))
    } else {
      void fetch('/api/client-log', { method: 'POST', body, keepalive: true })
    }
  } catch {
    /* never break the app from telemetry */
  }
}
