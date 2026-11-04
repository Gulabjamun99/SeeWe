import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/* ------------------------------------------------------------------ */
/* Referral guilds — candidate-run community spaces                    */
/* GET /api/guilds?userId=…  → directory (with per-user join state)    */
/* POST /api/guilds           → create a guild (creator becomes LEAD)  */
/* ------------------------------------------------------------------ */

export const dynamic = 'force-dynamic'

/** Normalise a guild name into a URL-safe slug ("Frontend Guild" → "frontend-guild"). */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'guild'
}

/** First free slug: "x", then "x-2", "x-3", … on collisions. */
async function uniqueSlug(base: string): Promise<string> {
  let candidate = base
  let n = 2
  // Bounded loop — slugs are short and collisions are rare in practice.
  while ((await db.referralGuild.findUnique({ where: { slug: candidate }, select: { id: true } })) !== null) {
    candidate = `${base}-${n}`
    n += 1
    if (n > 100) {
      candidate = `${base}-${Date.now()}`
      break
    }
  }
  return candidate
}

const GUILD_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  focus: true,
  description: true,
  createdAt: true,
  _count: { select: { members: true, posts: true } },
} as const

function toListGuild(
  guild: {
    id: string
    name: string
    slug: string
    focus: string
    description: string
    createdAt: Date
    _count: { members: number; posts: number }
  },
  membership?: { role: string } | null
) {
  return {
    id: guild.id,
    name: guild.name,
    slug: guild.slug,
    focus: guild.focus,
    description: guild.description,
    memberCount: guild._count.members,
    postCount: guild._count.posts,
    joined: Boolean(membership),
    myRole: membership?.role ?? null,
  }
}

/* ----------------------------- demo seeding ----------------------------- */
/* Idempotent: runs only while the table is completely empty. Authored by
 * existing seeded demo candidates; company references are plain generic
 * names already present in the demo database. Wrapped in try/catch by the
 * caller so a seeding failure can never turn the directory GET into a 500. */

interface SeedPost {
  authorEmail: string
  fallbackIdx: number
  kind: 'REFERRAL' | 'ASK' | 'UPDATE'
  title: string
  body: string
  jobTitle?: string
  companyName?: string
  hoursAgo: number
}

const SHARED_GUIDELINE =
  'Referrals are a favor, not a right — always share context and say thanks.'

