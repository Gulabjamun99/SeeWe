'use client'

/**
 * AuthDialog — SeeWe sign-in / sign-up.
 *
 * CANDIDATE accounts use a real authentication chain (structured, multi-step):
 *   1. Sign up — name, email, password, mobile number
 *   2. Email verification — 6-digit code
 *   3. Mobile OTP confirmation — 6-digit code
 *   → only then can the candidate sign in with email + password.
 * Forgot-password resets the password via an emailed reset code.
 *
 * Sandbox note: there is no SMTP/SMS relay here, so codes are recorded in the
 * email outbox (Email updates mailbox) AND surfaced in the UI as a demo hint
 * (devCode) so the flow is completable end-to-end.
 *
 * RECRUITER / CLIENT / ADMIN keep the one-click demo-lite sign-in.
 */

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { LegalDialog, type LegalPage } from '@/components/seewee/LegalDialog'
import { useAppStore, type View } from '@/store/app-store'
import type { Role } from '@/lib/types'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Bot,
  Building2,
  Handshake,
  KeyRound,
  Loader2,
  MailCheck,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UserRound,
} from 'lucide-react'

const PUBLIC_DEMO_ACCOUNTS: {
  email: string
  name: string
  role: Role
  hint: string
}[] = [
  { email: 'ananya@technova.com', name: 'Ananya Sharma', role: 'RECRUITER', hint: 'Recruiter · TechNova' },
  { email: 'arjun.mehta@gmail.com', name: 'Arjun Mehta', role: 'CANDIDATE', hint: 'Candidate · React Dev' },
  { email: 'partnerships@flipkart-demo.com', name: 'Flipkart Internet Pvt Ltd', role: 'CLIENT', hint: 'Client · Flipkart' },
]

const ADMIN_DEMO_ACCOUNT = {
  email: 'admin@seewee.ai',
  name: 'SeeWe Admin',
  role: 'ADMIN' as Role,
  hint: 'Admin · Platform console',
}

