// SeeWe - GET /api/analytics?userId=...
// Recruiter-only analytics feed powering the Hiring Hub analytics upgrade:
//   * bySource  — per-application-source ROI rows (all 4 channels, zero rows included)
//   * funnel    — overall 5-stage funnel: Applied → Shortlisted → Interviewed → Offered → Hired
//   * velocity  — avg time-to-offer (createdAt → offeredAt) + first-response SLA (createdAt → viewedAt)
//
// Honest-metrics note: there is no offer-accepted timestamp field, so the velocity
// metric is time-to-OFFER (when the offer was sent), never time-to-hire.
//
// Raw SQL on purpose: a long-lived server process can hold a Prisma client generated
// BEFORE the Application.source / screenVerdict / offeredAt / offerStatus columns
// existed (schema pushes only regenerate the client on disk), so typed selects on
// those fields would fail validation there. $queryRaw bypasses DMMF validation and
// behaves identically with stale or freshly generated clients (same pattern as the
// clients retention route).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

const SOURCES = ['DIRECT', 'SHARED_LINK', 'CAREER_PAGE', 'REFERRAL'] as const

const SOURCE_LABELS: Record<string, string> = {
  DIRECT: 'Direct',
  SHARED_LINK: 'Shared link',
  CAREER_PAGE: 'Career page',
  REFERRAL: 'Referral',
}

// Status ladder — "reached at least stage X" sets (APPLIED / REJECTED never count as progress)
const REACHED_SHORTLIST = new Set([
  'SHORTLISTED',
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'SHARED_WITH_CLIENT',
  'OFFERED',
  'HIRED',
  'ONBOARDED',
])
const REACHED_INTERVIEW = new Set([
  'INTERVIEW_SCHEDULED',
  'INTERVIEWED',
  'SHARED_WITH_CLIENT',
  'OFFERED',
  'HIRED',
  'ONBOARDED',
])
const REACHED_OFFER = new Set(['OFFERED', 'HIRED', 'ONBOARDED'])
const REACHED_HIRED = new Set(['HIRED', 'ONBOARDED'])

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function timeOf(value: Date | string): number {
  return new Date(value as unknown as string).getTime()
}

interface AnalyticsAppRow {
  id: string
  status: string
  source: string | null
  createdAt: Date | string
  viewedAt: Date | string | null
  offeredAt: Date | string | null
  offerStatus: string | null
}

// GET /api/analytics?userId=<recruiterId>
export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')?.trim()
    if (!userId) {
      return NextResponse.json({ error: 'userId query param is required' }, { status: 400 })
    }

    const caller = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!caller) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (caller.role !== 'RECRUITER') {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const apps = await db.$queryRaw<AnalyticsAppRow[]>`
      SELECT "id", "status", "source", "createdAt", "viewedAt", "offeredAt", "offerStatus"
      FROM "Application"
      WHERE "jobId" IN (SELECT "id" FROM "Job" WHERE "recruiterId" = ${userId})`

    // ----- Source ROI: one row per channel, zero rows included so the UI stays stable -----
    const bySource = SOURCES.map((source) => {
      const rows = apps.filter((a) => (a.source ?? 'DIRECT') === source)
      const shortlisted = rows.filter((a) => REACHED_SHORTLIST.has(a.status)).length
      const interviewed = rows.filter((a) => REACHED_INTERVIEW.has(a.status)).length
      const hired = rows.filter((a) => REACHED_HIRED.has(a.status)).length
      return {
        source,
        label: SOURCE_LABELS[source] ?? source,
        applications: rows.length,
        shortlisted,
        interviewed,
        hired,
        hirePct: rows.length > 0 ? round1((hired / rows.length) * 100) : 0,
      }
    })

    // ----- Overall 5-stage funnel -----
    const funnel = [
      { key: 'applied', label: 'Applied', count: apps.length },
      {
        key: 'shortlisted',
        label: 'Shortlisted',
        count: apps.filter((a) => REACHED_SHORTLIST.has(a.status)).length,
      },
      {
        key: 'interviewed',
        label: 'Interviewed',
        count: apps.filter((a) => REACHED_INTERVIEW.has(a.status)).length,
      },
      {
        key: 'offered',
        label: 'Offered',
        // reached the Offer stage = OFFERED/HIRED/ONBOARDED status, or any offer lifecycle signal
        count: apps.filter((a) => REACHED_OFFER.has(a.status) || Boolean(a.offerStatus)).length,
      },
      {
        key: 'hired',
        label: 'Hired',
        count: apps.filter((a) => REACHED_HIRED.has(a.status)).length,
      },
    ]

    // ----- Hiring velocity (honest labels) -----
    // No acceptedAt exists in the schema, and updatedAt is bumped by every touch,
    // so "time-to-hire" is reported honestly as time-to-OFFER: createdAt → offeredAt.
    const withOffer = apps.filter((a) => a.offeredAt != null)
    const timeToOfferDays =
      withOffer.length > 0
        ? round1(
            withOffer.reduce(
              (acc, a) => acc + (timeOf(a.offeredAt!) - timeOf(a.createdAt)) / DAY_MS,
              0
            ) / withOffer.length
          )
        : null

    // First-response SLA: how long candidates waited before the recruiter first engaged.
    const withView = apps.filter((a) => a.viewedAt != null)
    const avgFirstResponseHours =
      withView.length > 0
        ? round1(
            withView.reduce(
              (acc, a) => acc + (timeOf(a.viewedAt!) - timeOf(a.createdAt)) / HOUR_MS,
              0
            ) / withView.length
          )
        : null

    return NextResponse.json({
      data: {
        bySource,
        funnel,
        timeToOfferDays,
        avgFirstResponseHours,
        totalApplications: apps.length,
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('GET /api/analytics failed:', err)
    return NextResponse.json({ error: 'Failed to compute analytics' }, { status: 500 })
  }
}
