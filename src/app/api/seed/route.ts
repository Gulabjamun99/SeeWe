import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeMatchScore } from '@/lib/match'

// Deterministic avatar seeds keep UI colors stable across reseeds
const AVATAR = (key: string) => `seed-${key}`

// ---------- Seed data ----------

const RECRUITERS = [
  {
    email: 'ananya@technova.com',
    name: 'Ananya Sharma',
    company: 'TechNova Solutions',
    headline: 'Talent Acquisition Lead | Product Engineering Hiring',
    location: 'Bengaluru',
    phone: '+91 98450 11223',
    notes: 'Owns hiring for TechNova product org.',
  },
  {
    email: 'rahul@cloudnine.com',
    name: 'Rahul Verma',
    company: 'CloudNine Systems',
    headline: 'Senior Recruiter | Infrastructure & Mobile Talent',
    location: 'Mumbai',
    phone: '+91 98200 44556',
    notes: 'Handles DevOps and mobile roles.',
  },
  {
    email: 'priya@dataforge.com',
    name: 'Priya Iyer',
    company: 'DataForge Analytics',
    headline: 'Head of Talent | Data & Product Roles',
    location: 'Hyderabad',
    phone: '+91 99630 77889',
    notes: 'Focuses on analytics and PM hiring.',
  },
]

