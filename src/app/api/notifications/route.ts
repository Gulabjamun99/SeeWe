import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/notifications?userId=...&limit=20
 * Returns the user's latest notifications + unread count.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const userId = sp.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    const limitRaw = Number(sp.get('limit') ?? 20)
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 50) : 20

    const [items, unread] = await Promise.all([
      db.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' as const },
        take: limit,
      }),
      db.notification.count({ where: { userId, read: false } }),
    ])

    return NextResponse.json({ data: { notifications: items, unread } })
  } catch (err) {
    console.error('GET /api/notifications failed:', err)
    return NextResponse.json(
      { error: 'Failed to load notifications' },
      { status: 500 }
    )
  }
}
