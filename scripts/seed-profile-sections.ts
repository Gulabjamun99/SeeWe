/**
 * Seed: rich structured profile sections for the demo candidates.
 * Idempotent — checks existing counts per user before inserting.
 * Run: bun scripts/seed-profile-sections.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

type SectionSeed = {
  email: string
  experiences: Array<{ title: string; company: string; isCurrent: boolean; startDate: string; endDate?: string; location: string; description: string }>
  education: Array<{ degree: string; institution: string; startYear: string; endYear: string; score: string }>
  projects: Array<{ title: string; techStack: string; startDate: string; endDate?: string; description: string; link?: string }>
  certifications: Array<{ name: string; issuer: string; year: string; link?: string }>
}

const SEEDS: SectionSeed[] = [
  {
    email: 'arjun.mehta@gmail.com',
    experiences: [
      {
        title: 'Senior Frontend Engineer',
        company: 'TechNova Solutions',
        isCurrent: true,
        startDate: '2022-06',
        location: 'Bengaluru, KA',
        description:
          'Own the customer-facing React design system used by 40+ engineers. Cut LCP from 4.2s to 1.6s via route-level code-splitting and image pipeline rework; led migration from CRA to Vite across 3 apps.',
      },
      {
        title: 'Frontend Engineer',
        company: 'Zeta Interactive',
        isCurrent: false,
        startDate: '2020-03',
        endDate: '2022-05',
        location: 'Pune, MH',
        description:
          'Built payment-dashboard UI processing 2M+ transactions/day. Introduced Playwright e2e coverage (flake rate down from 18% to 2%) and mentored 2 interns to full-time offers.',
      },
      {
        title: 'Web Developer (Intern → Junior)',
        company: 'Chirp Studios',
        isCurrent: false,
        startDate: '2018-07',
        endDate: '2020-02',
        location: 'Mumbai, MH',
        description:
          'Shipped marketing sites and internal CMS tooling in React + Node; first hire of the web guild.',
      },
    ],
    education: [
      {
        degree: 'B.Tech — Computer Science',
        institution: 'Veermata Jijabai Technological Institute (VJTI), Mumbai',
        startYear: '2014',
        endYear: '2018',
        score: 'CGPA 8.7/10',
      },
      {
        degree: 'Higher Secondary (Science)',
        institution: 'Fergusson College, Pune',
        startYear: '2012',
        endYear: '2014',
        score: '91.4%',
      },
    ],
    projects: [
      {
        title: 'Ullash — Open-source design system',
        techStack: 'React, TypeScript, Radix, Storybook',
        startDate: '2023-02',
        description:
          'Accessible component library with 1.8k GitHub stars; adopted by 12 Indian startups. Focus on keyboard-first navigation and dark-mode tokens.',
        link: 'https://github.com/arjunmehta/ullash',
      },
      {
        title: 'MeterDown — Mumbai local train PWA',
        techStack: 'Next.js, IndexedDB, Workbox',
        startDate: '2021-08',
        endDate: '2022-04',
        description:
          'Offline-first timetable app, 60k+ installs on Play Store. Designed conflict-free sync for timetable patches.',
      },
    ],
    certifications: [
      { name: 'AWS Certified Developer — Associate', issuer: 'Amazon Web Services', year: '2023' },
      { name: 'Meta Front-End Developer Professional Certificate', issuer: 'Coursera / Meta', year: '2022' },
    ],
  },
  {
    email: 'meghna.pillai@gmail.com',
    experiences: [
      {
        title: 'Machine Learning Engineer',
        company: 'Flipkart',
        isCurrent: true,
        startDate: '2021-07',
        location: 'Bengaluru, KA',
        description:
          'Ranking models for grocery search (12% CTR lift). Own the feature-store pipeline; ship weekly via a canary+shadow evaluation harness.',
      },
      {
        title: 'Data Scientist',
        company: 'Mu Sigma',
        isCurrent: false,
        startDate: '2019-01',
        endDate: '2021-06',
        location: 'Bengaluru, KA',
        description: 'Demand-forecasting for FMCG clients; built the churn early-warning suite.',
      },
    ],
    education: [
      {
        degree: 'M.Tech — Artificial Intelligence',
        institution: 'IIT Bombay',
        startYear: '2016',
        endYear: '2018',
        score: 'CGPA 9.1/10',
      },
      {
        degree: 'B.E. — Electronics',
        institution: 'College of Engineering, Guindy',
        startYear: '2012',
        endYear: '2016',
        score: 'CGPA 8.5/10',
      },
    ],
    projects: [
      {
        title: 'VaaniDev — Hindi-English code-switch ASR toolkit',
        techStack: 'PyTorch, Whisper, ONNX',
        startDate: '2023-05',
        description: 'Fine-tuned Whisper for Hinglish call-center audio; WER down 21% vs baseline.',
        link: 'https://github.com/meghnap/vaanidev',
      },
    ],
    certifications: [
      { name: 'TensorFlow Developer Certificate', issuer: 'Google', year: '2022' },
      { name: 'Deep Learning Specialization', issuer: 'DeepLearning.AI', year: '2021' },
    ],
  },
  {
    email: 'farhan.khan@gmail.com',
    experiences: [
      {
        title: 'Backend Engineer II',
        company: 'Swiggy',
        isCurrent: true,
        startDate: '2022-01',
        location: 'Bengaluru, KA',
        description:
          'Order-state platform (Node/TS, Kafka, Postgres) handling 8k rps peak. Led idempotency rework that cut duplicate-order tickets by 70%.',
      },
      {
        title: 'Software Engineer',
        company: 'Postman',
        isCurrent: false,
        startDate: '2019-06',
        endDate: '2021-12',
        location: 'Bengaluru, KA',
        description: 'API gateway services and usage-based billing pipelines.',
      },
    ],
    education: [
      {
        degree: 'B.Tech — Information Technology',
        institution: 'Zakir Husain College of Engineering, AMU',
        startYear: '2015',
        endYear: '2019',
        score: 'CGPA 8.3/10',
      },
    ],
    projects: [
      {
        title: 'RateLimiterKit',
        techStack: 'Node.js, Redis, Token Bucket',
        startDate: '2022-10',
        description: 'Plug-and-play distributed rate limiter, 900+ stars; used in 3 production codebases.',
        link: 'https://github.com/farhan/rate-limiter-kit',
      },
    ],
    certifications: [{ name: 'MongoDB Associate Developer', issuer: 'MongoDB University', year: '2023' }],
  },
  {
    email: 'neha.gupta@gmail.com',
    experiences: [
      {
        title: 'Android Developer',
        company: 'Zomato',
        isCurrent: true,
        startDate: '2021-09',
        location: 'Gurugram, HR',
        description:
          'Restaurant-browsing surfaces in Compose; startup time down 32%. Own the design-token bridge between Figma and code.',
      },
      {
        title: 'Android Engineer',
        company: 'ShareChat',
        isCurrent: false,
        startDate: '2019-04',
        endDate: '2021-08',
        location: 'Bengaluru, KA',
        description: 'Video feed stack, ExoPlayer tuning for tier-2 network conditions.',
      },
    ],
    education: [
      {
        degree: 'B.Tech — Computer Science',
        institution: 'Netaji Subhas Institute of Technology, Delhi',
        startYear: '2015',
        endYear: '2019',
        score: 'CGPA 8.8/10',
      },
    ],
    projects: [
      {
        title: 'Saheli — Women-safety Android app',
        techStack: 'Kotlin, Compose, FCM',
        startDate: '2020-11',
        description: 'Offline SOS mesh + live-location sharing; 100k+ downloads, featured by Google India.',
      },
    ],
    certifications: [{ name: 'Associate Android Developer', issuer: 'Google', year: '2021' }],
  },
  {
    email: 'aditya.krishnan@gmail.com',
    experiences: [
      {
        title: 'QA Automation Lead',
        company: 'Razorpay',
        isCurrent: true,
        startDate: '2022-03',
        location: 'Bengaluru, KA',
        description:
          'Own Cypress+Playwright grid across 14 services; regression wall down from 6h to 50min. Built the API-contract diffing CI gate.',
      },
      {
        title: 'SDET',
        company: 'ThoughtWorks',
        isCurrent: false,
        startDate: '2018-12',
        endDate: '2022-02',
        location: 'Pune, MH',
        description: 'Test automation for banking clients; Appium mobile farm setup.',
      },
    ],
    education: [
      {
        degree: 'B.E. — Computer Science',
        institution: 'BITS Pilani, Goa Campus',
        startYear: '2014',
        endYear: '2018',
        score: 'CGPA 8.1/10',
      },
    ],
    projects: [
      {
        title: 'FlakeGuard',
        techStack: 'TypeScript, GitHub Actions, SQLite',
        startDate: '2023-01',
        description: 'CI bot that quarantines flaky specs via historical pass-rate analysis.',
        link: 'https://github.com/adityak/flakeguard',
      },
    ],
    certifications: [{ name: 'ISTQB Advanced Level — Test Automation Engineer', issuer: 'ISTQB', year: '2022' }],
  },
  {
    email: 'ishita.banerjee@gmail.com',
    experiences: [
      {
        title: 'Product Manager — Growth',
        company: 'Meesho',
        isCurrent: true,
        startDate: '2022-05',
        location: 'Bengaluru, KA',
        description:
          'Supply-side growth for resellers (3.2M MAU impact). Ran 40+ A/B tests; built the experiment-review council process.',
      },
      {
        title: 'Associate Product Manager',
        company: 'Razorpay',
        isCurrent: false,
        startDate: '2020-02',
        endDate: '2022-04',
        location: 'Bengaluru, KA',
        description: 'Merchant dashboard analytics; launched Cohorts & Funnels GA.',
      },
    ],
    education: [
      {
        degree: 'PGP — Management',
        institution: 'IIM Calcutta',
        startYear: '2018',
        endYear: '2020',
        score: 'Dean\u2019s list',
      },
      {
        degree: 'B.Tech — Electronics & Communication',
        institution: 'Jadavpur University',
        startYear: '2014',
        endYear: '2018',
        score: 'CGPA 8.6/10',
      },
    ],
    projects: [
      {
        title: 'Sohoj — Micro-entrepreneur onboarding playbook',
        techStack: 'Notion, Amplitude, Looker',
        startDate: '2023-03',
        description: 'Open-sourced onboarding benchmarks for Bharat-marketplace apps; 5k+ reads.',
      },
    ],
    certifications: [{ name: 'Reforge — Growth Series', issuer: 'Reforge', year: '2023' }],
  },
  {
    email: 'rohan.joshi@gmail.com',
    experiences: [
      {
        title: 'DevOps Engineer',
        company: 'Lenskart',
        isCurrent: true,
        startDate: '2021-11',
        location: 'Gurugram, HR',
        description:
          'EKS platform for 60+ microservices; spot-instance strategy cut compute cost 38%. Own Terraform modules and the GitOps rollout stack (ArgoCD).',
      },
      {
        title: 'Site Reliability Engineer',
        company: 'BrowserStack',
        isCurrent: false,
        startDate: '2019-08',
        endDate: '2021-10',
        location: 'Mumbai, MH',
        description: 'Multi-region infra for grid workloads; on-call toil reduced via runbook automation.',
      },
    ],
    education: [
      {
        degree: 'B.Tech — Computer Engineering',
        institution: 'Pune Institute of Computer Technology (PICT)',
        startYear: '2015',
        endYear: '2019',
        score: 'CGPA 8.2/10',
      },
    ],
    projects: [
      {
        title: 'Kostep — k8s cost observability',
        techStack: 'Go, Prometheus, Grafana',
        startDate: '2022-08',
        description: 'Namespace-level showback dashboards + idle-pod alerts; adopted by 2 teams.',
        link: 'https://github.com/rohanj/kostep',
      },
    ],
    certifications: [
      { name: 'Certified Kubernetes Administrator (CKA)', issuer: 'CNCF', year: '2022' },
      { name: 'HashiCorp Certified: Terraform Associate', issuer: 'HashiCorp', year: '2023' },
    ],
  },
]

async function main() {
  let totalExp = 0,
    totalEdu = 0,
    totalProj = 0,
    totalCert = 0

  for (const seed of SEEDS) {
    const user = await db.user.findUnique({ where: { email: seed.email }, select: { id: true } })
    if (!user) {
      console.log(`⚠ skip (not found): ${seed.email}`)
      continue
    }

    const [expCount, eduCount, projCount, certCount] = await Promise.all([
      db.workExperience.count({ where: { userId: user.id } }),
      db.educationEntry.count({ where: { userId: user.id } }),
      db.userProject.count({ where: { userId: user.id } }),
      db.certification.count({ where: { userId: user.id } }),
    ])

    if (expCount === 0 && eduCount === 0 && projCount === 0 && certCount === 0) {
      await db.$transaction([
        db.workExperience.createMany({
          data: seed.experiences.map((e) => ({ ...e, userId: user.id, endDate: e.endDate ?? null })),
        }),
        db.educationEntry.createMany({
          data: seed.education.map((e) => ({ ...e, userId: user.id })),
        }),
        db.userProject.createMany({
          data: seed.projects.map((p) => ({
            ...p,
            userId: user.id,
            endDate: p.endDate ?? null,
            link: p.link ?? null,
          })),
        }),
        db.certification.createMany({
          data: seed.certifications.map((c) => ({ ...c, userId: user.id, link: c.link ?? null })),
        }),
      ])
      totalExp += seed.experiences.length
      totalEdu += seed.education.length
      totalProj += seed.projects.length
      totalCert += seed.certifications.length
      console.log(`✓ seeded ${seed.email}`)
    } else {
      console.log(`= already has sections, skip: ${seed.email}`)
    }
  }

  console.log(
    `\nDone — inserted experiences:${totalExp} education:${totalEdu} projects:${totalProj} certifications:${totalCert}`
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
