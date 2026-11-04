// /api/sourcing — the recruiter-private candidate sourcing tracker (CRM).
//
// GET  ?recruiterId=...&status=&candidateIds=  → tracker rows (+ candidate card data)
// POST { recruiterId, candidateId | candidateIds[], status?, note?, tags?,
//        assignedToId?, lastContactedAt?, followUpAt? } → upsert tracker rows
//        (bulk-capable). Every change appends an immutable history entry
//        {at, actor, action, detail} to the row.
// DELETE ?recruiterId=&candidateId= → remove a tracker row (history dies with it)
//
// Authorization: server-side via resolveRecruiter; rows are per-recruiter.
// Status values are whitelisted against SOURCING_STATUSES.

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'
import { SOURCING_STATUSES, SOURCING_STATUS_META } from '@/lib/talent-config'

export const dynamic = 'force-dynamic'

function csv(v: unknown): string[] {
  if (typeof v !== 'string') return []
  return v.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 400)
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const recruiter = await resolveRecruiter(sp.get('recruiterId'))
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }
    const status = sp.get('status')
    const candidateIds = csv(sp.get('candidateIds'))

    const rows = await db.sourcingEntry.findMany({
      where: {
        recruiterId: recruiter.id,
        ...(status && SOURCING_STATUSES.includes(status as never) ? { status } : {}),
        ...(candidateIds.length ? { candidateId: { in: candidateIds } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
      include: {
        candidate: {
          select: {
            id: true, name: true, headline: true, skills: true, location: true,
            experienceYears: true, expectedSalary: true, noticePeriodDays: true,
            avatarSeed: true, industry: true, profileSource: true, lastActiveAt: true,
          },
        },
      },
    })

    return NextResponse.json({
      data: rows.map((r) => {
        let history: { at: string; actor: string; action: string }[] = []
        try {
          const parsed = JSON.parse(r.history || '[]')
          if (Array.isArray(parsed)) history = parsed
        } catch {
          history = []
        }
        const { history: _raw, ...rest } = r
        return {
          ...rest,
          history,
          statusMeta: SOURCING_STATUS_META[r.status as keyof typeof SOURCING_STATUS_META] || null,
        }
      }),
    })
  } catch (err) {
    console.error('GET /api/sourcing failed:', err)
    return NextResponse.json({ error: 'Failed to load sourcing tracker' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const recruiter = await resolveRecruiter(body?.recruiterId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const candidateIds = Array.isArray(body?.candidateIds)
      ? body.candidateIds.filter((x): x is string => typeof x === 'string').slice(0, 200)
      : typeof body?.candidateId === 'string'
        ? [body.candidateId]
        : []
    if (candidateIds.length === 0) {
      return NextResponse.json({ error: 'candidateId or candidateIds required' }, { status: 400 })
    }

    // validate status
    const status = typeof body?.status === 'string' ? body.status : undefined
    if (status !== undefined && !SOURCING_STATUSES.includes(status as never)) {
      return NextResponse.json(
        { error: `status must be one of: ${SOURCING_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }
    // validate assignment target (must exist; any role is allowed — teammates)
    let assignedToId: string | undefined
    let assignedToName: string | undefined
    if (body?.assignedToId !== undefined) {
      if (body.assignedToId === null || body.assignedToId === '') {
        assignedToId = ''
      } else if (typeof body.assignedToId === 'string') {
        const t = await db.user.findUnique({
          where: { id: body.assignedToId },
          select: { id: true, name: true },
        })
        if (!t) return NextResponse.json({ error: 'Assigned teammate not found' }, { status: 400 })
        assignedToId = t.id
        assignedToName = t.name
      }
    }
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 1000) : undefined
    const tags =
      typeof body?.tags === 'string'
        ? body.tags.split(',').map((t) => t.trim().slice(0, 30)).filter(Boolean).slice(0, 12).join(',') || null
        : undefined
    const lastContactedAt = typeof body?.lastContactedAt === 'string' && body.lastContactedAt ? new Date(body.lastContactedAt) : undefined
    const followUpAt = typeof body?.followUpAt === 'string' && body.followUpAt ? new Date(body.followUpAt) : undefined

    const results: { candidateId: string; ok: boolean; status?: string; error?: string }[] = []
    for (const candidateId of candidateIds) {
      try {
        const candidate = await db.user.findUnique({
          where: { id: candidateId },
          select: { id: true, role: true },
        })
        if (!candidate || candidate.role !== 'CANDIDATE') {
          results.push({ candidateId, ok: false, error: 'Candidate not found' })
          continue
        }

        const existing = await db.sourcingEntry.findUnique({
          where: { recruiterId_candidateId: { recruiterId: recruiter.id, candidateId } },
        })

        const actionBits: string[] = []
        const data: Record<string, unknown> = {}
        if (status !== undefined && status !== existing?.status) {
          data.status = status
          actionBits.push(`status → ${SOURCING_STATUS_META[status as keyof typeof SOURCING_STATUS_META]?.label || status}`)
        }
        if (note !== undefined) {
          data.note = note || null
          if (note) actionBits.push('note updated')
        }
        if (tags !== undefined) {
          data.tags = tags
          actionBits.push('tags updated')
        }
        if (assignedToId !== undefined) {
          const nextAssigned = assignedToId || null
          if ((existing?.assignedToId ?? null) !== nextAssigned) {
            data.assignedToId = nextAssigned
            data.assignedToName = assignedToName || null
            actionBits.push(assignedToId ? `assigned to ${assignedToName}` : 'assignment cleared')
          }
        }
        if (lastContactedAt !== undefined) {
          data.lastContactedAt = lastContactedAt
          actionBits.push('last-contacted recorded')
        }
        if (followUpAt !== undefined) {
          data.followUpAt = followUpAt
          actionBits.push('follow-up scheduled')
        }

        const historyEntry = {
          at: new Date().toISOString(),
          actor: recruiter.name,
          action: actionBits.length ? actionBits.join('; ') : 'touched',
        }

        if (existing) {
          const prevHistory = JSON.parse(existing.history || '[]') as unknown[]
          await db.sourcingEntry.update({
            where: { id: existing.id },
            data: { ...data, history: JSON.stringify([...prevHistory.slice(-49), historyEntry]) },
          })
        } else {
          await db.sourcingEntry.create({
            data: {
              recruiterId: recruiter.id,
              candidateId,
              ...(status !== undefined ? { status } : {}),
              ...(note !== undefined ? { note: note || null } : {}),
              ...(tags !== undefined ? { tags } : {}),
              ...(assignedToId !== undefined ? { assignedToId: assignedToId || null, assignedToName: assignedToName || null } : {}),
              ...(lastContactedAt !== undefined ? { lastContactedAt } : {}),
              ...(followUpAt !== undefined ? { followUpAt } : {}),
              history: JSON.stringify([historyEntry]),
            },
          })
        }
        results.push({ candidateId, ok: true, status: (data.status as string) || undefined })
      } catch (e) {
        results.push({ candidateId, ok: false, error: (e as Error).message })
      }
    }

    return NextResponse.json({ data: results })
  } catch (err) {
    console.error('POST /api/sourcing failed:', err)
    return NextResponse.json({ error: 'Failed to update sourcing tracker' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const recruiter = await resolveRecruiter(sp.get('recruiterId'))
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }
    const candidateId = sp.get('candidateId') || ''
    if (!candidateId) {
      return NextResponse.json({ error: 'candidateId required' }, { status: 400 })
    }
    await db.sourcingEntry.deleteMany({
      where: { recruiterId: recruiter.id, candidateId },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/sourcing failed:', err)
    return NextResponse.json({ error: 'Failed to remove tracker entry' }, { status: 500 })
  }
}
