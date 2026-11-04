import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { maskEmail, maskPhone } from '@/lib/talent-search-engine'

/** Remove emails/phone numbers from free text before it leaves the server. */
function scrubContact(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email hidden]')
    .replace(/(\+?\d[\d\s-]{8,}\d)/g, '[phone hidden]')
}

const CANDIDATE_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
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
  profileVisible: true,
  // Portfolio / public profile links (candidate-chosen, shareable)
  githubUrl: true,
  linkedinUrl: true,
  behanceUrl: true,
  portfolioUrl: true,
  // PRIVATE field — stripped for every non-self reader in GET below
  currentEmployer: true,
  // CV metadata only — the binary streams via /api/candidates/[id]/cv
  cvFileName: true,
  cvMimeType: true,
  cvUploadedAt: true,
  // Verification badges + profile photo meta
  emailVerified: true,
  phoneVerified: true,
  photoMime: true,
  photoUploadedAt: true,
  // Desired job preferences
  desiredRole: true,
  desiredLocations: true,
  desiredJobType: true,
  desiredIndustry: true,
} as const

// GET /api/candidates/[id] - profile + application summary
// ?viewerId=<userId> identifies the caller: only the profile owner (self-read)
// may see currentEmployer — recruiters and anonymous readers get it stripped.
//
// PRIVACY (sourcing module): non-self reads NEVER receive raw email/phone —
// masked forms are returned and the real values unlock via POST
// /api/candidates/[id]/contact (role-gated, quota-tracked). Free-text resume
// is scrubbed of contact details for non-self readers too.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const viewerId = req.nextUrl.searchParams.get('viewerId') || ''
    const user = await db.user.findUnique({
      where: { id },
      select: {
        ...CANDIDATE_SELECT,
        applications: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            matchScore: true,
            jobId: true,
            coverNote: true,
            createdAt: true,
            job: { select: { id: true, title: true, company: true } },
          },
        },
        // Structured profile sections
        workExperiences: {
          orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }],
        },
        projects: { orderBy: { createdAt: 'desc' } },
        educationEntries: { orderBy: { endYear: 'desc' } },
        certifications: { orderBy: { createdAt: 'desc' } },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    // Password never selected; destructure just for clarity that it stays out
    const {
      applications,
      workExperiences,
      projects,
      educationEntries,
      certifications,
      ...profile
    } = user

    // PRIVACY (absolute): currentEmployer is the candidate's private field —
    // only a self-read (viewerId === profile id) may include it. Recruiter
    // profile reads and anonymous calls always receive it stripped.
    const isSelfRead = !!viewerId && viewerId === id
    let safeProfile = isSelfRead ? profile : { ...profile, currentEmployer: null }

    // PRIVACY: contact fields are masked unless the caller is the profile
    // owner. Recruiters reveal via the logged + quota-tracked contact route.
    if (!isSelfRead) {
      safeProfile = {
        ...safeProfile,
        email: maskEmail(safeProfile.email) ?? safeProfile.email,
        phone: maskPhone(safeProfile.phone) ?? safeProfile.phone,
        resumeText: scrubContact(safeProfile.resumeText),
        contactMasked: true,
      } as typeof safeProfile & { contactMasked: boolean }
    }

    // Sourcing analytics: a RECRUITER viewing the full profile is a counted
    // PROFILE_VIEW (best-effort — never blocks the read).
    if (!isSelfRead && viewerId) {
      try {
        const viewer = await db.user.findUnique({
          where: { id: viewerId },
          select: { role: true },
        })
        if (viewer?.role === 'RECRUITER') {
          await db.usageLog.create({
            data: {
              actorId: viewerId,
              kind: 'PROFILE_VIEW',
              meta: JSON.stringify({ candidateId: id }),
            },
          })
        }
      } catch {
        /* logging must not break profile reads */
      }
    }

    const summary = {
      total: applications.length,
      shortlisted: applications.filter((a) =>
        ['SHORTLISTED', 'INTERVIEW_SCHEDULED', 'INTERVIEWED', 'SHARED_WITH_CLIENT', 'HIRED'].includes(a.status)
      ).length,
      rejected: applications.filter((a) => a.status === 'REJECTED').length,
      activeJobsApplied: new Set(applications.map((a) => a.jobId)).size,
    }

    return NextResponse.json({
      data: {
        ...safeProfile,
        applications,
        stats: summary,
        sections: {
          experiences: workExperiences,
          projects,
          education: educationEntries,
          certifications,
        },
      },
    })
  } catch (err) {
    console.error('GET /api/candidates/[id] failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch candidate' },
      { status: 500 }
    )
  }
}

