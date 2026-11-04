import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/applications/sla?userId={candidateId}
 *
 * "Absolute Transparency" SLA watch (candidate-side trigger):
 * finds the candidate's applications stuck in APPLIED for more than 14 days
 * and — at most once every 7 days per application — nudges the job's recruiter
 * with a process email (EmailLog kind SLA_REMINDER) + an in-app notification.
 *
 * The endpoint is idempotent per 7-day window: repeat calls inside the window
 * return the same overdue list with reminderSent=false and write nothing.
 * Candidates never receive any screening data from this route — only the fact
 * that their application is overdue and a reminder went out.
 */

const SLA_DAYS = 14 // platform response promise to candidates
const REMINDER_COOLDOWN_DAYS = 7 // one nudge per application per week
const DAY_MS = 24 * 60 * 60 * 1000

interface SlaOverdueItem {
  applicationId: string
  jobTitle: string
  company: string
  daysWaiting: number
  reminderSent: boolean
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const userId = sp.get('userId')
    if (!userId || userId.trim().length === 0) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 })
    }

    const candidate = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, role: true },
    })
    if (!candidate) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    if (candidate.role !== 'CANDIDATE') {
      return NextResponse.json(
        { error: 'SLA watch is only available for candidate accounts' },
        { status: 403 }
      )
    }

    const now = Date.now()
    const cutoff = new Date(now - SLA_DAYS * DAY_MS)

    // Stuck applications: still untouched (APPLIED) beyond the promise window
    const stuck = await db.application.findMany({
      where: {
        candidateId: userId,
        status: 'APPLIED',
        createdAt: { lt: cutoff },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        createdAt: true,
        job: {
          select: {
            id: true,
            title: true,
            company: true,
            recruiterId: true,
            recruiter: { select: { id: true, name: true, email: true } },
          },
        },
      },
    })

    const overdue: SlaOverdueItem[] = []

    for (const app of stuck) {
      const daysWaiting = Math.max(
        SLA_DAYS + 1,
        Math.floor((now - new Date(app.createdAt).getTime()) / DAY_MS)
      )
      const jobTitle = app.job.title
      const company = app.job.company
      const candidateName = candidate.name

      // Anti-spam guard: has a reminder for THIS application been sent recently?
      // meta is a JSON string that always embeds the applicationId on our writes,
      // so a substring hit identifies prior reminders for this application.
      const priorReminders = await db.emailLog.findMany({
        where: { kind: 'SLA_REMINDER', meta: { contains: app.id } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      })
      const lastReminder = priorReminders[0]
      const lastAt = lastReminder ? new Date(lastReminder.createdAt).getTime() : 0
      const coolingDown = now - lastAt < REMINDER_COOLDOWN_DAYS * DAY_MS

      let reminderSent = false
      if (!coolingDown) {
        const recruiter = app.job.recruiter

        // 📧 Process email to the job's recruiter (recorded, not SMTP-delivered)
        await db.emailLog.create({
          data: {
            toEmail: recruiter.email,
            toUserId: recruiter.id,
            kind: 'SLA_REMINDER',
            subject: `Response pending: ${candidateName} applied ${daysWaiting} days ago for ${jobTitle}`,
            body: [
              `Hi ${recruiter.name || 'there'},`,
              ``,
              `${candidateName} applied for "${jobTitle}" (${company}) ${daysWaiting} days ago and has not received a first response yet.`,
              ``,
              `Our transparency promise to every candidate: a clear answer — a review, a shortlist, or a respectful decline — within 48 hours of this reminder.`,
              ``,
              `Please open the application and either move it forward or send a polite rejection, so ${candidateName.split(' ')[0]} can plan next steps with clarity. Silence is the hardest part of any job search.`,
              ``,
              `Thank you for keeping hiring humane.`,
              `— The hiring team`,
            ].join('\n'),
            status: 'SENT',
            meta: JSON.stringify({
              kind: 'SLA_REMINDER',
              applicationId: app.id,
              jobId: app.job.id,
              jobTitle,
              company,
              candidateId: userId,
              candidateName,
              daysWaiting,
            }),
          },
        })

        // 🔔 In-app nudge for the recruiter
        await db.notification.create({
          data: {
            userId: recruiter.id,
            type: 'SLA',
            title: `⏰ ${daysWaiting} days pending · ${jobTitle}`,
            body: `Respond to ${candidateName}'s application — candidates are waiting for clarity.`,
            meta: JSON.stringify({
              jobId: app.job.id,
              applicationId: app.id,
              actorName: candidateName,
              jobTitle,
              daysWaiting,
            }),
          },
        })

        reminderSent = true
      }

      overdue.push({
        applicationId: app.id,
        jobTitle,
        company,
        daysWaiting,
        reminderSent,
      })
    }

    return NextResponse.json({ data: { overdue } })
  } catch (err) {
    console.error('GET /api/applications/sla failed:', err)
    return NextResponse.json(
      { error: 'Failed to run the SLA check' },
      { status: 500 }
    )
  }
}
