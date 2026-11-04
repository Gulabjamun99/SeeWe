// SeeWe - POST /api/tts
// Text-to-speech for the AI interviewer's ONE fixed voice via z-ai-web-dev-sdk.
// Returns { data: 'data:audio/wav;base64,...' } so the frontend can play it
// directly in an <audio> element. Includes a small LRU-ish cache.
// Every interview uses the same voice: 'jam' at a slow 0.85 speed so every
// question is easy to follow — the candidate can replay it, and the AI stops
// talking the moment the candidate starts answering (barge-in).

import { NextResponse } from 'next/server'
import { getZAI } from '@/lib/ai-client'

const HARD_LIMIT = 900 // API limit is 1024 chars; we cut earlier, at sentence boundary when possible
const KNOWN_VOICES = ['arjun', 'jam', 'alloy', 'echo', 'onyx'] as const
const CACHE_MAX = 60

/**
 * Interviewer voice — ONE fixed voice for every interview (Indian English "Arjun").
 * Natural, clear, deliberate pacing.
 */
const VOICE_CATALOG: Array<{
  id: (typeof KNOWN_VOICES)[number]
  label: string
  gender: 'male' | 'female'
  accent: string
  description: string
}> = [
  {
    id: 'arjun',
    label: 'Arjun',
    gender: 'male',
    accent: 'Indian English interviewer voice',
    description:
      'The SeeWe AI interviewer — clear, easy-to-follow Indian English voice that reads every question with deliberate pacing.',
  },
]

export async function GET() {
  return NextResponse.json({
    data: {
      voices: VOICE_CATALOG,
      defaultVoice: 'arjun',
      speed: 0.88,
      accentNote:
        'Every interview uses one fixed AI interviewer voice — consistent, clear, Indian English accent.',
    },
  })
}

// module-level cache: textHash -> dataUrl
const ttsCache = new Map<string, string>()

function hashText(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/** Cap text at ~900 chars, preferring to end at a sentence boundary near the cap. */
function clipSpeechText(raw: string): string {
  const text = raw.trim().replace(/\s+/g, ' ')
  if (text.length <= HARD_LIMIT) return text

  // Look ahead slightly beyond the cap for a clean sentence end
  const searchEnd = Math.min(text.length - 1, HARD_LIMIT + 60)
  const searchFloor = Math.max(0, HARD_LIMIT - 150)
  const enders = new Set(['.', '!', '?', '。', '！', '？'])
  for (let i = searchEnd; i >= searchFloor; i--) {
    if (enders.has(text[i])) {
      return text.slice(0, i + 1).trim()
    }
  }
  // Graceful degradation: hard cut with ellipsis
  return text.slice(0, HARD_LIMIT).trim() + '…'
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const rawText = typeof body?.text === 'string' ? body.text : ''
    const requestedVoice = typeof body?.voice === 'string' ? body.voice.toLowerCase() : ''
    const voice = (KNOWN_VOICES as readonly string[]).includes(requestedVoice)
      ? requestedVoice
      : 'arjun'
    // Slow-speech support (user request: AI must NOT rush the questions).
    // Clamp into the API's 0.5–2.0 window; default stays 1.0.
    const rawSpeed = typeof body?.speed === 'number' ? body.speed : 1.0
    const speed = Number.isFinite(rawSpeed) ? Math.min(2.0, Math.max(0.5, rawSpeed)) : 1.0

    if (!rawText.trim()) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }

    const text = clipSpeechText(rawText)

    // Cache lookup (per voice + speed + normalized text)
    const cacheKey = `${voice}@${speed}:${hashText(text)}`
    const cached = ttsCache.get(cacheKey)
    if (cached) {
      // refresh recency
      ttsCache.delete(cacheKey)
      ttsCache.set(cacheKey, cached)
      return NextResponse.json({ data: cached })
    }

    const zai = await getZAI()
    const res = await zai.audio.tts.create({
      input: text,
      voice,
      speed,
      response_format: 'wav',
      stream: false,
    })
    const ab = await res.arrayBuffer()
    const buf = Buffer.from(new Uint8Array(ab))

    if (buf.length === 0) {
      throw new Error('TTS returned an empty audio payload')
    }

    const dataUrl = 'data:audio/wav;base64,' + buf.toString('base64')

    // Evict oldest entry when cache is full
    if (ttsCache.size >= CACHE_MAX) {
      const oldest = ttsCache.keys().next().value
      if (oldest !== undefined) ttsCache.delete(oldest)
    }
    ttsCache.set(cacheKey, dataUrl)

    return NextResponse.json({ data: dataUrl })
  } catch (error) {
    console.error('[tts] Speech generation failed:', error)
    return NextResponse.json({ error: 'Speech generation failed' }, { status: 502 })
  }
}
