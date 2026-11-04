// SeeWe - POST /api/asr
// Automatic speech recognition for candidate voice answers via z-ai-web-dev-sdk.
// Accepts { file_base64 } (or alias { audioBase64 }), with or without a
// data-URL prefix, and returns { data: '<transcript>' }.

import { NextResponse } from 'next/server'
import { getZAI } from '@/lib/ai-client'

// ~12MB of base64 (~9MB raw audio) is plenty for one spoken answer
const MAX_BASE64_LENGTH = 12 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    let payload = typeof body?.file_base64 === 'string' ? body.file_base64 : ''
    if (!payload && typeof body?.audioBase64 === 'string') {
      payload = body.audioBase64
    }

    if (!payload.trim()) {
      return NextResponse.json({ error: 'file_base64 is required' }, { status: 400 })
    }

    // Strip data-URL prefix when present: "data:audio/webm;codecs=opus;base64,XXXX"
    if (payload.includes('base64,')) {
      payload = payload.slice(payload.indexOf('base64,') + 'base64,'.length)
    }
    payload = payload.trim()

    if (!payload) {
      return NextResponse.json({ error: 'Audio payload was empty after decoding header' }, { status: 400 })
    }

    if (payload.length > MAX_BASE64_LENGTH) {
      return NextResponse.json(
        { error: 'Audio recording is too large. Please record a shorter answer.' },
        { status: 413 }
      )
    }

    const zai = await getZAI()
    const response = await zai.audio.asr.create({ file_base64: payload })
    const text = typeof response?.text === 'string' ? response.text : ''

    if (!text.trim()) {
      // Provider reachable but nothing transcribed - guide candidate to fallback UI
      console.error('[asr] Transcription result was empty:', response)
      return NextResponse.json(
        { error: 'Could not transcribe audio. Please type your answer.' },
        { status: 422 }
      )
    }

    return NextResponse.json({ data: text })
  } catch (error) {
    console.error('[asr] Transcription failed:', error)
    return NextResponse.json(
      { error: 'Could not transcribe audio. Please type your answer.' },
      { status: 422 }
    )
  }
}
