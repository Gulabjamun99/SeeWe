'use client'

/**
 * TokenInterviewGate — full-screen boot flow for employer AI interview deep
 * links: /?interview=<token>.
 *
 * Sequence: validate the token (GET /api/interview/by-token) → clean error
 * cards for unknown (404) / expired (410) links → SystemCheck (mic + camera
 * permission test) → InterviewRoom in token mode (no logged-in session; the
 * room authenticates every call with the deep-link token).
 *
 * PRIVACY: everything here is candidate-side. The by-token/start/answer
 * payloads carry zero AI evaluation data by server contract.
 *
 * StrictMode: the validation fetch is ref-guarded so the double effect pass
 * fires exactly one request.
 */

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, CheckCircle2, Eye, LinkIcon, Loader2, Timer } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { InterviewRoom, type TokenRoomMeta } from './InterviewRoom'
import { SystemCheck } from './SystemCheck'

type GatePhase = 'validating' | 'invalid' | 'expired' | 'check' | 'room' | 'closed'

interface TokenValidation {
  jobTitle: string
  company: string
  location?: string
  candidateName: string
  expiresAt: string | null
}

export function TokenInterviewGate({ token }: { token: string }) {
  const [phase, setPhase] = useState<GatePhase>('validating')
  const [meta, setMeta] = useState<TokenValidation | null>(null)
  const [errorText, setErrorText] = useState<string>('')
  /** StrictMode guard — one validation request per mount lifecycle */
  const validatedRef = useRef(false)

  useEffect(() => {
    if (validatedRef.current) return
    validatedRef.current = true
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/interview/by-token?token=${encodeURIComponent(token)}`)
        const json: {
          data?: {
            valid: boolean
            expired?: boolean
            jobTitle: string
            company: string
            location?: string
            candidateName: string
            expiresAt: string | null
          }
          error?: string
        } = await res.json()
        if (cancelled) return
        if (res.status === 410 || json.data?.expired) {
          setErrorText(
            json.error || 'This interview link has expired — contact your recruiter to get a fresh invite.'
          )
          setPhase('expired')
          return
        }
        if (!res.ok || !json.data?.valid) {
          setErrorText(json.error || 'Interview link not recognised')
          setPhase('invalid')
          return
        }
        setMeta({
          jobTitle: json.data.jobTitle,
          company: json.data.company,
          location: json.data.location,
          candidateName: json.data.candidateName,
          expiresAt: json.data.expiresAt,
        })
        setPhase('check')
      } catch {
        if (!cancelled) {
          setErrorText('We could not verify this interview link — check your connection and reload.')
          setPhase('invalid')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  /* ------------------------------ validating ------------------------------ */
  if (phase === 'validating') {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-b from-blue-50/60 via-white to-sky-50/40 px-4 dark:from-blue-950/30 dark:via-background dark:to-sky-950/20">
        <div className="w-full max-w-md space-y-5 text-center">
          <Loader2 className="mx-auto size-8 animate-spin text-blue-600" aria-hidden />
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
            Verifying your interview link…
          </p>
          <div className="space-y-2.5 pt-2">
            <Skeleton className="mx-auto h-5 w-2/3 rounded-full" />
            <Skeleton className="mx-auto h-5 w-1/2 rounded-full" />
            <Skeleton className="h-28 w-full rounded-2xl" />
          </div>
        </div>
      </div>
    )
  }

  /* ---------------------------- invalid / expired ---------------------------- */
  if (phase === 'invalid' || phase === 'expired') {
    const expired = phase === 'expired'
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-b from-blue-50/60 via-white to-sky-50/40 px-4 dark:from-blue-950/30 dark:via-background dark:to-sky-950/20">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-md"
        >
          <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-lg dark:border-slate-800">
            <div className={`h-1.5 w-full ${expired ? 'bg-gradient-to-r from-amber-400 to-orange-500' : 'bg-gradient-to-r from-rose-400 to-rose-600'}`} aria-hidden />
            <CardContent className="space-y-4 p-7 text-center">
              <span
                className={`mx-auto grid size-14 place-items-center rounded-2xl ${
                  expired ? 'bg-amber-100 dark:bg-amber-950/50' : 'bg-rose-100 dark:bg-rose-950/50'
                }`}
                aria-hidden
              >
                {expired ? (
                  <Timer className="size-7 text-amber-600" />
                ) : (
                  <LinkIcon className="size-7 text-rose-500" />
                )}
              </span>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {expired ? 'Interview link expired' : 'Interview link not recognised'}
              </h1>
              <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {expired
                  ? errorText || 'This interview link has expired — contact your recruiter to get a fresh invite.'
                  : errorText || 'Interview link not recognised — double-check the link or contact your recruiter.'}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Tip: open the exact link from your invite email — it looks like
                <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] dark:bg-slate-800">/?interview=…</code>
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    )
  }

  /* -------------------------------- system check -------------------------------- */
  if (phase === 'check' && meta) {
    return (
      <div className="grid min-h-screen place-items-center overflow-y-auto bg-gradient-to-b from-blue-50/60 via-white to-sky-50/40 px-4 py-10 dark:from-blue-950/30 dark:via-background dark:to-sky-950/20">
        <div className="w-full max-w-xl">
          <div className="mb-5 flex items-center justify-center gap-2" aria-hidden>
            <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-sky-600 text-white shadow-sm">
              <Eye className="size-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">SeeWe</span>
            <Badge variant="outline" className="rounded-full border-blue-200 bg-blue-50 px-2.5 text-[10px] uppercase tracking-wide text-blue-700 dark:bg-blue-950/40">
              Two-way AI interview
            </Badge>
          </div>
          <SystemCheck
            jobTitle={meta.jobTitle}
            companyName={meta.company}
            candidateName={meta.candidateName}
            onContinue={() => setPhase('room')}
          />
        </div>
      </div>
    )
  }

  /* -------------------------------- interview room -------------------------------- */
  if (phase === 'room' && meta) {
    const tokenMeta: TokenRoomMeta = {
      token,
      jobTitle: meta.jobTitle,
      company: meta.company,
      candidateName: meta.candidateName,
      expiresAt: meta.expiresAt,
    }
    return (
      <InterviewRoom
        tokenMeta={tokenMeta}
        onTokenClose={() => setPhase('closed')}
      />
    )
  }

  /* ------------------------------ closed / finished ------------------------------ */
  if (phase === 'closed') {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-b from-emerald-50/50 via-white to-sky-50/40 px-4 dark:from-emerald-950/20 dark:via-background dark:to-sky-950/20">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="w-full max-w-md"
        >
          <Card className="overflow-hidden rounded-2xl border-slate-200 shadow-lg dark:border-slate-800">
            <div className="h-1.5 w-full bg-gradient-to-r from-emerald-400 to-teal-500" aria-hidden />
            <CardContent className="space-y-4 p-7 text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-100 dark:bg-emerald-950/50" aria-hidden>
                <CheckCircle2 className="size-7 text-emerald-600" />
              </span>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                Interview session ended
              </h1>
              <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                You can safely close this window. The hiring team receives your responses and
                will get back to you with next steps.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    )
  }

  /* fallback — should not render, keeps the component exhaustive */
  return (
    <div className="grid min-h-screen place-items-center bg-background text-sm text-slate-500">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading interview room…
      </span>
      <AlertTriangle className="hidden" aria-hidden />
    </div>
  )
}
