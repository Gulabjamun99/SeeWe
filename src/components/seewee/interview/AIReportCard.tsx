'use client'

import { useId, useMemo } from 'react'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { printElement } from '@/lib/print'
import {
  Bot,
  CheckCircle2,
  FileDown,
  Lock,
  Quote,
  Send,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { VERDICT_META } from '@/store/app-store'
import type {
  DimensionScore,
  Interview,
  InterviewQuestion,
  InterviewReport,
} from '@/lib/types'

/* ------------------------------------------------------------------ */
/* Types & parsing helpers                                             */
/* ------------------------------------------------------------------ */

/**
 * Accepts either a fully-parsed interview (questions/report already decoded)
 * or a raw interview whose JSON fields are still strings. Presentation-safe.
 */
export type ReportReadyInterview = Omit<
  Interview,
  'questions' | 'report'
> & {
  questions?: InterviewQuestion[] | string // parsed upstream; ignored by this card
  report?: InterviewReport | string | null
}

function coerceReport(raw: unknown): InterviewReport | null {
  let obj: unknown = raw
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return null
    }
  }
  if (!obj || typeof obj !== 'object') return null
  const o = obj as Partial<InterviewReport>
  if (!Array.isArray(o.dimensionScores) || o.dimensionScores.length === 0) {
    return null
  }
  return {
    aiSummary: typeof o.aiSummary === 'string' ? o.aiSummary : '',
    dimensionScores: o.dimensionScores
      .filter((d): d is DimensionScore => !!d && typeof d === 'object')
      .map((d) => ({
        name: String(d.name ?? 'Dimension'),
        score: Math.max(0, Math.min(10, Number(d.score) || 0)),
      })),
    strengths: Array.isArray(o.strengths) ? o.strengths.map(String) : [],
    weaknesses: Array.isArray(o.weaknesses) ? o.weaknesses.map(String) : [],
    recommendation:
      typeof o.recommendation === 'string' ? o.recommendation : '',
  }
}

/* ------------------------------------------------------------------ */
/* Visual constants                                                    */
/* ------------------------------------------------------------------ */

