// SeeWe - CV (resume document) upload validation shared by the candidate
// profile endpoint and the apply-time attachment path.
//
// Supported formats: PDF, DOC, DOCX (what recruiters' ATS tools expect).
// The file is stored base64 in SQLite and streamed back through dedicated
// GET endpoints — it never touches the public folder.

export const MAX_CV_BYTES = 4 * 1024 * 1024 // 4 MB binary (~5.4 MB base64)

export const ALLOWED_CV_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const

export interface CvUploadPayload {
  fileName: string
  mimeType: string
  dataUrl: string // data:<mime>;base64,<payload> (raw base64 also tolerated)
}

export interface ValidatedCv {
  fileName: string
  mimeType: string
  base64: string
  bytes: number
}

/** Human-readable list for error messages */
export function allowedCvLabel(): string {
  return 'PDF, DOC or DOCX up to 4 MB'
}

/**
 * Validate + normalize an incoming CV upload. Returns a discriminated result
 * so API routes can answer with a precise 400 instead of guessing.
 */
export function validateCvUpload(input: unknown): { ok: true; cv: ValidatedCv } | { ok: false; error: string } {
  const body = input as Partial<CvUploadPayload> | null
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid request body' }
  }
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : ''
  const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : ''

  if (!fileName || fileName.length > 180) {
    return { ok: false, error: 'A file name is required (max 180 characters)' }
  }
  if (!ALLOWED_CV_MIME.includes(mimeType as (typeof ALLOWED_CV_MIME)[number])) {
    return { ok: false, error: `Unsupported file type — please upload ${allowedCvLabel()}` }
  }

  // Accept a data URL or raw base64
  const commaIdx = dataUrl.indexOf(',')
  const header = (commaIdx !== -1 ? dataUrl.slice(0, commaIdx) : '').toLowerCase()
  const raw = commaIdx !== -1 ? dataUrl.slice(commaIdx + 1) : dataUrl
  if (header && !header.startsWith('data:')) {
    return { ok: false, error: 'Invalid file encoding' }
  }
  if (!raw || raw.length < 64) {
    return { ok: false, error: 'The file looks empty — please choose a valid document' }
  }
  if (raw.length > Math.ceil((MAX_CV_BYTES * 4) / 3) + 1024) {
    return { ok: false, error: 'File too large — maximum size is 4 MB' }
  }

  const buf = Buffer.from(raw, 'base64')
  if (buf.length < 64) {
    return { ok: false, error: 'The file looks empty — please choose a valid document' }
  }
  if (buf.length > MAX_CV_BYTES) {
    return { ok: false, error: 'File too large — maximum size is 4 MB' }
  }

  // Magic-byte sniff — never trust the claimed mime type alone
  const isPdf =
    buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46
  const isZip =
    buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)
  const isLegacyDoc =
    buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0
  const sniffs = mimeType === 'application/pdf' ? isPdf : mimeType === 'application/msword' ? isLegacyDoc || isZip : isZip
  if (!sniffs) {
    return { ok: false, error: 'File content does not match its type — please re-export and upload again' }
  }

  return {
    ok: true,
    cv: { fileName, mimeType, base64: raw, bytes: buf.length },
  }
}
