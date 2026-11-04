// SeeWe - /api/resume-drafts
// AI Resume Builder persistence (candidate-side, multiple drafts per user).
//
// GET    ?userId=...                       -> the user's drafts (parsed JSON sections, newest first)
// POST   {userId, title?, basics?, experience?, education?, skills?, projects?, targetJd?}
//                                         -> creates a draft, returns ResumeDraftData
// PATCH  {id, userId, ...same fields?, matchScore?, matchGaps?}
//                                         -> updates (userId must own the draft)
// DELETE ?id=&userId=                      -> removes the draft (owner only)
//
// Section payloads arrive as JSON objects/arrays and are stored as JSON
// strings (SQLite has no array/object column types). Candidates only ever
// see their OWN drafts — no recruiter/evaluation data anywhere here.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type {
  ResumeBasics,
  ResumeDraftData,
  ResumeEducationItem,
  ResumeExperienceItem,
  ResumeProjectItem,
} from '@/lib/types'

export const dynamic = 'force-dynamic'

function parseJsonSafe<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return (JSON.parse(raw) ?? fallback) as T
  } catch {
    return fallback
  }
}

function toDraftData(row: {
  id: string
  userId: string
  title: string
  basics: string
  experience: string
  education: string
  skills: string
  projects: string
  targetJd: string | null
  matchScore: number | null
  matchGaps: string | null
  createdAt: Date
  updatedAt: Date
}): ResumeDraftData {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    basics: parseJsonSafe<ResumeBasics>(row.basics, {}),
    experience: parseJsonSafe<ResumeExperienceItem[]>(row.experience, []),
    education: parseJsonSafe<ResumeEducationItem[]>(row.education, []),
    skills: parseJsonSafe<string[]>(row.skills, []),
    projects: parseJsonSafe<ResumeProjectItem[]>(row.projects, []),
    targetJd: row.targetJd,
    matchScore: row.matchScore,
    matchGaps: row.matchGaps ? parseJsonSafe(row.matchGaps, null) : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Extract + validate the writable section fields from a request body. */
function sectionData(body: Record<string, unknown>): Record<string, string | null> {
  const data: Record<string, string | null> = {}
  if (body.basics !== undefined) {
    data.basics = body.basics === null ? '{}' : JSON.stringify(body.basics ?? {})
  }
  if (body.experience !== undefined) {
    data.experience = body.experience === null ? '[]' : JSON.stringify(Array.isArray(body.experience) ? body.experience : [])
  }
  if (body.education !== undefined) {
    data.education = body.education === null ? '[]' : JSON.stringify(Array.isArray(body.education) ? body.education : [])
  }
  if (body.skills !== undefined) {
    data.skills = body.skills === null
      ? '[]'
      : JSON.stringify(Array.isArray(body.skills) ? body.skills.map((s) => String(s).trim()).filter(Boolean) : [])
  }
  if (body.projects !== undefined) {
    data.projects = body.projects === null ? '[]' : JSON.stringify(Array.isArray(body.projects) ? body.projects : [])
  }
  if (body.targetJd !== undefined) {
    data.targetJd =
      typeof body.targetJd === 'string' && body.targetJd.trim()
        ? body.targetJd.trim().slice(0, 6000)
        : null
  }
  return data
}

export async function GET(request: Request) {
  try {
    const userId = new URL(request.url).searchParams.get('userId')?.trim() ?? ''
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    const drafts = await db.resumeDraft.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' as const },
      take: 50,
    })
    return NextResponse.json({ data: drafts.map(toDraftData) })
  } catch (error) {
    console.error('[resume-drafts][GET] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to load resume drafts' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const title =
      typeof body?.title === 'string' && body.title.trim()
        ? body.title.trim().slice(0, 120)
        : 'My Resume'

    const draft = await db.resumeDraft.create({
      data: { userId, title, ...sectionData(body) },
    })
    return NextResponse.json({ data: toDraftData(draft) }, { status: 201 })
  } catch (error) {
    console.error('[resume-drafts][POST] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to create resume draft' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    if (!id || !userId) {
      return NextResponse.json({ error: 'id and userId are required' }, { status: 400 })
    }

    const existing = await db.resumeDraft.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Resume draft not found' }, { status: 404 })
    }
    if (existing.userId !== userId) {
      return NextResponse.json({ error: 'You can only edit your own resume drafts' }, { status: 403 })
    }

    const data: Record<string, unknown> = sectionData(body)
    if (typeof body?.title === 'string' && body.title.trim()) {
      data.title = body.title.trim().slice(0, 120)
    }
    if (body?.matchScore !== undefined) {
      const n = Number(body.matchScore)
      data.matchScore = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null
    }
    if (body?.matchGaps !== undefined) {
      data.matchGaps = body.matchGaps === null ? null : JSON.stringify(body.matchGaps)
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    const updated = await db.resumeDraft.update({ where: { id }, data })
    return NextResponse.json({ data: toDraftData(updated) })
  } catch (error) {
    console.error('[resume-drafts][PATCH] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to update resume draft' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const sp = new URL(request.url).searchParams
    const id = sp.get('id')?.trim() ?? ''
    const userId = sp.get('userId')?.trim() ?? ''
    if (!id || !userId) {
      return NextResponse.json({ error: 'id and userId are required' }, { status: 400 })
    }
    const existing = await db.resumeDraft.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Resume draft not found' }, { status: 404 })
    }
    if (existing.userId !== userId) {
      return NextResponse.json({ error: 'You can only delete your own resume drafts' }, { status: 403 })
    }
    await db.resumeDraft.delete({ where: { id } })
    return NextResponse.json({ data: { deleted: true, id } })
  } catch (error) {
    console.error('[resume-drafts][DELETE] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to delete resume draft' }, { status: 500 })
  }
}
