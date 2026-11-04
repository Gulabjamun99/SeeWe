'use client'

/**
 * CvOptimizer — AI job-specific CV suggestions (master spec §6),
 * CANDIDATE-PRIVATE: the analysis result lives only in this card.
 *
 * Pick an ACTIVE job → POST /api/ai/cv-optimizer { jobId, candidateId } →
 * { matchScore, missingKeywords, strongKeywords, summarySuggestion,
 *   bulletSuggestions[{target, improved}], verdict, source: 'ai'|'heuristic' }
 *
 * Nothing here is ever written to any recruiter-visible surface.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Copy,
  Gauge,
  Lightbulb,
  Loader2,
  Sparkles,
  TriangleAlert,
  Wand2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ApiResponse, User } from '@/lib/types'

interface JobOption {
  id: string
  title: string
  company: string
}

interface OptimizerBullet {
  target: string
  improved: string
}

interface OptimizerResult {
  matchScore: number
  missingKeywords: string[]
  strongKeywords: string[]
  summarySuggestion: string
  bulletSuggestions: OptimizerBullet[]
  verdict: string
  source: 'ai' | 'heuristic'
}

function scoreTone(score: number): { text: string; bar: string } {
  if (score >= 75) return { text: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-500' }
  if (score >= 50) return { text: 'text-amber-600 dark:text-amber-400', bar: 'bg-amber-500' }
  return { text: 'text-rose-600 dark:text-rose-400', bar: 'bg-rose-500' }
}

export function CvOptimizer({ user }: { user: User }) {
  const [jobs, setJobs] = useState<JobOption[] | null>(null)
  const [jobId, setJobId] = useState<string>('')
  const [analyzing, setAnalyzing] = useState(false)
  const [result, setResult] = useState<OptimizerResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetch('/api/jobs?limit=100')
      .then((r) => r.json())
      .then((json: ApiResponse<{ jobs: JobOption[] }>) => {
        if (!alive) return
        setJobs(json.data?.jobs ?? [])
      })
      .catch(() => alive && setJobs([]))
    return () => {
      alive = false
    }
  }, [])

  const tone = useMemo(() => scoreTone(result?.matchScore ?? 0), [result])

  const analyze = useCallback(async () => {
    if (!jobId) {
      toast.error('Pehle ek job choose karo')
      return
    }
    setAnalyzing(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/ai/cv-optimizer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, candidateId: user.id }),
      })
      const json = (await res.json().catch(() => ({}))) as ApiResponse<OptimizerResult>
      if (!res.ok || json.error || !json.data) throw new Error(json.error ?? 'Analysis failed')
      setResult(json.data)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Analysis failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setAnalyzing(false)
    }
  }, [jobId, user.id])

  async function copySummary() {
    if (!result?.summarySuggestion) return
    try {
      await navigator.clipboard.writeText(result.summarySuggestion)
      toast.success('Summary copied — paste it into your profile')
    } catch {
      toast.error('Copy failed — select the text manually')
    }
  }

  return (
    <Card className="rounded-2xl border-slate-200 dark:border-slate-800 shadow-md">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-slate-700 dark:text-slate-300">
              <Wand2 className="size-4 text-violet-600" aria-hidden />
              CV optimizer — job-specific suggestions
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              Apni CV ko kisi ek job ke hisaab se analyze karo — match score, missing keywords aur
              improved bullets. Yeh analysis <span className="font-semibold">sirf aapke liye</span>{' '}
              hai.
            </p>
          </div>
        </div>

        {/* job picker + analyze */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={jobId} onValueChange={(v) => { setJobId(v); setResult(null); setError(null) }}>
            <SelectTrigger
              aria-label="Choose a job to optimize for"
              className="min-h-[44px] w-full rounded-xl sm:w-[320px]"
            >
              <SelectValue placeholder={jobs === null ? 'Loading jobs…' : 'Choose an open job'} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {(jobs ?? []).map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.title} · {j.company}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => void analyze()}
            disabled={analyzing || !jobId}
            className="min-h-[44px] gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:from-violet-700 hover:to-fuchsia-700"
          >
            {analyzing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="size-4" aria-hidden />
            )}
            {analyzing ? 'Analyzing…' : 'Analyze my CV'}
          </Button>
        </div>

        {/* loading skeleton */}
        {analyzing && (
          <div className="mt-4 space-y-3" aria-live="polite">
            <div className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" />
            <div className="h-12 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" />
            <div className="h-28 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800/60" />
          </div>
        )}

        {/* error */}
        {error && !analyzing && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3.5 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        {/* result */}
        {result && !analyzing && (
          <div className="mt-4 space-y-4">
            {/* score + verdict */}
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-900/40">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
                  <Gauge className={`size-4 ${tone.text}`} aria-hidden /> Job match score
                </p>
                <p className={`text-2xl font-extrabold ${tone.text}`}>{result.matchScore}%</p>
              </div>
              <Progress
                value={result.matchScore}
                aria-label={`Match score ${result.matchScore} percent`}
                className="mt-2 h-2 bg-slate-200 dark:bg-slate-700 [&>div]:bg-gradient-to-r"
              />
              <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {result.verdict}
              </p>
              {result.source === 'heuristic' && (
                <p className="mt-1.5 text-[11px] italic text-slate-400">
                  (AI unavailable — keyword-overlap analysis used)
                </p>
              )}
            </div>

            {/* keywords */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-3.5 dark:border-rose-900/50 dark:bg-rose-950/20">
                <p className="text-xs font-bold uppercase tracking-wide text-rose-700 dark:text-rose-300">
                  Missing keywords
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.missingKeywords.length ? (
                    result.missingKeywords.map((k) => (
                      <Badge
                        key={k}
                        className="rounded-full border-none bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-900/50 dark:text-rose-200"
                      >
                        {k}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">Koi nahi — great coverage!</span>
                  )}
                </div>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3.5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
                <p className="text-xs font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  Strong keywords
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.strongKeywords.length ? (
                    result.strongKeywords.map((k) => (
                      <Badge
                        key={k}
                        className="rounded-full border-none bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200"
                      >
                        <CheckCircle2 className="mr-1 size-3" aria-hidden /> {k}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-slate-500">—</span>
                  )}
                </div>
              </div>
            </div>

            {/* summary suggestion */}
            <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-violet-700 dark:text-violet-300">
                  <Lightbulb className="size-3.5" aria-hidden /> Suggested profile summary
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void copySummary()}
                  className="min-h-[30px] gap-1 rounded-lg px-2.5 text-[11px]"
                >
                  <Copy className="size-3.5" aria-hidden /> Copy
                </Button>
              </div>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                {result.summarySuggestion}
              </p>
            </div>

            {/* bullet suggestions */}
            {result.bulletSuggestions.length > 0 && (
              <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Improved resume bullets
                </p>
                <ul className="mt-2.5 space-y-2.5">
                  {result.bulletSuggestions.map((b, i) => (
                    <li
                      key={`${b.target}-${i}`}
                      className="rounded-lg border border-slate-100 bg-slate-50/60 p-3 dark:border-slate-800 dark:bg-slate-900/40"
                    >
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                        For: {b.target}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                        {b.improved}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
