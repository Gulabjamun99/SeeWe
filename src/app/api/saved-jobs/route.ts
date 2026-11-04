// SeeWe - Saved Jobs (bookmark) API
// GET  /api/saved-jobs?userId=...            -> { data: Job[] } with savedAt
// POST /api/saved-jobs { userId, jobId }     -> toggle: saves if missing, removes if present
//                                                 { data: { saved: boolean } }

import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const saved = await db.savedJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        job: {
          include: {
            _count: { select: { applications: true } },
          },
        },
      },
      take: 100,
    })

    return NextResponse.json({
      data: saved.map((s) => ({ ...s.job, savedAt: s.createdAt })),
    })
  } catch (err) {
    console.error('GET /api/saved-jobs failed:', err)
    return NextResponse.json(
      { error: 'Failed to load saved jobs' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : ''

    if (!userId || !jobId) {
      return NextResponse.json({ error: 'userId and jobId are required' }, { status: 400 })
    }

    const existing = await db.savedJob.findUnique({
      where: { userId_jobId: { userId, jobId } },
    })

    if (existing) {
      await db.savedJob.delete({ where: { id: existing.id } })
      return NextResponse.json({ data: { saved: false } })
    }

    // Validate the job exists so users don't bookmark dangling ids
    const job = await db.job.findUnique({ where: { id: jobId }, select: { id: true } })
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // Validate the user exists so orphan rows can never be created
    const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Upsert-style save with graceful duplicate handling (double-click / races)
    try {
      await db.savedJob.create({ data: { userId, jobId } })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return NextResponse.json({ data: { saved: true } })
      }
      throw e
    }
    return NextResponse.json({ data: { saved: true } })
  } catch (err) {
    console.error('POST /api/saved-jobs failed:', err)
    return NextResponse.json(
      { error: 'Failed to save job' },
      { status: 500 }
    )
  }
}
