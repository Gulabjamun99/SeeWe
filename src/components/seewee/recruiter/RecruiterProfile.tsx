'use client'

/**
 * RecruiterProfile — the recruiter's own "My Profile" tab.
 *
 * Why: recruiters previously had no way to view or edit their own account
 * details (name, headline, phone, location, company). This tab closes that
 * gap — everything saves through PATCH /api/recruiters/profile and the
 * updated user is pushed back into the Zustand store so the dashboard hero
 * ("Hiring @ …") reflects edits instantly.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  AtSign,
  BadgeCheck,
  Briefcase,
  Building2,
  ImagePlus,
  Loader2,
  MapPin,
  PencilLine,
  Phone,
  Save,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app-store'
import { processLogoFile } from '@/lib/image'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { User } from '@/lib/types'

interface ProfileForm {
  name: string
  headline: string
  phone: string
  location: string
  company: string
}

interface BrandingForm {
  companyAbout: string
  companyWebsite: string
  brandColor: string
  companyLogoData: string
  companyLogoMime: string
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function RecruiterProfile() {
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)

  const [form, setForm] = useState<ProfileForm | null>(null)
  const [branding, setBranding] = useState<BrandingForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [memberSince, setMemberSince] = useState<string | null>(null)
  const [jobCount, setJobCount] = useState<number | null>(null)
  const [logoBusy, setLogoBusy] = useState(false)
  // Snapshot of the last-saved {form, branding} — dirty = current !== baseline
  const baselineRef = useRef<string>('')

  // Hydrate the form from the authoritative server copy (not just the store)
  // so a stale store never pre-fills outdated details.
  useEffect(() => {
    let alive = true
    if (!user || user.role !== 'RECRUITER') return
    setLoading(true)
    fetch(`/api/recruiters/profile?userId=${encodeURIComponent(user.id)}`)
      .then((r) => r.json())
      .then((json: { data?: User & { createdAt?: string; _count?: { postedJobs: number } } }) => {
        if (!alive || !json.data) return
        setForm({
          name: json.data.name ?? '',
          headline: json.data.headline ?? '',
          phone: json.data.phone ?? '',
          location: json.data.location ?? '',
          company: json.data.company ?? '',
        })
        setBranding({
          companyAbout: json.data.companyAbout ?? '',
          companyWebsite: json.data.companyWebsite ?? '',
          brandColor: json.data.brandColor ?? '',
          companyLogoData: json.data.companyLogoData ?? '',
          companyLogoMime: json.data.companyLogoMime ?? '',
        })
        setMemberSince(json.data.createdAt ?? null)
        setJobCount(json.data._count?.postedJobs ?? null)
        baselineRef.current = JSON.stringify({
          form: {
            name: json.data.name ?? '',
            headline: json.data.headline ?? '',
            phone: json.data.phone ?? '',
            location: json.data.location ?? '',
            company: json.data.company ?? '',
          },
          branding: {
            companyAbout: json.data.companyAbout ?? '',
            companyWebsite: json.data.companyWebsite ?? '',
            brandColor: json.data.brandColor ?? '',
            companyLogoData: json.data.companyLogoData ?? '',
            companyLogoMime: json.data.companyLogoMime ?? '',
          },
        })
      })
      .catch(() => {
        if (!alive) return
        // Fall back to the store copy so the form is still usable offline
        setForm({
          name: user.name ?? '',
          headline: user.headline ?? '',
          phone: user.phone ?? '',
          location: user.location ?? '',
          company: user.company ?? '',
        })
        setBranding({ companyAbout: '', companyWebsite: '', brandColor: '', companyLogoData: '', companyLogoMime: '' })
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [user])

  const dirty = useMemo(() => {
    if (!form) return false
    return JSON.stringify({ form, branding }) !== baselineRef.current
  }, [form, branding])

  if (!user || user.role !== 'RECRUITER') return null

  function setField<K extends keyof ProfileForm>(key: K, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  async function handleSave() {
    if (!user || !form || saving) return
    if (!form.name.trim()) {
      toast.error('Your name is required')
      return
    }
    if (!form.company.trim()) {
      toast.error('Your company name is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/recruiters/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, ...form, ...(branding ?? {}) }),
      })
      const json: { data?: User; error?: string } = await res.json()
      if (!res.ok || !json.data) {
        throw new Error(json.error || 'Could not save your profile')
      }
      // Merge the safe subset into the store so hero + header reflect it
      setUser({ ...user, ...json.data })
      baselineRef.current = JSON.stringify({ form, branding })
      toast.success('Profile updated ✅ — your dashboard now shows the new details')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your profile')
    } finally {
      setSaving(false)
    }
  }

  /** Any photo works: big/HEIC snaps are downscaled to a 512px JPEG in-browser
   *  (lib/image.ts) — same pipeline as the Post-a-Job form, same guarantees:
   *  nothing here can crash the page (the "white screen" bug). */
  async function pickLogo(file: File | null) {
    if (!file || !branding || logoBusy) return
    setLogoBusy(true)
    try {
      const processed = await processLogoFile(file)
      if (!processed) {
        toast.error('That file could not be read as an image — try a JPG or PNG')
        return
      }
      setBranding((b) =>
        b ? { ...b, companyLogoData: processed.data, companyLogoMime: processed.mime } : b
      )
      toast.success(
        `Logo ready (${Math.max(1, Math.round(processed.bytes / 1024))} KB) — it shows on all your jobs`
      )
    } catch (err) {
      console.error('[profile] logo processing failed:', err)
      toast.error('Logo processing failed — try a different image')
    } finally {
      setLogoBusy(false)
    }
  }

  const filled = form
    ? [form.name.trim(), form.company.trim(), form.headline.trim(), form.phone.trim(), form.location.trim()].filter(Boolean).length
    : 0
  const completion = Math.round((filled / 5) * 100)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Identity card */}
      <Card className="rounded-2xl lg:col-span-1">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <span className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-sky-500 text-2xl font-bold text-white shadow-md">
            {initialsOf(user.name)}
          </span>
          <div>
            <p className="text-lg font-bold text-slate-900 dark:text-slate-50">{user.name}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {user.headline || 'Recruiter'}
              {user.company ? ` · ${user.company}` : ''}
            </p>
          </div>
          <div className="w-full space-y-1.5 rounded-xl bg-slate-50 p-3 text-left text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-400">
            <p className="flex items-center gap-2">
              <AtSign className="size-3.5 shrink-0" aria-hidden /> {user.email}
            </p>
            <p className="flex items-center gap-2">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden /> Recruiter account
            </p>
            {memberSince && (
              <p className="flex items-center gap-2">
                <BadgeCheck className="size-3.5 shrink-0" aria-hidden /> Member since{' '}
                {format(new Date(memberSince), 'd MMM yyyy')}
              </p>
            )}
            {jobCount !== null && (
              <p className="flex items-center gap-2">
                <Briefcase className="size-3.5 shrink-0" aria-hidden /> {jobCount}{' '}
                {jobCount === 1 ? 'job' : 'jobs'} posted
              </p>
            )}
          </div>
          {/* Profile completion */}
          <div className="w-full">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>Profile strength</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300">{completion}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all ${
                  completion >= 100 ? 'bg-emerald-500' : 'bg-blue-500'
                }`}
                style={{ width: `${Math.max(12, completion)}%` }}
              />
            </div>
            {completion < 100 && (
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                {form && !form.phone.trim() && 'Add a phone number — '}
                {form && !form.location.trim() && 'add your location — '}
                candidates trust complete recruiter profiles more.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Editable details */}
      <Card className="rounded-2xl lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <PencilLine className="size-4 text-blue-600" aria-hidden /> Profile &amp; company details
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Candidates and clients see these details on your jobs and shared reports — keep them
            accurate.
          </p>
        </CardHeader>
        <CardContent>
          {loading || !form ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="rc-name">Full name *</Label>
                  <Input
                    id="rc-name"
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="e.g. Ananya Sharma"
                    className="min-h-[42px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rc-headline">Headline</Label>
                  <Input
                    id="rc-headline"
                    value={form.headline}
                    onChange={(e) => setField('headline', e.target.value)}
                    placeholder="e.g. Senior Talent Partner · Engineering"
                    className="min-h-[42px]"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rc-company">
                    <Building2 className="mr-1 inline size-3.5" aria-hidden /> Company name *
                  </Label>
                  <Input
                    id="rc-company"
                    value={form.company}
                    onChange={(e) => setField('company', e.target.value)}
                    placeholder="e.g. TechNova Solutions"
                    className="min-h-[42px]"
                  />
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Your jobs, applicants and reports stay inside this company workspace.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="rc-phone">
                      <Phone className="mr-1 inline size-3.5" aria-hidden /> Phone
                    </Label>
                    <Input
                      id="rc-phone"
                      value={form.phone}
                      onChange={(e) => setField('phone', e.target.value)}
                      placeholder="+91 98765 43210"
                      className="min-h-[42px]"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rc-location">
                      <MapPin className="mr-1 inline size-3.5" aria-hidden /> Location
                    </Label>
                    <Input
                      id="rc-location"
                      value={form.location}
                      onChange={(e) => setField('location', e.target.value)}
                      placeholder="e.g. Bengaluru"
                      className="min-h-[42px]"
                    />
                  </div>
                </div>
              </div>

              {/* ---- Company branding (shown on every job listing) ---- */}
              {branding && (
                <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40 p-4">
                  <div className="flex items-center gap-2">
                    <Building2 className="size-4 text-blue-600" aria-hidden />
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      Company branding
                    </p>
                    <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      shows on your jobs
                    </span>
                  </div>
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700"
                        style={branding.brandColor ? { borderColor: branding.brandColor } : undefined}
                      >
                        {logoBusy ? (
                          <Loader2 className="size-4 animate-spin text-slate-400" aria-hidden />
                        ) : branding.companyLogoData ? (
                          <img
                            src={`data:${branding.companyLogoMime || 'image/png'};base64,${branding.companyLogoData}`}
                            alt="Company logo preview"
                            className="size-full object-cover"
                          />
                        ) : (
                          <Building2 className="size-5 text-slate-300 dark:text-slate-600" aria-hidden />
                        )}
                      </div>
                      <div className="space-y-1">
                        <label
                          className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors ${
                            logoBusy
                              ? 'cursor-wait opacity-60'
                              : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          <ImagePlus className="size-3.5" aria-hidden />
                          {logoBusy ? 'Processing…' : 'Upload logo'}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="pointer-events-none fixed top-0 left-0 size-px opacity-0"
                            tabIndex={-1}
                            disabled={logoBusy}
                            onChange={(e) => {
                              const picked = e.target.files?.[0] ?? null
                              e.currentTarget.value = ''
                              void pickLogo(picked)
                            }}
                            aria-label="Upload company logo"
                          />
                        </label>
                        {branding.companyLogoData && (
                          <button
                            type="button"
                            onClick={() =>
                              setBranding((b) =>
                                b ? { ...b, companyLogoData: '', companyLogoMime: '' } : b
                              )
                            }
                            className="flex items-center gap-1 text-[11px] text-rose-600 hover:underline dark:text-rose-400"
                          >
                            <X className="size-3" aria-hidden /> Remove logo
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rc-brandcolor" className="text-xs">
                        Brand colour
                      </Label>
                      <div className="flex items-center gap-2">
                        <input
                          id="rc-brandcolor"
                          type="color"
                          value={branding.brandColor || '#0f766e'}
                          onChange={(e) =>
                            setBranding((b) => (b ? { ...b, brandColor: e.target.value } : b))
                          }
                          className="size-8 cursor-pointer rounded-lg border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900"
                          aria-label="Pick brand colour"
                        />
                        <Input
                          value={branding.brandColor}
                          onChange={(e) => {
                            const v = e.target.value
                            setBranding((b) =>
                              b
                                ? { ...b, brandColor: v.startsWith('#') ? v : v ? `#${v.replace(/#/g, '')}` : '' }
                                : b
                            )
                          }}
                          placeholder="#0f766e"
                          maxLength={7}
                          className="h-8 w-24 rounded-lg border-slate-200 text-xs dark:border-slate-800"
                          aria-label="Brand colour hex value"
                        />
                      </div>
                    </div>
                    <div className="min-w-44 flex-1 space-y-1.5">
                      <Label htmlFor="rc-website" className="text-xs">
                        Company website
                      </Label>
                      <Input
                        id="rc-website"
                        value={branding.companyWebsite}
                        onChange={(e) =>
                          setBranding((b) => (b ? { ...b, companyWebsite: e.target.value } : b))
                        }
                        placeholder="https://yourcompany.com"
                        className="min-h-[36px] rounded-lg border-slate-200 text-xs dark:border-slate-800"
                        aria-label="Company website URL"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="rc-about" className="text-xs">
                      About the company{' '}
                      <span className="font-normal text-muted-foreground">
                        (candidates read this on your job posts)
                      </span>
                    </Label>
                    <Textarea
                      id="rc-about"
                      rows={3}
                      maxLength={1200}
                      value={branding.companyAbout}
                      onChange={(e) =>
                        setBranding((b) => (b ? { ...b, companyAbout: e.target.value } : b))
                      }
                      placeholder="What does your company do? Culture, mission, products, team size…"
                      className="resize-y rounded-lg border-slate-200 text-[13px] dark:border-slate-800"
                      aria-label="About the company"
                    />
                    <p className="text-right text-[11px] text-slate-400">
                      {branding.companyAbout.length}/1200
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-amber-500" aria-hidden />
                  Your email ({user.email}) is the login identity — it cannot be changed here.
                </p>
                <Button
                  onClick={() => void handleSave()}
                  disabled={saving || !dirty}
                  className="h-10 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-sm hover:from-blue-700 hover:to-sky-600"
                  aria-label="Save profile changes"
                >
                  {saving ? (
                    <>
                      <Loader2 className="mr-1.5 size-4 animate-spin" /> Saving…
                    </>
                  ) : (
                    <>
                      <Save className="mr-1.5 size-4" /> {dirty ? 'Save changes' : 'Saved'}
                    </>
                  )}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sign-up context helper — shown only when the profile is bare */}
      {form && form.headline.trim() === '' && form.location.trim() === '' && (
        <Card className="rounded-2xl border-dashed lg:col-span-3">
          <CardContent className="flex items-start gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
              <UserRound className="size-4 text-blue-600" aria-hidden />
            </span>
            <div className="text-sm">
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                Welcome to SeeWe — finish setting up your recruiter profile
              </p>
              <p className="text-muted-foreground">
                You signed up with just a name and company. Add a headline, phone and location
                above so candidates know who they are talking to.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
