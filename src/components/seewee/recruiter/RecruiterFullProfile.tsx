'use client'

/**
 * RecruiterFullProfile — recruiter-facing full candidate profile dialog.
 *
 * Full-profile view: photo, verification badges, contact + portfolio links,
 * skills, multi-company employment history, education, key projects,
 * certifications, desired job, profile summary and the candidate's CV
 * (active version + full version history with downloads).
 *
 * Data source: GET /api/candidates/[id]?viewerId=<recruiterId> — the API layer
 * already enforces the privacy shield (currentEmployer is never returned to
 * recruiters; only applications in recruiter-visible states are included), so
 * this component renders exactly what the server allows — nothing more.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Award,
  BadgeCheck,
  Briefcase,
  Building2,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Github,
  GraduationCap,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Smartphone,
  Sparkles,
  Target,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import type { User } from '@/lib/types'

/* ------------------------------ section types ----------------------------- */

interface WorkExperience {
  id: string
  title: string
  company: string
  isCurrent: boolean
  startDate: string
  endDate: string | null
  location?: string | null
  description?: string | null
}

interface UserProject {
  id: string
  title: string
  techStack?: string | null
  startDate?: string | null
  endDate?: string | null
  description?: string | null
  link?: string | null
}

interface EducationEntry {
  id: string
  degree: string
  institution: string
  startYear?: string | null
  endYear?: string | null
  score?: string | null
}

interface Certification {
  id: string
  name: string
  issuer?: string | null
  year?: string | null
  link?: string | null
}

interface ResumeVersionMeta {
  id: string
  label: string
  fileName: string
  mimeType: string
  sizeBytes: number
  isActive: boolean
  note?: string | null
  createdAt: string
}

interface Sections {
  experiences: WorkExperience[]
  projects: UserProject[]
  education: EducationEntry[]
  certifications: Certification[]
}

type FullProfile = User & {
  sections?: Sections
  applications?: Array<{ id: string; status?: string; job?: { title?: string } | null }>
}

/* ------------------------------- helpers ---------------------------------- */

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function fmtYM(ym: string | null | undefined): string {
  if (!ym) return ''
  const [y, m] = ym.split('-').map(Number)
  if (!y || !m) return ym
  const month = new Date(y, m - 1, 1).toLocaleString('en-IN', { month: 'short' })
  return `${month} ${y}`
}

/** "4 yrs 4 mos" style duration (mirrors the candidate-side profile). */
function duration(start: string, end: string | null, isCurrent: boolean): string {
  if (!start) return ''
  const [sy, sm] = start.split('-').map(Number)
  let ey: number, em: number
  if (isCurrent || !end) {
    const now = new Date()
    ey = now.getFullYear()
    em = now.getMonth() + 1
  } else {
    const parts = end.split('-').map(Number)
    ey = parts[0]
    em = parts[1]
  }
  const months = Math.max(0, (ey - sy) * 12 + (em - sm))
  const yrs = Math.floor(months / 12)
  const mos = months % 12
  const bits: string[] = []
  if (yrs) bits.push(`${yrs} yr${yrs > 1 ? 's' : ''}`)
  if (mos) bits.push(`${mos} mo${mos > 1 ? 's' : ''}`)
  return bits.join(' ') || '<1 mo'
}

function humanSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function splitSkills(skills?: string | null): string[] {
  if (!skills) return []
  return skills
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/* ------------------------------ section shell ----------------------------- */

function SectionCard({
  icon,
  title,
  count,
  children,
}: {
  icon: React.ReactNode
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white/60 p-4 dark:border-slate-800 dark:bg-slate-950/40">
      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
        {icon}
        {title}
        {typeof count === 'number' && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {count}
          </span>
        )}
      </h4>
      {children}
    </section>
  )
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-xs italic text-muted-foreground">{text}</p>
}

/* ------------------------------ main component ---------------------------- */

