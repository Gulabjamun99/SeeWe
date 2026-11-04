import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createChallenge,
  sendAuthEmail,
  emailVerifyEmail,
} from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/auth/verify-email — candidate sign-up step 2.
 * Consumes the 6-digit email code and unlocks the phone-OTP step.
 * Sandbox: response includes `devCode` for the auto-sent phone OTP.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''

    if (!email || !code) {
      return NextResponse.json({ error: 'Email and 6-digit code are required' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user || user.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    if (user.emailVerified) {
      // Idempotent — jump straight to phone verification
      return NextResponse.json({ data: { emailVerified: true, nextStep: 'verify-phone' } })
    }

    const { checkChallenge } = await import('@/lib/auth')
    const check = await checkChallenge(user.id, 'EMAIL_VERIFY', code)
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: 400 })
    }

    await db.user.update({ where: { id: user.id }, data: { emailVerified: true } })

    // Auto-issue the phone OTP so the UI can flow straight into step 3
    const phone = user.phone ?? ''
    let devCode: string | undefined
    if (phone) {
      const otp = await createChallenge(user.id, 'PHONE_OTP', phone)
      const mail = emailVerifyPhoneEmail(user.name, phone, otp)
      await sendAuthEmail({ to: user.email, toUserId: user.id, kind: 'PHONE_OTP', ...mail })
      devCode = otp // sandbox only
    }

    return NextResponse.json({
      data: { emailVerified: true, nextStep: 'verify-phone', phone, devCode },
    })
  } catch (err) {
    console.error('POST /api/auth/verify-email failed:', err)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}

// local import-order helper (kept local to avoid widening the public lib API)
function emailVerifyPhoneEmail(name: string, phone: string, code: string) {
  return {
    subject: `Verify your mobile number — OTP ${code}`,
    body: [
      `Hi ${name},`,
      ``,
      `Your mobile verification OTP for ${phone} is: ${code}`,
      ``,
      `Enter this OTP to confirm your number. It expires in 15 minutes.`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}
