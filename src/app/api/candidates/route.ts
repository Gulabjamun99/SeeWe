import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import {
  parseBooleanQuery,
  evaluateBooleanAst,
  collectTerms,
  hasSkillToken,
  matchesDesignation,
  isFreshWithin,
  maskEmail,
  maskPhone,
} from '@/lib/talent-search-engine'
import { resolveRecruiter } from '@/lib/folder-guards'

export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/candidates — the talent search engine.
//
// Server-side everything: DB prefilter (numeric/date conditions) → bounded
// pool → precise JS matching (SQLite has no case-insensitive contains) →
// sorting → PAGINATION. The full candidate table is never sent to a client.
//
// PRIVACY (enforced here, not in the UI):
//   • only role=CANDIDATE, profileVisible=true, enabled accounts
//   • employer-block: candidates whose current employer equals the
//     recruiter's own company/client are never returned
//   • currentEmployer is stripped from every record
//   • email/phone are MASKED; reveal happens via /api/candidates/[id]/contact
//     (logged + quota-tracked)
//   • free-text resume is scrubbed of emails/phone numbers
//   • cvData/photoData (heavy blobs) are never selected — presence flags only
// ─────────────────────────────────────────────────────────────────────────────

const POOL_CAP = 1200

const CANDIDATE_SELECT = {
  id: true,
  email: true,
  name: true,
  phone: true,
  headline: true,
  location: true,
  company: true,
  skills: true,
  experienceYears: true,
  currentSalary: true,
  expectedSalary: true,
  education: true,
  resumeText: true,
  avatarSeed: true,
  noticePeriodDays: true,
  githubUrl: true,
  linkedinUrl: true,
  behanceUrl: true,
  portfolioUrl: true,
  videoResumePath: true,
  videoResumeSeconds: true,
  videoResumeIntro: true,
  currentEmployer: true,
  industry: true,
  functionalArea: true,
  employmentTypePref: true,
  preferredLocations: true,
  languages: true,
  lastActiveAt: true,
  profileSource: true,
  desiredRole: true,
  desiredLocations: true,
  desiredJobType: true,
  desiredIndustry: true,
  cvFileName: true,
  cvMimeType: true,
  cvUploadedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect

function numParam(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function csvParam(v: string | null, cap = 12): string[] {
  if (!v) return []
  return v
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, cap)
}

const includesCI = (field: string | null | undefined, term: string): boolean =>
  !!field && field.toLowerCase().includes(term)

/** Remove emails/phone numbers from free text before it leaves the server. */
function scrubContact(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email hidden]')
    .replace(/(\+?\d[\d\s-]{8,}\d)/g, '[phone hidden]')
}

// Employer-block normalisation (trim+lowercase).
function normaliseCompany(v: string | null | undefined): string {
  return (v || '').trim().toLowerCase()
}

