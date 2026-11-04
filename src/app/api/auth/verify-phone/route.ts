import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkChallenge } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Same shape the sign-in flow returns so the UI can drop the user straight in
const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  phone: true,
  headline: true,
  location: true,
  company: true,
  skills: true,
  experienceYears: true,
  currentSalary: true,
  expectedSalary: true,
  education: true,
  resumeText: true,
  avatarSeed: true,
  noticePeriodDays: true,
  profileVisible: true,
  currentEmployer: true,
  githubUrl: true,
  linkedinUrl: true,
  behanceUrl: true,
  portfolioUrl: true,
  cvFileName: true,
  cvMimeType: true,
  cvUploadedAt: true,
  emailVerified: true,
  phoneVerified: true,
  photoMime: true,
  photoUploadedAt: true,
  clientId: true,
  createdAt: true,
} as const

/**
 * POST /api/auth/verify-phone — candidate sign-up step 3 (final).
 * Consumes the phone OTP, marks the number verified and signs the candidate
 * straight in (the account is now fully verified).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const code = typeof body?.code === 'string' ? body.code.trim() : ''

    if (!email || !code) {
      return NextResponse.json({ error: 'Email and 6-digit OTP are required' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { email } })
    if (!user || user.role !== 'CANDIDATE') {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    // Disabled accounts cannot complete sign-in through the OTP path either.
    if (user.disabled) {
      return NextResponse.json(
        { error: 'This account has been disabled. Contact support.' },
        { status: 403 }
      )
    }
    if (!user.emailVerified) {
      return NextResponse.json({ error: 'Verify your email first' }, { status: 403 })
    }

    if (!user.phoneVerified) {
      const check = await checkChallenge(user.id, 'PHONE_OTP', code)
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 })
      }
      await db.user.update({ where: { id: user.id }, data: { phoneVerified: true } })
    }

    const fresh = await db.user.findUnique({ where: { id: user.id }, select: USER_SELECT })
    return NextResponse.json({ data: fresh })
  } catch (err) {
    console.error('POST /api/auth/verify-phone failed:', err)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
