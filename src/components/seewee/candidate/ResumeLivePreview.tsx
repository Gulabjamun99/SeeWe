'use client'

/**
 * ResumeLivePreview — RIGHT column of the AI Resume Builder.
 *
 * Renders the candidate's draft as an A4-proportioned white "sheet" in real
 * time (every keystroke in the editor re-renders it). The sheet is styled for
 * PAPER, not the app: hardcoded ink-on-white colors so the dark theme never
 * bleeds into the document and `window.print()` produces a clean PDF.
 *
 * PRINT: the embedded @media print block hides everything except the sheet
 * (visibility trick), pins it to the page origin at full width and strips
 * shadows/aspect-ratio so Ctrl+P / the Download-PDF button yields a clean,
 * multi-page-safe PDF. @page margin is left to the sheet's own padding.
 */

import type {
  ResumeBasics,
  ResumeEducationItem,
  ResumeExperienceItem,
  ResumeProjectItem,
} from '@/lib/types'

/** Editor-side basics extend the shared type with the free-text summary */
export type ResumeBasicsWithSummary = ResumeBasics & { summary?: string }

export interface ResumePreviewDraft {
  title?: string
  basics: ResumeBasicsWithSummary
  experience: ResumeExperienceItem[]
  education: ResumeEducationItem[]
  skills: string[]
  projects: ResumeProjectItem[]
}

function contactPieces(basics: ResumeBasicsWithSummary): string[] {
  const links = basics.links ?? {}
  return [
    basics.email,
    basics.phone,
    basics.location,
    links.linkedin,
    links.github,
    links.portfolio,
  ]
    .map((s) => (s ?? '').trim())
    .filter(Boolean)
}

/** Section title with the classic resume "rule line" accent */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 mb-2 flex items-center gap-2.5 first:mt-0" aria-hidden={false}>
      <h3 className="font-serif text-[11px] font-bold uppercase tracking-[0.16em] text-slate-900">
        {children}
      </h3>
      <span className="h-px flex-1 bg-slate-300" aria-hidden />
    </div>
  )
}

/** Date range chip used by experience/education rows */
function DateRange({ start, end }: { start?: string; end?: string }) {
  const s = (start ?? '').trim()
  const e = (end ?? '').trim()
  if (!s && !e) return null
  return (
    <span className="shrink-0 font-medium tabular-nums text-slate-500">
      {[s, e].filter(Boolean).join(' — ')}
    </span>
  )
}

