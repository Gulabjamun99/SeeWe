// SeeWe - Enterprise ATS inbound webhook (public v1 API)
//   GET  /api/v1/webhooks/ats/[companyId]  → Test Connection ping
//   POST /api/v1/webhooks/ats/[companyId]  → inbound job sync (upsert_jobs)
//
// [companyId] accepts EITHER the AtsIntegration id (recommended — what the
// integrations UI shows as the webhook endpoint) OR the owning recruiter's
// user id. Authentication: `x-ats-api-key` header must equal the matched
// integration's stored apiKey; when an integration has no key configured the
// endpoint is open for that integration (demo-grade platform).
//
// POST body: { action: "upsert_jobs", jobs: [{ atsJobId, title, department,
//   location, locationType, description, salaryRange, skills, draft? }] }
// Jobs are upserted for the OWNING recruiter (match by atsJobId first, then
// title+company); the company field is always stamped with the recruiter's
// own company name — payload company strings are never trusted. Email-shaped
// junk titles are rejected.
// Response: { data: { created, updated, total, skipped } }

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { upsertAtsJobs } from '@/lib/ats-sync'
import type { AtsInboundJob } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MAX_JOBS = 50

/**
 * Resolve the active integration addressed by the webhook path segment and
 * verify the shared secret. Returns null when auth fails.
 */
async function authenticate(companyId: string, request: Request) {
  const headerKey = request.headers.get('x-ats-api-key')?.trim() ?? ''
  const candidates = await db.atsIntegration.findMany({
    where: {
      active: true,
      OR: [{ id: companyId }, { recruiterId: companyId }],
    },
    orderBy: { createdAt: 'asc' as const },
  })
  if (candidates.length === 0) return null

  // Prefer the exact integration-id match over the recruiter-wide match.
  const byId = candidates.find((c) => c.id === companyId)
  const ordered = byId ? [byId, ...candidates.filter((c) => c.id !== companyId)] : candidates

  for (const integration of ordered) {
    if (!integration.apiKey) return integration // no key configured → open endpoint for this integration
    if (headerKey && headerKey === integration.apiKey) return integration
  }
  return null
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params
    const integration = await authenticate((companyId ?? '').trim(), request)
    if (!integration) {
      return NextResponse.json(
        { ok: false, error: 'Invalid or missing x-ats-api-key for this endpoint' },
        { status: 401 }
      )
    }
    return NextResponse.json({
      ok: true,
      integrationName: integration.name,
      atsType: integration.atsType,
      recruiterId: integration.recruiterId,
    })
  } catch (error) {
    console.error('[webhooks/ats][GET] Unexpected error:', error)
    return NextResponse.json({ ok: false, error: 'Webhook ping failed' }, { status: 500 })
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  try {
    const { companyId } = await params
    const integration = await authenticate((companyId ?? '').trim(), request)
    if (!integration) {
      return NextResponse.json(
        { ok: false, error: 'Invalid or missing x-ats-api-key for this endpoint' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
    }
    const action = typeof (body as Record<string, unknown>).action === 'string'
      ? (body as Record<string, unknown>).action
      : ''
    if (action !== 'upsert_jobs') {
      return NextResponse.json(
        { ok: false, error: `Unsupported action "${action}" — expected "upsert_jobs"` },
        { status: 400 }
      )
    }
    const jobs = (body as Record<string, unknown>).jobs
    if (!Array.isArray(jobs) || jobs.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'jobs must be a non-empty array (max 50 per call)' },
        { status: 400 }
      )
    }
    if (jobs.length > MAX_JOBS) {
      return NextResponse.json(
        { ok: false, error: `jobs batch too large — max ${MAX_JOBS} per call` },
        { status: 413 }
      )
    }

    // The owning recruiter's verified company name is stamped on every job.
    const recruiter = await db.user.findUnique({
      where: { id: integration.recruiterId },
      select: { id: true, company: true, name: true },
    })
    if (!recruiter) {
      return NextResponse.json({ ok: false, error: 'Integration owner not found' }, { status: 409 })
    }

    const result = await upsertAtsJobs(
      { recruiterId: recruiter.id, company: recruiter.company || recruiter.name },
      jobs as AtsInboundJob[]
    )

    return NextResponse.json({
      ok: true,
      data: {
        created: result.created,
        updated: result.updated,
        total: result.total,
        skipped: result.skipped,
        integrationName: integration.name,
        atsType: integration.atsType,
        jobs: result.jobs,
      },
    })
  } catch (error) {
    console.error('[webhooks/ats][POST] Unexpected error:', error)
    return NextResponse.json({ ok: false, error: 'Inbound job sync failed' }, { status: 500 })
  }
}
