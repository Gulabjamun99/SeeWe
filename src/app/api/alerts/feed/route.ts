import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * WhatsApp-style alert channel — candidate-side chat feed.
 *
 * GET  /api/alerts/feed?userId={candidateId}
 *   Merges, in chronological (ascending) order, every platform update the
 *   candidate is allowed to see as a chat bubble:
 *     a) their Notification rows (shortlists, interviews, verdicts…)
 *     b) EmailLog rows addressed to them (process mails, informational)
 *     c) job-alert matches: ACTIVE jobs created after each JobAlert.lastSeenAt
 *        matching the alert's keyword/location/salary filters (max 5 per alert)
 *
 *   POST /api/alerts/feed { userId, action: 'seen' | 'seen-all', ids?: string[] }
 *   'seen'  with ids: notification ids are marked read (ownership-guarded);
 *                     job-alert bubble ids ("alert-{alertId}-{jobId}") reset
 *                     that alert's lastSeenAt so the same matches stop re-surfacing.
 *   'seen-all' (or 'seen' without ids): marks ALL the user's notifications read.
 *
 * Candidate privacy is absolute: bubbles never include match scores, screening
 * verdicts, authenticity data, recruiter notes or any other candidate's info.
 */

export const dynamic = 'force-dynamic'

const MAX_ROWS_PER_SOURCE = 100
const MAX_MATCHES_PER_ALERT = 5
const MAIL_BODY_MAX_CHARS = 400
const MAX_SEEN_IDS = 100

interface FeedBubble {
  id: string
  source: 'platform' | 'mail' | 'job-alert'
  kind: string
  title: string
  body: string
  createdAt: string
  read: boolean
  jobId?: string
  alertId?: string
  meta?: { jobId?: string; applicationId?: string }
}

/** Friendly labels for notification types (fallback = prettified raw type) */
const NOTIF_KINDS: Record<string, string> = {
  APPLICATION: 'Application',
  SHORTLIST: 'Pipeline update',
  INTERVIEW_DONE: 'AI interview',
  CLIENT_VERDICT: 'Client verdict',
  REPORT_SHARED: 'Report shared',
  SLA: 'Transparency watch',
}

/** Friendly labels for process-email kinds */
const MAIL_KINDS: Record<string, string> = {
  APPLICATION_RECEIVED: 'Application received',
  INTERVIEW_INVITE: 'Interview invite',
  INTERVIEW_SUBMITTED: 'Interview submitted',
  OFFER: 'Offer',
  STATUS_UPDATE: 'Status update',
  SHARED_WITH_CLIENT: 'Shared with client',
  SLA_REMINDER: 'Response reminder',
}

