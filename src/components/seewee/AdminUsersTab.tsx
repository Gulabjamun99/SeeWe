'use client'

/**
 * AdminUsersTab — user management for the admin console (master spec §33).
 * Search, verification badges, member-since and an Active/Disabled switch
 * (disable = block ALL sign-ins for that email; login API enforces it).
 */

import { useCallback, useEffect, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { MailCheck, Phone, RefreshCw, Search, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

interface ManagedUser {
  id: string
  name: string
  email: string
  role: string
  disabled: boolean
  emailVerified: boolean
  phoneVerified: boolean
  createdAt: string
  applicationCount: number
}

const ROLE_BADGE: Record<string, { label: string; className: string }> = {
  CANDIDATE: { label: 'Candidate', className: 'border-blue-300 bg-blue-100 dark:bg-blue-900/40 text-blue-800' },
  RECRUITER: { label: 'Recruiter', className: 'border-sky-300 bg-sky-100 dark:bg-sky-900/40 text-sky-800' },
  CLIENT: { label: 'Client', className: 'border-amber-300 bg-amber-100 dark:bg-amber-900/40 text-amber-800' },
  ADMIN: { label: 'Admin', className: 'border-slate-700 bg-slate-800 text-white' },
}

export function AdminUsersTab() {
  const user = useAppStore((s) => s.user)
  const [users, setUsers] = useState<ManagedUser[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [appliedQ, setAppliedQ] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)
  // Pending disable/enable awaiting confirmation in the AlertDialog
  const [pending, setPending] = useState<{ target: ManagedUser; next: boolean } | null>(null)

  // Debounce the search box (300 ms)
  useEffect(() => {
    const t = setTimeout(() => setAppliedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])

  const loadUsers = useCallback(async () => {
    if (!user || user.role !== 'ADMIN') return
    setLoading(true)
    try {
      const params = new URLSearchParams({ adminId: user.id })
      if (appliedQ) params.set('q', appliedQ)
      const res = await fetch(`/api/admin/users?${params.toString()}`)
      const json = (await res.json().catch(() => ({}))) as { data?: ManagedUser[]; error?: string }
      if (!res.ok || json.error || !json.data) throw new Error(json.error ?? 'Failed to load users')
      setUsers(json.data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load users')
      setUsers((prev) => prev ?? [])
    } finally {
      setLoading(false)
    }
  }, [user, appliedQ])

  useEffect(() => {
    void loadUsers()
  }, [loadUsers])

  async function applyToggle(target: ManagedUser, next: boolean) {
    if (!user) return
    setTogglingId(target.id)
    try {
      const res = await fetch(`/api/admin/users/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminId: user.id, disabled: next }),
      })
      const json = (await res.json().catch(() => ({}))) as { data?: ManagedUser; error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? 'Update failed')
      toast.success(
        next
          ? `${target.name} disabled — sign-ins for this email are now blocked`
          : `${target.name} re-enabled — they can sign in again`
      )
      setUsers((prev) => (prev ? prev.map((u) => (u.id === target.id ? { ...u, disabled: next } : u)) : prev))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setTogglingId(null)
      setPending(null)
    }
  }

  const rows = users ?? []

  return (
    <Card className="rounded-xl">
      <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
          <Users className="size-4 text-blue-600" aria-hidden /> User management
          {users && (
            <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
              {rows.length} account{rows.length === 1 ? '' : 's'}
              {rows.some((u) => u.disabled) &&
                ` · ${rows.filter((u) => u.disabled).length} disabled`}
            </span>
          )}
        </CardTitle>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name or email…"
              aria-label="Search users by name or email"
              className="h-9 rounded-lg pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadUsers()}
            disabled={loading}
            aria-label="Refresh user list"
            className="rounded-lg"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="max-h-96 overflow-y-auto rounded-lg border pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent">
          {loading && !users ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users className="size-8 text-slate-300" aria-hidden />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No users found</p>
              <p className="text-xs text-slate-400">
                {appliedQ ? `Nothing matches “${appliedQ}”.` : 'No accounts exist yet.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead className="text-right">Member since</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => {
                  const roleBadge = ROLE_BADGE[u.role] ?? {
                    label: u.role,
                    className: 'border-slate-300 bg-slate-100 text-slate-700 dark:text-slate-300',
                  }
                  const isSelf = user?.id === u.id
                  return (
                    <TableRow key={u.id} className={u.disabled ? 'bg-rose-50/50 dark:bg-rose-950/10' : undefined}>
                      <TableCell className="max-w-52">
                        <p className="flex items-center gap-1.5 truncate font-medium text-slate-800 dark:text-slate-200">
                          {u.name}
                          {isSelf && (
                            <Badge variant="outline" className="border-slate-300 px-1 py-0 text-[9px] uppercase text-slate-500">
                              you
                            </Badge>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">{u.email}</p>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant="outline" className={roleBadge.className}>
                            {roleBadge.label}
                          </Badge>
                          {u.role === 'CANDIDATE' && u.applicationCount > 0 && (
                            <span className="text-[10px] text-slate-400">{u.applicationCount} applications</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5" aria-label="Verification status">
                          {u.emailVerified ? (
                            <MailCheck className="size-4 text-emerald-600" aria-label="Email verified" />
                          ) : (
                            <MailCheck className="size-4 text-slate-300 dark:text-slate-600" aria-label="Email not verified" />
                          )}
                          {u.phoneVerified ? (
                            <Phone className="size-3.5 text-emerald-600" aria-label="Phone verified" />
                          ) : (
                            <Phone className="size-3.5 text-slate-300 dark:text-slate-600" aria-label="Phone not verified" />
                          )}
                          {u.disabled && (
                            <Badge variant="outline" className="border-rose-300 bg-rose-100 text-rose-700 dark:bg-rose-950/40">
                              Disabled
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <p className="text-slate-600 dark:text-slate-300">{joinedDate(u.createdAt)}</p>
                        <p className="text-[10px] text-slate-400">{relativeAge(u.createdAt)}</p>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex justify-center">
                          <Switch
                            checked={!u.disabled}
                            disabled={togglingId === u.id || (isSelf && !u.disabled)}
                            aria-label={`${u.disabled ? 'Enable' : 'Disable'} account ${u.email}`}
                            onCheckedChange={(turningActive) => {
                              // Switch ON = account active; OFF = disabled.
                              const nextDisabled = !turningActive
                              if (isSelf && nextDisabled) {
                                toast.error('You cannot disable your own account')
                                return
                              }
                              setPending({ target: u, next: nextDisabled })
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
          Disabling an account blocks every sign-in for that email immediately (including demo-lite
          paths). The user keeps their data — re-enable anytime with the same switch.
        </p>
      </CardContent>

      {/* Confirm disable / enable */}
      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent className="rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.next ? `Disable ${pending?.target.name}?` : `Re-enable ${pending?.target.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.next
                ? `${pending?.target.email} will be signed out of the login flow immediately — any sign-in attempt returns “account has been disabled”. Their data and applications are kept.`
                : `${pending?.target.email} will be able to sign in again right away.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pending && void applyToggle(pending.target, pending.next)}
              className={pending?.next ? 'bg-rose-600 text-white hover:bg-rose-700' : undefined}
            >
              {pending?.next ? 'Disable account' : 'Re-enable account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

function joinedDate(iso: string): string {
  try {
    return format(new Date(iso), 'd MMM yyyy')
  } catch {
    return '—'
  }
}

function relativeAge(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true })
  } catch {
    return ''
  }
}
