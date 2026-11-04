// SeeWe - GET /api/salary-insights?keyword=&location=
// Dedicated salary-benchmark endpoint powering the opt-in Salary Insights
// page. Nothing here is pushed onto other surfaces — people open it on
// purpose.
//
// DATA SOURCES (the honest logic):
//   1. ACTIVE JOB POSTINGS — the salaryMin/MaxLpa bands recruiters declare on
//      each live posting. This is "what the market is offering".
//   2. CANDIDATE EXPECTATIONS — expectedSalary from candidate profiles whose
//      headline matches the same role cluster. This is "what talent asks".
//      Shown ONLY in aggregate and ONLY when a cluster has >= 3 matching
//      candidates (k-anonymity floor) so no individual's number can leak.
//
// AGGREGATION LOGIC:
//   - Titles are normalized into role clusters (seniority words like
//     "senior"/"lead"/"intern" are stripped so Staff/Senior/Junior Frontend
//     Engineer land in one "frontend engineer" cluster).
//   - Each cluster reports: postings band (min/max), p25 / median / p75 of
//     band midpoints, candidate-ask median (privacy-gated), top skills and
//     top locations by frequency.
//   - Computed live on request — nothing is persisted, so numbers always
//     reflect the current postings and profiles.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** Clusters with fewer matching candidates than this never reveal an ask-median. */
const K_ANONYMITY = 3
const MAX_CLUSTERS = 12

interface SalaryRow {
  key: string
  label: string
  samplePostings: number
  sampleCandidates: number
  bandMin: number | null
  bandMax: number | null
  p25: number | null
  median: number | null
  p75: number | null
  candidateAskMedian: number | null
  candidateAskSample: number
  topSkills: string[]
  topLocations: string[]
  confidence: 'high' | 'medium' | 'low'
}

const SENIORITY_TOKENS = new Set([
  'senior', 'junior', 'sr', 'jr', 'lead', 'staff', 'principal', 'head',
  'intern', 'internship', 'trainee', 'associate', 'assistant', 'graduate',
  'entry', 'level', 'sr.', 'jr.', 'i', 'ii', 'iii', '1', '2', '3',
])

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9+ ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !SENIORITY_TOKENS.has(t))
    .join(' ')
    .trim()
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.round(((sorted.length - 1) * p) / 100)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.max(0, idx))] * 10) / 10
}

function topN(counter: Map<string, number>, n: number): string[] {
  return [...counter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k)
}