type Mode = 'signin' | 'signup' | 'verify-email' | 'verify-phone' | 'forgot' | 'reset'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function AuthDialog() {
  const open = useAppStore((s) => s.authOpen)
  const setOpen = useAppStore((s) => s.setAuthOpen)
  const login = useAppStore((s) => s.login)
  const setUser = useAppStore((s) => s.setUser)

  const [mode, setMode] = useState<Mode>('signin')
  const [role, setRole] = useState<Role>('CANDIDATE')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const [agreeTos, setAgreeTos] = useState(false)
  const [legalPage, setLegalPage] = useState<LegalPage | null>(null)
  const [googleModalOpen, setGoogleModalOpen] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleInputEmail, setGoogleInputEmail] = useState('')
  const codeRef = useRef<HTMLInputElement>(null)

  // resend cooldown ticker
  useEffect(() => {
    if (resendIn <= 0) return
    const t = setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [resendIn])

  // focus the code box when a verification step opens
  useEffect(() => {
    if ((mode === 'verify-email' || mode === 'verify-phone' || mode === 'reset') && codeRef.current) {
      codeRef.current.focus()
    }
  }, [mode])

  // Dedicated Platform Admin Console trigger (opened via discrete Staff Console in footer)
  useEffect(() => {
    const handleAdminOpen = () => {
      setRole('ADMIN')
      setMode('signin')
      setEmail('admin@seewee.ai')
      setOpen(true)
    }
    window.addEventListener('seewee:open-admin-auth', handleAdminOpen)
    return () => window.removeEventListener('seewee:open-admin-auth', handleAdminOpen)
  }, [setOpen])

  function resetFields(keepEmail = false) {
    if (!keepEmail) setEmail('')
    setName('')
    setCompany('')
    setPassword('')
    setConfirm('')
    setPhone('')
    setCode('')
    setDevCode(null)
    setAgreeTos(false)
  }

  function applyTargetView(userRole: string) {
    const target: View =
      userRole === 'RECRUITER'
        ? 'recruiter'
        : userRole === 'CLIENT'
          ? 'client'
          : userRole === 'ADMIN'
            ? 'admin'
            : 'candidate'
    useAppStore.getState().setView(target)
  }

  /* ------------------------- candidate sign-in ------------------------- */

  async function handleCandidateSignIn() {
    if (!EMAIL_RE.test(email.trim())) {
      toast.error('Please enter a valid email address')
      return
    }
    // NOTE: empty password is allowed through — legacy demo accounts have no
    // password (one-click demo logins), and the API answers PASSWORD_REQUIRED
    // for real accounts so the user gets an accurate message below.
    setLoading(true)
    try {
      const user = await login(email.trim(), 'CANDIDATE', undefined, undefined, password)
      toast.success(`Welcome back, ${user.name}! 👋`)
      finish()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign in failed'
      if (msg.toLowerCase().includes('password')) {
        toast.error(msg)
        setPassword('')
        document.getElementById('auth-password')?.focus()
      } else if (msg.includes('No account found')) {
        toast.error(msg)
        setMode('signup')
      } else if (msg.includes('not verified')) {
        toast.error(msg)
        setMode('verify-email')
        void resendCode('EMAIL_VERIFY', true)
      } else {
        toast.error(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  /* ----------------------- other roles (demo-lite) --------------------- */

  async function handleDemoRoleSignIn() {
    if (!email.trim() || !email.includes('@')) {
      toast.error('Please enter a valid email address')
      return
    }
    if (role !== 'CLIENT' && role !== 'ADMIN' && !name.trim()) {
      toast.error('Please enter your name')
      return
    }
    if (role === 'RECRUITER' && !company.trim()) {
      toast.error('Please enter your company name')
      return
    }
    setLoading(true)
    try {
      const user = await login(email.trim(), role, name.trim(), company.trim())
      toast.success(`Welcome to SeeWe, ${user.name}! 👋`)
      finish()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  function finish() {
    setOpen(false)
    setMode('signin')
    resetFields()
  }

  /* -------------------------- candidate sign-up ------------------------ */

  async function handleSignUp() {
    if (!name.trim()) return toast.error('Please enter your full name')
    if (!EMAIL_RE.test(email.trim())) return toast.error('Please enter a valid email address')
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return toast.error('Password needs at least 8 characters with a letter and a number')
    }
    if (password !== confirm) return toast.error('Passwords do not match')
    const digits = phone.replace(/\D/g, '')
    const local = digits.length > 10 && digits.startsWith('91') ? digits.slice(-10) : digits
    if (local.length !== 10) return toast.error('Enter a valid 10-digit mobile number')
    if (!agreeTos) return toast.error('Please accept the Terms of Service to continue')

    setLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password, phone, acceptedTos: true }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Sign up failed')
      setDevCode(json.data?.devCode ?? null)
      setResendIn(30)
      setMode('verify-email')
      toast.success('Account created! Check your email for the verification code.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  /* --------------------------- verification ---------------------------- */

  async function resendCode(kind: 'EMAIL_VERIFY' | 'PHONE_OTP', silent = false) {
    try {
      const res = await fetch('/api/auth/otp/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), kind }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (!silent) toast.error(json.error || 'Could not resend code')
        return
      }
      setDevCode(json.data?.devCode ?? null)
      setResendIn(30)
      if (!silent) toast.success('New code sent ✉️')
    } catch {
      if (!silent) toast.error('Could not resend code')
    }
  }

  async function handleVerifyEmail() {
    if (code.trim().length !== 6) return toast.error('Enter the 6-digit code')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Verification failed')
      setCode('')
      if (json.data?.devCode) setDevCode(json.data.devCode)
      else setDevCode(null)
      setResendIn(30)
      setMode('verify-phone')
      toast.success('Email verified ✅ — now confirm your mobile number')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyPhone() {
    if (code.trim().length !== 6) return toast.error('Enter the 6-digit OTP')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/verify-phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Verification failed')
      setUser(json.data)
      toast.success('Mobile verified 🎉 Your account is ready!')
      applyTargetView(json.data?.role ?? 'CANDIDATE')
      finish()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  /* -------------------------- forgot / reset --------------------------- */

  async function handleForgot() {
    if (!EMAIL_RE.test(email.trim())) return toast.error('Please enter a valid email address')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not send reset code')
      setDevCode(json.data?.devCode ?? null)
      setResendIn(30)
      setCode('')
      setMode('reset')
      toast.success('Reset code sent — check your email')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send reset code')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset() {
    if (code.trim().length !== 6) return toast.error('Enter the 6-digit reset code')
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return toast.error('Password needs at least 8 characters with a letter and a number')
    }
    if (password !== confirm) return toast.error('Passwords do not match')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), code: code.trim(), password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Reset failed')
      toast.success('Password updated — sign in with your new password 🔐')
      setMode('signin')
      setPassword('')
      setConfirm('')
      setCode('')
      setDevCode(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleQuickDemoLogin(acc: { email: string; name: string; role: Role }) {
    setRole(acc.role)
    setEmail(acc.email)
    setName(acc.name)
    const comp = acc.role === 'RECRUITER' ? 'TechNova Solutions' : ''
    setCompany(comp)
    setPassword('')
    setLoading(true)
    try {
      const user = await login(acc.email, acc.role, acc.name, comp || undefined, '')
      toast.success(`Welcome back, ${user.name}! 👋`)
      finish()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sign in failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleGoogleAuthSubmit(selectedEmail: string, selectedName?: string) {
    if (!EMAIL_RE.test(selectedEmail.trim())) {
      toast.error('Please enter a valid Google email address')
      return
    }
    setGoogleLoading(true)
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: selectedEmail.trim(),
          name: selectedName || selectedEmail.split('@')[0],
          role: role === 'ADMIN' ? 'CANDIDATE' : role,
          company: role === 'RECRUITER' ? (company || 'TechNova Solutions') : undefined,
        }),
      })
      const text = await res.text()
      const json = text ? JSON.parse(text) : {}
      if (!res.ok || json.error) throw new Error(json.error || 'Google sign-in failed')

      const userData = json.data as User
      setUser(userData)
      applyTargetView(userData.role)
      toast.success(`Signed in with Google! Welcome, ${userData.name} 👋`)
      setGoogleModalOpen(false)
      finish()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Google sign-in failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  /* ------------------------------- render ------------------------------ */

  const isCandidateFlow = role === 'CANDIDATE'
  const busy = loading

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md rounded-2xl">
        {mode === 'signin' && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 flex items-center justify-center">
                <Image
                  src="/seewee-logo.png"
                  alt="SeeWe logo"
                  width={200}
                  height={110}
                  className="h-12 w-auto rounded-xl shadow-md ring-1 ring-slate-900/10"
                />
              </div>
              <DialogTitle className="text-center text-xl font-bold">Sign in to SeeWe</DialogTitle>
              <DialogDescription className="text-center">
                One account. Three worlds — hire, get hired, or review hires.
              </DialogDescription>
            </DialogHeader>

            <RoleSwitch
              role={role}
              setRole={(r) => {
                setRole(r)
                setDevCode(null)
                if (r === 'ADMIN') setEmail((prev) => prev.trim() || 'admin@seewee.ai')
              }}
            />

            {role !== 'ADMIN' && (
              <div className="mt-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setGoogleModalOpen(true)}
                  disabled={busy || googleLoading}
                  className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white px-4 font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <GoogleIcon className="h-4 w-4" />
                  <span>Continue with Google</span>
                </button>
                <div className="relative flex items-center justify-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                  <span className="relative bg-white px-2.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:bg-slate-900">
                    or continue with email
                  </span>
                </div>
              </div>
            )}

            {isCandidateFlow ? (
              <div className="space-y-4">
                <Field label="Email">
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleCandidateSignIn()}
                  />
                </Field>
                <Field label="Password">
                  <Input
                    id="auth-password"
                    type="password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleCandidateSignIn()}
                  />
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                    New accounts sign in with the password you created. Demo accounts can leave
                    this empty.
                  </p>
                </Field>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot')
                      setPassword('')
                      setDevCode(null)
                    }}
                    className="text-xs font-semibold text-blue-600 hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <Button
                  onClick={() => void handleCandidateSignIn()}
                  disabled={busy}
                  aria-label="Sign in"
                  className="h-11 w-full bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md transition-all hover:from-blue-700 hover:to-sky-700 hover:shadow-lg"
                >
                  {busy ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…
                    </>
                  ) : (
                    <>
                      <UserRound className="mr-2 h-4 w-4" /> Sign in as Job Seeker ✨
                    </>
                  )}
                </Button>
                <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                  New here?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('signup')
                      setPassword('')
                      setConfirm('')
                    }}
                    className="font-semibold text-blue-600 hover:underline"
                  >
                    Create your account
                  </button>
                </p>
              </div>
            ) : (
              <DemoRoleFields
                role={role}
                name={name}
                setName={setName}
                email={email}
                setEmail={setEmail}
                company={company}
                setCompany={setCompany}
                loading={busy}
                onSubmit={() => void handleDemoRoleSignIn()}
              />
            )}

            <DemoAccounts role={role} onPick={handleQuickDemoLogin} />
          </>
        )}

        {mode === 'signup' && (
          <>
            <StepHeader
              onBack={() => setMode('signin')}
              icon={<UserRound className="h-5 w-5 text-blue-600" />}
              title="Create your job seeker account"
              desc="Free forever — your profile, CV and AI interview prep in one place."
            />
            <div className="mb-4 space-y-3">
              <button
                type="button"
                onClick={() => setGoogleModalOpen(true)}
                disabled={busy || googleLoading}
                className="flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-slate-300 bg-white px-4 font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:border-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <GoogleIcon className="h-4 w-4" />
                <span>1-Click Sign up with Google</span>
              </button>
              <div className="relative flex items-center justify-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-800" />
                <span className="relative bg-white px-2.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:bg-slate-900">
                  or register with email
                </span>
              </div>
            </div>
            <div className="space-y-4">
              <Field label="Full name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Aarav Sharma" />
              </Field>
              <Field label="Email">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </Field>
              <Field label="Create password">
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="8+ characters, 1 letter + 1 number"
                />
              </Field>
              <Field label="Confirm password">
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleSignUp()}
                  placeholder="Repeat your password"
                />
              </Field>
              <Field label="Mobile number (for OTP verification)">
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300">+91</span>
                  <Input
                    inputMode="numeric"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="98765 43210"
                  />
                </div>
              </Field>

              {/* ToS + Privacy consent (master spec §37) — required before signup */}
              <div className="space-y-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 p-3">
                <label
                  htmlFor="signup-tos-checkbox"
                  className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug text-slate-600 dark:text-slate-300"
                >
                  <Checkbox
                    id="signup-tos-checkbox"
                    checked={agreeTos}
                    onCheckedChange={(v) => setAgreeTos(v === true)}
                    className="mt-0.5"
                    aria-label="I agree to the Terms of Service and Privacy Policy"
                  />
                  <span>
                    I agree to the{' '}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        setLegalPage('terms')
                      }}
                      className="font-semibold text-blue-600 underline-offset-2 hover:underline"
                    >
                      Terms of Service
                    </button>{' '}
                    and{' '}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        setLegalPage('privacy')
                      }}
                      className="font-semibold text-blue-600 underline-offset-2 hover:underline"
                    >
                      Privacy Policy
                    </button>
                    , including AI-assisted interview processing.
                  </span>
                </label>
                {!agreeTos && (
                  <p className="pl-7 text-xs text-amber-600 dark:text-amber-400">
                    You&apos;ll need to accept the terms before creating an account.
                  </p>
                )}
              </div>

              <Button
                onClick={() => void handleSignUp()}
                disabled={busy || !agreeTos}
                className="h-11 w-full bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md hover:from-blue-700 hover:to-sky-700"
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
                {busy ? 'Creating account…' : 'Create account → verify email'}
              </Button>
              <p className="text-center text-xs text-slate-400">
                Next: verify your email with a 6-digit code, then confirm your mobile via OTP.
              </p>
            </div>
          </>
        )}

        {(mode === 'verify-email' || mode === 'verify-phone') && (
          <>
            <StepHeader
              onBack={() => setMode('signin')}
              icon={mode === 'verify-email' ? <MailCheck className="h-5 w-5 text-emerald-600" /> : <Smartphone className="h-5 w-5 text-violet-600" />}
              title={mode === 'verify-email' ? 'Verify your email' : 'Confirm your mobile number'}
              desc={
                mode === 'verify-email'
                  ? `We sent a 6-digit code to ${email || 'your email'}. Enter it below to continue.`
                  : `We sent an OTP to ${phone || 'your mobile'}. Enter the 6-digit code to finish.`
              }
            />
            <DevCodeHint devCode={devCode} onFill={setCode} />
            <div className="space-y-4">
              <Field label={mode === 'verify-email' ? '6-digit verification code' : '6-digit OTP'}>
                <Input
                  ref={codeRef}
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  onKeyDown={(e) =>
                    e.key === 'Enter' && void (mode === 'verify-email' ? handleVerifyEmail() : handleVerifyPhone())
                  }
                  placeholder="••••••"
                  className="text-center text-2xl font-bold tracking-[0.5em]"
                />
              </Field>
              <Button
                onClick={() => void (mode === 'verify-email' ? handleVerifyEmail() : handleVerifyPhone())}
                disabled={busy || code.length !== 6}
                className="h-11 w-full bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md hover:from-blue-700 hover:to-sky-700"
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                {mode === 'verify-email' ? 'Verify email →' : 'Verify & enter SeeWe 🎉'}
              </Button>
              <ResendRow
                cooldown={resendIn}
                onResend={() => void resendCode(mode === 'verify-email' ? 'EMAIL_VERIFY' : 'PHONE_OTP')}
              />
            </div>
          </>
        )}

        {mode === 'forgot' && (
          <>
            <StepHeader
              onBack={() => setMode('signin')}
              icon={<KeyRound className="h-5 w-5 text-amber-500" />}
              title="Forgot password?"
              desc="Enter your registered email — we'll send a 6-digit reset code."
            />
            <DevCodeHint devCode={devCode} onFill={setCode} />
            <div className="space-y-4">
              <Field label="Email">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleForgot()}
                  placeholder="you@example.com"
                />
              </Field>
              <Button
                onClick={() => void handleForgot()}
                disabled={busy}
                className="h-11 w-full bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md hover:from-blue-700 hover:to-sky-700"
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <MailCheck className="mr-2 h-4 w-4" />}
                Send reset code
              </Button>
            </div>
          </>
        )}

        {mode === 'reset' && (
          <>
            <StepHeader
              onBack={() => setMode('signin')}
              icon={<KeyRound className="h-5 w-5 text-amber-500" />}
              title="Set a new password"
              desc={`Enter the reset code sent to ${email || 'your email'} and choose a new password.`}
            />
            <DevCodeHint devCode={devCode} onFill={setCode} />
            <div className="space-y-4">
              <Field label="6-digit reset code">
                <Input
                  ref={codeRef}
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••••"
                  className="text-center text-2xl font-bold tracking-[0.5em]"
                />
              </Field>
              <Field label="New password">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ characters, 1 letter + 1 number" />
              </Field>
              <Field label="Confirm new password">
                <Input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleReset()}
                  placeholder="Repeat your new password"
                />
              </Field>
              <Button
                onClick={() => void handleReset()}
                disabled={busy || code.length !== 6}
                className="h-11 w-full bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md hover:from-blue-700 hover:to-sky-700"
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Update password
              </Button>
            </div>
          </>
        )}
      </DialogContent>

      {/* Legal/info dialog (About · Privacy · Terms · Contact) — own instance so
          links inside the sign-up flow never fight the host page's dialog. */}
      <LegalDialog
        page={legalPage}
        onOpenChange={(open) => !open && setLegalPage(null)}
        onPageChange={setLegalPage}
      />

      {/* Google 1-Click Sign-In Dialog */}
      <Dialog open={googleModalOpen} onOpenChange={setGoogleModalOpen}>
        <DialogContent className="sm:max-w-sm rounded-2xl p-6">
          <div className="flex flex-col items-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 shadow-sm">
              <GoogleIcon className="h-6 w-6" />
            </div>
            <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">Sign in with Google</DialogTitle>
            <DialogDescription className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Choose an account to continue to <span className="font-semibold text-blue-600 dark:text-blue-400">SeeWe</span>
            </DialogDescription>
          </div>

          <div className="mt-4 space-y-3">
            {/* Quick 1-click Google account */}
            <button
              type="button"
              disabled={googleLoading}
              onClick={() => void handleGoogleAuthSubmit('aarav.sharma@gmail.com', 'Aarav Sharma')}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                A
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100">Aarav Sharma</p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">aarav.sharma@gmail.com</p>
              </div>
              <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full dark:bg-blue-950/60 dark:text-blue-300">
                1-Click
              </span>
            </button>

            <div className="relative my-2 flex items-center justify-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-800" />
              <span className="relative bg-white dark:bg-slate-900 px-2 text-[10px] uppercase text-slate-400">
                or enter your Gmail
              </span>
            </div>

            <div className="space-y-2">
              <Input
                type="email"
                placeholder="yourname@gmail.com"
                value={googleInputEmail}
                onChange={(e) => setGoogleInputEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void handleGoogleAuthSubmit(googleInputEmail)}
              />
              <Button
                onClick={() => void handleGoogleAuthSubmit(googleInputEmail)}
                disabled={googleLoading || !googleInputEmail.trim()}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white h-10 shadow-sm"
              >
                {googleLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <GoogleIcon className="mr-2 h-4 w-4" />}
                Continue with Google
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

