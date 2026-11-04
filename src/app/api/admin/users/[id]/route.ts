import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// SeeWe — Admin user management: PATCH /api/admin/users/[id]
// Body: { adminId: string, disabled: boolean }
//
// Toggling `disabled` immediately blocks ALL sign-ins for that email (the
// check lives in /api/auth/login + /api/auth/verify-phone). The admin cannot
// disable their own account (400) — that would lock the console.

const ERROR_MISSING_ID = 'adminId is required in the request body'
const ERROR_FORBIDDEN = 'Admin access required'
const ERROR_SELF_DISABLE = 'You cannot disable your own account'
const ERROR_SERVER = 'Failed to update user'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const adminId = typeof body.adminId === 'string' ? body.adminId : ''
    const disabled = body.disabled
    if (!adminId) {
      return NextResponse.json({ error: ERROR_MISSING_ID }, { status: 400 })
    }
    if (typeof disabled !== 'boolean') {
      return NextResponse.json(
        { error: "Field 'disabled' (boolean) is required" },
        { status: 400 }
      )
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

    if (id === adminId && disabled) {
      return NextResponse.json({ error: ERROR_SELF_DISABLE }, { status: 400 })
    }

    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, disabled: true },
    })
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const updated = await db.user.update({
      where: { id },
      data: { disabled },
      select: { id: true, name: true, email: true, disabled: true },
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PATCH /api/admin/users/[id] failed:', err)
    return NextResponse.json({ error: ERROR_SERVER }, { status: 500 })
  }
}
