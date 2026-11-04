import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkChallenge, hashPassword, passwordIssues } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/reset-password — consume the reset code + set a new password.
 * body: { email, code, password }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''
    const password = typeof body?.password === 'string' ? body.password : ''

    if (!email || !code) {
      return NextResponse.json({ error: 'Email and reset code are required' }, { status: 400 })
    }
    const pwIssues = passwordIssues(password)
    if (pwIssues.length > 0) {
      return NextResponse.json(
        { error: `Password needs ${pwIssues.join(', ')}` },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user || user.role !== 'CANDIDATE' || !user.password) {
      return NextResponse.json({ error: 'Invalid reset request' }, { status: 400 })
    }

    const check = await checkChallenge(user.id, 'PASSWORD_RESET', code)
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 })
    }

    await db.user.update({
      where: { id: user.id },
      data: { password: hashPassword(password) },
    })

    return NextResponse.json({ data: { reset: true } })
  } catch (err) {
    console.error('POST /api/auth/reset-password failed:', err)
    return NextResponse.json({ error: 'Password reset failed' }, { status: 500 })
  }
}
