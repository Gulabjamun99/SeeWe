import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/job-alerts?userId=...
 * Returns the user's alerts, each enriched with:
 *  - newCount: ACTIVE jobs created after lastSeenAt that match the alert
 *  - totalMatches: all ACTIVE jobs matching the alert right now
 *  - sample: newest 4 matching jobs (id/title/company/location/createdAt/salary)
 */
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const alerts = await db.jobAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })

    if (alerts.length === 0) {
      return NextResponse.json({ data: [] })
    }

    const activeJobs = await db.job.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        title: true,
        company: true,
        location: true,
        description: true,
        skills: true,
        salaryMaxLpa: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const matches = (alert: (typeof alerts)[number]) => {
      const kw = alert.keyword.trim().toLowerCase()
      const loc = alert.location.trim().toLowerCase()
      return activeJobs.filter((j) => {
        if (kw) {
          const haystack = `${j.title} ${j.skills} ${j.description}`.toLowerCase()
          if (!haystack.includes(kw)) return false
        }
        if (loc && !j.location.toLowerCase().includes(loc)) return false
        if (alert.minSalaryLpa != null && (j.salaryMaxLpa ?? 0) < alert.minSalaryLpa) return false
        return true
      })
    }

    const data = alerts.map((alert) => {
      const all = matches(alert)
      const fresh = all.filter((j) => j.createdAt > alert.lastSeenAt)
      return {
        ...alert,
        newCount: fresh.length,
        totalMatches: all.length,
        sample: all.slice(0, 4).map((j) => ({
          id: j.id,
          title: j.title,
          company: j.company,
          location: j.location,
          createdAt: j.createdAt,
          salaryMaxLpa: j.salaryMaxLpa,
        })),
      }
    })

    return NextResponse.json({ data })
  } catch (err) {
    console.error('GET /api/job-alerts failed:', err)
    return NextResponse.json(
      { error: 'Failed to load job alerts' },
      { status: 500 }
    )
  }
}

/** POST /api/job-alerts {userId, keyword?, location?, minSalaryLpa?} */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const { userId, keyword, location, minSalaryLpa } = body as Record<string, unknown>

    if (typeof userId !== 'string' || !userId.trim()) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    const user = await db.user.findUnique({ where: { id: userId.trim() } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const kw = typeof keyword === 'string' ? keyword.trim() : ''
    const loc = typeof location === 'string' ? location.trim() : ''
    if (!kw && !loc) {
      return NextResponse.json(
        { error: 'Add at least a keyword or a location for the alert' },
        { status: 400 }
      )
    }

    // Basic dupe guard: same user + same keyword + same location
    const existing = await db.jobAlert.findMany({ where: { userId: userId.trim() } })
    if (
      existing.some(
        (a) =>
          a.keyword.trim().toLowerCase() === kw.toLowerCase() &&
          a.location.trim().toLowerCase() === loc.toLowerCase()
      )
    ) {
      return NextResponse.json(
        { error: 'You already have an alert with these filters' },
        { status: 409 }
      )
    }

    const alert = await db.jobAlert.create({
      data: {
        userId: userId.trim(),
        keyword: kw,
        location: loc,
        minSalaryLpa:
          typeof minSalaryLpa === 'number' && Number.isFinite(minSalaryLpa) && minSalaryLpa > 0
            ? minSalaryLpa
            : null,
        // count jobs created from now on as "new" for a fresh alert
        lastSeenAt: new Date(),
      },
    })

    return NextResponse.json({ data: alert }, { status: 201 })
  } catch (err) {
    console.error('POST /api/job-alerts failed:', err)
    return NextResponse.json(
      { error: 'Failed to create job alert' },
      { status: 500 }
    )
  }
}

/** PATCH /api/job-alerts {id, userId} -> mark seen (lastSeenAt = now) */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const { id, userId } = (body ?? {}) as Record<string, unknown>
    if (typeof id !== 'string' || typeof userId !== 'string' || !id || !userId) {
      return NextResponse.json({ error: 'id and userId are required' }, { status: 400 })
    }
    const alert = await db.jobAlert.findUnique({ where: { id } })
    if (!alert || alert.userId !== userId) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    }
    const updated = await db.jobAlert.update({
      where: { id },
      data: { lastSeenAt: new Date() },
    })
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PATCH /api/job-alerts failed:', err)
    return NextResponse.json(
      { error: 'Failed to update job alert' },
      { status: 500 }
    )
  }
}

/** DELETE /api/job-alerts?id=&userId= */
export async function DELETE(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const id = sp.get('id')
    const userId = sp.get('userId')
    if (!id || !userId) {
      return NextResponse.json({ error: 'id and userId are required' }, { status: 400 })
    }
    const alert = await db.jobAlert.findUnique({ where: { id } })
    if (!alert || alert.userId !== userId) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    }
    await db.jobAlert.delete({ where: { id } })
    return NextResponse.json({ data: { deleted: true, id } })
  } catch (err) {
    console.error('DELETE /api/job-alerts failed:', err)
    return NextResponse.json(
      { error: 'Failed to delete job alert' },
      { status: 500 }
    )
  }
}
