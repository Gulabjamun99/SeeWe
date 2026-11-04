// POST /api/candidates/[id]/contact — Contact reveal.
//
// Recruiters unlock a candidate's real email/phone through an explicitly
// logged, quota-tracked action. Server-side authorization is mandatory:
//   • caller must be role RECRUITER (resolveRecruiter)
//   • the employer-block privacy shield applies (a recruiter can never reveal
//     a candidate who works at the recruiter's own company)
//   • every reveal writes a UsageLog row (CONTACT_REVEAL) and enforces the
//     daily quota from src/lib/talent-config.ts
//
// Response 200: { data: { id, name, email, phone, revealedAt } }
// 403 recruiter access required / employer-blocked, 404 unknown candidate,
// 429 quota exhausted.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'
import { checkQuota, TALENT_QUOTAS } from '@/lib/talent-config'

function normaliseCompany(v: string | null | undefined): string {
  return (v || '').trim().toLowerCase()
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const recruiter = await resolveRecruiter(body?.recruiterId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const candidate = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        profileVisible: true,
        currentEmployer: true,
      },
    })
    if (!candidate || candidate.role !== 'CANDIDATE' || !candidate.profileVisible) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    // employer-block shield (same rule as search)
    const me = await db.user.findUnique({
      where: { id: recruiter.id },
      select: { company: true, clientId: true },
    })
    const blocked = new Set<string>([normaliseCompany(me?.company)])
    if (me?.clientId) {
      const client = await db.client.findUnique({
        where: { id: me.clientId },
        select: { name: true },
      })
      blocked.add(normaliseCompany(client?.name))
    }
    if (candidate.currentEmployer && blocked.has(normaliseCompany(candidate.currentEmployer))) {
      return NextResponse.json(
        { error: 'This candidate is not available to you (privacy policy)' },
        { status: 403 }
      )
    }

    // quota enforcement (server-side — direct API calls cannot bypass)
    const quota = await checkQuota(recruiter.id, 'CONTACT_REVEAL')
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: `Daily contact-reveal limit reached (${quota.limit}/day). Resets at midnight.`,
          quota,
        },
        { status: 429 }
      )
    }

    await db.usageLog.create({
      data: {
        actorId: recruiter.id,
        kind: 'CONTACT_REVEAL',
        meta: JSON.stringify({ candidateId: id }),
      },
    })

    return NextResponse.json({
      data: {
        id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        phone: candidate.phone,
        revealedAt: new Date().toISOString(),
        quotaUsed: quota.used + 1,
        quotaLimit: TALENT_QUOTAS.CONTACT_REVEAL,
      },
    })
  } catch (err) {
    console.error('POST /api/candidates/[id]/contact failed:', err)
    return NextResponse.json({ error: 'Failed to reveal contact' }, { status: 500 })
  }
}
