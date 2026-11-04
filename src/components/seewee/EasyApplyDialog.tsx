'use client'

/**
 * EasyApplyDialog — one-tap apply straight from the search results.
 *
 * The job card's "⚡ Easy Apply" button opens this compact confirmation:
 * the candidate sees the role, their CV attachment status (with an inline
 * swap), and a single Apply action. No long forms — profile data plus the
 * attached CV go straight to the recruiter, and the confirmation email note
 * closes the loop.
 */

import { useState } from 'react'
import { CheckCircle2, Loader2, Send, Zap } from 'lucide-react'
import { toast } from 'sonner'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAppStore, formatLpa, skillsToArray, consumeApplySource } from '@/store/app-store'
import { InlineCvAttach } from '@/components/seewee/candidate/CvUploadCard'
import { fileToCvPayload } from '@/lib/cv-client'
import type { Job } from '@/lib/types'

interface EasyApplyDialogProps {
  job: Job | null
  onClose: () => void
  onApplied: (jobId: string) => void
}

export function EasyApplyDialog({ job, onClose, onApplied }: EasyApplyDialogProps) {
  const user = useAppStore((s) => s.user)
  const setUser = useAppStore((s) => s.setUser)
  const setAuthOpen = useAppStore((s) => s.setAuthOpen)
  const bumpRefresh = useAppStore((s) => s.bumpRefresh)
  const applySource = useAppStore((s) => s.applySource)
  const [pendingCv, setPendingCv] = useState<File | null>(null)
  const [applying, setApplying] = useState(false)
  const [done, setDone] = useState(false)

  function handleOpenChange(open: boolean) {
    if (!open) {
      setPendingCv(null)
      setDone(false)
      onClose()
    }
  }

  async function submit() {
    if (!user || !job) return
    setApplying(true)
    try {
      const cv = pendingCv ? await fileToCvPayload(pendingCv) : undefined
      const res = await fetch('/api/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: job.id,
          candidateId: user.id,
          // only tagged channels ride on the wire — the API defaults to DIRECT
          ...(applySource && applySource !== 'DIRECT' ? { source: applySource } : {}),
          ...(cv ? { cv } : {}),
        }),
      })
      const json: { error?: string; emailQueued?: { to: string } } = await res.json()
      if (!res.ok || json.error) throw new Error(json.error || 'Failed to apply')

      try {
        const map = JSON.parse(localStorage.getItem('seewee-applied-jobs') ?? '{}') as Record<string, boolean>
        map[job.id] = true
        localStorage.setItem('seewee-applied-jobs', JSON.stringify(map))
      } catch {
        /* local cache is best-effort */
      }
      if (pendingCv) {
        setUser({
          ...user,
          cvFileName: pendingCv.name,
          cvMimeType: pendingCv.type,
          cvUploadedAt: new Date().toISOString(),
        })
      }
      setDone(true)
      onApplied(job.id)
      bumpRefresh()
      // The channel tag is spent by this application (career-page visitors keep theirs)
      consumeApplySource()
      toast.success(
        `⚡ Easy apply done — ${job.title}!${json.emailQueued ? ` Confirmation email sent to ${json.emailQueued.to}` : ''}`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not apply — please retry')
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={!!job} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        {job && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <Zap className="size-5 text-amber-500" aria-hidden />
                {done ? 'Application sent' : 'Easy apply'}
              </DialogTitle>
              <DialogDescription>
                {done
                  ? 'The recruiter has your application — track it in My Journey.'
                  : 'One tap and you are in — your profile and CV go straight to the recruiter.'}
              </DialogDescription>
            </DialogHeader>

            {/* role summary */}
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <Avatar className="size-11">
                <AvatarFallback className="bg-gradient-to-br from-blue-100 to-sky-100 text-sm font-bold text-blue-700">
                  {job.company.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-900 dark:text-slate-100">{job.title}</p>
                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                  {job.company} · {job.location} · {job.workMode}
                </p>
              </div>
              <span className="shrink-0 text-xs font-bold text-blue-700">
                {formatLpa(job.salaryMinLpa, job.salaryMaxLpa)}
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="rounded-full text-[11px]">{job.jobType}</Badge>
              <Badge className="rounded-full bg-sky-50 text-[11px] text-sky-700 dark:bg-sky-950/40">{job.workMode}</Badge>
              {skillsToArray(job.skills).slice(0, 3).map((s) => (
                <Badge key={s} variant="secondary" className="rounded-full text-[11px]">{s}</Badge>
              ))}
            </div>

            {done ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center dark:border-emerald-900/60 dark:bg-emerald-950/30">
                <CheckCircle2 className="size-7 text-emerald-600" aria-hidden />
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  Applied with your profile + CV 🎯
                </p>
                <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
                  A confirmation email is waiting in your Email updates. If shortlisted,
                  your AI interview invite also lands there.
                </p>
                <Button className="mt-1 rounded-xl" onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
              </div>
            ) : (
              <>
                <InlineCvAttach pendingCv={pendingCv} onPendingChange={setPendingCv} />
                <Button
                  onClick={() => void submit()}
                  disabled={applying}
                  aria-label={`Easy apply to ${job.title}`}
                  className="h-11 w-full rounded-xl bg-gradient-to-r from-blue-600 to-sky-600 text-base font-semibold text-white shadow-md hover:from-blue-700 hover:to-sky-700"
                >
                  {applying ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" /> Sending application…
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 size-4" /> Apply now ⚡
                    </>
                  )}
                </Button>
                <p className="text-center text-[11px] text-slate-400 dark:text-slate-500">
                  Applying adds your name, skills, notice period, expected CTC and CV to
                  the recruiter&apos;s applicants list.
                </p>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
