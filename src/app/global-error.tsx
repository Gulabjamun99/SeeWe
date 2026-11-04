'use client'

/**
 * Global error boundary — the LAST line of defence against a white screen.
 *
 * Why: this catches crashes that even ./error.tsx can't (errors inside the
 * root layout / html shell itself). Without it, those crashes unmount the
 * document and the user is left with a fully blank white tab — the exact
 * "screen white ho ja rhi hai" report this file exists to prevent.
 *
 * Because it replaces the entire document, it must render its own
 * <html>/<body> shell and keeps inline styles only (no external CSS
 * dependency that could itself be the thing that crashed).
 */

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[SeeWe] fatal error caught by global boundary:', error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f8fafc',
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          padding: '16px',
        }}
      >
        <div
          role="alert"
          style={{
            width: '100%',
            maxWidth: 420,
            textAlign: 'center',
            padding: 28,
            borderRadius: 16,
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            boxShadow: '0 4px 16px rgba(15, 23, 42, 0.06)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              margin: '0 auto',
              borderRadius: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#fef3c7',
              fontSize: 28,
            }}
            aria-hidden
          >
            ⚠️
          </div>
          <h1 style={{ margin: '16px 0 4px', fontSize: 20, color: '#0f172a' }}>
            SeeWe hit a snag
          </h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#475569' }}>
            A critical error stopped the app from rendering. Your data is safe. Reload to get
            back to work.
          </p>
          {error.digest ? (
            <p style={{ margin: '10px 0 0', fontSize: 11, color: '#94a3b8', fontFamily: 'monospace' }}>
              ref: {error.digest}
            </p>
          ) : null}
          <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={reset}
              style={{
                height: 40,
                padding: '0 18px',
                borderRadius: 10,
                border: 'none',
                background: 'linear-gradient(90deg, #2563eb, #0ea5e9)',
                color: '#fff',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                height: 40,
                padding: '0 18px',
                borderRadius: 10,
                border: '1px solid #cbd5e1',
                background: '#fff',
                color: '#0f172a',
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload page
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
