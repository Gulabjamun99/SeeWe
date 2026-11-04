// SeeWe - outbound email service (simulated transport).
//
// Every process step that matters to a candidate — application received,
// interview invite, interview submitted, offer, client share, status update —
// goes through sendEmail() so the flow is auditable and the copy lives in one
// place. In this sandbox there is no outbound SMTP relay: mails are persisted
// to the EmailLog table (surfaced in the candidate's "Email updates" mailbox
// card) and printed to the server log. To go live, plug a real transport
// (SMTP/SES/Resend) into deliverOutbound() — everything else stays unchanged.

import { db } from '@/lib/db'

export type EmailKind =
  | 'APPLICATION_RECEIVED' // candidate: their application landed with the recruiter
  | 'INTERVIEW_INVITE' // candidate: shortlisted — AI video interview unlocked
  | 'INTERVIEW_SUBMITTED' // candidate: interview responses are with the hiring team
  | 'INTERVIEW_RECORDING_READY' // recruiter: interview finished — video recordings are ready to review
  | 'OFFER' // candidate: offer received
  | 'SHARED_WITH_CLIENT' // candidate: profile shared with the hiring client
  | 'STATUS_UPDATE' // candidate: generic pipeline update (e.g. not moving forward)

export interface SendEmailParams {
  to: string
  toUserId?: string | null
  kind: EmailKind
  subject: string
  body: string
  meta?: Record<string, unknown>
}

/**
 * Persist + "send" one process email. NEVER throws — email failures must not
 * break the primary business flow (apply / shortlist / share / decide).
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const to = (params.to ?? '').trim()
  if (!to) return
  try {
    await db.emailLog.create({
      data: {
        toEmail: to,
        toUserId: params.toUserId ?? null,
        kind: params.kind,
        subject: params.subject.slice(0, 200),
        body: params.body.slice(0, 4000),
        status: 'SENT',
        meta: params.meta ? JSON.stringify(params.meta) : null,
      },
    })
    // Transport trace — makes the simulated delivery visible in dev.log
    console.log(
      `[email:outbox] to=${to} kind=${params.kind} subject="${params.subject}"`
    )
  } catch (err) {
    console.error('[email] Failed to record outbound email (non-fatal):', err)
  }
}

/* ------------------------------------------------------------------ */
/* Process email templates (plain text, neutral branding)              */
/* ------------------------------------------------------------------ */