const CANDIDATES = [
  {
    email: 'arjun.mehta@gmail.com',
    name: 'Arjun Mehta',
    skills: 'React, TypeScript, Next.js, Redux, JavaScript',
    headline: 'Senior Frontend Engineer | React Specialist',
    location: 'Bengaluru',
    experienceYears: 6,
    currentSalary: 22,
    expectedSalary: 28,
    education: 'B.Tech CSE, VIT Vellore',
    noticePeriodDays: 30,
    resumeText:
      'Frontend engineer with 6 years of experience building large-scale React applications. Currently Senior SDE at Flipkart, where I lead the checkout experience serving 40M+ monthly users; cut bundle size by 38% via route-level code splitting and improved LCP from 3.8s to 1.9s. Previously at a funded fintech startup (Cred OG), built the merchant dashboard end-to-end in Next.js + TypeScript with Redux Toolkit, introduced Storybook and Jest/RTL testing culture (coverage from 0 to 72%). Deep expertise in performance profiling, accessibility (WCAG AA) and design-system component APIs. Mentored 5 junior engineers, run internal workshops on rendering internals (hydration, Suspense, RSC). B.Tech CSE from VIT Vellore.',
  },
  {
    email: 'sneha.kulkarni@gmail.com',
    name: 'Sneha Kulkarni',
    skills: 'Java, Spring Boot, Microservices, Hibernate, SQL',
    headline: 'Java Backend Engineer | Microservices & Payments',
    location: 'Pune',
    experienceYears: 5,
    currentSalary: 16,
    expectedSalary: 21,
    education: 'B.E. Computer Science, COEP Pune',
    noticePeriodDays: 60,
    resumeText:
      'Backend engineer specializing in Java/Spring Boot microservices for high-throughput systems. At Infosys worked on a banking core modernization program: designed 12 Spring Boot services communicating over Kafka, normalized Oracle schemas with Hibernate/JPA and drove p99 latency down to 120ms under 3k TPS load. Later joined Zoho payments platform where I built settlement reconciliation service handling Rs 900Cr/day with exactly-once idempotency guarantees, plus full JUnit/Mockito test pyramid and CI gates. Strong SQL skills (window functions, query plans), comfortable with Redis caching and Flyway migrations. Led incident reviews and on-call rotations; certified AWS Developer Associate. B.E. CS from COEP Pune.',
  },
  {
    email: 'vikram.reddy@gmail.com',
    name: 'Vikram Reddy',
    skills: 'Python, Django, SQL, Pandas, Power BI',
    headline: 'Data Analyst | Python, SQL & BI Dashboards',
    location: 'Hyderabad',
    experienceYears: 3,
    currentSalary: 9,
    expectedSalary: 13,
    education: 'B.Tech IT, NIT Trichy',
    noticePeriodDays: 0,
    resumeText:
      'Data analyst with 3 years turning messy operational data into decisions. At TCS Digital I built Django-based ETL utilities and automated weekly reporting, replacing 15 hours of manual Excel work. Rebuilt the retail client sales mart in PostgreSQL and authored 20+ Power BI dashboards adopted by 300 store managers, driving a 6% inventory-cost reduction. Fluent in advanced SQL (CTEs, window functions), Pandas pipelines and A/B test evaluation; created anomaly-detection alerts in Python that caught revenue leakage worth Rs 1.2Cr annually. Comfortable presenting insights to non-technical stakeholders. Completed Data Analytics specialization and holds Azure Data Fundamentals. B.Tech IT from NIT Trichy.',
  },
  {
    email: 'divya.nair@gmail.com',
    name: 'Divya Nair',
    skills: 'Figma, UI Design, Design Systems, Prototyping, Adobe XD',
    headline: 'Product Designer | UX/UI & Design Systems',
    location: 'Mumbai',
    experienceYears: 4,
    currentSalary: 13,
    expectedSalary: 17,
    education: 'B.Des, NID Ahmedabad',
    noticePeriodDays: 30,
    resumeText:
      'Product designer focused on complex B2B interfaces and design systems. Currently UX designer at Freshworks: restructured the admin console IA based on tree-testing insights, lifting task success from 58% to 86%, and maintain the Freddy design system used by 6 product squads. Previously at a healthtech startup, owned end-to-end flows from research to hi-fi Figma prototypes and interactive handoff specs; ran moderated usability sessions every sprint. Skilled in Figma auto-layout variants, prototyping, motion basics and accessibility-first visual design; additional Adobe XD experience from agency years delivering fintech and e-commerce projects. NID Ahmedabad graduate with an IDC-exchange semester in HCI.',
  },
  {
    email: 'rohan.joshi@gmail.com',
    name: 'Rohan Joshi',
    skills: 'AWS, Docker, Kubernetes, Terraform, CI/CD, Linux',
    headline: 'DevOps Engineer | Cloud Infra & Platform Reliability',
    location: 'Bengaluru',
    experienceYears: 7,
    currentSalary: 24,
    expectedSalary: 32,
    education: 'B.Tech CSE, IIIT Hyderabad',
    noticePeriodDays: 90,
    resumeText:
      'DevOps engineer with 7 years building reliable cloud platforms. At Walmart Labs India, owned EKS-based Kubernetes estate (60+ clusters): progressive rollouts with Argo Rollouts, autoscaling policies cutting node cost 31%, and Terraform modules as golden paths for app teams. Earlier at a Series-B logistics startup, built everything from scratch - Docker/Podman images, GitHub Actions CI/CD with security scanning, Grafana/Prometheus observability stack, and 99.95% uptime SLOs. Strong Linux internals, networking (VPC, ALB, Route53) and secrets management with Vault. Wrote the incident-response playbook and led game-days. AWS Solutions Architect Professional. B.Tech CSE from IIIT Hyderabad.',
  },
  {
    email: 'ishita.banerjee@gmail.com',
    name: 'Ishita Banerjee',
    skills: 'Product Management, Roadmapping, SQL, Agile, Analytics',
    headline: 'Product Manager | Marketplace & Growth',
    location: 'Delhi NCR',
    experienceYears: 5,
    currentSalary: 22,
    expectedSalary: 30,
    education: 'MBA, IIM Lucknow',
    noticePeriodDays: 60,
    resumeText:
      'Product manager blending analytical rigor with customer obsession. At Paytm, own the merchant onboarding funnel: ran 14 growth experiments per quarter, reduced KYC drop-off by 22% with a revised document-capture flow, and manage the roadmap across 3 engineering pods using dual-track agile. Prior paytech experience at Paytm Money where I shipped the mutual-fund discovery revamp informed by cohort analysis in SQL and Amplitude. Comfortable writing crisp PRDs, RICE prioritization, north-star metric trees, and reviewing experiment power calculations. Started career as a business analyst at Accenture Strategy. MBA from IIM Lucknow; enjoys mentoring aspiring PMs and running product teardowns.',
  },
  {
    email: 'aditya.krishnan@gmail.com',
    name: 'Aditya Krishnan',
    skills: 'Selenium, Java, TestNG, API Testing, Automation',
    headline: 'QA Automation Lead | Selenium & API Quality',
    location: 'Chennai',
    experienceYears: 4,
    currentSalary: 11,
    expectedSalary: 16,
    education: 'B.Tech CSE, SSN College Chennai',
    noticePeriodDays: 15,
    resumeText:
      'QA automation lead with 4 years making releases boringly safe. At Zoho, converted the billing suite from manual regression (5 days/cycle) into a Selenium+TestNG framework running in parallel on BrowserStack (45 minutes), covering 1,800 scenarios. Built REST-assured API suites validating contracts, schema and negative paths for 90 endpoints, integrated nightly with Jenkins and Slack triage bots. Introduced contract testing to catch frontend/backend drift early and now coach a pod of 3 QA engineers on code review discipline for automation repos. Solid Java fundamentals, page-object architecture, Allure reporting. Saved ~Rs 60L annually in escaped-defect costs per QA council estimates. B.Tech CSE, SSN Chennai.',
  },
  {
    email: 'neha.gupta@gmail.com',
    name: 'Neha Gupta',
    skills: 'Kotlin, Android SDK, Jetpack Compose, Firebase',
    headline: 'Android Developer | Jetpack Compose Advocate',
    location: 'Delhi NCR',
    experienceYears: 3,
    currentSalary: 10,
    expectedSalary: 15,
    education: 'B.Tech CSE, MNNIT Allahabad',
    noticePeriodDays: 0,
    resumeText:
      'Android developer shipping consumer apps used by millions. At Swiggy, contributed to the order-tracking experience rebuilt in Jetpack Compose: replaced legacy XML screens, cut screen-load jank by 47% and shipped live-location updates via Firebase Realtime features and WorkManager sync. Own the modularization effort that split the monolith into feature modules, improving incremental build times from 9 to 3 minutes. Core Kotlin coroutines/Flow advocate; wrote crash-free rate dashboards with Crashlytics that guided weekly release trains. Side project "BudgetBuddy" has 50k+ Play Store installs with 4.5 rating. Active speaker at Android meetup Delhi. B.Tech CSE from MNNIT Allahabad.',
  },
  {
    email: 'farhan.khan@gmail.com',
    name: 'Farhan Khan',
    skills: 'Node.js, Express, MongoDB, REST APIs, TypeScript',
    headline: 'Backend Engineer | Node.js & API Platforms',
    location: 'Bengaluru',
    experienceYears: 5,
    currentSalary: 17,
    expectedSalary: 23,
    education: 'B.E. Information Technology, Mumbai University',
    noticePeriodDays: 30,
    resumeText:
      'Backend engineer focused on Node.js platforms. At Razorpay-adjacent fintech startup Juspay earlier, built payment-link and webhook delivery services in Node.js/Express + MongoDB processing 25k events/hour with retry/backoff semantics and signed payloads. Designed REST contracts for the merchant portal (TypeScript, OpenAPI-first), implemented cursor pagination and rate limiting at the edge. Recently rebuilt notification fan-out on BullMQ queues with dead-letter handling, dropping p95 delivery time to 800ms. Writes integration tests with Supertest and maintains DB migration hygiene with Prisma. Also mentored interns through a structured 8-week backend curriculum. Open-source contributor to Express middlewares. B.E. IT, Mumbai University.',
  },
  {
    email: 'meghna.pillai@gmail.com',
    name: 'Meghna Pillai',
    skills: 'Python, TensorFlow, Machine Learning, NLP, scikit-learn',
    headline: 'ML Engineer | NLP & Recommendation Systems',
    location: 'Chennai',
    experienceYears: 2,
    currentSalary: 11,
    expectedSalary: 18,
    education: 'M.Tech AI, IIT Madras',
    noticePeriodDays: 60,
    resumeText:
      'ML engineer with strong production bent. At Freshworks AI team, trained intent-classification models (fine-tuned IndicBERT then distilled TensorFlow text models) that route support tickets across 9 Indian languages with 91% macro-F1, deployed behind FastAPI inference services on spot instances. Built evaluation harnesses (scikit-learn metrics, slice analysis) and a drift monitor that retriggers training weekly. Earlier internship at an edtech startup shipped a recommendation ranker (LambdaMART-style, LightGBM) lifting course completion by 8%. Efficient in Pandas preprocessing pipelines, experiment tracking with MLflow and model quantization for CPU-only deployment. Published workshop paper on multilingual NLP. M.Tech AI from IIT Madras.',
  },
]

