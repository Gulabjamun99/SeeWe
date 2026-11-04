'use client'

/**
 * MessagesPanel — direct 1:1 chat between a candidate and a recruiter.
 *
 * Two-pane inbox:
 *  · left  — conversation list (peer card, last-message preview, unread badge)
 *            + "New message" starter picker (suggested contacts from the API)
 *  · right — the open thread: bubbles, timestamps, optional job-context chip,
 *            composer (Enter sends), auto-refresh polling, mark-as-read on open
 *
 * Shared by the candidate dashboard and the recruiter dashboard — the panel is
 * role-agnostic; every label adapts to the logged-in user's role.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowLeft, MessageSquare, Send, UserPlus, Loader2, Briefcase, Inbox } from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { timeAgoShort } from './recruiter/timeAgo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

interface Peer {
  id: string
  name: string
  role: string
  headline: string | null
  company: string | null
  avatarUrl: string | null
  avatarSeed: string | null
  disabled?: boolean
}

interface Thread {
  peer: Peer
  lastMessage: { preview: string; createdAt: string; mine: boolean; read: boolean }
  unread: number
}

interface ChatMessage {
  id: string
  mine: boolean
  body: string
  read: boolean
  createdAt: string
  job: { id: string; title: string; company: string } | null
}

const AVATAR_TONES = [
  'bg-teal-100 text-teal-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-violet-100 text-violet-700',
  'bg-lime-100 text-lime-700',
  'bg-orange-100 text-orange-700',
]

function toneFor(seed: string | null | undefined, name: string): string {
  if (seed) {
    const sum = Array.from(seed).reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    return AVATAR_TONES[sum % AVATAR_TONES.length]
  }
  const sum = Array.from(name).reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return AVATAR_TONES[sum % AVATAR_TONES.length]
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function clockOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
}

export function MessagesPanel({ role }: { role: 'CANDIDATE' | 'RECRUITER' }) {
  const user = useAppStore((s) => s.user)
  const pendingFocus = useAppStore((s) => s.pendingFocus)
  const setPendingFocus = useAppStore((s) => s.setPendingFocus)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)

  const [threads, setThreads] = useState<Thread[]>([])
  const [suggested, setSuggested] = useState<Peer[]>([])
  const [inboxLoading, setInboxLoading] = useState(true)
  const [activePeer, setActivePeer] = useState<Peer | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false)

  const scrollBottomRef = useRef<HTMLDivElement | null>(null)
  const activePeerIdRef = useRef<string | null>(null)
  const myId = user?.id ?? ''

  const loadInbox = useCallback(async () => {
    if (!myId) return
    try {
      const res = await fetch(`/api/messages/threads?userId=${encodeURIComponent(myId)}`, {
        cache: 'no-store',
      })
      const json = await res.json()
      if (res.ok && json?.data) {
        setThreads(json.data.threads ?? [])
        setSuggested(json.data.suggestedPeers ?? [])
      }
    } catch {
      /* inbox refresh is best-effort; the thread view surfaces real errors */
    } finally {
      setInboxLoading(false)
    }
  }, [myId])

  // Open (or poll) the active thread; marks incoming messages read.
  const loadThread = useCallback(
    async (peerId: string, markRead = true) => {
      if (!myId) return
      try {
        const res = await fetch(
          `/api/messages?userId=${encodeURIComponent(myId)}&peerId=${encodeURIComponent(peerId)}`,
          { cache: 'no-store' }
        )
        const json = await res.json()
        if (!res.ok || !json?.data) {
          toast.error(json?.error ?? 'Could not load conversation')
          return
        }
        setMessages(json.data.messages ?? [])
        setActivePeer((prev) => prev?.id === peerId ? prev : (json.data.peer as Peer))
        if (markRead) {
          void fetch('/api/messages', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: myId, peerId }),
          }).then(() => loadInbox())
        }
      } catch {
        toast.error('Network error while loading the conversation')
      }
    },
    [myId, loadInbox]
  )

  // Initial inbox load + polling
  useEffect(() => {
    if (!myId) return
    void loadInbox()
    const t = setInterval(() => void loadInbox(), 12000)
    return () => clearInterval(t)
  }, [myId, loadInbox])

  // Deep-link handoff: another surface asked us to open a conversation
  useEffect(() => {
    if (!pendingFocus || pendingFocus.kind !== 'messages' || !myId) return
    const { peerId, peerName } = pendingFocus
    setPendingFocus(null)
    if (!peerId) return
    setActivePeer({ id: peerId, name: peerName ?? 'Conversation', role: role === 'RECRUITER' ? 'CANDIDATE' : 'RECRUITER', headline: null, company: null, avatarUrl: null, avatarSeed: null })
    setMobileThreadOpen(true)
    activePeerIdRef.current = peerId
    void loadThread(peerId)
  }, [pendingFocus, setPendingFocus, myId, role, loadThread])

  // Poll the open thread every 5s
  useEffect(() => {
    const peerId = activePeer?.id
    if (!peerId || !myId) return
    activePeerIdRef.current = peerId
    const t = setInterval(() => void loadThread(peerId), 5000)
    return () => clearInterval(t)
  }, [activePeer?.id, myId, loadThread])

  // Auto-scroll to the newest message
  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, activePeer?.id])

  async function send() {
    const text = draft.trim()
    if (!text || !myId || !activePeer || sending) return
    if (text.length > 2000) {
      toast.error('Message too long (max 2000 characters)')
      return
    }
    setSending(true)
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderId: myId, recipientId: activePeer.id, body: text }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json?.error ?? 'Message could not be sent')
        return
      }
      setMessages((prev) => [
        ...prev,
        {
          id: json.data.id,
          mine: true,
          body: json.data.body,
          read: false,
          createdAt: json.data.createdAt,
          job: null,
        },
      ])
      setDraft('')
      void loadInbox()
      bumpRefresh()
    } catch {
      toast.error('Network error — message not sent')
    } finally {
      setSending(false)
    }
  }

  function openThreadWith(peer: Peer) {
    setActivePeer(peer)
    setMessages([])
    setThreadLoading(true)
    setMobileThreadOpen(true)
    setPickerOpen(false)
    void loadThread(peer.id).finally(() => setThreadLoading(false))
  }

  const totalUnread = useMemo(() => threads.reduce((n, t) => n + t.unread, 0), [threads])
  const roleChip = (peerRole: string) =>
    peerRole === 'RECRUITER' ? 'Recruiter' : 'Candidate'

  if (!user) return null

  // ---------------------------------------------------------------- render
  return (
    <div className="space-y-4">
      {/* header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <MessageSquare className="h-5 w-5 text-teal-600" aria-hidden />
            Messages
            {totalUnread > 0 && (
              <Badge className="bg-teal-600 text-white">{totalUnread} new</Badge>
            )}
          </h2>
          <p className="text-sm text-muted-foreground">
            {role === 'RECRUITER'
              ? 'Chat directly with candidates — screening questions, interview slots, next steps.'
              : 'Chat directly with recruiters — ask about your applications, share updates.'}
          </p>
        </div>
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" className="gap-1.5 bg-teal-600 hover:bg-teal-700">
              <UserPlus className="h-4 w-4" aria-hidden />
              New message
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-2">
            <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Start a conversation
            </p>
            {suggested.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                {role === 'RECRUITER'
                  ? 'No suggestions yet — candidates who apply to your jobs appear here.'
                  : 'No suggestions yet — apply to jobs and their recruiters appear here.'}
              </p>
            ) : (
              <div className="max-h-72 space-y-0.5 overflow-y-auto">
                {suggested.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => openThreadWith(p)}
                    className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition hover:bg-muted"
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                        toneFor(p.avatarSeed, p.name)
                      )}
                    >
                      {initialsOf(p.name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {p.headline || p.company || roleChip(p.role)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* ---------------- inbox list ---------------- */}
        <Card
          className={cn(
            'overflow-hidden',
            mobileThreadOpen && 'hidden lg:block'
          )}
        >
          <CardContent className="p-0">
            <ScrollArea className="h-[520px]">
              {inboxLoading ? (
                <div className="flex h-40 items-center justify-center text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                </div>
              ) : threads.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground">
                  <Inbox className="h-8 w-8" aria-hidden />
                  <p className="text-sm">No conversations yet.</p>
                  <p className="text-xs">Use “New message” to start one.</p>
                </div>
              ) : (
                <ul className="divide-y">
                  {threads.map((t) => {
                    const isActive = t.peer.id === activePeer?.id
                    return (
                      <li key={t.peer.id}>
                        <button
                          onClick={() => openThreadWith(t.peer)}
                          className={cn(
                            'flex w-full items-start gap-3 px-3 py-3 text-left transition hover:bg-muted/60',
                            isActive && 'bg-teal-50/70 dark:bg-teal-950/30'
                          )}
                        >
                          <span
                            className={cn(
                              'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                              toneFor(t.peer.avatarSeed, t.peer.name)
                            )}
                          >
                            {initialsOf(t.peer.name)}
                            {t.unread > 0 && (
                              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-teal-600 px-1 text-[10px] font-bold text-white">
                                {t.unread}
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="truncate text-sm font-semibold">
                                {t.peer.name}
                              </span>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                {timeAgoShort(t.lastMessage.createdAt)}
                              </span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {t.lastMessage.mine ? 'You: ' : ''}
                              {t.lastMessage.preview || '…'}
                            </span>
                            <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                                {roleChip(t.peer.role)}
                              </span>
                              {t.peer.company && (
                                <span className="truncate">{t.peer.company}</span>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* ---------------- thread view ---------------- */}
        <Card className={cn('flex flex-col overflow-hidden', !mobileThreadOpen && 'hidden lg:flex')}>
          {!activePeer ? (
            <CardContent className="flex h-[520px] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
              <MessageSquare className="h-10 w-10" aria-hidden />
              <p className="text-sm">Pick a conversation — or start a new one.</p>
            </CardContent>
          ) : (
            <>
              {/* thread header */}
              <div className="flex items-center gap-3 border-b px-4 py-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 lg:hidden"
                  aria-label="Back to inbox"
                  onClick={() => setMobileThreadOpen(false)}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                </Button>
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    toneFor(activePeer.avatarSeed, activePeer.name)
                  )}
                >
                  {initialsOf(activePeer.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{activePeer.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {roleChip(activePeer.role)}
                    {activePeer.headline ? ` · ${activePeer.headline}` : ''}
                    {activePeer.company ? ` · ${activePeer.company}` : ''}
                  </p>
                </div>
                <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-teal-500" aria-hidden />
                  live
                </span>
              </div>

              {/* messages */}
              <ScrollArea className="h-[380px] flex-1">
                <div className="space-y-3 px-4 py-4">
                  {threadLoading && messages.length === 0 ? (
                    <div className="flex h-32 items-center justify-center text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    </div>
                  ) : messages.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">
                      No messages yet — say hello 👋
                    </p>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={cn('flex', m.mine ? 'justify-end' : 'justify-start')}
                      >
                        <div className="max-w-[78%] space-y-1">
                          {m.job && (
                            <div
                              className={cn(
                                'flex items-center gap-1.5 rounded-lg border bg-muted/50 px-2.5 py-1 text-[11px] text-muted-foreground',
                                m.mine ? 'ml-auto' : 'mr-auto'
                              )}
                            >
                              <Briefcase className="h-3 w-3 shrink-0" aria-hidden />
                              <span className="truncate">
                                {m.job.title} · {m.job.company}
                              </span>
                            </div>
                          )}
                          <div
                            className={cn(
                              'rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm',
                              m.mine
                                ? 'rounded-br-md bg-teal-600 text-white'
                                : 'rounded-bl-md border bg-white text-foreground dark:bg-muted'
                            )}
                          >
                            <p className="whitespace-pre-wrap break-words">{m.body}</p>
                          </div>
                          <p
                            className={cn(
                              'text-[10px] text-muted-foreground',
                              m.mine ? 'text-right' : 'text-left'
                            )}
                          >
                            {clockOf(m.createdAt)}
                            {m.mine && (m.read ? ' · read' : ' · sent')}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                  <div ref={scrollBottomRef} />
                </div>
              </ScrollArea>

              {/* composer */}
              <div className="border-t p-3">
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void send()
                  }}
                >
                  <Input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={
                      role === 'RECRUITER'
                        ? `Message ${activePeer.name.split(' ')[0]}…`
                        : 'Type your message…'
                    }
                    maxLength={2000}
                    aria-label="Message text"
                    className="flex-1"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    aria-label="Send message"
                    disabled={sending || !draft.trim()}
                    className="shrink-0 bg-teal-600 hover:bg-teal-700"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden />
                    )}
                  </Button>
                </form>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Enter to send · messages auto-refresh every few seconds
                </p>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}