export function ResumeLivePreview({ draft }: { draft: ResumePreviewDraft }) {
  const basics = draft.basics ?? {}
  const experience = draft.experience ?? []
  const education = draft.education ?? []
  const projects = draft.projects ?? []
  const skills = draft.skills ?? []
  const contact = contactPieces(basics)
  const name = (basics.fullName ?? '').trim()
  const headline = (basics.headline ?? '').trim()
  const summary = (basics.summary ?? '').trim()

  const hasAnyContent =
    Boolean(name || headline || contact.length) ||
    Boolean(summary) ||
    experience.length > 0 ||
    education.length > 0 ||
    projects.length > 0 ||
    skills.length > 0

  return (
    <>
      {/* PRINT-ONLY stylesheet — hides the whole app except the resume sheet */}
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          html, body { background: #fff !important; overflow: visible !important; }
          body * { visibility: hidden; transform: none !important; box-shadow: none !important; }
          #resume-print-sheet, #resume-print-sheet * { visibility: visible !important; }
          #resume-print-sheet {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            aspect-ratio: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            margin: 0 !important;
            overflow: visible !important;
          }
        }
      `}</style>

      <div
        id="resume-print-sheet"
        role="document"
        aria-label="Live resume preview"
        className="relative aspect-[210/297] w-full overflow-hidden rounded-md border border-slate-200 bg-white px-8 py-9 text-slate-800 shadow-[0_10px_40px_-12px_rgba(15,23,42,0.25)] sm:px-10 sm:py-11"
      >
        {/* subtle top accent bar */}
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-slate-800 via-slate-600 to-slate-400" aria-hidden />

        {!hasAnyContent ? (
          <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 text-center">
            <span className="font-serif text-sm italic text-slate-300">
              Your resume appears here as you type
            </span>
            <span className="text-[11px] text-slate-300">
              Fill the Basics section to get started
            </span>
          </div>
        ) : (
          <div className="font-sans leading-relaxed">
            {/* ---------- NAME HEADER ---------- */}
            <header className="border-b-2 border-slate-800 pb-3">
              <h1 className="font-serif text-[22px] font-bold leading-tight tracking-wide text-slate-900 sm:text-[26px]">
                {name || 'Your Name'}
              </h1>
              {headline && (
                <p className="mt-0.5 text-[12px] font-medium uppercase tracking-[0.12em] text-slate-600">
                  {headline}
                </p>
              )}
              {contact.length > 0 && (
                <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px] text-slate-600">
                  {contact.map((piece, i) => (
                    <span key={`${piece}-${i}`} className="inline-flex items-center gap-1.5">
                      {i > 0 && <span className="text-slate-300" aria-hidden>•</span>}
                      <span className="max-w-[220px] truncate">{piece}</span>
                    </span>
                  ))}
                </p>
              )}
            </header>

            {/* ---------- SUMMARY ---------- */}
            {summary && (
              <section aria-label="Professional summary">
                <SectionTitle>Summary</SectionTitle>
                <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-slate-700">
                  {summary}
                </p>
              </section>
            )}

            {/* ---------- EXPERIENCE ---------- */}
            {experience.length > 0 && (
              <section aria-label="Experience">
                <SectionTitle>Experience</SectionTitle>
                <div className="space-y-3.5">
                  {experience.map((exp, i) => {
                    const bullets = (exp.bullets ?? []).filter((b) => (b ?? '').trim())
                    return (
                      <article key={i}>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <p className="text-[12.5px] font-bold text-slate-900">
                            {exp.role?.trim() || 'Role'}
                            {exp.company?.trim() && (
                              <span className="font-semibold text-slate-600"> · {exp.company.trim()}</span>
                            )}
                          </p>
                          <DateRange start={exp.start} end={exp.end} />
                        </div>
                        {bullets.length > 0 && (
                          <ul className="mt-1 space-y-1">
                            {bullets.map((b, bi) => (
                              <li
                                key={bi}
                                className="flex gap-2 text-[11.5px] leading-snug text-slate-700"
                              >
                                <span className="mt-[5px] size-1 shrink-0 rounded-full bg-slate-500" aria-hidden />
                                <span className="whitespace-pre-wrap">{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            )}

            {/* ---------- PROJECTS ---------- */}
            {projects.length > 0 && (
              <section aria-label="Projects">
                <SectionTitle>Projects</SectionTitle>
                <div className="space-y-3">
                  {projects.map((p, i) => {
                    const bullets = (p.bullets ?? []).filter((b) => (b ?? '').trim())
                    return (
                      <article key={i}>
                        <p className="text-[12px] font-bold text-slate-900">
                          {p.name?.trim() || 'Project'}
                          {p.link?.trim() && (
                            <span className="ml-2 text-[10px] font-medium text-slate-500">{p.link.trim()}</span>
                          )}
                        </p>
                        {p.description?.trim() && (
                          <p className="mt-0.5 whitespace-pre-wrap text-[11.5px] leading-snug text-slate-700">
                            {p.description.trim()}
                          </p>
                        )}
                        {bullets.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {bullets.map((b, bi) => (
                              <li key={bi} className="flex gap-2 text-[11.5px] leading-snug text-slate-700">
                                <span className="mt-[5px] size-1 shrink-0 rounded-full bg-slate-500" aria-hidden />
                                <span className="whitespace-pre-wrap">{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            )}

            {/* ---------- SKILLS ---------- */}
            {skills.length > 0 && (
              <section aria-label="Skills">
                <SectionTitle>Skills</SectionTitle>
                <p className="text-[11.5px] leading-relaxed text-slate-700">
                  {skills.join('  ·  ')}
                </p>
              </section>
            )}

            {/* ---------- EDUCATION ---------- */}
            {education.length > 0 && (
              <section aria-label="Education">
                <SectionTitle>Education</SectionTitle>
                <div className="space-y-2">
                  {education.map((ed, i) => (
                    <article key={i} className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="text-[12px] font-bold text-slate-900">
                        {ed.degree?.trim() || 'Degree'}
                        {ed.school?.trim() && (
                          <span className="font-semibold text-slate-600"> · {ed.school.trim()}</span>
                        )}
                      </p>
                      <DateRange start={ed.start} end={ed.end} />
                      {ed.detail?.trim() && (
                        <p className="w-full text-[11px] text-slate-600">{ed.detail.trim()}</p>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </>
  )
}