export function RecruiterFullProfile({
  candidateId,
  candidateName,
  viewerId,
  open,
  onOpenChange,
}: {
  candidateId: string
  /** optional display name while the detail fetch is in flight */
  candidateName?: string
  /** the recruiter's own user id (passed through as viewerId for server-side privacy scoping) */
  viewerId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [profile, setProfile] = useState<FullProfile | null>(null)
  const [versions, setVersions] = useState<ResumeVersionMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Contact reveal (privacy): the API masks email/phone for recruiter reads;
  // the real values unlock through the logged + quota-tracked endpoint.
  const [revealed, setRevealed] = useState<{ email: string; phone: string | null } | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [revealFailed, setRevealFailed] = useState(false)

  const isMasked = (v?: string | null): boolean => !!v && v.includes('•')

  const revealContact = useCallback(async () => {
    if (!viewerId || revealing) return
    setRevealing(true)
    try {
      const res = await fetch(`/api/candidates/${encodeURIComponent(candidateId)}/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId: viewerId }),
      })
      const json = (await res.json()) as { data?: { email: string; phone: string | null }; error?: string }
      if (!res.ok || json.error || !json.data) throw new Error(json.error ?? 'Could not reveal contact')
      setRevealed({ email: json.data.email, phone: json.data.phone })
    } catch {
      setRevealFailed(true)
    } finally {
      setRevealing(false)
    }
  }, [candidateId, viewerId, revealing])

  const load = useCallback(async () => {
    if (!candidateId) return
    setLoading(true)
    setError(null)
    setProfile(null)
    setVersions([])
    setRevealed(null)
    setRevealFailed(false)
    try {
      const sp = new URLSearchParams()
      if (viewerId) sp.set('viewerId', viewerId)
      const [profileRes, versionsRes] = await Promise.all([
        fetch(`/api/candidates/${encodeURIComponent(candidateId)}?${sp.toString()}`),
        fetch(`/api/candidates/${encodeURIComponent(candidateId)}/resume-versions`).catch(
          () => null
        ),
      ])
      const profileJson = (await profileRes.json()) as { data?: FullProfile; error?: string }
      if (!profileRes.ok || !profileJson.data) {
        throw new Error(profileJson.error ?? 'Could not load this profile')
      }
      setProfile(profileJson.data)
      if (versionsRes && versionsRes.ok) {
        const versionsJson = (await versionsRes.json()) as { data?: ResumeVersionMeta[] }
        setVersions(Array.isArray(versionsJson.data) ? versionsJson.data : [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this profile')
    } finally {
      setLoading(false)
    }
  }, [candidateId, viewerId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const sections = profile?.sections
  const skills = splitSkills(profile?.skills)
  const activeCv = versions.find((v) => v.isActive) ?? versions[0] ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto rounded-2xl [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6 text-base">
            <Eye className="size-4 text-blue-600" aria-hidden />
            Candidate profile — {profile?.name ?? candidateName ?? '…'}
          </DialogTitle>
          <DialogDescription>
            Full profile as submitted by the candidate — contact details, work
            history, education, projects, skills and CV.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="space-y-4 py-2" role="status" aria-label="Loading profile">
            <div className="flex items-center gap-4">
              <Skeleton className="size-16 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-40" />
              </div>
            </div>
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        )}

        {!loading && error && (
          <div
            role="alert"
            className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
          >
            {error}
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-8"
              onClick={() => void load()}
            >
              Try again
            </Button>
          </div>
        )}

        {!loading && profile && (
          <div className="space-y-4">
            {/* ------------------------------ header ------------------------------ */}
            <div className="flex flex-wrap items-start gap-4 rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50/70 to-sky-50/40 p-4 dark:border-blue-900/50 dark:from-blue-950/30 dark:to-sky-950/20">
              <Avatar className="size-16 border-2 border-white shadow dark:border-slate-800">
                {profile.photoMime ? (
                  <AvatarImage
                    src={`/api/candidates/${encodeURIComponent(profile.id)}/photo`}
                    alt={`${profile.name} profile photo`}
                  />
                ) : null}
                <AvatarFallback className="bg-gradient-to-br from-blue-500 to-sky-400 text-lg font-bold text-white">
                  {initialsOf(profile.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-base font-bold text-slate-900 dark:text-slate-50">
                  {profile.name}
                  {profile.emailVerified && (
                    <span
                      title="Email verified"
                      aria-label="Email verified"
                      className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                    >
                      <BadgeCheck className="size-3" aria-hidden /> Email ✓
                    </span>
                  )}
                  {profile.phoneVerified && (
                    <span
                      title="Mobile number verified via OTP"
                      aria-label="Mobile verified"
                      className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300"
                    >
                      <Smartphone className="size-3" aria-hidden /> Mobile ✓
                    </span>
                  )}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {profile.headline || '—'}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {profile.location && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3" aria-hidden /> {profile.location}
                    </span>
                  )}
                  {typeof profile.experienceYears === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      <Briefcase className="size-3" aria-hidden /> {profile.experienceYears} yrs
                      experience
                    </span>
                  )}
                  {typeof profile.expectedSalary === 'number' && (
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="size-3" aria-hidden /> Expected ₹
                      {profile.expectedSalary} LPA
                    </span>
                  )}
                  {profile.noticePeriodDays != null && (
                    <span className="inline-flex items-center gap-1">
                      <FolderOpen className="size-3" aria-hidden />
                      {profile.noticePeriodDays === 0
                        ? 'Immediate joiner'
                        : `Serves ${profile.noticePeriodDays} days notice`}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* ------------------------- contact + links -------------------------- */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-800 dark:bg-slate-900">
                <Mail className="size-3 shrink-0 text-slate-400" aria-hidden />
                <span className="truncate">{revealed?.email || profile.email}</span>
              </span>
              {(revealed?.phone || profile.phone) && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 dark:border-slate-800 dark:bg-slate-900">
                  <Phone className="size-3 shrink-0 text-slate-400" aria-hidden />
                  {revealed?.phone || profile.phone}
                </span>
              )}
              {isMasked(profile.email) && !revealed && (
                <button
                  type="button"
                  onClick={revealContact}
                  disabled={revealing || revealFailed || !viewerId}
                  title={revealFailed ? 'Reveal failed — try again later or check your daily quota' : 'Reveal real contact details (logged + quota-tracked)'}
                  className="inline-flex items-center gap-1 rounded-full bg-teal-600 px-2.5 py-1 font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
                >
                  {revealing ? <Loader2 className="size-3 animate-spin" aria-hidden /> : <Eye className="size-3" aria-hidden />}
                  Reveal contact
                </button>
              )}
              {profile.githubUrl && (
                <a
                  href={profile.githubUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <Github className="size-3 shrink-0 text-slate-400" aria-hidden /> GitHub
                </a>
              )}
              {profile.linkedinUrl && (
                <a
                  href={profile.linkedinUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <Link2 className="size-3 shrink-0 text-slate-400" aria-hidden /> LinkedIn
                </a>
              )}
              {profile.portfolioUrl && (
                <a
                  href={profile.portfolioUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <Link2 className="size-3 shrink-0 text-slate-400" aria-hidden /> Portfolio
                </a>
              )}
            </div>

            {/* ----------------------------- skills ------------------------------ */}
            {skills.length > 0 && (
              <SectionCard icon={<Sparkles className="size-4 text-blue-500" aria-hidden />} title="Key skills" count={skills.length}>
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s) => (
                    <Badge
                      key={s}
                      variant="secondary"
                      className="rounded-full bg-blue-50 text-[11px] font-medium text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                    >
                      {s}
                    </Badge>
                  ))}
                </div>
              </SectionCard>
            )}

            {/* ------------------------ employment history ------------------------ */}
            <SectionCard
              icon={<Building2 className="size-4 text-blue-500" aria-hidden />}
              title="Employment history"
              count={sections?.experiences.length ?? 0}
            >
              {(sections?.experiences.length ?? 0) === 0 ? (
                <EmptyHint text="Candidate hasn't added employment history yet." />
              ) : (
                <ol className="space-y-3">
                  {sections!.experiences.map((exp) => (
                    <li
                      key={exp.id}
                      className="flex gap-3 rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-600 to-slate-400 text-sm font-bold text-white">
                        {exp.company[0]?.toUpperCase() ?? '?'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                          <span className="truncate">{exp.title}</span>
                          {exp.isCurrent && (
                            <Badge className="rounded-full bg-emerald-100 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                              Current
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {exp.company}
                          {exp.location ? ` · ${exp.location}` : ''} · {fmtYM(exp.startDate)} —{' '}
                          {exp.isCurrent ? 'Present' : fmtYM(exp.endDate)}
                          {duration(exp.startDate, exp.endDate, exp.isCurrent) &&
                            ` · ${duration(exp.startDate, exp.endDate, exp.isCurrent)}`}
                        </p>
                        {exp.description && (
                          <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                            {exp.description}
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </SectionCard>

            {/* ---------------------------- education ----------------------------- */}
            <SectionCard
              icon={<GraduationCap className="size-4 text-blue-500" aria-hidden />}
              title="Education"
              count={sections?.education.length ?? 0}
            >
              {(sections?.education.length ?? 0) === 0 ? (
                <EmptyHint text="No education entries added." />
              ) : (
                <ul className="space-y-2">
                  {sections!.education.map((ed) => (
                    <li
                      key={ed.id}
                      className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60"
                    >
                      <p className="text-sm font-semibold">{ed.degree}</p>
                      <p className="text-xs text-muted-foreground">
                        {ed.institution}
                        {ed.startYear || ed.endYear
                          ? ` · ${ed.startYear ?? '?'} — ${ed.endYear ?? '?'}`
                          : ''}
                        {ed.score ? ` · ${ed.score}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {/* ----------------------------- projects ----------------------------- */}
            <SectionCard
              icon={<FileText className="size-4 text-blue-500" aria-hidden />}
              title="Key projects"
              count={sections?.projects.length ?? 0}
            >
              {(sections?.projects.length ?? 0) === 0 ? (
                <EmptyHint text="No projects added." />
              ) : (
                <ul className="space-y-2">
                  {sections!.projects.map((pr) => (
                    <li
                      key={pr.id}
                      className="rounded-lg border border-slate-100 bg-white p-3 dark:border-slate-800 dark:bg-slate-900/60"
                    >
                      <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                        {pr.title}
                        {pr.link && (
                          <a
                            href={pr.link}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="text-[11px] font-medium text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                          >
                            View link ↗
                          </a>
                        )}
                      </p>
                      {pr.description && (
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                          {pr.description}
                        </p>
                      )}
                      {pr.techStack && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {pr.techStack
                            .split(',')
                            .map((t) => t.trim())
                            .filter(Boolean)
                            .map((t) => (
                              <Badge
                                key={t}
                                variant="outline"
                                className="rounded-full px-1.5 py-0 text-[10px] text-slate-500"
                              >
                                {t}
                              </Badge>
                            ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {/* --------------------------- certifications -------------------------- */}
            <SectionCard
              icon={<Award className="size-4 text-blue-500" aria-hidden />}
              title="Certifications"
              count={sections?.certifications.length ?? 0}
            >
              {(sections?.certifications.length ?? 0) === 0 ? (
                <EmptyHint text="No certifications added." />
              ) : (
                <ul className="space-y-1.5">
                  {sections!.certifications.map((cert) => (
                    <li
                      key={cert.id}
                      className="flex flex-wrap items-center gap-1.5 text-sm"
                    >
                      <BadgeCheck className="size-3.5 shrink-0 text-emerald-500" aria-hidden />
                      <span className="font-medium">{cert.name}</span>
                      {cert.issuer && (
                        <span className="text-xs text-muted-foreground">· {cert.issuer}</span>
                      )}
                      {cert.year && (
                        <span className="text-xs text-muted-foreground">({cert.year})</span>
                      )}
                      {cert.link && (
                        <a
                          href={cert.link}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[11px] text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
                        >
                          Credential ↗
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>

            {/* --------------------------- desired job ---------------------------- */}
            {(profile.desiredRole ||
              profile.desiredLocations ||
              profile.desiredJobType ||
              profile.desiredIndustry) && (
              <SectionCard icon={<Target className="size-4 text-blue-500" aria-hidden />} title="Desired job">
                <div className="grid gap-1.5 text-xs sm:grid-cols-2">
                  {profile.desiredRole && (
                    <p>
                      <span className="font-semibold">Role:</span> {profile.desiredRole}
                    </p>
                  )}
                  {profile.desiredJobType && (
                    <p>
                      <span className="font-semibold">Type:</span> {profile.desiredJobType}
                    </p>
                  )}
                  {profile.desiredLocations && (
                    <p>
                      <span className="font-semibold">Locations:</span> {profile.desiredLocations}
                    </p>
                  )}
                  {profile.desiredIndustry && (
                    <p>
                      <span className="font-semibold">Industry:</span> {profile.desiredIndustry}
                    </p>
                  )}
                </div>
              </SectionCard>
            )}

            {/* ------------------------- profile summary -------------------------- */}
            {profile.resumeText && (
              <SectionCard icon={<FileText className="size-4 text-blue-500" aria-hidden />} title="Profile summary">
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-slate-600 [scrollbar-width:thin] dark:text-slate-300 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300">
                  {profile.resumeText}
                </p>
              </SectionCard>
            )}

            {/* ------------------------------- CVs -------------------------------- */}
            <SectionCard
              icon={<FolderOpen className="size-4 text-blue-500" aria-hidden />}
              title="CV / Resume"
              count={versions.length}
            >
              {!activeCv && !profile.cvFileName ? (
                <EmptyHint text="No CV attached to this profile yet." />
              ) : (
                <div className="space-y-2">
                  {activeCv && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 p-2.5 dark:border-blue-900/50 dark:bg-blue-950/30">
                      <FileText className="size-4 shrink-0 text-blue-500" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold">
                          {activeCv.label || activeCv.fileName}
                          {activeCv.isActive && (
                            <span className="ml-1.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                              Active
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {activeCv.fileName} · {humanSize(activeCv.sizeBytes)}
                        </p>
                      </div>
                      <Button asChild size="sm" variant="outline" className="h-8 rounded-lg">
                        <a
                          href={`/api/candidates/${encodeURIComponent(candidateId)}/resume-versions/${activeCv.id}/download`}
                          aria-label={`Download CV ${activeCv.fileName}`}
                        >
                          <Download className="size-3.5" aria-hidden /> Download
                        </a>
                      </Button>
                    </div>
                  )}
                  {!activeCv && profile.cvFileName && (
                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-100 bg-blue-50/60 p-2.5 dark:border-blue-900/50 dark:bg-blue-950/30">
                      <FileText className="size-4 shrink-0 text-blue-500" aria-hidden />
                      <p className="min-w-0 flex-1 truncate text-xs font-semibold">
                        {profile.cvFileName}
                      </p>
                      <Button asChild size="sm" variant="outline" className="h-8 rounded-lg">
                        <a
                          href={`/api/candidates/${encodeURIComponent(candidateId)}/cv`}
                          aria-label={`Download CV ${profile.cvFileName}`}
                        >
                          <Download className="size-3.5" aria-hidden /> Download
                        </a>
                      </Button>
                    </div>
                  )}
                  {versions.length > 1 && (
                    <details className="rounded-lg border border-slate-100 dark:border-slate-800">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
                        Older versions ({versions.length - 1})
                      </summary>
                      <ul className="space-y-1.5 px-3 pb-2.5">
                        {versions
                          .filter((v) => v.id !== activeCv?.id)
                          .map((v) => (
                            <li
                              key={v.id}
                              className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300"
                            >
                              <FileText className="size-3 shrink-0 text-slate-400" aria-hidden />
                              <span className="min-w-0 flex-1 truncate">
                                {v.label || v.fileName}{' '}
                                <span className="text-[10px] text-muted-foreground">
                                  · {humanSize(v.sizeBytes)}
                                </span>
                              </span>
                              <a
                                href={`/api/candidates/${encodeURIComponent(candidateId)}/resume-versions/${v.id}/download`}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                                aria-label={`Download ${v.fileName}`}
                              >
                                <Download className="size-3" aria-hidden /> Get
                              </a>
                            </li>
                          ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </SectionCard>

            <Separator />

            <p className="pb-1 text-center text-[10px] leading-relaxed text-muted-foreground">
              Candidate&apos;s current employer is kept private by SeeWe. AI evaluation notes are
              visible only in the Applicants workspace, never on the candidate profile.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
