import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatWithRetry, extractJson } from '@/lib/ai-client'
import { sendEmail } from '@/lib/email'
import { notify } from '@/lib/notify'
import { logApplicationEvent, actorNameFor } from '@/lib/application-events'
import type { OfferLetter, OnboardChecklistItem } from '@/lib/types'

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

/** The 4-step onboarding tracker every hire starts with (all unchecked). */
function defaultChecklist(): OnboardChecklistItem[] {
  const now = new Date().toISOString()
  return [
    { key: 'bgv', label: 'Background verification', done: false, doneAt: now },
    { key: 'docs', label: 'Document collection', done: false, doneAt: now },
    { key: 'esign', label: 'Contract e-sign', done: false, doneAt: now },
    { key: 'day1', label: 'Day-1 access', done: false, doneAt: now },
  ].map((s) => ({ ...s, doneAt: null }))
}

function parseChecklist(raw?: string | null): OnboardChecklistItem[] | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const items = parsed
      .filter(
        (i): i is OnboardChecklistItem =>
          !!i && typeof i === 'object' && typeof (i as OnboardChecklistItem).key === 'string'
      )
      .map((i) => ({
        key: i.key,
        label: typeof i.label === 'string' ? i.label : i.key,
        done: i.done === true,
        doneAt: typeof i.doneAt === 'string' ? i.doneAt : null,
      }))
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}

/** Recruiter-facing payloads may carry screen fields; candidate-facing ones never do. */
function stripScreenFields<T extends { screenSummary?: unknown; screenVerdict?: unknown }>(
  app: T
): Omit<T, 'screenSummary' | 'screenVerdict'> {
  const { screenSummary: _s, screenVerdict: _v, ...rest } = app
  return rest
}

function longDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/* ------------------------------------------------------------------ */
/* Offer letter generation (AI first, deterministic template fallback) */
/* ------------------------------------------------------------------ */

function templateLetter(opts: {
  candidateName: string
  jobTitle: string
  company: string
  salaryLpa: number
  joiningDate: string
  workMode: string
  location: string
}): OfferLetter {
  const subject = `Offer letter — ${opts.jobTitle} at ${opts.company}`
  const body = [
    `Dear ${opts.candidateName},`,
    ``,
    `Following your interviews with ${opts.company}, we are delighted to offer you the position of ${opts.jobTitle}. Your conversations showed the capability and energy we look for, and we would be glad to welcome you to the team.`,
    ``,
    `Here are the key details of the offer:`,
    `- Position: ${opts.jobTitle}`,
    `- Compensation: ₹${opts.salaryLpa} LPA (annual fixed compensation)`,
    `- Joining date: ${longDate(opts.joiningDate)}`,
    `- Work mode: ${opts.workMode}`,
    `- Location: ${opts.location}`,
    ``,
    `Your first weeks will include a structured onboarding: background verification, document collection, contract e-signing, and Day-1 access setup. Your hiring manager will stay in touch at every step so you always know what comes next.`,
    ``,
    `To accept, open your candidate portal and confirm this offer — the position is yours from that moment. If you have any questions before deciding, simply reply to this email and the hiring team will help.`,
    ``,
    `We look forward to the impact you will create with us.`,
    ``,
    `Warm regards,`,
    `The ${opts.company} hiring team`,
  ].join('\n')
  return {
    subject,
    body,
    salaryLpa: opts.salaryLpa,
    joiningDate: opts.joiningDate,
    workMode: opts.workMode,
    generatedAt: new Date().toISOString(),
  }
}

async function generateLetter(opts: {
  candidateName: string
  jobTitle: string
  company: string
  salaryLpa: number
  joiningDate: string
  workMode: string
  location: string
}): Promise<OfferLetter> {
  try {
    const raw = await chatWithRetry(
      [
        'You are a professional HR offer-letter writer for a hiring company.',
        'Write warm, concise, complete offer letters in PLAIN TEXT.',
        'STRICT JSON only — no markdown fences, no commentary. Shape: {"subject": string, "body": string}',
        'The body must be ~180-260 words, with \\n line breaks (greeting, offer statement, key details as short lines, onboarding next steps, how to accept, warm closing and sign-off).',
        'HARD RULES: no tables, no markdown, no interview scores or assessments of any kind, no competitor or portal names, no salary negotiation language, no placeholders like [x] — use only the provided facts.',
      ].join('\n'),
      JSON.stringify({
        candidateName: opts.candidateName,
        jobTitle: opts.jobTitle,
        company: opts.company,
        compensation: `₹${opts.salaryLpa} LPA annual fixed compensation`,
        joiningDate: longDate(opts.joiningDate),
        workMode: opts.workMode,
        location: opts.location,
        senderLine: `The ${opts.company} hiring team`,
      })
    )
    const parsed = extractJson<{ subject?: unknown; body?: unknown }>(raw)
    const subject = typeof parsed.subject === 'string' ? parsed.subject.trim() : ''
    const body = typeof parsed.body === 'string' ? parsed.body.trim() : ''
    if (!subject || body.length < 300) throw new Error('Letter too short or malformed')
    return {
      subject: subject.slice(0, 180),
      body: body.slice(0, 3800),
      salaryLpa: opts.salaryLpa,
      joiningDate: opts.joiningDate,
      workMode: opts.workMode,
      generatedAt: new Date().toISOString(),
    }
  } catch (err) {
    console.error('[offer] AI letter failed — using template:', err)
    return templateLetter(opts)
  }
}

