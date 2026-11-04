// SeeWe - Shared Types & API Contracts
// ALL frontend components and backend routes MUST use these types.

export type Role = 'CANDIDATE' | 'RECRUITER' | 'CLIENT' | 'ADMIN'

export type JobStatus = 'ACTIVE' | 'PAUSED' | 'CLOSED'

export type ApplicationStatus =
  | 'APPLIED'
  | 'SHORTLISTED'
  | 'INTERVIEW_SCHEDULED'
  | 'INTERVIEWED'
  | 'SHARED_WITH_CLIENT'
  | 'REJECTED'
  | 'HIRED'
  | 'OFFERED'
  | 'ONBOARDED'

export type InterviewStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
export type Verdict = 'STRONG_HIRE' | 'HIRE' | 'MAYBE' | 'NO_HIRE'
export type ShortlistStatus = 'PENDING_INTERVIEW' | 'INTERVIEW_IN_PROGRESS' | 'COMPLETED' | 'REPORT_SHARED'
export type ClientDecision = 'APPROVED' | 'REJECTED' | 'ON_HOLD'
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD'

// ---------- User ----------
export interface User {
  id: string
  email: string
  name: string
  role: string // Role
  phone?: string | null
  headline?: string | null
  location?: string | null
  company?: string | null
  skills?: string | null // comma separated
  experienceYears?: number | null
  currentSalary?: number | null
  expectedSalary?: number | null
  education?: string | null
  resumeText?: string | null
  avatarSeed?: string | null
  /** 0 = immediate joiner, 15/30/60/90 = days; null = not specified */
  noticePeriodDays?: number | null
  /** Profile privacy — when false the profile is hidden from recruiter talent search */
  profileVisible?: boolean
  /** PRIVATE privacy shield — current employer; recruiters from this company never see this profile */
  currentEmployer?: string | null
  /** Portfolio links (public, shown to recruiters) */
  githubUrl?: string | null
  linkedinUrl?: string | null
  behanceUrl?: string | null
  portfolioUrl?: string | null
  /** Attached CV document metadata (bytes stream via /api/candidates/[id]/cv) */
  cvFileName?: string | null
  cvMimeType?: string | null
  cvUploadedAt?: string | null
  /** Account verification state (candidate full-auth flow) */
  emailVerified?: boolean
  phoneVerified?: boolean
  /** Profile photo metadata (bytes stream via /api/candidates/[id]/photo) */
  photoMime?: string | null
  photoUploadedAt?: string | null
  /** Desired job preferences */
  desiredRole?: string | null
  desiredLocations?: string | null
  desiredJobType?: string | null
  desiredIndustry?: string | null
  clientId?: string | null // set for CLIENT (partner portal account) + RECRUITER (own company workspace)
  /** Company branding (RECRUITER accounts; shown on their job listings) */
  companyAbout?: string | null
  companyWebsite?: string | null
  companyLogoData?: string | null
  companyLogoMime?: string | null
  brandColor?: string | null
  createdAt?: string
}

/** Lightweight candidate representation used in application/candidate listings */
export type CandidateSummary = User

export interface LoginRequest {
  email: string
  name?: string // required if registering new user
  role: Role
}

// ---------- Job ----------
export interface Job {
  id: string
  title: string
  company: string
  recruiterId: string
  description: string
  location: string
  jobType: string
  workMode: string
  experienceMin: number
  experienceMax: number
  salaryMinLpa?: number | null
  salaryMaxLpa?: number | null
  skills: string // comma separated
  openings: number
  status: string
  jdText?: string | null
  viewsCount: number
  // AI screening interview — OPTIONAL per job (recruiter-authored questions)
  aiInterviewEnabled?: boolean
  aiInterviewConfig?: string | null // JSON AiInterviewConfig
  createdAt: string
  applications?: Application[]
  _count?: { applications: number }
  /** Company branding (from the posting recruiter's account; optional) */
  recruiter?: {
    id: string
    name: string
    company: string
    avatarSeed?: string | null
    companyAbout?: string | null
    companyWebsite?: string | null
    companyLogoData?: string | null
    companyLogoMime?: string | null
    brandColor?: string | null
  } | null
}

