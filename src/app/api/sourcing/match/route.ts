// POST /api/sourcing/match — candidate ↔ job/JD match engine (transparent).
//
// Body: { recruiterId, candidateId, jobId? , jdText?, contextFilters? }
//   • jobId   → structured match against a posted job (ownership enforced).
//   • jdText  → recruiter pastes a raw JD; it is PARSED (AI first, keyword
//               fallback) and scored against the candidate.
//   • contextFilters (optional): { location?, maxNoticeDays?, maxExpectedCtc? }
//               recruiter opt-in advisory checks. They can only FLAG a
//               mismatch — they never raise the score.
//
// JD-DRIVEN SCORING (user rule: the JD decides):
//   Core = must-have skills (35) + role title (25) + responsibilities (15).
//   Boosters = relevant experience (15) + good-to-have skills (10).
//   ⛔ CORE GATE — if the core fit is weak (<30%), the score is CAPPED at 25
//   and flagged CORE_MISMATCH: experience or location similarity can NEVER
//   rescue a profile whose role/skills/responsibilities don't match the JD.
//   Missing data → component reported UNKNOWN and excluded (renormalised),
//   never counted as a silent failure. Weights used are returned.
//
// AI is OPTIONAL and advisory: an LLM may parse the JD (labelled) and write a
// rationale from VERIFIED facts only. It can never auto-reject anyone.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveRecruiter } from '@/lib/folder-guards'
import { checkQuota } from '@/lib/talent-config'
import { hasSkillToken } from '@/lib/talent-search-engine'
import { chatWithRetry, extractJson } from '@/lib/ai-client'
import {
  parseJdDeterministic,
  roleTitleSimilarity,
  responsibilitiesCoverage,
  type JdParse,
} from '@/lib/jd-parser'
import { aiParseJd } from '@/lib/jd-ai'

export const dynamic = 'force-dynamic'

const W = { mustSkills: 35, role: 25, responsibilities: 15, experience: 15, goodSkills: 10 }

interface Component {
  key: string
  label: string
  state: 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN'
  score: number
  weight: number
  detail: string
  evidence: string[]
}

interface ContextCheck {
  key: string
  label: string
  state: 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN'
  detail: string
}

