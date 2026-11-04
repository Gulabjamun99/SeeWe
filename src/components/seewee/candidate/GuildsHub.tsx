'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  Info,
  Loader2,
  Lock,
  MessageSquare,
  PenLine,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Users,
  UsersRound,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/* GuildsHub — candidate-run referral communities                      */
/* List view (directory + create) → detail view (feed + composer)      */
/* Accents: violet primary · emerald REFERRAL · amber ASK · stone rest */
/* ------------------------------------------------------------------ */

interface GuildSummary {
  id: string
  name: string
  slug: string
  focus: string
  description: string
  memberCount: number
  postCount: number
  joined: boolean
  myRole: string | null
}

interface GuildReplyItem {
  id: string
  body: string
  authorName: string
  createdAt: string
}

interface GuildPostItem {
  id: string
  kind: string
  title: string
  body: string
  jobTitle: string | null
  companyName: string | null
  authorName: string
  authorHeadline: string | null
  createdAt: string
  replyCount: number
  replies: GuildReplyItem[]
}

interface GuildDetail {
  guild: {
    id: string
    name: string
    slug: string
    focus: string
    description: string
    guidelines: string
    isPublic: boolean
    createdAt: string
    createdByName: string
    memberCount: number
    postCount: number
  }
  posts: GuildPostItem[]
  myMembership: { joined: boolean; role: string | null }
}

type PostKind = 'REFERRAL' | 'ASK' | 'UPDATE'

const KIND_META: Record<
  PostKind,
  { label: string; hint: string; chip: string; active: string }
