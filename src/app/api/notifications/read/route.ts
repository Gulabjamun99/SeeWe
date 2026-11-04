import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type ReadBody = {
  userId?: string
  id?: string // mark one read
  all?: boolean // mark every notification read
}

/**
 * POST /api/notifications/read
 * Body: { userId, id } to mark one, or { userId, all: true } to mark all.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as ReadBody | null
    if (!body?.userId || typeof body.userId !== 'string') {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    // Strict boolean: a truthy string like "false" must NOT mark all read
    if (body.all === true) {
      const res = await db.notification.updateMany({
        where: { userId: body.userId, read: false },
        data: { read: true },
      })
      return NextResponse.json({ data: { updated: res.count } })
    }

    if (!body.id) {
      return NextResponse.json({ error: 'Provide id or all:true' }, { status: 400 })
    }

    // Ownership guard: users can only mark their own notifications
    const existing = await db.notification.findUnique({ where: { id: body.id } })
    if (!existing || existing.userId !== body.userId) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }
    await db.notification.update({ where: { id: body.id }, data: { read: true } })
    return NextResponse.json({ data: { updated: 1 } })
  } catch (err) {
    console.error('POST /api/notifications/read failed:', err)
    return NextResponse.json(
      { error: 'Failed to update notification' },
      { status: 500 }
    )
  }
}
