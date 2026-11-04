// SeeWe - POST /api/interview/answer
// Records a candidate's answer for one question of an interview and evaluates
// it via the LLM (score 0-10 + feedback + strengths/improvements).
// Returns the stored Answer plus parsedStrengths/parsedImprovements helpers.

import { NextResponse } from 'next/server'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { db } from '@/lib/db'
import type { InterviewQuestion } from '@/lib/types'
import { chatWithRetry, extractJson } from '@/lib/ai-client'
import { parseSpokenLocation, parseSpokenExperienceYears, parseSpokenNoticeDays, parseSpokenCtc } from '@/lib/spoken-profile'

// Recorded-answer media lives on disk (kept out of git & SQLite). ~12MB base64
// ceiling ≈ 9MB binary ≈ several minutes of 640px vp8/opus webm per answer.
const MEDIA_DIR = path.join(process.cwd(), 'upload', 'interview-media')
const MAX_MEDIA_BASE64 = 12 * 1024 * 1024

/**
 * Persist an optional recorded answer blob (video/webm preferred, audio/webm
 * fallback). Returns { filename, kind } or null when nothing valid was sent.
 * Never throws — a failed media save must not fail the graded answer.
 */
async function saveMedia(
  interviewId: string,
  qIndex: number,
  base64: unknown
): Promise<{ filename: string; kind: 'video' | 'audio' } | null> {
  try {
    if (typeof base64 !== 'string' || base64.length < 64) return null
    if (base64.length > MAX_MEDIA_BASE64) return null

    // Accept raw base64 or a data URL
    const commaIdx = base64.indexOf(',')
    const raw = commaIdx !== -1 ? base64.slice(commaIdx + 1) : base64
    if (!raw || raw.length < 64) return null

    const header = base64.slice(0, commaIdx !== -1 ? commaIdx : 0).toLowerCase()
    const buf = Buffer.from(raw, 'base64')
    if (buf.length < 48) return null

    // Sniff container: EBML header means webm/matroska (what MediaRecorder emits)
    const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3
    if (!isWebm) return null

    const kind: 'video' | 'audio' = header.includes('video/webm') ? 'video' : 'audio'
    const filename = `${interviewId}-q${qIndex}-${Date.now()}.webm`
    await mkdir(MEDIA_DIR, { recursive: true })
    await writeFile(path.join(MEDIA_DIR, filename), buf)
    return { filename, kind }
  } catch (err) {
    console.error('[interview/answer] media save failed (non-fatal):', err)
    return null
  }
}

interface EvaluationResult {
  score: number | null
  feedback: string
  strengths: string[]
  improvements: string[]
}

function parseQuestions(raw: string): InterviewQuestion[] {
  try {
    const arr = JSON.parse(raw ?? '[]')
    return Array.isArray(arr) ? (arr as InterviewQuestion[]) : []
  } catch {
    return []
  }
}

/** Alphanumeric-only length check: true if transcript carries enough real content. */
function isMeaningful(transcript: string): boolean {
  const meaningful = (transcript ?? '').replace(/[^a-zA-Z0-9]/g, '')
  return meaningful.length >= 15
}

function clampScore(value: unknown): number {
  let n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) n = 0
  n = Math.min(10, Math.max(0, n))
  return Math.round(n * 10) / 10
}

function asStringArray(value: unknown, maxItems = 6): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, maxItems)
}

function normalizeEvaluation(raw: string): EvaluationResult {
  const parsed = extractJson<any>(raw)
  return {
    score: parsed?.score === null || parsed?.score === undefined || parsed?.score === '' ? null : clampScore(parsed.score),
    feedback:
      typeof parsed?.feedback === 'string' && parsed.feedback.trim()
        ? parsed.feedback.trim()
        : 'The candidate answered, but no detailed feedback was produced.',
    strengths: asStringArray(parsed?.strengths),
    improvements: asStringArray(parsed?.improvements),
  }
}

/**
 * Auto-feed: parse a spoken preliminary answer and write the extracted fact
 * straight onto the candidate's profile. Only successfully parsed fields are
 * written; a failed parse never touches the profile.
 */