export function applicationReceivedEmail(opts: {
  candidateName: string
  jobTitle: string
  company: string
  hasCv: boolean
}): { subject: string; body: string } {
  return {
    subject: `Application received — ${opts.jobTitle} at ${opts.company}`,
    body: [
      `Hi ${opts.candidateName},`,
      ``,
      `Your application for ${opts.jobTitle} (${opts.company}) has been received.`,
      opts.hasCv
        ? `Your CV was attached to the application — the hiring team will review it along with your profile.`
        : `Tip: attach a CV in your profile so recruiters always receive your latest document.`,
      ``,
      `What happens next:`,
      `1. The recruiter reviews your profile and CV.`,
      `2. If shortlisted, your AI video interview unlocks — you'll get an email invite.`,
      `3. The interview takes about 15 minutes: speak your answers on camera; no typing needed.`,
      ``,
      `Keep your profile and CV up to date so the hiring team always sees your best story.`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}

export function interviewInviteEmail(opts: {
  candidateName: string
  jobTitle: string
  company: string
}): { subject: string; body: string } {
  return {
    subject: `🎬 Interview invite — ${opts.jobTitle} (${opts.company})`,
    body: [
      `Hi ${opts.candidateName},`,
      ``,
      `Great news — you've been SHORTLISTED for ${opts.jobTitle} at ${opts.company}!`,
      `Your AI interview is now unlocked in your dashboard.`,
      ``,
      `How to be ready for the interview:`,
      `- Find a quiet room with good lighting.`,
      `- Allow microphone access when prompted (Chrome/Edge work best).`,
      `- The hiring team has set the questions for this role. Some questions are VOICE — you answer by speaking, and the AI reads each question aloud slowly. Others are TEXT — you type your answer. The format is shown on every question.`,
      `- Each question shows its answer time limit — keep an eye on the timer.`,
      `- You get two takes on voice questions — submit the one you like.`,
      ``,
      `Complete the interview at your convenience so the hiring team can take your application to the next process quickly.`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}

export function interviewSubmittedEmail(opts: {
  candidateName: string
  jobTitle: string
  company: string
}): { subject: string; body: string } {
  return {
    subject: `Interview submitted — ${opts.jobTitle} (${opts.company})`,
    body: [
      `Hi ${opts.candidateName},`,
      ``,
      `Your AI video interview for ${opts.jobTitle} (${opts.company}) is complete — all responses and recordings are with the hiring team.`,
      ``,
      `What happens next:`,
      `1. The recruiter reviews your answers and report.`,
      `2. If your profile moves forward, it may be shared with the hiring client for the next process.`,
      `3. You'll get an email at every step — no action needed from you right now.`,
      ``,
      `Thanks for interviewing with us!`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}

export function interviewRecordingReadyEmail(opts: {
  candidateName: string
  jobTitle: string
  company: string
  recordingCount: number
  totalSeconds: number
}): { subject: string; body: string } {
  const mins = Math.max(1, Math.round(opts.totalSeconds / 60))
  return {
    subject: `🎬 Interview recordings ready — ${opts.candidateName} · ${opts.jobTitle}`,
    body: [
      `The AI interview is complete and the video recordings are ready for your review.`,
      ``,
      `Candidate: ${opts.candidateName}`,
      `Role: ${opts.jobTitle} (${opts.company})`,
      `Recordings: ${opts.recordingCount} answer video${opts.recordingCount === 1 ? '' : 's'} (~${mins} min of footage)`,
      ``,
      `Where to review:`,
      `1. Open SeeWe → Recruiter dashboard → Interviews (Interview Hub) → open ${opts.candidateName}.`,
      `   Every question shows the transcript, the AI note, and the recorded video beside it.`,
      `2. Or open the Recordings tab for the full video library with ZIP download.`,
      ``,
      `Next step: review the recordings and the AI report, then record your final`,
      `decision (Advance / Hold / Reject) right inside the interview card — the AI`,
      `suggestion is advisory only; the final call is yours.`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}

export function offerEmail(opts: {
  candidateName: string
  jobTitle: string
  company: string
}): { subject: string; body: string } {
  return {
    subject: `🎉 Offer received — ${opts.jobTitle} (${opts.company})`,
    body: [
      `Hi ${opts.candidateName},`,
      ``,
      `Congratulations! ${opts.company} has extended you an OFFER for ${opts.jobTitle}. 🎉`,
      ``,
      `The hiring team will reach out on your registered contact details with the next steps (offer letter, joining formalities, documentation).`,
      `Keep your phone accessible and your CV up to date.`,
      ``,
      `Welcome to the next chapter of your career!`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}

export function sharedWithClientEmail(opts: {
  candidateName: string
  jobTitle: string
  company: string
  clientName?: string
}): { subject: string; body: string } {
  return {
    subject: `Profile shared with client — ${opts.jobTitle}`,
    body: [
      `Hi ${opts.candidateName},`,
      ``,
      `Your profile for ${opts.jobTitle} has been shared with the hiring client${opts.clientName ? ` (${opts.clientName})` : ''} for the next stage of the process.`,
      ``,
      `Stay reachable on your email and phone — the client or the recruiting team may contact you for a discussion or further rounds.`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}

export function statusUpdateEmail(opts: {
  candidateName: string
  jobTitle: string
  company: string
  kind: 'REJECTED' | 'INTERVIEW_SCHEDULED'
}): { subject: string; body: string } {
  if (opts.kind === 'INTERVIEW_SCHEDULED') {
    return {
      subject: `Interview in progress — ${opts.jobTitle} (${opts.company})`,
      body: [
        `Hi ${opts.candidateName},`,
        ``,
        `Your AI video interview for ${opts.jobTitle} (${opts.company}) has started. If you paused, you can resume it anytime from your dashboard — your earlier answers are safe.`,
        ``,
        `Remember: quiet room, mic + camera allowed, speak naturally.`,
        ``,
        `— The SeeWe hiring platform team`,
      ].join('\n'),
    }
  }
  return {
    subject: `Application update — ${opts.jobTitle} (${opts.company})`,
    body: [
      `Hi ${opts.candidateName},`,
      ``,
      `Thank you for applying to ${opts.jobTitle} at ${opts.company}. This time the team isn't moving your application forward — it was a competitive round.`,
      ``,
      `Keep your CV fresh and keep applying — better-matched roles are posted every day, and your next interview invite could be one search away.`,
      ``,
      `— The SeeWe hiring platform team`,
    ].join('\n'),
  }
}