/** One recruiter-authored AI interview question (stored inside Job.aiInterviewConfig) */
export interface AiInterviewQuestion {
  id: string
  text: string
  /** VOICE = candidate speaks (recorded + transcribed); TEXT = candidate types; VIDEO = candidate answers on camera (video + audio recorded, auto-transcribed) */
  type: 'VOICE' | 'TEXT' | 'VIDEO'
  /** answer window in seconds (30–600); 0/null = no limit */
  timeLimitSec: number
}

/** Per-job AI interview configuration authored by the recruiter */
export interface AiInterviewConfig {
  questions: AiInterviewQuestion[]
  /** append the standard closing profile questions (location/experience/notice/CTC) */
  includeProfileQuestions: boolean
}

export interface CreateJobRequest {
  recruiterId: string
  title: string
  company?: string
  description: string
  location: string
  jobType?: string
  workMode?: string
  experienceMin?: number
  experienceMax?: number
  salaryMinLpa?: number
  salaryMaxLpa?: number
  skills: string
  openings?: number
  jdText?: string
  aiInterviewEnabled?: boolean
  aiInterviewConfig?: AiInterviewConfig
}

// ---------- Application ----------

/** AI screening dossier — recruiter-side only, NEVER exposed to candidates */
export type ScreenVerdict = 'STRONG_FIT' | 'GOOD_FIT' | 'WEAK_FIT'

export interface ScreenSummary {
  headline: string
  verdict: ScreenVerdict
  matchedSkills: string[]
  missingSkills: string[]
  experienceFit: string
  screenNote: string
  flags: string[]
}

/** Persisted offer letter (JSON column on Application.offerLetter) */
export interface OfferLetter {
  subject: string
  body: string
  salaryLpa: number
  joiningDate: string
  workMode: string
  generatedAt: string
}

export type OfferStatus = 'SENT' | 'ACCEPTED' | 'DECLINED'
export type OnboardStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'

/** One step of the post-hire onboarding tracker */
export interface OnboardChecklistItem {
  key: string
  label: string
  done: boolean
  doneAt?: string | null
}

export interface Application {
  id: string
  jobId: string
  candidateId: string
  coverNote?: string | null
  status: ApplicationStatus
  matchScore?: number | null
  /** which channel brought the candidate in: DIRECT | SHARED_LINK | CAREER_PAGE | REFERRAL */
  source?: string | null
  /** JSON ScreenSummary — recruiter-only; stripped from every candidate-facing payload */
  screenSummary?: string | null
  screenVerdict?: ScreenVerdict | string | null
  /** JSON {level, flags[], summary, recommendNextStep} — AI resume-authenticity scan, recruiter-only */
  authenticityCheck?: string | null
  /** 0-100 trust score from the authenticity scan — recruiter-only */
  authenticityScore?: number | null
  offeredAt?: string | null
  /** JSON OfferLetter — visible to the candidate (their own offer) but contains no scores */
  offerLetter?: string | null
  offerStatus?: OfferStatus | string | null
  /** JSON OnboardChecklistItem[] */
  onboardChecklist?: string | null
  onboardStatus?: OnboardStatus | string | null
  /** recruiter-private evaluation notes (never shown to the candidate) */
  notes?: string | null
  /** first recruiter engagement timestamp — powers the candidate-facing "viewed" signal */
  viewedAt?: string | null
  /** CV snapshot attached to THIS application (bytes stream via /api/applications/[id]/cv) */
  cvFileName?: string | null
  cvMimeType?: string | null
  createdAt: string
  job?: Job
  candidate?: CandidateSummary
  shortlists?: Shortlist[]
}

export interface ApplyRequest {
  jobId: string
  candidateId: string
  coverNote?: string
  /** Optional CV attached at apply time (falls back to the profile CV snapshot) */
  cv?: { fileName: string; mimeType: string; dataUrl: string }
}

export interface UpdateApplicationStatusRequest {
  status: ApplicationStatus
}

