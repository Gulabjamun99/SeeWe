// SeeWe - POST /api/ats/sync-jobs
// Recruiter action "Sync Jobs from ATS": pulls the job board IN from the
// recruiter's connected ATS integration.
//
// POST { integrationId, recruiterId }  (recruiter-owned guard)
//   1. If integration.webhookUrl is a real reachable endpoint that answers a
//      GET with a { jobs: [...] } JSON payload, those jobs are ingested.
//   2. Otherwise (demo mode) a realistic batch of 3 ATS jobs is generated
//      (shaped by the integration's atsType) and ingested through the SAME
//      upsert path as the inbound webhook (src/lib/ats-sync.ts).
// lastSyncAt + syncedJobsCount are updated on the integration.
// Response: { data: { created, updated, total, skipped, source, jobs } }

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildDemoJobs, fetchJobsFromWebhook, upsertAtsJobs } from '@/lib/ats-sync'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const integrationId = typeof body?.integrationId === 'string' ? body.integrationId.trim() : ''
    const recruiterId = typeof body?.recruiterId === 'string' ? body.recruiterId.trim() : ''

    if (!integrationId) {
      return NextResponse.json({ error: 'integrationId is required' }, { status: 400 })
    }
    if (!recruiterId) {
      return NextResponse.json({ error: 'recruiterId is required' }, { status: 400 })
    }

    // Recruiter-owned guard: the integration must belong to the caller.
    const integration = await db.atsIntegration.findUnique({ where: { id: integrationId } })
    if (!integration || integration.recruiterId !== recruiterId) {
      return NextResponse.json({ error: 'Integration not found for this recruiter' }, { status: 404 })
    }
    if (!integration.active) {
      return NextResponse.json(
        { error: 'This integration is paused — reactivate it before syncing jobs' },
        { status: 400 }
      )
    }

    const recruiter = await db.user.findUnique({
      where: { id: integration.recruiterId },
      select: { id: true, company: true, name: true },
    })
    if (!recruiter) {
      return NextResponse.json({ error: 'Integration owner not found' }, { status: 409 })
    }

    // ---- Pull mode: real ATS endpoint first, demo batch as the fallback ----
    const remoteJobs = await fetchJobsFromWebhook(integration.webhookUrl, integration.apiKey)
    const source: 'webhook' | 'demo' = remoteJobs && remoteJobs.length > 0 ? 'webhook' : 'demo'
    const jobs = source === 'webhook'
      ? remoteJobs!
      : buildDemoJobs(integration.atsType, recruiter.company || recruiter.name)

    const result = await upsertAtsJobs(
      { recruiterId: recruiter.id, company: recruiter.company || recruiter.name },
      jobs
    )
    result.source = source

    await db.atsIntegration.update({
      where: { id: integration.id },
      data: {
        lastSyncAt: new Date(),
        syncedJobsCount: result.total,
      },
    })

    return NextResponse.json({
      data: {
        created: result.created,
        updated: result.updated,
        total: result.total,
        skipped: result.skipped,
        source,
        integrationName: integration.name,
        atsType: integration.atsType,
        jobs: result.jobs,
      },
    })
  } catch (error) {
    console.error('[ats/sync-jobs] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to sync jobs from ATS' }, { status: 500 })
  }
}
