// SeeWe - shared interview-media path helpers
// Recorded interview answers (webm video/audio) live on disk under
// upload/interview-media/ — the same directory /api/interview/answer writes
// to and /api/interview/media/[file] streams from. This module centralizes
// the path + safe-read logic for backend consumers (e.g. the multi-factor
// evaluation pipeline that runs ASR over voice answers).

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export const INTERVIEW_MEDIA_DIR = path.join(process.cwd(), 'upload', 'interview-media')

// Only server-generated names can pass: `{interviewId}-q{n}-{ts}.webm` —
// strict allow-list blocks traversal (same contract as the media route).
const SAFE_NAME = /^[A-Za-z0-9_-]+\.webm$/

/** Resolve a stored media filename to an absolute path, or null when unsafe. */
export function resolveMediaPath(filename: string): string | null {
  if (!SAFE_NAME.test(filename)) return null
  const filePath = path.join(INTERVIEW_MEDIA_DIR, filename)
  if (!filePath.startsWith(INTERVIEW_MEDIA_DIR + path.sep)) return null
  return filePath
}

/**
 * Read a recorded answer file as base64 for the ASR service.
 * Returns null (never throws) when the file is missing, unreadable or
 * implausibly large — callers must degrade gracefully to an empty transcript.
 */
export async function readMediaAsBase64(
  filename: string,
  maxBytes = 12 * 1024 * 1024
): Promise<string | null> {
  try {
    const filePath = resolveMediaPath(filename)
    if (!filePath) return null
    const fileStat = await stat(filePath)
    if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > maxBytes) return null
    const buf = await readFile(filePath)
    return buf.toString('base64')
  } catch {
    return null
  }
}

/**
 * Relative, same-origin URL that streams one recorded answer.
 * Documented contract: the value is RELATIVE to the platform origin — clients
 * (and ATS receivers) resolve it against the SeeWe base URL, e.g.
 * `https://<host>` + `/api/interview/media/<file>`.
 */
export function interviewMediaUrl(filename: string | null | undefined): string | null {
  if (!filename) return null
  if (!SAFE_NAME.test(filename)) return null
  return `/api/interview/media/${filename}`
}
