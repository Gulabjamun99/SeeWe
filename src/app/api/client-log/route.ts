import { NextResponse } from 'next/server'

/**
 * Client crash telemetry sink.
 *
 * The browser beacon (navigator.sendBeacon from lib/report-error.ts) lands
 * here; we console.error the payload so it flows into the dev log with a
 * full stack. This is how the previously-undiagnosable "white screen"
 * reports become actionable: the next occurrence prints the exact error,
 * source URL and stack right into dev.log.
 *
 * No PII is collected — only the error message/stack, page URL and viewport.
 */

export async function POST(request: Request) {
  let payload: Record<string, unknown> = {}
  try {
    const raw = await request.text()
    try {
      payload = JSON.parse(raw) as Record<string, unknown>
    } catch {
      // sendBeacon may send text/plain depending on Blob typing — still log it
      payload = { kind: 'unparsed', raw: raw.slice(0, 4000) }
    }
  } catch {
    payload = { kind: 'unreadable-body' }
  }

  const kind = typeof payload.kind === 'string' ? payload.kind : 'unknown'
  const message = typeof payload.message === 'string' ? payload.message : '(no message)'
  const stack = typeof payload.stack === 'string' ? payload.stack : ''
  const url = typeof payload.url === 'string' ? payload.url : ''

  // Single loud line + indented stack — easy to spot in dev.log searches.
  console.error(
    `[client-crash:${kind}] ${message} @ ${url}` +
      (stack ? `\n${stack.split('\n').slice(0, 12).join('\n')}` : '') +
      (Object.keys(payload).some((k) => !['kind', 'message', 'stack', 'url', 'ua', 'viewport', 'ts'].includes(k))
        ? `\n[client-crash:extra] ${JSON.stringify(
            Object.fromEntries(
              Object.entries(payload).filter(
                ([k]) => !['kind', 'message', 'stack', 'url', 'ua', 'viewport', 'ts'].includes(k),
              ),
            ),
          ).slice(0, 2000)}`
        : ''),
  )

  return NextResponse.json({ ok: true })
}
