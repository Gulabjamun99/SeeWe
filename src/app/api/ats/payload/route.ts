// SeeWe - /api/ats/payload?interviewId=...
// Returns the exact ATS dossier JSON for one interview — used by the
// recruiter-facing "Copy JSON" and "Download JSON" actions so the candidate
// can be imported into any ATS manually (no webhook required).

import { NextResponse } from 'next/server'
import { buildAtsDossier } from '@/lib/ats'

export async function GET(request: Request) {
  try {
    const interviewId = new URL(request.url).searchParams.get('interviewId')?.trim() ?? ''
    if (!interviewId) {
      return NextResponse.json({ error: 'interviewId is required' }, { status: 400 })
    }

    const dossier = await buildAtsDossier(interviewId)
    if (!dossier) {
      return NextResponse.json({ error: 'Interview not found' }, { status: 404 })
    }

    return NextResponse.json({ data: dossier })
  } catch (error) {
    console.error('[ats/payload] Unexpected error:', error)
    return NextResponse.json({ error: 'Failed to build ATS payload' }, { status: 500 })
  }
}
