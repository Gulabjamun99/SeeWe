// SeeWe - POST /api/tts
// Text-to-speech for the AI interviewer's selectable Indian English voices
// (3 Indian Male + 3 Indian Female) via z-ai-web-dev-sdk.
// Returns { data: 'data:audio/wav;base64,...' } so the frontend can play it
// directly in an <audio> element. Includes a small LRU-ish cache.

import { NextResponse } from 'next/server'
import { getZAI } from '@/lib/ai-client'
import {
  DEFAULT_INTERVIEW_VOICE,
  getIndianVoiceMeta,
  INDIAN_INTERVIEW_VOICES,
} from '@/lib/interview-voices'

const HARD_LIMIT = 900 // API limit is 1024 chars; we cut earlier, at sentence boundary when possible
const CACHE_MAX = 60

export async function GET() {
  return NextResponse.json({
    data: {
      voices: INDIAN_INTERVIEW_VOICES.map((v) => ({
        id: v.id,
        label: v.label,
        gender: v.gender,
        accent: v.accent,
        description: v.tagline,
      })),
      defaultVoice: DEFAULT_INTERVIEW_VOICE,
      speed: 0.88,
      accentNote:
        'Choose from 3 Indian Male and 3 Indian Female AI interviewer voices for clear, natural question delivery.',
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
    const voiceMeta = getIndianVoiceMeta(requestedVoice)
    const voice = voiceMeta.serverVoice
    // Slow-speech support (user request: AI must NOT rush the questions).
    // Clamp into the API's 0.5–2.0 window; default uses the voice's tuned rate.
    const rawSpeed = typeof body?.speed === 'number' ? body.speed : voiceMeta.rate
    const speed = Number.isFinite(rawSpeed) ? Math.min(2.0, Math.max(0.5, rawSpeed)) : voiceMeta.rate

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
