// GET /api/talent/usage?recruiterId=... — the sourcing usage & quota panel.
// Returns today's consumption per tracked kind against the platform quotas,
// plus the last 20 sourcing activity entries (newest first).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'
import { TALENT_QUOTAS, type QuotaKind } from '@/lib/talent-config'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const recruiterId = req.nextUrl.searchParams.get('recruiterId')
    const recruiter = await resolveRecruiter(recruiterId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const since = new Date()
    since.setHours(0, 0, 0, 0)

    const todays = await db.usageLog.groupBy({
      by: ['kind'],
      where: { actorId: recruiter.id, createdAt: { gte: since } },
      _count: { _all: true },
    })

    const usedByKind = new Map<string, number>()
    for (const row of todays) usedByKind.set(row.kind, row._count._all)

    const quotas = (Object.keys(TALENT_QUOTAS) as QuotaKind[]).map((kind) => ({
      kind,
      label: kind
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      used: usedByKind.get(kind) || 0,
      limit: TALENT_QUOTAS[kind],
    }))

    const recent = await db.usageLog.findMany({
      where: { actorId: recruiter.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, kind: true, meta: true, createdAt: true },
    })

    return NextResponse.json({ data: { quotas, recent, since: since.toISOString() } })
  } catch (err) {
    console.error('GET /api/talent/usage failed:', err)
    return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 })
  }
}