> = {
  REFERRAL: {
    label: 'Referral',
    hint: 'Offering an intro or referral',
    chip:
      'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
    active:
      'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  },
  ASK: {
    label: 'Ask',
    hint: 'Looking for an intro',
    chip:
      'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
    active:
      'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  },
  UPDATE: {
    label: 'Update',
    hint: 'General news or notes',
    chip:
      'border-stone-200 bg-stone-100 text-stone-600 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300',
    active:
      'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200',
  },
}

const BODY_CLAMP_THRESHOLD = 220

function rel(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const out = parts.map((p) => p.charAt(0).toUpperCase()).join('')
  return out || '?'
}

/** JSON fetch helper returning the {data}/{error} envelope honestly. */
async function jsonFetch<T>(
  url: string,
  options?: { method?: string; body?: unknown }
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      headers: options?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
    const json: { data?: T; error?: string } = await res.json().catch(() => ({}))
    if (!res.ok || json.error) {
      return { ok: false, status: res.status, error: json.error || `Request failed (${res.status})` }
    }
    return { ok: true, status: res.status, data: json.data }
  } catch {
    return { ok: false, status: 0, error: 'Network error — please try again' }
  }
}

export default function GuildsHub({ user }: { user: { id: string; name?: string } }) {
  const userId = user?.id

  /* ------------------------------ state ------------------------------ */
  const [view, setView] = useState<'list' | 'detail'>('list')
  const [guilds, setGuilds] = useState<GuildSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const [activeGuildId, setActiveGuildId] = useState<string | null>(null)
  const [detail, setDetail] = useState<GuildDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', focus: '', description: '' })

  const [busyGuildId, setBusyGuildId] = useState<string | null>(null)

  const [composer, setComposer] = useState<{
    kind: PostKind
    title: string
    body: string
    jobTitle: string
    companyName: string
  }>({ kind: 'REFERRAL', title: '', body: '', jobTitle: '', companyName: '' })
  const [posting, setPosting] = useState(false)

  const [expandedPosts, setExpandedPosts] = useState<Set<string>>(new Set())
  const [openThreads, setOpenThreads] = useState<Set<string>>(new Set())
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [replyingTo, setReplyingTo] = useState<string | null>(null)

  /* ----------------------------- loaders ----------------------------- */

  const loadGuilds = useCallback(async () => {
    if (!userId) return
    try {
      const res = await fetch(`/api/guilds?userId=${encodeURIComponent(userId)}`)
      const json: { data?: { guilds: GuildSummary[] }; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load guilds')
      setGuilds(json.data?.guilds ?? [])
      setListError(null)
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Failed to load guilds')
      setGuilds([])
    }
  }, [userId])

  const loadDetail = useCallback(
    async (guildId: string) => {
      setDetailLoading(true)
      setDetailError(null)
      const res = await jsonFetch<GuildDetail>(
        `/api/guilds/${encodeURIComponent(guildId)}?userId=${encodeURIComponent(userId)}`
      )
      if (res.ok && res.data) {
        setDetail(res.data)
      } else {
        setDetailError(res.error ?? 'Failed to load guild')
        setDetail(null)
      }
      setDetailLoading(false)
    },
    [userId]
  )

  useEffect(() => {
    if (view === 'list') void loadGuilds()
  }, [view, loadGuilds])

  const openGuild = useCallback(
    (guildId: string) => {
      setActiveGuildId(guildId)
      setDetail(null)
      setExpandedPosts(new Set())
      setOpenThreads(new Set())
      setReplyDrafts({})
      setComposer({ kind: 'REFERRAL', title: '', body: '', jobTitle: '', companyName: '' })
      setView('detail')
      void loadDetail(guildId)
    },
    [loadDetail]
  )

  const handleBack = useCallback(() => {
    setView('list')
    setActiveGuildId(null)
    setDetail(null)
  }, [])

  /* ----------------------------- actions ----------------------------- */

  const setMembership = (guildId: string, joined: boolean, role: string | null) => {
    setGuilds((prev) =>
      prev
        ? prev.map((g) => (g.id === guildId ? { ...g, joined, myRole: role } : g))
        : prev
    )
  }

  const joinGuild = useCallback(
    async (guildId: string, opts?: { fromList?: boolean }) => {
      setBusyGuildId(guildId)
      const res = await jsonFetch<{ joined: boolean; role: string; guidelines: string }>(
        `/api/guilds/${encodeURIComponent(guildId)}`,
        { method: 'POST', body: { userId, action: 'join' } }
      )
      setBusyGuildId(null)
      if (res.ok && res.data) {
        setMembership(guildId, true, res.data.role)
        if (opts?.fromList) {
          toast.success('Joined the guild — welcome!')
        } else {
          toast.success('Joined the guild — welcome!', {
            description: res.data.guidelines
              ? 'Please read the guild guidelines before posting.'
              : undefined,
          })
        }
        if (!opts?.fromList && activeGuildId === guildId) void loadDetail(guildId)
      } else {
        toast.error(res.error ?? 'Could not join the guild')
      }
    },
    [userId, activeGuildId, loadDetail]
  )

  const leaveGuild = useCallback(
    async (guildId: string, opts?: { fromList?: boolean }) => {
      setBusyGuildId(guildId)
      const res = await jsonFetch<{ joined: boolean }>(
        `/api/guilds/${encodeURIComponent(guildId)}`,
        { method: 'POST', body: { userId, action: 'leave' } }
      )
      setBusyGuildId(null)
      if (res.ok && res.data) {
        setMembership(guildId, false, null)
        toast.success('You left the guild')
        if (!opts?.fromList && activeGuildId === guildId) void loadDetail(guildId)
      } else {
        toast.error(res.error ?? 'Could not leave the guild')
      }
    },
    [userId, activeGuildId, loadDetail]
  )

  const createGuild = useCallback(async () => {
    const name = form.name.trim()
    if (name.length < 3 || name.length > 60) {
      toast.warning('Guild name must be 3-60 characters')
      return
    }
    setCreating(true)
    const res = await jsonFetch<{ guild: GuildSummary & { guidelines?: string } }>('/api/guilds', {
      method: 'POST',
      body: {
        userId,
        name,
        focus: form.focus.trim(),
        description: form.description.trim(),
      },
    })
    setCreating(false)
    if (res.ok && res.data) {
      toast.success(`Guild created — you're the lead of ${res.data.guild.name}`)
      setForm({ name: '', focus: '', description: '' })
      setCreateOpen(false)
      await loadGuilds()
      openGuild(res.data.guild.id)
    } else {
      toast.error(res.error ?? 'Could not create the guild')
    }
  }, [form, userId, loadGuilds, openGuild])

  const submitPost = useCallback(async () => {
    if (!activeGuildId || !detail) return
    const title = composer.title.trim()
    const body = composer.body.trim()
    if (title.length < 5 || title.length > 120) {
      toast.warning('Title must be 5-120 characters')
      return
    }
    if (body.length < 10 || body.length > 2000) {
      toast.warning('Post body must be 10-2000 characters')
      return
    }
    setPosting(true)
    const res = await jsonFetch<{ post: GuildPostItem }>(
      `/api/guilds/${encodeURIComponent(activeGuildId)}/posts`,
      {
        method: 'POST',
        body: {
          userId,
          kind: composer.kind,
          title,
          body,
          jobTitle: composer.jobTitle.trim() || undefined,
          companyName: composer.companyName.trim() || undefined,
        },
      }
    )
    setPosting(false)
    if (res.ok && res.data) {
      toast.success('Posted to the guild')
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              guild: { ...prev.guild, postCount: prev.guild.postCount + 1 },
              posts: [res.data!.post, ...prev.posts],
            }
          : prev
      )
      setGuilds((prev) =>
        prev ? prev.map((g) => (g.id === activeGuildId ? { ...g, postCount: g.postCount + 1 } : g)) : prev
      )
      setComposer({ kind: 'REFERRAL', title: '', body: '', jobTitle: '', companyName: '' })
    } else {
      toast.error(res.error ?? 'Could not create the post')
    }
  }, [activeGuildId, detail, composer, userId])

  const submitReply = useCallback(
    async (postId: string) => {
      const body = (replyDrafts[postId] ?? '').trim()
      if (body.length < 2 || body.length > 1000) {
        toast.warning('Reply must be 2-1000 characters')
        return
      }
      setReplyingTo(postId)
      const res = await jsonFetch<{ reply: GuildReplyItem }>(
        `/api/guilds/posts/${encodeURIComponent(postId)}/replies`,
        { method: 'POST', body: { userId, body } }
      )
      setReplyingTo(null)
      if (res.ok && res.data) {
        toast.success('Reply posted')
        setReplyDrafts((prev) => ({ ...prev, [postId]: '' }))
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                posts: prev.posts.map((p) =>
                  p.id === postId
                    ? {
                        ...p,
                        replyCount: p.replyCount + 1,
                        replies: [...p.replies, res.data!.reply],
                      }
                    : p
                ),
              }
            : prev
        )
      } else {
        toast.error(res.error ?? 'Could not post the reply')
      }
    },
    [replyDrafts, userId]
  )

  const toggleExpanded = (postId: string) =>
    setExpandedPosts((prev) => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })

  const toggleThread = (postId: string) =>
    setOpenThreads((prev) => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })

  /* ------------------------------ render ----------------------------- */

  const sortedGuilds = useMemo(() => {
    if (!guilds) return []
    // Joined guilds float to the top; original order preserved otherwise.
    return [...guilds].sort((a, b) => Number(b.joined) - Number(a.joined))
  }, [guilds])

  if (!userId) return null

  const isMember = Boolean(detail?.myMembership.joined)
  const myRole = detail?.myMembership.role ?? null

  /* --------------------------- error / skeleton ---------------------- */

  const renderListStates = () => {
    if (guilds === null && !listError) {
      return (
        <div className="grid gap-3 sm:grid-cols-2" aria-label="Loading guilds">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="rounded-2xl shadow-sm">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-20 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-4 w-3/4 rounded-full" />
                <Skeleton className="h-3 w-full rounded-full" />
                <Skeleton className="h-3 w-2/3 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      )
    }
    if (listError) {
      return (
        <Card className="rounded-2xl border-rose-200 shadow-md dark:border-rose-900/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <p className="flex items-center gap-2 text-sm font-medium text-rose-600">
              <AlertTriangle className="size-4" aria-hidden /> {listError}
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void loadGuilds()}
              className="min-h-11"
            >
              <RefreshCw className="size-4" aria-hidden /> Retry
            </Button>
          </CardContent>
        </Card>
      )
    }
    if (sortedGuilds.length === 0) {
      return (
        <Card className="rounded-2xl border-dashed shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-violet-50 dark:bg-violet-950/40">
              <UsersRound className="size-6 text-violet-500" aria-hidden />
            </span>
            <h3 className="font-semibold text-stone-800 dark:text-stone-200">No guilds yet</h3>
            <p className="max-w-xs text-sm text-stone-500 dark:text-stone-400">
              Start the first peer community — create a guild around your craft.
            </p>
            <Button
              onClick={() => setCreateOpen(true)}
              className="mt-1 min-h-11 rounded-xl bg-violet-600 hover:bg-violet-700"
            >
              <Plus className="size-4" aria-hidden /> Create the first guild
            </Button>
          </CardContent>
        </Card>
      )
    }
    return null
  }

  const renderGuildCard = (g: GuildSummary) => (
    <Card
      key={g.id}
      role="button"
      tabIndex={0}
      aria-label={`Open guild ${g.name}`}
      onClick={() => openGuild(g.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openGuild(g.id)
        }
      }}
      className="group cursor-pointer rounded-2xl border-stone-200 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md dark:border-stone-800 dark:hover:border-violet-800"
    >
      <CardContent className="p-5">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <Badge className="rounded-full border-transparent bg-violet-100 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
            {g.focus || 'General'}
          </Badge>
          {g.joined && (
            <Badge className="rounded-full border-transparent bg-emerald-50 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <Check className="mr-0.5 size-3" aria-hidden /> Joined
              {g.myRole === 'LEAD' ? ' · Lead' : ''}
            </Badge>
          )}
        </div>
        <h3 className="truncate font-bold text-stone-900 group-hover:text-violet-700 dark:text-stone-100 dark:group-hover:text-violet-300">
          {g.name}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-stone-500 dark:text-stone-400">
          {g.description}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5 text-stone-400" aria-hidden /> {g.memberCount} members
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="size-3.5 text-stone-400" aria-hidden /> {g.postCount} posts
            </span>
          </div>
          {g.joined ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busyGuildId === g.id}
              onClick={(e) => {
                e.stopPropagation()
                void leaveGuild(g.id, { fromList: true })
              }}
              className="min-h-11 rounded-xl border-stone-200 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              {busyGuildId === g.id ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                'Leave'
              )}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busyGuildId === g.id}
              onClick={(e) => {
                e.stopPropagation()
                void joinGuild(g.id, { fromList: true })
              }}
              className="min-h-11 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
            >
              {busyGuildId === g.id ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                'Join'
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )

  /* ------------------------------ list view --------------------------- */

  const listView = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-bold text-stone-900 dark:text-stone-100">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-violet-100 dark:bg-violet-950/50">
              <UsersRound className="size-4 text-violet-600 dark:text-violet-400" aria-hidden />
            </span>
            Referral guilds
          </h2>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Peer communities where members share referrals, intros and honest advice.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen((o) => !o)}
          aria-expanded={createOpen}
          aria-controls="guild-create-form"
          className="min-h-11 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
        >
          {createOpen ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <Plus className="size-4" aria-hidden />
          )}
          Create guild
        </Button>
      </div>

      {/* create form (collapsible) */}
      {createOpen && (
        <Card id="guild-create-form" className="rounded-2xl shadow-sm" aria-label="Create guild form">
          <CardContent className="space-y-3 p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="guild-name" className="text-xs font-medium text-stone-600 dark:text-stone-300">
                  Guild name *
                </Label>
                <Input
                  id="guild-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Mobile Engineers Guild"
                  maxLength={60}
                  className="min-h-11 rounded-xl"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="guild-focus" className="text-xs font-medium text-stone-600 dark:text-stone-300">
                  Focus
                </Label>
                <Input
                  id="guild-focus"
                  value={form.focus}
                  onChange={(e) => setForm((f) => ({ ...f, focus: e.target.value }))}
                  placeholder="e.g. Mobile, QA, Data…"
                  maxLength={60}
                  className="min-h-11 rounded-xl"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guild-desc" className="text-xs font-medium text-stone-600 dark:text-stone-300">
                Description
              </Label>
              <Textarea
                id="guild-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Who is this guild for and what will members share?"
                rows={3}
                maxLength={1000}
                className="resize-y rounded-xl [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-200 [&::-webkit-scrollbar]:w-1.5 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setCreateOpen(false)}
                className="min-h-11 rounded-xl text-stone-500"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void createGuild()}
                disabled={creating}
                className="min-h-11 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
              >
                {creating && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Create guild
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {renderListStates()}

      {guilds !== null && !listError && sortedGuilds.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {sortedGuilds.map((g) => renderGuildCard(g))}
        </div>
      )}
    </div>
  )

  /* ----------------------------- detail view -------------------------- */

  const composerView = () => {
    if (!detail) return null
    if (!isMember) {
      return (
        <Card className="rounded-2xl border-dashed shadow-sm">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <Lock className="mt-0.5 size-4 shrink-0 text-stone-400" aria-hidden />
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Join the guild to post — membership keeps this space accountable and
                spam-free.
              </p>
            </div>
            <Button
              onClick={() => void joinGuild(detail.guild.id)}
              disabled={busyGuildId === detail.guild.id}
              className="min-h-11 shrink-0 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
            >
              {busyGuildId === detail.guild.id && (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              )}
              Join {detail.guild.name}
            </Button>
          </CardContent>
        </Card>
      )
    }
    const kindMeta = KIND_META[composer.kind]
    return (
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="space-y-3 p-5">
          <h3 className="flex items-center gap-2 text-sm font-bold text-stone-800 dark:text-stone-200">
            <span className="flex size-7 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-950/50">
              <PenLine className="size-3.5 text-violet-600 dark:text-violet-400" aria-hidden />
            </span>
            Share with the guild
          </h3>

          {/* kind segmented control */}
          <div
            role="group"
            aria-label="Post type"
            className="flex gap-2"
          >
            {(Object.keys(KIND_META) as PostKind[]).map((k) => {
              const active = composer.kind === k
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setComposer((c) => ({ ...c, kind: k }))}
                  className={cn(
                    'min-h-11 flex-1 rounded-xl border px-2 text-xs font-semibold transition-colors',
                    active
                      ? KIND_META[k].active
                      : 'border-stone-200 bg-white text-stone-500 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-stone-600'
                  )}
                >
                  {KIND_META[k].label}
                </button>
              )
            })}
          </div>
          <p className="-mt-1 text-[11px] text-stone-400 dark:text-stone-500">{kindMeta.hint}</p>

          <div className="space-y-1.5">
            <Label htmlFor="post-title" className="sr-only">
              Post title
            </Label>
            <Input
              id="post-title"
              value={composer.title}
              onChange={(e) => setComposer((c) => ({ ...c, title: e.target.value }))}
              placeholder="Post title — e.g. Offering: intro to my team for a Senior React role"
              maxLength={120}
              className="min-h-11 rounded-xl"
            />
            <p className="text-right text-[11px] text-stone-400">{composer.title.length}/120</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="post-body" className="sr-only">
              Post body
            </Label>
            <Textarea
              id="post-body"
              value={composer.body}
              onChange={(e) => setComposer((c) => ({ ...c, body: e.target.value }))}
              placeholder="Share context: the role, what you can vouch for, or what you're looking for…"
              rows={4}
              maxLength={2000}
              className="resize-y rounded-xl [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-200 [&::-webkit-scrollbar]:w-1.5 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700"
            />
            <p className="text-right text-[11px] text-stone-400">{composer.body.length}/2000</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="post-job" className="text-xs font-medium text-stone-500 dark:text-stone-400">
                Role (optional)
              </Label>
              <Input
                id="post-job"
                value={composer.jobTitle}
                onChange={(e) => setComposer((c) => ({ ...c, jobTitle: e.target.value }))}
                placeholder="e.g. Senior Frontend Engineer"
                maxLength={120}
                className="min-h-11 rounded-xl"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="post-company" className="text-xs font-medium text-stone-500 dark:text-stone-400">
                Company (optional)
              </Label>
              <Input
                id="post-company"
                value={composer.companyName}
                onChange={(e) => setComposer((c) => ({ ...c, companyName: e.target.value }))}
                placeholder="e.g. TechNova Solutions"
                maxLength={120}
                className="min-h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => void submitPost()}
              disabled={posting}
              className="min-h-11 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
            >
              {posting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
              Post to guild
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const postView = (post: GuildPostItem) => {
    const meta = KIND_META[(post.kind as PostKind) in KIND_META ? (post.kind as PostKind) : 'UPDATE']
    const isExpanded = expandedPosts.has(post.id)
    const threadOpen = openThreads.has(post.id)
    return (
      <article
        key={post.id}
        aria-label={`Post: ${post.title}`}
        className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-900"
      >
        <div className="flex flex-wrap items-start gap-2">
          <Badge className={cn('shrink-0 rounded-full border text-[11px] font-semibold', meta.chip)}>
            {meta.label}
          </Badge>
          <h4 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-stone-900 dark:text-stone-100">
            {post.title}
          </h4>
          <span className="shrink-0 text-[11px] text-stone-400 dark:text-stone-500">
            {rel(post.createdAt)}
          </span>
        </div>

        <p
          className={cn(
            'mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-600 dark:text-stone-300',
            !isExpanded && 'line-clamp-4'
          )}
        >
          {post.body}
        </p>
        {post.body.length > BODY_CLAMP_THRESHOLD && (
          <button
            type="button"
            onClick={() => toggleExpanded(post.id)}
            className="mt-1 min-h-11 text-xs font-semibold text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300"
            aria-expanded={isExpanded}
          >
            {isExpanded ? 'Show less' : 'Show more'}
          </button>
        )}

        {(post.jobTitle || post.companyName) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {post.jobTitle && (
              <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                <PenLine className="size-3" aria-hidden /> {post.jobTitle}
              </span>
            )}
            {post.companyName && (
              <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                <Building2 className="size-3" aria-hidden /> {post.companyName}
              </span>
            )}
          </div>
        )}

        <div className="mt-3 flex items-center gap-2">
          <Avatar className="size-7">
            <AvatarFallback className="bg-gradient-to-br from-violet-100 to-amber-100 text-[10px] font-bold text-violet-700 dark:from-violet-900/40 dark:to-amber-900/40 dark:text-violet-300">
              {initials(post.authorName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-stone-700 dark:text-stone-200">
              {post.authorName}
            </p>
            {post.authorHeadline && (
              <p className="truncate text-[11px] text-stone-400 dark:text-stone-500">
                {post.authorHeadline}
              </p>
            )}
          </div>
        </div>

        {/* replies */}
        <div className="mt-3 border-t border-stone-100 pt-1 dark:border-stone-800">
          <button
            type="button"
            onClick={() => toggleThread(post.id)}
            aria-expanded={threadOpen}
            className="inline-flex min-h-11 items-center gap-1 px-1 text-xs font-semibold text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform', threadOpen && 'rotate-180')}
              aria-hidden
            />
            Replies ({post.replyCount})
          </button>

          {threadOpen && (
            <div className="space-y-2 pb-1">
              {post.replies.length === 0 && (
                <p className="px-1 text-xs text-stone-400 dark:text-stone-500">
                  No replies yet — be the first to help.
                </p>
              )}
              {post.replies.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg bg-stone-50 px-3 py-2 dark:bg-stone-800/60"
                >
                  <p className="text-[11px] text-stone-400 dark:text-stone-500">
                    <span className="font-semibold text-stone-600 dark:text-stone-300">
                      {r.authorName}
                    </span>{' '}
                    · {rel(r.createdAt)}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-stone-600 dark:text-stone-300">
                    {r.body}
                  </p>
                </div>
              ))}

              {isMember ? (
                <div className="flex items-center gap-2 pt-1">
                  <Label htmlFor={`reply-${post.id}`} className="sr-only">
                    Write a reply
                  </Label>
                  <Input
                    id={`reply-${post.id}`}
                    value={replyDrafts[post.id] ?? ''}
                    onChange={(e) =>
                      setReplyDrafts((prev) => ({ ...prev, [post.id]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void submitReply(post.id)
                      }
                    }}
                    placeholder="Write a reply…"
                    maxLength={1000}
                    className="min-h-11 flex-1 rounded-xl"
                  />
                  <Button
                    size="icon"
                    aria-label="Send reply"
                    disabled={replyingTo === post.id}
                    onClick={() => void submitReply(post.id)}
                    className="size-11 shrink-0 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
                  >
                    {replyingTo === post.id ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="size-4" aria-hidden />
                    )}
                  </Button>
                </div>
              ) : (
                <p className="px-1 pt-1 text-xs text-stone-400 dark:text-stone-500">
                  <Lock className="mr-1 inline size-3" aria-hidden /> Join the guild to reply.
                </p>
              )}
            </div>
          )}
        </div>
      </article>
    )
  }

  const detailView = () => {
    if (detailLoading) {
      return (
        <div className="space-y-4" aria-label="Loading guild">
          <Skeleton className="h-11 w-28 rounded-xl" />
          <Card className="rounded-2xl shadow-sm">
            <CardContent className="space-y-3 p-5">
              <Skeleton className="h-5 w-1/2 rounded-full" />
              <Skeleton className="h-3 w-full rounded-full" />
              <Skeleton className="h-3 w-2/3 rounded-full" />
            </CardContent>
          </Card>
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-2xl" />
          ))}
        </div>
      )
    }
    if (detailError || !detail) {
      return (
        <div className="space-y-4">
          <Button
            variant="outline"
            onClick={handleBack}
            className="min-h-11 rounded-xl border-stone-200 dark:border-stone-700"
          >
            <ArrowLeft className="size-4" aria-hidden /> All guilds
          </Button>
          <Card className="rounded-2xl border-rose-200 shadow-md dark:border-rose-900/60">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="flex items-center gap-2 text-sm font-medium text-rose-600">
                <AlertTriangle className="size-4" aria-hidden /> {detailError ?? 'Guild not found'}
              </p>
              {activeGuildId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void loadDetail(activeGuildId)}
                  className="min-h-11"
                >
                  <RefreshCw className="size-4" aria-hidden /> Retry
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      )
    }

    const g = detail.guild
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          onClick={handleBack}
          className="min-h-11 rounded-xl px-3 text-stone-600 dark:text-stone-300"
          aria-label="Back to all guilds"
        >
          <ArrowLeft className="size-4" aria-hidden /> All guilds
        </Button>

        {/* guild header */}
        <Card className="rounded-2xl shadow-sm">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-stone-900 dark:text-stone-100">
                    {g.name}
                  </h2>
                  <Badge className="rounded-full border-transparent bg-violet-100 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
                    {g.focus || 'General'}
                  </Badge>
                  {isMember && (
                    <Badge className="rounded-full border-transparent bg-emerald-50 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      <Check className="mr-0.5 size-3" aria-hidden />
                      {myRole === 'LEAD' ? 'You lead this guild' : 'Member'}
                    </Badge>
                  )}
                </div>
                <p className="mt-1.5 text-sm text-stone-500 dark:text-stone-400">{g.description}</p>
              </div>
              {isMember ? (
                <Button
                  variant="outline"
                  disabled={busyGuildId === g.id}
                  onClick={() => void leaveGuild(g.id)}
                  className="min-h-11 shrink-0 rounded-xl border-stone-200 text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                >
                  {busyGuildId === g.id && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Leave guild
                </Button>
              ) : (
                <Button
                  disabled={busyGuildId === g.id}
                  onClick={() => void joinGuild(g.id)}
                  className="min-h-11 shrink-0 rounded-xl bg-violet-600 text-white hover:bg-violet-700"
                >
                  {busyGuildId === g.id && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  Join guild
                </Button>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5 text-stone-400" aria-hidden /> {g.memberCount} members
              </span>
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="size-3.5 text-stone-400" aria-hidden /> {g.postCount} posts
              </span>
              <span className="inline-flex items-center gap-1">
                <UsersRound className="size-3.5 text-stone-400" aria-hidden /> Led by {g.createdByName}
              </span>
            </div>

            {g.guidelines && (
              <div
                className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                role="note"
                aria-label="Guild guidelines"
              >
                <p className="flex items-center gap-1.5 font-semibold">
                  <ShieldCheck className="size-3.5 shrink-0" aria-hidden /> Guild guidelines
                </p>
                <p className="mt-1">{g.guidelines}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* composer */}
        {composerView()}

        {/* feed */}
        <section aria-label={`Posts in ${g.name}`}>
          {detail.posts.length === 0 ? (
            <Card className="rounded-2xl border-dashed shadow-sm">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-violet-50 dark:bg-violet-950/40">
                  <MessageSquare className="size-6 text-violet-500" aria-hidden />
                </span>
                <h3 className="font-semibold text-stone-800 dark:text-stone-200">No posts yet</h3>
                <p className="max-w-xs text-sm text-stone-500 dark:text-stone-400">
                  Be the first to share an opening or ask for an intro.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1 pb-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-stone-300 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1.5 dark:[&::-webkit-scrollbar-thumb]:bg-stone-700">
              {detail.posts.map((p) => postView(p))}
            </div>
          )}
        </section>

        {/* helper for screen readers */}
        <p className="sr-only">
          <Info className="inline size-3" /> {detail.posts.length} posts listed in {g.name}
        </p>
      </div>
    )
  }

  return <div>{view === 'list' ? listView : detailView()}</div>
}
