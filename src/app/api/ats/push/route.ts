// SeeWe - /api/ats/push
// Pushes one candidate's full AI-interview dossier into the recruiter's own
// ATS endpoint (webhook). Every attempt is audit-logged in AtsPush with the
// exact payload snapshot — success or failure — so nothing is ever silent.
//
// POST {recruiterId, integrationId, interviewId}
//      -> server-side POST of the dossier JSON to the configured webhook
//         (headers: content-type json + optional x-ats-api-key), 8s timeout,
//         outcome logged. Returns { status, httpStatus, message, pushId }.
// GET  ?recruiterId=... [&interviewId=] -> recent push log (newest first)

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildAtsDossier } from '@/lib/ats'
import { logApplicationEvent, actorNameFor } from '@/lib/application-events'

const PUSH_TIMEOUT_MS = 8_000

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const recruiterId = typeof body?.recruiterId === 'string' ? body.recruiterId.trim() : ''
    const integrationId = typeof body?.integrationId === 'string' ? body.integrationId.trim() : ''
    const interviewId = typeof body?.interviewId === 'string' ? body.interviewId.trim() : ''

    if (!recruiterId || !integrationId || !interviewId) {
      return NextResponse.json(
        { error: 'recruiterId, integrationId and interviewId are required' },
        { status: 400 }
      )
    }

    // Tenancy: integration must belong to the recruiter, interview to their job
    const integration = await db.atsIntegration.findUnique({ where: { id: integrationId } })
    if (!integration || integration.recruiterId !== recruiterId) {
      return NextResponse.json({ error: 'Integration not found for this recruiter' }, { status: 404 })
    }
    if (!integration.active) {
      return NextResponse.json({ error: 'This integration is paused — reactivate it first' }, { status: 400 })
    }

    const dossier = await buildAtsDossier(interviewId)
    if (!dossier) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
    }
    if (dossier.interview.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'Only completed interviews can be pushed to an ATS' },
        { status: 400 }
      )
    }

    const payload = JSON.stringify(dossier)
    let status: 'SUCCESS' | 'FAILED' = 'FAILED'
    let httpStatus: number | null = null
    let message = ''

    try {
      const res = await fetch(integration.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'SeeWe-ATS-Exporter/1.0',
          ...(integration.apiKey ? { 'x-ats-api-key': integration.apiKey } : {}),
        },
        body: payload,
        signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
      })
      httpStatus = res.status
      if (res.ok) {
        status = 'SUCCESS'
        message = `Accepted by ATS (HTTP ${res.status})`
      } else {
        message = `ATS endpoint responded with HTTP ${res.status}`
      }
    } catch (err) {
      message =
        err instanceof Error
          ? `Could not reach the ATS endpoint: ${err.name === 'TimeoutError' ? `timed out after ${PUSH_TIMEOUT_MS / 1000}s` : err.message}`
          : 'Could not reach the ATS endpoint'
    }

    const push = await db.atsPush.create({
      data: {
        integrationId: integration.id,
        interviewId,
        candidateName: dossier.candidate.name,
        jobTitle: dossier.position.title,
        status,
        httpStatus,
        message,
        payload,
      },
    })

    // §10 audit trail: ATS push outcome on the application timeline
    // (recruiter-only ATS_PUSH row — never candidate-visible). Non-fatal.
    if (dossier.application?.id) {
      void actorNameFor(recruiterId)
        .then((actorName) =>
          logApplicationEvent(db, {
            applicationId: dossier.application.id,
            type: 'ATS_PUSH',
            actorRole: 'RECRUITER',
            actorName,
            note: `Dossier pushed to ${integration.name} — ${status.toLowerCase()} (${message})`,
          })
        )
        .catch((err) => console.error('[application-events] non-fatal ats-push log failure:', err))
    }

    return NextResponse.json({
      data: {
        pushId: push.id,
        status,
        httpStatus,
        message,
        candidateName: push.candidateName,
        jobTitle: push.jobTitle,
        createdAt: push.createdAt,
      },
    })
  } catch (error) {
    console.error('[ats/push][POST] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to push candidate to ATS' }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const recruiterId = searchParams.get('recruiterId')?.trim() ?? ''
    const interviewId = searchParams.get('interviewId')?.trim() ?? ''
    if (!recruiterId) {
      return NextResponse.json({ error: 'recruiterId is required' }, { status: 400 })
    }

    const pushes = await db.atsPush.findMany({
      where: {
        integration: { recruiterId },
        ...(interviewId ? { interviewId } : {}),
      },
      orderBy: { createdAt: 'desc' as const },
      take: 50,
      include: { integration: { select: { id: true, name: true } } },
    })

    return NextResponse.json({
      data: pushes.map((p) => ({
        id: p.id,
        interviewId: p.interviewId,
        candidateName: p.candidateName,
        jobTitle: p.jobTitle,
        status: p.status,
        httpStatus: p.httpStatus,
        message: p.message,
        integration: p.integration,
        createdAt: p.createdAt,
      })),
    })
  } catch (error) {
    console.error('[ats/push][GET] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to load ATS push log' }, { status: 500 })
  }
}
