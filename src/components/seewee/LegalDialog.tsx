'use client'

/**
 * LegalDialog — About / Privacy / Terms / Contact for the fictional SeeWe
 * platform (master spec §7). Brand-neutral copy: no real companies, no real
 * addresses or phone numbers.
 *
 * Mounting pattern: the dialog is a CONTROLLED component — each host that
 * needs it (Footer, AuthDialog sign-up step) keeps its own `page` state and
 * renders its own instance. That avoids prop-drilling through page.tsx and
 * avoids stacked-portal surprises, because every host opens its own layer.
 */

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { clampDialogShellScroll } from '@/lib/dialog-scroll-guard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Handshake, LifeBuoy, ScrollText, ShieldCheck, Sparkles } from 'lucide-react'

export type LegalPage = 'about' | 'privacy' | 'terms' | 'contact'

export const LEGAL_PAGES: LegalPage[] = ['about', 'privacy', 'terms', 'contact']

export const LEGAL_PAGE_META: Record<LegalPage, { title: string; blurb: string }> = {
  about: { title: 'About SeeWe', blurb: 'Who we are and how hiring works here.' },
  privacy: { title: 'Privacy Policy', blurb: 'What we store, who sees it, and your rights.' },
  terms: { title: 'Terms of Service', blurb: 'The ground rules for using SeeWe.' },
  contact: { title: 'Contact & Support', blurb: 'How to reach the SeeWe team.' },
}

const SUPPORT_EMAIL = 'support@seewee.example'

interface LegalDialogProps {
  /** Which page is open — `null` keeps the dialog closed. */
  page: LegalPage | null
  onOpenChange: (open: boolean) => void
  /** Lets in-dialog links (Contact → Privacy/Terms) switch pages. */
  onPageChange?: (page: LegalPage) => void
}

