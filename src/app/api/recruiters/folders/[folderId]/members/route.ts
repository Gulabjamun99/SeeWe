// SeeWe - /api/recruiters/folders/[folderId]/members
// Master spec §9 — add (or upsert) a candidate into a recruiter-owned folder.
//
// POST { recruiterId, userId, tags?, note? } → upsert on the unique
//      (folderId, userId) pair: re-adding an existing member refreshes their
//      tags/note. 201 both times (idempotent per pair).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  resolveRecruiter,
  assertOwnedFolder,
  normaliseTags,
  normaliseNote,
} from '@/lib/folder-guards'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ folderId: string }> }
) {
  try {
    const { folderId } = await params
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

    const recruiter = await resolveRecruiter(body?.recruiterId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const guard = await assertOwnedFolder(folderId, recruiter.id)
    if (!guard.ok) {
      return NextResponse.json({ error: guard.error }, { status: guard.status })
    }

    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const candidate = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!candidate || candidate.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const tagsRes = normaliseTags(body?.tags)
    const noteRes = normaliseNote(body?.note)
    if (!tagsRes.ok || !noteRes.ok) {
      return NextResponse.json(
        { error: 'tags and note must be strings or null' },
        { status: 400 }
      )
    }

    const member = await db.candidateFolderMember.upsert({
      where: {
        folderId_userId: { folderId: guard.folder.id, userId: candidate.id },
      },
      create: {
        folderId: guard.folder.id,
        userId: candidate.id,
        tags: tagsRes.value ?? null,
        note: noteRes.value ?? null,
      },
      update: {
        // Re-adding refreshes the metadata; the membership itself stays put.
        ...(tagsRes.value !== undefined ? { tags: tagsRes.value } : {}),
        ...(noteRes.value !== undefined ? { note: noteRes.value } : {}),
      },
      select: {
        id: true,
        folderId: true,
        userId: true,
        tags: true,
        note: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ data: member }, { status: 201 })
  } catch (err) {
    console.error('POST /api/recruiters/folders/[folderId]/members failed:', err)
    return NextResponse.json({ error: 'Failed to add candidate to folder' }, { status: 500 })
  }
}
