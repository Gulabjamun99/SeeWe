// SeeWe - GET /api/emails?userId=...
//
// The candidate's process mailbox — every status/interview/offer email the
// platform has sent to this user, newest first. This makes the "email sent to
// the candidate's address" flow visible inside the app (the sandbox has no
// outbound SMTP relay; mails are recorded rather than delivered).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }
    const emails = await db.emailLog.findMany({
      where: { toUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        toEmail: true,
        subject: true,
        body: true,
        kind: true,
        status: true,
        createdAt: true,
      },
    })
    return NextResponse.json({ data: emails })
  } catch (err) {
    console.error('GET /api/emails failed:', err)
    return NextResponse.json({ error: 'Failed to load emails' }, { status: 500 })
  }
}