/* ---------------------------- shared pieces ---------------------------- */

function RoleSwitch({ role, setRole }: { role: Role; setRole: (r: Role) => void }) {
  if (role === 'ADMIN') {
    return (
      <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-white shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold">
          <ShieldCheck className="h-4 w-4 text-sky-400" />
          <span>Platform Administrator Console</span>
        </div>
        <button
          type="button"
          onClick={() => setRole('CANDIDATE')}
          className="text-[11px] text-slate-400 hover:text-white underline underline-offset-2"
        >
          Back to Public Login
        </button>
      </div>
    )
  }

  return (
    <div role="radiogroup" aria-label="Account type" className="grid grid-cols-3 gap-2">
      {(
        [
          { value: 'CANDIDATE', label: 'Job Seeker', icon: UserRound },
          { value: 'RECRUITER', label: 'Recruiter', icon: Building2 },
          { value: 'CLIENT', label: 'Client Partner', icon: Handshake },
        ] as const
      ).map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={role === value}
          onClick={() => setRole(value)}
          className={`flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border-2 p-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            role === value
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 shadow-sm'
              : 'border-slate-200 bg-white dark:bg-slate-900 hover:border-slate-300 hover:bg-slate-50'
          }`}
        >
          <Icon className={`h-5 w-5 ${role === value ? 'text-blue-600' : 'text-slate-400 dark:text-slate-500'}`} />
          <span className={`text-xs font-semibold sm:text-sm ${role === value ? 'text-blue-800' : 'text-slate-500 dark:text-slate-400'}`}>
            {label}
          </span>
        </button>
      ))}
    </div>
  )
}

