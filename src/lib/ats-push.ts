// SeeWe - ATS dossier push helper (shared)
// Used by POST /api/ats/push (manual push) and POST /api/ai/evaluate-interview
// (auto-sync when the owning recruiter's integration has autoSyncResults on).
// One function owns the whole "send dossier to the recruiter's ATS webhook"
// concern: outbound POST with shared-secret header + timeout, AtsPush audit
// log with the exact payload snapshot, and AiEvaluation.atsSyncStatus flip
// (SYNCED on success / FAILED on any failure).

import { db } from '@/lib/db'
import { buildAtsDossier, type AtsDossier } from '@/lib/ats'

const PUSH_TIMEOUT_MS = 8_000

export interface AtsPushOutcome {
  attempted: boolean
  status: 'SUCCESS' | 'FAILED'
  httpStatus: number | null
  message: string
  pushId: string | null
  candidateName: string
  jobTitle: string
}

/**
 * Push one interview's full dossier to an ATS integration webhook.
 * - Writes an AtsPush audit row (success or failure) — never silent.
 * - When an AiEvaluation exists for the interview, its atsSyncStatus becomes
 *   SYNCED (success) or FAILED (failure).
 * Never throws — every failure path returns a structured outcome.
 */
/**
 * Demo-mode webhook URLs (saved by the Integration Center when the recruiter
 * connects without a real endpoint) are reserved under the .invalid TLD — they
 * must never be fetched. Pushes against them are recorded as SKIPPED so the
 * leaderboard shows an honest "not connected" state instead of a failure.
 */
export function isDemoAtsUrl(url: string): boolean {
  try {
    return new URL(url).hostname === 'demo.ats.invalid'
  } catch {
    return false
  }
}

export async function pushInterviewToAts(
  integration: { id: string; webhookUrl: string; apiKey: string | null },
  interviewId: string,
  dossier: AtsDossier
): Promise<AtsPushOutcome> {
  const payload = JSON.stringify(dossier)
  let status: 'SUCCESS' | 'FAILED' | 'SKIPPED' = 'FAILED'
  let httpStatus: number | null = null
  let message = ''

  if (isDemoAtsUrl(integration.webhookUrl)) {
    // Demo-mode integration: validate + audit, but do not deliver anywhere.
    status = 'SKIPPED'
    message = 'Demo mode — no real ATS endpoint configured; dossier validated, nothing delivered'
    const push = await db.atsPush.create({
      data: {
        integrationId: integration.id,
        interviewId,
        candidateName: dossier.candidate.name,
        jobTitle: dossier.position.title,
        status,
        httpStatus: null,
        message,
        payload,
      },
    })
    try {
      const evaluation = await db.aiEvaluation.findUnique({ where: { interviewId } })
      if (evaluation) {
        await db.aiEvaluation.update({
          where: { id: evaluation.id },
          data: { atsSyncStatus: 'SKIPPED' },
        })
      }
    } catch (err) {
      console.error('[ats-push] Failed to update AiEvaluation.atsSyncStatus (non-fatal):', err)
    }
    return {
      attempted: false,
      status,
      httpStatus: null,
      message,
      pushId: push.id,
      candidateName: dossier.candidate.name,
      jobTitle: dossier.position.title,
    }
  }

  try {
    const res = await fetch(integration.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SeeWe-ATS-Exporter/1.0',
        ...(integration.apiKey ? { 'x-ats-api-key': integration.apiKey } : {}),
      },
      body: payload,
      signal: AbortSignal.timeout(PUSH_TIMEOUT_MS),
    })
    httpStatus = res.status
    if (res.ok) {
      status = 'SUCCESS'
      message = `Accepted by ATS (HTTP ${res.status})`
    } else {
      message = `ATS endpoint responded with HTTP ${res.status}`
    }
  } catch (err) {
    message =
      err instanceof Error
        ? `Could not reach the ATS endpoint: ${err.name === 'TimeoutError' ? `timed out after ${PUSH_TIMEOUT_MS / 1000}s` : err.message}`
        : 'Could not reach the ATS endpoint'
  }

  const push = await db.atsPush.create({
    data: {
      integrationId: integration.id,
      interviewId,
      candidateName: dossier.candidate.name,
      jobTitle: dossier.position.title,
      status,
      httpStatus,
      message,
      payload,
    },
  })

  // Sync-status bookkeeping on the evaluation row (only when one exists —
  // pushing a dossier without a multi-factor evaluation leaves it untouched).
  try {
    const evaluation = await db.aiEvaluation.findUnique({ where: { interviewId } })
    if (evaluation) {
      await db.aiEvaluation.update({
        where: { id: evaluation.id },
        data: {
          atsSyncStatus:
            status === 'SUCCESS' ? 'SYNCED' : status === 'SKIPPED' ? 'SKIPPED' : 'FAILED',
        },
      })
    }
  } catch (err) {
    console.error('[ats-push] Failed to update AiEvaluation.atsSyncStatus (non-fatal):', err)
  }

  return {
    attempted: true,
    status,
    httpStatus,
    message,
    pushId: push.id,
    candidateName: dossier.candidate.name,
    jobTitle: dossier.position.title,
  }
}

export { buildAtsDossier }