// PATCH /api/candidates/[id] - update own profile (editable fields whitelisted)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))

    // Whitelist of editable profile fields
    const allowed = [
      'name',
      'phone',
      'headline',
      'location',
      'skills',
      'experienceYears',
      'currentSalary',
      'expectedSalary',
      'education',
      'resumeText',
      'company',
      'noticePeriodDays',
      'profileVisible',
      // Portfolio / public profile links
      'githubUrl',
      'linkedinUrl',
      'behanceUrl',
      'portfolioUrl',
      // PRIVATE candidate field (their own employer — self-edit only)
      'currentEmployer',
      // Desired job preferences
      'desiredRole',
      'desiredLocations',
      'desiredJobType',
      'desiredIndustry',
    ] as const

    const data: Record<string, unknown> = {}
    for (const field of allowed) {
      if (body?.[field] !== undefined) {
        let value = body[field]

        // Portfolio / public profile links: empty value clears the field;
        // otherwise it must look like a real URL (http/https, ≤200 chars).
        if (
          field === 'githubUrl' ||
          field === 'linkedinUrl' ||
          field === 'behanceUrl' ||
          field === 'portfolioUrl'
        ) {
          if (value === null || (typeof value === 'string' && value.trim() === '')) {
            data[field] = null
            continue
          }
          if (typeof value !== 'string') {
            return NextResponse.json({ error: `${field} must be a string` }, { status: 400 })
          }
          const url = value.trim()
          if (!/^https?:\/\//i.test(url) || url.length > 200) {
            return NextResponse.json(
              { error: `${field} must start with http:// or https:// and be at most 200 characters` },
              { status: 400 }
            )
          }
          data[field] = url
          continue
        }

        // currentEmployer: PRIVATE — plain text only, capped at 80 characters.
        if (field === 'currentEmployer') {
          if (value === null || (typeof value === 'string' && value.trim() === '')) {
            data[field] = null
            continue
          }
          if (typeof value !== 'string') {
            return NextResponse.json(
              { error: 'currentEmployer must be a string' },
              { status: 400 }
            )
          }
          const employer = value.trim()
          if (employer.length > 80) {
            return NextResponse.json(
              { error: 'currentEmployer must be 80 characters or fewer' },
              { status: 400 }
            )
          }
          data[field] = employer
          continue
        }

        // Type coercion & validation
        if (field === 'name' && (!value || typeof value !== 'string' || !value.trim())) {
          return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
        }
        if (
          field === 'experienceYears' ||
          field === 'currentSalary' ||
          field === 'expectedSalary'
        ) {
          if (value === null || value === '') value = null
          else {
            const num = Number(value)
            // Sanity caps: 60 yrs / 500 LPA keep typos & abuse out of the DB
            const cap = field === 'experienceYears' ? 60 : 500
            if (!Number.isFinite(num) || num < 0 || num > cap) {
              return NextResponse.json(
                { error: `${field} must be a number between 0 and ${cap}` },
                { status: 400 }
              )
            }
            value = num
          }
        }
        // Notice period: null/unset or an integer 0..180 days (0 = immediate)
        if (field === 'noticePeriodDays') {
          if (value === null || value === '') value = null
          else {
            const num = Number(value)
            if (!Number.isInteger(num) || num < 0 || num > 180) {
              return NextResponse.json(
                { error: 'noticePeriodDays must be an integer between 0 and 180' },
                { status: 400 }
              )
            }
            value = num
          }
        }
        // profileVisible: strict boolean only
        if (field === 'profileVisible' && typeof value !== 'boolean') {
          return NextResponse.json(
            { error: 'profileVisible must be a boolean' },
            { status: 400 }
          )
        }
        // String fields must actually be strings (reject objects/booleans)
        if (
          field !== 'experienceYears' &&
          field !== 'currentSalary' &&
          field !== 'expectedSalary' &&
          field !== 'noticePeriodDays' &&
          field !== 'profileVisible' &&
          value !== null &&
          typeof value !== 'string'
        ) {
          return NextResponse.json({ error: `${field} must be a string` }, { status: 400 })
        }
        if (typeof value === 'string') {
          value = value.trim()
          if (value.length > 8000) value = value.slice(0, 8000)
        }
        data[field] = value
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Role guard: this endpoint edits CANDIDATE profiles only. Without this
    // check anyone could rewrite recruiter/client names (impersonation) via IDOR.
    const existing = await db.user.findUnique({ where: { id }, select: { id: true, role: true } })
    if (!existing || existing.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 })
    }

    const updated = await db.user.update({
      where: { id },
      data,
      select: CANDIDATE_SELECT,
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PATCH /api/candidates/[id] failed:', err)
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    )
  }
}