function DemoRoleFields({
  role,
  name,
  setName,
  email,
  setEmail,
  company,
  setCompany,
  loading,
  onSubmit,
}: {
  role: Role
  name: string
  setName: (v: string) => void
  email: string
  setEmail: (v: string) => void
  company: string
  setCompany: (v: string) => void
  loading: boolean
  onSubmit: () => void
}) {
  return (
    <div className="space-y-4">
      {role === 'RECRUITER' && (
        <Field label="Company name *">
          <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="e.g. TechNova Solutions" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Sign in as a recruiter / hiring manager under this client company workspace.
          </p>
        </Field>
      )}
      {role !== 'CLIENT' && role !== 'ADMIN' && (
        <Field label="Full name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ananya Sharma" />
        </Field>
      )}
      {role === 'CLIENT' && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Client organization portal — review AI shortlisted candidates, approve hiring decisions, and manage company requisitions.
        </p>
      )}
      {role === 'ADMIN' && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Platform administrator console — sign in with your reserved administrative credentials.
        </p>
      )}
      <Field label="Email">
        <Input
          type="email"
          placeholder={role === 'CLIENT' ? 'partnerships@yourcompany.com' : role === 'ADMIN' ? 'admin@seewee.ai' : 'you@company.com'}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void onSubmit()}
        />
      </Field>
      <Button
        onClick={() => void onSubmit()}
        disabled={loading}
        className="h-11 w-full bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md hover:from-blue-700 hover:to-sky-700"
      >
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <>
            Continue as{' '}
            {role === 'RECRUITER' ? 'Recruiter 🚀' : role === 'CLIENT' ? 'Client Partner 🤝' : 'Platform Admin 🛡️'}
          </>
        )}
      </Button>
    </div>
  )
}