// ---------- Client ----------
export interface Client {
  id: string
  name: string
  contactEmail: string
  industry?: string | null
  notes?: string | null
  addedBy?: string | null
  createdAt?: string
  shortlists?: Shortlist[]
}

export interface CreateClientRequest {
  name: string
  contactEmail: string
  industry?: string
  notes?: string
  addedBy?: string
}

// ---------- Shortlist ----------
export interface Shortlist {
  id: string
  applicationId: string
  clientId?: string | null
  client?: Client | null
  recruiterNote?: string | null
  status: ShortlistStatus
  clientDecision?: ClientDecision | null
  clientFeedback?: string | null
  decidedAt?: string | null
  createdAt: string
  interview?: Interview | null
}

export interface CreateShortlistRequest {
  applicationId: string
  clientId?: string
  recruiterNote?: string
}

// ---------- Interview ----------
export interface InterviewQuestion {
  qIndex: number
  question: string
  focusArea: string
  modelAnswerPoints: string[]
  /** CORE = graded role question; PRELIMINARY = closing profile question (location/experience/notice/CTC) whose answer auto-feeds the candidate profile */
  kind?: 'CORE' | 'PRELIMINARY'
  /** Answer format the RECRUITER chose for this question: VOICE = speak only (no typing), TEXT = type only (no mic), VIDEO = on-camera answer (video+audio recorded) */
  type?: 'VOICE' | 'TEXT' | 'VIDEO'
  /** Recruiter-set answer window in seconds (0/undefined = no per-question limit) */
  timeLimitSec?: number
}

export interface AnswerRecord {
  id: string
  qIndex: number
  question: string
  transcript?: string | null
  audioPresent: boolean
  score?: number | null
  feedback?: string | null
  strengths?: string | null // JSON array
  improvements?: string | null // JSON array
  mediaPath?: string | null // recorded answer webm (served via /api/interview/media/[file])
  mediaKind?: string | null // "video" | "audio"
  mediaSeconds?: number | null
}

export interface DimensionScore {
  name: string
  score: number // 0-10
}

/** One recorded answer in the recruiter's central recording inventory (GET /api/interview/media-list) */
export interface MediaListItem {
  id: string
  interviewId: string
  mediaFile: string
  mediaKind: 'video' | 'audio'
  mediaSeconds: number | null
  qIndex: number
  question: string
  score: number | null
  interviewStatus: string
  overallScore: number | null
  verdict: string | null
  candidateName: string
  candidateEmail: string
  jobTitle: string
  company: string
  jobId: string | null
  applicationId: string | null
  clientName: string | null
  sharedWithClient: boolean
  recordedAt: string | null
  /** File size on disk in bytes; null when the file is missing (e.g. GC'd). */
  bytes?: number | null
  /** Which candidate take was submitted: "A" | "B" (null/undefined = legacy single take). */
  takeLabel?: 'A' | 'B' | null
}

/** Profile facts captured from the closing preliminary questions of an AI interview */
export interface InterviewCandidateDetails {
  location?: string | null
  experienceYears?: number | null
  noticePeriodDays?: number | null
  currentSalaryLpa?: number | null
  expectedSalaryLpa?: number | null
}

export interface InterviewReport {
  aiSummary: string
  dimensionScores: DimensionScore[]
  strengths: string[]
  weaknesses: string[]
  recommendation: string
  /** structured facts parsed from the candidate's spoken closing answers (auto-fed to their profile too) */
  candidateDetails?: InterviewCandidateDetails
}

export interface Interview {
  id: string
  shortlistId: string
  candidateName: string
  jobTitle: string
  domain: string
  difficulty: Difficulty
  questions: string // JSON InterviewQuestion[]
  status: InterviewStatus
  overallScore?: number | null
  verdict?: Verdict | null
  report?: string | null // JSON InterviewReport
  startedAt?: string | null
  completedAt?: string | null
  createdAt: string
  answers?: AnswerRecord[]
  shortlist?: Shortlist & { application?: Application }
}

export interface StartInterviewRequest {
  shortlistId: string
}

export interface SubmitAnswerRequest {
  interviewId: string
  qIndex: number
  transcript: string
  audioPresent?: boolean
  media_base64?: string // recorded answer blob (data URL or raw base64)
  mediaSeconds?: number
}

