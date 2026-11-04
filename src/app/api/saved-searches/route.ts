// /api/saved-searches — saved searches + talent alerts.
//
// GET  ?recruiterId=...        → the recruiter's saved searches, newest first
// POST { recruiterId, name, query, alertFrequency } → create (409 on dup name)
//
// `query` is the FULL serialized filter state (JSON string) so a saved search
// reruns exactly. `newCount` is recomputed on run (see /api/saved-searches/[id]
// POST) by comparing candidate ids seen now vs the snapshot recorded at the
// last run.

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'

export const dynamic = 'force-dynamic'

const ALERT_FREQUENCIES = new Set(['OFF', 'DAILY', 'WEEKLY'])

export async function GET(req: NextRequest) {
  try {
    const recruiter = await resolveRecruiter(req.nextUrl.searchParams.get('recruiterId'))
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }
    const saved = await db.savedSearch.findMany({
      where: { recruiterId: recruiter.id },
      orderBy: { updatedAt: 'desc' },
    })
    return NextResponse.json({ data: saved })
  } catch (err) {
    console.error('GET /api/saved-searches failed:', err)
    return NextResponse.json({ error: 'Failed to load saved searches' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const recruiter = await resolveRecruiter(body?.recruiterId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    if (name.length === 0 || name.length > 60) {
      return NextResponse.json({ error: 'Name must be 1-60 characters' }, { status: 400 })
    }
    const rawQuery = body?.query
    if (typeof rawQuery !== 'string' || rawQuery.length > 8000) {
      return NextResponse.json({ error: 'query must be a JSON string (≤8000 chars)' }, { status: 400 })
    }
    try {
      const parsed = JSON.parse(rawQuery)
      if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    } catch {
      return NextResponse.json({ error: 'query must be valid JSON' }, { status: 400 })
    }
    const alertFrequency = typeof body?.alertFrequency === 'string' && ALERT_FREQUENCIES.has(body.alertFrequency)
      ? body.alertFrequency
      : 'OFF'

    try {
      const saved = await db.savedSearch.create({
        data: {
          recruiterId: recruiter.id,
          name,
          query: rawQuery,
          alertFrequency,
        },
      })
      return NextResponse.json({ data: saved }, { status: 201 })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: `You already have a search named "${name}"` }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    console.error('POST /api/saved-searches failed:', err)
    return NextResponse.json({ error: 'Failed to save search' }, { status: 500 })
  }
}