function DemoAccounts({
  role,
  onPick,
}: {
  role: Role
  onPick: (acc: { email: string; name: string; role: Role }) => void
}) {
  if (role === 'ADMIN') {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/60 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <ShieldCheck className="h-3.5 w-3.5 text-sky-400" /> Platform Admin credential:
        </p>
        <button
          type="button"
          onClick={() => onPick(ADMIN_DEMO_ACCOUNT)}
          className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:border-sky-400 hover:bg-slate-700"
        >
          <ShieldCheck className="h-3 w-3 text-sky-400" />
          {ADMIN_DEMO_ACCOUNT.hint}
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/60 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
        <Sparkles className="h-3.5 w-3.5 text-amber-500" /> Demo accounts — one click:
      </p>
      <div className="flex flex-wrap gap-2">
        {PUBLIC_DEMO_ACCOUNTS.map((acc) => (
          <button
            key={acc.email}
            type="button"
            onClick={() => onPick(acc)}
            className="flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700"
          >
            {acc.role === 'RECRUITER' ? (
              <Building2 className="h-3 w-3" />
            ) : acc.role === 'CLIENT' ? (
              <Handshake className="h-3 w-3" />
            ) : (
              <Bot className="h-3 w-3" />
            )}
            {acc.hint}
          </button>
        ))}
      </div>
    </div>
  )
}

