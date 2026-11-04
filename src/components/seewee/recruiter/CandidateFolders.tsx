'use client'

/**
 * CandidateFolders — master spec §9 recruiter CRM tab.
 *
 * Left: the recruiter's folders (create via dialog, delete with confirm).
 * Right: the selected folder's members as cards — photo/avatar, name,
 * headline, tags chips, folder-scoped note, inline edit (tags + note via
 * PATCH) and remove (DELETE). Candidates are saved into folders from the
 * Talent Search cards ("Save to folder" popover).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  FolderOpen,
  FolderPlus,
  Loader2,
  MapPin,
  Pencil,
  Search,
  Tag,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

interface FolderLite {
  id: string
  name: string
  createdAt: string
  memberCount: number
  memberUserIds: string[]
}

interface FolderMember {
  id: string
  userId: string
  tags: string | null
  note: string | null
  createdAt: string
  candidate: {
    id: string
    name: string
    headline: string | null
    skills: string | null
    experienceYears: number | null
    location: string | null
    avatarSeed: string | null
    photoData: string | null
    photoMime: string | null
  }
}

const SCROLLBAR_CLS =
  '[scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 [&::-webkit-scrollbar-track]:bg-transparent'

const AVATAR_STYLES = [
  'bg-blue-100 dark:bg-blue-900/40 text-blue-800',
  'bg-rose-100 dark:bg-rose-900/40 text-rose-800',
  'bg-amber-100 dark:bg-amber-900/40 text-amber-800',
  'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800',
  'bg-cyan-100 text-cyan-800',
]

function initials(name?: string | null): string {
  return (name || '?')
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

function pickAvatarStyle(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return AVATAR_STYLES[h % AVATAR_STYLES.length]
}

function tagsToArray(csv: string | null | undefined): string[] {
  if (!csv) return []
  return csv
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export function CandidateFolders() {
  const user = useAppStore((s) => s.user)
  const recruiterId = user?.role === 'RECRUITER' ? user.id : null

  const [folders, setFolders] = useState<FolderLite[]>([])
  const [foldersLoading, setFoldersLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const [members, setMembers] = useState<FolderMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [membersError, setMembersError] = useState<string | null>(null)

  // create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  // delete confirm
  const [deleteTarget, setDeleteTarget] = useState<FolderLite | null>(null)
  const [deleting, setDeleting] = useState(false)

  // inline member edit
  const [editId, setEditId] = useState<string | null>(null)
  const [editTags, setEditTags] = useState('')
  const [editNote, setEditNote] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const loadFolders = useCallback(async () => {
    if (!recruiterId) return
    setFoldersLoading(true)
    try {
      const res = await fetch(
        `/api/recruiters/folders?recruiterId=${encodeURIComponent(recruiterId)}`
      )
      const json: { data?: FolderLite[]; error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load folders')
      setFolders(json.data ?? [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load folders')
    } finally {
      setFoldersLoading(false)
    }
  }, [recruiterId])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  // keep a sensible selection as folders change
  useEffect(() => {
    if (selectedId && folders.some((f) => f.id === selectedId)) return
    setSelectedId(folders[0]?.id ?? null)
  }, [folders, selectedId])

  const loadMembers = useCallback(async () => {
    if (!recruiterId || !selectedId) {
      setMembers([])
      return
    }
    setMembersLoading(true)
    setMembersError(null)
    try {
      const res = await fetch(
        `/api/recruiters/folders/${selectedId}?recruiterId=${encodeURIComponent(recruiterId)}`
      )
      const json: {
        data?: { members?: FolderMember[] }
        error?: string
      } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to load folder')
      setMembers(json.data?.members ?? [])
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : 'Could not load members')
    } finally {
      setMembersLoading(false)
    }
  }, [recruiterId, selectedId])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  const createFolder = async () => {
    if (!recruiterId) return
    const trimmed = newName.trim()
    if (!trimmed) {
      toast.error('Give the folder a name')
      return
    }
    if (trimmed.length > 40) {
      toast.error('Folder name must be 40 characters or fewer')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/recruiters/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recruiterId, name: trimmed }),
      })
      const json: { data?: FolderLite; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Failed to create folder')
      }
      setFolders((prev) => [json.data!, ...prev])
      setSelectedId(json.data.id)
      setCreateOpen(false)
      setNewName('')
      toast.success(`Folder "${trimmed}" created`, {
        description: 'Save candidates into it from the Talent Search cards.',
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create folder')
    } finally {
      setCreating(false)
    }
  }

  const confirmDelete = async () => {
    if (!recruiterId || !deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(
        `/api/recruiters/folders/${deleteTarget.id}?recruiterId=${encodeURIComponent(recruiterId)}`,
        { method: 'DELETE' }
      )
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to delete folder')
      setFolders((prev) => prev.filter((f) => f.id !== deleteTarget.id))
      if (selectedId === deleteTarget.id) setSelectedId(null)
      toast.success(`Deleted "${deleteTarget.name}"`, {
        description: `${deleteTarget.memberCount} member${deleteTarget.memberCount === 1 ? '' : 's'} removed with it.`,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete folder')
    } finally {
      setDeleting(false)
      setDeleteTarget(null)
    }
  }

  const startEdit = (m: FolderMember) => {
    setEditId(m.id)
    setEditTags(m.tags ?? '')
    setEditNote(m.note ?? '')
  }

  const saveEdit = async () => {
    if (!recruiterId || !selectedId || !editId) return
    setSavingEdit(true)
    try {
      const res = await fetch(
        `/api/recruiters/folders/${selectedId}/members/${editId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recruiterId,
            tags: editTags.trim() || null,
            note: editNote.trim() || null,
          }),
        }
      )
      const json: { data?: FolderMember; error?: string } = await res.json()
      if (!res.ok || json.error || !json.data) {
        throw new Error(json.error || 'Failed to update member')
      }
      setMembers((prev) => prev.map((m) => (m.id === editId ? { ...m, ...json.data! } : m)))
      setEditId(null)
      toast.success('Member updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update member')
    } finally {
      setSavingEdit(false)
    }
  }

  const removeMember = async (m: FolderMember) => {
    if (!recruiterId || !selectedId) return
    setRemovingId(m.id)
    try {
      const res = await fetch(
        `/api/recruiters/folders/${selectedId}/members/${m.id}?recruiterId=${encodeURIComponent(recruiterId)}`,
        { method: 'DELETE' }
      )
      const json: { error?: string } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to remove member')
      setMembers((prev) => prev.filter((x) => x.id !== m.id))
      setFolders((prev) =>
        prev.map((f) =>
          f.id === selectedId
            ? {
                ...f,
                memberCount: Math.max(0, f.memberCount - 1),
                memberUserIds: f.memberUserIds.filter((id) => id !== m.userId),
              }
            : f
        )
      )
      toast.success(`${m.candidate.name} removed from folder`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove member')
    } finally {
      setRemovingId(null)
    }
  }

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === selectedId) ?? null,
    [folders, selectedId]
  )

  if (!recruiterId) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-muted-foreground">
        Sign in as a recruiter to use candidate folders.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-slate-100">
            <FolderOpen className="size-5 text-blue-600" aria-hidden /> Candidate folders
          </h2>
          <p className="text-xs text-muted-foreground">
            Your private shortlist CRM — organise talent into folders with tags and notes.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="h-11 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white shadow-md hover:from-blue-700 hover:to-sky-600 sm:h-9"
        >
          <FolderPlus className="size-4" aria-hidden /> New folder
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        {/* -------- left: folder list -------- */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <p className="border-b border-slate-100 dark:border-slate-800 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Folders ({folders.length})
          </p>
          <div className={`max-h-96 overflow-y-auto p-2 lg:max-h-[520px] ${SCROLLBAR_CLS}`}>
            {foldersLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full rounded-lg" />
                ))}
              </div>
            ) : folders.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No folders yet. Create one — then save candidates from Talent Search with the
                folder icon on each card.
              </p>
            ) : (
              folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setSelectedId(f.id)}
                  aria-current={selectedId === f.id}
                  className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    selectedId === f.id
                      ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-200'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <FolderOpen
                    className={`size-4 shrink-0 ${
                      selectedId === f.id ? 'text-blue-600' : 'text-slate-400'
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {f.memberCount}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Delete folder ${f.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteTarget(f)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.stopPropagation()
                        setDeleteTarget(f)
                      }
                    }}
                    className="shrink-0 rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-rose-50 hover:text-rose-600 focus:opacity-100 group-hover:opacity-100 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* -------- right: members -------- */}
        <div className="min-w-0">
          {!selectedFolder ? (
            <div className="rounded-xl border border-dashed border-blue-300 bg-blue-50/40 p-10 text-center dark:border-blue-800 dark:bg-blue-950/20">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-100 dark:bg-blue-900/40">
                <FolderPlus className="size-7 text-blue-600" aria-hidden />
              </span>
              <p className="mt-3 font-semibold text-slate-800 dark:text-slate-200">
                No folder selected
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Pick a folder on the left (or create a new one), then save candidates into it
                from the <Search className="inline size-3.5" aria-hidden /> Talent Search tab —
                every candidate card has a “Save to folder” button.
              </p>
            </div>
          ) : membersLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-xl" />
              ))}
            </div>
          ) : membersError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
              {membersError}
              <Button variant="outline" size="sm" className="ml-3 h-8" onClick={() => void loadMembers()}>
                Retry
              </Button>
            </div>
          ) : members.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-10 text-center dark:border-slate-700 dark:bg-slate-900/40">
              <Users className="mx-auto size-7 text-slate-400" aria-hidden />
              <p className="mt-3 font-semibold text-slate-800 dark:text-slate-200">
                “{selectedFolder.name}” is empty
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Head to Talent Search and tap the folder icon on any candidate card to file them
                here with tags like <em>react</em>, <em>met-at-event</em> or <em>strong</em>.
              </p>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={`grid max-h-[560px] grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2 ${SCROLLBAR_CLS}`}
            >
              {members.map((m) => {
                const c = m.candidate
                const tags = tagsToArray(m.tags)
                const editing = editId === m.id
                return (
                  <div
                    key={m.id}
                    className="flex flex-col gap-2.5 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-start gap-3">
                      <Avatar className="size-10 shrink-0">
                        {c.photoData ? (
                          // avatar-size base64 photo the candidate uploaded (capped small)
                          <img
                            src={`data:${c.photoMime || 'image/jpeg'};base64,${c.photoData}`}
                            alt={`${c.name}'s photo`}
                            className="size-10 rounded-full object-cover"
                          />
                        ) : (
                          <AvatarFallback className={`${pickAvatarStyle(c.id)} font-semibold`}>
                            {initials(c.name)}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-900 dark:text-slate-100">
                          {c.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.headline || 'Open to opportunities'}
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-slate-400 dark:text-slate-500">
                          <span className="flex items-center gap-1">
                            <Users className="size-3" aria-hidden />
                            {c.experienceYears != null ? `${c.experienceYears} yrs` : 'Exp n/a'}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="size-3" aria-hidden />
                            {c.location || '—'}
                          </span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Edit tags / note"
                          aria-label={`Edit ${c.name}'s tags and note`}
                          onClick={() => (editing ? setEditId(null) : startEdit(m))}
                          className="size-8 rounded-full text-slate-400 hover:bg-blue-50 hover:text-blue-700"
                        >
                          {editing ? (
                            <X className="size-4" aria-hidden />
                          ) : (
                            <Pencil className="size-4" aria-hidden />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Remove from folder"
                          aria-label={`Remove ${c.name} from folder`}
                          disabled={removingId === m.id}
                          onClick={() => void removeMember(m)}
                          className="size-8 rounded-full text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          {removingId === m.id ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="size-4" aria-hidden />
                          )}
                        </Button>
                      </div>
                    </div>

                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((t) => (
                          <Badge
                            key={t}
                            variant="outline"
                            className="gap-1 border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"
                          >
                            <Tag className="size-3" aria-hidden /> {t}
                          </Badge>
                        ))}
                      </div>
                    )}

                    {editing ? (
                      <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-2.5 dark:border-blue-900/60 dark:bg-blue-950/20">
                        <div className="grid gap-1.5">
                          <Label htmlFor={`tags-${m.id}`} className="text-[11px] font-semibold text-slate-500">
                            Tags (comma separated)
                          </Label>
                          <Input
                            id={`tags-${m.id}`}
                            value={editTags}
                            onChange={(e) => setEditTags(e.target.value)}
                            placeholder="react, strong, met-at-event"
                            className="h-8 rounded-md text-sm"
                          />
                        </div>
                        <div className="grid gap-1.5">
                          <Label htmlFor={`note-${m.id}`} className="text-[11px] font-semibold text-slate-500">
                            Note
                          </Label>
                          <Textarea
                            id={`note-${m.id}`}
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            rows={2}
                            placeholder="Where you met, follow-ups, fit remarks…"
                            className="resize-y rounded-md text-sm"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditId(null)}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            disabled={savingEdit}
                            onClick={() => void saveEdit()}
                            className="h-8 rounded-md bg-gradient-to-r from-blue-600 to-sky-500 text-white hover:from-blue-700 hover:to-sky-600"
                          >
                            {savingEdit && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : (
                      m.note && (
                        <blockquote className="rounded-r-lg border-l-2 border-blue-200 bg-slate-50/60 py-1.5 pl-3 pr-2 text-xs italic text-slate-600 dark:border-blue-800 dark:bg-slate-800/40 dark:text-slate-300">
                          {m.note}
                        </blockquote>
                      )
                    )}
                  </div>
                )
              })}
            </motion.div>
          )}
        </div>
      </div>

      {/* Create folder dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setNewName('')
        }}
      >
        <DialogContent className="max-w-sm rounded-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="size-4 text-blue-600" aria-hidden /> New folder
            </DialogTitle>
            <DialogDescription>
              Name it around a role, event or priority — only you can see your folders.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="new-folder-name">Folder name</Label>
            <Input
              id="new-folder-name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. React leads · TechNova"
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createFolder()
              }}
            />
            <p className="text-[11px] text-slate-400">{newName.length}/40</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} className="h-11 sm:h-9">
              Cancel
            </Button>
            <Button
              onClick={() => void createFolder()}
              disabled={creating || !newName.trim()}
              className="h-11 rounded-lg bg-gradient-to-r from-blue-600 to-sky-500 text-white hover:from-blue-700 hover:to-sky-600 sm:h-9"
            >
              {creating && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-md rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the folder and its {deleteTarget?.memberCount ?? 0} member
              {deleteTarget?.memberCount === 1 ? '' : 's'} (tags and notes included). The
              candidates themselves are not affected. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Separator />
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
              disabled={deleting}
              className="h-11 rounded-lg bg-rose-600 text-white hover:bg-rose-700 sm:h-9"
            >
              {deleting && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
