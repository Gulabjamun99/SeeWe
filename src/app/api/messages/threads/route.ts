// SeeWe - /api/messages/threads
// GET ?userId= → inbox for one user:
//   threads[]        — every candidate↔recruiter conversation, newest first,
//                      with peer card, last-message preview and unread count
//   suggestedPeers[] — up to 8 reachable people with no thread yet
//                      (candidate → recruiters of jobs they applied to;
//                       recruiter → candidates who applied to their jobs)
//                      so "New message" always has sensible starters.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const SUGGESTION_CAP = 8

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

type PeerRow = {
  id: string
  name: string
  role: string
  headline: string | null
  company: string | null
  photoData: string | null
  photoMime: string | null
  avatarSeed: string | null
  disabled: boolean
}

function peerCard(u: PeerRow) {
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

function preview(body: string): string {
  const t = (body ?? '').replace(/\s+/g, ' ').trim()
  return t.length > 90 ? `${t.slice(0, 90)}…` : t
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = (searchParams.get('userId') ?? '').trim()
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const me = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, disabled: true },
    })
    if (!me) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // --- 1) Existing threads -------------------------------------------------
    const msgs = await db.message.findMany({
      where: { OR: [{ senderId: userId }, { recipientId: userId }] },
      orderBy: { createdAt: 'asc' },
      select: {
        senderId: true,
        recipientId: true,
        body: true,
        read: true,
        createdAt: true,
      },
    })

    const byPeer = new Map<
      string,
      { last: { body: string; createdAt: Date; mine: boolean; read: boolean }; unread: number }
    >()
    for (const m of msgs) {
      const peerId = m.senderId === userId ? m.recipientId : m.senderId
      const mine = m.senderId === userId
      const entry = byPeer.get(peerId) ?? { last: { body: '', createdAt: new Date(0), mine: true, read: true }, unread: 0 }
      entry.last = { body: m.body, createdAt: m.createdAt, mine, read: m.read }
      if (!mine && !m.read) entry.unread += 1
      byPeer.set(peerId, entry)
    }

    const peerIds = Array.from(byPeer.keys())
    const peers = peerIds.length
      ? await db.user.findMany({ where: { id: { in: peerIds } }, select: peerSelect() })
      : []
    const peerById = new Map(peers.map((p) => [p.id, p]))

    const threads = Array.from(byPeer.entries())
      .map(([peerId, agg]) => {
        const peer = peerById.get(peerId)
        if (!peer) return null // user deleted (cascade should prevent, defensive)
        return {
          peer: peerCard(peer),
          lastMessage: {
            preview: preview(agg.last.body),
            createdAt: agg.last.createdAt,
            mine: agg.last.mine,
            read: agg.last.read,
          },
          unread: agg.unread,
        }
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          new Date(b!.lastMessage.createdAt).getTime() -
          new Date(a!.lastMessage.createdAt).getTime()
      )

    // --- 2) Suggested new contacts (no thread yet, opposite chat role) -------
    let suggestedPeers: ReturnType<typeof peerCard>[] = []
    if (me.role === 'CANDIDATE') {
      const apps = await db.application.findMany({
        where: { candidateId: userId },
        select: { job: { select: { recruiterId: true } } },
        take: 60,
        orderBy: { createdAt: 'desc' },
      })
      const recruiterIds = Array.from(
        new Set(apps.map((a) => a.job.recruiterId).filter((id) => !byPeer.has(id)))
      ).slice(0, SUGGESTION_CAP)
      if (recruiterIds.length) {
        const rows = await db.user.findMany({
          where: { id: { in: recruiterIds }, role: 'RECRUITER', disabled: false },
          select: peerSelect(),
        })
        suggestedPeers = rows.map(peerCard)
      }
    } else if (me.role === 'RECRUITER') {
      const apps = await db.application.findMany({
        where: { job: { recruiterId: userId } },
        select: { candidateId: true },
        take: 60,
        orderBy: { createdAt: 'desc' },
      })
      const candidateIds = Array.from(
        new Set(apps.map((a) => a.candidateId).filter((id) => !byPeer.has(id)))
      ).slice(0, SUGGESTION_CAP)
      if (candidateIds.length) {
        const rows = await db.user.findMany({
          where: { id: { in: candidateIds }, role: 'CANDIDATE', disabled: false },
          select: peerSelect(),
        })
        suggestedPeers = rows.map(peerCard)
      }
    }

    return NextResponse.json({ data: { threads, suggestedPeers } })
  } catch (err) {
    console.error('[messages/threads GET] failed:', err)
    return NextResponse.json({ error: 'Failed to load inbox' }, { status: 500 })
  }
}
