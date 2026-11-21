import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

type SectionType = 'experience' | 'project' | 'education' | 'certification'

const SECTION_TYPES: SectionType[] = ['experience', 'project', 'education', 'certification']

function isSectionType(v: unknown): v is SectionType {
  return typeof v === 'string' && (SECTION_TYPES as string[]).includes(v)
}

function str(v: unknown, max = 400): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

async function resolveCandidateId(idOrEmail: string): Promise<string> {
  const decoded = decodeURIComponent(idOrEmail).trim()
  let user = await db.user.findFirst({
    where: {
      OR: [
        { id: decoded },
        { email: decoded.toLowerCase() },
      ],
    },
    select: { id: true },
  })

  if (!user) {
    const isEmail = decoded.includes('@')
    const email = isEmail ? decoded.toLowerCase() : `${decoded}@candidate.seewe.local`
    user = await db.user.create({
      data: {
        id: decoded.startsWith('c') && decoded.length > 20 ? decoded : undefined,
        name: isEmail ? decoded.split('@')[0] : 'Candidate',
        email,
        role: 'candidate',
      },
      select: { id: true },
    })
  }

  return user.id
}

async function loadSections(userId: string) {
  const [experiences, projects, education, certifications] = await Promise.all([
    db.workExperience.findMany({ where: { userId }, orderBy: [{ isCurrent: 'desc' }, { startDate: 'desc' }] }),
    db.userProject.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    db.educationEntry.findMany({ where: { userId }, orderBy: { endYear: 'desc' } }),
    db.certification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
  ])
  return { experiences, projects, education, certifications }
}

/** GET /api/candidates/[id]/sections — all structured profile sections (owner or recruiter view). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const userId = await resolveCandidateId(id)
    const sections = await loadSections(userId)
    return NextResponse.json({ data: sections })
  } catch (err) {
    console.error('GET /api/candidates/[id]/sections failed:', err)
    return NextResponse.json({ error: 'Failed to load profile sections' }, { status: 500 })
  }
}

/** POST /api/candidates/[id]/sections — create one section item. body: { type, ...fields } */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const userId = await resolveCandidateId(id)
    const body = await req.json().catch(() => null)
    if (!isSectionType(body?.type)) {
      return NextResponse.json(
        { error: "type must be 'experience' | 'project' | 'education' | 'certification'" },
        { status: 400 }
      )
    }

    if (body.type === 'experience') {
      const title = str(body.title, 120)
      const company = str(body.company, 120)
      const startDate = str(body.startDate, 7) // YYYY-MM
      if (!title || !company || !startDate) {
        return NextResponse.json(
          { error: 'Designation, company and start date are required' },
          { status: 400 }
        )
      }
      const isCurrent = Boolean(body.isCurrent)
      await db.workExperience.create({
        data: {
          userId,
          title,
          company,
          isCurrent,
          startDate,
          endDate: isCurrent ? null : str(body.endDate, 7),
          location: str(body.location, 120),
          description: str(body.description, 2000),
        },
      })
    } else if (body.type === 'project') {
      const title = str(body.title, 140)
      if (!title) {
        return NextResponse.json({ error: 'Project title is required' }, { status: 400 })
      }
      await db.userProject.create({
        data: {
          userId,
          title,
          techStack: str(body.techStack, 300),
          startDate: str(body.startDate, 7),
          endDate: str(body.endDate, 7),
          description: str(body.description, 2000),
          link: str(body.link, 300),
        },
      })
    } else if (body.type === 'education') {
      const degree = str(body.degree, 160)
      const institution = str(body.institution, 160)
      if (!degree || !institution) {
        return NextResponse.json(
          { error: 'Degree and institution are required' },
          { status: 400 }
        )
      }
      await db.educationEntry.create({
        data: {
          userId,
          degree,
          institution,
          startYear: str(body.startYear, 9),
          endYear: str(body.endYear, 9),
          score: str(body.score, 40),
        },
      })
    } else {
      const name = str(body.name, 160)
      if (!name) {
        return NextResponse.json({ error: 'Certification name is required' }, { status: 400 })
      }
      await db.certification.create({
        data: {
          userId,
          name,
          issuer: str(body.issuer, 160),
          year: str(body.year, 9),
          link: str(body.link, 300),
        },
      })
    }

    return NextResponse.json({ data: await loadSections(userId) })
  } catch (err) {
    console.error('POST /api/candidates/[id]/sections failed:', err)
    return NextResponse.json({ error: 'Failed to save section item' }, { status: 500 })
  }
}

