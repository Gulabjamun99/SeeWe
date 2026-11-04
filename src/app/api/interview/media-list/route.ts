// SeeWe - /api/interview/media-list  (GET)
// Central recording inventory for recruiters: every recorded interview answer
// (video or audio) belonging to jobs posted by this recruiter.
//
// GET ?recruiterId=...   -> recordings scoped to that recruiter's jobs
// GET ?candidateId=...   -> recordings for that candidate's own interviews
// (no param -> 400; never leak the whole table)
//
// Each item carries the playback filename (consumed by the existing
// GET /api/interview/media/[file] streamer, which also supports ?download=1).
// The heavy lifting (scoped Prisma query + shaping) lives in
// src/lib/media-inventory.ts so media-zip and media-gc share the same logic.

import { NextResponse } from 'next/server'
import { listMediaItems } from '@/lib/media-inventory'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const recruiterId = searchParams.get('recruiterId')
    const candidateId = searchParams.get('candidateId')

    if (!recruiterId && !candidateId) {
      return NextResponse.json(
        { error: 'recruiterId or candidateId is required' },
        { status: 400 }
      )
    }

    const items = await listMediaItems(
      recruiterId ? { recruiterId } : { candidateId: candidateId as string }
    )

    return NextResponse.json({ data: items })
  } catch (error) {
    console.error('[interview/media-list][GET] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to list recordings' }, { status: 500 })
  }
}
