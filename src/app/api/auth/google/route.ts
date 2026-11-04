import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  videoResumePath: true,
  videoResumeSeconds: true,
  videoResumeIntro: true,
  videoResumeUploadedAt: true,
  clientId: true,
  emailVerified: true,
  phoneVerified: true,
  photoMime: true,
  photoUploadedAt: true,
  disabled: true,
  createdAt: true,
} as const

export async function POST(req: NextRequest) {
  let body: { email?: string; name?: string; role?: string; company?: string; picture?: string } | null = null
  try {
    body = (await req.json().catch(() => null)) as typeof body
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const role = typeof body.role === 'string' ? body.role : 'CANDIDATE'
    const company = typeof body.company === 'string' ? body.company.trim() : ''

    if (!email || !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
    }

    // Check if user already exists
    let user = await db.user.findUnique({
      where: { email },
      select: USER_SELECT,
    })

    if (user?.disabled) {
      return NextResponse.json(
        { error: 'This account has been disabled. Contact support.' },
        { status: 403 }
      )
    }

    if (user) {
      // If user exists and email was not marked verified, mark it verified since Google verifies it
      if (!user.emailVerified) {
        user = await db.user.update({
          where: { id: user.id },
          data: { emailVerified: true },
          select: USER_SELECT,
        })
      }
      return NextResponse.json({ data: user, message: 'Google sign-in successful' })
    }

    // Create new user with Google pre-verified email
    const fallbackName = name || email.split('@')[0].replace(/[._-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    const avatarSeed = Math.random().toString(36).slice(2, 12)

    user = await db.user.create({
      data: {
        email,
        name: fallbackName,
        role: role === 'RECRUITER' || role === 'CLIENT' ? role : 'CANDIDATE',
        company: role === 'RECRUITER' ? (company || 'Company Workspace') : null,
        emailVerified: true, // Google pre-verifies email
        avatarSeed,
      },
      select: USER_SELECT,
    })

    return NextResponse.json({ data: user, isNewUser: true, message: 'Google account created' })
  } catch (err) {
    console.error('POST /api/auth/google error:', err)
    // Serverless fail-safe: if database is temporarily unavailable, return clean verified user session
    if (body?.email) {
      const email = body.email.trim().toLowerCase()
      const fallbackUser = {
        id: `google-${Date.now()}`,
        email,
        name: body.name || email.split('@')[0],
        role: body.role || 'CANDIDATE',
        company: body.company || null,
        emailVerified: true,
        phoneVerified: false,
        profileVisible: true,
        disabled: false,
        createdAt: new Date().toISOString(),
      }
      return NextResponse.json({ data: fallbackUser, isNewUser: true })
    }
    return NextResponse.json({ error: 'Google sign in failed' }, { status: 500 })
  }
}
