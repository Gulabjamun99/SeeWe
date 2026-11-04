'use client'

/**
 * SkillSuggestions — domain-aware skill chips for the job form.
 *
 * The app hires across EVERY domain, so the suggestion strip is not a fixed
 * IT list. As the recruiter types the job title, `detectSkillDomain` scores
 * all 14 domains and the matching one's skills surface automatically
 * ("Staff Nurse" → Patient Care…, "Accountant" → Tally, GST Filing…).
 * The recruiter can always pin a domain manually or fall back to Auto.
 */

import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { SKILL_DOMAINS, detectSkillDomain } from '@/lib/skill-library'

interface SkillSuggestionsProps {
  /** current job title — drives auto-matching (weighted double) */
  title: string
  /** current description text — extra detection signal */
  description: string
  /** add the tapped skill to the comma-separated skills input */
  onAdd: (skill: string) => void
}

export function SkillSuggestions({ title, description, onAdd }: SkillSuggestionsProps) {
  // null = Auto mode (follow the job title); otherwise a pinned domain id
  const [manualId, setManualId] = useState<string | null>(null)

  const detected = useMemo(
    () => detectSkillDomain(`${title} ${title} ${description}`),
    [title, description]
  )
  const activeId = manualId ?? detected?.id ?? 'general'
  const active = SKILL_DOMAINS.find((d) => d.id === activeId) ?? SKILL_DOMAINS[0]

  const hint = manualId
    ? `Showing ${active.emoji} ${active.label} skills — tap ✨ Auto to return to title-based matching.`
    : detected
      ? `✨ Auto-matched to ${detected.emoji} ${detected.label} from your job title — pick another domain if you prefer.`
      : 'Type the job title (e.g. Staff Nurse, Accountant, Sales Manager) and matching skills appear here — or pick a domain below.'

  return (
    <div className="space-y-2 pt-1">
      {/* domain picker */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Skill domain picker">
        <button
          type="button"
          onClick={() => setManualId(null)}
          aria-pressed={manualId === null}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            manualId === null
              ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
              : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
          }`}
        >
          <Sparkles className="size-3" aria-hidden /> Auto{detected ? `: ${detected.label}` : ''}
        </button>
        {SKILL_DOMAINS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setManualId(d.id)}
            aria-pressed={manualId === d.id}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
              manualId === d.id
                ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                : 'border-slate-200 bg-white text-slate-500 hover:border-blue-200 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
            }`}
          >
            {d.emoji} {d.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] leading-snug text-muted-foreground" aria-live="polite">{hint}</p>

      {/* skill chips for the active domain */}
      <div className="flex flex-wrap gap-1.5">
        {active.skills.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onAdd(s)}
            aria-label={`Add skill ${s}`}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs text-slate-600 dark:text-slate-400 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:bg-slate-900"
          >
            + {s}
          </button>
        ))}
      </div>
    </div>
  )
}