async function employerBlockNames(recruiterId: string): Promise<Set<string>> {
  const blocked = new Set<string>()
  const recruiter = await db.user.findUnique({
    where: { id: recruiterId },
    select: { company: true, clientId: true },
  })
  if (!recruiter) return blocked
  const norm = normaliseCompany(recruiter.company)
  if (norm) blocked.add(norm)
  if (recruiter.clientId) {
    const client = await db.client.findUnique({
      where: { id: recruiter.clientId },
      select: { name: true },
    })
    const clientNorm = normaliseCompany(client?.name)
    if (clientNorm) blocked.add(clientNorm)
  }
  return blocked
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const recruiterId = (sp.get('recruiterId') || '').trim()

    // AUTHORIZATION: talent search is recruiter-only, enforced server-side.
    // WITHOUT a recruiter identity this endpoint returns ONLY the aggregate
    // candidate count (used by the public landing-page stats) — never any
    // profile data.
    const recruiter = await resolveRecruiter(recruiterId || null)
    if (!recruiter) {
      if (!recruiterId) {
        const total = await db.user.count({
          where: { role: 'CANDIDATE', profileVisible: true, disabled: false },
        })
        return NextResponse.json({ total, data: [] })
      }
      return NextResponse.json(
        { error: 'Recruiter access required' },
        { status: 403 }
      )
    }

    // ── keywords / boolean ────────────────────────────────────────────────
    const rawKeyword = (sp.get('q') || sp.get('keyword') || '').trim()
    const excludeTerms = csvParam(sp.get('exclude'), 12)

    // ── skills (token-exact: Java ≠ JavaScript) ───────────────────────────
    const skillsMandatory = csvParam(sp.get('skillsMandatory'), 10)
    const skillsPreferred = csvParam(sp.get('skillsPreferred'), 10)
    const skillsExcluded = csvParam(sp.get('skillsExcluded'), 10)
    const legacySkill = (sp.get('skill') || '').trim()

    // ── designation / employers ───────────────────────────────────────────
    const designation = (sp.get('designation') || '').trim().toLowerCase().slice(0, 60)
    const employerCurrent = (sp.get('employerCurrent') || '').trim().toLowerCase().slice(0, 60)
    const employerPrevious = (sp.get('employerPrevious') || '').trim().toLowerCase().slice(0, 60)

    // ── classification ────────────────────────────────────────────────────
    const industry = (sp.get('industry') || '').trim().toLowerCase().slice(0, 60)
    const functionalArea = (sp.get('functionalArea') || '').trim().toLowerCase().slice(0, 60)
    const employmentType = (sp.get('employmentType') || '').trim().toLowerCase().slice(0, 20)
    const languages = csvParam(sp.get('languages'), 6)

    // ── locations / education ─────────────────────────────────────────────
    const locations = csvParam(sp.get('locations'), 8)
    const legacyLocation = (sp.get('location') || '').trim().toLowerCase()
    const education = (sp.get('education') || '').trim().toLowerCase().slice(0, 60)
    const institute = (sp.get('institute') || '').trim().toLowerCase().slice(0, 60)

    // ── ranges ────────────────────────────────────────────────────────────
    const minExperience = numParam(sp.get('minExperience'))
    const maxExperience = numParam(sp.get('maxExperience'))
    const minCTC = numParam(sp.get('minCTC') ?? sp.get('minExpectedSalary'))
    const maxCTC = numParam(sp.get('maxCTC') ?? sp.get('maxExpectedSalary'))
    const minCurrentCTC = numParam(sp.get('minCurrentCTC'))
    const maxCurrentCTC = numParam(sp.get('maxCurrentCTC'))
    const noticeMax = numParam(sp.get('noticeMax') ?? sp.get('noticePeriodDaysMax'))

    // ── freshness ─────────────────────────────────────────────────────────
    const lastActiveDays = numParam(sp.get('lastActiveDays'))
    const updatedWithinDays = numParam(sp.get('updatedWithinDays'))

    // ── search-within-results ─────────────────────────────────────────────
    const withinIds = csvParam(sp.get('within'), 400)

    // ── pipeline handoff (legacy outreach param) ──────────────────────────
    const excludeJobId = sp.get('notAppliedToJobId') || sp.get('recruiterJobsFor') || ''

    // ── pagination + sort ─────────────────────────────────────────────────
    const page = Math.max(1, numParam(sp.get('page')) ?? 1)
    const pageSize = Math.min(50, Math.max(5, numParam(sp.get('pageSize')) ?? 20))
    const sort = (sp.get('sort') || 'auto').trim()

    // parse the boolean/keyword query (STRICT — syntax errors are 400s)
    let parsed: ReturnType<typeof parseBooleanQuery> | null = null
    if (rawKeyword) {
      parsed = parseBooleanQuery(rawKeyword)
      if (!parsed.ok) {
        return NextResponse.json(
          {
            error: 'Invalid search query',
            syntaxError: parsed.error,
          },
          { status: 400 }
        )
      }
    }
    const plainKeyword = parsed === null && rawKeyword ? rawKeyword.toLowerCase() : ''

    let excluded: Set<string> = new Set()
    if (excludeJobId) {
      const apps = await db.application.findMany({
        where: { jobId: excludeJobId },
        select: { candidateId: true },
      })
      excluded = new Set(apps.map((a) => a.candidateId))
    }

    const blockedEmployers = await employerBlockNames(recruiter.id)

    // ── DB-level prefilter (numeric/date/boolean only — SQLite contains is
    //    case-sensitive, so text matching happens in JS on the bounded pool).
    const where: Prisma.UserWhereInput = {
      role: 'CANDIDATE',
      profileVisible: true,
      disabled: false,
      ...(withinIds.length > 0
        ? { id: { in: withinIds } }
        : {
            AND: [
              ...(minExperience !== undefined ? [{ experienceYears: { gte: minExperience } }] : []),
              ...(maxExperience !== undefined ? [{ experienceYears: { lte: maxExperience } }] : []),
              ...(minCTC !== undefined ? [{ expectedSalary: { gte: minCTC } }] : []),
              ...(maxCTC !== undefined ? [{ expectedSalary: { lte: maxCTC } }] : []),
              ...(minCurrentCTC !== undefined ? [{ currentSalary: { gte: minCurrentCTC } }] : []),
              ...(maxCurrentCTC !== undefined ? [{ currentSalary: { lte: maxCurrentCTC } }] : []),
              ...(noticeMax !== undefined ? [{ noticePeriodDays: { lte: noticeMax } }] : []),
              ...(lastActiveDays !== undefined
                ? [{ lastActiveAt: { gte: new Date(Date.now() - lastActiveDays * 86400000) } }]
                : []),
              ...(updatedWithinDays !== undefined
                ? [{ updatedAt: { gte: new Date(Date.now() - updatedWithinDays * 86400000) } }]
                : []),
            ],
          }),
    } satisfies Prisma.UserWhereInput

    const pool = await db.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: withinIds.length > 0 ? 400 : POOL_CAP,
      select: {
        ...CANDIDATE_SELECT,
        workExperiences: { select: { title: true, company: true, isCurrent: true } },
        educationEntries: { select: { degree: true, institution: true } },
        certifications: { select: { name: true, issuer: true, year: true } },
      },
    })

    const searchFields = (u: (typeof pool)[number]): string[] =>
      [
        u.headline,
        u.name,
        u.skills,
        u.resumeText,
        u.location,
        u.industry,
        u.functionalArea,
        u.education,
        ...u.workExperiences.map((w) => `${w.title} ${w.company}`),
        ...u.educationEntries.map((e) => `${e.degree} ${e.institution}`),
        ...u.certifications.map((c) => c.name),
      ]
        .filter(Boolean)
        .map((f) => (f as string).toLowerCase())

    const filtered = pool.filter((u) => {
      if (excluded.has(u.id)) return false
      // privacy shield: their employer's recruiters never see them
      if (
        blockedEmployers.size > 0 &&
        u.currentEmployer &&
        blockedEmployers.has(normaliseCompany(u.currentEmployer))
      ) {
        return false
      }
      if (skillsMandatory.length > 0 && !skillsMandatory.every((s) => hasSkillToken(u.skills, s))) return false
      if (skillsPreferred.length > 0 && !skillsPreferred.some((s) => hasSkillToken(u.skills, s))) return false
      if (skillsExcluded.length > 0 && skillsExcluded.some((s) => hasSkillToken(u.skills, s))) return false
      if (legacySkill && !hasSkillToken(u.skills, legacySkill)) return false
      if (designation) {
        const currentTitle = u.workExperiences.find((w) => w.isCurrent)?.title || ''
        if (!matchesDesignation(u.headline, designation) && !matchesDesignation(currentTitle, designation)) return false
      }
      if (employerCurrent && !includesCI(u.currentEmployer, employerCurrent)) return false
      if (
        employerPrevious &&
        !u.workExperiences.some((w) => !w.isCurrent && includesCI(w.company, employerPrevious)) &&
        !includesCI(u.resumeText, employerPrevious)
      ) {
        return false
      }
      if (industry && !includesCI(u.industry, industry) && !includesCI(u.desiredIndustry, industry)) return false
      if (functionalArea && !includesCI(u.functionalArea, functionalArea)) return false
      if (employmentType) {
        const et = (u.employmentTypePref || '').toLowerCase()
        const dj = (u.desiredJobType || '').toLowerCase()
        if (!et.includes(employmentType) && !dj.includes(employmentType)) return false
      }
      if (languages.length > 0) {
        const langs = (u.languages || '').toLowerCase()
        if (!languages.some((l) => langs.split(',').map((x) => x.trim()).includes(l))) return false
      }
      if (locations.length > 0) {
        const hay = [u.location, u.preferredLocations, u.desiredLocations]
          .map((f) => (f || '').toLowerCase())
        if (!locations.some((l) => hay.some((f) => f.includes(l)))) return false
      }
      if (legacyLocation && !includesCI(u.location, legacyLocation)) return false
      if (education && !includesCI(u.education, education) && !u.educationEntries.some((e) => includesCI(e.degree, education)))
        return false
      if (institute && !includesCI(u.education, institute) && !u.educationEntries.some((e) => includesCI(e.institution, institute)))
        return false
      if (excludeTerms.length > 0) {
        const hay = searchFields(u)
        if (excludeTerms.some((t) => hay.some((f) => f.includes(t)))) return false
      }
      if (parsed && parsed.ok) {
        if (!evaluateBooleanAst(parsed.ast, searchFields(u))) return false
      } else if (plainKeyword) {
        if (!searchFields(u).some((f) => f.includes(plainKeyword))) return false
      }
      return true
    })

    // ── relevance scoring (weighted: identity fields count double) ────────
    const positiveTerms = parsed && parsed.ok ? collectTerms(parsed.ast) : plainKeyword ? [plainKeyword] : []
    const relevanceScore = (u: (typeof pool)[number]): number => {
      if (positiveTerms.length === 0) return 0
      const heavy = [u.headline, u.skills, u.name, u.workExperiences.find((w) => w.isCurrent)?.title || '']
        .map((f) => (f || '').toLowerCase())
      const light = searchFields(u)
      let score = 0
      for (const t of positiveTerms) {
        if (heavy.some((f) => f.includes(t))) score += 2
        if (light.some((f) => f.includes(t))) score += 1
      }
      return score
    }

    // ── per-keyword evidence snippets ("why am I seeing this candidate") ──
    // For every positive search term that hit the profile, extract a short
    // contact-scrubbed excerpt of the CV text around the first occurrence, or
    // report which identity field (designation / skills) matched instead.
    const SNIPPET_WINDOW = 90
    const MAX_SNIPPETS = 3
    const matchedSnippetsFor = (u: (typeof pool)[number]): { term: string; snippet: string; where: string[] }[] => {
      if (positiveTerms.length === 0) return []
      const cv = scrubContact(u.resumeText)
      const cvLower = cv.toLowerCase()
      const skillsLower = (u.skills || '').toLowerCase()
      const headlineLower = (u.headline || '').toLowerCase()
      const out: { term: string; snippet: string; where: string[] }[] = []
      for (const term of positiveTerms) {
        if (out.length >= MAX_SNIPPETS) break
        const where: string[] = []
        if (headlineLower.includes(term)) where.push('designation')
        if (skillsLower.split(',').some((s) => s.trim() === term) || skillsLower.includes(term)) where.push('skills')
        const idx = cvLower.indexOf(term)
        if (idx >= 0) {
          where.push('CV')
          let start = Math.max(0, idx - SNIPPET_WINDOW)
          let end = Math.min(cv.length, idx + term.length + SNIPPET_WINDOW)
          while (start > 0 && !/\s/.test(cv[start] ?? ' ')) start--
          while (end < cv.length && !/\s/.test(cv[end] ?? ' ')) end++
          const excerpt =
            (start > 0 ? '…' : '') +
            cv.slice(start, end).replace(/\s+/g, ' ').trim() +
            (end < cv.length ? '…' : '')
          out.push({ term, snippet: excerpt, where })
        } else if (where.length > 0) {
          out.push({ term, snippet: '', where })
        }
      }
      return out
    }

    const effectiveSort =
      sort === 'auto' ? (positiveTerms.length > 0 ? 'relevance' : 'recent') : sort
    const byNum = (v: number | null | undefined): number => (v === null || v === undefined ? -1 : v)
    const byDate = (v: Date | string | null | undefined): number =>
      v ? new Date(v).getTime() : 0
    switch (effectiveSort) {
      case 'relevance':
        filtered.sort((a, b) => relevanceScore(b) - relevanceScore(a))
        break
      case 'experience_desc':
        filtered.sort((a, b) => byNum(b.experienceYears) - byNum(a.experienceYears))
        break
      case 'experience_asc':
        filtered.sort((a, b) => byNum(a.experienceYears) - byNum(b.experienceYears))
        break
      case 'salary_desc':
        filtered.sort((a, b) => byNum(b.expectedSalary) - byNum(a.expectedSalary))
        break
      case 'salary_asc':
        filtered.sort(
          (a, b) =>
            (a.expectedSalary === null || a.expectedSalary === undefined ? Infinity : a.expectedSalary) -
            (b.expectedSalary === null || b.expectedSalary === undefined ? Infinity : b.expectedSalary)
        )
        break
      case 'freshness':
        filtered.sort((a, b) => byDate(b.lastActiveAt) - byDate(a.lastActiveAt))
        break
      case 'recent':
        filtered.sort((a, b) => byDate(b.createdAt) - byDate(a.createdAt))
        break
      case 'name_asc':
        filtered.sort((a, b) => a.name.localeCompare(b.name))
        break
    }

    // ── facets (computed over the filtered set, before pagination) ────────
    const wantFacets = sp.get('facets') === '1'
    let facets: Record<string, unknown> | undefined
    if (wantFacets) {
      const tally = (getter: (u: (typeof pool)[number]) => string, cap = 12) => {
        const m = new Map<string, number>()
        for (const u of filtered) {
          const v = getter(u)?.trim()
          if (v) m.set(v, (m.get(v) || 0) + 1)
        }
        return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap).map(([value, count]) => ({ value, count }))
      }
      facets = {
        locations: tally((u) => u.location || '', 10),
        industries: tally((u) => u.industry || '', 12),
        functionalAreas: tally((u) => u.functionalArea || '', 10),
        notice: {
          immediate: filtered.filter((u) => u.noticePeriodDays === 0).length,
          d15: filtered.filter((u) => u.noticePeriodDays === 15).length,
          d30: filtered.filter((u) => u.noticePeriodDays === 30).length,
          d60: filtered.filter((u) => u.noticePeriodDays === 60).length,
          d90: filtered.filter((u) => u.noticePeriodDays === 90).length,
          unknown: filtered.filter((u) => u.noticePeriodDays === null).length,
        },
        experience: {
          junior: filtered.filter((u) => (u.experienceYears ?? 0) < 3).length,
          mid: filtered.filter((u) => (u.experienceYears ?? 0) >= 3 && (u.experienceYears ?? 0) < 7).length,
          senior: filtered.filter((u) => (u.experienceYears ?? 0) >= 7 && (u.experienceYears ?? 0) < 12).length,
          veteran: filtered.filter((u) => (u.experienceYears ?? 0) >= 12).length,
        },
      }
    }

    // ── pagination + SAFE payload mapping ─────────────────────────────────
    const total = filtered.length
    const pages = Math.max(1, Math.ceil(total / pageSize))
    const safePage = Math.min(page, pages)
    const slice = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

    const data = slice.map((u) => ({
      id: u.id,
      name: u.name,
      emailMasked: maskEmail(u.email),
      phoneMasked: maskPhone(u.phone),
      headline: u.headline,
      location: u.location,
      company: u.company,
      skills: u.skills,
      experienceYears: u.experienceYears,
      currentSalary: u.currentSalary,
      expectedSalary: u.expectedSalary,
      education: u.education,
      avatarSeed: u.avatarSeed,
      noticePeriodDays: u.noticePeriodDays,
      githubUrl: u.githubUrl,
      linkedinUrl: u.linkedinUrl,
      behanceUrl: u.behanceUrl,
      portfolioUrl: u.portfolioUrl,
      videoResumePath: u.videoResumePath,
      videoResumeSeconds: u.videoResumeSeconds,
      videoResumeIntro: u.videoResumeIntro,
      industry: u.industry,
      functionalArea: u.functionalArea,
      employmentTypePref: u.employmentTypePref,
      preferredLocations: u.preferredLocations,
      languages: u.languages,
      lastActiveAt: u.lastActiveAt,
      profileSource: u.profileSource,
      desiredRole: u.desiredRole,
      desiredLocations: u.desiredLocations,
      desiredJobType: u.desiredJobType,
      hasCv: !!u.cvFileName,
      cvFileName: u.cvFileName,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      workExperiences: u.workExperiences,
      educationEntries: u.educationEntries,
      certifications: u.certifications,
      // PRIVACY: free text scrubbed of contact details; full resume preview
      // (with contact reveal) is served by the guarded per-candidate route.
      resumeSnippet: scrubContact(u.resumeText).slice(0, 400),
      matchedSnippets: matchedSnippetsFor(u),
      relevance: positiveTerms.length > 0 ? relevanceScore(u) : undefined,
      // NOTE: currentEmployer / email / phone are intentionally absent.
    }))

    // usage tracking (best effort — never break the search)
    try {
      await db.usageLog.create({
        data: {
          actorId: recruiter.id,
          kind: 'SEARCH',
          meta: JSON.stringify({ q: rawKeyword, filters: { industry, functionalArea, locations, skillsMandatory, skillsExcluded }, resultCount: total }),
        },
      })
    } catch {
      /* quota/log failures must not break search */
    }

    return NextResponse.json({
      data,
      total,
      page: safePage,
      pageSize,
      pages,
      facets,
      booleanSummary: parsed && parsed.ok ? parsed.summary : undefined,
    })
  } catch (err) {
    console.error('GET /api/candidates failed:', err)
    return NextResponse.json(
      { error: 'Failed to search candidates' },
      { status: 500 }
    )
  }
}
