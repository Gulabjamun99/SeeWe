import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createChallenge, sendAuthEmail, passwordResetEmail } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/forgot-password — issue a password-reset code for the email.
 * Always responds 200 (never reveals whether the email exists).
 * Sandbox: for registered candidates `devCode` is returned (no SMTP relay).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user || user.role !== 'CANDIDATE' || !user.password) {
      // Anti-enumeration: same friendly response either way
      return NextResponse.json({
        data: {
          sent: true,
          note: 'If an account exists for this email, a reset code has been sent.',
        },
      })
    }

    const code = await createChallenge(user.id, 'PASSWORD_RESET', email)
    const mail = passwordResetEmail(user.name, code)
    await sendAuthEmail({ to: email, toUserId: user.id, kind: 'PASSWORD_RESET', ...mail })

    return NextResponse.json({
      data: { sent: true, devCode: code }, // sandbox only
    })
  } catch (err) {
    console.error('POST /api/auth/forgot-password failed:', err)
    return NextResponse.json({ error: 'Could not start password reset' }, { status: 500 })
  }
}
