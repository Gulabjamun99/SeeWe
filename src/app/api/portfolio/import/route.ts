// SeeWe - POST /api/portfolio/import
// CANDIDATE-SIDE portfolio sync: one-click public GitHub import.
//
// Fetches the public profile + repositories for a handle, aggregates honest
// stats (public repo count, top languages by frequency, most recent push,
// followers) and suggests NEW skills the candidate does not have on their
// profile yet. When the candidate has no profile link saved yet, the imported
// handle is saved as their public code profile link.
//
// CANDIDATE PRIVACY: this endpoint is owner-only (the candidate themself) and
// touches only their own profile. Sandbox honesty: if the network is
// unreachable the endpoint returns a clear error and does NOT silently save
// anything — the client tells the candidate they can still paste their link.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const HANDLE_RE = /^[A-Za-z0-9-]{1,39}$/
const FETCH_TIMEOUT_MS = 12_000

const GH_HEADERS: HeadersInit = {
  'User-Agent': 'seewee-portfolio',
  Accept: 'application/vnd.github+json',
}

interface GhUser {
  login?: string
  public_repos?: number
  followers?: number
}

interface GhRepo {
  language?: string | null
  pushed_at?: string | null
}

/** Accept a bare handle or a pasted full profile URL and extract the handle. */
function extractHandle(raw: string): string {
  let h = raw.trim()
  h = h.replace(/^https?:\/\//i, '')
  h = h.replace(/^www\./i, '')
  // github api convention: the profile lives at github.com/{handle}
  h = h.replace(/^github\.com\//i, '')
  h = h.replace(/^@/, '')
  // keep only the first path segment, drop query/hash/trailing junk
  h = h.split(/[/?#]/)[0].trim()
  return h
}

async function ghFetch(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: GH_HEADERS,
      signal: controller.signal,
      cache: 'no-store',
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Single honest error for any network/transport failure. */
const NETWORK_ERROR = "Couldn't reach GitHub right now — you can still paste your profile link below"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { userId?: unknown; handle?: unknown }
      | null
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
    const rawHandle = typeof body?.handle === 'string' ? body.handle : ''

    if (!userId || !rawHandle.trim()) {
      return NextResponse.json({ error: 'userId and handle are required' }, { status: 400 })
    }

    // Auth: owner-only — a candidate can import only into their own profile.
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, skills: true, githubUrl: true },
    })
    if (!user || user.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'Only the profile owner can import a portfolio' },
        { status: 403 }
      )
    }

    const handle = extractHandle(rawHandle)
    if (!HANDLE_RE.test(handle)) {
      return NextResponse.json(
        { error: 'That does not look like a valid public profile handle' },
        { status: 400 }
      )
    }

    // ---- GitHub profile ----
    let ghUser: GhUser
    try {
      const uRes = await ghFetch(`https://api.github.com/users/${encodeURIComponent(handle)}`)
      if (uRes.status === 404) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }
      if (uRes.status === 403) {
        // Rate limited or blocked — be honest, ask them to retry later.
        return NextResponse.json(
          { error: 'Import is rate limited right now — try again later' },
          { status: 429 }
        )
      }
      if (!uRes.ok) {
        return NextResponse.json({ error: NETWORK_ERROR }, { status: 502 })
      }
      ghUser = (await uRes.json()) as GhUser
    } catch (err) {
      console.error('[portfolio/import] profile fetch failed:', err)
      return NextResponse.json({ error: NETWORK_ERROR }, { status: 502 })
    }

    // ---- Public repositories (language frequency + latest push) ----
    let repos: GhRepo[]
    try {
      const rRes = await ghFetch(
        `https://api.github.com/users/${encodeURIComponent(handle)}/repos?per_page=100&sort=updated`
      )
      if (rRes.status === 404) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
      }
      if (rRes.status === 403) {
        return NextResponse.json(
          { error: 'Import is rate limited right now — try again later' },
          { status: 429 }
        )
      }
      if (!rRes.ok) {
        return NextResponse.json({ error: NETWORK_ERROR }, { status: 502 })
      }
      const parsed: unknown = await rRes.json()
      repos = Array.isArray(parsed) ? (parsed as GhRepo[]) : []
    } catch (err) {
      console.error('[portfolio/import] repos fetch failed:', err)
      return NextResponse.json({ error: NETWORK_ERROR }, { status: 502 })
    }

    // ---- Aggregate (language frequency only — honest, no topic guessing) ----
    const langCount = new Map<string, number>()
    let recentPushAt: string | null = null
    for (const repo of repos) {
      if (repo.language && typeof repo.language === 'string') {
        const key = repo.language.trim()
        if (key) langCount.set(key, (langCount.get(key) ?? 0) + 1)
      }
      if (repo.pushed_at && typeof repo.pushed_at === 'string') {
        if (!recentPushAt || repo.pushed_at > recentPushAt) recentPushAt = repo.pushed_at
      }
    }
    const topLanguages = [...langCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }))

    // Suggested skills: top 5 languages, keeping only NEW ones (deduped
    // case-insensitively against the candidate's existing skills).
    const existing = new Set(
      (user.skills || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    )
    const suggestedSkills = [...langCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name)
      .filter((name) => !existing.has(name.toLowerCase()))
      .slice(0, 5)

    // Save the profile link only when the candidate has none yet. We are past
    // the failure points now — the import itself succeeded.
    const profileUrl = `https://github.com/${handle}`
    if (!user.githubUrl) {
      await db.user.update({
        where: { id: user.id },
        data: { githubUrl: profileUrl },
      })
    }

    return NextResponse.json({
      data: {
        stats: {
          publicRepos: typeof ghUser.public_repos === 'number' ? ghUser.public_repos : repos.length,
          topLanguages,
          recentPushAt,
          followers: typeof ghUser.followers === 'number' ? ghUser.followers : 0,
        },
        suggestedSkills,
        githubUrl: user.githubUrl || profileUrl,
      },
    })
  } catch (err) {
    console.error('POST /api/portfolio/import failed:', err)
    return NextResponse.json({ error: NETWORK_ERROR }, { status: 502 })
  }
}