// ---------- Search / Query Contracts ----------

/** A rated AI interview report shared with a client partner */
export interface ClientPortalReport {
  shortlistId: string
  sharedAt: string
  recruiterNote?: string | null
  clientDecision?: ClientDecision | null
  clientFeedback?: string | null
  decidedAt?: string | null
  interview: {
    id: string
    candidateName: string
    jobTitle: string
    domain: string
    difficulty: Difficulty
    overallScore?: number | null
    verdict?: Verdict | null
    completedAt?: string | null
    questionsAnswered: number
    totalQuestions: number
    report?: InterviewReport | null
  }
  candidate: {
    id: string
    name: string
    headline?: string | null
    location?: string | null
    skills?: string | null
    experienceYears?: number | null
    expectedSalary?: number | null
    noticePeriodDays?: number | null
    avatarSeed?: string | null
  }
  job: {
    id: string
    title: string
    company: string
    location: string
  }
}

export interface ClientPortalStats {
  totalReports: number
  avgScore: number | null
  verdictCounts: Record<string, number>
  pendingDecisions: number
  approved: number
  rejected: number
  strongHireRate: number // 0-100
}

export interface ClientPortalResponse {
  client: Client
  reports: ClientPortalReport[]
  stats: ClientPortalStats
}

export interface ClientFeedbackRequest {
  clientId: string
  shortlistId: string
  decision: ClientDecision
  feedback?: string
}

// ---------- Career Page (public, deep link ?career={clientId}) ----------
export interface CareerPageJob {
  id: string
  title: string
  company: string
  location: string
  jobType: string
  workMode: string
  experienceMin: number
  experienceMax: number
  salaryMinLpa?: number | null
  salaryMaxLpa?: number | null
  skills: string // comma separated
  /** trimmed to 500 chars by the API for the public listing */
  description: string
  createdAt: string
  openings: number
}

export interface CareerPageResponse {
  company: { name: string; industry?: string | null }
  jobs: CareerPageJob[]
}

// ---------- Search / Query Contracts ----------
export interface JobSearchQuery {
  keyword?: string
  location?: string
  minExperience?: number
  maxExperience?: number
  minSalary?: number
  jobType?: string
  workMode?: string
  companyId?: string // filter by recruiter/company
  page?: number
  limit?: number
}

export interface CandidateSearchQuery {
  keyword?: string // searches name, headline, skills, resumeText
  skill?: string
  minExperience?: number
  maxExperience?: number
  location?: string
}

// ---------- API Response Envelopes ----------
export interface ApiResponse<T> {
  data?: T
  error?: string
}

// ---------- Notification ----------
export type NotificationType =
  | 'APPLICATION' // recruiter: new application on your job
  | 'SHORTLIST' // candidate: shortlisted / application update
  | 'INTERVIEW_DONE' // recruiter + candidate: AI interview completed
  | 'CLIENT_VERDICT' // recruiter + candidate: client decision recorded
  | 'REPORT_SHARED' // client partner: new AI report to review
  | 'MESSAGE' // candidate + recruiter: new direct 1:1 message
  | 'OFFER' // candidate: offer received / recruiter: offer accepted or declined
  | 'ONBOARDING' // recruiter: onboarding progress on a hire

export interface AppNotification {
  id: string
  userId: string
  type: NotificationType | string
  title: string
  body: string
  meta?: string | null // JSON string of NotificationMeta
  read: boolean
  createdAt: string
}

export interface NotificationsResponse {
  notifications: AppNotification[]
  unread: number
}

// ---------- Process emails (candidate mailbox) ----------
export type EmailKind =
  | 'APPLICATION_RECEIVED'
  | 'INTERVIEW_INVITE'
  | 'INTERVIEW_SUBMITTED'
  | 'OFFER'
  | 'SHARED_WITH_CLIENT'
  | 'STATUS_UPDATE'

export interface ProcessEmail {
  id: string
  toEmail: string
  subject: string
  body: string
  kind: EmailKind | string
  status: string
  createdAt: string
}
