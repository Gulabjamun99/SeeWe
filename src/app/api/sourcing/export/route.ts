// POST /api/sourcing/export — permission-gated CSV export of sourced /
// searched candidates.
//
// Body: { recruiterId, candidateIds: string[] } (≤ EXPORT_ROWS ids)
// Server-side checks:
//   • caller must be role RECRUITER (resolveRecruiter)
//   • daily EXPORT quota enforced (UsageLog)
//   • candidate privacy: currentEmployer is NEVER exported; email/phone are
//     exported ONLY as masked values — real contact data must be revealed per
//     candidate through the logged contact endpoint. This blocks unauthorized
//     bulk exports of personal contact data by design.
//   • every export writes a UsageLog row with the row count.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'
import { checkQuota, TALENT_QUOTAS } from '@/lib/talent-config'
import { maskEmail, maskPhone } from '@/lib/talent-search-engine'

export const dynamic = 'force-dynamic'

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const recruiter = await resolveRecruiter(body?.recruiterId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const ids = Array.isArray(body?.candidateIds)
      ? body.candidateIds.filter((x): x is string => typeof x === 'string').slice(0, TALENT_QUOTAS.EXPORT_ROWS)
      : []
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Select at least one candidate to export' }, { status: 400 })
    }

    const quota = await checkQuota(recruiter.id, 'EXPORT')
    if (!quota.allowed) {
      return NextResponse.json(
        { error: `Daily export limit reached (${quota.limit}/day).` },
        { status: 429 }
      )
    }

    const users = await db.user.findMany({
      where: { id: { in: ids }, role: 'CANDIDATE', profileVisible: true, disabled: false },
      select: {
        id: true, name: true, email: true, phone: true, headline: true, skills: true,
        location: true, preferredLocations: true, industry: true, functionalArea: true,
        experienceYears: true, currentSalary: true, expectedSalary: true, noticePeriodDays: true,
        education: true, languages: true, employmentTypePref: true, lastActiveAt: true,
        profileSource: true, createdAt: true, workExperiences: { select: { title: true, company: true, isCurrent: true } },
      },
    })

    const header = [
      'Candidate ID', 'Name', 'Headline', 'Current Designation', 'Experience (yrs)',
      'Location', 'Preferred Locations', 'Industry', 'Functional Area', 'Key Skills',
      'Education', 'Languages', 'Employment Type Pref', 'Notice Period (days)',
      'Expected CTC (LPA)', 'Last Active', 'Profile Source', 'Email (masked)', 'Phone (masked)',
    ]

    const lines = [header.join(',')]
    for (const u of users) {
      const current = u.workExperiences.find((w) => w.isCurrent)
      lines.push(
        [
          u.id, u.name, u.headline, current?.title || '', u.experienceYears ?? '',
          u.location || '', u.preferredLocations || '', u.industry || '', u.functionalArea || '',
          u.skills || '', u.education || '', u.languages || '', u.employmentTypePref || '',
          u.noticePeriodDays ?? '', u.expectedSalary ?? '',
          u.lastActiveAt ? new Date(u.lastActiveAt).toISOString().slice(0, 10) : '',
          u.profileSource || 'SIGNUP',
          maskEmail(u.email) || '', maskPhone(u.phone) || '',
        ]
          .map(csvCell)
          .join(',')
      )
    }

    await db.usageLog
      .create({
        data: {
          actorId: recruiter.id,
          kind: 'EXPORT',
          meta: JSON.stringify({ rows: users.length, requested: ids.length }),
        },
      })
      .catch(() => undefined)

    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="seewee-talent-export-${stamp}.csv"`,
      },
    })
  } catch (err) {
    console.error('POST /api/sourcing/export failed:', err)
    return NextResponse.json({ error: 'Failed to export' }, { status: 500 })
  }
}
