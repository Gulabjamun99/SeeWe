// SeeWe - /api/recruiters/folders
// Master spec §9 — recruiter-private candidate folders (a lightweight CRM on
// top of the talent database).
//
// GET  ?recruiterId=... → { data: folders[] } each
//      { id, name, createdAt, memberCount, memberUserIds } (recruiter-owned only).
// POST { recruiterId, name } → create (trimmed, 1-40 chars, unique per
//      recruiter; 409 on duplicate). 201 { data: folder }.

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const recruiterId = req.nextUrl.searchParams.get('recruiterId')
    const recruiter = await resolveRecruiter(recruiterId)
    if (!recruiter) {
      return NextResponse.json(
        { error: 'Recruiter access required' },
        { status: 403 }
      )
    }

    const folders = await db.candidateFolder.findMany({
      where: { recruiterId: recruiter.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        _count: { select: { members: true } },
        members: { select: { userId: true } },
      },
    })

    return NextResponse.json({
      data: folders.map(({ _count, members, ...f }) => ({
        ...f,
        memberCount: _count.members,
        memberUserIds: members.map((m) => m.userId),
      })),
    })
  } catch (err) {
    console.error('GET /api/recruiters/folders failed:', err)
    return NextResponse.json({ error: 'Failed to load folders' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const recruiter = await resolveRecruiter(body?.recruiterId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const rawName = typeof body?.name === 'string' ? body.name.trim() : ''
    if (rawName.length === 0) {
      return NextResponse.json({ error: 'Folder name is required' }, { status: 400 })
    }
    if (rawName.length > 40) {
      return NextResponse.json(
        { error: 'Folder name must be 40 characters or fewer' },
        { status: 400 }
      )
    }

    try {
      const folder = await db.candidateFolder.create({
        data: { recruiterId: recruiter.id, name: rawName },
        select: { id: true, name: true, createdAt: true },
      })
      return NextResponse.json({ data: { ...folder, memberCount: 0 } }, { status: 201 })
    } catch (err) {
      // Unique per recruiter → friendly 409 instead of a raw P2002.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json(
          { error: `You already have a folder named "${rawName}"` },
          { status: 409 }
        )
      }
      throw err
    }
  } catch (err) {
    console.error('POST /api/recruiters/folders failed:', err)
    return NextResponse.json({ error: 'Failed to create folder' }, { status: 500 })
  }
}
