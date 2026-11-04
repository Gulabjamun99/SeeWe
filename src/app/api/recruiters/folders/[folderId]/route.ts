// SeeWe - /api/recruiters/folders/[folderId]
// Master spec §9 — one recruiter-owned candidate folder.
//
// GET    ?recruiterId=... → { data: folder with members[] } each member
//        { id, tags, note, createdAt, candidate: { id, name, headline, skills,
//        experienceYears, location, avatarSeed, photoData, photoMime } }.
//        Ownership enforced: folder.recruiterId must equal the caller (403).
// DELETE ?recruiterId=... → cascade-deletes the folder and its members.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRecruiter, assertOwnedFolder } from '@/lib/folder-guards'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
) {
  try {
    const { folderId } = await params
    const recruiter = await resolveRecruiter(req.nextUrl.searchParams.get('recruiterId'))
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const guard = await assertOwnedFolder(folderId, recruiter.id)
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const members = await db.candidateFolderMember.findMany({
      where: { folderId: guard.folder.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        tags: true,
        note: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            headline: true,
            skills: true,
            experienceYears: true,
            location: true,
            avatarSeed: true,
            // Avatar-size base64 photo (capped small at upload time) so member
            // cards can show the real photo; falls back to avatarSeed initials.
            photoData: true,
            photoMime: true,
          },
        },
      },
    })

    return NextResponse.json({
      data: {
        id: guard.folder.id,
        name: guard.folder.name,
        createdAt: guard.folder.createdAt,
        memberCount: members.length,
        members: members.map(({ user, ...m }) => ({
          ...m,
          candidate: user,
        })),
      },
    })
  } catch (err) {
    console.error('GET /api/recruiters/folders/[folderId] failed:', err)
    return NextResponse.json({ error: 'Failed to load folder' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
) {
  try {
    const { folderId } = await params
    const recruiter = await resolveRecruiter(req.nextUrl.searchParams.get('recruiterId'))
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const guard = await assertOwnedFolder(folderId, recruiter.id)
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    // Members cascade via the schema's onDelete: Cascade.
    await db.candidateFolder.delete({ where: { id: guard.folder.id } })

    return NextResponse.json({ data: { ok: true, id: guard.folder.id } })
  } catch (err) {
    console.error('DELETE /api/recruiters/folders/[folderId] failed:', err)
    return NextResponse.json({ error: 'Failed to delete folder' }, { status: 500 })
  }
}
