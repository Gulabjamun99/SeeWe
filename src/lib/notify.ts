import { db } from '@/lib/db'

export type NotificationType =
  | 'APPLICATION' // recruiter: someone applied to your job
  | 'SHORTLIST' // candidate: you were shortlisted
  | 'INTERVIEW_DONE' // recruiter: AI interview completed with score
  | 'CLIENT_VERDICT' // recruiter + candidate: client approved/rejected/on-hold
  | 'REPORT_SHARED' // client partner: a new AI report was shared with you
  | 'OFFER' // candidate: offer received · recruiter: offer accepted/declined
  | 'ONBOARDING' // recruiter: onboarding progress on a hire
  | 'REQUISITION' // recruiter: requisition approved / rejected / published by leadership

export interface NotificationMeta {
  jobId?: string
  applicationId?: string
  shortlistId?: string
  actorName?: string
  jobTitle?: string
  candidateName?: string
  clientName?: string
  decision?: string
  score?: number
  [key: string]: unknown
}

/**
 * Fire-and-forget in-app notification. NEVER throws — notification failures
 * must not break the primary business flow (apply / shortlist / share / decide).
 */
export async function notify(params: {
  userId: string
  type: NotificationType
  title: string
  body?: string
  meta?: NotificationMeta
}): Promise<void> {
  try {
    if (!params.userId) return
    await db.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title.slice(0, 140),
        body: (params.body ?? '').slice(0, 400),
        meta: params.meta ? JSON.stringify(params.meta) : null,
      },
    })
  } catch (err) {
    console.error('[notify] Failed to create notification (non-fatal):', err)
  }
}

/** Create notifications for several users at once (best-effort, parallel). */
export async function notifyMany(
  items: Array<Parameters<typeof notify>[0]>
): Promise<void> {
  await Promise.all(items.map((item) => notify(item)))
}
