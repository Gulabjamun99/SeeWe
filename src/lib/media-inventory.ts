// SeeWe - shared interview-media inventory helpers
// Used by:
//   GET  /api/interview/media-list  (recruiter/candidate inventory)
//   GET  /api/interview/media-zip   (bulk ZIP download)
//   POST /api/interview/media-gc    (storage hygiene: orphans + TTL expiry)
//
// Scope rules: callers MUST pass recruiterId or candidateId — never expose
// the whole table (mirrors the media-list route contract).

import path from 'node:path'
import { stat } from 'node:fs/promises'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { MediaListItem } from '@/lib/types'

export const MEDIA_DIR = path.join(process.cwd(), 'upload', 'interview-media')

export type MediaScope = { recruiterId?: string; candidateId?: string }

/**
 * Every recorded interview answer (video/audio) visible to the given scope,
 * newest first. Scoped via shortlist → application → job → recruiter, or the
 * candidate's own applications.
 */
export async function listMediaItems(scope: MediaScope): Promise<MediaListItem[]> {
  const interviewWhere: Prisma.InterviewWhereInput = scope.recruiterId
    ? { shortlist: { application: { is: { job: { is: { recruiterId: scope.recruiterId } } } } } }
    : { shortlist: { application: { is: { candidateId: scope.candidateId as string } } } }

  const interviews = await db.interview.findMany({
    where: interviewWhere,
    orderBy: { createdAt: 'desc' as const },
    // Safety bound: the inventory fans out per-answer + per-file stat() work;
    // an unbounded scan could stall the route on a very large dataset.
    take: 300,
    select: {
      id: true,
      status: true,
      overallScore: true,
      verdict: true,
      candidateName: true,
      jobTitle: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
      answers: {
        where: { mediaPath: { not: null } },
        select: {
          id: true,
          qIndex: true,
          question: true,
          score: true,
          mediaPath: true,
          mediaKind: true,
          mediaSeconds: true,
          takeLabel: true,
        },
        orderBy: { qIndex: 'asc' as const },
      },
      shortlist: {
        select: {
          applicationId: true,
          clientDecision: true,
          client: { select: { name: true } },
          application: {
            select: {
              id: true,
              candidate: { select: { name: true, email: true } },
              job: { select: { id: true, title: true, company: true } },
            },
          },
        },
      },
    },
  })

  const items: MediaListItem[] = []
  for (const iv of interviews) {
    const app = iv.shortlist?.application
    // Answer rows carry no timestamp of their own — use the interview's
    // completion (or start) time as the best available "recorded at" proxy.
    const recordedAt = iv.completedAt ?? iv.startedAt ?? iv.createdAt
    for (const a of iv.answers) {
      if (!a.mediaPath) continue
      items.push({
        id: a.id,
        interviewId: iv.id,
        mediaFile: a.mediaPath,
        mediaKind: a.mediaKind === 'audio' ? 'audio' : 'video',
        mediaSeconds: a.mediaSeconds,
        takeLabel: a.takeLabel === 'A' || a.takeLabel === 'B' ? a.takeLabel : null,
        qIndex: a.qIndex,
        question: a.question,
        score: a.score,
        interviewStatus: iv.status,
        overallScore: iv.overallScore,
        verdict: iv.verdict,
        candidateName: app?.candidate?.name ?? iv.candidateName,
        candidateEmail: app?.candidate?.email ?? '',
        jobTitle: app?.job?.title ?? iv.jobTitle,
        company: app?.job?.company ?? '',
        jobId: app?.job?.id ?? null,
        applicationId: app?.id ?? iv.shortlist?.applicationId ?? null,
        clientName: iv.shortlist?.client?.name ?? null,
        sharedWithClient: Boolean(iv.shortlist?.clientDecision),
        recordedAt: recordedAt ? new Date(recordedAt).toISOString() : null,
      })
    }
  }

  // newest recordings first
  items.sort((a, b) => {
    const ta = a.recordedAt ? Date.parse(a.recordedAt) : 0
    const tb = b.recordedAt ? Date.parse(b.recordedAt) : 0
    return tb - ta
  })

  // Attach on-disk sizes (null when a file was already GC'd) so the UI can
  // show a real storage figure instead of guessing.
  await Promise.all(
    items.map(async (it) => {
      try {
        const s = await stat(path.join(MEDIA_DIR, it.mediaFile))
        it.bytes = s.isFile() ? s.size : null
      } catch {
        it.bytes = null
      }
    })
  )

  return items
}

/** "Meghna Pillai" -> "Meghna-Pillai", filename-safe */
export function slugifyName(raw: string, max = 40): string {
  const slug = raw
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return slug || 'interview'
}
