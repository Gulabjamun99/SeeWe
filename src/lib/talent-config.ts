/**
 * talent-config — SERVER-ONLY quota enforcement for the sourcing module.
 * Constants live in talent-constants.ts (client-safe); this file adds the
 * UsageLog-backed daily quota checks. Usage is tracked per recruiter per
 * calendar day and enforced on the SERVER — quota bypass through direct API
 * requests is not possible because every counted operation re-checks here.
 */

import { db } from '@/lib/db'
import { TALENT_QUOTAS, type QuotaKind } from '@/lib/talent-constants'

export { TALENT_QUOTAS, SOURCING_STATUSES, SOURCING_STATUS_META } from '@/lib/talent-constants'
export type { QuotaKind, SourcingStatus } from '@/lib/talent-constants'

/** Map a UsageLog kind to its quota key (1:1 today). */
export function quotaKindFor(kind: string): QuotaKind | null {
  if (kind in TALENT_QUOTAS) return kind as QuotaKind
  return null
}

/** Check a quota for a recruiter; returns { allowed, used, limit }. */
export async function checkQuota(
  actorId: string,
  kind: QuotaKind
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const limit = TALENT_QUOTAS[kind]
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  const used = await db.usageLog.count({
    where: { actorId, kind, createdAt: { gte: since } },
  })
  return { allowed: used < limit, used, limit }
}
