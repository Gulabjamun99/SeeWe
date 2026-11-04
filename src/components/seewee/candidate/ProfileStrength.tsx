'use client'

/**
 * ProfileStrength — weighted completeness meter for the candidate header.
 *
 * Weights seven profile signals into a 0–100 score, renders it as an animated
 * gradient ring with the missing pieces as tappable chips, and routes the CTA
 * to the My Profile tab. Purely derived from the signed-in user — no fetching.
 */

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, PartyPopper, UserRound } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { User } from '@/lib/types'

interface StrengthCheck {
  key: string
  label: string
  done: boolean
  weight: number
}

function computeChecks(user: User): StrengthCheck[] {
  return [
    {
      key: 'headline',
      label: 'Add a headline',
      done: Boolean(user.headline?.trim()),
      weight: 15,
    },
    {
      key: 'skills',
      label: 'List your skills',
      done: Boolean(user.skills?.trim()),
      weight: 20,
    },
    {
      key: 'experience',
      label: 'Set years of experience',
      done: user.experienceYears != null,
      weight: 15,
    },
    {
      key: 'location',
      label: 'Add your city',
      done: Boolean(user.location?.trim()),
      weight: 10,
    },
    {
      key: 'education',
      label: 'Add education',
      done: Boolean(user.education?.trim()),
      weight: 10,
    },
    {
      key: 'phone',
      label: 'Add a phone number',
      done: Boolean(user.phone?.trim()),
      weight: 10,
    },
    {
      key: 'resume',
      label: 'Save your resume text',
      done: (user.resumeText?.trim().length ?? 0) >= 100,
      weight: 20,
    },
  ]
}

function bandMeta(pct: number): { label: string; cls: string } {
  if (pct >= 90) return { label: 'All-star profile', cls: 'text-blue-700' }
  if (pct >= 70) return { label: 'Strong profile', cls: 'text-blue-600' }
  if (pct >= 40) return { label: 'Good start', cls: 'text-amber-600 dark:text-amber-300' }
  return { label: 'Getting started', cls: 'text-slate-500 dark:text-slate-400' }
}

const RING_RADIUS = 26
const RING_CIRC = 2 * Math.PI * RING_RADIUS

export function ProfileStrength({
  user,
  onComplete,
}: {
  user: User
  onComplete: () => void
}) {
  const { pct, missing, band } = useMemo(() => {
    const checks = computeChecks(user)
    const score = checks.reduce((sum, c) => sum + (c.done ? c.weight : 0), 0)
    return {
      pct: score,
      missing: checks.filter((c) => !c.done),
      band: bandMeta(score),
    }
  }, [user])

  const complete = missing.length === 0

  return (
    <section
      aria-label="Profile strength"
      className="flex flex-col gap-4 rounded-2xl border border-blue-100 dark:border-blue-900/60 bg-gradient-to-r from-blue-50/70 dark:from-blue-950/40 via-white to-sky-50/50 dark:to-sky-950/40 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-6"
    >
      <div className="flex min-w-0 items-center gap-4">
        {/* ------------------------------ ring ------------------------------ */}
        <div
          className="relative size-16 shrink-0 sm:size-[72px]"
          role="img"
          aria-label={`Profile ${pct} percent complete`}
        >
          <svg viewBox="0 0 64 64" className="size-full -rotate-90">
            <defs>
              <linearGradient id="ps-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#0ea5e9" />
              </linearGradient>
            </defs>
            <circle
              cx="32"
              cy="32"
              r={RING_RADIUS}
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="6"
              className="stroke-slate-200 dark:stroke-slate-800"
            />
            <motion.circle
              cx="32"
              cy="32"
              r={RING_RADIUS}
              fill="none"
              stroke="url(#ps-grad)"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={RING_CIRC}
              initial={{ strokeDashoffset: RING_CIRC }}
              animate={{ strokeDashoffset: RING_CIRC * (1 - pct / 100) }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <span className="text-lg font-extrabold tabular-nums tracking-tight text-slate-900 dark:text-slate-100">
              {pct}
              <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">%</span>
            </span>
          </div>
        </div>

        {/* ---------------------------- copy + chips ---------------------------- */}
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Profile strength
            <span className={`text-xs font-bold ${band.cls}`}>· {band.label}</span>
          </p>
          {complete ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              <PartyPopper className="size-3.5 text-blue-500" aria-hidden />
              Recruiters love a complete profile — you&apos;re all set!
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {missing.slice(0, 3).map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={onComplete}
                  className="rounded-full border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 transition-colors hover:border-amber-300 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  {m.label}
                </button>
              ))}
              {missing.length > 3 && (
                <span className="self-center text-[11px] text-slate-400 dark:text-slate-500">
                  +{missing.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------- CTA ------------------------------- */}
      {complete ? (
        <Badge className="w-fit shrink-0 gap-1.5 rounded-full border-blue-300 bg-blue-100 dark:bg-blue-900/40 px-3.5 py-1.5 text-blue-800 shadow-sm">
          <UserRound className="size-3.5" aria-hidden /> 100% complete
        </Badge>
      ) : (
        <Button
          size="sm"
          onClick={onComplete}
          className="group min-h-[40px] shrink-0 rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 px-4 font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700"
        >
          Complete profile
          <ArrowRight
            className="size-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Button>
      )}
    </section>
  )
}
