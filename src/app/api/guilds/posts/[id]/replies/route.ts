import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/* ------------------------------------------------------------------ */
/* Guild post replies                                                  */
/* POST /api/guilds/posts/[id]/replies → reply to a post (members      */
/* of the parent guild only). Body: {userId, body}                     */
/* ------------------------------------------------------------------ */

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    let payload: unknown
    try {
      payload = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { userId, body } = (payload ?? {}) as { userId?: unknown; body?: unknown }

    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    if (typeof body !== 'string' || body.trim().length < 2 || body.trim().length > 1000) {
      return NextResponse.json(
        { error: 'Reply must be 2-1000 characters' },
        { status: 400 }
      )
    }

    const post = await db.guildPost.findUnique({
      where: { id },
      select: { id: true, guildId: true, authorId: true, title: true },
    })
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const membership = await db.guildMembership.findUnique({
      where: { guildId_userId: { guildId: post.guildId, userId } },
      select: { id: true },
    })
    if (!membership) {
      return NextResponse.json({ error: 'Join the guild to reply' }, { status: 403 })
    }

    const reply = await db.guildReply.create({
      data: {
        postId: id,
        authorId: userId,
        body: body.trim(),
      },
      select: { id: true, body: true, createdAt: true },
    })

    // Notify the post author (QA queue item) — non-fatal by contract: a failed
    // notification must never break the reply itself. Self-replies don't notify.
    if (post.authorId && post.authorId !== userId) {
      try {
        await db.notification.create({
          data: {
            userId: post.authorId,
            type: 'GUILD_REPLY',
            title: `${user.name} replied to your post`,
            body: `“${body.trim().slice(0, 120)}${body.trim().length > 120 ? '…' : ''}”`,
            meta: JSON.stringify({
              postId: post.id,
              replyId: reply.id,
              guildId: post.guildId,
              actorName: user.name,
              postTitle: post.title ?? '',
            }),
          },
        })
      } catch (notifErr) {
        console.error('[guild replies] notification failed (non-fatal):', notifErr)
      }
    }

    return NextResponse.json(
      {
        data: {
          reply: {
            ...reply,
            authorName: user.name,
          },
        },
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('POST /api/guilds/posts/[id]/replies failed:', err)
    return NextResponse.json({ error: 'Failed to create reply' }, { status: 500 })
  }
}
