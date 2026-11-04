import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/* ------------------------------------------------------------------ */
/* Guild posts                                                         */
/* POST /api/guilds/[id]/posts → create a post (members only)          */
/* Body: {userId, kind: REFERRAL|ASK|UPDATE, title, body,            */
/*        jobTitle?, companyName?}                                    */
/* ------------------------------------------------------------------ */

export const dynamic = 'force-dynamic'

const POST_KINDS = ['REFERRAL', 'ASK', 'UPDATE'] as const
type PostKind = (typeof POST_KINDS)[number]

function isPostKind(value: unknown): value is PostKind {
  return typeof value === 'string' && (POST_KINDS as readonly string[]).includes(value)
}

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

    const { userId, kind, title, body: postBody, jobTitle, companyName } = (body ?? {}) as {
      userId?: unknown
      kind?: unknown
      title?: unknown
      body?: unknown
      jobTitle?: unknown
      companyName?: unknown
    }

    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    if (!isPostKind(kind)) {
      return NextResponse.json(
        { error: 'kind must be REFERRAL, ASK or UPDATE' },
        { status: 400 }
      )
    }
    if (typeof title !== 'string' || title.trim().length < 5 || title.trim().length > 120) {
      return NextResponse.json(
        { error: 'Title must be 5-120 characters' },
        { status: 400 }
      )
    }
    if (typeof postBody !== 'string' || postBody.trim().length < 10 || postBody.trim().length > 2000) {
      return NextResponse.json(
        { error: 'Post body must be 10-2000 characters' },
        { status: 400 }
      )
    }

    const cleanJobTitle =
      typeof jobTitle === 'string' && jobTitle.trim().length > 0 ? jobTitle.trim() : null
    if (cleanJobTitle && cleanJobTitle.length > 120) {
      return NextResponse.json(
        { error: 'Job title must be 120 characters or fewer' },
        { status: 400 }
      )
    }
    const cleanCompanyName =
      typeof companyName === 'string' && companyName.trim().length > 0
        ? companyName.trim()
        : null
    if (cleanCompanyName && cleanCompanyName.length > 120) {
      return NextResponse.json(
        { error: 'Company name must be 120 characters or fewer' },
        { status: 400 }
      )
    }

    const guild = await db.referralGuild.findUnique({ where: { id }, select: { id: true } })
    if (!guild) {
      return NextResponse.json({ error: 'Guild not found' }, { status: 404 })
    }

    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, headline: true } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const membership = await db.guildMembership.findUnique({
      where: { guildId_userId: { guildId: id, userId } },
      select: { id: true },
    })
    if (!membership) {
      return NextResponse.json({ error: 'Join the guild to post' }, { status: 403 })
    }

    const post = await db.guildPost.create({
      data: {
        guildId: id,
        authorId: userId,
        kind,
        title: title.trim(),
        body: postBody.trim(),
        jobTitle: cleanJobTitle,
        companyName: cleanCompanyName,
      },
      select: {
        id: true,
        kind: true,
        title: true,
        body: true,
        jobTitle: true,
        companyName: true,
        createdAt: true,
      },
    })

    return NextResponse.json(
      {
        data: {
          post: {
            ...post,
            authorName: user.name,
            authorHeadline: user.headline,
            replyCount: 0,
            replies: [],
          },
        },
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('POST /api/guilds/[id]/posts failed:', err)
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
  }
}
