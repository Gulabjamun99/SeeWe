import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Recruiter self-profile — view + edit the recruiter's own account details.
 *
 * GET  /api/recruiters/profile?userId=...  → the recruiter's profile (safe fields)
 * PATCH /api/recruiters/profile            → update editable fields
 *   body: { userId, name?, headline?, phone?, location?, company?,
 *           companyAbout?, companyWebsite?, brandColor?,
 *           companyLogoData?, companyLogoMime? }
 *
 * Recruiter-only: candidates/clients/admins get 403. The email is the login
 * identity in this demo and is intentionally NOT editable here.
 */

// Fields a recruiter may edit on their own profile (short text ≤120 chars)
const EDITABLE_TEXT = ['name', 'headline', 'phone', 'location', 'company'] as const

// Fields that must stay non-empty when provided (identity-critical)
const REQUIRED_NON_EMPTY: readonly string[] = ['name', 'company']

// Company branding fields with their own caps
const BRANDING_TEXT: Array<{ key: string; max: number }> = [
  { key: 'companyAbout', max: 1200 },
  { key: 'companyWebsite', max: 200 },
  { key: 'brandColor', max: 9 },
]

export async function GET(req: NextRequest) {
  try {
    const userId = req.nextUrl.searchParams.get('userId')
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        headline: true,
        phone: true,
        location: true,
        company: true,
        avatarSeed: true,
        companyAbout: true,
        companyWebsite: true,
        companyLogoData: true,
        companyLogoMime: true,
        brandColor: true,
        createdAt: true,
        _count: { select: { postedJobs: true } },
      },
    })

    if (!user || user.role !== 'RECRUITER') {
      return NextResponse.json({ error: 'Recruiter not found' }, { status: 404 })
    }

    return NextResponse.json({ data: user })
  } catch (err) {
    console.error('GET /api/recruiters/profile failed:', err)
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }
    const patch = body as Record<string, unknown>

    const userId = typeof patch.userId === 'string' ? patch.userId.trim() : ''
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const existing = await db.user.findUnique({ where: { id: userId } })
    if (!existing || existing.role !== 'RECRUITER') {
      return NextResponse.json(
        { error: 'Only recruiter accounts can update this profile' },
        { status: 403 }
      )
    }

    const data: Record<string, string> = {}
    let touched = 0

    for (const f of EDITABLE_TEXT) {
      const v = patch[f]
      if (v === undefined) continue
      if (typeof v !== 'string') {
        return NextResponse.json({ error: `Field '${f}' must be a string` }, { status: 400 })
      }
      const trimmed = v.trim()
      if (REQUIRED_NON_EMPTY.includes(f) && trimmed.length === 0) {
        return NextResponse.json(
          { error: `Field '${f}' cannot be empty` },
          { status: 400 }
        )
      }
      // Length sanity — profile fields are short text
      if (trimmed.length > 120) {
        return NextResponse.json(
          { error: `Field '${f}' is too long (max 120 characters)` },
          { status: 400 }
        )
      }
      data[f] = trimmed
      touched += 1
    }

    // ---- Company branding fields (own caps) ----
    for (const { key, max } of BRANDING_TEXT) {
      const v = patch[key]
      if (v === undefined) continue
      if (typeof v !== 'string') {
        return NextResponse.json({ error: `Field '${key}' must be a string` }, { status: 400 })
      }
      const trimmed = v.trim()
      if (trimmed.length > max) {
        return NextResponse.json(
          { error: `Field '${key}' is too long (max ${max} characters)` },
          { status: 400 }
        )
      }
      if (key === 'brandColor' && trimmed && !/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) {
        return NextResponse.json(
          { error: 'brandColor must be a hex colour like #0f766e' },
          { status: 400 }
        )
      }
      if (key === 'companyWebsite' && trimmed && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+/.test(trimmed)) {
        return NextResponse.json(
          { error: 'companyWebsite must look like a URL (e.g. https://acme.com)' },
          { status: 400 }
        )
      }
      data[key] = trimmed
      touched += 1
    }

    // ---- Company logo (base64 pair; empty companyLogoData clears it) ----
    if (patch.companyLogoData !== undefined) {
      const logo = patch.companyLogoData
      const mime = patch.companyLogoMime
      if (logo !== null && typeof logo !== 'string') {
        return NextResponse.json(
          { error: 'companyLogoData must be a string or null' },
          { status: 400 }
        )
      }
      if (mime !== undefined && mime !== null && typeof mime !== 'string') {
        return NextResponse.json({ error: 'companyLogoMime must be a string' }, { status: 400 })
      }
      const logoStr = typeof logo === 'string' ? logo.trim() : ''
      const mimeStr = typeof mime === 'string' ? mime.trim() : ''
      if (logoStr && !['image/png', 'image/jpeg', 'image/webp'].includes(mimeStr)) {
        return NextResponse.json(
          { error: 'companyLogoMime must be image/png, image/jpeg or image/webp' },
          { status: 400 }
        )
      }
      if (logoStr.length > 400 * 1024) {
        return NextResponse.json(
          { error: 'Logo is too large — keep it under 300KB' },
          { status: 400 }
        )
      }
      data.companyLogoData = logoStr // '' → cleared (nulled below)
      data.companyLogoMime = logoStr ? mimeStr : ''
      touched += 1
    }

    if (touched === 0) {
      return NextResponse.json(
        { error: 'No editable fields provided (name, headline, phone, location, company, branding)' },
        { status: 400 }
      )
    }

    // '' → null so cleared values actually disappear from listings
    const cleanData = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, v === '' ? null : v])
    )

    const updated = await db.user.update({
      where: { id: userId },
      data: cleanData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        headline: true,
        phone: true,
        location: true,
        company: true,
        avatarSeed: true,
        companyAbout: true,
        companyWebsite: true,
        companyLogoData: true,
        companyLogoMime: true,
        brandColor: true,
      },
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PATCH /api/recruiters/profile failed:', err)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}

// branding fields live on User (schema v2)