function StepHeader({
  onBack,
  icon,
  title,
  desc,
}: {
  onBack: () => void
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <DialogHeader>
      <button
        type="button"
        onClick={onBack}
        className="mr-auto flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600"
        aria-label="Back to sign in"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back
      </button>
      <div className="mx-auto mt-1 flex h-12 w-12 items-center justify-center rounded-full bg-slate-50 ring-1 ring-slate-200">
        {icon}
      </div>
      <DialogTitle className="text-center text-xl font-bold">{title}</DialogTitle>
      <DialogDescription className="text-center">{desc}</DialogDescription>
    </DialogHeader>
  )
}

/** Sandbox helper — no SMTP/SMS here, so the demo shows the code that was
 * "emailed" (also visible in Email updates once signed in). */
function DevCodeHint({ devCode, onFill }: { devCode: string | null; onFill?: (code: string) => void }) {
  if (!devCode) return null
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/80 px-3.5 py-2.5 text-center dark:border-blue-900/60 dark:bg-blue-950/40">
      <p className="text-xs font-medium text-blue-900 dark:text-blue-200 flex flex-wrap items-center justify-center gap-1.5">
        <span>✉️ Verification code sent to your inbox:</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(devCode).catch(() => {})
            if (onFill) onFill(devCode)
            toast.success('Code filled!')
          }}
          className="rounded bg-white px-2.5 py-0.5 font-mono text-sm font-bold tracking-widest text-blue-700 shadow-sm ring-1 ring-blue-300 hover:bg-blue-50 dark:bg-slate-800 dark:text-blue-300 dark:ring-blue-700 transition-colors"
          title="Click to auto-fill"
        >
          {devCode} <span className="text-[10px] font-normal text-blue-500 underline ml-1">Click to fill</span>
        </button>
      </p>
    </div>
  )
}

function ResendRow({ cooldown, onResend }: { cooldown: number; onResend: () => void }) {
  return (
    <p className="text-center text-sm text-slate-500 dark:text-slate-400">
      Didn&apos;t get it?{' '}
      {cooldown > 0 ? (
        <span className="font-semibold text-slate-400">Resend in {cooldown}s</span>
      ) : (
        <button type="button" onClick={onResend} className="font-semibold text-blue-600 hover:underline">
          Resend code
        </button>
      )}
    </p>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</Label>
      {children}
    </div>
  )
}

function GoogleIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="18" height="18">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  )
}
