/**
 * timeAgo — tiny relative-time helper for recruiter panels ("just now", "5m", "2h", "3d", "14d").
 * Falls back to a short date for anything older than ~2 weeks.
 */

export function timeAgoShort(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const then = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(then.getTime())) return ''

  const diffMs = Date.now() - then.getTime()
  const mins = Math.floor(diffMs / 60000)

  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days <= 14) return `${days}d`

  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