export function LegalDialog({ page, onOpenChange, onPageChange }: LegalDialogProps) {
  return (
    <Dialog open={page !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-0 overflow-clip rounded-2xl p-0 sm:max-w-2xl"
        onScroll={clampDialogShellScroll}
        aria-describedby={page ? `legal-desc-${page}` : undefined}
      >
        {page && (
          <>
            <DialogHeader className="space-y-1 border-b border-slate-200 px-6 pb-4 pt-6 text-left dark:border-slate-800">
              <DialogTitle className="flex items-center gap-2 text-xl font-bold">
                {page === 'about' && <Sparkles className="h-5 w-5 text-blue-600" aria-hidden />}
                {page === 'privacy' && <ShieldCheck className="h-5 w-5 text-emerald-600" aria-hidden />}
                {page === 'terms' && <ScrollText className="h-5 w-5 text-amber-600" aria-hidden />}
                {page === 'contact' && <LifeBuoy className="h-5 w-5 text-violet-600" aria-hidden />}
                {LEGAL_PAGE_META[page].title}
              </DialogTitle>
              <DialogDescription id={`legal-desc-${page}`} className="text-sm">
                {LEGAL_PAGE_META[page].blurb}
              </DialogDescription>
            </DialogHeader>

            <div className="legal-dialog-content max-h-[70vh] flex-1 space-y-4 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-slate-600 dark:text-slate-300 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 dark:[&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-track]:bg-transparent">
              {page === 'about' && <AboutContent />}
              {page === 'privacy' && <PrivacyContent onPageChange={onPageChange} />}
              {page === 'terms' && <TermsContent />}
              {page === 'contact' && <ContactContent onPageChange={onPageChange} />}
            </div>

            {/* Sticky footer — always visible, even with scrolled content */}
            <DialogFooter className="mt-0 items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-6 py-4 dark:border-slate-800 dark:bg-slate-900/60 sm:justify-between">
              <p className="text-xs text-slate-400 dark:text-slate-500">
                Version 1.0 · Last updated January 2025 · Fictional demo platform
              </p>
              <Button onClick={() => onOpenChange(false)} className="rounded-lg px-5">
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------ content -------------------------------- */

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 text-sm font-bold text-slate-900 dark:text-slate-100">{children}</h3>
}

function AboutContent() {
  return (
    <>
      <p>
        <strong className="text-slate-800 dark:text-slate-200">SeeWe</strong> is an AI-assisted
        recruitment platform with one mission: make great hiring accessible to every team and every
        job seeker — not just companies with big recruiting budgets. We connect candidates with
        verified employers, keep salary information upfront, and use AI to remove busywork from
        hiring, never to remove people from the decision.
      </p>

      <H>How matching works</H>
      <p>
        Candidates build a structured profile (skills, experience, salary expectations, a CV and an
        optional video resume). Employers post jobs with mandatory pay bands. Our matching engine
        compares skills, experience and stated preferences against each role&apos;s requirements and
        surfaces the strongest fits first — every match shows the factors behind it, so you always
        know why a job (or a person) appeared.
      </p>

      <H>AI-assisted, human-decided</H>
      <p>
        Our AI conducts first-round structured interviews, drafts skill summaries and scores
        objective signals such as assessments. Every consequential decision — shortlisting, offers,
        rejections — is made by people. Recruiters see AI output as <em>advice</em>, clearly
        labelled, alongside the evidence. Candidates are never ranked against each other by a
        hidden score, and no application is auto-rejected by an algorithm.
      </p>

      <H>What we don&apos;t do</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>We never charge job seekers for access to jobs — SeeWe itself takes no job-posting or application fees from candidates.</li>
        <li>We never sell your personal data to third parties.</li>
        <li>We never let employers see your AI interview scores or verdicts without showing you the same information.</li>
      </ul>

      <Separator className="my-2" />
      <p className="text-xs text-slate-400 dark:text-slate-500">
        SeeWe is a fictional platform built for demonstration purposes. Content on this page is
        illustrative and does not constitute a real company&apos;s statements.
      </p>
    </>
  )
}

function PrivacyContent({ onPageChange }: { onPageChange?: (p: LegalPage) => void }) {
  return (
    <>
      <p>
        This policy explains what SeeWe stores, who can see it and how long we keep it. Plain
        language, no dark patterns.
      </p>

      <H>What we store</H>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Profile data:</strong> name, contact details, work history, education, skills, salary expectations and job preferences you enter.</li>
        <li><strong>CVs and documents:</strong> the CV you upload (and any optimised versions you create), plus its parsed text.</li>
        <li><strong>Media:</strong> your optional video resume and, with your explicit consent, recordings and transcripts of AI-conducted interviews.</li>
        <li><strong>Application activity:</strong> which jobs you applied to, application status changes and messages between you and hiring teams.</li>
        <li><strong>Consent records:</strong> an immutable ledger of when you accepted these terms or granted recording consent.</li>
      </ul>

      <H>Who can see it</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Authorized hiring teams at companies you apply to (or that find you through search while your profile visibility is on) see your profile, CV and application history with them.</li>
        <li>SeeWe platform staff can access data only for support, safety and legal-compliance purposes.</li>
        <li>Nobody else. We do not sell or share your data with advertisers or data brokers.</li>
      </ul>

      <H>Retention</H>
      <p>
        Interview recordings and transcripts are stored only as long as the related hiring process
        is active and are then garbage-collected on a rolling schedule. CVs and profile data are
        kept while your account is active. Deleted content is removed from backups within 90 days.
      </p>

      <H>Your rights and controls</H>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Visibility toggle:</strong> hide your profile from recruiter search at any time from your profile settings — existing applications are unaffected.</li>
        <li><strong>Withdraw applications:</strong> pull out of any hiring process from your applications list.</li>
        <li><strong>Deletion request:</strong> ask us to delete your account and data via the <button type="button" className="font-semibold text-blue-600 underline-offset-2 hover:underline" onClick={() => onPageChange?.('contact')}>contact page</button> and we will action it.</li>
        <li><strong>Interview consent:</strong> recording only starts after you explicitly accept the in-room consent notice; you can decline and type instead.</li>
      </ul>

      <Separator className="my-2" />
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Questions about this policy? Use the{' '}
        <button type="button" className="font-semibold text-blue-600 underline-offset-2 hover:underline" onClick={() => onPageChange?.('contact')}>Contact</button>{' '}
        page. See also our{' '}
        <button type="button" className="font-semibold text-blue-600 underline-offset-2 hover:underline" onClick={() => onPageChange?.('terms')}>Terms of Service</button>.
      </p>
    </>
  )
}

function TermsContent() {
  return (
    <>
      <p>
        These terms govern your use of the SeeWe platform. By creating an account you agree to them.
      </p>

      <H>1. Eligibility</H>
      <p>
        You must be at least 16 years old and legally permitted to seek employment in the regions
        where you apply. One person, one account — duplicate or shared accounts may be disabled.
      </p>

      <H>2. Account rules</H>
      <ul className="list-disc space-y-1 pl-5">
        <li>Provide accurate information about your identity, experience and eligibility to work.</li>
        <li>Do not impersonate others, submit fabricated credentials, or use the platform to harvest other users&apos; data.</li>
        <li>Employers must represent a real organisation and post genuine, current openings.</li>
        <li>We may suspend or disable accounts that break these rules; you can appeal via the contact page.</li>
      </ul>

      <H>3. Fees</H>
      <p>
        SeeWe itself charges job seekers nothing: browsing, applying, assessments and AI interview
        practice are free for candidates. If anyone asks you for money to secure a job, or a
        posting demands payment to apply, that is a violation of our policy —{' '}
        <strong>report it immediately</strong> using the report action on any job.
      </p>

      <H>4. Report abuse</H>
      <p>
        Every job listing has a report action. Reports about fake jobs, spam, expired listings,
        fees charged to applicants or discriminatory content go to our moderation queue and are
        reviewed by the platform team. We may close offending listings and disable repeat-offender
        accounts.
      </p>

      <H>5. AI interview consent</H>
      <p>
        AI-conducted interviews may be recorded and transcribed for evaluation — only after you
        accept the explicit consent notice in the interview room. You can decline recording and
        answer in written form instead; declining never affects how your application is treated.
      </p>

      <H>6. Limitation of liability</H>
      <p>
        SeeWe is provided &quot;as is&quot;. We work hard to keep listings genuine and the service
        available, but we do not guarantee hiring outcomes, the accuracy of user-supplied content,
        or uninterrupted operation. To the maximum extent permitted by law, SeeWe is not liable for
        indirect or consequential damages arising from your use of the platform. Nothing here
        limits liability that cannot be limited by law.
      </p>

      <Separator className="my-2" />
      <p className="text-xs text-slate-400 dark:text-slate-500">
        SeeWe is a fictional demo platform; this document is illustrative sample text, not a real
        contract.
      </p>
    </>
  )
}

function ContactContent({ onPageChange }: { onPageChange?: (p: LegalPage) => void }) {
  return (
    <>
      <p>
        Need a hand? The SeeWe support team reads every message and aims to respond within{' '}
        <Badge variant="outline" className="mx-0.5 border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40">
          1 business day
        </Badge>{' '}
        — most issues are resolved the same day.
      </p>

      <H>Support</H>
      <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-100 dark:bg-blue-900/40">
          <LifeBuoy className="size-4 text-blue-600" aria-hidden />
        </span>
        <div>
          <p className="font-semibold text-slate-800 dark:text-slate-200">Email support</p>
          <p className="mt-0.5 text-xs">
            <span className="font-mono">{SUPPORT_EMAIL}</span> — account issues, data-deletion
            requests, verification problems, or anything else.
          </p>
        </div>
      </div>

      <H>Common requests</H>
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Delete my data:</strong> email us from your registered address and we will remove your account and stored media.</li>
        <li><strong>Report a job or user:</strong> use the on-platform report action first — it reaches moderation faster.</li>
        <li><strong>Employer onboarding:</strong> mention your company name and we will help you set up a hiring workspace.</li>
      </ul>

      <H>Related pages</H>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg"
          onClick={() => onPageChange?.('privacy')}
        >
          <ShieldCheck className="mr-1.5 size-3.5" aria-hidden /> Privacy Policy
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg"
          onClick={() => onPageChange?.('terms')}
        >
          <ScrollText className="mr-1.5 size-3.5" aria-hidden /> Terms of Service
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-lg"
          onClick={() => onPageChange?.('about')}
        >
          <Handshake className="mr-1.5 size-3.5" aria-hidden /> About SeeWe
        </Button>
      </div>

      <Separator className="my-2" />
      <p className="text-xs text-slate-400 dark:text-slate-500">
        support@seewee.example is a placeholder address for this demo — no real inbox is attached.
      </p>
    </>
  )
}
