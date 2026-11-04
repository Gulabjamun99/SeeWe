import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  hashPassword,
  passwordIssues,
  normalisePhone,
  createChallenge,
  sendAuthEmail,
  emailVerifyEmail,
} from '@/lib/auth'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * POST /api/auth/register — candidate sign-up step 1.
 * Creates a CANDIDATE account with a password + phone, then issues the
 * email-verification challenge. The account stays locked out of sign-in until
 * the email is verified (and the phone OTP is confirmed in step 3).
 * Sandbox: the code is also returned as `devCode` because there is no SMTP.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const phoneRaw = typeof body.phone === 'string' ? body.phone : ''
    // Master spec §37: explicit ToS + Privacy consent at sign-up (optional for
    // backward compatibility — older clients simply omit the field).
    const acceptedTos = body.acceptedTos === true

    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'Please enter your full name' }, { status: 400 })
    }
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'A valid email address is required' }, { status: 400 })
    }
    const pwIssues = passwordIssues(password)
    if (pwIssues.length > 0) {
      return NextResponse.json(
        { error: `Password needs ${pwIssues.join(', ')}` },
        { status: 400 }
      )
    }
    const phone = normalisePhone(phoneRaw)
    if (!phone) {
      return NextResponse.json(
        { error: 'Enter a valid 10-digit mobile number' },
        { status: 400 }
      )
    }

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) {
      // Same email already registered — if it's an unverified half-made signup,
      // let them restart the verification chain instead of failing hard.
      if (existing.role === 'CANDIDATE' && !existing.emailVerified) {
        if (acceptedTos) {
          await recordTosConsent(existing.id)
        }
        const code = await createChallenge(existing.id, 'EMAIL_VERIFY', email)
        const mail = emailVerifyEmail(existing.name, code)
        await sendAuthEmail({ to: email, toUserId: existing.id, kind: 'EMAIL_VERIFY', ...mail })
        return NextResponse.json({
          data: {
            userId: existing.id,
            email,
            emailVerified: false,
            devCode: code,
            note: 'Account exists but email was never verified — a fresh verification code has been sent.',
          },
        })
      }
      return NextResponse.json(
        { error: 'An account with this email already exists. Please sign in.' },
        { status: 409 }
      )
    }

    const user = await db.user.create({
      data: {
        email,
        name,
        role: 'CANDIDATE',
        password: hashPassword(password),
        phone,
        avatarSeed: Math.random().toString(36).slice(2, 12),
        ...(acceptedTos ? { tosAcceptedAt: new Date() } : {}),
      },
    })

    if (acceptedTos) {
      await db.consentRecord.create({
        data: { userId: user.id, kind: 'TOS', version: '1.0' },
      })
    }

    const code = await createChallenge(user.id, 'EMAIL_VERIFY', email)
    const mail = emailVerifyEmail(name, code)
    await sendAuthEmail({ to: email, toUserId: user.id, kind: 'EMAIL_VERIFY', ...mail })

    return NextResponse.json({
      data: {
        userId: user.id,
        email,
        emailVerified: false,
        devCode: code, // sandbox only — remove when a real SMTP provider is wired
      },
    })
  } catch (err) {
    console.error('POST /api/auth/register failed:', err)
    return NextResponse.json({ error: 'Registration failed' }, { status: 500 })
  }
}

/** Stamp tosAcceptedAt + append an immutable ConsentRecord row (TOS v1.0). */
async function recordTosConsent(userId: string): Promise<void> {
  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { tosAcceptedAt: new Date() } }),
    db.consentRecord.create({ data: { userId, kind: 'TOS', version: '1.0' } }),
  ])
}