export async function GET(request: NextRequest) {
  try {
    const keyword = request.nextUrl.searchParams.get('keyword')?.trim().toLowerCase() ?? ''
    const location = request.nextUrl.searchParams.get('location')?.trim().toLowerCase() ?? ''

    // ---------------- source 1: live postings ----------------
    const jobs = await db.job.findMany({
      where: { status: 'ACTIVE' },
      select: {
        title: true,
        company: true,
        location: true,
        skills: true,
        salaryMinLpa: true,
        salaryMaxLpa: true,
      },
    })

    const filteredJobs = jobs.filter((j) => {
      if (
        keyword &&
        ![j.title, j.skills, j.company].some((f) => (f || '').toLowerCase().includes(keyword))
      ) {
        return false
      }
      if (location && !(j.location || '').toLowerCase().includes(location)) return false
      return true
    })

    // ---------------- source 2: candidate expectations ----------------
    const candidates = await db.user.findMany({
      where: { role: 'CANDIDATE', expectedSalary: { not: null } },
      select: {
        headline: true,
        skills: true,
        location: true,
        expectedSalary: true,
      },
    })

    // ---------------- cluster both sources by normalized role ----------------
    interface Cluster {
      labelCounts: Map<string, number>
      mins: number[]
      maxs: number[]
      midpoints: number[]
      asks: number[]
      skills: Map<string, number>
      locations: Map<string, number>
      candidates: number
    }

    const clusters = new Map<string, Cluster>()
    const ensure = (key: string): Cluster => {
      let c = clusters.get(key)
      if (!c) {
        c = {
          labelCounts: new Map(),
          mins: [],
          maxs: [],
          midpoints: [],
          asks: [],
          skills: new Map(),
          locations: new Map(),
          candidates: 0,
        }
        clusters.set(key, c)
      }
      return c
    }

    for (const j of filteredJobs) {
      const min = j.salaryMinLpa ?? 0
      const max = j.salaryMaxLpa ?? 0
      const effMin = min || max
      const effMax = max || min
      if (effMax <= 0) continue
      const key = normalizeTitle(j.title)
      if (!key) continue
      const c = ensure(key)
      c.labelCounts.set(j.title, (c.labelCounts.get(j.title) ?? 0) + 1)
      c.mins.push(effMin)
      c.maxs.push(effMax)
      c.midpoints.push((effMin + effMax) / 2)
      for (const s of (j.skills || '').split(',')) {
        const t = s.trim()
        if (t) c.skills.set(t, (c.skills.get(t) ?? 0) + 1)
      }
      const city = (j.location || '').split(',')[0]?.trim()
      if (city) c.locations.set(city, (c.locations.get(city) ?? 0) + 1)
    }

    // Candidates join the cluster whose normalized key appears in their
    // headline. Longest-key match wins so "data engineer" beats "engineer".
    const sortedKeys = [...clusters.keys()].sort((a, b) => b.length - a.length)
    for (const cand of candidates) {
      const normHeadline = normalizeTitle(cand.headline || '')
      if (!normHeadline) continue
      const key = sortedKeys.find((k) => normHeadline.includes(k))
      if (!key) continue
      const ask = cand.expectedSalary
      if (ask == null || !Number.isFinite(ask) || (ask as number) <= 0) continue
      clusters.get(key)!.asks.push(ask as number)
      clusters.get(key)!.candidates += 1
    }

    // ---------------- shape rows ----------------
    const rows: SalaryRow[] = []
    for (const [key, c] of clusters) {
      const dataPoints = c.midpoints.length
      if (dataPoints === 0) continue
      const sortedMid = [...c.midpoints].sort((a, b) => a - b)
      const sortedAsks = [...c.asks].sort((a, b) => a - b)
      const label = topN(c.labelCounts, 1)[0] ?? key
      rows.push({
        key,
        label,
        samplePostings: dataPoints,
        sampleCandidates: c.candidates,
        bandMin: c.mins.length ? Math.min(...c.mins) : null,
        bandMax: c.maxs.length ? Math.max(...c.maxs) : null,
        p25: percentile(sortedMid, 25),
        median: percentile(sortedMid, 50),
        p75: percentile(sortedMid, 75),
        candidateAskMedian:
          sortedAsks.length >= K_ANONYMITY ? percentile(sortedAsks, 50) : null,
        candidateAskSample: sortedAsks.length,
        topSkills: topN(c.skills, 5),
        topLocations: topN(c.locations, 3),
        confidence: dataPoints >= 8 ? 'high' : dataPoints >= 4 ? 'medium' : 'low',
      })
    }

    rows.sort(
      (a, b) =>
        b.samplePostings + b.sampleCandidates - (a.samplePostings + a.sampleCandidates)
    )

    const limited = rows.slice(0, MAX_CLUSTERS)

    // Market-wide row across every filtered posting.
    let overall: SalaryRow | null = null
    if (limited.length > 0) {
      const allMids = filteredJobs
        .map((j) => {
          const min = j.salaryMinLpa ?? 0
          const max = j.salaryMaxLpa ?? 0
          const effMin = min || max
          const effMax = max || min
          return effMax > 0 ? (effMin + effMax) / 2 : null
        })
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b)
      const allAsks = candidates
        .map((c) => c.expectedSalary as number)
        .filter((v) => Number.isFinite(v) && v > 0)
        .sort((a, b) => a - b)
      overall = {
        key: '__market__',
        label: 'All roles in this view',
        samplePostings: filteredJobs.length,
        sampleCandidates: candidates.length,
        bandMin: filteredJobs.length
          ? Math.min(...filteredJobs.map((j) => (j.salaryMinLpa ?? 0) || (j.salaryMaxLpa ?? 0) || 0))
          : null,
        bandMax: filteredJobs.length
          ? Math.max(...filteredJobs.map((j) => (j.salaryMaxLpa ?? 0) || (j.salaryMinLpa ?? 0) || 0))
          : null,
        p25: percentile(allMids, 25),
        median: percentile(allMids, 50),
        p75: percentile(allMids, 75),
        candidateAskMedian:
          allAsks.length >= K_ANONYMITY ? percentile(allAsks, 50) : null,
        candidateAskSample: allAsks.length,
        topSkills: [],
        topLocations: [],
        confidence: filteredJobs.length >= 8 ? 'high' : filteredJobs.length >= 4 ? 'medium' : 'low',
      }
    }

    return NextResponse.json({
      data: {
        rows: limited,
        overall,
        meta: {
          postingsScanned: filteredJobs.length,
          candidatesScanned: candidates.length,
          clusterCount: rows.length,
          minSampleForAskMedian: K_ANONYMITY,
          generatedAt: new Date().toISOString(),
        },
      },
    })
  } catch (err) {
    console.error('[salary-insights] failed:', err)
    return NextResponse.json({ error: 'Could not compute salary insights' }, { status: 500 })
  }
}
