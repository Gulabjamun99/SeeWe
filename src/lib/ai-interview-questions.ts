// SeeWe - shared AI-interview question helpers
// Used by POST /api/interview/invite (creates the PENDING interview) and
// POST /api/interview/start (resumes it). The questions ALWAYS come from the
// recruiter-authored Job.aiInterviewConfig — the AI only suggests at design
// time and never invents the round at start time.

import type { AiInterviewConfig, InterviewQuestion } from '@/lib/types'

/** The 4 closing profile questions (location / experience / notice / CTC).
 *  Appended when the job config has includeProfileQuestions = true. They are
 *  always TEXT-type short answers so every candidate data point is captured
 *  uniformly. */
export function buildPreliminaryQuestions(startIndex: number): InterviewQuestion[] {
  const items: Array<{ question: string; focusArea: string }> = [
    {
      question: 'To wrap up, a few quick profile questions. Which city do you currently live in, and would you be open to relocating for this role?',
      focusArea: 'Candidate profile · Location & relocation',
    },
    {
      question: 'How many years of total work experience do you have, and what kind of work have you mostly been doing?',
      focusArea: 'Candidate profile · Total experience',
    },
    {
      question: 'What is your notice period — are you currently serving any notice, and how soon can you join if selected?',
      focusArea: 'Candidate profile · Notice period & availability',
    },
    {
      question: 'Finally, what is your current salary, and what are your salary expectations for this role?',
      focusArea: 'Candidate profile · Current & expected CTC',
    },
  ]
  return items.map((item, i) => ({
    qIndex: startIndex + i,
    kind: 'PRELIMINARY' as const,
    type: 'TEXT' as const,
    timeLimitSec: 180,
    question: item.question,
    focusArea: item.focusArea,
    modelAnswerPoints: [],
  }))
}

/** Map the recruiter-authored config onto stored InterviewQuestion objects. */
export function questionsFromConfig(config: AiInterviewConfig): InterviewQuestion[] {
  const authored: InterviewQuestion[] = config.questions.map((q, i) => ({
    qIndex: i,
    kind: 'CORE' as const,
    question: q.text,
    focusArea: '',
    modelAnswerPoints: [],
    type: q.type,
    timeLimitSec: q.timeLimitSec,
  }))
  if (config.includeProfileQuestions) {
    return [...authored, ...buildPreliminaryQuestions(authored.length)]
  }
  return authored
}

/** Safely parse Job.aiInterviewConfig; null when absent/corrupt/empty. */
export function parseJobAiConfig(raw: string | null | undefined): AiInterviewConfig | null {
  try {
    const parsed = JSON.parse(raw ?? 'null') as AiInterviewConfig | null
    if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) return parsed
    return null
  } catch {
    return null
  }
}