function prettyKind(raw: string, map: Record<string, string>): string {
  const known = map[raw]
  if (known) return known
  const t = raw.trim().toLowerCase()
  if (!t) return 'Update'
  return t
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/**
 * Extract ONLY jobId/applicationId from a notification's meta JSON.
 * Meta may carry recruiter-side context (actor names, internal flags) —
 * none of it belongs in the candidate's chat feed.
 */
function parseCandidateMeta(raw: string | null | undefined): {
  jobId?: string
  applicationId?: string
} {
  if (!raw) return {}
  try {
    const obj: unknown = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return {}
    const out: { jobId?: string; applicationId?: string } = {}
    const rec = obj as Record<string, unknown>
    if (typeof rec.jobId === 'string' && rec.jobId) out.jobId = rec.jobId
    if (typeof rec.applicationId === 'string' && rec.applicationId)
      out.applicationId = rec.applicationId
    return out
  } catch {
    return {}
  }
}

/** Collapse a mail body to plain single-line text, truncated server-side */
function flattenMailBody(raw: string, max = MAIL_BODY_MAX_CHARS): string {
  const flat = raw.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  return `${flat.slice(0, max - 1)}…`
}

function salaryBand(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  if (min != null && max != null) return `${min}\u2013${max} LPA`
  if (max != null) return `up to ${max} LPA`
  if (min != null) return `from ${min} LPA`
  return 'salary not disclosed'
}

function alertLabel(alert: { keyword: string; location: string }): string {
  const kw = alert.keyword.trim()
  if (kw) return kw
  const loc = alert.location.trim()
  if (loc) return loc
  return 'new jobs'
}

/** Case-insensitive substring — done in JS because SQLite `contains` is case-sensitive */
function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

// ---------------------------------------------------------------------------
// GET — merged chronological feed
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (user.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'This update feed is only available for candidate accounts' },
        { status: 403 }
      )
    }

    // a) Platform notifications (newest 100, re-ordered ascending)
    const notifications = await db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS_PER_SOURCE,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        meta: true,
        read: true,
        createdAt: true,
      },
    })

    // b) Process emails addressed to this user (informational — always "read")
    const mails = await db.emailLog.findMany({
      where: { toUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS_PER_SOURCE,
      select: { id: true, kind: true, subject: true, body: true, createdAt: true },
    })

    // c) Job-alert matches — one recent-jobs window covering every alert,
    //    per-alert filtering done in JS (SQLite contains is case-sensitive)
    const alerts = await db.jobAlert.findMany({
      where: { userId },
      select: {
        id: true,
        keyword: true,
        location: true,
        minSalaryLpa: true,
        lastSeenAt: true,
      },
    })

    const alertBubbles: FeedBubble[] = []
    if (alerts.length > 0) {
      const minCutoff = alerts.reduce<Date>(
        (acc, a) => (a.lastSeenAt < acc ? a.lastSeenAt : acc),
        alerts[0].lastSeenAt
      )
      const recentJobs = await db.job.findMany({
        where: { status: 'ACTIVE', createdAt: { gt: minCutoff } },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS_PER_SOURCE,
        select: {
          id: true,
          title: true,
          company: true,
          location: true,
          description: true,
          skills: true,
          salaryMinLpa: true,
          salaryMaxLpa: true,
          createdAt: true,
        },
      })

      for (const alert of alerts) {
        const kw = alert.keyword.trim()
        const loc = alert.location.trim()
        const matches = recentJobs
          .filter((j) => j.createdAt > alert.lastSeenAt)
          .filter((j) => {
            if (kw && !containsIgnoreCase(`${j.title} ${j.skills} ${j.description}`, kw))
              return false
            if (loc && !containsIgnoreCase(j.location, loc)) return false
            if (alert.minSalaryLpa != null && (j.salaryMaxLpa ?? 0) < alert.minSalaryLpa)
              return false
            return true
          })
          .slice(0, MAX_MATCHES_PER_ALERT)

        const label = alertLabel(alert)
        for (const j of matches) {
          alertBubbles.push({
            id: `alert-${alert.id}-${j.id}`,
            source: 'job-alert',
            kind: 'NEW_MATCH',
            title: `${j.title} \u00b7 ${j.company}`,
            body: `${j.location} \u00b7 ${salaryBand(j.salaryMinLpa, j.salaryMaxLpa)} \u00b7 matches your alert "${label}"`,
            jobId: j.id,
            alertId: alert.id,
            createdAt: j.createdAt.toISOString(),
            read: false,
          })
        }
      }
    }

    const platformBubbles: FeedBubble[] = notifications.map((n) => ({
      id: n.id,
      source: 'platform' as const,
      kind: prettyKind(n.type, NOTIF_KINDS),
      title: n.title,
      body: n.body,
      meta: parseCandidateMeta(n.meta),
      createdAt: n.createdAt.toISOString(),
      read: n.read,
    }))

    const mailBubbles: FeedBubble[] = mails.map((m) => ({
      id: m.id,
      source: 'mail' as const,
      kind: prettyKind(m.kind, MAIL_KINDS),
      title: m.subject,
      body: flattenMailBody(m.body),
      createdAt: m.createdAt.toISOString(),
      read: true, // mails are informational — they never count as unread
    }))

    const feed = [...platformBubbles, ...mailBubbles, ...alertBubbles].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )

    const unreadCount =
      platformBubbles.filter((b) => !b.read).length +
      alertBubbles.filter((b) => !b.read).length

    return NextResponse.json({
      data: { feed, unreadCount, generatedAt: new Date().toISOString() },
    })
  } catch (err) {
    console.error('GET /api/alerts/feed failed:', err)
    return NextResponse.json(
      { error: 'Failed to load the update feed' },
      { status: 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// POST — seen / seen-all
// ---------------------------------------------------------------------------

interface SeenBody {
  userId?: string
  action?: string
  ids?: unknown
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as SeenBody | null
    const userId = body?.userId
    const action = body?.action

    if (typeof userId !== 'string' || !userId.trim()) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    if (action !== 'seen' && action !== 'seen-all') {
      return NextResponse.json(
        { error: 'action must be "seen" or "seen-all"' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (user.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'This update feed is only available for candidate accounts' },
        { status: 403 }
      )
    }

    // Collect valid ids (deduped) when provided
    const rawIds: unknown[] = Array.isArray(body?.ids) ? body.ids : []
    const ids = Array.from(
      new Set(
        rawIds
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
          .map((x) => x.trim())
      )
    ).slice(0, MAX_SEEN_IDS)

    // seen-all, or seen with no ids: mark every notification read
    if (action === 'seen-all' || ids.length === 0) {
      const res = await db.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      })
      return NextResponse.json({ data: { marked: res.count, alertSeen: [] } })
    }

    // Split ids into notification ids vs job-alert bubble ids
    const notifCandidates: string[] = []
    const alertCandidates: string[] = []
    for (const id of ids) {
      const parts = id.split('-')
      if (parts.length >= 3 && parts[0] === 'alert') {
        alertCandidates.push(parts[1])
      } else {
        notifCandidates.push(id)
      }
    }

    // Notifications: ownership enforced in the where clause — foreign ids no-op
    let marked = 0
    if (notifCandidates.length > 0) {
      const res = await db.notification.updateMany({
        where: { id: { in: notifCandidates }, userId, read: false },
        data: { read: true },
      })
      marked = res.count
    }

    // Job alerts: only reset lastSeenAt on alerts owned by this user
    const alertSeen: string[] = []
    if (alertCandidates.length > 0) {
      const owned = await db.jobAlert.findMany({
        where: { id: { in: alertCandidates }, userId },
        select: { id: true },
      })
      if (owned.length > 0) {
        await db.jobAlert.updateMany({
          where: { id: { in: owned.map((a) => a.id) } },
          data: { lastSeenAt: new Date() },
        })
        alertSeen.push(...owned.map((a) => a.id))
      }
    }

    return NextResponse.json({ data: { marked, alertSeen } })
  } catch (err) {
    console.error('POST /api/alerts/feed failed:', err)
    return NextResponse.json(
      { error: 'Failed to update the feed' },
      { status: 500 }
    )
  }
}
