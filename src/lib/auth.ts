// SeeWe - account authentication helpers (candidate full-auth flow).
//
// Passwords are hashed with Node's built-in scrypt (salt embedded in the
// stored string) — no external dependency needed. Verification codes are
// 6-digit numeric one-time challenges stored in AuthChallenge with expiry.
//
// Sandbox delivery note: there is no outbound SMTP/SMS relay here, so codes
// are persisted to EmailLog (auditable outbox) and returned to the requesting
// UI as `devCode` so the demo flow is completable end-to-end. Swapping in a
// real email/SMS provider only means replacing sendAuthEmail() + dropping the
// devCode from responses.

import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import { db } from '@/lib/db'

const CODE_TTL_MINUTES = 15
const MAX_ATTEMPTS = 5

/* ----------------------------- passwords ------------------------------ */

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(plain, salt, 64).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyPassword(plain: string, stored: string | null): boolean {
  if (!stored) return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, hash] = parts
  const candidate = scryptSync(plain, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  if (candidate.length !== expected.length) return false
  return timingSafeEqual(candidate, expected)
}

export function passwordIssues(pw: string): string[] {
  const issues: string[] = []
  if (pw.length < 8) issues.push('at least 8 characters')
  if (!/[A-Za-z]/.test(pw)) issues.push('one letter')
  if (!/[0-9]/.test(pw)) issues.push('one number')
  return issues
}

/* ------------------------- login rate limiting ------------------------- */

// Master spec §4/§36: brute-force guard for password sign-ins.
// 5 consecutive failures for the same email → 15-minute lockout.
// In-memory (resets on server restart) but survives dev hot reloads via a
// globalThis singleton. The login route MUST consult isLoginLocked() BEFORE
// touching password verification so the lock answers in constant time.

const MAX_LOGIN_FAILS = 5
const LOGIN_LOCK_MS = 15 * 60 * 1000

interface LoginFailEntry {
  fails: number
  lockedUntil: number
}

const loginFailStore = (() => {
  const g = globalThis as typeof globalThis & {
    __seeweeLoginFails?: Map<string, LoginFailEntry>
  }
  if (!g.__seeweeLoginFails) g.__seeweeLoginFails = new Map()
  return g.__seeweeLoginFails
})()

export interface LoginLockStatus {
  locked: boolean
  minutesLeft: number
}

export function isLoginLocked(email: string): LoginLockStatus {
  const entry = loginFailStore.get(email.trim().toLowerCase())
  if (!entry) return { locked: false, minutesLeft: 0 }
  if (entry.lockedUntil > Date.now()) {
    return {
      locked: true,
      minutesLeft: Math.max(1, Math.ceil((entry.lockedUntil - Date.now()) / 60_000)),
    }
  }
  return { locked: false, minutesLeft: 0 }
}

/** Record a failed password attempt; arms the lockout on the 5th consecutive failure. */
export function registerLoginFail(email: string): void {
  const key = email.trim().toLowerCase()
  const entry = loginFailStore.get(key) ?? { fails: 0, lockedUntil: 0 }
  if (entry.lockedUntil > Date.now()) return // already locked — lockout window simply runs out
  entry.fails += 1
  if (entry.fails >= MAX_LOGIN_FAILS) {
    entry.fails = 0
    entry.lockedUntil = Date.now() + LOGIN_LOCK_MS
  }
  loginFailStore.set(key, entry)
}

/** Clear the failure counter after a successful sign-in. */
export function clearLoginFails(email: string): void {
  loginFailStore.delete(email.trim().toLowerCase())
}

/* --------------------------- challenge codes -------------------------- */

export type ChallengeKind = 'EMAIL_VERIFY' | 'PHONE_OTP' | 'PASSWORD_RESET'

export function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/** Create (invalidating previous unconsumed ones) + persist a fresh code. */
export async function createChallenge(
  userId: string,
  kind: ChallengeKind,
  target: string
): Promise<string> {
  // Invalidate any outstanding codes of the same kind for this user
  await db.authChallenge.updateMany({
    where: { userId, kind, consumedAt: null },
    data: { consumedAt: new Date() },
  })
  const code = generateCode()
  await db.authChallenge.create({
    data: {
      userId,
      kind,
      target,
      code,
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
    },
  })
  return code
}

