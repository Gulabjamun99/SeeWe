// SeeWe - GET /api/jobs/recommendations?userId=...
// AI-era job discovery for the candidate dashboard: ranks ACTIVE jobs the
// candidate has NOT yet applied to by
//   1. skill overlap with the candidate's profile (computeMatchScore)
//   2. experience fit against the job's range
//   3. location affinity
// and enriches each hit with matched/missing skills so the candidate sees
// exactly WHY a role is recommended (and which gaps to close).
// Candidate-safe: returns no recruiter internals and no evaluation data.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeMatchScore } from '@/lib/match'

export const dynamic = 'force-dynamic'

/** How many recent active jobs form the ranking pool. */
const POOL_SIZE = 60
/** How many recommendations reach the dashboard. */
const LIMIT = 4
/** Chip caps so cards stay clean. */
const MAX_MATCHED_CHIPS = 3
const MAX_MISSING_CHIPS = 3

function splitSkills(csv?: string | null): string[] {
  if (!csv) return []
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function locationToken(loc?: string | null): string {
  if (!loc) return ''
  return loc.split(',')[0]?.trim().toLowerCase() ?? ''
}

export async function GET(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId')?.trim()
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        skills: true,
        experienceYears: true,
        location: true,
      },
    })
    if (!user) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }
    if (user.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Recommendations are only available for candidates' },
        { status: 403 }
      )
    }

    // Exclude every job this candidate already has an application for.
    const applications = await db.application.findMany({
      where: { candidateId: userId },
      select: { jobId: true },
    })
    const appliedJobIds = applications.map((a) => a.jobId)

    const pool = await db.job.findMany({
      where: { status: 'ACTIVE', id: { notIn: appliedJobIds } },
      orderBy: { createdAt: 'desc' },
      take: POOL_SIZE,
    })

    const userSkills = splitSkills(user.skills)
    const userSkillSet = new Set(userSkills.map((s) => s.toLowerCase()))
    const userLocToken = locationToken(user.location)
    const userExp = user.experienceYears

    const ranked = pool
      .map((job) => {
        const jobSkills = splitSkills(job.skills)
        const matchPct = computeMatchScore(job.skills, user.skills)

        const matchedSkills: string[] = []
        const missingSkills: string[] = []
        // Preserve the job's own casing/order but dedupe case-insensitively.
        const seen = new Set<string>()
        for (const raw of jobSkills) {
          const key = raw.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          if (userSkillSet.has(key)) {
            if (matchedSkills.length < MAX_MATCHED_CHIPS) matchedSkills.push(raw)
          } else {
            if (missingSkills.length < MAX_MISSING_CHIPS) missingSkills.push(raw)
          }
        }

        // Experience fit: candidate years inside [min, max]; when the job has
        // no max, any experience >= min fits.
        let experienceFit: boolean | null = null
        if (userExp != null) {
          const min = job.experienceMin ?? 0
          const max = job.experienceMax
          experienceFit = userExp >= min && (max == null || userExp <= max)
        }

        const locationMatch =
          userLocToken.length > 0 &&
          locationToken(job.location).length > 0 &&
          locationToken(job.location) === userLocToken

        return {
          id: job.id,
          title: job.title,
          company: job.company,
          location: job.location,
          jobType: job.jobType,
          workMode: job.workMode,
          experienceMin: job.experienceMin,
          experienceMax: job.experienceMax,
          salaryMinLpa: job.salaryMinLpa,
          salaryMaxLpa: job.salaryMaxLpa,
          skills: job.skills,
          description: job.description,
          createdAt: job.createdAt,
          matchPct,
          matchedSkills,
          missingSkills,
          experienceFit,
          locationMatch,
        }
      })
      .sort((a, b) => {
        // Primary: skill match. Tie-breakers: experience fit, location,
        // freshness — so the top row is always the most actionable role.
        const ma = a.matchPct ?? -1
        const mb = b.matchPct ?? -1
        if (ma !== mb) return mb - ma
        if (a.experienceFit !== b.experienceFit) return a.experienceFit === true ? -1 : 1
        if (a.locationMatch !== b.locationMatch) return a.locationMatch ? -1 : 1
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      })
      .slice(0, LIMIT)

    return NextResponse.json({ data: { recommendations: ranked } })
  } catch (err) {
    console.error('[jobs/recommendations] failed:', err)
    return NextResponse.json({ error: 'Could not load recommendations' }, { status: 500 })
  }
}
