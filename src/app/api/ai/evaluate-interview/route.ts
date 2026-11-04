// SeeWe - POST /api/ai/evaluate-interview
// Multi-factor AI evaluation pipeline over a COMPLETED AI interview.
// RECRUITER-ONLY endpoint — the response carries scores and must never reach
// any candidate-facing surface.
//
// POST { interviewId, recruiterId }   (recruiterId enforced as the job owner)
//
// Pipeline:
//   1. Load Interview + Answers (+ transcripts). Any VOICE answer whose media
//      file exists but has no transcript gets a z-ai ASR pass over the stored
//      recording (graceful skip → empty transcript when unreadable).
//   2. ONE LLM call grades the full set: overall + 4 factor scores (0-100:
//      technical / communication / problem-solving / presentation),
//      strengths, weaknesses and per-question 0-10 score + feedback.
//      Weighted fallback when the LLM overall is missing:
//      0.40*technical + 0.25*communication + 0.20*problem_solving + 0.15*presentation.
//   3. Persist AiEvaluation (upsert — idempotent, re-evaluate overwrites),
//      update Interview.overallScore (0-100) + verdict
//      (>=80 STRONG_HIRE, >=65 HIRE, >=50 MAYBE, else NO_HIRE) and each
//      Answer.score/feedback.
//   4. If the owning recruiter has an active AtsIntegration with
//      autoSyncResults=true, the refreshed dossier is pushed to their ATS and
//      AiEvaluation.atsSyncStatus becomes SYNCED/FAILED (SKIPPED when no
//      auto-sync target is configured).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson, getZAI } from '@/lib/ai-client'
import { readMediaAsBase64 } from '@/lib/interview-media'
import { buildAtsDossier } from '@/lib/ats'
import { pushInterviewToAts } from '@/lib/ats-push'
import type { InterviewQuestion } from '@/lib/types'

export const dynamic = 'force-dynamic'

const MAX_TRANSCRIPT_CHARS = 2500
const ASR_TIMEOUT_MS = 60_000

function parseQuestions(raw: string): InterviewQuestion[] {
  try {
    const arr = JSON.parse(raw ?? '[]')
    return Array.isArray(arr) ? (arr as InterviewQuestion[]) : []
  } catch {
    return []
  }
}

