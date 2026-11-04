// SeeWe - /api/candidates/[id]/cv
//
// The candidate's attached CV document (the actual file recruiters receive):
//   POST   — upload/replace the CV (JSON body: fileName, mimeType, dataUrl)
//   DELETE — remove the CV from the profile
//   GET    — stream the stored file (?inline=1 previews PDFs in the browser,
//            otherwise it downloads with the original file name)
//
// The binary never touches the filesystem — it lives base64-encoded in SQLite
// and is re-hydrated here. Only the metadata (cvFileName/cvMimeType/
// cvUploadedAt, never the bytes) rides in normal profile payloads.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateCvUpload, MAX_CV_BYTES } from '@/lib/cv'

const CV_META_SELECT = {
  cvFileName: true,
  cvMimeType: true,
  cvUploadedAt: true,
}

async function loadCandidate(id: string) {
  const user = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, ...CV_META_SELECT, cvData: true },
  })
  return user
}

// POST — upload or replace the profile CV
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await loadCandidate(id)
    if (!existing || existing.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const parsed = validateCvUpload(body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        cvFileName: parsed.cv.fileName,
        cvMimeType: parsed.cv.mimeType,
        cvData: parsed.cv.base64,
        cvUploadedAt: new Date(),
      },
      select: CV_META_SELECT,
    })

    return NextResponse.json({
      data: { ...updated, sizeBytes: parsed.cv.bytes },
    })
  } catch (err) {
    console.error('POST /api/candidates/[id]/cv failed:', err)
    return NextResponse.json({ error: 'Failed to upload CV' }, { status: 500 })
  }
}

// DELETE — remove the profile CV
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await loadCandidate(id)
    if (!existing || existing.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }
    await db.user.update({
      where: { id },
      data: { cvFileName: null, cvMimeType: null, cvData: null, cvUploadedAt: null },
    })
    return NextResponse.json({ data: { removed: true } })
  } catch (err) {
    console.error('DELETE /api/candidates/[id]/cv failed:', err)
    return NextResponse.json({ error: 'Failed to remove CV' }, { status: 500 })
  }
}

// GET — stream the stored CV document
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await loadCandidate(id)
    if (!user || user.role !== 'CANDIDATE' || !user.cvData || !user.cvFileName) {
      return NextResponse.json({ error: 'No CV attached to this profile' }, { status: 404 })
    }

    // Authorization: the owning candidate (id in the path, same pattern as
    // the photo route) OR any RECRUITER/ADMIN — hiring teams may download
    // candidate CVs. A requester claiming another identity must prove a
    // hiring-team role (mirrors the resume-versions download route).
    const requesterId = req.nextUrl.searchParams.get('requesterId')
    if (requesterId && requesterId !== id) {
      const requester = await db.user.findUnique({
        where: { id: requesterId },
        select: { role: true },
      })
      if (!requester || (requester.role !== 'RECRUITER' && requester.role !== 'ADMIN')) {
        return NextResponse.json(
          { error: 'Only the owning candidate or hiring-team members can download this CV' },
          { status: 403 }
        )
      }
    }

    const buf = Buffer.from(user.cvData, 'base64')
    if (buf.length === 0 || buf.length > MAX_CV_BYTES * 2) {
      return NextResponse.json({ error: 'Stored CV is unreadable' }, { status: 500 })
    }

    const inline = req.nextUrl.searchParams.get('inline') === '1'
    const safeName = user.cvFileName.replace(/["\\\r\n]/g, '_')

    // audit trail: hiring-team downloads of candidate CVs are logged
    // (best effort — never break the download itself)
    if (requesterId && requesterId !== id) {
      try {
        await db.usageLog.create({
          data: {
            actorId: requesterId,
            kind: 'CV_DOWNLOAD',
            meta: JSON.stringify({ candidateId: id, fileName: safeName, inline }),
          },
        })
      } catch {
        /* best effort */
      }
    }

    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': user.cvMimeType || 'application/octet-stream',
        'Content-Length': String(buf.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (err) {
    console.error('GET /api/candidates/[id]/cv failed:', err)
    return NextResponse.json({ error: 'Failed to load CV' }, { status: 500 })
  }
}