const JOBS: Array<{
  recruiterEmail: string
  title: string
  description: string
  interviewExpectation: string
  location: string
  jobType?: string
  workMode: string
  experienceMin: number
  experienceMax: number
  salaryMinLpa?: number
  salaryMaxLpa?: number
  skills: string
  openings: number
}> = [
  {
    recruiterEmail: 'ananya@technova.com',
    title: 'Senior React Developer',
    description:
      'TechNova Solutions is looking for a Senior React Developer to join our fast-growing product engineering group. You will own critical parts of our customer-facing platform used by thousands of users daily.\n\nResponsibilities:\n- Build complex, reusable React components in TypeScript\n- Architect state management with Redux Toolkit and modern hooks patterns\n- Ship features end-to-end with UX designers and backend engineers\n- Optimize performance, accessibility and bundle size across the suite\n- Mentor junior developers and drive our code-review culture\n\nRequirements:\n- 4+ years building production SPAs with React\n- Strong grasp of TypeScript, async flows and browser rendering internals\n- Experience with Next.js SSR, testing (Jest/RTL) and CI pipelines\n- Clear communicator comfortable with agile rituals\n\nWe offer competitive pay, a hybrid culture, learning budget and real ownership at scale.',
    interviewExpectation:
      'Expect a 30-minute AI-led technical screen covering core React concepts, TypeScript type system basics, rendering performance and a short discussion on front-end architecture trade-offs.',
    location: 'Bengaluru',
    workMode: 'Hybrid',
    experienceMin: 4,
    experienceMax: 8,
    salaryMinLpa: 22,
    salaryMaxLpa: 38,
    skills: 'React, TypeScript, Next.js, Redux, JavaScript',
    openings: 2,
  },
  {
    recruiterEmail: 'rahul@cloudnine.com',
    title: 'Java Backend Engineer',
    description:
      'CloudNine Systems is hiring a Java Backend Engineer to strengthen our enterprise integrations practice. You will design resilient microservices powering logistics clients across India.\n\nResponsibilities:\n- Design and build Spring Boot microservices with clean domain boundaries\n- Model relational schemas and tune Hibernate/SQL for heavy read-write loads\n- Build Kafka-driven async workflows with idempotent consumers\n- Harden services with tests, tracing, and thoughtful alerting\n- Participate in design reviews and production readiness checks\n\nRequirements:\n- 3+ years with Java ecosystem in production environments\n- Solid Spring Boot, Hibernate/JPA and SQL fundamentals\n- Experience with message brokers and REST/OpenAPI design\n- Systems mindset: latency budgets, failure modes, graceful degradation\n\nJoin us for deep technical work with stable client relationships and a mentorship-rich environment.',
    interviewExpectation:
      'The AI screen will probe core Java memory model, collections, Spring dependency injection, transaction management, SQL joins and designing an idempotent payment-retry flow.',
    location: 'Mumbai',
    workMode: 'On-site',
    experienceMin: 3,
    experienceMax: 7,
    salaryMinLpa: 15,
    salaryMaxLpa: 26,
    skills: 'Java, Spring Boot, Microservices, SQL, Hibernate',
    openings: 3,
  },
  {
    recruiterEmail: 'priya@dataforge.com',
    title: 'Python Data Analyst',
    description:
      'DataForge Analytics is expanding its consulting bench and needs a Python Data Analyst who loves both notebooks and shipped products. Your analyses directly steer client merchandising strategy.\n\nResponsibilities:\n- Write production-grade Python/Pandas pipelines over PostgreSQL sources\n- Author Power BI dashboards stakeholders actually use daily\n- Run exploratory analysis, cohort studies and A/B test evaluations\n- Automate recurring reports and proactively flag anomalies\n- Translate findings into clear narratives for business owners\n\nRequirements:\n- 2+ years hands-on analyst or analytics-engineer experience\n- Advanced SQL (window functions, CTEs) and confident Python\n- Experience with at least one BI tool at scale\n- Curiosity about retail/e-commerce metrics and unit economics\n\nYou will rotate across 2-3 marquee retail and fintech engagements each year with structured mentoring.',
    interviewExpectation:
      'AI screen will include practical Python/Pandas snippets, a SQL window-function problem, basic statistics for experiments, and how you would sanity-check a suspicious dashboard metric.',
    location: 'Hyderabad',
    workMode: 'Hybrid',
    experienceMin: 2,
    experienceMax: 5,
    salaryMinLpa: 8,
    salaryMaxLpa: 15,
    skills: 'Python, SQL, Pandas, Power BI, Excel',
    openings: 2,
  },
  {
    recruiterEmail: 'rahul@cloudnine.com',
    title: 'DevOps Engineer',
    description:
      'CloudNine Systems runs managed infrastructure for several fast-scaling startups. We are adding a DevOps Engineer to help teams ship safely and sleep well.\n\nResponsibilities:\n- Operate and improve Kubernetes estates on AWS (EKS)\n- Codify infrastructure with Terraform modules and policy checks\n- Build maintainable CI/CD pipelines with staged rollouts\n- Own observability: Prometheus/Grafana dashboards, actionable alerts\n- Lead incident response with blameless postmortems\n\nRequirements:\n- 4+ years in DevOps/SRE/platform roles on AWS\n- Confident Linux, networking and shell troubleshooting\n- Kubernetes in production (RBAC, autoscaling, upgrades)\n- Scripting skills in Bash plus Python or Go\n\nRemote-first role with quarterly onsites; certification budget and conference sponsorship included.',
    interviewExpectation:
      'AI screen covers Linux internals, Docker layering, Kubernetes objects and probes, Terraform state strategy, and diagnosing a flaky deployment pipeline scenario.',
    location: 'Remote',
    workMode: 'Remote',
    experienceMin: 4,
    experienceMax: 9,
    salaryMinLpa: 18,
    salaryMaxLpa: 32,
    skills: 'AWS, Docker, Kubernetes, Terraform, CI/CD, Linux',
    openings: 1,
  },
  {
    recruiterEmail: 'ananya@technova.com',
    title: 'UX Designer',
    description:
      'TechNova Solutions seeks a UX Designer to shape delightful workflows for our operations suite used by warehouse teams nationwide. You will be the voice of the user inside cross-functional squads.\n\nResponsibilities:\n- Conduct usability research and translate findings into flows\n- Design hi-fi interfaces in Figma with reusable auto-layout components\n- Evolve our design system alongside engineers\n- Prototype interactions to validate ideas before build\n- Partner closely with PMs to balance craft and velocity\n\nRequirements:\n- 2+ years designing digital products end-to-end\n- Portfolio demonstrating systematic thinking and measurable impact\n- Fluency in Figma including variables and prototyping\n- Empathy for frontline/constrained-user contexts is a big plus\n\nCreative studio setup, hardware budget and annual design-conference travel included.',
    interviewExpectation:
      'AI review walks through your case study: problem framing, research inputs, iteration rationale and outcomes; plus quick critique questions on information hierarchy and accessibility.',
    location: 'Bengaluru',
    workMode: 'On-site',
    experienceMin: 2,
    experienceMax: 6,
    salaryMinLpa: 10,
    salaryMaxLpa: 19,
    skills: 'Figma, UI Design, Design Systems, Prototyping',
    openings: 1,
  },
  {
    recruiterEmail: 'priya@dataforge.com',
    title: 'Product Manager',
    description:
      'DataForge Analytics is hiring a Product Manager for our analytics platform serving mid-market retailers. You will define what we build next and why it wins.\n\nResponsibilities:\n- Own roadmap from discovery to launch for assigned module\n- Talk to customers weekly; synthesize insight into crisp PRDs\n- Partner with data science to embed ML assists sensibly\n- Define success metrics, instrument them, iterate honestly\n- Coordinate launches across engineering, sales and support\n\nRequirements:\n- 4+ years product management experience, ideally B2B/data products\n- Working SQL fluency and comfort reading funnels and cohorts\n- Track record of evidence-driven prioritization (RICE or similar)\n- Excellent written communication for docs and exec updates\n\nAutonomy with accountability; direct exposure to founder-level decision making.',
    interviewExpectation:
      'AI case discussion: scope an MVP retention feature for the platform, choose launch metrics, handle an angry enterprise customer objection and defend your trade-offs.',
    location: 'Delhi NCR',
    workMode: 'Hybrid',
    experienceMin: 4,
    experienceMax: 9,
    salaryMinLpa: 20,
    salaryMaxLpa: 35,
    skills: 'Product Management, Roadmapping, SQL, Agile, Analytics',
    openings: 1,
  },
  {
    recruiterEmail: 'ananya@technova.com',
    title: 'QA Automation Lead',
    description:
      'TechNova Solutions wants a QA Automation Lead to own quality engineering for our payments feature set. Zero critical escapes is the standard; speed is the constraint.\n\nResponsibilities:\n- Scale our Selenium/TestNG regression suite to sub-hour cycles\n- Build API contract and negative-path coverage for all endpoints\n- Integrate quality gates into Jenkins pipelines\n- Coach engineers on testability and flake elimination\n- Report release-readiness with data, not vibes\n\nRequirements:\n- 3+ years in test automation with Java\n- Deep Selenium, TestNG, REST API testing expertise\n- Experience parallelizing suites against cloud grids\n- Sharp eye for root-causing flaky tests versus product bugs\n\nModern practices, low meetings, and genuine influence on how we ship.',
    interviewExpectation:
      'AI screen includes designing a page-object suite for a checkout flow, choosing assertions for an unstable endpoint, and strategizing parallel execution on limited grid capacity.',
    location: 'Chennai',
    workMode: 'On-site',
    experienceMin: 3,
    experienceMax: 7,
    salaryMinLpa: 12,
    salaryMaxLpa: 21,
    skills: 'Selenium, Java, TestNG, API Testing, Automation',
    openings: 2,
  },
  {
    recruiterEmail: 'rahul@cloudnine.com',
    title: 'Android Developer',
    description:
      'CloudNine Systems is building next-gen driver companion apps for connected vehicles. Join as Android Developer and put polished Kotlin experiences in millions of cars.\n\nResponsibilities:\n- Build feature-first modules in Kotlin with Jetpack Compose\n- Implement offline-first sync with Room and WorkManager\n- Instrument performance and crash telemetry; act on it weekly\n- Collaborate with automotive HMI designers on driver-safe UI\n- Keep modularity and build times healthy as the codebase grows\n\nRequirements:\n- 2+ years professional Android development in Kotlin\n- Production Compose experience strongly preferred\n- Understanding of lifecycle-aware architecture and coroutines/Flow\n- Bonus: Firebase, BLE, or media/automotive APIs exposure\n\nHardware perks, play-store attribution for side ideas, and a team obsessed with craft.',
    interviewExpectation:
      'AI screen probes Kotlin null-safety and coroutines, Compose recomposition gotchas, offline-sync design, and debugging a mid-drive ANR report.',
    location: 'Pune',
    workMode: 'Hybrid',
    experienceMin: 2,
    experienceMax: 6,
    salaryMinLpa: 9,
    salaryMaxLpa: 19,
    skills: 'Kotlin, Android SDK, Jetpack Compose, Firebase',
    openings: 2,
  },
]

