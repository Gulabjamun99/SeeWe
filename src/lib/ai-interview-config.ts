// SeeWe - AI interview config validation
// Shared by POST /api/jobs and PATCH /api/jobs/[id]. The recruiter-authored
// question set is stored as a JSON string on Job.aiInterviewConfig; this module
// guarantees only sane, safe shapes ever reach the database.

export interface ParsedAiQuestion {
  id: string
  text: string
  type: 'VOICE' | 'TEXT' | 'VIDEO'
  timeLimitSec: number
}

export interface ParsedAiConfig {
  questions: ParsedAiQuestion[]
  includeProfileQuestions: boolean
}

export const AI_QUESTION_LIMIT = 20
export const AI_TIME_MIN = 30
export const AI_TIME_MAX = 600

/** Coerce/validate the client-provided AI interview config.
 *  Returns a normalized object, or null when the value is absent/empty. */
export function parseAiInterviewConfig(
  value: unknown
): { ok: true; config: ParsedAiConfig | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, config: null }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'aiInterviewConfig must be an object' }
  }
  const raw = value as Record<string, unknown>
  const rawQuestions = Array.isArray(raw.questions) ? raw.questions : []

  if (rawQuestions.length > AI_QUESTION_LIMIT) {
    return {
      ok: false,
      error: `aiInterviewConfig supports at most ${AI_QUESTION_LIMIT} questions`,
    }
  }

  const questions: ParsedAiQuestion[] = []
  for (let i = 0; i < rawQuestions.length; i++) {
    const item = rawQuestions[i] as Record<string, unknown>
    const text = typeof item?.text === 'string' ? item.text.trim() : ''
    if (!text) {
      return { ok: false, error: `Question ${i + 1}: text is required` }
    }
    if (text.length > 600) {
      return { ok: false, error: `Question ${i + 1}: text must be 600 characters or fewer` }
    }
    const type =
      item?.type === 'TEXT'
        ? 'TEXT'
        : item?.type === 'VIDEO'
          ? 'VIDEO'
          : item?.type === 'VOICE'
            ? 'VOICE'
            : null
    if (!type) {
      return { ok: false, error: `Question ${i + 1}: type must be VOICE, VIDEO or TEXT` }
    }
    const t = typeof item?.timeLimitSec === 'number' ? item.timeLimitSec : 0
    if (!Number.isFinite(t) || t < 0 || t > AI_TIME_MAX) {
      return {
        ok: false,
        error: `Question ${i + 1}: timeLimitSec must be between 0 (no limit) and ${AI_TIME_MAX}`,
      }
    }
    if (t > 0 && t < AI_TIME_MIN) {
      return { ok: false, error: `Question ${i + 1}: timeLimitSec must be at least ${AI_TIME_MIN}s` }
    }
    questions.push({
      id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim().slice(0, 40) : `q${i + 1}`,
      text,
      type,
      timeLimitSec: Math.round(t),
    })
  }

  return {
    ok: true,
    config: {
      questions,
      includeProfileQuestions: raw.includeProfileQuestions !== false,
    },
  }
}
