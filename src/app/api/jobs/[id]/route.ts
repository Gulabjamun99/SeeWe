import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { parseAiInterviewConfig } from '@/lib/ai-interview-config'
import { applyCompanyBranding } from '@/lib/company-branding'

const JOB_STATUSES = ['ACTIVE', 'PAUSED', 'CLOSED']

const NUMERIC_FIELDS = [
  'experienceMin',
  'experienceMax',
  'salaryMinLpa',
  'salaryMaxLpa',
  'openings',
] as const

const TEXT_FIELDS = [
  'title',
  'description',
  'location',
  'company',
  'skills',
  'jdText',
] as const

// GET /api/jobs/[id] - single job with counts + recruiter info; bumps viewsCount
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Increment views first (ignore failures; best-effort metric)
    try {
      await db.job.update({
        where: { id },
        data: { viewsCount: { increment: 1 } },
      })
    } catch {
      // job may not exist or increment raced a delete - fall through to fetch
    }

    const job = await db.job.findUnique({
      where: { id },
      include: {
        _count: { select: { applications: true } },
        recruiter: {
          select: {
            id: true,
            name: true,
            email: true,
            company: true,
            headline: true,
            avatarSeed: true,
            companyAbout: true,
            companyWebsite: true,
            companyLogoData: true,
            companyLogoMime: true,
            brandColor: true,
          },
        },
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    return NextResponse.json({ data: job })
  } catch (err) {
    console.error('GET /api/jobs/[id] failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch job' },
      { status: 500 }
    )
  }
}

// PATCH /api/jobs/[id] - update only provided, editable fields
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await db.job.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const patch = body as Record<string, unknown>

    const data: Record<string, unknown> = {}

    if ('status' in patch) {
      if (
        typeof patch.status !== 'string' ||
        !JOB_STATUSES.includes(patch.status)
      ) {
        return NextResponse.json(
          { error: `status must be one of: ${JOB_STATUSES.join(', ')}` },
          { status: 400 }
        )
      }
      data.status = patch.status
    }

    for (const f of TEXT_FIELDS) {
      const v = patch[f]
      if (v !== undefined) {
        if (typeof v !== 'string') {
          return NextResponse.json(
            { error: `Field '${f}' must be a string` },
            { status: 400 }
          )
        }
        if (f === 'title' && v.trim().length === 0) {
          return NextResponse.json(
            { error: "Field 'title' cannot be empty" },
            { status: 400 }
          )
        }
        data[f] = v.trim()
      }
    }

    for (const f of NUMERIC_FIELDS) {
      const v = patch[f]
      if (v !== undefined && v !== null) {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          return NextResponse.json(
            { error: `Field '${f}' must be a number` },
            { status: 400 }
          )
        }
        data[f] = f === 'openings' ? Math.max(1, Math.floor(v)) : v
      }
    }

    // ---- AI screening interview toggle + question set (OPTIONAL per job) ----
    if ('aiInterviewEnabled' in patch) {
      if (typeof patch.aiInterviewEnabled !== 'boolean') {
        return NextResponse.json(
          { error: 'aiInterviewEnabled must be a boolean' },
          { status: 400 }
        )
      }
      data.aiInterviewEnabled = patch.aiInterviewEnabled
    }
    if ('aiInterviewConfig' in patch) {
      const parsed = parseAiInterviewConfig(patch.aiInterviewConfig)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      if (parsed.config) {
        data.aiInterviewConfig = JSON.stringify(parsed.config)
      } else {
        data.aiInterviewConfig = null
      }
    }
    // Final consistency: AI ON requires a non-empty authored question set
    if (data.aiInterviewEnabled === true) {
      const effectiveConfig =
        data.aiInterviewConfig !== undefined
          ? data.aiInterviewConfig
          : existing.aiInterviewConfig
      let questionCount = 0
      try {
        const cfg = effectiveConfig ? JSON.parse(String(effectiveConfig)) : null
        questionCount = Array.isArray(cfg?.questions) ? cfg.questions.length : 0
      } catch {
        questionCount = 0
      }
      if (questionCount === 0) {
        return NextResponse.json(
          { error: 'AI screening is ON — add at least one interview question first.' },
          { status: 400 }
        )
      }
    }

    // ---- Company branding (optional; updates the recruiter account) ----
    let brandingApplied = false
    if ('companyBranding' in patch) {
      const brandingResult = await applyCompanyBranding(existing.recruiterId, patch.companyBranding)
      if (brandingResult.error) {
        return NextResponse.json({ error: brandingResult.error }, { status: 400 })
      }
      brandingApplied = true
    }

    if (Object.keys(data).length === 0 && !brandingApplied) {
      return NextResponse.json(
        { error: 'No valid updatable fields provided' },
        { status: 400 }
      )
    }

    const updated = await db.job.update({
      where: { id },
      data,
      include: {
        _count: { select: { applications: true } },
        recruiter: {
          select: {
            id: true,
            name: true,
            company: true,
            avatarSeed: true,
            companyAbout: true,
            companyWebsite: true,
            companyLogoData: true,
            companyLogoMime: true,
            brandColor: true,
          },
        },
      },
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PATCH /api/jobs/[id] failed:', err)
    return NextResponse.json(
      { error: 'Failed to update job' },
      { status: 500 }
    )
  }
}

// DELETE /api/jobs/[id] - remove job (applications cascade via schema)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const existing = await db.job.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    await db.job.delete({ where: { id } })
    return NextResponse.json({ data: { deleted: true, id } })
  } catch (err) {
    console.error('DELETE /api/jobs/[id] failed:', err)
    return NextResponse.json(
      { error: 'Failed to delete job' },
      { status: 500 }
    )
  }
}
