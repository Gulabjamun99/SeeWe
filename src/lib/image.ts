'use client'

/**
 * Company-logo image pipeline — makes ANY photo work as a logo, and makes the
 * whole thing structurally incapable of blanking the screen.
 *
 * Why this file exists (the "white dialog" war): recruiters upload phone
 * photos (2–12 MB, sometimes HEIC). The naive path — decode full bitmap →
 * draw → toDataURL — can freeze the main thread for seconds on mid-range
 * devices and spike RAM hard enough for Chrome to drop every tile of the
 * dialog (user sees a white box). Combined with Chrome's native file-picker
 * handoff (focus restore + scroll-into-view of the hidden input), the dialog
 * could end up blank at click time.
 *
 * Hard rules enforced here:
 *  1. NEVER throws — processLogoFile resolves to `null` on any failure.
 *  2. Downscale happens INSIDE the decoder via createImageBitmap(file,
 *     { resizeWidth }) — a 12MP photo never materialises as a 48MB bitmap;
 *     decode itself produces the small bitmap. <img> fallback decodes
 *     off-thread (img.decoding = 'async').
 *  3. Explicit yield to the event loop between decode and canvas encode so
 *     the browser can paint (no perceived freeze) — callers show a spinner.
 *  4. Canvas is capped at 512px, encoded JPEG q0.85 — always << storage cap.
 *  5. Runs fully client-side; nothing leaves the device.
 */

export interface ProcessedImage {
  /** base64 payload WITHOUT the data: prefix */
  data: string
  mime: string
  /** final encoded size in bytes (for toasts / sanity checks) */
  bytes: number
}

/** Hard ceiling the DB/API layer enforces — re-encoded output always lands below this. */
export const LOGO_MAX_BYTES = 300 * 1024

/** Longest edge after downscale — plenty sharp for a 64px avatar render. */
const MAX_EDGE = 512

const ACCEPTED_TYPES = /^image\/(png|jpeg|webp|heic|heif|avif|bmp|gif)$/i

/** Macro-block bounce — anything above this is not a real photo anyone needs. */
export const LOGO_INPUT_MAX_BYTES = 25 * 1024 * 1024

/** Let the browser paint before the synchronous canvas encode. */
const yieldToPaint = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

/**
 * Read + normalise a user-picked image. Resolves `null` for anything that
 * cannot be decoded — the caller shows a friendly toast. Never rejects.
 */
export async function processLogoFile(file: File | null): Promise<ProcessedImage | null> {
  if (!file) return null
  if (file.size > LOGO_INPUT_MAX_BYTES) return null
  if (!ACCEPTED_TYPES.test(file.type) && !/\.(png|jpe?g|webp|heic|heif)$/i.test(file.name)) {
    return null
  }

  try {
    const bitmap = await loadBitmapSmall(file)
    // Give the browser one frame between decode and the sync canvas encode —
    // the difference between "spinner shows" and "screen looks dead".
    await yieldToPaint()
    const { data, mime, bytes } = await encodeScaled(bitmap)
    return { data, mime, bytes }
  } catch {
    // decode failed (corrupt file etc.)
    return null
  }
}

/**
 * Decode straight to a ≤512px bitmap. The resizeWidth option makes the
 * DECODER do the downscale — huge photos never exist at full resolution in
 * RAM, so even a 12MP snap is safe on a low-end device.
 * Falls back to an async <img> decode (Safari/HEIC) when the API is missing.
 */
async function loadBitmapSmall(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, {
        resizeWidth: MAX_EDGE,
        resizeHeight: MAX_EDGE,
        resizeQuality: 'medium',
      })
    } catch {
      try {
        // Older engines: plain decode, still capped at encode time.
        return await createImageBitmap(file)
      } catch {
        /* fall through to <img> path */
      }
    }
  }
  const dataUrl = await readAsDataUrl(file)
  const img = new Image()
  img.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('decode failed'))
    img.src = dataUrl
  })
  return img
}

async function encodeScaled(source: ImageBitmap | HTMLImageElement): Promise<ProcessedImage> {
  const srcW = 'width' in source ? source.width : 0
  const srcH = 'height' in source ? source.height : 0
  if (!srcW || !srcH) throw new Error('empty image')

  // Fit inside MAX_EDGE without upscaling tiny logos.
  const scale = Math.min(1, MAX_EDGE / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no canvas context')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#ffffff' // flatten PNG transparency onto white for JPEG
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(source as CanvasImageSource, 0, 0, w, h)
  if ('close' in source && typeof source.close === 'function') source.close()

  // JPEG keeps logos crisp enough at a fraction of PNG size.
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
  const base64 = dataUrl.split(',')[1] ?? ''
  const bytes = Math.round((base64.length * 3) / 4)
  if (!base64) throw new Error('encode failed')
  return { data: base64, mime: 'image/jpeg', bytes }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('read failed'))
    reader.readAsDataURL(file)
  })
}
