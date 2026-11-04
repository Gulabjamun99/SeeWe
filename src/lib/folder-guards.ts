/**
 * Folder guards — recruiter ownership checks for the candidate-folders CRM
 * (master spec §9). Every /api/recruiters/folders* endpoint must verify:
 *   1. the caller exists and has role RECRUITER
 *   2. the folder (when addressed) is owned by that recruiter
 * A mismatch is a hard 403 — folders are recruiter-private data.
 */
import { db } from '@/lib/db'
import type { CandidateFolder } from '@prisma/client'

export interface RecruiterIdentity {
  id: string
  name: string
}

/** Resolve + validate the recruiter identity from an explicit id param. */
export async function resolveRecruiter(
  recruiterId: unknown
): Promise<RecruiterIdentity | null> {
  if (typeof recruiterId !== 'string' || recruiterId.trim().length === 0) return null
  const user = await db.user.findUnique({
    where: { id: recruiterId.trim() },
    select: { id: true, name: true, role: true },
  })
  if (!user || user.role !== 'RECRUITER') return null
  return { id: user.id, name: user.name }
}

export type FolderGuardResult =
  | { ok: true; folder: CandidateFolder }
  | { ok: false; status: 403 | 404; error: string }

/** Load the folder and prove it belongs to this recruiter (403 otherwise). */
export async function assertOwnedFolder(
  folderId: unknown,
  recruiterId: string
): Promise<FolderGuardResult> {
  if (typeof folderId !== 'string' || folderId.trim().length === 0) {
    return { ok: false, status: 404, error: 'Folder not found' }
  }
  const folder = await db.candidateFolder.findUnique({ where: { id: folderId.trim() } })
  if (!folder) {
    return { ok: false, status: 404, error: 'Folder not found' }
  }
  if (folder.recruiterId !== recruiterId) {
    return { ok: false, status: 403, error: 'This folder belongs to another recruiter' }
  }
  return { ok: true, folder }
}

export type NormaliseResult =
  | { ok: true; value: string | null | undefined } // undefined = field absent (no change)
  | { ok: false }

/** Normalise a comma-separated tags payload → clean csv string or null. */
export function normaliseTags(v: unknown): NormaliseResult {
  if (v === undefined) return { ok: true, value: undefined }
  if (v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false }
  const csv = v
    .split(',')
    .map((t) => t.trim().slice(0, 30))
    .filter(Boolean)
    .slice(0, 12)
    .join(',')
  return { ok: true, value: csv.length > 0 ? csv : null }
}

/** Normalise a folder-scoped note payload. */
export function normaliseNote(v: unknown): NormaliseResult {
  if (v === undefined) return { ok: true, value: undefined }
  if (v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false }
  const t = v.trim().slice(0, 500)
  return { ok: true, value: t.length > 0 ? t : null }
}
