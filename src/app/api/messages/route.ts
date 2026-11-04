// SeeWe - /api/messages
// Direct 1:1 messaging between a candidate and a recruiter.
//
// GET    ?userId=&peerId=  → full thread (both directions, oldest→newest, cap 300)
// POST   {senderId, recipientId, body, jobId?} → send one message (+ notification)
// PATCH  {userId, peerId}  → mark every peer→userId message as read
//
// Threads are keyed by a deterministic sorted "userA|userB" pair so both sides
// always land on the same conversation. Only CANDIDATE ↔ RECRUITER pairs are
// allowed — the app has no client/admin direct-chat surface by design.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CHAT_ROLES = ['CANDIDATE', 'RECRUITER'] as const
const MAX_BODY = 2000
const THREAD_CAP = 300

function threadKeyOf(a: string, b: string): string {
  return [a, b].sort().join('|')
}

/** Basic peer shape shared by GET and POST responses. */
function peerSelect() {
  return {
    id: true,
    name: true,
    role: true,
    headline: true,
    company: true,
    photoData: true,
    photoMime: true,
    avatarSeed: true,
    disabled: true,
  } as const
}

/** Shape a stored user row into the light peer card used by the client. */
function peerCard(u: {
  id: string
  name: string
  role: string
  headline: string | null
  company: string | null
  photoData: string | null
  photoMime: string | null
  avatarSeed: string | null
  disabled: boolean
}) {
  return {
    id: u.id,
    name: u.name,
    role: u.role,
    headline: u.headline,
    company: u.company,
    avatarUrl:
      u.photoData && u.photoMime ? `data:${u.photoMime};base64,${u.photoData}` : null,
    avatarSeed: u.avatarSeed,
    disabled: u.disabled,
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = (searchParams.get('userId') ?? '').trim()
    const peerId = (searchParams.get('peerId') ?? '').trim()
    if (!userId || !peerId) {
      return NextResponse.json({ error: 'userId and peerId are required' }, { status: 400 })
    }
    if (userId === peerId) {
      return NextResponse.json({ error: 'Cannot message yourself' }, { status: 400 })
    }

    const [me, peer] = await Promise.all([
      db.user.findUnique({ where: { id: userId }, select: peerSelect() }),
      db.user.findUnique({ where: { id: peerId }, select: peerSelect() }),
    ])
    if (!me || !peer) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const key = threadKeyOf(userId, peerId)
    const messages = await db.message.findMany({
      where: { threadKey: key },
      orderBy: { createdAt: 'asc' },
      take: THREAD_CAP,
      select: {
        id: true,
        senderId: true,
        recipientId: true,
        body: true,
        jobId: true,
        read: true,
        createdAt: true,
      },
    })

    // Attach job context chips (title+company) for messages that carry a jobId
    const jobIds = Array.from(new Set(messages.map((m) => m.jobId).filter(Boolean))) as string[]
    const jobs = jobIds.length
      ? await db.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, title: true, company: true },
        })
      : []
    const jobById = new Map(jobs.map((j) => [j.id, j]))

    return NextResponse.json({
      data: {
        peer: peerCard(peer),
        messages: messages.map((m) => ({
          id: m.id,
          mine: m.senderId === userId,
          body: m.body,
          read: m.read,
          createdAt: m.createdAt,
          job: m.jobId ? (jobById.get(m.jobId) ?? null) : null,
        })),
      },
    })
  } catch (err) {
    console.error('[messages GET] failed:', err)
    return NextResponse.json({ error: 'Failed to load thread' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      senderId?: unknown
      recipientId?: unknown
      body?: unknown
      jobId?: unknown
    }

    const senderId = typeof body.senderId === 'string' ? body.senderId.trim() : ''
    const recipientId = typeof body.recipientId === 'string' ? body.recipientId.trim() : ''
    const text = typeof body.body === 'string' ? body.body.trim() : ''
    const jobId = typeof body.jobId === 'string' && body.jobId.trim() ? body.jobId.trim() : null

    if (!senderId || !recipientId) {
      return NextResponse.json({ error: 'senderId and recipientId are required' }, { status: 400 })
    }
    if (senderId === recipientId) {
      return NextResponse.json({ error: 'Cannot message yourself' }, { status: 400 })
    }
    if (text.length < 1 || text.length > MAX_BODY) {
      return NextResponse.json({ error: `Message must be 1-${MAX_BODY} characters` }, { status: 400 })
    }

    const [sender, recipient] = await Promise.all([
      db.user.findUnique({
        where: { id: senderId },
        select: { id: true, name: true, role: true, disabled: true },
      }),
      db.user.findUnique({
        where: { id: recipientId },
        select: { id: true, name: true, role: true, disabled: true },
      }),
    ])
    if (!sender || !recipient) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (sender.disabled || recipient.disabled) {
      return NextResponse.json({ error: 'Account is disabled' }, { status: 403 })
    }
    if (!CHAT_ROLES.includes(sender.role as (typeof CHAT_ROLES)[number])) {
      return NextResponse.json({ error: 'Only candidates and recruiters can message' }, { status: 403 })
    }
    if (!CHAT_ROLES.includes(recipient.role as (typeof CHAT_ROLES)[number])) {
      return NextResponse.json({ error: 'Recipient must be a candidate or recruiter' }, { status: 400 })
    }
    if (sender.role === recipient.role) {
      return NextResponse.json(
        { error: 'Direct chat is candidate ↔ recruiter only' },
        { status: 400 }
      )
    }
    if (jobId) {
      const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true } })
      if (!job) return NextResponse.json({ error: 'Anchored job not found' }, { status: 400 })
    }

    const message = await db.message.create({
      data: {
        threadKey: threadKeyOf(senderId, recipientId),
        senderId,
        recipientId,
        body: text,
        jobId,
      },
      select: { id: true, senderId: true, recipientId: true, body: true, jobId: true, read: true, createdAt: true },
    })

    // Notify the recipient (non-fatal — the message itself must never fail
    // because the notification did)
    try {
      await db.notification.create({
        data: {
          userId: recipientId,
          type: 'MESSAGE',
          title: `${sender.name} sent you a message`,
          body: text.slice(0, 140),
          meta: JSON.stringify({ peerId: senderId, peerName: sender.name, messageId: message.id }),
        },
      })
    } catch (err) {
      console.error('[messages POST] notification failed (non-fatal):', err)
    }

    return NextResponse.json({ data: { ...message, mine: true } }, { status: 201 })
  } catch (err) {
    console.error('[messages POST] failed:', err)
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      userId?: unknown
      peerId?: unknown
    }
    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    const peerId = typeof body.peerId === 'string' ? body.peerId.trim() : ''
    if (!userId || !peerId) {
      return NextResponse.json({ error: 'userId and peerId are required' }, { status: 400 })
    }

    const result = await db.message.updateMany({
      where: { threadKey: threadKeyOf(userId, peerId), recipientId: userId, read: false },
      data: { read: true },
    })
    return NextResponse.json({ data: { markedRead: result.count } })
  } catch (err) {
    console.error('[messages PATCH] failed:', err)
    return NextResponse.json({ error: 'Failed to mark read' }, { status: 500 })
  }
}