const CLIENTS = [
  // In-house model: every recruiter's own company is a client workspace first.
  // (names MUST match the recruiter `company` fields above so sign-in links them)
  {
    name: 'TechNova Solutions',
    contactEmail: 'clients@technova-demo.com',
    industry: 'Product Engineering',
    notes: 'Ananya\'s own company workspace — shared AI reports land here for leadership review.',
  },
  {
    name: 'CloudNine Systems',
    contactEmail: 'clients@cloudnine-demo.com',
    industry: 'Enterprise Software',
    notes: 'Rahul Verma\'s own company workspace for infrastructure & mobile hiring.',
  },
  {
    name: 'DataForge Analytics',
    contactEmail: 'clients@dataforge-demo.com',
    industry: 'Data & AI Consulting',
    notes: 'Priya\'s own company workspace for the consulting bench.',
  },
  {
    name: 'Infosys Ltd',
    contactEmail: 'clients@infosys-demo.com',
    industry: 'IT Services',
    notes: 'Bulk hiring partner for digital transformation programs. Prefers pre-vetted senior profiles with enterprise Java/frontend depth.',
  },
  {
    name: 'Flipkart Internet Pvt Ltd',
    contactEmail: 'partnerships@flipkart-demo.com',
    industry: 'E-commerce',
    notes: 'Priority account during festive-season ramp-ups. Fast turnaround expected on supply-chain and mobile roles.',
  },
  {
    name: 'Zoho Corp',
    contactEmail: 'alliances@zoho-demo.com',
    industry: 'SaaS',
    notes: 'Values hands-on coding assessments. Chennai/remote hybrid placements common.',
  },
]

