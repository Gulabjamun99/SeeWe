import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isLoginLocked, registerLoginFail, clearLoginFails, verifyPassword } from '@/lib/auth'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const ERROR_DISABLED = 'This account has been disabled. Contact support.'
const VALID_ROLES = ['CANDIDATE', 'RECRUITER', 'CLIENT', 'ADMIN']

// Never leak password anywhere
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
  // privacy shield + portfolio links (currentEmployer is candidate-private; the
  // login response only ever goes back to the signed-in user themselves)
  currentEmployer: true,
  githubUrl: true,
  linkedinUrl: true,
  behanceUrl: true,
  portfolioUrl: true,
  cvFileName: true,
  cvMimeType: true,
  cvUploadedAt: true,
  // Video resume (returned only to the signed-in user themselves — used to
  // auto-fill the candidate profile card)
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
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { email, role, name } = body as { email?: string; role?: string; name?: string }
    const password = typeof body?.password === 'string' ? body.password : ''

    // Validation
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
      return NextResponse.json(
        { error: 'A valid email address is required' },
        { status: 400 }
      )
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { error: "role must be 'CANDIDATE', 'RECRUITER', 'CLIENT' or 'ADMIN'" },
        { status: 400 }
      )
    }

    const normalizedEmail = email.trim().toLowerCase()

    // ---------- Client-partner portal login ----------
    // A client user is matched against the Client registry by contactEmail.
    if (role === 'CLIENT') {
      // NOTE: SQLite has no case-insensitive filter; seed/registry emails are stored lowercase
      const client = await db.client.findFirst({
        where: { contactEmail: normalizedEmail },
      })
      if (!client) {
        return NextResponse.json(
          {
            error:
              'No client partnership found for this email. Ask your SeeWe recruiter to add you as a client first.',
          },
          { status: 404 }
        )
      }

      // find-or-create the portal user, always synced to the Client record
      let user = await db.user.findUnique({ where: { email: normalizedEmail }, select: USER_SELECT })
      if (user?.disabled) {
        return NextResponse.json({ error: ERROR_DISABLED }, { status: 403 })
      }
      if (user) {
        // SECURITY (audit verify-1): client sign-in may never convert a
        // CANDIDATE or ADMIN account. A RECRUITER only syncs into the portal
        // of their OWN company workspace.
        if (user.role === 'CANDIDATE') {
          return NextResponse.json(
            { error: 'This email is registered as a job seeker account — please sign in as a Job Seeker.' },
            { status: 403 }
          )
        }
        if (user.role === 'ADMIN') {
          return NextResponse.json(
            { error: 'This email is reserved for the platform administrator.' },
            { status: 403 }
          )
        }
        if (
          user.role === 'RECRUITER' &&
          user.clientId !== client.id
        ) {
          return NextResponse.json(
            { error: 'This email belongs to a recruiter of a different company workspace.' },
            { status: 403 }
          )
        }
        if (user.role !== 'CLIENT' || user.clientId !== client.id) {
          user = await db.user.update({
            where: { id: user.id },
            data: { role: 'CLIENT', clientId: client.id, company: client.name },
            select: USER_SELECT,
          })
        }
      } else {
        user = await db.user.create({
          data: {
            email: normalizedEmail,
            name: client.name,
            role: 'CLIENT',
            company: client.name,
            clientId: client.id,
            avatarSeed: Math.random().toString(36).slice(2, 12),
          },
          select: USER_SELECT,
        })
      }
      return NextResponse.json({ data: user })
    }

    // ---------- Recruiter sign-in (in-house hiring model) ----------
    // A recruiter is an employee of a client company: the company they sign in
    // with is find-or-created in the Client registry and the account is linked
    // to it (user.clientId). Jobs they post carry that company, and AI reports
    // they share land in that company's own partner portal — a recruiter never
    // sees another company's workspace.
    if (role === 'RECRUITER') {
      const rawCompany = typeof body.company === 'string' ? body.company.trim() : ''

      let user = await db.user.findUnique({
        where: { email: normalizedEmail },
        select: USER_SELECT,
      })
      if (user?.disabled) {
        return NextResponse.json({ error: ERROR_DISABLED }, { status: 403 })
      }
      const companyName = rawCompany || user?.company || ''

      // Recruiters always sign in WITH a company (the UI enforces it) — an
      // empty company would create a meaningless "company" workspace.
      if (!companyName) {
        return NextResponse.json(
          { error: 'Name and company are required to register a new recruiter account' },
          { status: 400 }
        )
      }
      if (!user && (!name || typeof name !== 'string' || !name.trim())) {
        return NextResponse.json(
          { error: 'Name is required to register a new account' },
          { status: 400 }
        )
      }
      if (user?.role === 'ADMIN') {
        return NextResponse.json(
          { error: 'This email is reserved for the platform administrator.' },
          { status: 403 }
        )
      }

      // SECURITY (audit verify-1): role conversion is forbidden. An existing
      // CANDIDATE or CLIENT account can never be flipped to RECRUITER by
      // posting {role:'RECRUITER', company:'X'} — each role must use its own
      // sign-in path (new accounts are still find-or-created on first login).
      if (user?.role === 'CANDIDATE') {
        return NextResponse.json(
          { error: 'This email is registered as a job seeker account — please sign in as a Job Seeker.' },
          { status: 403 }
        )
      }
      if (user?.role === 'CLIENT') {
        return NextResponse.json(
          { error: 'This email is registered as a client partner account — please sign in as a Client.' },
          { status: 403 }
        )
      }
      // Full-auth recruiters (password on record) must present it.
      if (user) {
        const pw = await db.user.findUnique({
          where: { id: user.id },
          select: { password: true },
        })
        if (pw?.password && !verifyPassword(password, pw.password)) {
          registerLoginFail(normalizedEmail)
          return NextResponse.json(
            { error: 'Incorrect email or password. Please try again.' },
            { status: 401 }
          )
        }
      }

      // Find-or-create the Client company (SQLite has no case-insensitive
      // filter, so names are normalised in JS before matching).
      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
      const allClients = await db.client.findMany({
        select: { id: true, name: true },
        take: 500,
      })
      let client = allClients.find((c) => norm(c.name) === norm(companyName))
      if (!client) {
        const slug =
          companyName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
            .slice(0, 28) || 'company'
        client = await db.client.create({
          data: {
            name: companyName,
            contactEmail: `clients@${slug}.demo`,
            notes:
              'Hiring workspace created from recruiter sign-in. Update the contact email so your team can sign in to the partner portal.',
            addedBy: user?.id ?? null,
          },
          select: { id: true, name: true },
        })
      }

      // Keep the account synced to its company workspace
      if (user) {
        if (user.role !== 'RECRUITER' || user.clientId !== client.id || user.company !== companyName) {
          user = await db.user.update({
            where: { id: user.id },
            data: { role: 'RECRUITER', clientId: client.id, company: companyName },
            select: USER_SELECT,
          })
        }
      } else {
        user = await db.user.create({
          data: {
            email: normalizedEmail,
            name: name!.trim(),
            role: 'RECRUITER',
            company: companyName,
            clientId: client.id,
            avatarSeed: Math.random().toString(36).slice(2, 12),
          },
          select: USER_SELECT,
        })
      }
      return NextResponse.json({ data: user })
    }

    // ---------- Platform admin sign-in (demo-lite) ----------
    // A fixed demo admin account backs the admin console. If the email matches
    // the reserved admin address, find-or-create that ADMIN user and return it
    // (a real deployment would gate this behind credentials/SSO).
    if (role === 'ADMIN') {
      const DEMO_ADMIN_EMAIL = 'admin@seewee.ai'
      if (normalizedEmail !== DEMO_ADMIN_EMAIL) {
        return NextResponse.json(
          { error: 'Admin sign-in is restricted to the platform administrator account.' },
          { status: 403 }
        )
      }
      let admin = await db.user.findUnique({
        where: { email: DEMO_ADMIN_EMAIL },
        select: USER_SELECT,
      })
      if (admin?.disabled) {
        return NextResponse.json({ error: ERROR_DISABLED }, { status: 403 })
      }
      if (!admin) {
        admin = await db.user.create({
          data: {
            email: DEMO_ADMIN_EMAIL,
            name: 'SeeWe Admin',
            role: 'ADMIN',
            company: 'SeeWe Technologies',
            headline: 'Platform Administrator',
            avatarSeed: 'seewee-admin',
          },
          select: USER_SELECT,
        })
      }
      return NextResponse.json({ data: admin })
    }

    // ---------- Candidate sign-in (password-based; full-auth accounts) ----------
    // Candidates registered through the real sign-up flow (register API) own a
    // scrypt password and a verified email — they MUST sign in with it. Legacy
    // demo accounts (no password on record) keep the find-or-create path so the
    // seeded demo stays one-click usable.
    const existingCandidate = await db.user.findUnique({
      where: { email: normalizedEmail },
    })
    if (existingCandidate && existingCandidate.role === 'CANDIDATE' && existingCandidate.password) {
      // Disabled accounts never get past the front door — checked BEFORE any
      // password work so the response stays fast and constant-time.
      if (existingCandidate.disabled) {
        return NextResponse.json({ error: ERROR_DISABLED }, { status: 403 })
      }
      // Brute-force guard: consult the lock BEFORE password verification.
      const lock = isLoginLocked(normalizedEmail)
      if (lock.locked) {
        return NextResponse.json(
          { error: `Too many failed attempts — try again in ${lock.minutesLeft} minute${lock.minutesLeft === 1 ? '' : 's'}` },
          { status: 429 }
        )
      }
      const { verifyPassword } = await import('@/lib/auth')
      const supplied = typeof body.password === 'string' ? body.password : ''
      if (!supplied) {
        return NextResponse.json(
          { error: 'Please enter your password to sign in.', code: 'PASSWORD_REQUIRED' },
          { status: 401 }
        )
      }
      if (!verifyPassword(supplied, existingCandidate.password)) {
        registerLoginFail(normalizedEmail)
        return NextResponse.json(
          { error: 'Incorrect email or password.', code: 'BAD_CREDENTIALS' },
          { status: 401 }
        )
      }
      clearLoginFails(normalizedEmail)
      if (!existingCandidate.emailVerified) {
        return NextResponse.json(
          {
            error: 'Your email is not verified yet. Check your inbox for the verification code.',
            code: 'EMAIL_NOT_VERIFIED',
          },
          { status: 403 }
        )
      }
      const signedIn = await db.user.findUnique({
        where: { id: existingCandidate.id },
        select: USER_SELECT,
      })
      return NextResponse.json({ data: signedIn })
    }

    // Demo-lite auth: find-or-create, no passwords
    const existing = await db.user.findUnique({
      where: { email: normalizedEmail },
      select: USER_SELECT,
    })
    if (existing) {
      // Disabled blocks ALL logins for that email (admin can re-enable).
      if (existing.disabled) {
        return NextResponse.json({ error: ERROR_DISABLED }, { status: 403 })
      }
      return NextResponse.json({ data: existing })
    }

    if (role === 'CANDIDATE') {
      // New candidates must complete the real sign-up flow (password + email
      // verification + phone OTP) — silent account creation would bypass it.
      return NextResponse.json(
        {
          error: 'No account found for this email. Please create your account first — it takes a minute.',
          code: 'NO_ACCOUNT',
        },
        { status: 404 }
      )
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Name is required to register a new account' },
        { status: 400 }
      )
    }

    const avatarSeed = Math.random().toString(36).slice(2, 12)
    const user = await db.user.create({
      data: {
        email: normalizedEmail,
        name: name.trim(),
        role,
        avatarSeed,
      },
      select: USER_SELECT,
    })

    return NextResponse.json({ data: user })
  } catch (err) {
    console.error('POST /api/auth/login failed:', err)
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    )
  }
}

// SECURITY (audit verify-1): the anonymous GET ?email= profile lookup was
// removed — it handed any caller a user's phone, headline, location, salary
// and verification flags with zero authentication (recon/enumeration hole),
// and nothing in the UI called it.
