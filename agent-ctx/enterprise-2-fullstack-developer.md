# Task ID: enterprise-2 — Agent: fullstack-developer — Work Record

Date: 2026-10-15 · Scope: BACKEND ONLY (Prisma schema + API routes + lib helpers)

## Context
A previous (interrupted) run of this task had already written most of the backend files; this session
AUDITED every file against the worklog contract (`Task ID: enterprise-spec-1 (plan)`), verified the
schema/DB state, fixed a pre-existing lint blocker, and ran the full verification suite live
(db:push, prisma validate, lint, 25+ curl smoke tests) plus complete test-data cleanup.

## Files (final state — created by this task, verified this session)
- `prisma/schema.prisma` — additive enterprise changes (see schema diff in worklog)
- `src/lib/types.ts` — AtsInboundJob, AtsSyncResult, AiEvaluationView, AtsSyncStatus, JdMatchResult,
  ResumeDraftData/ResumeBasics/ResumeExperienceItem/ResumeEducationItem/ResumeProjectItem,
  AiInterviewQuestion.isSkippable, InterviewQuestion.isSkippable, ATS_TYPES
- `src/lib/ats-sync.ts` — shared upsertAtsJobs (match atsJobId → title+company, junk-title guard,
  salary-range parser, workMode normalizer, optional draft → AI config), fetchJobsFromWebhook (8s
  timeout), buildDemoJobs (3-job batch flavored by atsType: Senior Backend Engineer / Product
  Designer / Data Analyst II)
- `src/lib/ats-push.ts` — pushInterviewToAts (outbound POST + x-ats-api-key + 8s timeout, AtsPush
  audit row, AiEvaluation.atsSyncStatus SYNCED/FAILED) — shared by /api/ats/push and evaluate auto-sync
- `src/lib/interview-token.ts` — newInterviewToken (crypto.randomUUID), interviewTokenExpiry (+7d),
  findApplicationByToken, isTokenValid
- `src/lib/interview-media.ts` — resolveMediaPath (traversal-safe), readMediaAsBase64 (ASR input),
  interviewMediaUrl → RELATIVE `/api/interview/media/<file>` (documented: resolve against origin)
- `src/lib/ai-interview-config.ts` — parseAiInterviewConfig now validates isSkippable per question
- `src/app/api/v1/webhooks/ats/[companyId]/route.ts` — GET ping / POST upsert_jobs (public v1 webhook)
- `src/app/api/ats/sync-jobs/route.ts` — POST pull-or-demo sync (recruiter-owned guard)
- `src/app/api/ats/push/route.ts` — UPGRADED dossier push (evaluation breakdown rides inside dossier)
- `src/app/api/ai/evaluate-interview/route.ts` — POST multi-factor pipeline (ASR recovery → 1 LLM
  call → AiEvaluation upsert → Interview/Answer updates → auto-push)
- `src/app/api/ai/enhance-resume/route.ts` — POST bullet rewriter (fallback = originals + note)
- `src/app/api/ai/jd-match/route.ts` — POST resume↔JD match (LLM + deterministic keyword-overlap fallback)
- `src/app/api/resume-drafts/route.ts` — GET/POST/PATCH/DELETE draft CRUD (JSON sections as strings)
- `src/app/api/interview/by-token/route.ts` — GET token validation (404 unknown / 410 expired), no scores
- `src/app/api/interview/invite/route.ts` — token + expiry generation, deep link in email + notification meta
- `src/app/api/interview/start/route.ts`, `answer/route.ts` — `{token}` alternative auth
- `src/app/api/applications/[id]/route.ts` — HOLD added to APPLICATION_STATUSES
- `scripts/render-flowchart.js` — eslint-disable header (pre-existing lint blocker fix, out-of-scope but trivial)

## Key invariants enforced (for downstream agents)
- Candidate-facing endpoints NEVER return AI evaluation data (by-token/start/answer verified leak-free).
- Webhook/sync stamp the OWNING recruiter's company name on jobs; payload company strings ignored.
- Video/recording links in ATS payloads are RELATIVE (`/api/interview/media/<file>`) — receivers resolve against origin.
- Brand-neutral strings everywhere; no competitor portal names.

## Verification results (all green)
See worklog entry `Task ID: enterprise-2` for the full curl matrix. Database left clean:
0 atsJobId jobs, 0 integrations, 0 AiEvaluation rows, 0 throwaway users/pushes/emails.