// ---------- Handler ----------

/**
 * Recruiter-authored AI interview configs for demo jobs (idempotent config
 * migration — runs on every seed call, only patches jobs that still have the
 * default `aiInterviewEnabled = false` so recruiter edits are never clobbered).
 * Shows the full voice/text + time-limit design surface in action.
 */
const AI_CONFIG_DEMOS: Array<{
  title: string
  company: string
  questions: Array<{ text: string; type: 'VOICE' | 'TEXT'; timeLimitSec: number }>
}> = [
  {
    title: 'Senior React Developer',
    company: 'TechNova Solutions',
    questions: [
      {
        text: 'To start, please introduce yourself and walk me through the most complex React application you have personally shipped.',
        type: 'VOICE',
        timeLimitSec: 120,
      },
      {
        text: 'Explain how you would debug a React component that re-renders far more often than expected. Walk me through your actual process.',
        type: 'VOICE',
        timeLimitSec: 180,
      },
      {
        text: 'Our dashboard has a form used by 40 screens. How would you architect shared state and validation so it stays maintainable?',
        type: 'VOICE',
        timeLimitSec: 180,
      },
      {
        text: 'In one short paragraph: when would you reach for a code-splitting strategy, and what do you measure before and after?',
        type: 'TEXT',
        timeLimitSec: 180,
      },
    ],
  },
  {
    title: 'Python Data Analyst',
    company: 'DataForge Analytics',
    questions: [
      {
        text: 'Please introduce yourself and describe one analysis you delivered that changed a real business decision.',
        type: 'VOICE',
        timeLimitSec: 120,
      },
      {
        text: 'A stakeholder says yesterday’s revenue dashboard looks wrong. Walk me through how you would sanity-check it end to end.',
        type: 'VOICE',
        timeLimitSec: 180,
      },
      {
        text: 'Explain the difference between an inner join, a left join and a window function — with a retail example you have actually used.',
        type: 'VOICE',
        timeLimitSec: 150,
      },
      {
        text: 'Write out (in plain text) the SQL you would use to find the top 5 products by month-over-month revenue growth.',
        type: 'TEXT',
        timeLimitSec: 300,
      },
      {
        text: 'Which Python libraries do you use daily, and for what exact task is each one your first choice?',
        type: 'TEXT',
        timeLimitSec: 180,
      },
    ],
  },
]

