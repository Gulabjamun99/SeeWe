// SeeWe - GET /api/export/applicants?userId=...
// Recruiter-only applicant CSV export (one row per application across ALL their jobs).
// Proper CSV escaping (quotes / commas / newlines), served as a browser download.
//
// Raw SQL on purpose: a long-lived server process can hold a Prisma client generated
// BEFORE the Application.source / screenVerdict columns existed, so typed selects on
// those fields would fail validation there. $queryRaw bypasses DMMF validation and
// behaves identically with stale or freshly generated clients (same pattern as the
// clients retention route).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/** Escape one CSV cell — quote anything containing quotes, commas, CR or LF. */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function prettyVerdict(verdict: string | null): string {
  if (!verdict) return ''
  const label = verdict.replace(/_/g, ' ').toLowerCase()
  return label.charAt(0).toUpperCase() + label.slice(1)
}

interface ExportRow {
  status: string
  source: string | null
  createdAt: Date | string
  screenVerdict: string | null
  matchScore: number | null
  candidateName: string | null
  candidateEmail: string | null
  jobTitle: string | null
}

// GET /api/export/applicants?userId=<recruiterId>
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')?.trim()
    if (!userId) {
      return NextResponse.json({ error: 'userId query param is required' }, { status: 400 })
    }

    const caller = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!caller) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (caller.role !== 'RECRUITER') {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const rows = await db.$queryRaw<ExportRow[]>`
      SELECT a."status", a."source", a."createdAt", a."screenVerdict", a."matchScore",
             c."name" AS candidateName, c."email" AS candidateEmail, j."title" AS jobTitle
      FROM "Application" a
      JOIN "Job" j ON j."id" = a."jobId"
      JOIN "User" c ON c."id" = a."candidateId"
      WHERE j."recruiterId" = ${userId}
      ORDER BY a."createdAt" DESC`

    const header = ['Candidate', 'Email', 'Job', 'Status', 'Source', 'Applied At', 'Screen Verdict', 'Match %']
    const body = rows.map((a) => [
      a.candidateName ?? '',
      a.candidateEmail ?? '',
      a.jobTitle ?? '',
      a.status,
      a.source ?? 'DIRECT',
      new Date(a.createdAt as unknown as string).toISOString(),
      prettyVerdict(a.screenVerdict),
      typeof a.matchScore === 'number' ? String(Math.round(a.matchScore)) : '',
    ])

    const csv = [header, ...body].map((r) => r.map(csvCell).join(',')).join('\r\n')
    const stamp = new Date().toISOString().slice(0, 10)

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="applicants-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('GET /api/export/applicants failed:', err)
    return NextResponse.json({ error: 'Failed to export applicants' }, { status: 500 })
  }
}
