/**
 * ApplicationEvent writer — master spec §10 audit trail.
 *
 * Every pipeline transition / engagement on an application gets an immutable
 * ApplicationEvent row: who (role + name), what (type), from which stage to
 * which stage, plus a short human note. Rows are never updated or deleted.
 *
 * NON-FATAL by contract: a failed event log must NEVER break the main flow,
 * so fire-and-forget call sites wrap with `logApplicationEventSafe` (or run
 * the writer inside the same $transaction as the mutation when one exists).
 *
 * CANDIDATE VISIBILITY RULE (permanent): candidates reading their timeline
 * only ever receive STATUS_CHANGE / OFFER rows with neutral labels — never
 * AI_SCREEN, ATS_PUSH or recruiter-private NOTE rows. The events API
 * (GET /api/applications/[id]/events) enforces that filter; keep notes on
 * STATUS_CHANGE / OFFER rows candidate-neutral (no AI scores, no verdicts).
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'

export const APPLICATION_EVENT_TYPES = [
  'STATUS_CHANGE',
  'VIEWED',
  'NOTE',
  'OFFER',
  'OFFER_RESPONSE',
  'AI_SCREEN',
  'AI_INVITE',
  'SHARED_WITH_CLIENT',
  'CLIENT_DECISION',
  'RECRUITER_DECISION', // the HUMAN final call after an AI interview (AI verdict stays advisory)
  'ATS_PUSH',
  'ONBOARD',
] as const

export type ApplicationEventType = (typeof APPLICATION_EVENT_TYPES)[number]

/** Actor roles — mirrors the master spec. */
export type ApplicationEventActorRole = 'RECRUITER' | 'CANDIDATE' | 'SYSTEM' | 'CLIENT' | 'ADMIN'

/** Any Prisma client handle: the singleton `db` or a `$transaction` `tx`. */
export type PrismaClientLike = PrismaClient | Prisma.TransactionClient

export interface ApplicationEventInput {
  applicationId: string
  type: ApplicationEventType
  fromStatus?: string | null
  toStatus?: string | null
  actorRole?: ApplicationEventActorRole | null
  actorName?: string | null
  note?: string | null
}

/** Whitelist guard so a typo can never smuggle an unknown type into the trail. */
function isKnownType(type: string): type is ApplicationEventType {
  return (APPLICATION_EVENT_TYPES as readonly string[]).includes(type)
}

function clean(v: string | null | undefined, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t.slice(0, max) : null
}

/**
 * Insert one ApplicationEvent row. Pass `db` (default) or the `tx` handle when
 * the surrounding mutation already runs inside a $transaction, so the event
 * commits or rolls back atomically with the mutation itself.
 */
export async function logApplicationEvent(
  client: PrismaClientLike,
  input: ApplicationEventInput
): Promise<void> {
  if (!input?.applicationId || !isKnownType(input.type)) {
    // Programming error — surface it loudly in dev.log but never throw into
    // the caller's flow (all call sites treat logging as best-effort).
    console.error('[application-events] invalid event input:', input)
    return
  }
  await client.applicationEvent.create({
    data: {
      applicationId: input.applicationId,
      type: input.type,
      fromStatus: clean(input.fromStatus, 60),
      toStatus: clean(input.toStatus, 60),
      actorRole: clean(input.actorRole, 20),
      actorName: clean(input.actorName, 120),
      note: clean(input.note, 400),
    },
  })
}

/**
 * Fire-and-forget variant for call sites WITHOUT a transaction: the event is
 * written AFTER the mutation succeeded and a failure is swallowed (logged)
 * so the main flow is never broken.
 */
export function logApplicationEventSafe(input: ApplicationEventInput): void {
  void logApplicationEvent(db, input).catch((err) => {
    console.error('[application-events] non-fatal log failure:', input.type, err)
  })
}

/** Look up a display name for an actor id (best-effort, never throws). */
export async function actorNameFor(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  try {
    const u = await db.user.findUnique({ where: { id: userId }, select: { name: true } })
    return u?.name ?? null
  } catch {
    return null
  }
}