async function seedAiInterviewConfigs(): Promise<number> {
  let patched = 0
  for (const demo of AI_CONFIG_DEMOS) {
    const job = await db.job.findFirst({
      where: { title: demo.title, company: demo.company },
      select: { id: true, aiInterviewEnabled: true },
    })
    if (!job || job.aiInterviewEnabled) continue
    await db.job.update({
      where: { id: job.id },
      data: {
        aiInterviewEnabled: true,
        aiInterviewConfig: JSON.stringify({
          questions: demo.questions.map((q, i) => ({ id: `seed-q${i + 1}`, ...q })),
          includeProfileQuestions: true,
        }),
      },
    })
    patched += 1
  }
  return patched
}

export async function POST(req: NextRequest) {
  try {
    // Environment guard: demo/bootstrap seeding is a DEV convenience only.
    // In production the endpoint disappears entirely (404) so a fresh DB can
    // never be pre-seeded with known accounts by an anonymous caller.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Idempotency guard: never double-seed
    const existingUsers = await db.user.count()
    if (existingUsers > 0) {
      // Config migration still runs — demo jobs get their recruiter-authored
      // AI interview question sets even on an already-seeded database.
      const aiPatched = await seedAiInterviewConfigs()
      return NextResponse.json({
        data: {
          seeded: false,
          message: 'DB already has data',
          ...(aiPatched > 0 ? { aiInterviewConfigsPatched: aiPatched } : {}),
        },
      })
    }

    // 1) Recruiters
    const recruitersByEmail: Record<string, string> = {}
    for (const r of RECRUITERS) {
      const created = await db.user.create({
        data: {
          email: r.email,
          name: r.name,
          role: 'RECRUITER',
          company: r.company,
          headline: r.headline,
          location: r.location,
          phone: r.phone,
          avatarSeed: AVATAR(r.name),
        },
      })
      recruitersByEmail[r.email] = created.id
    }

    // 2) Candidates
    const candidatesByEmail: Record<string, string> = {}
    for (const c of CANDIDATES) {
      const created = await db.user.create({
        data: {
          email: c.email,
          name: c.name,
          role: 'CANDIDATE',
          skills: c.skills,
          headline: c.headline,
          location: c.location,
          experienceYears: c.experienceYears,
          currentSalary: c.currentSalary,
          expectedSalary: c.expectedSalary,
          education: c.education,
          noticePeriodDays: c.noticePeriodDays,
          resumeText: c.resumeText,
          avatarSeed: AVATAR(c.name),
        },
      })
      candidatesByEmail[c.email] = created.id
    }

    // 3) Jobs
    const jobsByTitleKey: Record<string, { id: string; skills: string }> = {}
    for (const j of JOBS) {
      const recruiterId = recruitersByEmail[j.recruiterEmail]
      const recruiter = RECRUITERS.find((r) => r.email === j.recruiterEmail)!
      const jdText =
        `${j.description}\n\nInterview expectations: ${j.interviewExpectation}`
      const created = await db.job.create({
        data: {
          title: j.title,
          company: recruiter.company,
          recruiterId,
          description: j.description,
          location: j.location,
          jobType: j.jobType ?? 'Full-time',
          workMode: j.workMode,
          experienceMin: j.experienceMin,
          experienceMax: j.experienceMax,
          salaryMinLpa: j.salaryMinLpa ?? null,
          salaryMaxLpa: j.salaryMaxLpa ?? null,
          skills: j.skills,
          openings: j.openings,
          status: 'ACTIVE',
          jdText,
        },
      })
      jobsByTitleKey[`${j.recruiterEmail}::${j.title}`] = {
        id: created.id,
        skills: created.skills,
      }
    }

    // 4) Clients — every recruiter's own company + other partner accounts
    const clientsByName: Record<string, string> = {}
    for (const c of CLIENTS) {
      const created = await db.client.create({
        data: {
          name: c.name,
          contactEmail: c.contactEmail,
          industry: c.industry,
          notes: c.notes,
          addedBy: recruitersByEmail[RECRUITERS[0].email],
        },
      })
      clientsByName[created.name] = created.id
    }
    // In-house model: link each recruiter to their own company workspace
    for (const r of RECRUITERS) {
      const clientId = clientsByName[r.company]
      if (clientId) {
        await db.user.update({
          where: { id: recruitersByEmail[r.email] },
          data: { clientId },
        })
      }
    }

    // 4b) Demo requisitions for the Job Requisition & Approval workflow —
    // raised by Ananya inside her own company workspace (TechNova Solutions).
    const techNovaClientId = clientsByName['TechNova Solutions']
    const ananyaId = recruitersByEmail['ananya@technova.com']
    if (techNovaClientId && ananyaId) {
      await db.jobRequisition.create({
        data: {
          clientId: techNovaClientId,
          requestedById: ananyaId,
          title: 'Senior Backend Engineer (Payments)',
          department: 'Engineering',
          location: 'Bengaluru, India',
          jobType: 'Full-time',
          workMode: 'Hybrid',
          experienceMin: 4,
          experienceMax: 8,
          salaryMinLpa: 28,
          salaryMaxLpa: 42,
          openings: 2,
          skills: 'Node.js, PostgreSQL, AWS, Microservices, Kafka',
          justification:
            'Payments team signed two enterprise accounts starting Q3 — the current team of 4 cannot cover the on-call rotation and delivery timeline without two additional backend engineers. Approving this keeps the committed launch dates intact.',
          budgetConfirmed: true,
          status: 'APPROVED',
          approverName: 'Priya Nair',
          approverNote:
            'Approved for a Q3 start — hire within the approved band and loop me in before offers go out.',
          decidedAt: new Date(),
        },
      })
      await db.jobRequisition.create({
        data: {
          clientId: techNovaClientId,
          requestedById: ananyaId,
          title: 'Product Designer (Design Systems)',
          department: 'Design',
          location: 'Bengaluru, India',
          jobType: 'Full-time',
          workMode: 'Hybrid',
          experienceMin: 3,
          experienceMax: 6,
          salaryMinLpa: 22,
          salaryMaxLpa: 34,
          openings: 1,
          skills: 'Figma, Design Systems, Prototyping, UX Research',
          justification:
            'Design reviews are bottlenecked on one systems designer across four product squads — an extra designer keeps the component library velocity and cuts handoff rework.',
          budgetConfirmed: true,
          status: 'PENDING_APPROVAL',
        },
      })
    }

    // 5) Sample applications with computed match scores
    const sampleApps = [
      {
        candidateEmail: CANDIDATES[0].email, // Arjun -> Senior React Developer
        jobKey: `${JOBS[0].recruiterEmail}::${JOBS[0].title}`,
        status: 'APPLIED',
        coverNote:
          'I have spent the last 4 years deep in React + TypeScript, most recently owning the checkout surface at Flipkart (40M MAU). The Next.js SSR and performance focus of this role is exactly my wheelhouse - happy to walk through concrete before/after metrics.',
      },
      {
        candidateEmail: CANDIDATES[1].email, // Sneha -> Java Backend Engineer
        jobKey: `${JOBS[1].recruiterEmail}::${JOBS[1].title}`,
        status: 'SHORTLISTED',
        coverNote:
          'Payments and reconciliation are my comfort zone: at Zoho I handled Rs 900Cr/day settlement flows with strict idempotency. Excited by the Kafka-driven scale described in your JD.',
      },
      {
        candidateEmail: CANDIDATES[2].email, // Vikram -> Python Data Analyst
        jobKey: `${JOBS[2].recruiterEmail}::${JOBS[2].title}`,
        status: 'APPLIED',
        coverNote: undefined,
      },
    ]
    let appsCreated = 0
    for (const s of sampleApps) {
      const job = jobsByTitleKey[s.jobKey]
      const candidateId = candidatesByEmail[s.candidateEmail]
      const cand = CANDIDATES.find((c) => c.email === s.candidateEmail)!
      await db.application.create({
        data: {
          jobId: job.id,
          candidateId,
          coverNote: s.coverNote ?? null,
          status: s.status,
          matchScore: computeMatchScore(job.skills, cand.skills),
        },
      })
      appsCreated++
    }

    // Fresh seed also stamps the recruiter-authored AI interview configs
    const aiPatched = await seedAiInterviewConfigs()

    return NextResponse.json({
      data: {
        seeded: true,
        users: Object.keys(recruitersByEmail).length + Object.keys(candidatesByEmail).length,
        jobs: Object.keys(jobsByTitleKey).length,
        apps: appsCreated,
        clients: CLIENTS.length,
        aiInterviewConfigsPatched: aiPatched,
      },
    })
  } catch (err) {
    console.error('POST /api/seed failed:', err)
    return NextResponse.json(
      { error: 'Seeding failed' },
      { status: 500 }
    )
  }
}
