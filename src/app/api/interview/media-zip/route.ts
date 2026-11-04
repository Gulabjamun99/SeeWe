// SeeWe - /api/interview/media-zip  (GET)
// Bulk download: bundles recordings into a single ZIP so recruiters can
// archive footage in one click instead of downloading answer-by-answer —
// and clients can save the recordings of a report shared with them.
//
// RECRUITER / CANDIDATE mode:
// GET ?recruiterId=...            -> all recordings for this recruiter's jobs
// GET ?candidateId=...            -> a candidate's own recordings
//      &kind=video|audio          -> optional type filter
//      &candidateName=...         -> optional exact-name filter (recruiter UI)
// Zip layout:
//   01-Meghna-Pillai-Q1.webm          (numbered, candidate+question names)
//   manifest.txt                      (context per file: job, score, verdict)
//
// CLIENT PORTAL mode:
// GET ?clientId=...&shortlistId=... -> the recordings of ONE report shared
//      with that client (its completed interview's video/audio answers).
//      AUTH NOTE: `clientId` acts as the portal credential — the same trust
//      model as /api/client-portal, consistent with the existing demo-auth
//      design (real session auth is the documented next-round item).
//      Guards: client 404 -> shortlist 404 -> "not shared with your account"
//      403 -> interview missing/not COMPLETED 409.
// Zip layout: same numbered filename pattern as the recruiter ZIP plus a
//   manifest.json (one entry per file: candidate, job, question, score,
//   takeLabel, recordedAt proxy) and SKIPPED notes for capped/missing files.
//
// Files are stored uncompressed (webm is already compressed) for speed.
// JSZip cannot read from disk itself — each file is loaded as a Buffer first.
// Byte bounds: 25 MB per file and a 150 MB archive ceiling keep the buffer
// bounded; oversized clips are noted as SKIPPED in the manifest.

import { NextRequest, NextResponse } from 'next/server'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { db } from '@/lib/db'
import { MEDIA_DIR, listMediaItems, slugifyName } from '@/lib/media-inventory'

// Byte bounds: hundreds of unbounded clips could OOM the process.
const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 150 * 1024 * 1024
const SAFE_FILE_RE = /^[A-Za-z0-9_-]+\.webm$/ // defensive: only our generated names

/**
 * CLIENT PORTAL mode — one shared report's recordings.
 * `clientId` is the portal credential (see header AUTH NOTE).
 */
