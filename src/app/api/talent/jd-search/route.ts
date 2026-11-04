// POST /api/talent/jd-search — paste a JD, the engine searches the CV
// database for you and ranks every candidate against it.
//
// Body: { recruiterId, jdText, filters? }
//   filters (ALL OPTIONAL recruiter overlays — they only narrow, never score):
//     { location?, minExperience?, maxExperience?, maxExpectedCtc?, maxNoticeDays? }
//
// JD-DRIVEN SCORING (same engine as /api/sourcing/match):
//   Core = must-have skills (35) + role title (25) + responsibilities (15).
//   Boosters = relevant experience (15) + good-to-have skills (10).
//   ⛔ CORE GATE — candidates whose role/skills/responsibilities do not match
//   the JD core (core score < 30%) are EXCLUDED from the results entirely and
//   reported as `screenedOut`. Experience or location similarity can NEVER
//   surface a profile the JD core rejects (explicit user rule).
//
// The JD is parsed once (AI first, deterministic keyword fallback) and every
// candidate is scored with transparent rules — no per-candidate AI calls, so
// the whole database is screened in one request.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'
import { checkQuota } from '@/lib/talent-config'
import { parseJdDeterministic, roleTitleSimilarity, responsibilitiesCoverage, jdSkillHit, type JdParse } from '@/lib/jd-parser'
import { aiParseJd } from '@/lib/jd-ai'
import { maskEmail, maskPhone } from '@/lib/talent-search-engine'

export const dynamic = 'force-dynamic'

const W = { mustSkills: 35, role: 25, responsibilities: 15, experience: 15, goodSkills: 10 }
const MAX_RESULTS = 30
const MAX_POOL = 2000

interface ScoredCandidate {
  // same safe payload shape as GET /api/candidates rows (privacy-masked),
  // so CandidateCard can render a JD result identically to a keyword result
  id: string
  emailMasked: string | null
  phoneMasked: string | null
  name: string
  headline: string | null
  location: string | null
  company: string | null
  skills: string | null
  experienceYears: number | null
  currentSalary: number | null
  expectedSalary: number | null
  education: string | null
  avatarSeed: string | null
  noticePeriodDays: number | null
  githubUrl: string | null
  linkedinUrl: string | null
  behanceUrl: string | null
  portfolioUrl: string | null
  industry: string | null
  functionalArea: string | null
  employmentTypePref: string | null
  preferredLocations: string | null
  languages: string | null
  lastActiveAt: Date | null
  profileSource: string | null
  desiredRole: string | null
  desiredLocations: string | null
  desiredJobType: string | null
  hasCv: boolean
  cvFileName: string | null
  workExperiences: { title: string; company: string; isCurrent: boolean }[]
  resumeSnippet: string
  // per-skill CV evidence — same shape the keyword search returns
  matchedSnippets: { term: string; snippet: string; where: string[] }[]
  // JD-match evidence
  overall: number
  verdictLabel: string
  verdict: string
  matchedSkills: { skill: string; evidence: string }[]
  missingSkills: string[]
  goodMatched: string[]
  roleState: string
  roleDetail: string
  respCoverage: number | null
  expDetail: string
}

/** Short excerpt of the (contact-scrubbed) CV text around a term hit. */
function cvExcerpt(cv: string, term: string): string | null {
  const idx = cv.toLowerCase().indexOf(term.toLowerCase())
  if (idx < 0) return null
  const W = 90
  let start = Math.max(0, idx - W)
  let end = Math.min(cv.length, idx + term.length + W)
  while (start > 0 && !/\s/.test(cv[start] ?? ' ')) start--
  while (end < cv.length && !/\s/.test(cv[end] ?? ' ')) end++
  return (
    (start > 0 ? '…' : '') +
    cv.slice(start, end).replace(/\s+/g, ' ').trim() +
    (end < cv.length ? '…' : '')
  )
}

