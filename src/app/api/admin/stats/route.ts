import { NextRequest, NextResponse } from 'next/server'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { db } from '@/lib/db'
import { MEDIA_DIR } from '@/lib/media-inventory'

// SeeWe — Admin console stats (GET /api/admin/stats?adminId=…)
//
// AUTH NOTE (demo-auth model): this route implements the same light guard the
// rest of the platform uses — the caller passes its own user id and we verify
// it references an existing ADMIN account. There are no real sessions yet, so
// ids act as bearer tokens by design; real session auth is a documented
// next-round item (see worklog qa-production-audit-15).

const ERROR_MISSING_ID = 'Query param adminId is required'
const ERROR_NOT_FOUND = 'Account not found'
const ERROR_FORBIDDEN = 'Admin access required'
const ERROR_SERVER = 'Failed to load admin stats'

/** Sum of on-disk sizes of recorded answer clips (*.webm) under MEDIA_DIR. */
async function recordingsBytesTotal(): Promise<number> {
  try {
    const names = await readdir(MEDIA_DIR)
    let total = 0
    await Promise.all(
      names
        .filter((n) => n.endsWith('.webm'))
        .map(async (n) => {
          try {
            const s = await stat(path.join(MEDIA_DIR, n))
            if (s.isFile()) total += s.size
          } catch {
            /* file vanished mid-scan — skip */
          }
        })
    )
    return total
  } catch {
    return 0 // media dir missing entirely
  }
}

function countMap(rows: { key: string; count: number }[]): Record<string, number> {
  return rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.key] = r.count
    return acc
  }, {})
}

export async function GET(req: NextRequest) {
  try {
    const adminId = req.nextUrl.searchParams.get('adminId')
    if (!adminId || !adminId.trim()) {
      return NextResponse.json({ error: ERROR_MISSING_ID }, { status: 400 })
    }

    const admin = await db.user.findUnique({
      where: { id: adminId },
      select: { id: true, role: true },
    })
    if (!admin) {
      return NextResponse.json({ error: ERROR_NOT_FOUND }, { status: 404 })
    }
    if (admin.role !== 'ADMIN') {
      return NextResponse.json({ error: ERROR_FORBIDDEN }, { status: 403 })
    }

    // ---------- platform counts (all bounded) ----------
    const [
      usersTotal,
      usersByRoleRows,
      jobsTotal,
      jobsActive,
      applicationsTotal,
      applicationsByStatusRows,
      shortlistsTotal,
      shortlistsByStatusRows,
      interviewsTotal,
      interviewsCompleted,
      answersRecorded,
      clientsTotal,
      notificationsUnread,
      users,
      recentApplications,
      recentInterviews,
      recentNotifications,
      bytesTotal,
    ] = await Promise.all([
      db.user.count(),
      db.user.groupBy({ by: ['role'], _count: { _all: true } }),
      db.job.count(),
      db.job.count({ where: { status: 'ACTIVE' } }),
      db.application.count(),
      db.application.groupBy({ by: ['status'], _count: { _all: true } }),
      db.shortlist.count(),
      db.shortlist.groupBy({ by: ['status'], _count: { _all: true } }),
      db.interview.count(),
      db.interview.count({ where: { status: 'COMPLETED' } }),
      db.answer.count({ where: { mediaPath: { not: null } } }),
      db.client.count(),
      db.notification.count({ where: { read: false } }),

      // ---------- user directory (newest first, bounded) ----------
      db.user.findMany({
        orderBy: { createdAt: 'desc' as const },
        take: 100,
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          company: true,
          headline: true,
          location: true,
          createdAt: true,
        },
      }),

      // ---------- recent activity ----------
      db.application.findMany({
        orderBy: { createdAt: 'desc' as const },
        take: 8,
        select: {
          id: true,
          status: true,
          createdAt: true,
          candidate: { select: { name: true } },
          job: { select: { title: true, company: true } },
        },
      }),
      db.interview.findMany({
        where: { status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' as const },
        take: 8,
        select: {
          id: true,
          candidateName: true,
          jobTitle: true,
          overallScore: true,
          verdict: true,
          completedAt: true,
        },
      }),
      db.notification.findMany({
        orderBy: { createdAt: 'desc' as const },
        take: 8,
        select: { id: true, title: true, type: true, read: true, createdAt: true },
      }),
      recordingsBytesTotal(),
    ])

    const usersByRole = countMap(usersByRoleRows.map((r) => ({ key: r.role, count: r._count._all })))
    const applicationsByStatus = countMap(
      applicationsByStatusRows.map((r) => ({ key: r.status, count: r._count._all }))
    )
    const shortlistsByStatus = countMap(
      shortlistsByStatusRows.map((r) => ({ key: r.status, count: r._count._all }))
    )

    return NextResponse.json({
      data: {
        platform: {
          usersTotal,
          usersByRole,
          jobsTotal,
          jobsActive,
          applicationsTotal,
          applicationsByStatus,
          shortlistsTotal,
          shortlistsByStatus,
          interviewsTotal,
          interviewsCompleted,
          answersRecorded,
          recordingsBytesTotal: bytesTotal,
          clientsTotal,
          notificationsUnread,
          // Demo health: the idempotent seeder guarantees ≥10 users when run;
          // a lower count means the demo dataset was tampered with.
          demoHealth: {
            seededUsers: usersTotal >= 10,
            dbPath: 'sqlite',
          },
        },
        users: users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
        recent: {
          applications: recentApplications.map((a) => ({
            id: a.id,
            candidateName: a.candidate?.name ?? 'Unknown candidate',
            jobTitle: a.job?.title ?? 'Unknown job',
            company: a.job?.company ?? '',
            status: a.status,
            createdAt: a.createdAt.toISOString(),
          })),
          interviews: recentInterviews.map((iv) => ({
            id: iv.id,
            candidateName: iv.candidateName,
            jobTitle: iv.jobTitle,
            overallScore: iv.overallScore,
            verdict: iv.verdict,
            completedAt: iv.completedAt ? iv.completedAt.toISOString() : null,
          })),
          notifications: recentNotifications.map((n) => ({
            id: n.id,
            title: n.title,
            type: n.type,
            read: n.read,
            createdAt: n.createdAt.toISOString(),
          })),
        },
      },
    })
  } catch (err) {
    console.error('GET /api/admin/stats failed:', err)
    return NextResponse.json({ error: ERROR_SERVER }, { status: 500 })
  }
}
