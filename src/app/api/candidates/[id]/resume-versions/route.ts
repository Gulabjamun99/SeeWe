// SeeWe - /api/candidates/[id]/resume-versions
//
// Master spec §6 — CV VERSION HISTORY. The candidate keeps multiple resume
// documents; the ACTIVE version is what the profile CV card shows and what
// gets snapshotted onto every application (mirrored into User.cv* fields).
//
//   GET  — list versions (metadata only — base64 bytes NEVER ride the list)
//   POST — add a new version { label, fileName, mimeType, data, note?, makeActive? }
//
// Auth pattern: identical to /api/candidates/[id]/photo + /cv — the candidate's
// own id comes from the SPA session store and rides in the path; binaries are
// never returned in JSON (they stream via /[versionId]/download).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateCvUpload } from '@/lib/cv'

export const dynamic = 'force-dynamic'

// Metadata select — `data` (base64) is deliberately omitted everywhere here
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

async function loadCandidate(id: string) {
  return db.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  })
}

// GET — list the candidate's resume versions (no file bytes)
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const candidate = await loadCandidate(id)
    if (!candidate || candidate.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const versions = await db.resumeVersion.findMany({
      where: { userId: id },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      select: VERSION_META_SELECT,
    })

    return NextResponse.json({ data: versions })
  } catch (err) {
    console.error('GET /api/candidates/[id]/resume-versions failed:', err)
    return NextResponse.json({ error: 'Failed to load CV versions' }, { status: 500 })
  }
}

// POST — add a new version (JSON body, no multipart)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const candidate = await loadCandidate(id)
    if (!candidate || candidate.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const label = typeof body?.label === 'string' ? body.label.trim() : ''
    const note = typeof body?.note === 'string' ? body.note.trim() : ''
    if (!label || label.length > 80) {
      return NextResponse.json(
        { error: 'A version label is required (max 80 characters), e.g. "Frontend-focused v2"' },
        { status: 400 }
      )
    }

    // Reuse the shared CV validator (mime whitelist, 4MB-after-decode cap,
    // magic-byte sniff) by wrapping the raw base64 into a data URL.
    const raw = typeof body?.data === 'string' ? body.data : ''
    const mimeType = typeof body?.mimeType === 'string' ? body.mimeType : ''
    const parsed = validateCvUpload({
      fileName: body?.fileName,
      mimeType,
      dataUrl: raw.startsWith('data:') ? raw : `data:${mimeType};base64,${raw}`,
    })
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const existingCount = await db.resumeVersion.count({ where: { userId: id } })
    // First version ever — or an explicit makeActive — becomes the active CV.
    const makeActive = existingCount === 0 || body?.makeActive === true

    const version = await db.$transaction(async (tx) => {
      const created = await tx.resumeVersion.create({
        data: {
          userId: id,
          label,
          fileName: parsed.cv.fileName,
          mimeType: parsed.cv.mimeType,
          data: parsed.cv.base64,
          sizeBytes: parsed.cv.bytes,
          isActive: makeActive,
          note: note || null,
        },
        select: VERSION_META_SELECT,
      })
      if (makeActive) {
        await tx.resumeVersion.updateMany({
          where: { userId: id, id: { not: created.id } },
          data: { isActive: false },
        })
        // Mirror into the profile CV — the exact document recruiters receive.
        await tx.user.update({
          where: { id },
          data: {
            cvFileName: created.fileName,
            cvMimeType: created.mimeType,
            cvData: parsed.cv.base64,
            cvUploadedAt: new Date(),
          },
        })
      }
      return created
    })

    return NextResponse.json({ data: version }, { status: 201 })
  } catch (err) {
    console.error('POST /api/candidates/[id]/resume-versions failed:', err)
    return NextResponse.json({ error: 'Failed to save CV version' }, { status: 500 })
  }
}