/** Consistent blue/sky/amber accent rotation across the 4 dimensions */
const DIM_ACCENTS = [
  { bar: 'bg-blue-500', text: 'text-blue-600', track: 'bg-blue-100 dark:bg-blue-900/40' },
  { bar: 'bg-sky-500', text: 'text-sky-600', track: 'bg-sky-100 dark:bg-sky-900/40' },
  { bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-300', track: 'bg-amber-100 dark:bg-amber-900/40' },
  { bar: 'bg-blue-500', text: 'text-blue-600', track: 'bg-blue-100 dark:bg-blue-900/40' },
] as const

/** Concrete text-color drives SVG stroke via currentColor */
const VERDICT_STROKE: Record<string, string> = {
  STRONG_HIRE: 'text-blue-500',
  HIRE: 'text-sky-500',
  MAYBE: 'text-amber-500',
  NO_HIRE: 'text-rose-400',
}

function scoreBand(score: number): {
  text: string
  ring: string
} {
  if (score >= 7)
    return { text: 'text-blue-600', ring: 'border-blue-300 bg-blue-50 dark:bg-blue-950/40' }
  if (score >= 5)
    return { text: 'text-sky-600', ring: 'border-sky-300 bg-sky-50 dark:bg-sky-950/40' }
  if (score >= 4.5)
    return { text: 'text-amber-600 dark:text-amber-300', ring: 'border-amber-300 bg-amber-50 dark:bg-amber-950/40' }
  return { text: 'text-rose-500', ring: 'border-rose-300 bg-rose-50 dark:bg-rose-950/40' }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface AIReportCardProps {
  /** Interview including COMPLETED status + parsed report preferred */
  interview: ReportReadyInterview
  /** When provided (and not yet shared), renders the Share CTA */
  onShare?: () => void
  shared?: boolean
}

export function AIReportCard({
  interview,
  onShare,
  shared = false,
}: AIReportCardProps) {
  const reactId = useId()
  const printId = `seewee-report-${reactId.replace(/[^a-zA-Z0-9-]/g, '')}`
  const report = useMemo(() => coerceReport(interview.report), [interview.report])
  const meta =
    (interview.verdict && VERDICT_META[interview.verdict]) ||
    ({ label: 'Unrated', className: 'bg-slate-100 text-slate-600 dark:text-slate-400 border-slate-200', emoji: '📋' } as const)

  const score = Number(interview.overallScore ?? 0)
  const band = scoreBand(score)

  /* Donut geometry */
  const R = 52
  const CIRC = 2 * Math.PI * R
  const frac = Math.max(0, Math.min(10, score)) / 10

  const completedLabel = interview.completedAt
    ? (() => {
        try {
          return format(new Date(interview.completedAt), 'PPP p')
        } catch {
          return ''
        }
      })()
    : null

  return (
    <article
      id={printId}
      className="print-section overflow-hidden rounded-2xl border border-slate-200 bg-white dark:bg-slate-900 shadow-lg print:border-0 print:shadow-none"
    >
      {/* ---------------- Print-only branded header ---------------- */}
      <div className="hidden items-center justify-between border-b-2 border-blue-600 px-8 py-4 [@media_print]:flex">
        <div>
          <p className="text-lg font-black tracking-tight text-blue-700">
            See<span className="text-slate-800 dark:text-slate-200">We</span>
            <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500">
              AI Interview Report
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            {interview.candidateName} · {interview.jobTitle}
            {interview.domain ? ` · ${interview.domain}` : ''}
          </p>
        </div>
        <p className="text-right text-[10px] leading-relaxed text-slate-400 dark:text-slate-500">
          Generated {format(new Date(), 'PPP')}<br />
          Confidential — for hiring evaluation only
        </p>
      </div>

      {/* ---------------- Hero medallion ---------------- */}
      <header className="relative flex flex-col items-center gap-5 border-b border-slate-100 dark:border-slate-800/60 bg-gradient-to-b from-blue-50/60 via-white to-white px-6 pb-7 pt-8 sm:flex-row sm:items-center sm:gap-8 sm:px-8">
        {/* Donut */}
        <div className="relative h-36 w-36 shrink-0">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              strokeWidth="11"
              className="stroke-slate-100"
            />
            <motion.circle
              cx="60"
              cy="60"
              r={R}
              fill="none"
              strokeWidth="11"
              strokeLinecap="round"
              stroke="currentColor"
              className={
                VERDICT_STROKE[interview.verdict ?? ''] ?? 'text-blue-500'
              }
              strokeDasharray={`${frac * CIRC} ${CIRC}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-3xl font-bold tabular-nums ${band.text}`}>
              {score.toFixed(1)}
            </span>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">out of 10</span>
            <span className="mt-0.5 text-lg leading-none">{meta.emoji}</span>
          </div>
        </div>

        {/* Identity block */}
        <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center sm:items-start sm:text-left">
          <Badge
            data-testid="verdict-badge"
            className={`rounded-full px-3 py-1 text-sm font-semibold shadow-sm ${meta.className}`}
          >
            {meta.emoji} {meta.label}
          </Badge>
          <h2 className="truncate text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {interview.candidateName}
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {interview.jobTitle}
            {interview.domain ? (
              <>
                {' '}· <span className="font-medium text-slate-600 dark:text-slate-400">{interview.domain}</span>
              </>
            ) : null}
            {interview.difficulty ? (
              <>
                {' '}·{' '}
                <span className="font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {interview.difficulty}
                </span>
              </>
            ) : null}
          </p>
          {completedLabel ? (
            <p className="text-xs text-slate-400 dark:text-slate-500">Completed {completedLabel}</p>
          ) : null}
          <div className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
            <ShieldCheck className="size-3.5 text-blue-500" aria-hidden />
            AI-evaluated · unedited voice transcript
          </div>
        </div>
      </header>

      {!report ? (
        <div className="px-8 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
          The detailed report is still being generated. Please check back shortly.
        </div>
      ) : (
        <div className="space-y-8 px-6 py-7 sm:px-8">
          {/* ---------------- Dimension meters ---------------- */}
          <section aria-label="Dimension scores">
            <h3 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              Dimension Scores
            </h3>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {report.dimensionScores.slice(0, 4).map((d, i) => {
                const acc = DIM_ACCENTS[i % DIM_ACCENTS.length]
                return (
                  <div key={`${d.name}-${i}`}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{d.name}</span>
                      <span className={`text-sm font-semibold tabular-nums ${acc.text}`}>
                        {d.score.toFixed(1)}
                        <span className="ml-0.5 text-xs font-normal text-slate-400 dark:text-slate-500">/10</span>
                      </span>
                    </div>
                    <div className={`h-2 w-full overflow-hidden rounded-full ${acc.track}`}>
                      <motion.div
                        className={`h-full rounded-full ${acc.bar}`}
                        initial={{ width: 0 }}
                        whileInView={{ width: `${Math.min(100, d.score * 10)}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.9, ease: 'easeOut', delay: i * 0.08 }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <Separator />

          {/* ---------------- Strengths ---------------- */}
          {report.strengths.length > 0 && (
            <section aria-label="Strengths">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                💪 Strengths
              </h3>
              <ul className="space-y-2.5">
                {report.strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-400">
                    <CheckCircle2
                      className="mt-0.5 size-4 shrink-0 text-blue-500"
                      aria-hidden
                    />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ---------------- Improvements ---------------- */}
          {report.weaknesses.length > 0 && (
            <section aria-label="Areas to improve">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                🔧 Areas to Improve
              </h3>
              <ul className="space-y-2.5">
                {report.weaknesses.map((w, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm text-slate-600 dark:text-slate-400">
                    <TrendingUp
                      className="mt-0.5 size-4 shrink-0 text-amber-500"
                      aria-hidden
                    />
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Separator />

          {/* ---------------- AI Summary quote ---------------- */}
          {report.aiSummary && (
            <section aria-label="AI summary">
              <figure className="relative rounded-r-xl border-l-4 border-blue-500 bg-gradient-to-br from-blue-50/80 dark:from-blue-950/40 to-sky-50/50 py-5 pl-6 pr-5">
                <Quote
                  className="absolute -left-3 -top-3 size-7 rounded-full bg-blue-500 p-1.5 text-white"
                  aria-hidden
                />
                <blockquote className="font-serif text-[15px] italic leading-relaxed text-slate-700 dark:text-slate-300">
                  “{report.aiSummary}”
                </blockquote>
                <figcaption className="mt-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  <Bot className="size-3.5 text-blue-500" aria-hidden />
                  SeeWe AI summary
                </figcaption>
              </figure>
            </section>
          )}

          {/* ---------------- AI Suggestion (advisory) ---------------- */}
          {report.recommendation && (
            <section aria-label="AI suggestion">
              <h3 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                🧭 AI Suggestion — advisory only
              </h3>
              <p className="mb-2 max-w-prose text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                The AI only suggests — the final advance / reject call always rests with the
                recruiter.
              </p>
              <p className="max-w-prose text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                {report.recommendation}
              </p>
            </section>
          )}
        </div>
      )}

      {/* ---------------- Footer actions ---------------- */}
      <footer className="flex flex-col gap-3 border-t border-slate-100 dark:border-slate-800/60 bg-slate-50/60 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 print:hidden">
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500">
          <Lock className="size-3" aria-hidden />
          Generated by SeeWe AI • Confidential
        </p>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() =>
              printElement(printId, {
                title: `SeeWe AI Report — ${interview.candidateName} — ${interview.jobTitle}`,
              })
            }
            className="min-h-[38px] gap-1.5 rounded-xl border-slate-300 text-slate-600 dark:text-slate-400 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            aria-label="Export this report as PDF via the print dialog"
          >
            <FileDown className="size-4" aria-hidden />
            Export PDF
          </Button>
          {shared ? (
            <Badge className="gap-1 rounded-full border-blue-200 bg-blue-50 dark:bg-blue-950/40 px-3 py-1 text-blue-700 shadow-[0_0_14px_-4px_rgba(59,130,246,0.55)]">
              <Send className="size-3" aria-hidden /> Shared with client
            </Badge>
          ) : (
            onShare && (
              <Button
                onClick={onShare}
                className="min-h-[38px] rounded-xl bg-blue-600 hover:bg-blue-700"
              >
                <Send className="size-4" aria-hidden />
                Share with Client
              </Button>
            )
          )}
        </div>
      </footer>

      {/* print affordance kept out of screen flow */}
      <p className="hidden items-center gap-1.5 px-8 pb-4 pt-1 text-[11px] text-slate-400 dark:text-slate-500 [@media_print]:flex">
        <FileDown className="size-3" aria-hidden /> SeeWe AI interview report — printable copy
      </p>
    </article>
  )
}
