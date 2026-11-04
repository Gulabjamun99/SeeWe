import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createChallenge,
  sendAuthEmail,
  emailVerifyEmail,
  phoneOtpEmail,
} from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/otp/resend — re-send the pending verification code.
 * body: { email, kind: 'EMAIL_VERIFY' | 'PHONE_OTP' }
 * Sandbox: the fresh code is returned as `devCode` (no SMTP/SMS relay).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const kind = body?.kind === 'PHONE_OTP' ? 'PHONE_OTP' : 'EMAIL_VERIFY'

    const user = await db.user.findUnique({ where: { email } })
    if (!user || user.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    if (kind === 'EMAIL_VERIFY') {
      if (user.emailVerified) {
        return NextResponse.json({ error: 'Email is already verified' }, { status: 409 })
      }
      const code = await createChallenge(user.id, 'EMAIL_VERIFY', user.email)
      const mail = emailVerifyEmail(user.name, code)
      await sendAuthEmail({ to: user.email, toUserId: user.id, kind: 'EMAIL_VERIFY', ...mail })
      return NextResponse.json({ data: { sent: true, devCode: code } })
    }

    // PHONE_OTP
    if (!user.emailVerified) {
      return NextResponse.json({ error: 'Verify your email first' }, { status: 403 })
    }
    if (user.phoneVerified) {
      return NextResponse.json({ error: 'Phone is already verified' }, { status: 409 })
    }
    const phone = user.phone ?? ''
    if (!phone) {
      return NextResponse.json({ error: 'No mobile number on the account' }, { status: 400 })
    }
    const code = await createChallenge(user.id, 'PHONE_OTP', phone)
    const mail = phoneOtpEmail(user.name, phone, code)
    await sendAuthEmail({ to: user.email, toUserId: user.id, kind: 'PHONE_OTP', ...mail })
    return NextResponse.json({ data: { sent: true, devCode: code } })
  } catch (err) {
    console.error('POST /api/auth/otp/resend failed:', err)
    return NextResponse.json({ error: 'Could not resend code' }, { status: 500 })
  }
}