export interface ChallengeCheck {
  ok: boolean
  error?: string
  challengeId?: string
}

/** Validate a submitted code: expiry, single-use, brute-force attempts. */
export async function checkChallenge(
  userId: string,
  kind: ChallengeKind,
  code: string
): Promise<ChallengeCheck> {
  const challenge = await db.authChallenge.findFirst({
    where: { userId, kind, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  })
  if (!challenge) return { ok: false, error: 'No active code. Please request a new one.' }
  if (challenge.expiresAt.getTime() < Date.now()) {
    return { ok: false, error: 'This code has expired. Please request a new one.' }
  }
  if (challenge.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: 'Too many wrong attempts. Please request a new code.' }
  }
  if (challenge.code !== code.trim()) {
    await db.authChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false, error: 'Incorrect code. Please try again.' }
  }
  await db.authChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: new Date() },
  })
  return { ok: true, challengeId: challenge.id }
}

/* ------------------------- simulated delivery ------------------------- */

/** Send real email via Resend API if RESEND_API_KEY is configured, and record in EmailLog. */
export async function sendAuthEmail(opts: {
  to: string
  toUserId?: string | null
  subject: string
  body: string
  kind: string
}): Promise<void> {
  // 1. Dispatch real live email to candidate inbox if RESEND_API_KEY is configured
  if (process.env.RESEND_API_KEY) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'SeeWe <onboarding@resend.dev>',
          to: [opts.to],
          subject: opts.subject,
          text: opts.body,
        }),
      })
      if (!res.ok) {
        console.warn('[auth] Resend email dispatch failed:', await res.text())
      } else {
        console.log(`[auth] Real email successfully delivered to ${opts.to}`)
      }
    } catch (sendErr) {
      console.error('[auth] Failed to send real email via Resend:', sendErr)
    }
  }

  // 2. Persist to EmailLog outbox table for audit
  try {
    await db.emailLog.create({
      data: {
        toEmail: opts.to,
        toUserId: opts.toUserId ?? null,
        kind: opts.kind,
        subject: opts.subject.slice(0, 200),
        body: opts.body.slice(0, 4000),
        status: 'SENT',
        meta: JSON.stringify({ auth: true }),
      },
    })
    console.log(`[email:auth-outbox] to=${opts.to} subject="${opts.subject}"`)
  } catch (err) {
    console.error('[auth] Failed to record auth email (non-fatal):', err)
  }
}

export function emailVerifyEmail(name: string, code: string) {
  return {
    subject: `Verify your email — code ${code}`,
    body: [
      `Hi ${name},`,
      ``,
      `Welcome! Your email verification code is: ${code}`,
      ``,
      `Enter this code in the sign-up screen to verify your email. It expires in ${CODE_TTL_MINUTES} minutes.`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}

export function phoneOtpEmail(name: string, phone: string, code: string) {
  return {
    subject: `Verify your mobile number — OTP ${code}`,
    body: [
      `Hi ${name},`,
      ``,
      `Your mobile verification OTP for ${phone} is: ${code}`,
      ``,
      `Enter this OTP to confirm your number. It expires in ${CODE_TTL_MINUTES} minutes.`,
      `(In this sandbox the OTP is delivered by email outbox — a live deployment sends it by SMS.)`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}

export function passwordResetEmail(name: string, code: string) {
  return {
    subject: `Reset your password — code ${code}`,
    body: [
      `Hi ${name},`,
      ``,
      `Your password reset code is: ${code}`,
      ``,
      `Enter this code with your new password. It expires in ${CODE_TTL_MINUTES} minutes.`,
      `If you didn't request this, you can safely ignore this email.`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}

/** Normalise + validate a mobile number (10-digit Indian mobile for this demo). */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  const local = digits.length > 10 && digits.startsWith('91') ? digits.slice(-10) : digits
  if (local.length !== 10 || !/^[6-9]/.test(local)) return null
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`
}
