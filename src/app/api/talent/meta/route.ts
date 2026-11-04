// GET /api/talent/meta?recruiterId=... — dropdown/facet metadata for the
// Filter rail: distinct industries, functional areas, locations,
// employers and languages actually present in the visible candidate pool.
// "Only expose filters supported by actual stored data" — this endpoint is
// how the UI discovers them.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'

export const dynamic = 'force-dynamic'

function tally(values: (string | null | undefined)[], cap: number): { value: string; count: number }[] {
  const m = new Map<string, number>()
  for (const raw of values) {
    const v = (raw || '').trim()
    if (!v) continue
    m.set(v, (m.get(v) || 0) + 1)
  }
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([value, count]) => ({ value, count }))
}

export async function GET(req: NextRequest) {
  try {
    const recruiterId = req.nextUrl.searchParams.get('recruiterId')
    const recruiter = await resolveRecruiter(recruiterId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const users = await db.user.findMany({
      where: { role: 'CANDIDATE', profileVisible: true, disabled: false },
      select: {
        industry: true,
        functionalArea: true,
        location: true,
        currentEmployer: true,
        languages: true,
      },
    })

    const languages = new Map<string, number>()
    for (const u of users) {
      for (const l of (u.languages || '').split(',')) {
        const v = l.trim()
        if (!v) continue
        languages.set(v, (languages.get(v) || 0) + 1)
      }
    }

    return NextResponse.json({
      data: {
        industries: tally(users.map((u) => u.industry), 20),
        functionalAreas: tally(users.map((u) => u.functionalArea), 20),
        locations: tally(users.map((u) => u.location), 20),
        employers: tally(users.map((u) => u.currentEmployer), 30),
        languages: [...languages.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([value, count]) => ({ value, count })),
        poolSize: users.length,
      },
    })
  } catch (err) {
    console.error('GET /api/talent/meta failed:', err)
    return NextResponse.json({ error: 'Failed to load filter metadata' }, { status: 500 })
  }
}
