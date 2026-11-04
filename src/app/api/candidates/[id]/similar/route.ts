// GET /api/candidates/[id]/similar?viewerId=<recruiterId>
//
// "Similar type candidates" — given one candidate, find the closest matches
// in the CV database so the recruiter can pivot from a good profile to a
// whole shortlist of look-alikes (skills first, then role, functional area,
// industry, experience proximity).
//
// SCORING (0-100):
//   • skill-token overlap (Jaccard on profile skill tokens) — 55
//   • current-role title similarity — 15
//   • same functional area — 12
//   • same industry — 8
//   • experience proximity — 10
// Candidates with ZERO skill overlap AND a different functional area are
// skipped entirely — "similar" must mean something.
//
// PRIVACY: recruiter-only (resolveRecruiter), profileVisible CANDIDATEs only,
// self excluded, contact details masked exactly like the list API, no raw
// resume text returned. Bounded pool (≤1200) like the main search engine.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'
import { maskEmail, maskPhone } from '@/lib/talent-search-engine'

export const dynamic = 'force-dynamic'

const POOL_LIMIT = 1200
const RETURN_LIMIT = 8

function tokensFromCsv(csv: string | null | undefined): string[] {
  return (csv || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2)
}

function titleTokens(title: string | null | undefined): string[] {
  return (title || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !['the', 'and', 'for', 'with', 'senior', 'junior'].includes(t))
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const viewerId = req.nextUrl.searchParams.get('viewerId') || ''
    const recruiter = await resolveRecruiter(viewerId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const anchor = await db.user.findUnique({
      where: { id },
      select: {
        id: true, role: true, profileVisible: true, skills: true, headline: true,
        industry: true, functionalArea: true, experienceYears: true,
        workExperiences: { select: { title: true, isCurrent: true } },
      },
    })
    if (!anchor || anchor.role !== 'CANDIDATE' || !anchor.profileVisible) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const anchorSkills = [...new Set(tokensFromCsv(anchor.skills))]
    const anchorTitle = anchor.workExperiences.find((w) => w.isCurrent)?.title || anchor.headline || ''
    const anchorTitleToks = new Set(titleTokens(anchorTitle))

    const pool = await db.user.findMany({
      where: { role: 'CANDIDATE', profileVisible: true, id: { not: anchor.id } },
      select: {
        id: true, name: true, headline: true, location: true, skills: true,
        experienceYears: true, expectedSalary: true, industry: true, functionalArea: true,
        email: true, phone: true, profileSource: true, lastActiveAt: true,
        workExperiences: { select: { title: true, isCurrent: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: POOL_LIMIT,
    })

    type Scored = {
      id: string; name: string; headline: string | null; location: string | null
      maskedEmail: string | null; maskedPhone: string | null
      experienceYears: number | null; expectedSalary: number | null
      industry: string | null; functionalArea: string | null
      profileSource: string | null
      topSkills: string[]
      sharedSkills: string[]
      matchPercent: number
      sameIndustry: boolean
      sameFunctionalArea: boolean
    }

    const scored: Scored[] = []
    for (const c of pool) {
      const cSkills = [...new Set(tokensFromCsv(c.skills))]
      if (cSkills.length === 0) continue
      const cSet = new Set(cSkills)
      const aSet = new Set(anchorSkills)
      const inter = [...aSet].filter((s) => cSet.has(s))
      const union = new Set([...aSet, ...cSet]).size
      const jaccard = union === 0 ? 0 : inter.length / union

      const sameFunctional = !!anchor.functionalArea && c.functionalArea === anchor.functionalArea
      const sameIndustry = !!anchor.industry && c.industry === anchor.industry
      if (jaccard === 0 && !sameFunctional) continue // not similar enough to show

      const cTitle = c.workExperiences.find((w) => w.isCurrent)?.title || c.headline || ''
      const cToks = titleTokens(cTitle)
      const titleHits = cToks.filter((t) => anchorTitleToks.has(t)).length
      const roleSim = anchorTitleToks.size === 0 || cToks.length === 0 ? 0 : titleHits / Math.min(anchorTitleToks.size, cToks.length)

      let expScore = 0
      if (anchor.experienceYears !== null && c.experienceYears !== null) {
        const dist = Math.abs(anchor.experienceYears - c.experienceYears)
        expScore = Math.max(0, 1 - dist / 8)
      }

      const overall =
        jaccard * 0.55 + roleSim * 0.15 + (sameFunctional ? 0.12 : 0) + (sameIndustry ? 0.08 : 0) + expScore * 0.1

      scored.push({
        id: c.id,
        name: c.name,
        headline: c.headline,
        location: c.location,
        maskedEmail: maskEmail(c.email),
        maskedPhone: maskPhone(c.phone),
        experienceYears: c.experienceYears,
        expectedSalary: c.expectedSalary,
        industry: c.industry,
        functionalArea: c.functionalArea,
        profileSource: c.profileSource,
        topSkills: cSkills.slice(0, 6),
        sharedSkills: inter.slice(0, 6),
        matchPercent: Math.max(1, Math.round(overall * 100)),
        sameIndustry,
        sameFunctionalArea: sameFunctional,
      })
    }

    scored.sort((a, b) => b.matchPercent - a.matchPercent)
    const top = scored.slice(0, RETURN_LIMIT)

    return NextResponse.json({
      data: {
        anchor: { id: anchor.id, skills: anchorSkills, functionalArea: anchor.functionalArea, industry: anchor.industry },
        similar: top,
        scannedPool: pool.length,
      },
    })
  } catch (err) {
    console.error('GET /api/candidates/[id]/similar failed:', err)
    return NextResponse.json({ error: 'Failed to find similar candidates' }, { status: 500 })
  }
}