async function autoFeedProfileFromAnswer(
  shortlistId: string,
  focusArea: string,
  transcript: string
): Promise<void> {
  try {
    const sl = await db.shortlist.findUnique({
      where: { id: shortlistId },
      select: { application: { select: { candidateId: true } } },
    })
    const candidateId = sl?.application?.candidateId
    if (!candidateId) return

    const patch: Record<string, unknown> = {}
    if (/location/i.test(focusArea)) {
      const loc = parseSpokenLocation(transcript)
      if (loc) patch.location = loc
    }
    if (/experience/i.test(focusArea)) {
      const yrs = parseSpokenExperienceYears(transcript)
      if (yrs != null) patch.experienceYears = yrs
    }
    if (/notice/i.test(focusArea)) {
      const days = parseSpokenNoticeDays(transcript)
      if (days != null) patch.noticePeriodDays = days
    }
    if (/ctc|salary/i.test(focusArea)) {
      const ctc = parseSpokenCtc(transcript)
      if (ctc.current != null) patch.currentSalary = Math.round(ctc.current)
      if (ctc.expected != null) patch.expectedSalary = Math.round(ctc.expected)
    }
    if (Object.keys(patch).length > 0) {
      await db.user.update({ where: { id: candidateId }, data: patch })
    }
  } catch (err) {
    // Non-fatal: the transcript is still stored; profile sync is best-effort.
    console.error('[interview/answer] profile auto-feed failed (non-fatal):', err)
  }
}


