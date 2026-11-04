// SeeWe - interview deep-link token helpers
// Two-way AI video interviews can be opened WITHOUT LOGIN via
// /?interview=<token>. The token lives on Application.interviewToken (unique)
// with a 7-day expiry (Application.tokenExpiry), is generated when the
// recruiter sends the invite, and authorizes ONLY that application's
// interview round (never any score/evaluation data).

import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import type { Application } from '@prisma/client'

export const INTERVIEW_TOKEN_TTL_DAYS = 7

export function newInterviewToken(): string {
  return randomUUID()
}

export function interviewTokenExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INTERVIEW_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000)
}

/** Find the application a token belongs to; null when unknown. */
export async function findApplicationByToken(token: string): Promise<Application | null> {
  const trimmed = (token ?? '').trim()
  if (!trimmed) return null
  return db.application.findUnique({ where: { interviewToken: trimmed } })
}

/** Token validity: known application + unexpired token. */
export function isTokenValid(app: Application | null, now: Date = new Date()): boolean {
  if (!app || !app.interviewToken) return false
  if (app.tokenExpiry && app.tokenExpiry.getTime() < now.getTime()) return false
  return true
}

/** The application's most recent shortlist (the pipeline anchor). */
export async function latestShortlistId(applicationId: string): Promise<string | null> {
  const shortlist = await db.shortlist.findFirst({
    where: { applicationId },
    orderBy: { createdAt: 'desc' as const },
    select: { id: true },
  })
  return shortlist?.id ?? null
}
