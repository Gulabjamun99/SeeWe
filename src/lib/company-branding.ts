// SeeWe — company branding writer (shared by POST /api/jobs and PATCH /api/jobs/[id])
// The post-job form collects "About the company", website, logo and brand colour;
// they live on the RECRUITER's User row so every listing from that company shows
// the same branding. This helper validates the payload and applies it.

import { db } from '@/lib/db'

export interface CompanyBrandingInput {
  companyAbout?: unknown
  companyWebsite?: unknown
  companyLogoData?: unknown
  companyLogoMime?: unknown
  brandColor?: unknown
}

const LOGO_MIMES = ['image/png', 'image/jpeg', 'image/webp']

/** Validate + normalize a client-provided branding object. */
export function parseCompanyBranding(
  value: unknown
): { ok: true; data: Record<string, string> } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, data: {} }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'companyBranding must be an object' }
  }
  const raw = value as CompanyBrandingInput
  const data: Record<string, string> = {}

  if (raw.companyAbout !== undefined) {
    if (typeof raw.companyAbout !== 'string') {
      return { ok: false, error: 'companyBranding.companyAbout must be a string' }
    }
    const about = raw.companyAbout.trim()
    if (about.length > 1200) {
      return { ok: false, error: 'companyAbout is too long (max 1200 characters)' }
    }
    data.companyAbout = about
  }

  if (raw.companyWebsite !== undefined) {
    if (typeof raw.companyWebsite !== 'string') {
      return { ok: false, error: 'companyBranding.companyWebsite must be a string' }
    }
    const site = raw.companyWebsite.trim()
    if (site.length > 200) {
      return { ok: false, error: 'companyWebsite is too long (max 200 characters)' }
    }
    if (site && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+/.test(site)) {
      return { ok: false, error: 'companyWebsite must look like a URL (e.g. https://acme.com)' }
    }
    data.companyWebsite = site
  }

  if (raw.brandColor !== undefined) {
    if (typeof raw.brandColor !== 'string') {
      return { ok: false, error: 'companyBranding.brandColor must be a string' }
    }
    const color = raw.brandColor.trim()
    if (color && !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
      return { ok: false, error: 'brandColor must be a hex colour like #0f766e' }
    }
    data.brandColor = color
  }

  if (raw.companyLogoData !== undefined) {
    if (raw.companyLogoData !== null && typeof raw.companyLogoData !== 'string') {
      return { ok: false, error: 'companyBranding.companyLogoData must be a string or null' }
    }
    const logo = typeof raw.companyLogoData === 'string' ? raw.companyLogoData.trim() : ''
    if (logo.length > 400 * 1024) {
      return { ok: false, error: 'Logo is too large — keep it under 300KB' }
    }
    const mime = typeof raw.companyLogoMime === 'string' ? raw.companyLogoMime.trim() : ''
    if (logo && !LOGO_MIMES.includes(mime)) {
      return {
        ok: false,
        error: 'companyBranding.companyLogoMime must be image/png, image/jpeg or image/webp',
      }
    }
    data.companyLogoData = logo // '' → clears the saved logo
    data.companyLogoMime = logo ? mime : ''
  }

  return { ok: true, data }
}

/** Persist branding ('' → null) onto the recruiter's User row. Non-fatal. */
export async function applyCompanyBranding(
  recruiterId: string,
  branding: unknown
): Promise<{ error?: string }> {
  const parsed = parseCompanyBranding(branding)
  if (!parsed.ok) return { error: parsed.error }
  if (Object.keys(parsed.data).length === 0) return {}

  // '' → null so cleared values disappear from listings
  const clean = Object.fromEntries(
    Object.entries(parsed.data).map(([k, v]) => [k, v === '' ? null : v])
  )
  try {
    await db.user.update({ where: { id: recruiterId }, data: clean })
    return {}
  } catch (err) {
    console.error('applyCompanyBranding failed:', err)
    return { error: 'Could not save company branding' }
  }
}
