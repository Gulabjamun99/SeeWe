// SeeWe - GET /api/interview/media/[file]
// Streams a recorded interview answer (webm video/audio) from disk with HTTP
// Range support so <video> seeking works. `?download=1` switches the response
// to an attachment with a human-friendly filename (candidate + question),
// resolved from the DB. Filenames are generated server-side
// (`{interviewId}-q{n}-{ts}.webm`); a strict character allow-list plus a
// resolved-path check blocks any traversal attempt.

import { NextResponse } from 'next/server'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { db } from '@/lib/db'

const MEDIA_DIR = path.join(process.cwd(), 'upload', 'interview-media')

// Only our own generated names can pass: cuid-ish id, q index, timestamp
const SAFE_NAME = /^[A-Za-z0-9_-]+\.webm$/
// `{interviewId}-q{n}-{ts}.webm` — id is greedy (may contain hyphens)
const PARSE_NAME = /^(.+)-q(\d+)-(\d+)\.webm$/

/** Keep only filename-safe chars, collapse the rest to dashes */
function slugify(raw: string, max = 40): string {
  const slug = raw
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug || 'interview'
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

    let fileStat
    try {
      fileStat = await stat(filePath)
    } catch {
      return NextResponse.json(
        { error: 'Recording not found (it may have been recorded before media storage was enabled, or the file was cleaned up).' },
        { status: 404 }
      )
    }
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: 'Not a media file' }, { status: 404 })
    }

    // SECURITY (audit verify-1): recordings are private to the candidate who
    // answered, the recruiter who owns the job, and the client the report was
    // shared with. A leaked filename alone must never stream the video.
    const viewerId = new URL(request.url).searchParams.get('viewerId')
    const ownership = PARSE_NAME.exec(file)
    if (ownership) {
      const interview = await db.interview.findUnique({
        where: { id: ownership[1] },
        select: {
          shortlist: {
            select: {
              clientId: true,
              application: {
                select: { candidateId: true, job: { select: { recruiterId: true } } },
              },
            },
          },
        },
      })
      let authorized = false
      if (viewerId && interview) {
        const candId = interview.shortlist?.application?.candidateId ?? null
        const recId = interview.shortlist?.application?.job?.recruiterId ?? null
        const clientId = interview.shortlist?.clientId ?? null
        if (viewerId === candId || viewerId === recId) authorized = true
        else if (clientId) {
          const viewer = await db.user.findUnique({
            where: { id: viewerId },
            select: { role: true, clientId: true },
          })
          if (viewer?.role === 'CLIENT' && viewer.clientId === clientId) authorized = true
        }
      }
      if (!authorized) {
        return NextResponse.json(
          { error: 'Not authorized to view this recording' },
          { status: 403 }
        )
      }
    }

    const size = fileStat.size
    const range = request.headers.get('range')
    const url = new URL(request.url)
    const wantsDownload = url.searchParams.get('download') === '1'

    // Human-friendly attachment filename: SeeWe-{candidate}-{job}-Q{n}.webm
    let downloadName: string | null = null
    if (wantsDownload) {
      const parsed = PARSE_NAME.exec(file)
      if (parsed) {
        const [, interviewId, qRaw] = parsed
        const qNum = parseInt(qRaw, 10)
        try {
          const interview = await db.interview.findUnique({
            where: { id: interviewId },
            select: { candidateName: true, jobTitle: true },
          })
          downloadName = `SeeWe-${slugify(interview?.candidateName ?? 'candidate')}-${slugify(
            interview?.jobTitle ?? ''
          )}-Q${qNum + 1}.webm`
        } catch {
          downloadName = `SeeWe-interview-Q${qNum + 1}.webm`
        }
      } else {
        downloadName = file
      }
    }

    const baseHeaders: Record<string, string> = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
      ...(downloadName
        ? { 'Content-Disposition': `attachment; filename="${downloadName}"` }
        : {}),
    }

    // Audio-only answers (mic fallback) must not be labelled video/webm —
    // some browsers then render a black video element for them.
    let mediaKind: string | null = null
    try {
      const answer = await db.answer.findFirst({
        where: { mediaPath: file },
        select: { mediaKind: true },
      })
      mediaKind = answer?.mediaKind ?? null
    } catch {
      mediaKind = null
    }
    baseHeaders['Content-Type'] = mediaKind === 'audio' ? 'audio/webm' : 'video/webm'

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
    console.error('[interview/media] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to load recording' }, { status: 500 })
  }
}