function scrubContact(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email hidden]')
    .replace(/(\+?\d[\d\s-]{8,}\d)/g, '[phone hidden]')
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const recruiter = await resolveRecruiter(body?.recruiterId)
    if (!recruiter) {
      return NextResponse.json({ error: 'Recruiter access required' }, { status: 403 })
    }

    const jdText = typeof body?.jdText === 'string' ? body.jdText.trim() : ''
    if (!jdText) {
      return NextResponse.json({ error: 'Paste the job description to search' }, { status: 400 })
    }
    if (jdText.length > 20000) {
      return NextResponse.json({ error: 'JD text too long (max 20000 characters)' }, { status: 413 })
    }

    // quota: a JD search consumes one SEARCH credit (same bucket as keyword search)
    const quota = await checkQuota(recruiter.id, 'SEARCH')
    if (!quota.allowed) {
      return NextResponse.json(
        { error: `Daily search quota exhausted (${quota.used}/${quota.limit}). Resets at midnight.` },
        { status: 429 }
      )
    }

    // ── 0. parse the JD once (AI → deterministic fallback) ────────────────
    let aiParsed: Partial<JdParse> | null = null
    try {
      aiParsed = await aiParseJd(jdText)
    } catch {
      aiParsed = null
    }
    const det = parseJdDeterministic(jdText)
    let parseEngine: 'AI' | 'keyword' = 'keyword'
    let jd: JdParse
    if (aiParsed) {
      parseEngine = 'AI'
      // MERGE AI + deterministic skills: the AI output varies between runs and
      // can leak junk; the deterministic lexicon always anchors the canonical
      // skill names found in the JD ("Performance Management", "Change
      // Management"…). Union, deduped, AI terms first.
      const mustSeen = new Set<string>()
      const mustMerged = [...(aiParsed.mustHaveSkills ?? []), ...det.mustHaveSkills].filter((s) => {
        const k = s.toLowerCase().trim()
        if (!k || mustSeen.has(k)) return false
        mustSeen.add(k)
        return true
      }).slice(0, 12)
      const goodSeen = new Set(mustMerged.map((s) => s.toLowerCase()))
      const goodMerged = [...(aiParsed.goodToHaveSkills ?? []), ...det.goodToHaveSkills].filter((s) => {
        const k = s.toLowerCase().trim()
        if (!k || goodSeen.has(k)) return false
        goodSeen.add(k)
        return true
      }).slice(0, 8)
      jd = {
        roleTitle: aiParsed.roleTitle || det.roleTitle,
        minYears: aiParsed.minYears ?? det.minYears,
        maxYears: aiParsed.maxYears ?? det.maxYears,
        mustHaveSkills: mustMerged,
        goodToHaveSkills: goodMerged,
        responsibilities: aiParsed.responsibilities?.length ? aiParsed.responsibilities : det.responsibilities,
        location: aiParsed.location || det.location,
      }
    } else {
      jd = det
    }

    const jdSignal = jd.mustHaveSkills.length + jd.responsibilities.length + (jd.roleTitle ? 1 : 0)
    if (jdSignal === 0) {
      return NextResponse.json(
        { error: 'Could not read any role, skill or responsibility from this text — paste a fuller JD.' },
        { status: 422 }
      )
    }

    // ── 1. load the screening pool (visible candidates only) ─────────────
    const pool = await db.user.findMany({
      where: { role: 'CANDIDATE', profileVisible: true, disabled: false },
      select: {
        id: true, email: true, phone: true, name: true, headline: true, location: true,
        company: true, skills: true, resumeText: true, education: true,
        experienceYears: true, currentSalary: true, expectedSalary: true, noticePeriodDays: true,
        avatarSeed: true, githubUrl: true, linkedinUrl: true, behanceUrl: true, portfolioUrl: true,
        industry: true, functionalArea: true, employmentTypePref: true, preferredLocations: true,
        desiredLocations: true, lastActiveAt: true, profileSource: true, desiredRole: true,
        desiredJobType: true, cvFileName: true, currentEmployer: true,
        workExperiences: { select: { title: true, company: true, isCurrent: true } },
      },
      take: MAX_POOL,
    })

    // employer-block privacy shield (same rule as keyword search + contact
    // reveal): candidates whose current employer equals the recruiter's own
    // company/client are never screened, scored or returned.
    const meRow = await db.user.findUnique({
      where: { id: recruiter.id },
      select: { company: true, clientId: true },
    })
    const blockedEmployers = new Set<string>()
    const ownNorm = (meRow?.company || '').trim().toLowerCase()
    if (ownNorm) blockedEmployers.add(ownNorm)
    if (meRow?.clientId) {
      const client = await db.client.findUnique({
        where: { id: meRow.clientId },
        select: { name: true },
      })
      const clientNorm = (client?.name || '').trim().toLowerCase()
      if (clientNorm) blockedEmployers.add(clientNorm)
    }

    // recruiter overlays (optional, hard filters applied AFTER the core gate)
    const cf = (body?.filters ?? {}) as Record<string, unknown>
    const fLocation = typeof cf.location === 'string' ? cf.location.trim().toLowerCase() : ''
    const fMinExp = typeof cf.minExperience === 'number' ? cf.minExperience : null
    const fMaxExp = typeof cf.maxExperience === 'number' ? cf.maxExperience : null
    const fMaxCtc = typeof cf.maxExpectedCtc === 'number' ? cf.maxExpectedCtc : null
    const fMaxNotice = typeof cf.maxNoticeDays === 'number' ? cf.maxNoticeDays : null

    // ── 2. score every candidate with the same transparent rules ──────────
    let screenedOut = 0
    const scored: ScoredCandidate[] = []

    for (const c of pool) {
      // privacy shield — a recruiter never sees candidates employed at their
      // own company/client (same rule as the keyword search engine)
      if (c.currentEmployer && blockedEmployers.has(c.currentEmployer.trim().toLowerCase())) {
        screenedOut++
        continue
      }
      const currentTitle = c.workExperiences.find((w) => w.isCurrent)?.title || ''
      const heldTitles = [currentTitle, c.headline, ...c.workExperiences.map((w) => w.title)]

      // must-have skills — layered matching (token/synonym → phrase → word
      // overlap) so AI-verbatim JD phrases still find the clean CV tokens
      const mustHits: { skill: string; evidence: string }[] = []
      const mustMisses: string[] = []
      const skillHay = { skillsCsv: c.skills, resumeText: c.resumeText, titles: heldTitles }
      for (const skill of jd.mustHaveSkills) {
        const hit = jdSkillHit(skill, skillHay)
        if (hit.hit && hit.evidence) mustHits.push({ skill, evidence: hit.evidence })
        else mustMisses.push(skill)
      }
      const mustCoverage = jd.mustHaveSkills.length === 0 ? null : mustHits.length / jd.mustHaveSkills.length

      const goodHits = jd.goodToHaveSkills.filter((s) => jdSkillHit(s, skillHay).hit)
      const goodCoverage = jd.goodToHaveSkills.length === 0 ? null : goodHits.length / jd.goodToHaveSkills.length

      const roleScore = jd.roleTitle ? roleTitleSimilarity(jd.roleTitle, heldTitles) : null
      const resp = responsibilitiesCoverage(jd.responsibilities, c.resumeText)

      // experience band (booster only — never rescues a core mismatch)
      const minExp = jd.minYears
      const maxExp = jd.maxYears
      const exp = c.experienceYears
      let expScore = 0
      let expState: 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN' = 'UNKNOWN'
      let expDetail = 'Experience band not stated in JD.'
      if (exp !== null && exp !== undefined && minExp !== null) {
        const upper = maxExp ?? minExp + 3
        if (exp >= minExp && exp <= upper) { expScore = 1; expState = 'PASS'; expDetail = `${exp} yrs in the ${minExp}–${upper} band.` }
        else if (exp >= minExp * 0.6) { expScore = 0.7; expState = 'PARTIAL'; expDetail = `${exp} yrs vs ${minExp}–${upper} — slightly below.` }
        else if (exp > upper) { expScore = 0.6; expState = 'PARTIAL'; expDetail = `${exp} yrs — above the band.` }
        else { expScore = 0.25; expState = 'FAIL'; expDetail = `${exp} yrs vs ${minExp}–${upper} — well below.` }
      }

      // ── CORE GATE (user rule): role/skills/responsibilities decide ──────
      const coreWeightRaw =
        (mustCoverage !== null || goodCoverage !== null ? W.mustSkills : 0) +
        (roleScore !== null ? W.role : 0) +
        (resp.coverage !== null ? W.responsibilities : 0)
      const coreScore =
        coreWeightRaw === 0
          ? null
          : ((mustCoverage ?? 0) * W.mustSkills * 0.75 + (goodCoverage ?? 0) * W.mustSkills * 0.25 +
              (roleScore ?? 0) * W.role + (resp.coverage ?? 0) * W.responsibilities) / coreWeightRaw

      if (coreScore === null || coreScore < 0.3) {
        screenedOut++
        continue // excluded — experience/location can never rescue the core
      }

      const skillRaw = (mustCoverage ?? 0) * 0.75 + (goodCoverage ?? 0) * 0.25
      const componentsScore =
        skillRaw * W.mustSkills +
        (roleScore ?? 0) * W.role +
        (resp.coverage ?? 0) * W.responsibilities +
        expScore * (expState === 'UNKNOWN' ? 0 : W.experience) +
        (goodCoverage ?? 0) * (goodCoverage === null ? 0 : W.goodSkills)
      const totalWeight =
        W.mustSkills + W.role + (resp.coverage === null ? 0 : W.responsibilities) + (expState === 'UNKNOWN' ? 0 : W.experience) + (goodCoverage === null ? 0 : W.goodSkills)
      const overall = Math.round((componentsScore / totalWeight) * 100)
      // verdict bands calibrated for sourcing ranked lists: the best available
      // profiles sit in the 45–70 range against a demanding senior JD
      const verdict = overall >= 70 ? 'STRONG_FIT' : overall >= 45 ? 'GOOD_FIT' : overall >= 25 ? 'WEAK_FIT' : 'NOT_A_FIT'
      const verdictLabel = overall >= 70 ? 'Strong fit' : overall >= 45 ? 'Good fit' : overall >= 25 ? 'Weak fit' : 'Not a fit'

      const roleState = roleScore === null ? 'UNKNOWN' : roleScore >= 0.5 ? 'PASS' : roleScore >= 0.25 ? 'PARTIAL' : 'FAIL'
      const roleDetail =
        !jd.roleTitle ? 'No role title in JD.'
        : (roleScore ?? 0) >= 0.5 ? `Roles align with "${jd.roleTitle}".`
        : (roleScore ?? 0) > 0 ? `Partial alignment with "${jd.roleTitle}".`
        : `No role close to "${jd.roleTitle}".`

      const cvScrubbed = scrubContact(c.resumeText)
      const matchedSnippets = mustHits.slice(0, 3).map((m) => {
        const where: string[] = []
        if ((c.headline || '').toLowerCase().includes(m.skill.toLowerCase())) where.push('designation')
        if ((c.skills || '').toLowerCase().includes(m.skill.toLowerCase())) where.push('skills')
        const excerpt = cvExcerpt(cvScrubbed, m.skill)
        if (excerpt) where.push('CV')
        return { term: m.skill, snippet: excerpt ?? '', where: where.length > 0 ? where : ['matched'] }
      })
      scored.push({
        id: c.id,
        emailMasked: maskEmail(c.email),
        phoneMasked: maskPhone(c.phone),
        name: c.name,
        headline: c.headline,
        location: c.location,
        company: c.company,
        skills: c.skills,
        experienceYears: c.experienceYears,
        currentSalary: c.currentSalary,
        expectedSalary: c.expectedSalary,
        education: c.education,
        avatarSeed: c.avatarSeed,
        noticePeriodDays: c.noticePeriodDays,
        githubUrl: c.githubUrl,
        linkedinUrl: c.linkedinUrl,
        behanceUrl: c.behanceUrl,
        portfolioUrl: c.portfolioUrl,
        industry: c.industry,
        functionalArea: c.functionalArea,
        employmentTypePref: c.employmentTypePref,
        preferredLocations: c.preferredLocations,
        languages: null,
        lastActiveAt: c.lastActiveAt,
        profileSource: c.profileSource,
        desiredRole: c.desiredRole,
        desiredLocations: c.desiredLocations,
        desiredJobType: c.desiredJobType,
        hasCv: !!c.cvFileName,
        cvFileName: c.cvFileName,
        workExperiences: c.workExperiences,
        resumeSnippet: cvScrubbed.slice(0, 400),
        matchedSnippets,
        overall,
        verdict,
        verdictLabel,
        matchedSkills: mustHits,
        missingSkills: mustMisses,
        goodMatched: goodHits,
        roleState,
        roleDetail,
        respCoverage: resp.coverage,
        expDetail,
      })
    }

    // ── 3. recruiter opt-in overlays (narrow only, applied after the gate) ─
    let filtered = scored
    if (fLocation) {
      const cities = fLocation.split(/[,/]/).map((s) => s.trim()).filter((x) => x.length > 2)
      filtered = filtered.filter((c) => {
        const base = (c.location || '').toLowerCase()
        return cities.some((x) => base.includes(x))
      })
    }
    if (fMinExp !== null) filtered = filtered.filter((c) => (c.experienceYears ?? -1) >= fMinExp)
    if (fMaxExp !== null) filtered = filtered.filter((c) => (c.experienceYears ?? 999) <= fMaxExp)
    if (fMaxCtc !== null) filtered = filtered.filter((c) => (c.expectedSalary ?? 9999) <= fMaxCtc)
    if (fMaxNotice !== null) filtered = filtered.filter((c) => (c.noticePeriodDays ?? 999) <= fMaxNotice)

    filtered.sort((a, b) => b.overall - a.overall)
    const results = filtered.slice(0, MAX_RESULTS)

    // ── 4. usage audit trail ──────────────────────────────────────────────
    try {
      await db.usageLog.create({
        data: {
          actorId: recruiter.id,
          kind: 'SEARCH',
          meta: JSON.stringify({ type: 'jd_search', scanned: pool.length, screenedOut, returned: results.length, parseEngine }),
        },
      })
    } catch {
      /* audit log must never break the search */
    }

    return NextResponse.json({
      data: {
        jdParsed: {
          roleTitle: jd.roleTitle,
          minYears: jd.minYears,
          maxYears: jd.maxYears,
          mustHaveSkills: jd.mustHaveSkills,
          goodToHaveSkills: jd.goodToHaveSkills,
          responsibilities: jd.responsibilities,
          location: jd.location,
        },
        parseEngine,
        scanned: pool.length,
        screenedOut,
        returned: results.length,
        totalFit: filtered.length,
        results,
        coreGateNote:
          'Candidates whose role / skills / responsibilities do not match the JD core are excluded — experience or location similarity never rescues them.',
      },
    })
  } catch (err) {
    console.error('POST /api/talent/jd-search failed:', err)
    return NextResponse.json({ error: 'JD search failed' }, { status: 500 })
  }
}
