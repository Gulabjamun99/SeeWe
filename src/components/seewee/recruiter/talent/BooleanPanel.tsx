'use client'

/**
 * BooleanPanel — the guided Boolean search builder.
 *
 * Two modes side by side:
 *   • GUIDED (default): three structured rows — MUST include (all of),
 *     ANY of (at least one), MUST NOT include — compiled into a valid
 *     boolean expression for non-technical recruiters.
 *   • RAW: a free-form query box with live validation, a readable
 *     "interpreted as" summary, and clickable example queries. Syntax
 *     errors show inline with position hints — never silently ignored.
 */

import { useMemo } from 'react'
import { AlertTriangle, Braces, CircleHelp, Eraser, Wand2 } from 'lucide-react'
import { parseBooleanQuery } from '@/lib/talent-search-engine'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export const BOOLEAN_EXAMPLES: { label: string; query: string }[] = [
  {
    label: 'Maintenance Manager (classic example)',
    query:
      '("Maintenance Manager" OR "Plant Maintenance Head") AND (Extrusion OR Polymer OR "Plastic Pipes") AND (TPM OR OEE) NOT (Trainee OR Intern)',
  },
  {
    label: 'Senior React talent',
    query: 'react AND (redux OR "next.js") AND senior NOT intern',
  },
  {
    label: 'Data engineers w/ Spark',
    query: '("Data Engineer" OR ETL) AND (Spark OR Airflow) NOT fresher',
  },
  {
    label: 'Finance risk pool',
    query: '(("Credit Analyst" OR "Risk Manager") AND (Basel OR "Stress Testing")) NOT sales',
  },
]

interface BooleanPanelProps {
  enabled: boolean
  onToggle: (on: boolean) => void
  rawQuery: string
  onRawQuery: (q: string) => void
  must: string
  anyOf: string
  not: string
  onMust: (v: string) => void
  onAnyOf: (v: string) => void
  onNot: (v: string) => void
}

export function BooleanPanel({
  enabled,
  onToggle,
  rawQuery,
  onRawQuery,
  must,
  anyOf,
  not,
  onMust,
  onAnyOf,
  onNot,
}: BooleanPanelProps) {
  const validation = useMemo(() => {
    const q = rawQuery.trim()
    if (!q) return { ok: true, summary: '', error: null as string | null }
    const r = parseBooleanQuery(q)
    return r.ok
      ? { ok: true, summary: r.summary, error: null as string | null }
      : { ok: false, summary: '', error: r.error.message }
  }, [rawQuery])

  const guidedQuery = useMemo(() => compileGuided(must, anyOf, not), [must, anyOf, not])

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={() => onToggle(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-teal-300 bg-teal-50/60 px-3 py-1.5 text-xs font-medium text-teal-700 transition hover:bg-teal-100 dark:border-teal-700 dark:bg-teal-950/40 dark:text-teal-300"
        aria-label="Open Boolean search builder"
      >
        <Braces className="size-3.5" aria-hidden /> Boolean search
      </button>
    )
  }

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-3 dark:border-teal-900 dark:bg-teal-950/20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-800 dark:text-teal-300">
          <Braces className="size-3.5" aria-hidden /> Boolean search
          <span className="hidden font-normal text-slate-500 sm:inline">— AND · OR · NOT · &quot;exact phrase&quot; · (grouping)</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-slate-500"
          onClick={() => onToggle(false)}
        >
          <Eraser className="size-3" aria-hidden /> Close
        </Button>
      </div>

      {/* guided builder */}
      <div className="grid gap-2 md:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            MUST include <span className="text-slate-400">(all of)</span>
          </Label>
          <Input
            value={must}
            onChange={(e) => onMust(e.target.value)}
            placeholder="react, tpm"
            className="h-8 bg-white text-xs dark:bg-slate-900"
            aria-label="Skills or keywords that must all appear"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            ANY of <span className="text-slate-400">(at least one)</span>
          </Label>
          <Input
            value={anyOf}
            onChange={(e) => onAnyOf(e.target.value)}
            placeholder='&quot;Plant Maintenance Head&quot;, OEE'
            className="h-8 bg-white text-xs dark:bg-slate-900"
            aria-label="Keywords where at least one must appear"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
            MUST NOT include <span className="text-slate-400">(exclude)</span>
          </Label>
          <Input
            value={not}
            onChange={(e) => onNot(e.target.value)}
            placeholder="intern, trainee"
            className="h-8 bg-white text-xs dark:bg-slate-900"
            aria-label="Keywords to exclude"
          />
        </div>
      </div>
      {(must.trim() || anyOf.trim() || not.trim()) && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-teal-700 dark:text-teal-400">
          <Wand2 className="size-3 shrink-0" aria-hidden />
          Compiled:{' '}
          <code className="max-w-full truncate rounded bg-white px-1.5 py-0.5 font-mono text-[10px] dark:bg-slate-900">
            {guidedQuery || '—'}
          </code>
        </p>
      )}

      <div className="my-2.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-400">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /> or write a raw query{' '}
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
      </div>

      {/* raw mode */}
      <Input
        value={rawQuery}
        onChange={(e) => onRawQuery(e.target.value)}
        placeholder='("Maintenance Manager" OR OEE) AND SAP PM NOT intern'
        className="h-9 bg-white font-mono text-xs dark:bg-slate-900"
        aria-label="Raw boolean query"
        aria-invalid={!validation.ok}
      />
      {validation.error ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {validation.error}
        </p>
      ) : rawQuery.trim() ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
          <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-teal-600" aria-hidden />
          <span>
            Interpreted as: <span className="font-medium text-teal-700 dark:text-teal-300">{validation.summary}</span>
          </span>
        </p>
      ) : null}

      {/* examples */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Examples</span>
        {BOOLEAN_EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => {
              onRawQuery(ex.query)
              onMust('')
              onAnyOf('')
              onNot('')
            }}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 transition hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-teal-600"
          >
            {ex.label}
          </button>
        ))}
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {['AND', 'OR', 'NOT', '"phrase"', '( )'].map((tok) => (
          <Badge key={tok} variant="outline" className="bg-white font-mono text-[10px] text-slate-500 dark:bg-slate-900">
            {tok}
          </Badge>
        ))}
      </div>
    </div>
  )
}

/** Compile guided rows into the raw query when the user switches away.
 *  Terms that already carry quotes are unwrapped first (never double-quote). */
export function compileGuided(must: string, anyOf: string, not: string): string {
  const wrap = (t: string): string => {
    const bare = t.trim().replace(/^"+|"+$/g, '')
    return bare.includes(' ') ? `"${bare}"` : bare
  }
  const mustTerms = must.split(',').map((s) => s.trim()).filter(Boolean).map(wrap)
  const anyTerms = anyOf.split(',').map((s) => s.trim()).filter(Boolean).map(wrap)
  const notTerms = not.split(',').map((s) => s.trim()).filter(Boolean).map(wrap)
  const parts: string[] = []
  if (mustTerms.length) parts.push(mustTerms.join(' AND '))
  if (anyTerms.length) parts.push(`(${anyTerms.join(' OR ')})`)
  if (notTerms.length) parts.push(`NOT (${notTerms.join(' OR ')})`)
  return parts.join(' ')
}
