import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/* ------------------------------------------------------------------ */
/* Guild detail + membership                                           */
/* GET  /api/guilds/[id]?userId=… → guild, latest 30 posts (with the   */
/*                                 newest 10 replies each), my state   */
/* POST /api/guilds/[id]          → {userId, action:'join'|'leave'}    */
/* ------------------------------------------------------------------ */

export const dynamic = 'force-dynamic'

/** Guild payload fields are author name + headline ONLY — no emails,
 * employers, phone numbers or any other private user data. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const userId = req.nextUrl.searchParams.get('userId')

    const guild = await db.referralGuild.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        focus: true,
        description: true,
        guidelines: true,
        isPublic: true,
        createdAt: true,
        createdBy: { select: { name: true } },
        _count: { select: { members: true, posts: true } },
      },
    })
    if (!guild) {
      return NextResponse.json({ error: 'Guild not found' }, { status: 404 })
    }

    if (userId) {
      const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
    }

    const posts = await db.guildPost.findMany({
      where: { guildId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        jobTitle: true,
        companyName: true,
        createdAt: true,
        author: { select: { name: true, headline: true } },
        _count: { select: { replies: true } },
        replies: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          select: {
            id: true,
            body: true,
            createdAt: true,
            author: { select: { name: true } },
          },
        },
      },
    })

    // Replies are fetched newest-first for the take-10 window, but a thread
    // reads oldest → newest.
    const mappedPosts = posts.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      body: p.body,
      jobTitle: p.jobTitle,
      companyName: p.companyName,
      authorName: p.author.name,
      authorHeadline: p.author.headline,
      createdAt: p.createdAt,
      replyCount: p._count.replies,
      replies: p.replies
        .slice()
        .reverse()
        .map((r) => ({
          id: r.id,
          body: r.body,
          authorName: r.author.name,
          createdAt: r.createdAt,
        })),
    }))

    let myMembership: { joined: boolean; role: string | null } = {
      joined: false,
      role: null,
    }
    if (userId) {
      const membership = await db.guildMembership.findUnique({
        where: { guildId_userId: { guildId: id, userId } },
        select: { role: true },
      })
      if (membership) myMembership = { joined: true, role: membership.role }
    }

    return NextResponse.json({
      data: {
        guild: {
          id: guild.id,
          name: guild.name,
          slug: guild.slug,
          focus: guild.focus,
          description: guild.description,
          guidelines: guild.guidelines,
          isPublic: guild.isPublic,
          createdAt: guild.createdAt,
          createdByName: guild.createdBy.name,
          memberCount: guild._count.members,
          postCount: guild._count.posts,
        },
        posts: mappedPosts,
        myMembership,
      },
    })
  } catch (err) {
    console.error('GET /api/guilds/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to load guild' }, { status: 500 })
  }
}

/* --------------------------------- POST -------------------------------- */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { userId, action } = (body ?? {}) as { userId?: unknown; action?: unknown }

    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    if (action !== 'join' && action !== 'leave') {
      return NextResponse.json(
        { error: "action must be 'join' or 'leave'" },
        { status: 400 }
      )
    }

    const guild = await db.referralGuild.findUnique({
      where: { id },
      select: { id: true, name: true, guidelines: true },
    })
    if (!guild) {
      return NextResponse.json({ error: 'Guild not found' }, { status: 404 })
    }

    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const existing = await db.guildMembership.findUnique({
      where: { guildId_userId: { guildId: id, userId } },
      select: { id: true, role: true },
    })

    if (action === 'join') {
      if (existing) {
        // Idempotent join — already a member, nothing to change.
        return NextResponse.json({
          data: {
            joined: true,
            role: existing.role,
            alreadyMember: true,
            guidelines: guild.guidelines,
          },
        })
      }
      await db.guildMembership.create({ data: { guildId: id, userId, role: 'MEMBER' } })
      return NextResponse.json({
        data: {
          joined: true,
          role: 'MEMBER',
          alreadyMember: false,
          guidelines: guild.guidelines,
        },
      })
    }

    // leave — LEADs may leave too; the guild itself survives.
    if (!existing) {
      return NextResponse.json(
        { error: 'You are not a member of this guild' },
        { status: 400 }
      )
    }
    await db.guildMembership.delete({ where: { id: existing.id } })
    return NextResponse.json({ data: { joined: false } })
  } catch (err) {
    console.error('POST /api/guilds/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to update membership' }, { status: 500 })
  }
}