async function seedDemoGuildsIfEmpty(): Promise<void> {
  const existing = await db.referralGuild.count()
  if (existing > 0) return

  const candidates = await db.user.findMany({
    where: { role: 'CANDIDATE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  })
  // Without at least one real candidate user there is nobody to own a guild.
  if (candidates.length === 0) return

  const byEmail = new Map(candidates.map((c) => [c.email, c.id]))
  const uid = (email: string, fallbackIdx: number): string =>
    byEmail.get(email) ?? candidates[fallbackIdx % candidates.length].id

  const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000)

  const GUILDS: Array<{
    name: string
    slug: string
    focus: string
    description: string
    guidelines: string
    creatorEmail: string
    creatorFallback: number
    memberEmails: Array<{ email: string; fallback: number }>
    posts: SeedPost[]
    createdHoursAgo: number
  }> = [
    {
      name: 'Frontend Guild',
      slug: 'frontend-guild',
      focus: 'Frontend',
      description:
        'A peer circle for frontend engineers navigating the job market together. Members post referral openings they can vouch for, ask for warm intros and swap honest notes on take-homes, portfolios and interview loops before applications go out.',
      guidelines: `${SHARED_GUIDELINE} Keep posts specific about role, stack and seniority, and never paste someone's contact details without their okay.`,
      creatorEmail: 'rohan.joshi@gmail.com',
      creatorFallback: 4,
      memberEmails: [
        { email: 'sneha.kulkarni@gmail.com', fallback: 1 },
        { email: 'neha.gupta@gmail.com', fallback: 7 },
      ],
      posts: [
        {
          authorEmail: 'rohan.joshi@gmail.com',
          fallbackIdx: 4,
          kind: 'REFERRAL',
          title: 'Offering: intro to my platform team — Senior Frontend (React)',
          body: 'Two frontend seats just opened on our web platform team: React + TypeScript, 4+ yrs, design-systems experience is a real plus. I can put strong people directly in front of the hiring manager with context. Share a few lines on what you have shipped and the role you are targeting — I will be honest about fit, and I only refer people I would staff myself.',
          jobTitle: 'Senior Frontend Engineer',
          companyName: 'CloudNine',
          hoursAgo: 5,
        },
        {
          authorEmail: 'neha.gupta@gmail.com',
          fallbackIdx: 7,
          kind: 'ASK',
          title: 'Ask: referral for a senior frontend role — React + design systems',
          body: 'Coming from an Android background and moving toward more web-adjacent work. Looking for a warm intro to teams hiring senior frontend engineers (React, component libraries, accessibility). Happy to return the favor — I can vouch for mobile folks at my current org any day.',
          jobTitle: 'Senior Frontend Engineer',
          hoursAgo: 30,
        },
        {
          authorEmail: 'sneha.kulkarni@gmail.com',
          fallbackIdx: 1,
          kind: 'UPDATE',
          title: 'Update: a batch of frontend roles went live this week',
          body: 'Heads up — several frontend openings (React/Next.js, hybrid) went live across two product companies I keep an eye on. If you post an ASK here with your stack and seniority, I will share what I know about the teams and their interview loops.',
          hoursAgo: 54,
        },
      ],
      createdHoursAgo: 240,
    },
    {
      name: 'Data & Analytics Guild',
      slug: 'data-analytics-guild',
      focus: 'Data',
      description:
        'Analysts, data engineers and BI folks helping each other get seen by the right teams. Share openings you can vouch for, ask for warm intros, and trade honest prep notes on SQL rounds, case studies and take-home evaluations.',
      guidelines: `${SHARED_GUIDELINE} Ask for referrals only for roles you genuinely fit, and share prep material you have the right to pass on.`,
      creatorEmail: 'vikram.reddy@gmail.com',
      creatorFallback: 2,
      memberEmails: [
        { email: 'ishita.banerjee@gmail.com', fallback: 5 },
        { email: 'aditya.krishnan@gmail.com', fallback: 6 },
      ],
      posts: [
        {
          authorEmail: 'vikram.reddy@gmail.com',
          fallbackIdx: 2,
          kind: 'REFERRAL',
          title: 'Offering: analyst intros at my team — 2+ yrs SQL + dashboards',
          body: 'My team keeps hiring analyst profiles who are strong in SQL and BI storytelling. I can hand resumes to the hiring manager directly and sit in on the informal chat. Drop your focus area, years of experience and a profile link — and a line on the kind of role you actually want, not just any role.',
          jobTitle: 'Data Analyst II',
          companyName: 'DataForge Analytics',
          hoursAgo: 9,
        },
        {
          authorEmail: 'ishita.banerjee@gmail.com',
          fallbackIdx: 5,
          kind: 'ASK',
          title: 'Ask: data analyst referral for a friend — 2 yrs SQL + dashboards',
          body: 'Helping a talented analyst friend get seen: two years of hands-on SQL, stakeholder dashboards, comfortable with Python. Looking for a warm intro to analytics teams hiring in Hyderabad or remote. I will share full context up front and say thanks properly.',
          jobTitle: 'Data Analyst',
          hoursAgo: 28,
        },
        {
          authorEmail: 'aditya.krishnan@gmail.com',
          fallbackIdx: 6,
          kind: 'UPDATE',
          title: 'Update: my SQL case-round prep notes (window functions)',
          body: 'Wrote up the window-function patterns that got me through two analytics case rounds — running totals, gap analysis, dedupe with row_number, all with small examples. Comment if you want the practice dataset; happy to pass it around.',
          hoursAgo: 47,
        },
      ],
      createdHoursAgo: 192,
    },
    {
      name: 'Design Guild',
      slug: 'design-guild',
      focus: 'Design',
      description:
        'Product designers and UX researchers reviewing each other\u2019s portfolios, sharing referral openings and demystifying design interviews together — case-study framing, craft critiques and what panels actually look for.',
      guidelines: `${SHARED_GUIDELINE} Critique the work, never the person, and get consent before sharing someone's portfolio outside the guild.`,
      creatorEmail: 'divya.nair@gmail.com',
      creatorFallback: 3,
      memberEmails: [
        { email: 'meghna.pillai@gmail.com', fallback: 9 },
        { email: 'neha.gupta@gmail.com', fallback: 7 },
      ],
      posts: [
        {
          authorEmail: 'divya.nair@gmail.com',
          fallbackIdx: 3,
          kind: 'REFERRAL',
          title: 'Offering: product designer intro — role open now',
          body: 'My org has a product design opening (2-5 yrs, systems thinking + Figma fluency). I personally review every portfolio that comes through me — share your case-study link with a line on why the role fits you and I will pass strong ones along with honest context.',
          jobTitle: 'Product Designer',
          companyName: 'TechNova Solutions',
          hoursAgo: 7,
        },
        {
          authorEmail: 'meghna.pillai@gmail.com',
          fallbackIdx: 9,
          kind: 'ASK',
          title: 'Ask: design-systems focused designer looking for intros',
          body: 'Four years of UI/UX with a design-systems specialisation (tokens, components, docs) — exploring senior IC roles with teams that care about accessibility. Portfolio on request. Promise to pay it forward with referrals on the ML side of the house.',
          jobTitle: 'Senior Product Designer',
          hoursAgo: 26,
        },
        {
          authorEmail: 'divya.nair@gmail.com',
          fallbackIdx: 3,
          kind: 'UPDATE',
          title: 'Update: monthly portfolio-review thread — drop yours below',
          body: 'Starting a monthly thread: post your portfolio link plus one specific question, and guild members leave structured feedback (story, craft, outcomes). Reviewers — keep it honest and kind; one clear suggestion beats ten vague notes.',
          hoursAgo: 50,
        },
      ],
      createdHoursAgo: 144,
    },
  ]

  for (const g of GUILDS) {
    await db.referralGuild.create({
      data: {
        name: g.name,
        slug: g.slug,
        focus: g.focus,
        description: g.description,
        guidelines: g.guidelines,
        isPublic: true,
        createdById: uid(g.creatorEmail, g.creatorFallback),
        createdAt: hoursAgo(g.createdHoursAgo),
        members: {
          create: [
            { userId: uid(g.creatorEmail, g.creatorFallback), role: 'LEAD', createdAt: hoursAgo(g.createdHoursAgo) },
            ...g.memberEmails.map((m) => ({
              userId: uid(m.email, m.fallback),
              role: 'MEMBER',
              createdAt: hoursAgo(Math.max(g.createdHoursAgo - 2, 0)),
            })),
          ],
        },
        posts: {
          create: g.posts.map((p) => ({
            authorId: uid(p.authorEmail, p.fallbackIdx),
            kind: p.kind,
            title: p.title,
            body: p.body,
            jobTitle: p.jobTitle ?? null,
            companyName: p.companyName ?? null,
            createdAt: hoursAgo(p.hoursAgo),
          })),
        },
      },
    })
  }
}

/* --------------------------------- GET --------------------------------- */

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')

    if (userId) {
      const user = await db.user.findUnique({ where: { id: userId }, select: { id: true } })
      if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 })
      }
    }

    // First visit on a fresh DB: lay down the three demo guilds (idempotent,
    // never fatal — the directory still renders if seeding fails).
    try {
      await seedDemoGuildsIfEmpty()
    } catch (seedErr) {
      console.error('Guild demo seeding failed:', seedErr)
    }

    const memberships = userId
      ? await db.guildMembership.findMany({
          where: { userId },
          select: { guildId: true, role: true },
        })
      : []
    const roleByGuild = new Map(memberships.map((m) => [m.guildId, m.role]))

    const guilds = await db.referralGuild.findMany({
      orderBy: { createdAt: 'asc' },
      select: GUILD_LIST_SELECT,
    })

    const list = guilds.map((g) =>
      toListGuild(g, roleByGuild.has(g.id) ? { role: roleByGuild.get(g.id) as string } : null)
    )

    return NextResponse.json({
      data: {
        guilds: list,
        myGuildIds: list.filter((g) => g.joined).map((g) => g.id),
      },
    })
  } catch (err) {
    console.error('GET /api/guilds failed:', err)
    return NextResponse.json({ error: 'Failed to load guilds' }, { status: 500 })
  }
}

