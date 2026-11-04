import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 1_500_000 // ~1.5MB base64 ceiling — avatar-size photos only
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp']

/**
 * POST /api/candidates/[id]/photo — set the profile photo.
 * body: { dataUrl } — a "data:image/png;base64,..." string (client resizes to
 * ~320px before upload; the server only enforces a size ceiling).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => null)
    const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : ''

    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
    if (!match) {
      return NextResponse.json(
        { error: 'Send the photo as a base64 data URL (jpeg/png/webp)' },
        { status: 400 }
      )
    }
    const [, mime, base64] = match
    if (!ALLOWED_MIME.includes(mime)) {
      return NextResponse.json({ error: 'Only JPEG, PNG or WebP photos are supported' }, { status: 400 })
    }
    if (base64.length > MAX_BYTES) {
      return NextResponse.json(
        { error: 'Photo is too large — please pick a smaller image (max ~1MB)' },
        { status: 413 }
      )
    }

    await db.user.update({
      where: { id },
      data: {
        photoData: base64,
        photoMime: mime,
        photoUploadedAt: new Date(),
      },
    })

    return NextResponse.json({
      data: { photoUrl: `/api/candidates/${id}/photo?v=${Date.now()}`, uploaded: true },
    })
  } catch (err) {
    console.error('POST /api/candidates/[id]/photo failed:', err)
    return NextResponse.json({ error: 'Photo upload failed' }, { status: 500 })
  }
}

/** GET /api/candidates/[id]/photo — stream the profile photo (or 404). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await db.user.findUnique({
      where: { id },
      select: { photoData: true, photoMime: true },
    })
    if (!user?.photoData || !user.photoMime) {
      return NextResponse.json({ error: 'No photo' }, { status: 404 })
    }
    const bytes = Buffer.from(user.photoData, 'base64')
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': user.photoMime,
        'Cache-Control': 'public, max-age=60',
      },
    })
  } catch (err) {
    console.error('GET /api/candidates/[id]/photo failed:', err)
    return NextResponse.json({ error: 'Photo fetch failed' }, { status: 500 })
  }
}

/** DELETE /api/candidates/[id]/photo — remove the profile photo. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    await db.user.update({
      where: { id },
      data: { photoData: null, photoMime: null, photoUploadedAt: null },
    })
    return NextResponse.json({ data: { removed: true } })
  } catch (err) {
    console.error('DELETE /api/candidates/[id]/photo failed:', err)
    return NextResponse.json({ error: 'Photo removal failed' }, { status: 500 })
  }
}
