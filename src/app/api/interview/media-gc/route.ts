// SeeWe - /api/interview/media-gc  (POST)
// Storage hygiene for recorded interview answers. Two cleanup passes:
//   1. ORPHANS  — files sitting in upload/interview-media/ that no Answer row
//      references anymore (e.g. an interview was deleted, or a write failed
//      between file save and DB update).
//   2. TTL EXPIRY — recordings whose interview COMPLETED more than the
//      effective TTL ago. The effective TTL per interview is
//      `shortlist.client.mediaRetentionDays ?? days` — a per-client override
//      (set via PATCH /api/clients) wins; the global default is 45 days,
//      clamped 7..365. Recruiter already has download; the platform keeps
//      media bounded.
//
// POST ?recruiterId=...&days=45
// Requires a scope param AND the scope must reference an existing account —
// the sweep ONLY touches files owned by that recruiter/candidate:
//   - referenced/TTL sets are built from that scope's interviews alone
//   - orphan filenames embed their interviewId, so orphan deletion is also
//     restricted to interviews inside the scope.
// Never returns file contents — only counts + freed bytes.
// Response: { scanned, orphanedDeleted, expiredDeleted, freedBytes, ttlDays,
//             defaultTtlDays (= the days param), clientOverrides (distinct
//             interviews where a per-client TTL applied) }

import { NextRequest, NextResponse } from 'next/server'
import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { db } from '@/lib/db'
import { MEDIA_DIR } from '@/lib/media-inventory'

const SAFE_NAME = /^[A-Za-z0-9_-]+\.webm$/

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const recruiterId = searchParams.get('recruiterId')
    const candidateId = searchParams.get('candidateId')

    if (!recruiterId && !candidateId) {
      return NextResponse.json(
        { error: 'recruiterId or candidateId is required' },
        { status: 400 }
      )
    }

    // Scope must reference a real account (404 otherwise) so arbitrary
    // strings cannot unlock the destructive sweep.
    let scopeInterviewIds: string[]
    if (recruiterId) {
      const recruiter = await db.user.findUnique({
        where: { id: recruiterId },
        select: { id: true, role: true },
      })
      if (!recruiter || recruiter.role !== 'RECRUITER') {
        return NextResponse.json({ error: 'Recruiter not found' }, { status: 404 })
      }
      const rows = await db.interview.findMany({
        where: { shortlist: { application: { job: { recruiterId } } } },
        select: { id: true },
      })
      scopeInterviewIds = rows.map((r) => r.id)
    } else {
      const candidate = await db.user.findUnique({
        where: { id: candidateId! },
        select: { id: true },
      })
      if (!candidate) {
        return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
      }
      const rows = await db.interview.findMany({
        where: { shortlist: { application: { candidateId: candidateId! } } },
        select: { id: true },
      })
      scopeInterviewIds = rows.map((r) => r.id)
    }
    const scopedInterviewSet = new Set(scopeInterviewIds)

    // Per-client retention overrides (interviewId -> TTL days). Raw SQL rather
    // than a typed `shortlist.client.mediaRetentionDays` nested select: a
    // long-lived server process can hold a Prisma client generated before that
    // column existed, and typed selects would fail DMMF validation there —
    // $queryRaw is DMMF-independent and correct with stale or fresh clients.
    const overrideRows = await db.$queryRaw<
      { interviewId: string; mediaRetentionDays: number }[]
    >`
      SELECT i."id" AS "interviewId", c."mediaRetentionDays" AS "mediaRetentionDays"
      FROM "Interview" i
      JOIN "Shortlist" s ON s."id" = i."shortlistId"
      JOIN "Client" c ON c."id" = s."clientId"
      WHERE c."mediaRetentionDays" IS NOT NULL`
    const overrideDaysByInterview = new Map<string, number>()
    for (const row of overrideRows) {
      // honour the scope: only interviews visible to this recruiter/candidate
      if (scopedInterviewSet.has(row.interviewId)) {
        overrideDaysByInterview.set(row.interviewId, row.mediaRetentionDays)
      }
    }

    const daysRaw = Number(searchParams.get('days') ?? '45')
    const ttlDays = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.round(daysRaw), 7), 365) : 45
    const defaultCutoff = Date.now() - ttlDays * 24 * 60 * 60 * 1000
    const DAY_MS = 24 * 60 * 60 * 1000

    // Answer rows for THIS SCOPE's interviews only (mediaPath embeds the
    // interviewId as its filename prefix, which scopes orphans below too).
    const answers = await db.answer.findMany({
      where: { mediaPath: { not: null }, interviewId: { in: scopeInterviewIds } },
      select: {
        mediaPath: true,
        interviewId: true,
        interview: { select: { status: true, completedAt: true, startedAt: true, createdAt: true } },
      },
    })
    const referenced = new Set<string>()
    const expired = new Set<string>()
    const overrideApplied = new Set<string>() // distinct interviews whose per-client TTL was used
    for (const a of answers) {
      if (!a.mediaPath) continue
      referenced.add(a.mediaPath)
      const iv = a.interview
      const done = iv.completedAt ?? (iv.status === 'COMPLETED' ? iv.startedAt ?? iv.createdAt : null)
      if (iv.status !== 'COMPLETED' || !done) continue
      // effective TTL = per-client override when present, else the global default
      const overrideDays = overrideDaysByInterview.get(a.interviewId)
      if (overrideDays != null) overrideApplied.add(a.interviewId)
      const cutoff = overrideDays != null ? Date.now() - overrideDays * DAY_MS : defaultCutoff
      if (new Date(done).getTime() < cutoff) {
        expired.add(a.mediaPath)
      }
    }

    let dirEntries: string[]
    try {
      dirEntries = await readdir(MEDIA_DIR)
    } catch {
      // directory missing -> nothing stored yet, nothing to clean
      return NextResponse.json({
        data: {
          scanned: 0,
          orphanedDeleted: 0,
          expiredDeleted: 0,
          freedBytes: 0,
          ttlDays,
          defaultTtlDays: ttlDays,
          clientOverrides: overrideApplied.size,
        },
      })
    }

    let orphanedDeleted = 0
    let expiredDeleted = 0
    let freedBytes = 0
    let scanned = 0

    for (const name of dirEntries) {
      if (!SAFE_NAME.test(name)) continue // ignore anything we did not generate
      // Filename contract: `${interviewId}-q${qIndex}-${ts}.webm` — derive the
      // owning interview and only touch files inside the requested scope.
      const owningInterviewId = name.slice(0, name.indexOf('-q'))
      if (!owningInterviewId || !scopedInterviewSet.has(owningInterviewId)) continue
      scanned++
      const full = path.join(MEDIA_DIR, name)
      const isOrphan = !referenced.has(name)
      const isExpired = !isOrphan && expired.has(name)
      if (!isOrphan && !isExpired) continue
      try {
        const s = await stat(full)
        if (!s.isFile()) continue
        await unlink(full)
        freedBytes += s.size
        if (isOrphan) orphanedDeleted++
        else expiredDeleted++
      } catch (err) {
        // file vanished mid-sweep or not deletable — skip, never fail the run
        console.warn('[interview/media-gc] skip file:', name, err)
      }
    }

    return NextResponse.json({
      data: {
        scanned,
        orphanedDeleted,
        expiredDeleted,
        freedBytes,
        ttlDays,
        defaultTtlDays: ttlDays,
        clientOverrides: overrideApplied.size,
      },
    })
  } catch (error) {
    console.error('[interview/media-gc][POST] Unexpected error:', error)
    return NextResponse.json({ error: 'Storage cleanup failed' }, { status: 500 })
  }
}