export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const interviewId = typeof body?.interviewId === 'string' ? body.interviewId.trim() : ''
    const qIndex = Number(body?.qIndex)
    const transcript = typeof body?.transcript === 'string' ? body.transcript : ''
    const audioPresent = Boolean(body?.audioPresent)
    const mediaSeconds = Number.isFinite(Number(body?.mediaSeconds))
      ? Math.max(0, Math.min(1800, Math.round(Number(body?.mediaSeconds) * 10) / 10))
      : null
    // Optional A/B take label from the candidate take-picker. Only 'A' | 'B'
    // (after trim + uppercase) is valid — anything else, including a missing
    // field (legacy single-take flow), is stored as null. Clamped like the
    // other loose-shaped body fields.
    const takeLabelRaw =
      typeof body?.takeLabel === 'string' ? body.takeLabel.trim().toUpperCase() : ''
    const takeLabel: 'A' | 'B' | null =
      takeLabelRaw === 'A' || takeLabelRaw === 'B' ? (takeLabelRaw as 'A' | 'B') : null
    // [build-batch-3] explicit skip — the candidate chose not to answer. Stored
    // with a distinct score-0 + "skipped" feedback so the recruiter report can
    // tell deliberate skips apart from weak/empty answers. No media, no LLM call.
    const skipped = Boolean(body?.skipped)

    if (!interviewId) {
      return NextResponse.json({ error: 'interviewId is required' }, { status: 400 })
    }
    if (!Number.isInteger(qIndex) || qIndex < 0) {
      return NextResponse.json({ error: 'qIndex must be a non-negative integer' }, { status: 400 })
    }

    const interview = await db.interview.findUnique({ where: { id: interviewId } })
    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
    }
    if (interview.status === 'COMPLETED') {
      return NextResponse.json({ error: 'Interview already completed' }, { status: 409 })
    }

    const questions = parseQuestions(interview.questions)
    if (qIndex >= questions.length) {
      return NextResponse.json(
        { error: `qIndex out of range (0-${questions.length - 1})` },
        { status: 400 }
      )
    }
    const questionObj: InterviewQuestion = questions[qIndex]
    const isPreliminary = questionObj.kind === 'PRELIMINARY'

    // 1) Upsert base answer record first so progress survives evaluation hiccups
    const answer = await db.answer.upsert({
      where: { interviewId_qIndex: { interviewId: interview.id, qIndex } },
      create: {
        interviewId: interview.id,
        qIndex,
        question: questionObj.question,
        transcript,
        audioPresent,
        takeLabel,
      },
      update: {
        transcript,
        audioPresent,
        question: questionObj.question,
        takeLabel,
      },
    })

    // 1b) Optional recorded answer media (video/audio webm) — saved to disk and
    // linked to the answer row. Failures are logged & skipped, never fatal.
    let media: { filename: string; kind: 'video' | 'audio' } | null = null
    if (body?.media_base64 && !skipped) {
      media = await saveMedia(interview.id, qIndex, body.media_base64)
    }

    // 2) Evaluate — preliminary profile questions are captured, never AI-graded;
    //    explicit skips short-circuit evaluation entirely
    let result: EvaluationResult
    if (skipped) {
      result = {
        score: 0,
        feedback: 'Candidate skipped this question.',
        strengths: [],
        improvements: [],
      }
    } else if (isPreliminary) {
      if (transcript.trim()) {
        void autoFeedProfileFromAnswer(interview.shortlistId, questionObj.focusArea, transcript)
      }
      result = {
        score: null,
        feedback: transcript.trim()
          ? 'Profile detail captured — synced to the candidate profile automatically.'
          : 'No spoken answer captured for this profile question.',
        strengths: [],
        improvements: [],
      }
    } else if (!isMeaningful(transcript)) {
      result = {
        score: 1,
        feedback: 'Candidate did not provide a meaningful answer.',
        strengths: [],
        improvements: [
          'Provide a fuller spoken answer covering the key technical points.',
          'Explain reasoning with at least one concrete example.',
        ],
      }
    } else {
      try {
        const systemPrompt = `You are a strict but fair technical interviewer evaluator. You grade one spoken candidate answer against a question and its model answer points. You are concise and specific. Respond with valid JSON only, no markdown fences, no commentary.`

        const userPrompt = `Evaluate this single interview answer.

QUESTION (${questionObj.focusArea ?? 'general'}):
${questionObj.question}

MODEL ANSWER POINTS (what a strong answer covers):
${(questionObj.modelAnswerPoints ?? []).map((p, i) => `${i + 1}. ${p}`).join('\n') || '(no rubric provided - judge on general merit)'}

CANDIDATE TRANSCRIPT:
"${transcript.slice(0, 4000)}"

Return STRICT JSON exactly shaped like:
{"score": <0-10 with one decimal>, "feedback": "<2-3 sentences>", "strengths": ["<point>", "..."], "improvements": ["<point>", "..."]}

Scoring guide: 0-2 no relevant content; 3-5 partial/incorrect core understanding; 6-7 correct but shallow; 8-9 solid and well reasoned; 10 complete, precise, insightful.
Respond with valid JSON only, no markdown fences, no commentary.`

        const raw = await chatWithRetry(systemPrompt, userPrompt)
        result = normalizeEvaluation(raw)
      } catch (err) {
        console.error('[interview/answer] LLM evaluation failed:', err)
        result = {
          score: null,
          feedback: 'Automatic evaluation was unavailable for this answer; it will still be considered in the final report.',
          strengths: [],
          improvements: ['Retain key examples and structure in future answers.'],
        }
      }
    }

    // Clamp again defensively & persist
    const finalScore =
      result.score === null ? null : Math.min(10, Math.max(0, Math.round(result.score * 10) / 10))

    const updated = await db.answer.update({
      where: { id: answer.id },
      data: {
        score: finalScore,
        feedback: result.feedback,
        strengths: JSON.stringify(result.strengths),
        improvements: JSON.stringify(result.improvements),
        audioPresent,
        transcript,
        takeLabel,
        ...(media
          ? { mediaPath: media.filename, mediaKind: media.kind, ...(mediaSeconds != null ? { mediaSeconds } : {}) }
          : {}),
      },
    })

    // 3) Response — CANDIDATE-SAFE: the person in the room never receives AI
    //    evaluation data (score/feedback/strengths/improvements stay in the DB
    //    for the recruiter's report only). Only confirmation + storage metadata
    //    go back, so scores cannot leak via the network layer either.
    return NextResponse.json({
      data: {
        id: updated.id,
        interviewId: updated.interviewId,
        qIndex: updated.qIndex,
        question: updated.question,
        transcript: updated.transcript,
        audioPresent: updated.audioPresent,
        mediaPath: updated.mediaPath,
        mediaKind: updated.mediaKind,
        mediaSeconds: updated.mediaSeconds,
        takeLabel: updated.takeLabel,
        preliminary: isPreliminary,
        saved: true,
      },
    })
  } catch (error) {
    console.error('[interview/answer] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to submit answer' }, { status: 500 })
  }
}