function parseStringArray(raw: string | null | undefined): string[] {
  try {
    const arr = JSON.parse(raw ?? '[]')
    return Array.isArray(arr) ? arr.map((s) => String(s).trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function clamp100(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(100, Math.max(0, Math.round(n)))
}

function clamp10(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(10, Math.max(0, Math.round(n * 10) / 10))
}

function asStringArray(value: unknown, maxItems = 6): string[] {
  if (!Array.isArray(value)) return []
  return value.map((s) => String(s).trim()).filter(Boolean).slice(0, maxItems)
}

function verdictFor(score: number): 'STRONG_HIRE' | 'HIRE' | 'MAYBE' | 'NO_HIRE' {
  if (score >= 80) return 'STRONG_HIRE'
  if (score >= 65) return 'HIRE'
  if (score >= 50) return 'MAYBE'
  return 'NO_HIRE'
}

/**
 * ASR recovery for one VOICE answer: read the stored recording and transcribe.
 * Returns '' on ANY failure (missing/unreadable file, provider error) — the
 * pipeline must degrade to an empty transcript, never fail the evaluation.
 */
async function recoverTranscript(mediaPath: string): Promise<string> {
  try {
    const base64 = await readMediaAsBase64(mediaPath)
    if (!base64) return ''
    const zai = await getZAI()
    const response = (await Promise.race([
      zai.audio.asr.create({ file_base64: base64 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('ASR timed out')), ASR_TIMEOUT_MS)
      ),
    ])) as { text?: unknown }
    return typeof response?.text === 'string' ? response.text.trim().slice(0, MAX_TRANSCRIPT_CHARS) : ''
  } catch (err) {
    console.error('[ai/evaluate-interview] ASR recovery failed (skipping):', err)
    return ''
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))
    const interviewId = typeof body?.interviewId === 'string' ? body.interviewId.trim() : ''
    const recruiterId = typeof body?.recruiterId === 'string' ? body.recruiterId.trim() : ''

    if (!interviewId) {
      return NextResponse.json({ error: 'interviewId is required' }, { status: 400 })
    }
    if (!recruiterId) {
      return NextResponse.json(
        { error: 'recruiterId is required (the job-owning recruiter runs evaluations)' },
        { status: 400 }
      )
    }

    const interview = await db.interview.findUnique({
      where: { id: interviewId },
      include: {
        answers: { orderBy: { qIndex: 'asc' as const } },
        shortlist: {
          include: {
            application: {
              include: {
                job: { select: { id: true, title: true, company: true, recruiterId: true } },
              },
            },
          },
        },
      },
    })
    if (!interview) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
    }

    // ---- Recruiter-ownership guard (the job's own recruiter only) ----
    const ownerId = interview.shortlist?.application?.job?.recruiterId
    if (!ownerId) {
      return NextResponse.json({ error: 'Interview has no owning job' }, { status: 409 })
    }
    if (recruiterId !== ownerId) {
      return NextResponse.json(
        { error: 'Only the job-owning recruiter can evaluate this interview' },
        { status: 403 }
      )
    }
    if (interview.status !== 'COMPLETED') {
      return NextResponse.json(
        { error: 'Only completed interviews can be evaluated — wait for the candidate to finish' },
        { status: 400 }
      )
    }

    const questionPlan = parseQuestions(interview.questions)

    // ---- Stage 1: ASR recovery for VOICE answers without transcripts ----
    const flags: string[] = []
    const transcripts: Array<{ qIndex: number; question: string; format: string; transcript: string }> = []

    for (const answer of interview.answers) {
      const question = questionPlan.find((q) => q.qIndex === answer.qIndex)
      const format = (question?.type ?? (answer.mediaPath ? 'VOICE' : 'TEXT')) as string
      let transcript = (answer.transcript ?? '').trim()

      if (!transcript && answer.mediaPath) {
        transcript = await recoverTranscript(answer.mediaPath)
        if (transcript) {
          // Persist the recovered transcript so re-evaluations don't re-run ASR.
          await db.answer.update({ where: { id: answer.id }, data: { transcript } })
        } else {
          flags.push(`MISSING_TRANSCRIPT_Q${answer.qIndex + 1}`)
        }
      }
      if (!transcript && !answer.mediaPath && question?.kind !== 'PRELIMINARY' && question?.isSkippable !== true) {
        flags.push(`NO_ANSWER_Q${answer.qIndex + 1}`)
      }
      // Aggregate proctoring events captured client-side while answering
      for (const flag of parseStringArray(answer.proctoringFlags)) {
        if (!flags.includes(flag)) flags.push(flag)
      }

      transcripts.push({
        qIndex: answer.qIndex,
        question: question?.question ?? answer.question,
        format,
        transcript,
      })
    }

    // ---- Stage 2: ONE multi-factor LLM grading call ----
    const graded = transcripts.filter(
      (t) => questionPlan.find((q) => q.qIndex === t.qIndex)?.kind !== 'PRELIMINARY'
    )
    const qaBlock = graded
      .map((t) => {
        const timeLimit = questionPlan.find((q) => q.qIndex === t.qIndex)?.timeLimitSec
        return [
          `Q${t.qIndex} [${t.format}${timeLimit ? ` · ${timeLimit}s limit` : ''}]: ${t.question}`,
          `CANDIDATE ANSWER: ${t.transcript ? `"${t.transcript.slice(0, MAX_TRANSCRIPT_CHARS)}"` : '(no answer captured — candidate skipped or audio was unintelligible)'}`,
        ].join('\n')
      })
      .join('\n\n')

    const systemPrompt =
      'You are a senior hiring panel lead scoring a completed AI screening interview across multiple factors. You judge only from evidence in the transcripts. You always respond with valid JSON only — no markdown fences, no commentary.'

    const userPrompt = `Score this completed AI screening interview.

ROLE: ${interview.jobTitle}
CANDIDATE: ${interview.candidateName}

QUESTIONS + TRANSCRIPTS:
${qaBlock || '(no graded answers were submitted)'}

SCORING FACTORS (0-100 each):
- technical: depth/accuracy of role skills demonstrated in the answers
- communication: clarity, structure, articulation of the spoken/typed answers
- problem_solving: reasoning, trade-off thinking, examples of solving hard problems
- presentation: confidence, specificity, professionalism of delivery (presence on camera/timed answers)

TASK
Return STRICT JSON exactly shaped like:
{
  "overall": <0-100 weighted multi-factor score>,
  "technical": <0-100>,
  "communication": <0-100>,
  "problem_solving": <0-100>,
  "presentation": <0-100>,
  "strengths": ["<specific evidence-backed strength>", "..."],
  "weaknesses": ["<specific evidence-backed weakness>", "..."],
  "perQuestion": [{"qIndex": <number>, "score": <0-10 with one decimal>, "feedback": "<1-2 sentences>"}]
}

Rules:
- overall should roughly follow the weights: technical 40%, communication 25%, problem-solving 20%, presentation 15%.
- perQuestion MUST include every question index listed above; skipped/unanswered questions score 0-2.
- Evidence only — quote or paraphrase what the candidate actually said.
- English only. Respond with valid JSON only, no markdown fences, no commentary.`

    let overall = 0
    let technical: number | null = null
    let communication: number | null = null
    let problemSolving: number | null = null
    let presentation: number | null = null
    let strengths: string[] = []
    let weaknesses: string[] = []
    let perQuestion: Array<{ qIndex: number; score: number; feedback: string }> = []

    try {
      const raw = await chatWithRetry(systemPrompt, userPrompt)
      const parsed = extractJson<Record<string, unknown>>(raw)

      technical = clamp100(parsed?.technical)
      communication = clamp100(parsed?.communication)
      problemSolving = clamp100(parsed?.problem_solving)
      presentation = clamp100(parsed?.presentation)

      // Weighted fallback (renormalised over the factors the LLM actually returned)
      const weights: Array<[number | null, number]> = [
        [technical, 0.4],
        [communication, 0.25],
        [problemSolving, 0.2],
        [presentation, 0.15],
      ]
      const weightedSum = weights.reduce((sum, [v, w]) => sum + (v ?? 0) * w, 0)
      const weightTotal = weights.reduce((sum, [v, w]) => sum + (v !== null ? w : 0), 0)
      const computedOverall = weightTotal > 0 ? weightedSum / weightTotal : 0

      const llmOverall = clamp100(parsed?.overall)
      overall = llmOverall ?? Math.round(computedOverall)

      strengths = asStringArray(parsed?.strengths)
      weaknesses = asStringArray(parsed?.weaknesses)

      if (Array.isArray(parsed?.perQuestion)) {
        perQuestion = (parsed.perQuestion as Array<Record<string, unknown>>)
          .map((item) => ({
            qIndex: Number(item?.qIndex),
            score: clamp10(item?.score),
            feedback:
              typeof item?.feedback === 'string' && item.feedback.trim()
                ? item.feedback.trim().slice(0, 500)
                : '',
          }))
          .filter((item) => Number.isInteger(item.qIndex) && item.qIndex >= 0)
      }
    } catch (err) {
      console.error('[ai/evaluate-interview] LLM grading failed, deterministic fallback:', err)
      // Deterministic fallback: score each graded question from its existing
      // per-answer LLM score (0-10 → 0-100) so the pipeline never dead-ends.
      const answerScoreOf = (qIndex: number): number => {
        const a = interview.answers.find((ans) => ans.qIndex === qIndex)
        return typeof a?.score === 'number' ? Math.round(a.score * 10) : 0
      }
      technical = graded.length
        ? Math.round(graded.reduce((s, t) => s + answerScoreOf(t.qIndex), 0) / graded.length)
        : 0
      communication = technical
      problemSolving = technical
      presentation = technical
      overall = Math.round(
        0.4 * (technical ?? 0) + 0.25 * (communication ?? 0) + 0.2 * (problemSolving ?? 0) + 0.15 * (presentation ?? 0)
      )
      strengths = technical >= 65 ? ['Completed the full interview with credible answers'] : []
      weaknesses = technical < 65 ? ['Answer depth below the bar for this role'] : []
      perQuestion = graded.map((t) => ({
        qIndex: t.qIndex,
        score: clamp10(answerScoreOf(t.qIndex) / 10),
        feedback: 'Scored from the stored per-answer evaluation (AI grading unavailable).',
      }))
      flags.push('EVALUATION_FALLBACK')
    }

    while (strengths.length < 2) strengths.push('Engaged with the interview and provided complete answers where required.')
    while (weaknesses.length < 2) weaknesses.push('Deeper, example-led answers would lift the factor scores.')

    // ---- Stage 3: persist (idempotent upsert + interview/answer updates) ----
    const verdict = verdictFor(overall)

    const evaluation = await db.aiEvaluation.upsert({
      where: { interviewId: interview.id },
      create: {
        interviewId: interview.id,
        overallScore: overall,
        technicalScore: technical,
        communicationScore: communication,
        problemSolvingScore: problemSolving,
        presentationScore: presentation,
        keyStrengths: JSON.stringify(strengths),
        keyWeaknesses: JSON.stringify(weaknesses),
        antiCheatFlags: JSON.stringify(flags),
        transcripts: JSON.stringify(transcripts),
      },
      update: {
        overallScore: overall,
        technicalScore: technical,
        communicationScore: communication,
        problemSolvingScore: problemSolving,
        presentationScore: presentation,
        keyStrengths: JSON.stringify(strengths),
        keyWeaknesses: JSON.stringify(weaknesses),
        antiCheatFlags: JSON.stringify(flags),
        transcripts: JSON.stringify(transcripts),
        atsSyncStatus: 'PENDING', // re-evaluation resets the sync state; auto-sync below may set it again
      },
    })

    await db.$transaction([
      db.interview.update({
        where: { id: interview.id },
        data: { overallScore: overall, verdict },
      }),
      // Per-question score/feedback refresh from the multi-factor pass
      ...perQuestion.map((item) =>
        db.answer.updateMany({
          where: { interviewId: interview.id, qIndex: item.qIndex },
          data: {
            score: clamp10(item.score),
            feedback:
              item.feedback ||
              'Multi-factor evaluation completed — no per-question note produced.',
          },
        })
      ),
    ])

    // ---- Stage 4: auto-push to the recruiter's ATS when configured ----
    let pushOutcome: Awaited<ReturnType<typeof pushInterviewToAts>> | null = null
    let pushedViaIntegrationId: string | null = null
    try {
      const autoIntegration = await db.atsIntegration.findFirst({
        where: { recruiterId: ownerId, active: true, autoSyncResults: true },
        orderBy: { createdAt: 'desc' as const },
      })
      if (autoIntegration) {
        const dossier = await buildAtsDossier(interview.id)
        if (dossier && dossier.interview.status === 'COMPLETED') {
          pushOutcome = await pushInterviewToAts(
            {
              id: autoIntegration.id,
              webhookUrl: autoIntegration.webhookUrl,
              apiKey: autoIntegration.apiKey,
            },
            interview.id,
            dossier
          )
          pushedViaIntegrationId = autoIntegration.id
        } else {
          // Nothing to deliver yet (dossier incomplete) — not an error.
          await db.aiEvaluation.update({
            where: { id: evaluation.id },
            data: { atsSyncStatus: 'SKIPPED' },
          })
        }
      } else {
        await db.aiEvaluation.update({
          where: { id: evaluation.id },
          data: { atsSyncStatus: 'SKIPPED' },
        })
      }
    } catch (err) {
      console.error('[ai/evaluate-interview] Auto-push failed (non-fatal):', err)
      await db.aiEvaluation
        .update({ where: { id: evaluation.id }, data: { atsSyncStatus: 'FAILED' } })
        .catch(() => undefined)
    }

    const refreshed = await db.aiEvaluation.findUnique({ where: { id: evaluation.id } })

    // RECRUITER-FACING response — never expose through candidate surfaces.
    return NextResponse.json({
      data: {
        evaluation: {
          id: refreshed?.id ?? evaluation.id,
          interviewId: interview.id,
          overallScore: refreshed?.overallScore ?? overall,
          technicalScore: refreshed?.technicalScore ?? technical,
          communicationScore: refreshed?.communicationScore ?? communication,
          problemSolvingScore: refreshed?.problemSolvingScore ?? problemSolving,
          presentationScore: refreshed?.presentationScore ?? presentation,
          keyStrengths: strengths,
          keyWeaknesses: weaknesses,
          antiCheatFlags: flags,
          atsSyncStatus: refreshed?.atsSyncStatus ?? 'PENDING',
          perQuestion,
          verdict,
        },
        interview: {
          id: interview.id,
          status: 'COMPLETED',
          overallScore: overall,
          verdict,
        },
        push: pushOutcome
          ? {
              status: pushOutcome.status,
              httpStatus: pushOutcome.httpStatus,
              message: pushOutcome.message,
              pushId: pushOutcome.pushId,
              integrationId: pushedViaIntegrationId,
            }
          : null,
      },
    })
  } catch (error) {
    console.error('[ai/evaluate-interview] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to evaluate interview' }, { status: 500 })
  }
}
