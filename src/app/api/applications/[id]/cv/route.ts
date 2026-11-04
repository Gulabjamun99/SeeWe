// SeeWe - /api/applications/[id]/cv
//
// Streams the CV snapshot attached to a specific application — the exact
// document the candidate applied with (copied from their profile at apply
// time, or uploaded fresh in the apply dialog). Recruiters use this from the
// Applicants panel and the ATS payload references the same URL.
// `?inline=1` previews the document in the browser; default is a download
// with the candidate's original file name.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { MAX_CV_BYTES } from '@/lib/cv'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const app = await db.application.findUnique({
      where: { id },
      select: {
        cvFileName: true,
        cvMimeType: true,
        cvData: true,
        candidate: { select: { name: true } },
      },
    })
    if (!app) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }
    if (!app.cvData || !app.cvFileName) {
      return NextResponse.json(
        { error: 'No CV was attached to this application' },
        { status: 404 }
      )
    }

    const buf = Buffer.from(app.cvData, 'base64')
    if (buf.length === 0 || buf.length > MAX_CV_BYTES * 2) {
      return NextResponse.json({ error: 'Stored CV is unreadable' }, { status: 500 })
    }

    const inline = req.nextUrl.searchParams.get('inline') === '1'
    const safeName = app.cvFileName.replace(/["\\\r\n]/g, '_')
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': app.cvMimeType || 'application/octet-stream',
        'Content-Length': String(buf.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"`,
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (err) {
    console.error('GET /api/applications/[id]/cv failed:', err)
    return NextResponse.json({ error: 'Failed to load CV' }, { status: 500 })
  }
}