/* --------------------------------- POST -------------------------------- */

export async function POST(req: NextRequest) {
  try {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { userId, name, focus, description } = (body ?? {}) as {
      userId?: unknown
      name?: unknown
      focus?: unknown
      description?: unknown
    }

    if (typeof userId !== 'string' || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    if (typeof name !== 'string' || name.trim().length < 3 || name.trim().length > 60) {
      return NextResponse.json(
        { error: 'Guild name must be 3-60 characters' },
        { status: 400 }
      )
    }

    const cleanFocus = typeof focus === 'string' ? focus.trim() : ''
    if (cleanFocus.length > 60) {
      return NextResponse.json({ error: 'Focus must be 60 characters or fewer' }, { status: 400 })
    }

    const cleanDescription = typeof description === 'string' ? description.trim() : ''
    if (cleanDescription.length > 1000) {
      return NextResponse.json(
        { error: 'Description must be 1000 characters or fewer' },
        { status: 400 }
      )
    }

    const creator = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    })
    if (!creator) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const trimmedName = name.trim()
    const slug = await uniqueSlug(slugify(trimmedName))

    const guild = await db.referralGuild.create({
      data: {
        name: trimmedName,
        slug,
        focus: cleanFocus,
        description: cleanDescription,
        guidelines: SHARED_GUIDELINE,
        isPublic: true,
        createdById: creator.id,
        members: { create: { userId: creator.id, role: 'LEAD' } },
      },
      select: {
        id: true,
        name: true,
        slug: true,
        focus: true,
        description: true,
        guidelines: true,
        createdAt: true,
        _count: { select: { members: true, posts: true } },
      },
    })

    return NextResponse.json(
      {
        data: {
          guild: {
            id: guild.id,
            name: guild.name,
            slug: guild.slug,
            focus: guild.focus,
            description: guild.description,
            guidelines: guild.guidelines,
            createdAt: guild.createdAt,
            memberCount: guild._count.members,
            postCount: guild._count.posts,
            joined: true,
            myRole: 'LEAD',
          },
        },
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('POST /api/guilds failed:', err)
    return NextResponse.json({ error: 'Failed to create guild' }, { status: 500 })
  }
}
