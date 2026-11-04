import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { CareerPageJob } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/career-page?clientId=... — public data feed for a client's branded
 * careers page (deep link /?career={clientId}).
 *
 * Returns the company identity plus its ACTIVE jobs, newest first. Jobs are
 * matched by company name (case-insensitive) against the Client record — the
 * in-house model keeps Job.company as the recruiter's employer brand. The
 * description is trimmed to 500 chars for a public listing teaser.
 */
export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get('clientId')?.trim()
    if (!clientId) {
      return NextResponse.json({ error: 'clientId query param is required' }, { status: 400 })
    }

    const client = await db.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, industry: true },
    })
    if (!client) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    // SQLite has no case-insensitive equality filter — match in memory over
    // the (small) ACTIVE job set so "technova solutions" === "TechNova Solutions".
    const activeJobs = await db.job.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        company: true,
        location: true,
        jobType: true,
        workMode: true,
        experienceMin: true,
        experienceMax: true,
        salaryMinLpa: true,
        salaryMaxLpa: true,
        skills: true,
        description: true,
        createdAt: true,
        openings: true,
      },
    })

    const companyLower = client.name.toLowerCase()
    const jobs: CareerPageJob[] = activeJobs
      .filter((j) => (j.company ?? '').trim().toLowerCase() === companyLower)
      .map((j) => ({
        id: j.id,
        title: j.title,
        company: j.company,
        location: j.location,
        jobType: j.jobType,
        workMode: j.workMode,
        experienceMin: j.experienceMin,
        experienceMax: j.experienceMax,
        salaryMinLpa: j.salaryMinLpa,
        salaryMaxLpa: j.salaryMaxLpa,
        skills: j.skills,
        description: (j.description ?? '').slice(0, 500),
        // JSON-serialise the Prisma Date so the wire type matches the contract
        createdAt: j.createdAt.toISOString(),
        openings: j.openings,
      }))

    return NextResponse.json({
      data: {
        company: { name: client.name, industry: client.industry },
        jobs,
      },
    })
  } catch (err) {
    console.error('GET /api/career-page failed:', err)
    return NextResponse.json({ error: 'Failed to load career page' }, { status: 500 })
  }
}
