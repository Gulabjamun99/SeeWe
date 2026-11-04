// SeeWe - browser-side CV file helpers (candidate surfaces only)

import type { CvUploadPayload } from '@/lib/cv'

/** Client-side guard mirroring the server rules — fail fast before uploading */
export const MAX_CV_BYTES = 4 * 1024 * 1024

export const CV_ACCEPT = '.pdf,.doc,.docx'

export function cvFileError(file: File): string | null {
  const name = file.name.toLowerCase()
  const okExt = name.endsWith('.pdf') || name.endsWith('.doc') || name.endsWith('.docx')
  if (!okExt) return 'Please choose a PDF, DOC or DOCX file'
  if (file.size > MAX_CV_BYTES) return 'File too large — maximum size is 4 MB'
  if (file.size < 64) return 'The file looks empty — please choose a valid document'
  return null
}

/** Read a File into the JSON payload the CV endpoints accept */
export function fileToCvPayload(file: File): Promise<CvUploadPayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({
        fileName: file.name,
        mimeType: file.type || guessCvMime(file.name),
        dataUrl: String(reader.result),
      })
    reader.onerror = () => reject(new Error('file-read-failed'))
    reader.readAsDataURL(file)
  })
}

function guessCvMime(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.pdf')) return 'application/pdf'
  if (lower.endsWith('.doc')) return 'application/msword'
  return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

/** Human file size for UI chips */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
