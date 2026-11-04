// SeeWe - /api/ats/integrations
// Recruiters register their own ATS (Applicant Tracking System) webhook so
// interviewed candidates can be pushed into their existing pipeline.
//
// GET    ?recruiterId=...          -> list integrations (+ last push outcome)
// POST   {recruiterId,name,webhookUrl,apiKey?} -> register a new integration
// PATCH  {id, name?, webhookUrl?, apiKey?, active?} -> update
// DELETE ?id=                      -> remove (push log cascades)

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export async function GET(request: Request) {
  try {
    const recruiterId = new URL(request.url).searchParams.get('recruiterId')?.trim() ?? ''
    if (!recruiterId) return badRequest('recruiterId is required')

    const integrations = await db.atsIntegration.findMany({
      where: { recruiterId },
      orderBy: { createdAt: 'desc' as const },
      include: {
        pushes: {
          orderBy: { createdAt: 'desc' as const },
          take: 1,
          select: { status: true, createdAt: true },
        },
        _count: { select: { pushes: true } },
      },
    })

    return NextResponse.json({
      data: integrations.map((it) => ({
        id: it.id,
        name: it.name,
        webhookUrl: it.webhookUrl,
        hasApiKey: Boolean(it.apiKey),
        apiKey: it.apiKey, // needed to re-use when pushing; demo-grade platform
        active: it.active,
        createdAt: it.createdAt,
        pushCount: it._count.pushes,
        lastPush: it.pushes[0] ?? null,
      })),
    })
  } catch (error) {
    console.error('[ats/integrations][GET] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to load ATS integrations' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const recruiterId = typeof body?.recruiterId === 'string' ? body.recruiterId.trim() : ''
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const webhookUrl = typeof body?.webhookUrl === 'string' ? body.webhookUrl.trim() : ''
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : ''

    if (!recruiterId) return badRequest('recruiterId is required')
    if (!name) return badRequest('Give the integration a name')
    if (!webhookUrl) return badRequest('webhookUrl is required')
    if (!isValidHttpUrl(webhookUrl)) return badRequest('webhookUrl must be a valid http(s) URL')

    const recruiter = await db.user.findUnique({ where: { id: recruiterId }, select: { role: true } })
    if (!recruiter) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    if (recruiter.role !== 'RECRUITER') return badRequest('Only recruiters can register ATS integrations')

    const integration = await db.atsIntegration.create({
      data: { recruiterId, name, webhookUrl, apiKey: apiKey || null },
    })
    return NextResponse.json({ data: integration }, { status: 201 })
  } catch (error) {
    console.error('[ats/integrations][POST] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to create ATS integration' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    if (!id) return badRequest('id is required')

    const existing = await db.atsIntegration.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Integration not found' }, { status: 404 })

    const data: { name?: string; webhookUrl?: string; apiKey?: string | null; active?: boolean } = {}
    if (typeof body?.name === 'string' && body.name.trim()) data.name = body.name.trim()
    if (typeof body?.webhookUrl === 'string' && body.webhookUrl.trim()) {
      if (!isValidHttpUrl(body.webhookUrl.trim())) return badRequest('webhookUrl must be a valid http(s) URL')
      data.webhookUrl = body.webhookUrl.trim()
    }
    if (typeof body?.apiKey === 'string') data.apiKey = body.apiKey.trim() || null
    if (typeof body?.active === 'boolean') data.active = body.active

    const updated = await db.atsIntegration.update({ where: { id }, data })
    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[ats/integrations][PATCH] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to update ATS integration' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id')?.trim() ?? ''
    if (!id) return badRequest('id is required')
    const existing = await db.atsIntegration.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    await db.atsIntegration.delete({ where: { id } })
    return NextResponse.json({ data: { deleted: true } })
  } catch (error) {
    console.error('[ats/integrations][DELETE] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to delete ATS integration' }, { status: 500 })
  }
}