/** PATCH /api/candidates/[id]/sections — update one item. body: { type, itemId, ...fields } */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const userId = await resolveCandidateId(id)
    const body = await req.json().catch(() => null)
    if (!isSectionType(body?.type) || !body?.itemId) {
      return NextResponse.json({ error: 'type and itemId are required' }, { status: 400 })
    }
    const itemId = String(body.itemId)

    if (body.type === 'experience') {
      const isCurrent = Boolean(body.isCurrent)
      await db.workExperience.updateMany({
        where: { id: itemId, userId },
        data: {
          title: str(body.title, 120) ?? undefined,
          company: str(body.company, 120) ?? undefined,
          isCurrent,
          startDate: str(body.startDate, 7) ?? undefined,
          endDate: isCurrent ? null : str(body.endDate, 7),
          location: str(body.location, 120),
          description: str(body.description, 2000),
        },
      })
    } else if (body.type === 'project') {
      await db.userProject.updateMany({
        where: { id: itemId, userId },
        data: {
          title: str(body.title, 140) ?? undefined,
          techStack: str(body.techStack, 300),
          startDate: str(body.startDate, 7),
          endDate: str(body.endDate, 7),
          description: str(body.description, 2000),
          link: str(body.link, 300),
        },
      })
    } else if (body.type === 'education') {
      await db.educationEntry.updateMany({
        where: { id: itemId, userId },
        data: {
          degree: str(body.degree, 160) ?? undefined,
          institution: str(body.institution, 160) ?? undefined,
          startYear: str(body.startYear, 9),
          endYear: str(body.endYear, 9),
          score: str(body.score, 40),
        },
      })
    } else {
      await db.certification.updateMany({
        where: { id: itemId, userId },
        data: {
          name: str(body.name, 160) ?? undefined,
          issuer: str(body.issuer, 160),
          year: str(body.year, 9),
          link: str(body.link, 300),
        },
      })
    }

    return NextResponse.json({ data: await loadSections(userId) })
  } catch (err) {
    console.error('PATCH /api/candidates/[id]/sections failed:', err)
    return NextResponse.json({ error: 'Failed to update section item' }, { status: 500 })
  }
}

/** DELETE /api/candidates/[id]/sections?type=experience&itemId=... */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const userId = await resolveCandidateId(id)
    const type = req.nextUrl.searchParams.get('type')
    const itemId = req.nextUrl.searchParams.get('itemId') ?? ''
    if (!isSectionType(type) || !itemId) {
      return NextResponse.json({ error: 'type and itemId are required' }, { status: 400 })
    }
    if (type === 'experience') {
      await db.workExperience.deleteMany({ where: { id: itemId, userId } })
    } else if (type === 'project') {
      await db.userProject.deleteMany({ where: { id: itemId, userId } })
    } else if (type === 'education') {
      await db.educationEntry.deleteMany({ where: { id: itemId, userId } })
    } else {
      await db.certification.deleteMany({ where: { id: itemId, userId } })
    }
    return NextResponse.json({ data: await loadSections(userId) })
  } catch (err) {
    console.error('DELETE /api/candidates/[id]/sections failed:', err)
    return NextResponse.json({ error: 'Failed to delete section item' }, { status: 500 })
  }
}
