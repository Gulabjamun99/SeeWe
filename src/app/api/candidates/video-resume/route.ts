// SeeWe - /api/candidates/video-resume
// The candidate's ~90-second video resume: upload (base64), metadata read and
// delete. The binary lives on disk under upload/interview-media/ (the same
// media store interview recordings use); SQLite keeps only the filename plus
// display metadata.
//
// ACCESS MODEL (this app has no server session — callers identify themselves):
// - POST / DELETE / GET operate ONLY on the {userId} caller's own record, and
//   that account must be a CANDIDATE. A candidate can therefore never read,
//   replace or delete another user's video through this endpoint.
// - Recruiters/clients never use this endpoint — they stream through
//   /api/candidates/video-resume/[file] with a recruiter viewerId.

import { NextRequest, NextResponse } from 'next/server'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const MEDIA_DIR = path.join(process.cwd(), 'upload', 'interview-media')
const MAX_VIDEO_BYTES = 8 * 1024 * 1024 // 8 MB decoded binary cap
const MAX_SECONDS = 90
const MAX_INTRO_CHARS = 160
const ALLOWED_MIME = ['video/webm', 'video/mp4'] as const
type AllowedMime = (typeof ALLOWED_MIME)[number]

// Defense-in-depth: only filenames this route generates may ever be unlinked.
const SAFE_NAME = /^video-resume-[A-Za-z0-9_-]+\.(webm|mp4)$/

/** Strip a data-URL prefix (if any) and decode base64 into bytes. */
function decodeBase64(value: string): Buffer | null {
  const commaIdx = value.indexOf(',')
  const raw = commaIdx !== -1 ? value.slice(commaIdx + 1) : value
  if (!raw) return null
  try {
    const buf = Buffer.from(raw, 'base64')
    return buf.length > 0 ? buf : null
  } catch {
    return null
  }
}

/** Remove a previous video file from disk. Never throws. */
async function removeOldVideo(filename: string | null | undefined): Promise<void> {
  if (!filename || !SAFE_NAME.test(filename)) return
  try {
    await unlink(path.join(MEDIA_DIR, filename))
  } catch {
    /* file already gone or unreadable — nothing to recover */
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, videoResumePath: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    if (user.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Only candidate accounts can manage a video resume' },
        { status: 403 }
      )
    }

    // ---- intro caption (shared by full uploads and caption-only edits) ----
    let intro: string | null = null
    if (body.intro !== undefined && body.intro !== null) {
      if (typeof body.intro !== 'string') {
        return NextResponse.json({ error: 'intro must be a string' }, { status: 400 })
      }
      const trimmed = body.intro.trim()
      if (trimmed.length > MAX_INTRO_CHARS) {
        return NextResponse.json(
          { error: `The caption must be ${MAX_INTRO_CHARS} characters or fewer` },
          { status: 400 }
        )
      }
      intro = trimmed === '' ? null : trimmed
    }

    // ---- caption-only edit: no binary, just update the intro line ----
    const hasData = typeof body.data === 'string' && body.data.length > 0
    if (!hasData) {
      if (!user.videoResumePath) {
        return NextResponse.json(
          { error: 'Record or upload a video first — there is nothing to caption yet' },
          { status: 400 }
        )
      }
      const updated = await db.user.update({
        where: { id: user.id },
        data: { videoResumeIntro: intro },
        select: {
          videoResumePath: true,
          videoResumeSeconds: true,
          videoResumeIntro: true,
          videoResumeUploadedAt: true,
        },
      })
      return NextResponse.json({
        data: {
          videoResumePath: updated.videoResumePath,
          seconds: updated.videoResumeSeconds,
          intro: updated.videoResumeIntro,
          uploadedAt: updated.videoResumeUploadedAt,
        },
      })
    }

    // ---- full upload: format allow-list ----
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : ''
    if (!ALLOWED_MIME.includes(mimeType as AllowedMime)) {
      return NextResponse.json(
        { error: 'Unsupported video format — record or upload a WebM or MP4 video' },
        { status: 400 }
      )
    }

    // ---- duration: honest + capped at 90s ----
    const secondsRaw = Number(body.seconds)
    if (!Number.isFinite(secondsRaw) || secondsRaw <= 0) {
      return NextResponse.json(
        { error: 'Could not confirm the video duration — please try recording it again' },
        { status: 400 }
      )
    }
    if (secondsRaw > MAX_SECONDS) {
      return NextResponse.json(
        { error: `Video is too long — the limit is ${MAX_SECONDS} seconds` },
        { status: 400 }
      )
    }
    const seconds = Math.round(secondsRaw * 10) / 10

    // ---- decode + size guard (8 MB binary) ----
    const buf = decodeBase64(body.data)
    if (!buf) {
      return NextResponse.json(
        { error: 'Video file is empty or unreadable — please try again' },
        { status: 400 }
      )
    }
    if (buf.length > MAX_VIDEO_BYTES) {
      return NextResponse.json(
        {
          error:
            'Video is too large — keep it under 8 MB (about 60–90 seconds at normal quality)',
        },
        { status: 413 }
      )
    }

    // ---- write to disk, then swap the DB pointer + clean the old file ----
    const ext = mimeType === 'video/mp4' ? 'mp4' : 'webm'
    const filename = `video-resume-${user.id}-${Date.now()}.${ext}`
    await mkdir(MEDIA_DIR, { recursive: true })
    await writeFile(path.join(MEDIA_DIR, filename), buf)

    const uploadedAt = new Date()
    await db.user.update({
      where: { id: user.id },
      data: {
        videoResumePath: filename,
        videoResumeSeconds: seconds,
        videoResumeIntro: intro,
        videoResumeUploadedAt: uploadedAt,
      },
    })

    // Replace flow: the previous take is deleted only after the new one is
    // safely on disk and the DB points at it.
    if (user.videoResumePath && user.videoResumePath !== filename) {
      await removeOldVideo(user.videoResumePath)
    }

    return NextResponse.json({
      data: {
        videoResumePath: filename,
        seconds,
        intro,
        uploadedAt,
      },
    })
  } catch (error) {
    console.error('[candidates/video-resume] POST failed:', error)
    return NextResponse.json({ error: 'Could not save the video resume' }, { status: 500 })
  }
}