async function buildClientZip(
  clientId: string | null,
  shortlistId: string | null
): Promise<NextResponse> {
  if (!clientId || !shortlistId) {
    return NextResponse.json(
      { error: 'clientId and shortlistId are both required for a client download' },
      { status: 400 }
    )
  }

  const client = await db.client.findUnique({ where: { id: clientId } })
  if (!client) {
    return NextResponse.json({ error: 'Client not found' }, { status: 404 })
  }

  const shortlist = await db.shortlist.findUnique({
    where: { id: shortlistId },
    select: {
      clientId: true,
      application: {
        select: {
          candidate: { select: { name: true } },
          job: { select: { title: true, company: true } },
        },
      },
      interview: {
        select: {
          id: true,
          status: true,
          candidateName: true,
          jobTitle: true,
          completedAt: true,
          startedAt: true,
          createdAt: true,
          answers: {
            where: { mediaPath: { not: null } },
            select: {
              qIndex: true,
              question: true,
              score: true,
              mediaPath: true,
              mediaKind: true,
              mediaSeconds: true,
            },
            orderBy: { qIndex: 'asc' },
          },
        },
      },
    },
  })
  if (!shortlist) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }
  if (shortlist.clientId !== clientId) {
    return NextResponse.json(
      { error: 'This report is not shared with your account' },
      { status: 403 }
    )
  }
  const interview = shortlist.interview
  if (!interview || interview.status !== 'COMPLETED') {
    return NextResponse.json(
      { error: 'The interview for this report has not completed yet' },
      { status: 409 }
    )
  }

  // takeLabel was added to the schema after this server process loaded its
  // Prisma client (same DMMF-staleness rationale as the raw SQL in
  // /api/clients for mediaRetentionDays) — read it raw, keyed by qIndex.
  const takeRows = await db.$queryRaw<{ qIndex: number; takeLabel: string | null }[]>`
    SELECT "qIndex", "takeLabel" FROM "Answer"
    WHERE "interviewId" = ${interview.id} AND "takeLabel" IS NOT NULL`
  const takeByQIndex = new Map(takeRows.map((r) => [r.qIndex, r.takeLabel ?? null]))

  const items = interview.answers.filter((a) => Boolean(a.mediaPath))
  if (items.length === 0) {
    return NextResponse.json(
      { error: 'No recordings are attached to this report' },
      { status: 404 }
    )
  }
  // sanity bound — mirrors the recruiter mode
  if (items.length > 200) {
    return NextResponse.json(
      { error: 'Too many recordings in one archive — narrow the filters and try again.' },
      { status: 413 }
    )
  }

  const candidateName =
    shortlist.application?.candidate?.name ?? interview.candidateName
  const jobTitle = shortlist.application?.job?.title ?? interview.jobTitle
  const company = shortlist.application?.job?.company ?? ''
  // Answer rows carry no timestamp — the interview's completion (or start)
  // time is the best available "recorded at" proxy (same as the inventory).
  const recordedAt = interview.completedAt ?? interview.startedAt ?? interview.createdAt
  const recordedAtIso = recordedAt ? new Date(recordedAt).toISOString() : null

  const zip = new JSZip()
  const manifest: {
    file: string
    candidateName: string
    jobTitle: string
    qIndex: number
    question: string
    score: number | null
    takeLabel: string | null
    mediaKind: string
    mediaSeconds: number | null
    recordedAt: string | null
  }[] = []
  const skipped: { qIndex: number; question: string; reason: string }[] = []
  let archiveBytes = 0
  let added = 0

  for (const a of items) {
    const mediaFile = a.mediaPath as string
    if (!SAFE_FILE_RE.test(mediaFile)) {
      skipped.push({ qIndex: a.qIndex, question: a.question, reason: 'unrecognised file name' })
      continue
    }
    const full = path.join(MEDIA_DIR, mediaFile)
    let st
    try {
      st = await stat(full)
    } catch {
      // file missing on disk (already GC'd) — note it in the manifest, keep going
      skipped.push({ qIndex: a.qIndex, question: a.question, reason: 'missing on disk (may have been cleaned up)' })
      continue
    }
    if (st.size > MAX_FILE_BYTES || archiveBytes + st.size > MAX_ARCHIVE_BYTES) {
      skipped.push({ qIndex: a.qIndex, question: a.question, reason: 'too large for archive' })
      continue
    }
    const buf = await readFile(full)
    archiveBytes += buf.length
    added++
    const file = `${String(added).padStart(2, '0')}-${slugifyName(candidateName)}-Q${
      a.qIndex + 1
    }.webm`
    zip.file(file, buf)
    manifest.push({
      file,
      candidateName,
      jobTitle,
      qIndex: a.qIndex,
      question: a.question,
      score: a.score ?? null,
      takeLabel: takeByQIndex.get(a.qIndex) ?? null,
      mediaKind: a.mediaKind === 'audio' ? 'audio' : 'video',
      mediaSeconds: a.mediaSeconds ?? null,
      recordedAt: recordedAtIso,
    })
  }

  if (added === 0) {
    return NextResponse.json(
      {
        error:
          'Recordings are listed in the database but their files are no longer on disk (they may have been cleaned up).',
      },
      { status: 404 }
    )
  }

  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        client: client.name,
        candidateName,
        jobTitle,
        company: company || null,
        recordings: manifest,
        skipped,
      },
      null,
      2
    )
  )

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE', // webm is already compressed; STORE is fast
  })

  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `SeeWe-recordings-${slugifyName(candidateName)}-${stamp}.zip`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const recruiterId = searchParams.get('recruiterId')
    const candidateId = searchParams.get('candidateId')
    const clientId = searchParams.get('clientId')
    const shortlistId = searchParams.get('shortlistId')

    // CLIENT PORTAL mode takes precedence when either client param is present
    if (clientId || shortlistId) {
      return await buildClientZip(clientId, shortlistId)
    }

    if (!recruiterId && !candidateId) {
      return NextResponse.json(
        { error: 'recruiterId or candidateId is required' },
        { status: 400 }
      )
    }

    const kind = searchParams.get('kind')
    const kindFilter = kind === 'video' || kind === 'audio' ? kind : null
    const candidateName = searchParams.get('candidateName')?.trim() || null

    let items = await listMediaItems(
      recruiterId ? { recruiterId } : { candidateId: candidateId as string }
    )
    if (kindFilter) items = items.filter((it) => it.mediaKind === kindFilter)
    if (candidateName) items = items.filter((it) => it.candidateName === candidateName)

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'No recordings match this selection' },
        { status: 404 }
      )
    }
    // sanity bound — a zip of thousands of clips would blow memory
    if (items.length > 200) {
      return NextResponse.json(
        { error: 'Too many recordings in one archive — narrow the filters and try again.' },
        { status: 413 }
      )
    }
    let archiveBytes = 0

    const zip = new JSZip()
    const manifest: string[] = [
      'SeeWe — AI Hiring Suite · Recording archive',
      `Generated: ${new Date().toISOString()}`,
      `Clips: ${items.length}`,
      '',
    ]

    let added = 0
    for (const it of items) {
      if (!SAFE_FILE_RE.test(it.mediaFile)) continue // defensive: only our generated names
      const full = path.join(MEDIA_DIR, it.mediaFile)
      let st
      try {
        st = await stat(full)
      } catch {
        // file missing on disk (already GC'd) — note it in the manifest, keep going
        manifest.push(
          `SKIPPED (missing on disk): Q${it.qIndex + 1} · ${it.candidateName} — ${it.question}`,
          ''
        )
        continue
      }
      if (st.size > MAX_FILE_BYTES || archiveBytes + st.size > MAX_ARCHIVE_BYTES) {
        // Oversized clip would blow the memory budget — note & skip
        manifest.push(
          `SKIPPED (too large for archive): Q${it.qIndex + 1} · ${it.candidateName} — ${it.question}`,
          ''
        )
        continue
      }
      const buf = await readFile(full)
      archiveBytes += buf.length
      added++
      zip.file(
        `${String(added).padStart(2, '0')}-${slugifyName(it.candidateName)}-Q${
          it.qIndex + 1
        }.webm`,
        buf
      )
      manifest.push(
        `${String(added).padStart(2, '0')}. ${it.candidateName} — ${it.jobTitle}${
          it.company ? ` (${it.company})` : ''
        }`,
        `    Q${it.qIndex + 1}: ${it.question}`,
        `    Kind: ${it.mediaKind} · Duration: ${it.mediaSeconds ?? '?'}s · Score: ${
          typeof it.score === 'number' ? `${it.score.toFixed(1)}/10` : '—'
        } · Verdict: ${it.verdict ?? '—'}`,
        `    Recorded: ${it.recordedAt ?? 'unknown'}`,
        ''
      )
    }

    if (added === 0) {
      return NextResponse.json(
        {
          error:
            'Recordings are listed in the database but their files are no longer on disk (they may have been cleaned up).',
        },
        { status: 404 }
      )
    }
    zip.file('manifest.txt', manifest.join('\n'))

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'STORE', // webm is already compressed; STORE is fast
    })

    const stamp = new Date().toISOString().slice(0, 10)
    const label = candidateName ? `-${slugifyName(candidateName)}` : ''
    const filename = `SeeWe-recordings${label}-${stamp}.zip`

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('[interview/media-zip][GET] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to build recordings archive' }, { status: 500 })
  }
}
