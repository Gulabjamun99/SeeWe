'use client'

import { useEffect, useMemo, useState } from 'react'
import { useAppStore, skillsToArray, formatLpa } from '@/store/app-store'
import { computeMatchScore } from '@/lib/match'
import type { Job, User, Client } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  IndianRupee,
  MapPin,
  Mic,
  ArrowRight,
  Search,
  Star,
  Send,
  Sparkles,
  UsersRound,
  ClipboardCheck,
  Globe,
  Handshake,
  TrendingUp,
} from 'lucide-react'

const QUICK_SKILLS = ['React', 'Java', 'Python', 'DevOps', 'UI Design', 'Data', 'Android']

const PIPELINE = [
  {
    icon: ClipboardCheck,
    step: '1',
    title: 'Post & Collect',
    desc: 'Publish a job in seconds and receive applications with skill-match scores computed automatically.',
    color: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  },
  {
    icon: Star,
    step: '2',
    title: 'Shortlist',
    desc: 'One tap to shortlist promising profiles and pick which client gets the final report.',
    color: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
  },
  {
    icon: Bot,
    step: '3',
    title: 'AI Interview',
    desc: 'SeeWe AI studies the resume + JD and runs a spoken video interview — questions, answers, everything.',
    color: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  },
  {
    icon: Send,
    step: '4',
    title: 'Share Report',
    desc: 'A client-ready rating dossier lands with your clients: scores, strengths, verdict.',
    color: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
  },
  {
    icon: Handshake,
    step: '5',
    title: 'Client Verdict',
    desc: 'Clients review the dossier in their own portal and send approve / hold / decline back to you.',
    color: 'bg-lime-100 dark:bg-lime-900/40 text-lime-700 dark:text-lime-300',
  },
]