// DELETE /api/candidates/video-resume?userId=... — owner-only removal
export async function DELETE(req: NextRequest) {
  try {
    const userId = (req.nextUrl.searchParams.get('userId') || '').trim()
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, videoResumePath: true },
    })
    if (!user) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    if (user.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Only candidate accounts can manage a video resume' },
        { status: 403 }
      )
    }

    if (user.videoResumePath) {
      await removeOldVideo(user.videoResumePath)
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        videoResumePath: null,
        videoResumeSeconds: null,
        videoResumeIntro: null,
        videoResumeUploadedAt: null,
      },
    })

    return NextResponse.json({ data: { cleared: true } })
  } catch (error) {
    console.error('[candidates/video-resume] DELETE failed:', error)
    return NextResponse.json({ error: 'Could not remove the video resume' }, { status: 500 })
  }
}

// GET /api/candidates/video-resume?userId=... — the owner's own metadata
export async function GET(req: NextRequest) {
  try {
    const userId = (req.nextUrl.searchParams.get('userId') || '').trim()
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        videoResumePath: true,
        videoResumeSeconds: true,
        videoResumeIntro: true,
        videoResumeUploadedAt: true,
      },
    })
    if (!user) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const hasVideo = Boolean(user.videoResumePath)
    return NextResponse.json({
      data: {
        hasVideo,
        seconds: hasVideo ? user.videoResumeSeconds : null,
        intro: hasVideo ? user.videoResumeIntro : null,
        uploadedAt: hasVideo ? user.videoResumeUploadedAt : null,
        streamUrl:
          hasVideo && user.videoResumePath
            ? `/api/candidates/video-resume/${user.videoResumePath}?userId=${encodeURIComponent(userId)}`
            : null,
      },
    })
  } catch (error) {
    console.error('[candidates/video-resume] GET failed:', error)
    return NextResponse.json({ error: 'Could not load the video resume' }, { status: 500 })
  }
}
