// SeeWe - /api/candidates/[id]/resume-versions/[versionId]
//
// Per-version lifecycle for the CV version history (master spec §6):
//   PATCH  — { makeActive: true } → activates this version, deactivates the
//            others and mirrors its file into User.cv* (the profile CV).
//   DELETE — removes the version; when the deleted one was active the profile
//            CV is left untouched unless no versions remain (then cleared).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const VERSION_META_SELECT = {
  id: true,
  label: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  isActive: true,
  note: true,
  createdAt: true,
} as const

/** Load a version scoped to the owning candidate (path id). */
async function loadOwnedVersion(userId: string, versionId: string) {
  return db.resumeVersion.findFirst({
    where: { id: versionId, userId },
    select: { id: true, userId: true },
  })
}

// PATCH — activate a version (switch back to an older CV)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const { id, versionId } = await params
    const candidate = await db.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    })
    if (!candidate || candidate.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const owned = await loadOwnedVersion(id, versionId)
    if (!owned) {
      return NextResponse.json({ error: 'CV version not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    if (body?.makeActive !== true) {
      return NextResponse.json(
        { error: 'Only { makeActive: true } is supported' },
        { status: 400 }
      )
    }

    const version = await db.$transaction(async (tx) => {
      const activated = await tx.resumeVersion.update({
        where: { id: versionId },
        data: { isActive: true },
        select: { ...VERSION_META_SELECT, data: true },
      })
      await tx.resumeVersion.updateMany({
        where: { userId: id, id: { not: versionId } },
        data: { isActive: false },
      })
      // Mirror into the profile CV so recruiters/applications keep receiving
      // exactly the document the candidate activated.
      await tx.user.update({
        where: { id },
        data: {
          cvFileName: activated.fileName,
          cvMimeType: activated.mimeType,
          cvData: activated.data,
          cvUploadedAt: new Date(),
        },
      })
      const { data: _data, ...meta } = activated
      return meta
    })

    return NextResponse.json({ data: version })
  } catch (err) {
    console.error('PATCH /api/candidates/[id]/resume-versions/[versionId] failed:', err)
    return NextResponse.json({ error: 'Failed to activate CV version' }, { status: 500 })
  }
}

// DELETE — remove a version
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  try {
    const { id, versionId } = await params
    const candidate = await db.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    })
    if (!candidate || candidate.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const owned = await db.resumeVersion.findFirst({
      where: { id: versionId, userId: id },
      select: { id: true, isActive: true },
    })
    if (!owned) {
      return NextResponse.json({ error: 'CV version not found' }, { status: 404 })
    }

    await db.resumeVersion.delete({ where: { id: versionId } })

    let remaining = 0
    if (owned.isActive) {
      // Active one deleted: keep User.cv* as-is while other versions remain
      // (the profile CV is a snapshot, it still exists), but clear it when the
      // candidate has no versions left at all.
      remaining = await db.resumeVersion.count({ where: { userId: id } })
      if (remaining === 0) {
        await db.user.update({
          where: { id },
          data: { cvFileName: null, cvMimeType: null, cvData: null, cvUploadedAt: null },
        })
      }
    }

    return NextResponse.json({ data: { deleted: true, remainingVersions: remaining } })
  } catch (err) {
    console.error('DELETE /api/candidates/[id]/resume-versions/[versionId] failed:', err)
    return NextResponse.json({ error: 'Failed to delete CV version' }, { status: 500 })
  }
}
