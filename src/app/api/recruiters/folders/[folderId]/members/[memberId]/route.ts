// SeeWe - /api/recruiters/folders/[folderId]/members/[memberId]
// Master spec §9 — update or remove one folder membership.
//
// PATCH  { recruiterId, tags?, note? } → update the member's tags/note
//        (at least one field required). 404 unknown member, 403 foreign folder.
// DELETE ?recruiterId=... → remove the member from the folder.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  resolveRecruiter,
  assertOwnedFolder,
  normaliseTags,
  normaliseNote,
} from '@/lib/folder-guards'

export const dynamic = 'force-dynamic'

async function loadMemberGuarded(
  folderId: string,
  memberId: string,
  recruiterId: string
): Promise<
  | { ok: true; member: { id: string; folderId: string; userId: string } }
  | { ok: false; status: 403 | 404; error: string }
> {
  const guard = await assertOwnedFolder(folderId, recruiterId)
  if (!guard.ok) return guard
  if (typeof memberId !== 'string' || memberId.trim().length === 0) {
    return { ok: false, status: 404, error: 'Member not found' }
  }
  const member = await db.candidateFolderMember.findUnique({
    where: { id: memberId.trim() },
    select: { id: true, folderId: true, userId: true },
  })
  if (!member || member.folderId !== guard.folder.id) {
    return { ok: false, status: 404, error: 'Member not found in this folder' }
  }
  return { ok: true, member }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ folderId: string; memberId: string }> }
) {
  try {
    const { folderId, memberId } = await params
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null

    const recruiter = await resolveRecruiter(body?.recruiterId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const guarded = await loadMemberGuarded(folderId, memberId, recruiter.id)
    if (!guarded.ok) {
      return NextResponse.json({ error: guarded.error }, { status: guarded.status })
    }

    const tagsRes = normaliseTags(body?.tags)
    const noteRes = normaliseNote(body?.note)
    if (!tagsRes.ok || !noteRes.ok) {
      return NextResponse.json(
        { error: 'tags and note must be strings or null' },
        { status: 400 }
      )
    }
    if (tagsRes.value === undefined && noteRes.value === undefined) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const member = await db.candidateFolderMember.update({
      where: { id: guarded.member.id },
      data: {
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

    return NextResponse.json({ data: member })
  } catch (err) {
    console.error('PATCH /api/recruiters/folders/[folderId]/members/[memberId] failed:', err)
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ folderId: string; memberId: string }> }
) {
  try {
    const { folderId, memberId } = await params
    const recruiter = await resolveRecruiter(req.nextUrl.searchParams.get('recruiterId'))
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const guarded = await loadMemberGuarded(folderId, memberId, recruiter.id)
    if (!guarded.ok) {
      return NextResponse.json({ error: guarded.error }, { status: guarded.status })
    }

    await db.candidateFolderMember.delete({ where: { id: guarded.member.id } })

    return NextResponse.json({ data: { ok: true, id: guarded.member.id } })
  } catch (err) {
    console.error('DELETE /api/recruiters/folders/[folderId]/members/[memberId] failed:', err)
    return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
  }
}
