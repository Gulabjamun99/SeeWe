import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/companies - company directory for the seeker-side company profile dialog.
//   ?name= absent -> aggregated stats for every company with ACTIVE jobs
//                    (jobsCount / openingsTotal / unique locations / salary band).
//   ?name= given  -> one company (trimmed, case-insensitive match) with its full
//                    ACTIVE job rows in the same shape /api/jobs returns
//                    (includes recruiter profile + _count.applications), newest first.
export async function GET(req: NextRequest) {
  try {
    const name = (req.nextUrl.searchParams.get('name') || '').trim()

    // SQLite can't do case-insensitive compares in the query -> fetch ACTIVE
    // jobs and aggregate/match in JS (bounded, same approach as /api/jobs).
    const jobs = await db.job.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        _count: { select: { applications: true } },
        recruiter: {
          select: { id: true, name: true, company: true, avatarSeed: true },
        },
      },
    })

    // ----- single company mode -----
    if (name) {
      const lower = name.toLowerCase()
      const match = jobs.filter((j) => j.company.toLowerCase() === lower)
      if (match.length === 0) {
        return NextResponse.json({ error: 'Company not found' }, { status: 404 })
      }
      return NextResponse.json({ data: { name: match[0].company, jobs: match } })
    }

    // ----- directory mode -----
    interface CompanyRow {
      name: string
      jobsCount: number
      openingsTotal: number
      locations: string[]
      salaryMinLpa: number | null
      salaryMaxLpa: number | null
    }
    const byKey = new Map<string, CompanyRow>()
    for (const job of jobs) {
      const key = job.company.toLowerCase()
      let row = byKey.get(key)
      if (!row) {
        row = {
          name: job.company,
          jobsCount: 0,
          openingsTotal: 0,
          locations: [],
          salaryMinLpa: null,
          salaryMaxLpa: null,
        }
        byKey.set(key, row)
      }
      row.jobsCount += 1
      row.openingsTotal += job.openings
      if (job.location && !row.locations.includes(job.location) && row.locations.length < 6) {
        row.locations.push(job.location)
      }
      if (job.salaryMinLpa != null) {
        row.salaryMinLpa = row.salaryMinLpa == null ? job.salaryMinLpa : Math.min(row.salaryMinLpa, job.salaryMinLpa)
      }
      if (job.salaryMaxLpa != null) {
        row.salaryMaxLpa = row.salaryMaxLpa == null ? job.salaryMaxLpa : Math.max(row.salaryMaxLpa, job.salaryMaxLpa)
      }
    }

    const data = Array.from(byKey.values()).sort(
      (a, b) => b.jobsCount - a.jobsCount || b.openingsTotal - a.openingsTotal
    )

    return NextResponse.json({ data })
  } catch (err) {
    console.error('GET /api/companies failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch companies' },
      { status: 500 }
    )
  }
}