/* ------------------------------------------------------------------ */
/* POST /api/applications/[id]/offer                                   */
/* Body: { action: 'send'|'accept'|'decline'|'toggle-onboard',         */
/*         userId: string, salaryLpa?: number, joiningDate?: string,   */
/*         key?: string (onboarding checklist key) }                   */
/* ------------------------------------------------------------------ */

const ONBOARDABLE = ['HIRED', 'ONBOARDED']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    const action = typeof body?.action === 'string' ? body.action : ''
    const userId = typeof body?.userId === 'string' ? body.userId : ''

    if (!action || !userId) {
      return NextResponse.json({ error: 'action and userId are required' }, { status: 400 })
    }

    const application = await db.application.findUnique({
      where: { id },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            company: true,
            location: true,
            workMode: true,
            recruiterId: true,
          },
        },
        candidate: { select: { id: true, email: true, name: true } },
      },
    })
    if (!application) {
      return NextResponse.json({ error: 'Application not found' }, { status: 404 })
    }

    const caller = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, clientId: true },
    })
    if (!caller) {
      return NextResponse.json({ error: 'Unknown caller' }, { status: 403 })
    }

    const emailMeta = {
      jobId: application.job.id,
      applicationId: application.id,
      jobTitle: application.job.title,
      company: application.job.company,
    }

    /* ---------------------------- SEND ---------------------------- */
    if (action === 'send') {
      if (caller.role !== 'RECRUITER' || application.job.recruiterId !== caller.id) {
        return NextResponse.json(
          { error: "Only the job's recruiter can send offers" },
          { status: 403 }
        )
      }
      if (!['INTERVIEWED', 'SHARED_WITH_CLIENT'].includes(application.status)) {
        return NextResponse.json(
          { error: 'Offers can only be sent for interviewed or client-shared applications' },
          { status: 400 }
        )
      }
      if (application.offerStatus === 'SENT') {
        return NextResponse.json({ error: 'An offer is already awaiting a response' }, { status: 400 })
      }

      const salaryLpa = Number(body?.salaryLpa)
      if (!Number.isFinite(salaryLpa) || salaryLpa <= 0 || salaryLpa > 500) {
        return NextResponse.json({ error: 'salaryLpa must be a positive number' }, { status: 400 })
      }
      const joiningDate = typeof body?.joiningDate === 'string' ? body.joiningDate : ''
      const joining = new Date(joiningDate)
      if (!joiningDate || Number.isNaN(joining.getTime())) {
        return NextResponse.json({ error: 'joiningDate must be a valid date (YYYY-MM-DD)' }, { status: 400 })
      }
      const workMode = typeof body?.workMode === 'string' && body.workMode.trim()
        ? body.workMode.trim()
        : application.job.workMode || 'On-site'

      // In-house model: letters come from the recruiter's own company.
      const company = caller.clientId
        ? (await db.client.findUnique({ where: { id: caller.clientId }, select: { name: true } }))?.name ||
          application.job.company
        : application.job.company

      const letter = await generateLetter({
        candidateName: application.candidate.name,
        jobTitle: application.job.title,
        company,
        salaryLpa,
        joiningDate: joiningDate.slice(0, 10),
        workMode,
        location: application.job.location || 'the company location',
      })

      const updated = await db.application.update({
        where: { id },
        data: {
          offerLetter: JSON.stringify(letter),
          offeredAt: new Date(),
          offerStatus: 'SENT',
          status: 'OFFERED',
        },
        include: {
          job: { select: { id: true, title: true, company: true, workMode: true } },
          candidate: { select: { id: true, email: true, name: true } },
        },
      })

      // 📧 The full offer letter lands in the candidate's mailbox (simulated
      // transport — recorded in EmailLog, non-fatal).
      void sendEmail({
        to: application.candidate.email,
        toUserId: application.candidate.id,
        kind: 'OFFER',
        subject: letter.subject,
        body: letter.body,
        meta: emailMeta,
      })
      // 🔔 In-app nudge: tap to review and respond.
      void notify({
        userId: application.candidate.id,
        type: 'OFFER',
        title: `Offer received · ${application.job.title}`,
        body: 'Tap to review and respond',
        meta: emailMeta,
      })

      // §10 audit trail: offer sent (candidate-visible type, neutral note). Non-fatal.
      void actorNameFor(caller.id)
        .then((actorName) =>
          logApplicationEvent(db, {
            applicationId: id,
            type: 'OFFER',
            fromStatus: application.status,
            toStatus: 'OFFERED',
            actorRole: 'RECRUITER',
            actorName,
            note: `Offer letter sent — ₹${salaryLpa} LPA, joining ${joiningDate.slice(0, 10)}`,
          })
        )
        .catch((err) => console.error('[application-events] non-fatal offer log failure:', err))

      return NextResponse.json({ data: stripScreenFields(updated) })
    }

    /* --------------------------- ACCEPT --------------------------- */
    if (action === 'accept') {
      if (caller.role !== 'CANDIDATE' || application.candidate.id !== caller.id) {
        return NextResponse.json(
          { error: 'Only the candidate who received the offer can respond' },
          { status: 403 }
        )
      }
      if (application.offerStatus !== 'SENT') {
        return NextResponse.json(
          { error: 'This offer is no longer awaiting a response' },
          { status: 400 }
        )
      }

      const updated = await db.application.update({
        where: { id },
        data: {
          offerStatus: 'ACCEPTED',
          status: 'HIRED',
          onboardChecklist: JSON.stringify(defaultChecklist()),
          onboardStatus: 'PENDING',
        },
        include: {
          job: { select: { id: true, title: true, company: true, workMode: true } },
          candidate: { select: { id: true, email: true, name: true } },
        },
      })

      // 🔔 Recruiter celebrates.
      void notify({
        userId: application.job.recruiterId,
        type: 'OFFER',
        title: `🎉 ${application.candidate.name} accepted the offer · ${application.job.title}`,
        body: 'Onboarding tracker is now live on the application card.',
        meta: emailMeta,
      })
      // 📧 Candidate confirmation with next steps.
      void sendEmail({
        to: application.candidate.email,
        toUserId: application.candidate.id,
        kind: 'STATUS_UPDATE',
        subject: `Offer accepted — welcome to ${application.job.company}! 🎉`,
        body: [
          `Hi ${application.candidate.name},`,
          ``,
          `Fantastic news — you've ACCEPTED the offer for ${application.job.title} at ${application.job.company}. Welcome aboard! 🎉`,
          ``,
          `What happens next:`,
          `1. Background verification and document collection are the first onboarding steps.`,
          `2. You'll e-sign your contract, and your Day-1 access will be ready before you join.`,
          `3. The hiring team will contact you on your registered phone and email with schedules.`,
          ``,
          `Congratulations again — we can't wait to see what you build.`,
          ``,
          `— The hiring platform team`,
        ].join('\n'),
        meta: emailMeta,
      })

      // §10 audit trail: offer accepted (OFFER_RESPONSE for the recruiter view
      // + a candidate-visible STATUS_CHANGE with a neutral note). Non-fatal.
      void (async () => {
        try {
          await logApplicationEvent(db, {
            applicationId: id,
            type: 'OFFER_RESPONSE',
            fromStatus: 'OFFERED',
            toStatus: 'HIRED',
            actorRole: 'CANDIDATE',
            actorName: application.candidate.name,
            note: 'Candidate accepted the offer',
          })
          await logApplicationEvent(db, {
            applicationId: id,
            type: 'STATUS_CHANGE',
            fromStatus: 'OFFERED',
            toStatus: 'HIRED',
            actorRole: 'CANDIDATE',
            actorName: application.candidate.name,
            note: 'Offer accepted — onboarding started',
          })
        } catch (err) {
          console.error('[application-events] non-fatal offer-accept log failure:', err)
        }
      })()

      // Candidate-facing response: screen dossier must NEVER ride along.
      return NextResponse.json({ data: stripScreenFields(updated) })
    }

    /* --------------------------- DECLINE --------------------------- */
    if (action === 'decline') {
      if (caller.role !== 'CANDIDATE' || application.candidate.id !== caller.id) {
        return NextResponse.json(
          { error: 'Only the candidate who received the offer can respond' },
          { status: 403 }
        )
      }
      if (application.offerStatus !== 'SENT') {
        return NextResponse.json(
          { error: 'This offer is no longer awaiting a response' },
          { status: 400 }
        )
      }

      const updated = await db.application.update({
        where: { id },
        data: {
          offerStatus: 'DECLINED',
          status: 'INTERVIEWED', // back into the pipeline for a possible re-negotiation
        },
        include: {
          job: { select: { id: true, title: true, company: true, workMode: true } },
          candidate: { select: { id: true, email: true, name: true } },
        },
      })

      void notify({
        userId: application.job.recruiterId,
        type: 'OFFER',
        title: `${application.candidate.name} declined the offer · ${application.job.title}`,
        body: 'The application is back in your pipeline — reach out if you want to discuss.',
        meta: emailMeta,
      })
      void sendEmail({
        to: application.candidate.email,
        toUserId: application.candidate.id,
        kind: 'STATUS_UPDATE',
        subject: `Offer response recorded — ${application.job.title}`,
        body: [
          `Hi ${application.candidate.name},`,
          ``,
          `This is a polite confirmation that you've declined the offer for ${application.job.title} at ${application.job.company}. The hiring team has been notified and truly appreciates the time you invested through the process.`,
          ``,
          `Doors stay open — better-matched roles are posted every day.`,
          ``,
          `— The hiring platform team`,
        ].join('\n'),
        meta: emailMeta,
      })

      // §10 audit trail: offer declined. Non-fatal.
      void (async () => {
        try {
          await logApplicationEvent(db, {
            applicationId: id,
            type: 'OFFER_RESPONSE',
            fromStatus: 'OFFERED',
            toStatus: 'INTERVIEWED',
            actorRole: 'CANDIDATE',
            actorName: application.candidate.name,
            note: 'Candidate declined the offer',
          })
          await logApplicationEvent(db, {
            applicationId: id,
            type: 'STATUS_CHANGE',
            fromStatus: 'OFFERED',
            toStatus: 'INTERVIEWED',
            actorRole: 'CANDIDATE',
            actorName: application.candidate.name,
            note: 'Offer declined — moved back in the pipeline',
          })
        } catch (err) {
          console.error('[application-events] non-fatal offer-decline log failure:', err)
        }
      })()

      return NextResponse.json({ data: stripScreenFields(updated) })
    }

    /* ------------------------ TOGGLE-ONBOARD ----------------------- */
    if (action === 'toggle-onboard') {
      if (caller.role !== 'RECRUITER' || application.job.recruiterId !== caller.id) {
        return NextResponse.json(
          { error: "Only the job's recruiter can update onboarding" },
          { status: 403 }
        )
      }
      if (!ONBOARDABLE.includes(application.status)) {
        return NextResponse.json(
          { error: 'Onboarding starts once the candidate has accepted the offer (HIRED)' },
          { status: 400 }
        )
      }
      const key = typeof body?.key === 'string' ? body.key : ''
      const checklist = parseChecklist(application.onboardChecklist) ?? defaultChecklist()
      const item = checklist.find((i) => i.key === key)
      if (!item) {
        return NextResponse.json(
          { error: `key must be one of: ${checklist.map((i) => i.key).join(', ')}` },
          { status: 400 }
        )
      }
      item.done = !item.done
      item.doneAt = item.done ? new Date().toISOString() : null

      const doneCount = checklist.filter((i) => i.done).length
      const completed = doneCount === checklist.length
      const updated = await db.application.update({
        where: { id },
        data: {
          onboardChecklist: JSON.stringify(checklist),
          onboardStatus: completed ? 'COMPLETED' : doneCount > 0 ? 'IN_PROGRESS' : 'PENDING',
          ...(completed ? { status: 'ONBOARDED' } : {}),
        },
        include: {
          job: { select: { id: true, title: true, company: true, workMode: true } },
          candidate: { select: { id: true, email: true, name: true } },
        },
      })

      if (completed) {
        void notify({
          userId: application.job.recruiterId,
          type: 'ONBOARDING',
          title: `🏁 Onboarding complete · ${application.candidate.name}`,
          body: `All 4 steps are done — ${application.candidate.name} is fully onboarded for ${application.job.title}.`,
          meta: emailMeta,
        })
      }

      // §10 audit trail: onboarding checklist updated (+ pipeline completion).
      // Non-fatal.
      void actorNameFor(caller.id)
        .then((actorName) =>
          logApplicationEvent(db, {
            applicationId: id,
            type: 'ONBOARD',
            actorRole: 'RECRUITER',
            actorName,
            note: `Onboarding step "${item.label}" marked ${item.done ? 'done' : 'pending'}`,
          })
        )
        .catch((err) => console.error('[application-events] non-fatal onboard log failure:', err))
      if (completed) {
        void logApplicationEvent(db, {
          applicationId: id,
          type: 'STATUS_CHANGE',
          fromStatus: 'HIRED',
          toStatus: 'ONBOARDED',
          actorRole: 'RECRUITER',
          note: 'Onboarding completed — all steps done',
        }).catch((err) => console.error('[application-events] non-fatal onboard log failure:', err))
      }

      return NextResponse.json({ data: updated })
    }

    return NextResponse.json(
      { error: "action must be one of: send, accept, decline, toggle-onboard" },
      { status: 400 }
    )
  } catch (err) {
    console.error('POST /api/applications/[id]/offer failed:', err)
    return NextResponse.json({ error: 'Failed to process offer action' }, { status: 500 })
  }
}
