/**
 * seed-talent-ads.ts — sponsored slots for the Talent Search landing panel.
 *
 * ⚠️  DATA LINEAGE: every advertiser here is a clearly-labelled SYNTHETIC demo
 * account (part of the same synthetic seed universe as the candidate pool —
 * fictional employers, fictional campaigns). Nothing is a real company.
 * The `house` card promotes a real SeeWe module.
 *
 * Idempotent: count-guarded (skips when ads already exist).
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ADS = [
  {
    kind: 'house',
    company: 'SeeWe AI Interview Suite',
    headline: 'Screen 10× faster with AI interviews',
    body: 'Auto-scheduled voice interviews, transparent scorecards and instant summaries — built into the same suite you are searching from.',
    ctaLabel: 'Open Interview Hub',
    ctaUrl: '#',
    accent: 'teal',
  },
  {
    kind: 'sponsored',
    company: 'Bharat Distribution Co.',
    headline: 'Hiring 200+ warehouse & ops leaders',
    body: 'Rapidly growing fulfilment network across 14 cities. Recruiter desk: 40 open roles in WMS, lean ops and fleet management. (Demo advertiser — synthetic campaign.)',
    ctaLabel: 'View open roles',
    ctaUrl: '#',
    accent: 'amber',
  },
  {
    kind: 'sponsored',
    company: 'TechNova Solutions',
    headline: 'Engineering campus 2026 — now sourcing',
    body: 'Platform, data and QA teams doubling this year. Walk-in drives every second Saturday at the Pune campus. (Demo advertiser — synthetic campaign.)',
    ctaLabel: 'Meet the teams',
    ctaUrl: '#',
    accent: 'rose',
  },
  {
    kind: 'sponsored',
    company: 'SafeMove Logistics',
    headline: 'Your employer brand on this panel',
    body: 'This slot reaches every recruiter between searches. Feature campaigns, hiring events and EVP stories here. (Demo advertiser — synthetic campaign.)',
    ctaLabel: 'Advertise with us',
    ctaUrl: '#',
    accent: 'slate',
  },
]

async function main() {
  const existing = await prisma.talentAd.count()
  if (existing > 0) {
    console.log(`[seed-talent-ads] ${existing} ads already present — skipping (idempotent).`)
    return
  }
  for (const ad of ADS) {
    await prisma.talentAd.create({ data: ad })
  }
  console.log(`[seed-talent-ads] inserted ${ADS.length} demo ad slots.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
