import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// SeeWe — Admin user management: GET /api/admin/users?q=…
//
// AUTH (demo-auth model, same guard as /api/admin/stats): the caller passes
// its own user id as `adminId` and we verify it references an ADMIN account.
// A non-admin id → 403.

const ERROR_MISSING_ID = 'Query param adminId is required'
const ERROR_FORBIDDEN = 'Admin access required'
const ERROR_SERVER = 'Failed to load users'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const adminId = req.nextUrl.searchParams.get('adminId')
    if (!adminId || !adminId.trim()) {
      return NextResponse.json({ error: ERROR_MISSING_ID }, { status: 400 })
    }

    const admin = await db.user.findUnique({
      where: { id: adminId },
      select: { id: true, role: true },
    })
    if (!admin) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    if (admin.role !== 'ADMIN') {
      return NextResponse.json({ error: ERROR_FORBIDDEN }, { status: 403 })
    }

    const q = (req.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase()

    const users = await db.user.findMany({
      orderBy: { createdAt: 'desc' as const },
      take: 200,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        disabled: true,
        emailVerified: true,
        phoneVerified: true,
        createdAt: true,
      },
    })

    // Simple substring filter (name or email, case-insensitive) in JS —
    // SQLite has no case-insensitive contains.
    const filtered = q
      ? users.filter(
          (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
        )
      : users

    // Optional application counts, batched for the filtered set
    const appCounts = await db.application.groupBy({
      by: ['candidateId'],
      where: { candidateId: { in: filtered.map((u) => u.id) } },
      _count: { _all: true },
    })
    const countByUser = new Map(appCounts.map((row) => [row.candidateId, row._count?._all ?? 0]))

    return NextResponse.json({
      data: filtered.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        disabled: u.disabled,
        emailVerified: u.emailVerified,
        phoneVerified: u.phoneVerified,
        createdAt: u.createdAt.toISOString(),
        applicationCount: countByUser.get(u.id) ?? 0,
      })),
    })
  } catch (err) {
    console.error('GET /api/admin/users failed:', err)
    return NextResponse.json({ error: ERROR_SERVER }, { status: 500 })
  }
}
