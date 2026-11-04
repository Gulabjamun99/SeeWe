// SeeWe - GET /api/candidates/video-resume/[file]
// Streams a candidate's video resume from disk with HTTP Range support so
// <video> seeking works. Filenames are generated server-side
// (`video-resume-{userId}-{ts}.webm|mp4`); a strict character allow-list plus
// a resolved-path check blocks any traversal attempt.
//
// ACCESS CONTROL (this app has no server session — identity comes from query
// params and is verified against DB ownership):
// - ?userId= of the OWNING candidate  → owner playback (the owner id must
//   match the user whose videoResumePath points at this exact file).
// - ?viewerId= of a RECRUITER / CLIENT / ADMIN → recruiter playback.
// - A CANDIDATE viewerId that is not the owner → 403. Unknown ids → 403.
// - Files no longer referenced by any user's videoResumePath (replaced
//   uploads) are never served → 404.

import { NextResponse } from 'next/server'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const MEDIA_DIR = path.join(process.cwd(), 'upload', 'interview-media')

// Only our own generated names can pass: prefix, id-ish body, timestamp, ext.
const SAFE_NAME = /^video-resume-[A-Za-z0-9_-]+\.(webm|mp4)$/

const RECRUITER_ROLES = new Set(['RECRUITER', 'CLIENT', 'ADMIN'])

function contentTypeFor(file: string): string {
  return file.endsWith('.mp4') ? 'video/mp4' : 'video/webm'
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ file: string }> }
) {
  try {
    const { file } = await params

    if (!SAFE_NAME.test(file)) {
      return NextResponse.json({ error: 'Invalid media filename' }, { status: 400 })
    }

    const filePath = path.join(MEDIA_DIR, file)
    if (!filePath.startsWith(MEDIA_DIR + path.sep)) {
      return NextResponse.json({ error: 'Invalid media path' }, { status: 400 })
    }

    // Ownership: the file must still be the current video of SOME candidate.
    const owner = await db.user.findFirst({
      where: { videoResumePath: file },
      select: { id: true, role: true },
    })
    if (!owner) {
      return NextResponse.json(
        { error: 'Video not found (it may have been replaced or removed).' },
        { status: 404 }
      )
    }

    // ---- decide who is asking ----
    const url = new URL(request.url)
    const userId = (url.searchParams.get('userId') || '').trim()
    const viewerId = (url.searchParams.get('viewerId') || '').trim()

    let allowed = false
    if (userId && userId === owner.id) {
      // Owner playback — the candidate watching their own video resume.
      allowed = true
    } else if (viewerId) {
      if (viewerId === owner.id) {
        allowed = true
      } else {
        const viewer = await db.user.findUnique({
          where: { id: viewerId },
          select: { role: true },
        })
        // Unknown viewer or a candidate trying to watch someone else's video.
        allowed = Boolean(viewer && RECRUITER_ROLES.has(viewer.role))
      }
    }

    if (!allowed) {
      return NextResponse.json(
        { error: 'You are not allowed to view this video resume' },
        { status: 403 }
      )
    }

    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch {
      return NextResponse.json(
        { error: 'Video not found (it may have been removed from storage).' },
        { status: 404 }
      )
    }
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: 'Not a media file' }, { status: 404 })
    }

    const size = fileStat.size
    const range = request.headers.get('range')

    const baseHeaders: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'Content-Type': contentTypeFor(file),
    }

    if (range) {
      const match = /bytes=(\d*)-(\d*)/.exec(range)
      if (match) {
        const start = match[1] ? parseInt(match[1], 10) : 0
        const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1
        if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
          return new NextResponse(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` },
          })
        }
        const nodeStream = createReadStream(filePath, { start, end })
        return new NextResponse(
          Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>,
          {
            status: 206,
            headers: {
              ...baseHeaders,
              'Content-Range': `bytes ${start}-${end}/${size}`,
              'Content-Length': String(end - start + 1),
            },
          }
        )
      }
    }

    const nodeStream = createReadStream(filePath)
    return new NextResponse(
      Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>,
      {
        status: 200,
        headers: { ...baseHeaders, 'Content-Length': String(size) },
      }
    )
  } catch (error) {
    console.error('[candidates/video-resume/file] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to load video resume' }, { status: 500 })
  }
}
