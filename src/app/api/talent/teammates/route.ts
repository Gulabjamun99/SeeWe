// GET /api/talent/teammates?recruiterId=... — the recruiter's team for
// candidate assignment in the sourcing tracker. Returns RECRUITER accounts
// (id, name, company) only — no contact data. Server-side role gate.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const recruiter = await resolveRecruiter(req.nextUrl.searchParams.get('recruiterId'))
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }
    const teammates = await db.user.findMany({
      where: { role: 'RECRUITER', disabled: false },
      select: { id: true, name: true, company: true },
      orderBy: { name: 'asc' },
      take: 100,
    })
    return NextResponse.json({ data: teammates })
  } catch (err) {
    console.error('GET /api/talent/teammates failed:', err)
    return NextResponse.json({ error: 'Failed to load teammates' }, { status: 500 })
  }
}
