// SeeWe - /api/candidates/[id]/resume-versions/[versionId]/download
//
// Streams one stored CV version with its original Content-Type and a
// Content-Disposition attachment header (decode base64 → binary buffer).
// ?inline=1 previews the document in the browser instead of downloading.
//
// Authorization: the owning candidate (id in the path, same pattern as
// /api/candidates/[id]/cv) OR any RECRUITER/ADMIN — hiring teams may download
// candidate CVs (mirrors /api/applications/[id]/cv which recruiters use).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { MAX_CV_BYTES } from '@/lib/cv'

export const dynamic = 'force-dynamic'

export async function GET(
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

    // Recruiter/admin download support: an optional requesterId query param
    // lets hiring-team surfaces prove their role; the owning candidate needs
    // no extra proof (their own id rides the path, same as the photo/cv routes).
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

    const version = await db.resumeVersion.findFirst({
      where: { id: versionId, userId: id },
      select: { fileName: true, mimeType: true, data: true },
    })
    if (!version) {
      return NextResponse.json({ error: 'CV version not found' }, { status: 404 })
    }

    const buf = Buffer.from(version.data, 'base64')
    if (buf.length === 0 || buf.length > MAX_CV_BYTES * 2) {
      return NextResponse.json({ error: 'Stored CV version is unreadable' }, { status: 500 })
    }

    const inline = req.nextUrl.searchParams.get('inline') === '1'
    const safeName = version.fileName.replace(/["\\\r\n]/g, '_')
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': version.mimeType || 'application/octet-stream',
        'Content-Length': String(buf.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (err) {
    console.error('GET /api/candidates/[id]/resume-versions/[versionId]/download failed:', err)
    return NextResponse.json({ error: 'Failed to load CV version' }, { status: 500 })
  }
}
