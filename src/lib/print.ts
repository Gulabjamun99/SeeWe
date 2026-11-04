'use client'

/**
 * SeeWe print/PDF export utility.
 *
 * Strategy: clone the target element's HTML into a hidden same-origin iframe,
 * copy the app stylesheets + a small print stylesheet in, then print the
 * iframe. This is immune to dialog stacking contexts, scroll containers and
 * transforms, and never mutates the React-managed tree.
 *
 * In the browser print dialog the user can "Save as PDF" — the iframe's
 * document title becomes the suggested filename in Chrome/Edge.
 */

const PRINT_SHELL_CSS = `
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    font-family: var(--font-geist-sans), ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
    padding: 20px 24px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @page { margin: 12mm; }
  /* Elements tagged data-print-hide are interactive-only (buttons, etc.) */
  [data-print-hide] { display: none !important; }
  /* Graceful page breaks between report sections */
  .print-section { break-inside: avoid; page-break-inside: avoid; }
`

export interface PrintElementOptions {
  /** Suggested PDF filename (used as the iframe document title) */
  title?: string
}

export function printElement(elementId: string, options: PrintElementOptions = {}): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const el = document.getElementById(elementId)
  if (!el) return

  // Copy current stylesheets so Tailwind classes resolve inside the clone.
  const styles = Array.from(
    document.querySelectorAll('style, link[rel="stylesheet"]')
  )
    .map((node) => node.outerHTML)
    .join('\n')

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.visibility = 'hidden'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    iframe.remove()
    return
  }

  const safeTitle = (options.title ?? 'SeeWe report').replace(/[<>]/g, '')

  doc.open()
  doc.write(
    `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>${safeTitle}</title>` +
      `${styles}<style>${PRINT_SHELL_CSS}</style></head>` +
      `<body>${el.outerHTML}</body></html>`
  )
  doc.close()

  const remove = () => window.setTimeout(() => iframe.remove(), 400)

  // afterprint fires when the dialog closes in Chrome/Edge/Firefox/Safari 13+.
  iframe.contentWindow?.addEventListener('afterprint', remove, { once: true })
  // Failsafe: never leave an orphan iframe around for more than a minute.
  window.setTimeout(() => iframe.remove(), 60_000)

  window.setTimeout(() => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } catch {
      iframe.remove()
    }
  }, 250)
}