function HeroStats() {
  const [stats, setStats] = useState<{ jobs: number; candidates: number; clients: number } | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([
      fetch('/api/jobs?limit=100').then((r) => r.json()),
      fetch('/api/candidates').then((r) => r.json()),
      fetch('/api/clients').then((r) => r.json()),
    ])
      .then(([j, c, cl]: [{ data?: { jobs?: Job[]; total?: number } }, { data?: User[]; total?: number }, { data?: Client[] }]) => {
        if (!alive) return
        setStats({
          jobs: j.data?.total ?? j.data?.jobs?.length ?? 0,
          candidates: c.total ?? c.data?.length ?? 0,
          clients: cl.data?.length ?? 0,
        })
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const items = [
    { label: 'Live jobs', value: stats?.jobs, icon: BriefcaseBusiness },
    { label: 'Candidates', value: stats?.candidates, icon: UsersRound },
    { label: 'Client partners', value: stats?.clients, icon: Building2 },
    { label: 'AI interviews 24×7', value: '∞', icon: Mic },
  ]
  return (
    <div className="mx-auto mt-8 grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(({ label, value, icon: Icon }) => (
        <div
          key={label}
          className="flex flex-col items-center rounded-xl border border-white/40 bg-card/60 px-3 py-3 backdrop-blur-sm"
        >
          <Icon className="mb-1 h-4 w-4 text-blue-600" aria-hidden />
          <span className="text-lg font-black text-slate-900 dark:text-slate-100">
            {value === undefined ? '—' : String(value)}
          </span>
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Personalized strip for signed-in candidates: top skill-match jobs from the
 * featured pool, ranked by % of the job's skills the candidate covers.
 * Hidden entirely for recruiters/clients/anonymous visitors.
 */
function RecommendedJobs({ jobs }: { jobs: Job[] }) {
  const user = useAppStore((s) => s.user)
  const openJob = useAppStore((s) => s.openJob)
  const candidateSkills = useMemo(() => skillsToArray(user?.skills ?? ''), [user?.skills])

  const ranked = useMemo(() => {
    if (!user || user.role !== 'CANDIDATE' || candidateSkills.length === 0) return []
    const userLower = new Set(candidateSkills.map((s) => s.toLowerCase()))
    return jobs
      .map((job) => {
        const jobSkills = skillsToArray(job.skills)
        const matched = new Set(jobSkills.filter((s) => userLower.has(s.toLowerCase())))
        return {
          job,
          score: computeMatchScore(job.skills, user.skills) ?? 0,
          jobSkills,
          matched,
        }
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
  }, [jobs, user, candidateSkills])

  if (ranked.length === 0) return null

  return (
    <div className="mb-10" aria-labelledby="recommended-heading">
      <div className="mb-4 flex items-center gap-2.5">
        <span
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 text-white shadow-md shadow-blue-600/25"
          aria-hidden
        >
          <Sparkles className="size-4.5" />
        </span>
        <div>
          <h2 id="recommended-heading" className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-xl">
            Recommended for you
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Ranked by overlap with the {candidateSkills.length} skill
            {candidateSkills.length === 1 ? '' : 's'} on your profile
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ranked.map(({ job, score, jobSkills, matched }) => (
          <button
            key={job.id}
            type="button"
            onClick={() => openJob(job.id)}
            aria-label={`Open recommended job ${job.title} at ${job.company}, ${score}% skill match`}
            className="group relative flex min-h-[168px] flex-col overflow-hidden rounded-xl border border-blue-200 dark:border-blue-900/60 bg-gradient-to-b from-blue-50/70 to-white dark:from-blue-950/40 dark:to-slate-900 p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <span className="absolute right-4 top-4 rounded-full bg-gradient-to-r from-blue-600 to-sky-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm">
              {score}% match
            </span>
            <div className="mb-3 flex items-center gap-3 pr-20">
              <Avatar className="h-10 w-10">
                <AvatarFallback className="bg-gradient-to-br from-blue-100 to-sky-100 dark:from-blue-900/40 dark:to-sky-900/40 text-sm font-bold text-blue-700 dark:text-blue-300">
                  {job.company.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <h3 className="line-clamp-1 font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-300">{job.title}</h3>
                <p className="line-clamp-1 text-xs text-slate-500 dark:text-slate-400">{job.company}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {job.location}
              </span>
              <span className="inline-flex items-center gap-1">
                <IndianRupee className="h-3.5 w-3.5" /> {formatLpa(job.salaryMinLpa, job.salaryMaxLpa)}
              </span>
            </div>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
              {jobSkills.slice(0, 3).map((s) => {
                const isMatch = matched.has(s)
                return (
                  <Badge
                    key={s}
                    variant="secondary"
                    className={`rounded-full text-[11px] font-medium ${
                      isMatch ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                    }`}
                    title={isMatch ? `${s} — on your profile` : s}
                  >
                    {s}
                  </Badge>
                )
              })}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function FeaturedJobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null)
  const openJob = useAppStore((s) => s.openJob)

  useEffect(() => {
    let alive = true
    // 12 so the recommender has a pool to rank; the fresh grid shows 6
    fetch('/api/jobs?limit=12')
      .then((r) => r.json())
      .then((json: { data?: { jobs?: Job[] } }) => {
        if (alive) setJobs(json.data?.jobs ?? [])
      })
      .catch(() => alive && setJobs([]))
    return () => {
      alive = false
    }
  }, [])

  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6" aria-labelledby="featured-heading">
      {jobs && <RecommendedJobs jobs={jobs} />}
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h2 id="featured-heading" className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
            Fresh opportunities
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Latest openings from hiring teams on SeeWe</p>
        </div>
        <Button variant="ghost" className="hidden text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-800 dark:hover:text-blue-200 sm:inline-flex" onClick={() => useAppStore.getState().setView('browse')}>
          View all jobs <ArrowRight className="ml-1 h-4 w-4" />
        </Button>
      </div>

      {!jobs ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl border border-slate-100 dark:border-slate-800/60 bg-slate-50 dark:bg-slate-800/60" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {jobs.slice(0, 6).map((job) => {
            const appsCount = job._count?.applications ?? 0
            return (
            <button
              key={job.id}
              type="button"
              onClick={() => openJob(job.id)}
              aria-label={`Open job ${job.title} at ${job.company}`}
              className="group flex min-h-[176px] flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-gradient-to-br from-blue-100 to-sky-100 dark:from-blue-900/40 dark:to-sky-900/40 text-sm font-bold text-blue-700 dark:text-blue-300">
                      {job.company.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="line-clamp-1 font-bold text-slate-900 dark:text-slate-100 group-hover:text-blue-700 dark:group-hover:text-blue-300">{job.title}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{job.company}</p>
                  </div>
                </div>
                {appsCount > 0 && (
                  <Badge variant="outline" className="shrink-0 border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 text-[11px] text-blue-700 dark:text-blue-300">
                    {appsCount} applied
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" /> {job.location}
                </span>
                <span className="inline-flex items-center gap-1">
                  <CalendarClock className="h-3.5 w-3.5" /> {job.experienceMin}–{job.experienceMax} yrs
                </span>
                <span className="inline-flex items-center gap-1">
                  <IndianRupee className="h-3.5 w-3.5" /> {formatLpa(job.salaryMinLpa, job.salaryMaxLpa)}
                </span>
              </div>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
                {skillsToArray(job.skills).slice(0, 3).map((s) => (
                  <Badge key={s} variant="secondary" className="rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    {s}
                  </Badge>
                ))}
                <Badge className="rounded-full bg-sky-50 dark:bg-sky-950/40 text-[11px] text-sky-700 dark:text-sky-300">{job.workMode}</Badge>
              </div>
            </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

export function HomeView() {
  const user = useAppStore((s) => s.user)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const setView = useAppStore((s) => s.setView)
  const setPendingSearch = useAppStore((s) => s.setPendingSearch)
  const [kw, setKw] = useState('')
  const [loc, setLoc] = useState('')

  function search() {
    // Store-based handoff: the browse view may not be mounted to hear events yet
    setPendingSearch({ keyword: kw, location: loc })
    document.dispatchEvent(
      new CustomEvent('seewee:job-search', { detail: { keyword: kw, location: loc } })
    )
    setView('browse')
  }

  function quickSkill(skill: string) {
    setPendingSearch({ keyword: skill, location: '' })
    document.dispatchEvent(new CustomEvent('seewee:job-search', { detail: { keyword: skill, location: '' } }))
    setView('browse')
  }

  return (
    <div className="w-full">
      {/* ---------- HERO ---------- */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50 via-sky-50/60 to-white dark:from-blue-950/40 dark:via-sky-950/30 dark:to-slate-900">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 right-[-10%] h-96 w-96 rounded-full bg-blue-200/30 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-[-8%] top-40 h-72 w-72 rounded-full bg-amber-200/25 blur-3xl"
        />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <Badge className="mb-5 inline-flex animate-pulse rounded-full border-none bg-gradient-to-r from-blue-600 to-sky-600 px-4 py-1.5 text-xs font-semibold text-white shadow-md">
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Powered by SeeWe AI Interviewer
            </Badge>
            <h1 className="text-balance text-4xl font-black leading-tight tracking-tight text-slate-900 dark:text-slate-100 sm:text-5xl lg:text-6xl">
              Find the right job.
              <br />
              Hire the right talent.
              <br />
              <span className="bg-gradient-to-r from-blue-600 to-sky-600 bg-clip-text text-transparent">
                Let AI interview first.
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base leading-relaxed text-slate-600 dark:text-slate-400 sm:text-lg">
              A modern job marketplace with a built-in AI that interviews shortlisted
              candidates on video — resume-aware questions, instant ratings, client-ready reports.
            </p>

            {/* Search bar */}
            <form
              role="search"
              aria-label="Job search"
              className="mx-auto mt-8 flex max-w-2xl flex-col gap-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-card p-2 shadow-lg shadow-blue-100/60 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault()
                search()
              }}
            >
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden />
                <Input
                  aria-label="Keyword"
                  placeholder="Role, skill or company"
                  className="h-11 border-0 pl-9 text-sm focus-visible:ring-1"
                  value={kw}
                  onChange={(e) => setKw(e.target.value)}
                />
              </div>
              <div className="hidden h-auto w-px bg-slate-200 dark:bg-slate-800 sm:block" />
              <div className="relative flex-1">
                <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" aria-hidden />
                <Input
                  aria-label="Location"
                  placeholder="City — e.g. Bengaluru"
                  className="h-11 border-0 pl-9 text-sm focus-visible:ring-1"
                  value={loc}
                  onChange={(e) => setLoc(e.target.value)}
                />
              </div>
              <Button
                type="submit"
                className="h-11 bg-gradient-to-r from-blue-600 to-sky-600 px-7 font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700"
              >
                Search jobs
              </Button>
            </form>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Trending:</span>
              {QUICK_SKILLS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => quickSkill(s)}
                  className="rounded-full border border-slate-200 dark:border-slate-800 bg-card px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-400 transition-colors hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-700 dark:hover:text-blue-200"
                >
                  {s}
                </button>
              ))}
            </div>

            <HeroStats />

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {!user && (
                <>
                  <Button
                    size="lg"
                    onClick={() => setView('browse')}
                    className="h-12 bg-gradient-to-r from-blue-600 to-sky-600 px-8 text-base font-semibold text-white shadow-lg hover:from-blue-700 hover:to-sky-700"
                  >
                    🎯 Find your dream job
                  </Button>
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => setAuthOpen(true)}
                    className="h-12 border-2 border-slate-800 px-8 dark:border-slate-600 text-base font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-900 hover:text-white dark:hover:bg-slate-800"
                  >
                    I&apos;m hiring →
                  </Button>
                </>
              )}
              {user?.role === 'RECRUITER' && (
                <Button
                  size="lg"
                  onClick={() => setView('recruiter')}
                  className="h-12 bg-gradient-to-r from-blue-600 to-sky-600 px-8 text-base font-semibold text-white shadow-lg hover:from-blue-700 hover:to-sky-700"
                >
                  Open Hiring Hub →
                </Button>
              )}
              {user?.role === 'CANDIDATE' && (
                <Button
                  size="lg"
                  onClick={() => setView('candidate')}
                  className="h-12 bg-gradient-to-r from-blue-600 to-sky-600 px-8 text-base font-semibold text-white shadow-lg hover:from-blue-700 hover:to-sky-700"
                >
                  Track my applications →
                </Button>
              )}
              {user?.role === 'CLIENT' && (
                <Button
                  size="lg"
                  onClick={() => setView('client')}
                  className="h-12 bg-gradient-to-r from-blue-600 to-sky-600 px-8 text-base font-semibold text-white shadow-lg hover:from-blue-700 hover:to-sky-700"
                >
                  🤝 Review shared reports →
                </Button>
              )}
              {!user && (
                <button
                  type="button"
                  onClick={() => setAuthOpen(true)}
                  className="inline-flex h-12 items-center rounded-xl px-4 text-sm font-semibold text-blue-700 dark:text-blue-300 underline-offset-4 transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:text-blue-800 dark:hover:text-blue-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  Client partner? Review your reports →
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section className="border-y border-slate-100 dark:border-slate-800/60 bg-card" aria-labelledby="how-heading">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
          <div className="mb-10 text-center">
            <h2 id="how-heading" className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
              How SeeWe works
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500 dark:text-slate-400">
              The complete recruitment funnel — now with an AI interviewer doing the heavy lifting between
              shortlist and decision.
            </p>
          </div>
          <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {PIPELINE.map(({ icon: Icon, step, title, desc, color }) => (
              <li key={step}>
                <div className="group relative flex h-full flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-card p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md">
                  <span className="absolute right-4 top-4 text-4xl font-black text-slate-100 transition-colors group-hover:text-blue-100 dark:text-slate-800 dark:group-hover:text-blue-800/40">
                    {step}
                  </span>
                  <div className={`mb-4 flex h-11 w-11 items-center justify-center rounded-xl ${color}`}>
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mb-1.5 font-bold text-slate-900 dark:text-slate-100">{title}</h3>
                  <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- AI INTERVIEW SHOWCASE ---------- */}
      <section aria-labelledby="ai-heading" className="overflow-hidden bg-slate-950">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div className="flex flex-col justify-center">
            <Badge className="mb-4 w-fit rounded-full border border-blue-500/30 bg-blue-50 dark:bg-blue-950/400/10 px-3 py-1 text-xs font-semibold text-blue-400">
              <Bot className="mr-1.5 h-3.5 w-3.5" /> MEET SEEWE AI INTERVIEWER
            </Badge>
            <h2 id="ai-heading" className="text-balance text-3xl font-black tracking-tight text-white sm:text-4xl">
              Shortlisted? An AI takes it from here.
            </h2>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-300">
              The recruiter sets the questions (or asks AI to draft them from the JD), then the AI
              conducts a spoken video interview — voice playback, mic answers transcribed live.
              Every answer is scored instantly across technical depth, communication, problem
              solving and domain knowledge.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Recruiter-authored or AI-suggested questions grounded in the JD',
                'Voice-first: AI speaks each question, candidate answers by mic or keyboard',
                'Instant per-answer feedback and a 0–10 score with a final hire verdict',
                'Rating dossier shared directly with the recruiter\'s client',
              ].map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm text-slate-200">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950/400/15">
                    <TrendingUp className="h-3 w-3 text-blue-400" />
                  </span>
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* Mock interview UI — static marketing illustration (numbers are
              decorative; the real pipeline grades real transcripts — see the
              AI Report inside the app). */}
          <div className="relative mx-auto w-full max-w-md" aria-hidden>
            <div className="rotate-1 rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl">
              <p className="mb-3 w-fit rounded-full border border-slate-700 bg-slate-800/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Demo illustration
              </p>
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-sky-500 ring-2 ring-blue-500/40 ring-offset-2 ring-offset-slate-900">
                    <Bot className="h-5 w-5 text-slate-900" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">SeeWe AI · React Interviewer</p>
                    <p className="flex items-center gap-1 text-[11px] text-blue-400">
                      <Globe className="h-3 w-3" /> speaking…
                    </p>
                  </div>
                </div>
                <div className="flex items-end gap-0.5">
                  {[3, 6, 9, 5, 7].map((h, i) => (
                    <span
                      key={i}
                      style={{ height: `${h * 3}px` }}
                      className="w-1 animate-pulse rounded bg-blue-400"
                    />
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-slate-800 p-4 text-sm leading-relaxed text-slate-200">
                &ldquo;You built a payments dashboard at ZetaPay. Walk me through how you
                handled state management at scale with React.&rdquo;
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="secondary" className="rounded-full bg-slate-800 text-[11px] text-blue-300">
                  Focus: State architecture
                </Badge>
                <Badge variant="secondary" className="rounded-full bg-slate-800 text-[11px] text-sky-300">
                  Q3 / 6
                </Badge>
              </div>
              <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/60 p-3">
                <div className="flex items-center gap-2">
                  <Mic className="h-4 w-4 text-slate-400" />
                  <span className="text-xs text-slate-400">Listening… answer by voice or type</span>
                </div>
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/90 shadow-lg shadow-rose-500/20">
                  <Mic className="h-4 w-4 text-white" />
                </div>
              </div>
            </div>
            {/* Score card peek */}
            <div className="-mt-4 -rotate-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-card p-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-slate-400 dark:text-slate-500">Instant evaluation</p>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Answer scored ✓</p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-blue-500 bg-blue-50 dark:bg-blue-950/40">
                  <span className="text-sm font-black text-blue-700 dark:text-blue-300">8.4</span>
                </div>
              </div>
              <div className="mt-2 space-y-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className="h-full w-[84%] rounded-full bg-gradient-to-r from-blue-500 to-sky-500" />
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">Technical depth strong — add metrics to examples.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Testimonials />

      <FeaturedJobs />
    </div>
  )
}

const TESTIMONIALS = [
  {
    quote:
      'SeeWe AI screened 40 candidates for our senior React role in two days. The rating reports were so precise that our client hired from the first shortlist.',
    name: 'Ananya Sharma',
    role: 'Talent Partner · TechNova Solutions',
    initials: 'AS',
    tone: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    stars: 5,
  },
  {
    quote:
      'The AI interview felt surprisingly human — it asked about my actual projects, not textbook trivia. I got scored feedback the same evening.',
    name: 'Arjun Mehta',
    role: 'Frontend Engineer · Candidate',
    initials: 'AM',
    tone: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
    stars: 5,
  },
  {
    quote:
      'As a client, receiving structured AI interview dossiers instead of raw resumes changed everything. Decisions that took weeks now take hours.',
    name: 'Rohit Kulkarni',
    role: 'Engineering Head · Flipkart (client)',
    initials: 'RK',
    tone: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    stars: 4,
  },
]

function Testimonials() {
  return (
    <section aria-labelledby="testimonials-heading" className="bg-card">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6">
        <div className="mb-10 text-center">
          <Badge variant="outline" className="mb-3 rounded-full border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/40 px-3 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
            Loved by all three sides
          </Badge>
          <h2 id="testimonials-heading" className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
            Recruiters, candidates & clients 💙 SeeWe
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-slate-500 dark:text-slate-400">
            One platform where hiring teams, job seekers and client companies all win.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (
            <figure
              key={t.name}
              className="flex h-full flex-col rounded-2xl border border-slate-200 dark:border-slate-800 bg-gradient-to-b from-white to-slate-50/60 dark:from-slate-900 dark:to-slate-900/60 p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
            >
              <div className="mb-3 flex gap-0.5" aria-label={`${t.stars} out of 5 stars`}>
                {[...Array(5)].map((_, i) => (
                  <Star
                    key={i}
                    className={`h-4 w-4 ${i < t.stars ? 'fill-amber-400 text-amber-400' : 'text-slate-200 dark:text-slate-700'}`}
                    aria-hidden
                  />
                ))}
              </div>
              <blockquote className="flex-1 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                &ldquo;{t.quote}&rdquo;
              </blockquote>
              <figcaption className="mt-5 flex items-center gap-3 border-t border-slate-100 dark:border-slate-800/60 pt-4">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${t.tone}`}
                  aria-hidden
                >
                  {t.initials}
                </span>
                <div>
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{t.role}</p>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}
