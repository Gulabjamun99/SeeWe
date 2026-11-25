// SeeWe - Indian AI Interviewer Voice Catalog
// 3 Indian Male + 3 Indian Female voices for AI screening interviews.
// Shared by /api/tts, AiInterviewConfigurator (recruiter), SpeakerCheck, and InterviewRoom.

export type IndianVoiceId =
  | 'arjun'
  | 'aarav'
  | 'kabir'
  | 'ananya'
  | 'priya'
  | 'kavya'

export interface IndianInterviewVoice {
  id: IndianVoiceId
  label: string
  gender: 'male' | 'female'
  accent: string
  tagline: string
  /** Server TTS fallback voice id */
  serverVoice: 'onyx' | 'echo' | 'jam' | 'nova' | 'shimmer' | 'alloy'
  /** Web Speech Synthesis tuning for distinct vocal character */
  pitch: number
  rate: number
  /** Preferred OS / browser en-IN voice name substrings (case-insensitive) */
  browserHints: string[]
}

export const DEFAULT_INTERVIEW_VOICE: IndianVoiceId = 'arjun'

export const INDIAN_INTERVIEW_VOICES: IndianInterviewVoice[] = [
  {
    id: 'arjun',
    label: 'Arjun',
    gender: 'male',
    accent: 'Indian English · Male',
    tagline: 'Warm, steady senior tech interviewer',
    serverVoice: 'onyx',
    pitch: 0.96,
    rate: 0.88,
    browserHints: ['prabhat', 'rishi', 'madhur', 'hemant', 'ravi', 'india'],
  },
  {
    id: 'aarav',
    label: 'Aarav',
    gender: 'male',
    accent: 'Indian English · Male',
    tagline: 'Calm, structured & analytical pacing',
    serverVoice: 'echo',
    pitch: 1.03,
    rate: 0.91,
    browserHints: ['rishi', 'prabhat', 'madhur', 'ravi', 'india'],
  },
  {
    id: 'kabir',
    label: 'Kabir',
    gender: 'male',
    accent: 'Indian English · Male',
    tagline: 'Deep, confident leadership panelist',
    serverVoice: 'jam',
    pitch: 0.88,
    rate: 0.85,
    browserHints: ['hemant', 'prabhat', 'madhur', 'rishi', 'india'],
  },
  {
    id: 'ananya',
    label: 'Ananya',
    gender: 'female',
    accent: 'Indian English · Female',
    tagline: 'Warm, articulate HR & engineering lead',
    serverVoice: 'nova',
    pitch: 1.06,
    rate: 0.9,
    browserHints: ['neerja', 'heera', 'veena', 'swara', 'aditi', 'raveena', 'india'],
  },
  {
    id: 'priya',
    label: 'Priya',
    gender: 'female',
    accent: 'Indian English · Female',
    tagline: 'Crisp, professional & easy to follow',
    serverVoice: 'shimmer',
    pitch: 1.12,
    rate: 0.87,
    browserHints: ['heera', 'neerja', 'veena', 'kalpana', 'aditi', 'india'],
  },
  {
    id: 'kavya',
    label: 'Kavya',
    gender: 'female',
    accent: 'Indian English · Female',
    tagline: 'Friendly, encouraging conversational tone',
    serverVoice: 'alloy',
    pitch: 1.02,
    rate: 0.93,
    browserHints: ['veena', 'swara', 'neerja', 'raveena', 'heera', 'india'],
  },
]

export function isValidIndianVoiceId(v: unknown): v is IndianVoiceId {
  return (
    typeof v === 'string' &&
    INDIAN_INTERVIEW_VOICES.some((item) => item.id === v.toLowerCase())
  )
}

export function getIndianVoiceMeta(id: unknown): IndianInterviewVoice {
  const norm = typeof id === 'string' ? id.toLowerCase() : ''
  return (
    INDIAN_INTERVIEW_VOICES.find((v) => v.id === norm) ??
    INDIAN_INTERVIEW_VOICES[0]
  )
}

const FEMALE_NAME_HINTS = [
  'neerja',
  'heera',
  'veena',
  'swara',
  'aditi',
  'raveena',
  'kalpana',
  'lekha',
  'female',
  'woman',
  'samantha',
  'zira',
  'aria',
]

const MALE_NAME_HINTS = [
  'prabhat',
  'rishi',
  'madhur',
  'hemant',
  'ravi',
  'male',
  'man',
  'david',
  'mark',
  'daniel',
]

/**
 * Pick the best matching Indian English (`en-IN` / `hi-IN`) browser voice
 * for the requested interviewer persona. Returns `null` if no Indian voice
 * is installed on the host OS so callers can prefer `/api/tts` when available.
 */
export function pickIndianBrowserVoice(
  voices: SpeechSynthesisVoice[],
  voiceMeta: IndianInterviewVoice
): SpeechSynthesisVoice | null {
  if (!voices.length) return null

  const indianPool = voices.filter((v) => {
    const lang = v.lang.toLowerCase().replace('_', '-')
    const name = v.name.toLowerCase()
    return (
      lang.startsWith('en-in') ||
      lang.startsWith('hi') ||
      name.includes('india') ||
      voiceMeta.browserHints.some((h) => name.includes(h))
    )
  })

  if (indianPool.length === 0) return null

  const wantedHints =
    voiceMeta.gender === 'female' ? FEMALE_NAME_HINTS : MALE_NAME_HINTS
  const genderMatched = indianPool.filter((v) => {
    const name = v.name.toLowerCase()
    return wantedHints.some((h) => name.includes(h))
  })

  const pool = genderMatched.length > 0 ? genderMatched : indianPool

  for (const hint of voiceMeta.browserHints) {
    const exact = pool.find((v) => v.name.toLowerCase().includes(hint))
    if (exact) return exact
  }
  return pool[0] ?? null
}

/** Fallback English voice if OS has zero Indian voices and server TTS is unavailable. */
export function pickFallbackEnglishVoice(
  voices: SpeechSynthesisVoice[],
  gender: 'male' | 'female'
): SpeechSynthesisVoice | null {
  const enPool = voices.filter((v) => v.lang.toLowerCase().startsWith('en'))
  if (!enPool.length) return voices[0] ?? null
  const hints = gender === 'female' ? FEMALE_NAME_HINTS : MALE_NAME_HINTS
  return (
    enPool.find((v) => hints.some((h) => v.name.toLowerCase().includes(h))) ??
    enPool[0]
  )
}