function scrubResumeContact(text: string | null | undefined): string {
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

    const candidateId = typeof body?.candidateId === 'string' ? body.candidateId : ''
    const jobId = typeof body?.jobId === 'string' ? body.jobId : ''
    const jdText = typeof body?.jdText === 'string' ? body.jdText.trim() : ''
    if (!candidateId || (!jobId && !jdText)) {
      return NextResponse.json({ error: 'candidateId and (jobId or jdText) are required' }, { status: 400 })
    }
    if (jdText.length > 20000) {
      return NextResponse.json({ error: 'JD text too long (max 20000 characters)' }, { status: 413 })
    }

    const candidate = await db.user.findUnique({
      where: { id: candidateId },
      select: {
        id: true, name: true, role: true, profileVisible: true, headline: true, skills: true, resumeText: true,
        experienceYears: true, location: true, preferredLocations: true, desiredLocations: true,
        expectedSalary: true, noticePeriodDays: true, industry: true, education: true,
        workExperiences: { select: { title: true, company: true, isCurrent: true } },
      },
    })
    if (!candidate || candidate.role !== 'CANDIDATE' || !candidate.profileVisible) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    // ── 0. build the JD spec (job record OR pasted JD) ────────────────────
    let jd: JdParse
    let source: 'job' | 'jd' = 'jd'
    let parseEngine: 'structured' | 'AI' | 'keyword' = 'keyword'
    let jobMeta: { id: string; title: string; company: string } | null = null

    if (jobId) {
      const job = await db.job.findUnique({ where: { id: jobId } })
      if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })
      if (job.recruiterId !== recruiter.id) {
        return NextResponse.json({ error: 'This job belongs to another recruiter' }, { status: 403 })
      }
      source = 'job'
      parseEngine = 'structured'
      jobMeta = { id: job.id, title: job.title, company: job.company }
      jd = {
        roleTitle: job.title,
        minYears: job.experienceMin,
        maxYears: job.experienceMax,
        mustHaveSkills: job.skills.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12),
        goodToHaveSkills: [],
        responsibilities: parseJdDeterministic(job.description || '').responsibilities,
        location: job.workMode === 'Remote' ? 'Remote' : job.location,
      }
    } else {
      // quota the AI parse (falls back to keyword parse when exhausted)
      let quotaOk = false
      try {
        quotaOk = (await checkQuota(recruiter.id, 'PROFILE_VIEW')).allowed
      } catch {
        quotaOk = false
      }
      let aiParsed: Partial<JdParse> | null = null
      if (quotaOk) aiParsed = await aiParseJd(jdText)
      const det = parseJdDeterministic(jdText)
      if (aiParsed) {
        parseEngine = 'AI'
        jd = {
          roleTitle: aiParsed.roleTitle || det.roleTitle,
          minYears: aiParsed.minYears ?? det.minYears,
          maxYears: aiParsed.maxYears ?? det.maxYears,
          mustHaveSkills: aiParsed.mustHaveSkills?.length ? aiParsed.mustHaveSkills : det.mustHaveSkills,
          goodToHaveSkills: aiParsed.goodToHaveSkills?.length ? aiParsed.goodToHaveSkills : det.goodToHaveSkills,
          responsibilities: aiParsed.responsibilities?.length ? aiParsed.responsibilities : det.responsibilities,
          location: aiParsed.location || det.location,
        }
      } else {
        parseEngine = 'keyword'
        jd = det
      }
    }

    // ── 1. rules-based scoring ────────────────────────────────────────────
    const resumeLower = (candidate.resumeText || '').toLowerCase()
    const currentTitle = candidate.workExperiences.find((w) => w.isCurrent)?.title || ''
    const heldTitles = [currentTitle, candidate.headline, ...candidate.workExperiences.map((w) => w.title)]

    // 1a. must-have skills
    const mustHits: { skill: string; evidence: string }[] = []
    const mustMisses: string[] = []
    for (const skill of jd.mustHaveSkills) {
      const sLower = skill.toLowerCase()
      if (hasSkillToken(candidate.skills, skill)) {
        mustHits.push({ skill, evidence: 'Listed in profile skills' })
      } else if (resumeLower.includes(sLower)) {
        mustHits.push({ skill, evidence: 'Found in resume text' })
      } else if (heldTitles.some((t) => (t || '').toLowerCase().includes(sLower))) {
        mustHits.push({ skill, evidence: 'Present in designation/headline' })
      } else {
        mustMisses.push(skill)
      }
    }
    const mustCoverage = jd.mustHaveSkills.length === 0 ? null : mustHits.length / jd.mustHaveSkills.length

    // 1b. good-to-have skills
    const goodHits = jd.goodToHaveSkills.filter(
      (s) => hasSkillToken(candidate.skills, s) || resumeLower.includes(s.toLowerCase()),
    )
    const goodCoverage = jd.goodToHaveSkills.length === 0 ? null : goodHits.length / jd.goodToHaveSkills.length

    // 1c. role title
    let roleScore: number | null = null
    const roleEvidence: string[] = []
    if (jd.roleTitle) {
      roleScore = roleTitleSimilarity(jd.roleTitle, heldTitles)
      if (currentTitle) roleEvidence.push(`Current role: ${currentTitle}`)
      if (roleScore >= 0.5) roleEvidence.push(`"${jd.roleTitle}" tokens largely present in the candidate's roles`)
    }

    // 1d. responsibilities vs resume
    const resp = responsibilitiesCoverage(jd.responsibilities, candidate.resumeText)

    // 1e. experience band
    const minExp = jd.minYears
    const maxExp = jd.maxYears
    const exp = candidate.experienceYears
    let expScore = 0
    let expState: Component['state'] = 'UNKNOWN'
    let expDetail = 'Candidate has not stated total experience — treated as unknown, not a failure.'
    if (exp !== null && exp !== undefined && minExp !== null) {
      const upper = maxExp ?? minExp + 3
      if (exp >= minExp && exp <= upper) {
        expScore = 1; expState = 'PASS'
        expDetail = `${exp} yrs sits inside the JD's ${minExp}–${upper} yrs band.`
      } else if (exp >= minExp * 0.6) {
        expScore = 0.7; expState = 'PARTIAL'
        expDetail = `${exp} yrs vs JD ${minExp}–${upper} yrs — slightly below.`
      } else if (exp > upper) {
        expScore = 0.6; expState = 'PARTIAL'
        expDetail = `${exp} yrs — above the JD band (check overqualification).`
      } else {
        expScore = 0.25; expState = 'FAIL'
        expDetail = `${exp} yrs vs JD ${minExp}–${upper} yrs — well below.`
      }
    } else if (exp !== null && exp !== undefined && minExp === null) {
      expState = 'UNKNOWN'
      expDetail = `Candidate has ${exp} yrs experience; the JD does not state a clear requirement.`
    }

    const skillRaw = (mustCoverage ?? 0) * 0.75 + (goodCoverage ?? 0) * 0.25
    const skillState: Component['state'] =
      mustCoverage === null && goodCoverage === null ? 'UNKNOWN' : skillRaw >= 0.85 ? 'PASS' : skillRaw >= 0.5 ? 'PARTIAL' : 'FAIL'

    const respState: Component['state'] = resp.coverage === null ? 'UNKNOWN' : resp.coverage >= 0.5 ? 'PASS' : resp.coverage >= 0.25 ? 'PARTIAL' : 'FAIL'
    const roleState: Component['state'] = roleScore === null ? 'UNKNOWN' : roleScore >= 0.5 ? 'PASS' : roleScore >= 0.25 ? 'PARTIAL' : 'FAIL'

    const components: Component[] = [
      {
        key: 'skills', label: 'Must-have skills (from JD)', state: skillState,
        score: mustCoverage === null && goodCoverage === null ? 0 : skillRaw,
        weight: mustCoverage === null && goodCoverage === null ? 0 : W.mustSkills,
        detail:
          jd.mustHaveSkills.length === 0
            ? 'No must-have skills could be extracted from the JD.'
            : `${mustHits.length}/${jd.mustHaveSkills.length} must-have skills evidenced${jd.goodToHaveSkills.length ? `; ${goodHits.length}/${jd.goodToHaveSkills.length} good-to-have matched` : ''}.`,
        evidence: mustHits.map((h) => `${h.skill} — ${h.evidence}`),
      },
      {
        key: 'role', label: 'Role / designation fit', state: roleState,
        score: roleScore ?? 0, weight: roleScore === null ? 0 : W.role,
        detail:
          !jd.roleTitle
            ? 'No role title found in the JD.'
            : roleScore !== null && roleScore >= 0.5
              ? `Candidate's roles align with "${jd.roleTitle}".`
              : roleScore !== null && roleScore > 0
                ? `Partial alignment with "${jd.roleTitle}" — check designation history.`
                : `Candidate has never held a role close to "${jd.roleTitle}".`,
        evidence: roleEvidence,
      },
      {
        key: 'responsibilities', label: 'JD responsibilities in resume', state: respState,
        score: resp.coverage ?? 0, weight: resp.coverage === null ? 0 : W.responsibilities,
        detail:
          resp.coverage === null
            ? 'No responsibilities extracted from the JD.'
            : `${resp.matched.length} of ${resp.matched.length + resp.missed.length} JD keywords found in the resume.`,
        evidence: resp.matched.slice(0, 8).map((k) => `Resume mentions "${k}"`),
      },
      {
        key: 'experience', label: 'Relevant experience (JD band)', state: expState,
        score: expScore, weight: expState === 'UNKNOWN' ? 0 : W.experience,
        detail: expDetail,
        evidence: exp !== null && exp !== undefined && minExp !== null ? [`Total experience: ${exp} yrs (JD asks ${minExp}${maxExp ? `–${maxExp}` : '+'})`] : [],
      },
      {
        key: 'goodToHave', label: 'Good-to-have skills', state: goodCoverage === null ? 'UNKNOWN' : goodCoverage >= 0.6 ? 'PASS' : goodCoverage > 0 ? 'PARTIAL' : 'FAIL',
        score: goodCoverage ?? 0, weight: goodCoverage === null ? 0 : W.goodSkills,
        detail: goodCoverage === null ? 'The JD lists no good-to-have skills.' : `${goodHits.length}/${jd.goodToHaveSkills.length} good-to-have skills matched.`,
        evidence: goodHits.map((s) => `${s} — found in profile/resume`),
      },
    ]

    // ── CORE GATE: role + skills + responsibilities decide ────────────────
    const coreWeightRaw = (mustCoverage !== null || goodCoverage !== null ? W.mustSkills : 0) + (roleScore !== null ? W.role : 0) + (resp.coverage !== null ? W.responsibilities : 0)
    const coreScore =
      coreWeightRaw === 0
        ? null
        : ((mustCoverage ?? 0) * W.mustSkills * 0.75 + (goodCoverage ?? 0) * W.mustSkills * 0.25 +
            (roleScore ?? 0) * W.role + (resp.coverage ?? 0) * W.responsibilities) / coreWeightRaw

    const coreGateApplied = coreScore !== null && coreScore < 0.3
    const totalWeight = components.reduce((s, c) => s + c.weight, 0)
    let overall = totalWeight === 0 ? 0 : Math.round((components.reduce((s, c) => s + c.score * c.weight, 0) / totalWeight) * 100)
    if (coreGateApplied) overall = Math.min(overall, 25)

    const verdict = coreGateApplied
      ? 'CORE_MISMATCH'
      : overall >= 70 ? 'STRONG_FIT' : overall >= 45 ? 'GOOD_FIT' : overall >= 25 ? 'WEAK_FIT' : 'NOT_A_FIT'
    const verdictLabel = coreGateApplied
      ? 'Core JD mismatch'
      : overall >= 70 ? 'Strong fit' : overall >= 45 ? 'Good fit' : overall >= 25 ? 'Weak fit' : 'Not a fit'

    // ── 2. recruiter opt-in context checks (flag-only, never raise score) ─
    const contextChecks: ContextCheck[] = []
    const cf = (body?.contextFilters ?? {}) as Record<string, unknown>
    if (typeof cf.location === 'string' && cf.location.trim()) {
      const want = cf.location.trim().toLowerCase()
      const cand = (candidate.location || '').toLowerCase()
      const pref = [candidate.preferredLocations, candidate.desiredLocations].join(',').toLowerCase()
      const wantCities = want.split(/[,/]/).map((s) => s.trim()).filter((c) => c.length > 2)
      const direct = wantCities.some((c) => cand.includes(c))
      const willing = wantCities.some((c) => pref.includes(c))
      contextChecks.push({
        key: 'location', label: 'Location check (your filter)',
        state: direct ? 'PASS' : willing ? 'WARN' : 'FAIL',
        detail: direct
          ? `Based in ${candidate.location}.`
          : willing
            ? `Based in ${candidate.location || 'unknown'} but open to your location.`
            : `Based in ${candidate.location || 'unknown'} — not your ${cf.location} filter.`,
      })
    }
    if (typeof cf.maxNoticeDays === 'number' && cf.maxNoticeDays > 0) {
      const d = candidate.noticePeriodDays
      contextChecks.push({
        key: 'notice', label: 'Notice-period check (your filter)',
        state: d === null || d === undefined ? 'UNKNOWN' : d <= cf.maxNoticeDays ? 'PASS' : 'FAIL',
        detail: d === null || d === undefined ? 'No notice data on profile.' : `Notice ${d} days vs your max ${cf.maxNoticeDays}.`,
      })
    }
    if (typeof cf.maxExpectedCtc === 'number' && cf.maxExpectedCtc > 0) {
      const s = candidate.expectedSalary
      contextChecks.push({
        key: 'ctc', label: 'Budget check (your filter)',
        state: s === null || s === undefined ? 'UNKNOWN' : s <= cf.maxExpectedCtc ? 'PASS' : 'FAIL',
        detail: s === null || s === undefined ? 'No expected CTC on profile.' : `Expects ₹${s} LPA vs your cap ₹${cf.maxExpectedCtc} LPA.`,
      })
    }

    const result = {
      overall,
      verdict,
      verdictLabel,
      missingMandatory: mustMisses,
      coreGate: {
        applied: coreGateApplied,
        coreScore: coreScore === null ? null : Math.round(coreScore * 100),
        reason: coreGateApplied
          ? 'Role / skills / responsibilities do not match the JD core — experience or location similarity is NOT counted (score capped at 25).'
          : '',
      },
      weightsUsed: Object.fromEntries(components.map((c) => [c.key, c.weight])) as Record<string, number>,
      components,
      contextChecks,
      jdParsed: {
        roleTitle: jd.roleTitle,
        minYears: jd.minYears,
        maxYears: jd.maxYears,
        mustHaveSkills: jd.mustHaveSkills,
        goodToHaveSkills: jd.goodToHaveSkills,
        responsibilities: jd.responsibilities,
        location: jd.location,
      },
      // every AI input below is a VERIFIED profile fact — no inference
      verifiedFacts: {
        headline: candidate.headline,
        currentRole: currentTitle,
        skills: candidate.skills,
        experienceYears: exp,
        location: candidate.location,
        expectedSalary: candidate.expectedSalary,
        noticePeriodDays: candidate.noticePeriodDays,
        industry: candidate.industry,
      },
    }

    // ── 3. optional AI rationale (advisory only) ──────────────────────────
    let aiSummary: string | null = null
    let engine: 'rules-only' | 'rules+AI' = 'rules-only'
    try {
      const quotaOk = await checkQuota(recruiter.id, 'PROFILE_VIEW')
      if (quotaOk.allowed) {
        const sys =
          'You are a recruitment analyst. Write a 2-3 sentence factual explanation of why this candidate does or does not fit the given JD, using ONLY the verified facts and score components provided. Never invent skills, employers, or qualifications. Never mention age, gender, religion, caste, or any protected characteristic. Be concrete and neutral.'
        const user = JSON.stringify({
          jd: jobMeta ? { title: jobMeta.title, company: jobMeta.company, skills: jd.mustHaveSkills, experienceMin: jd.minYears, experienceMax: jd.maxYears, location: jd.location } : jdParsedForAi(jd),
          candidateVerifiedFacts: result.verifiedFacts,
          scoreComponents: components.map((c) => ({ label: c.label, state: c.state, detail: c.detail })),
          coreGate: result.coreGate,
          overall,
          verdict,
        })
        const raw = await chatWithRetry(sys, user, 1)
        let parsed: { summary?: string } | null = null
        try {
          parsed = extractJson<{ summary?: string }>(raw)
        } catch {
          parsed = null
        }
        if (parsed?.summary) {
          aiSummary = parsed.summary.slice(0, 600)
        } else if (raw && raw.trim().length > 20) {
          aiSummary = raw.trim().slice(0, 600)
        }
        if (aiSummary) engine = 'rules+AI'
      }
    } catch {
      // AI unavailable → the rules-based result stands alone (clearly labelled)
      aiSummary = null
      engine = 'rules-only'
    }

    return NextResponse.json({
      data: {
        source,
        job: jobMeta,
        candidate: { id: candidate.id, name: candidate.name, headline: candidate.headline },
        parseEngine,
        match: result,
        aiSummary,
        engine,
        advisory: 'Advisory only — scores never auto-reject candidates. The JD core (role/skills/responsibilities) decides; context checks are opt-in flags.',
        resumeEvidence: scrubResumeContact(candidate.resumeText).slice(0, 1200),
      },
    })
  } catch (err) {
    console.error('POST /api/sourcing/match failed:', err)
    return NextResponse.json({ error: 'Failed to compute match' }, { status: 500 })
  }
}

function jdParsedForAi(jd: JdParse) {
  return {
    roleTitle: jd.roleTitle,
    skills: jd.mustHaveSkills,
    experienceMin: jd.minYears,
    experienceMax: jd.maxYears,
    location: jd.location,
    responsibilities: jd.responsibilities.slice(0, 5),
  }
}
