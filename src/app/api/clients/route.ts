import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Per-client recording-retention overrides, keyed by client id.
 *
 * Raw SQL on purpose: a long-lived server process can hold a Prisma client
 * generated BEFORE the Client.mediaRetentionDays column existed (schema
 * pushes only regenerate the client on disk — the process keeps its loaded
 * DMMF until restart), so typed selects on that field would fail validation
 * there. $queryRaw / $executeRaw bypass DMMF validation and behave
 * identically with stale or freshly generated clients.
 */
async function retentionByClientId(): Promise<Map<string, number | null>> {
  const rows = await db.$queryRaw<{ id: string; mediaRetentionDays: number | null }[]>`
    SELECT "id", "mediaRetentionDays" FROM "Client"`
  return new Map(rows.map((r) => [r.id, r.mediaRetentionDays ?? null]))
}

// GET /api/clients - all clients (asc by name), optional ?addedBy=recruiterId
export async function GET(req: NextRequest) {
  try {
    const addedBy = req.nextUrl.searchParams.get('addedBy')

    const [clients, retention] = await Promise.all([
      db.client.findMany({
        where: addedBy ? { addedBy } : undefined,
        orderBy: { name: 'asc' },
        include: { _count: { select: { shortlists: true } } },
      }),
      retentionByClientId(),
    ])

    return NextResponse.json({
      data: clients.map((c) => ({
        ...c,
        mediaRetentionDays: retention.get(c.id) ?? null,
      })),
    })
  } catch (err) {
    console.error('GET /api/clients failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch clients' },
      { status: 500 }
    )
  }
}

// POST /api/clients - register a client company
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { name, contactEmail, industry, notes, addedBy } = body as Record<string, unknown>

    if (typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (
      typeof contactEmail !== 'string' ||
      !EMAIL_RE.test(contactEmail.trim())
    ) {
      return NextResponse.json(
        { error: 'A valid contactEmail is required' },
        { status: 400 }
      )
    }

    // If addedBy given, make sure the recruiter exists
    let recruiterId: string | undefined
    if (typeof addedBy === 'string' && addedBy.trim().length > 0) {
      const recruiter = await db.user.findUnique({ where: { id: addedBy.trim() } })
      if (!recruiter || recruiter.role !== 'RECRUITER') {
        return NextResponse.json(
          { error: 'addedBy must reference an existing RECRUITER user' },
          { status: 400 }
        )
      }
      recruiterId = recruiter.id
    }

    const client = await db.client.create({
      data: {
        name: name.trim(),
        contactEmail: contactEmail.trim(),
        industry: typeof industry === 'string' && industry.trim() ? industry.trim() : undefined,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : undefined,
        addedBy: recruiterId,
      },
      include: { _count: { select: { shortlists: true } } },
    })

    return NextResponse.json(
      { data: { ...client, mediaRetentionDays: null } },
      { status: 201 }
    )
  } catch (err) {
    console.error('POST /api/clients failed:', err)
    return NextResponse.json(
      { error: 'Failed to create client' },
      { status: 500 }
    )
  }
}

// PATCH /api/clients - update a client (currently: recording retention TTL)
// Body: { id, mediaRetentionDays, addedBy? }
//   id                 required -> 404 when the client does not exist
//   mediaRetentionDays null (back to the platform default 45d) or integer 1..365
//                      -> 400 with a clear message otherwise
//   addedBy            optional light guard consistent with the demo-auth
//                      model: when provided it must reference an existing
//                      RECRUITER user -> 403 otherwise (clients are managed
//                      by recruiters, so only a recruiter may change policy)
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { id, mediaRetentionDays, addedBy } = body as Record<string, unknown>

    if (typeof id !== 'string' || id.trim().length === 0) {
      return NextResponse.json({ error: 'Client id is required' }, { status: 400 })
    }

    // null = reset to the platform default; otherwise a whole number 1..365
    let retention: number | null
    if (mediaRetentionDays === null) {
      retention = null
    } else if (
      typeof mediaRetentionDays === 'number' &&
      Number.isInteger(mediaRetentionDays) &&
      mediaRetentionDays >= 1 &&
      mediaRetentionDays <= 365
    ) {
      retention = mediaRetentionDays
    } else {
      return NextResponse.json(
        {
          error:
            'mediaRetentionDays must be null (use the platform default) or a whole number between 1 and 365',
        },
        { status: 400 }
      )
    }

    const existing = await db.client.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    if (addedBy !== undefined) {
      const recruiter =
        typeof addedBy === 'string' && addedBy.trim().length > 0
          ? await db.user.findUnique({ where: { id: addedBy } })
          : null
      if (!recruiter || recruiter.role !== 'RECRUITER') {
        return NextResponse.json(
          { error: 'Only a recruiter who manages this client can change retention settings' },
          { status: 403 }
        )
      }
    }

    // Raw write — same DMMF-staleness rationale as retentionByClientId().
    await db.$executeRaw`
      UPDATE "Client" SET "mediaRetentionDays" = ${retention}
      WHERE "id" = ${id}`

    const updated = await db.client.findUnique({
      where: { id },
      include: { _count: { select: { shortlists: true } } },
    })
    if (!updated) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: { ...updated, mediaRetentionDays: retention },
    })
  } catch (err) {
    console.error('PATCH /api/clients failed:', err)
    return NextResponse.json(
      { error: 'Failed to update client' },
      { status: 500 }
    )
  }
}
