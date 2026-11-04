// GET /api/talent/ads — sponsored employer-branding slots for the Talent
// Search landing panel (the space shown BEFORE the first search, while the
// candidate database stays hidden).
//
// Returns active ads only: `house` cards promote SeeWe modules, `sponsored`
// cards are advertiser slots. Current seeds are clearly-labelled synthetic
// demo advertisers (same data-lineage policy as the candidate pool).

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const ads = await db.talentAd.findMany({
      where: { active: true },
      select: {
        id: true, company: true, headline: true, body: true,
        ctaLabel: true, ctaUrl: true, accent: true, kind: true,
      },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
      take: 8,
    })
    return NextResponse.json({ data: ads })
  } catch (err) {
    console.error('GET /api/talent/ads failed:', err)
    // the landing panel degrades gracefully without ads — never 500 the UI
    return NextResponse.json({ data: [] })
  }
}
