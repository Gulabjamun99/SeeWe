// /api/saved-searches/[id] — manage one saved search (owner-only).
//
// PATCH  { name?, query?, alertFrequency? }  → update fields
// DELETE                                     → remove
// POST  { recruiterId }                      → RUN: executes the stored filters
//        through the same search engine as /api/candidates, records lastRunAt,
//        computes newCount (candidates first seen since the previous run) and
//        logs a SAVED_SEARCH_RUN usage entry. The run response carries the
//        first page of results + total + newCandidateIds so the UI can show
//        "what's new since last time".

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'
import { checkQuota } from '@/lib/talent-config'
import { evaluateBooleanAst, hasSkillToken, matchesDesignation, isFreshWithin, maskEmail, maskPhone, parseBooleanQuery } from '@/lib/talent-search-engine'

export const dynamic = 'force-dynamic'

type Owner = { id: string; name: string }

async function loadOwned(id: string, recruiterId: unknown): Promise<{ saved: Awaited<ReturnType<typeof db.savedSearch.findUnique>>; recruiter: Owner } | null> {
  const recruiter = await resolveRecruiter(recruiterId)
  if (!recruiter) return null
  if (typeof id !== 'string' || id.trim() === '') return null
  const saved = await db.savedSearch.findUnique({ where: { id: id.trim() } })
  if (!saved || saved.recruiterId !== recruiter.id) return null
  return { saved, recruiter }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const owned = await loadOwned(id, body?.recruiterId)
    if (!owned) {
      return NextResponse.json({ error: 'Saved search not found' }, { status: 404 })
    }
    const data: Record<string, unknown> = {}
    if (typeof body?.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 60)
    if (typeof body?.query === 'string' && body.query.length <= 8000) data.query = body.query
    if (typeof body?.alertFrequency === 'string' && ['OFF', 'DAILY', 'WEEKLY'].includes(body.alertFrequency)) {
      data.alertFrequency = body.alertFrequency
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    try {
      const updated = await db.savedSearch.update({ where: { id: owned.saved!.id }, data })
      return NextResponse.json({ data: updated })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return NextResponse.json({ error: 'You already have a search with that name' }, { status: 409 })
      }
      throw err
    }
  } catch (err) {
    console.error('PATCH /api/saved-searches/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to update saved search' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const owned = await loadOwned(id, body?.recruiterId ?? req.nextUrl.searchParams.get('recruiterId'))
    if (!owned) {
      return NextResponse.json({ error: 'Saved search not found' }, { status: 404 })
    }
    await db.savedSearch.delete({ where: { id: owned.saved!.id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/saved-searches/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to delete saved search' }, { status: 500 })
  }
}

/** RUN — execute the saved filters through the same engine as /api/candidates. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const owned = await loadOwned(id, body?.recruiterId)
    if (!owned) {
      return NextResponse.json({ error: 'Saved search not found' }, { status: 404 })
    }
    const quota = await checkQuota(owned.recruiter.id, 'SAVED_SEARCH_RUN')
    if (!quota.allowed) {
      return NextResponse.json(
        { error: `Daily saved-search run limit reached (${quota.limit}/day).` },
        { status: 429 }
      )
    }

    const filters = JSON.parse(owned.saved!.query || '{}') as Record<string, string>
    const prevRunAt = owned.saved!.lastRunAt

    // rebuild the engine query — identical semantics to /api/candidates
    const where: Record<string, unknown> = { role: 'CANDIDATE', profileVisible: true, disabled: false }
    const minE = Number(filters.minExperience) || undefined
    const maxE = Number(filters.maxExperience) || undefined
    const minCTC = Number(filters.minCTC) || undefined
    const maxCTC = Number(filters.maxCTC) || undefined
    const noticeMax = Number(filters.noticeMax) || undefined
    const lastActiveDays = Number(filters.lastActiveDays) || undefined
    const AND: Record<string, unknown>[] = []
    if (minE !== undefined) AND.push({ experienceYears: { gte: minE } })
    if (maxE !== undefined) AND.push({ experienceYears: { lte: maxE } })
    if (minCTC !== undefined) AND.push({ expectedSalary: { gte: minCTC } })
    if (maxCTC !== undefined) AND.push({ expectedSalary: { lte: maxCTC } })
    if (noticeMax !== undefined) AND.push({ noticePeriodDays: { lte: noticeMax } })
    if (lastActiveDays !== undefined) {
      AND.push({ lastActiveAt: { gte: new Date(Date.now() - lastActiveDays * 86400000) } })
    }
    if (AND.length) where.AND = AND

    const pool = await db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 1200,
      select: {
        id: true, name: true, email: true, headline: true, skills: true, resumeText: true, location: true,
        industry: true, functionalArea: true, experienceYears: true, expectedSalary: true,
        workExperiences: { select: { title: true, company: true, isCurrent: true } },
      },
    })

    const q = (filters.q || '').trim()
    const parsed = q ? parseBooleanQuery(q) : null
    if (q && parsed && !parsed.ok) {
      return NextResponse.json(
        { error: 'Stored query is no longer valid', syntaxError: parsed.error },
        { status: 400 }
      )
    }
    const mandatory = (filters.skillsMandatory || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const preferred = (filters.skillsPreferred || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const excludedSkills = (filters.skillsExcluded || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const excludeTerms = (filters.exclude || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const locations = (filters.locations || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    const industry = (filters.industry || '').trim().toLowerCase()
    const functionalArea = (filters.functionalArea || '').trim().toLowerCase()
    const designation = (filters.designation || '').trim().toLowerCase()

    const matched = pool.filter((u) => {
      const hay = [
        u.headline, u.name, u.skills, u.resumeText, u.location, u.industry, u.functionalArea,
        ...u.workExperiences.map((w) => `${w.title} ${w.company}`),
      ].filter(Boolean).map((f) => (f as string).toLowerCase())
      if (mandatory.length && !mandatory.every((s) => hasSkillToken(u.skills, s))) return false
      if (preferred.length && !preferred.some((s) => hasSkillToken(u.skills, s))) return false
      if (excludedSkills.length && excludedSkills.some((s) => hasSkillToken(u.skills, s))) return false
      if (designation) {
        const current = u.workExperiences.find((w) => w.isCurrent)?.title || ''
        if (!matchesDesignation(u.headline, designation) && !matchesDesignation(current, designation)) return false
      }
      if (industry && !(u.industry || '').toLowerCase().includes(industry)) return false
      if (functionalArea && !(u.functionalArea || '').toLowerCase().includes(functionalArea)) return false
      if (locations.length && !locations.some((l) => (u.location || '').toLowerCase().includes(l))) return false
      if (excludeTerms.length && excludeTerms.some((t) => hay.some((f) => f.includes(t)))) return false
      if (parsed && parsed.ok && !evaluateBooleanAst(parsed.ast, hay)) return false
      return true
    })

    // new since the previous run (cap the stored count; full list returned here)
    const newIds = prevRunAt
      ? matched
          .filter((u) => u.createdAt > prevRunAt)
          .map((u) => u.id)
      : []

    await db.savedSearch.update({
      where: { id: owned.saved!.id },
      data: {
        lastRunAt: new Date(),
        newCount: newIds.length,
        // alert-frequency policy: a WEEKLY alert only "notifies" when the last
        // notification is ≥7 days old; DAILY ≥1 day. The newCount panel makes
        // this visible either way (no background scheduler in this stack).
        lastNotifiedAt:
          owned.saved!.alertFrequency === 'OFF'
            ? owned.saved!.lastNotifiedAt
            : !owned.saved!.lastNotifiedAt ||
              Date.now() - owned.saved!.lastNotifiedAt.getTime() >=
                (owned.saved!.alertFrequency === 'DAILY' ? 86400000 : 7 * 86400000)
              ? new Date()
              : owned.saved!.lastNotifiedAt,
      },
    })

    await db.usageLog.create({
      data: { actorId: owned.recruiter.id, kind: 'SAVED_SEARCH_RUN', meta: JSON.stringify({ savedSearchId: owned.saved!.id, resultCount: matched.length, newCount: newIds.length }) },
    }).catch(() => undefined)

    const page = matched.slice(0, 20).map((u) => ({
      id: u.id,
      name: u.name,
      headline: u.headline,
      skills: u.skills,
      location: u.location,
      experienceYears: u.experienceYears,
      expectedSalary: u.expectedSalary,
      emailMasked: maskEmail(u.email || undefined),
      phoneMasked: null,
      isNew: prevRunAt ? u.createdAt > prevRunAt : true,
    }))

    return NextResponse.json({
      data: {
        results: page,
        total: matched.length,
        newCount: newIds.length,
        newCandidateIds: newIds.slice(0, 200),
        ranAt: new Date().toISOString(),
      },
    })
  } catch (err) {
    console.error('POST /api/saved-searches/[id] failed:', err)
    return NextResponse.json({ error: 'Failed to run saved search' }, { status: 500 })
  }
}
