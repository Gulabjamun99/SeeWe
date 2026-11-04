/**
 * seed-talent-db.ts — SYNTHETIC candidate database for the SeeWe talent
 * sourcing module (advanced).
 *
 * ⚠️  DATA LINEAGE: every profile created here is GENERATED TEST DATA. Each
 * resumeText ends with an explicit synthetic-data disclaimer and each email
 * lives under @synthetic.seewee.test so no profile can ever be mistaken for
 * (or contacted as) a real person. profileSource = "SYNTHETIC_SEED".
 *
 * Idempotent: previous SYNTHETIC_SEED candidates are wiped (children cascade)
 * and recreated with a deterministic PRNG, so counts stay stable across runs.
 *
 * Run:  bun scripts/seed-talent-db.ts
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

/* ------------------------------ deterministic RNG ------------------------ */
function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20240614)
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
const pickMany = <T,>(arr: T[], n: number): T[] => {
  const copy = [...arr]
  const out: T[] = []
  while (out.length < n && copy.length > 0) {
    out.push(copy.splice(Math.floor(rand() * copy.length), 1)[0])
  }
  return out
}
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))

/* --------------------------------- vocab --------------------------------- */
const FIRST = [
  'Aarav', 'Aditi', 'Amit', 'Ananya', 'Aniket', 'Ayesha', 'Bhavna', 'Chirag', 'Deepa', 'Devansh',
  'Diya', 'Farhan', 'Gaurav', 'Harsh', 'Ishaan', 'Ishita', 'Kavya', 'Kiran', 'Kunal', 'Lakshmi',
  'Manav', 'Meera', 'Mohit', 'Neha', 'Nikhil', 'Nisha', 'Omkar', 'Pooja', 'Pranav', 'Priya',
  'Rahul', 'Rajat', 'Rekha', 'Rohan', 'Sanjana', 'Sarthak', 'Shreya', 'Siddharth', 'Sneha', 'Sohail',
  'Suresh', 'Tanvi', 'Ujjwal', 'Varun', 'Vikram', 'Yash', 'Zoya', 'Abhishek', 'Anjali', 'Rituraj',
]
const LAST = [
  'Sharma', 'Verma', 'Patel', 'Reddy', 'Nair', 'Iyer', 'Gupta', 'Mehta', 'Joshi', 'Desai',
  'Kulkarni', 'Chauhan', 'Bhat', 'Rao', 'Menon', 'Saxena', 'Tiwari', 'Mishra', 'Kapoor', 'Shetty',
  'Pillai', 'Banerjee', 'Das', 'Chatterjee', 'Malhotra', 'Bose', 'Ghosh', 'Agarwal', 'Jain', 'Pandey',
]
const CITIES = [
  'Bengaluru', 'Pune', 'Mumbai', 'Hyderabad', 'Delhi NCR', 'Chennai', 'Ahmedabad', 'Kolkata',
  'Noida', 'Gurugram', 'Jaipur', 'Indore', 'Kochi', 'Chandigarh', 'Nagpur',
]
const LANGS = ['English', 'Hindi', 'Marathi', 'Tamil', 'Telugu', 'Kannada', 'Bengali', 'Gujarati']

interface Track {
  industry: string
  functionalArea: string
  companies: string[]
  roles: [string, string[]][] // [designation template, skill pool]
  certs: string[]
  degrees: string[]
  institutes: string[]
}

const TRACKS: Track[] = [
  {
    industry: 'IT Services & Consulting',
    functionalArea: 'Engineering - Software & QA',
    companies: ['TechNova Solutions', 'Infotech Minds', 'Zenith Softworks', 'BlueOrbit Systems', 'PixelForge Labs', 'NimbusEdge Technologies', 'Vertex Digital', 'CoreStack Software'],
    roles: [
      ['Senior Frontend Engineer', ['React', 'TypeScript', 'Next.js', 'Redux', 'Tailwind CSS', 'Jest', 'GraphQL', 'Accessibility']],
      ['Backend Engineer', ['Node.js', 'Java', 'Spring Boot', 'PostgreSQL', 'Redis', 'Kafka', 'Microservices', 'Docker']],
      ['Full Stack Developer', ['React', 'Node.js', 'MongoDB', 'TypeScript', 'AWS', 'Express', 'CI/CD', 'REST APIs']],
      ['DevOps Engineer', ['Kubernetes', 'Terraform', 'AWS', 'Jenkins', 'Linux', 'Prometheus', 'Ansible', 'Shell Scripting']],
      ['Data Engineer', ['Python', 'Spark', 'Airflow', 'SQL', 'Snowflake', 'dbt', 'Kafka', 'AWS Glue']],
      ['Machine Learning Engineer', ['Python', 'PyTorch', 'TensorFlow', 'NLP', 'MLOps', 'scikit-learn', 'Pandas', 'LLM Fine-tuning']],
      ['QA Automation Engineer', ['Selenium', 'Playwright', 'Cypress', 'Java', 'API Testing', 'Postman', 'Appium', 'CI/CD']],
      ['Mobile App Developer', ['Flutter', 'React Native', 'Kotlin', 'Swift', 'Firebase', 'REST APIs', 'App Store Deployment']],
    ],
    certs: ['AWS Certified Solutions Architect', 'Certified Kubernetes Administrator', 'Azure DevOps Engineer Expert', 'Google Professional Cloud Developer', 'Scrum Master (PSM I)'],
    degrees: ['B.Tech — Computer Science', 'B.E. — Information Technology', 'M.Tech — Software Engineering', 'MCA — Master of Computer Applications', 'B.Tech — Electronics & Communication'],
    institutes: ['IIT Delhi', 'NIT Trichy', 'VIT Vellore', 'BITS Pilani', 'IIIT Hyderabad', 'Pune Institute of Computer Technology', 'SRM Institute of Science & Technology'],
  },
  {
    industry: 'BFSI - Banking & Financial Services',
    functionalArea: 'Risk, Credit & Compliance',
    companies: ['Meridian Capital Bank', 'Suraksha Finance', 'Northern Trust Advisors', 'Aegis Credit Bureau', 'Vaultline Insurance', 'Prudential Ratings Co.'],
    roles: [
      ['Credit Analyst', ['Credit Underwriting', 'Financial Modelling', 'Ratio Analysis', 'Bloomberg', 'Excel VBA', 'Risk Assessment', 'IFRS 9']],
      ['Risk Manager', ['Market Risk', 'VaR', 'Basel III', 'Stress Testing', 'SQL', 'Python', 'Regulatory Reporting']],
      ['Compliance Officer', ['KYC', 'AML', 'SEBI Regulations', 'Compliance Audits', 'Policy Drafting', 'Risk Governance']],
      ['Investment Operations Associate', ['Fund Accounting', 'NAV Reconciliation', 'SWIFT', 'Settlements', 'MS Excel', 'Portfolio Analytics']],
      ['Fraud Analyst', ['Fraud Detection', 'SQL', 'SAS', 'Transaction Monitoring', 'Data Analytics', 'Case Management']],
    ],
    certs: ['FRM (GARP)', 'CFA Level 2 Cleared', 'NISM Series V-A', 'Certified Anti-Money Laundering Specialist', 'PRM Certification'],
    degrees: ['B.Com — Accounting & Finance', 'MBA — Finance', 'BBA — Banking & Insurance', 'CA — Chartered Accountancy', 'M.Com — Financial Markets'],
    institutes: ['SRCC Delhi', 'NMIMS Mumbai', 'Symbiosis Pune', 'Christ University Bangalore', 'ICFAI Business School', 'Shri Shikshayatan College'],
  },
  {
    industry: 'Manufacturing & Industrial',
    functionalArea: 'Maintenance & Plant Operations',
    companies: ['SteelForge Industries', 'PolyFlow Pipes Ltd', 'Vulcan polymers', 'Everest Cement Works', 'ApexAuto Components', 'TitanFab Engineering', 'AgroMach Industries'],
    roles: [
      ['Maintenance Manager', ['TPM', 'OEE', 'Preventive Maintenance', 'SAP PM', 'Extrusion', 'Polymer', 'Plastic Pipes', 'Hydraulics', 'Pneumatics', 'Root Cause Analysis']],
      ['Plant Maintenance Head', ['TPM', 'OEE', 'CMMS', 'SAP PM', 'Condition Monitoring', 'Vibration Analysis', 'Team Management', 'Budget Planning']],
      ['Production Supervisor', ['Lean Manufacturing', 'Kaizen', '5S', 'Shift Management', 'ERP', 'Quality Control', 'Safety Compliance']],
      ['Quality Assurance Engineer', ['ISO 9001', 'SPC', 'Six Sigma', 'Calibration', 'Documentation', 'NCR Management', 'Audits']],
      ['Utility & Services Engineer', ['HVAC', 'Compressors', 'Boilers', 'Electrical Maintenance', 'AMC Management', 'Energy Audits']],
      ['Extrusion Process Engineer', ['Extrusion', 'Polymer', 'Plastic Pipes', 'Die Design', 'Process Optimisation', 'SCADA', 'Material Science']],
    ],
    certs: ['Certified Maintenance & Reliability Professional (CMRP)', 'Six Sigma Green Belt', 'ISO 9001:2015 Internal Auditor', 'NPTEL — Industrial Safety', 'Energy Manager (BEE)'],
    degrees: ['B.E. — Mechanical Engineering', 'B.Tech — Production Engineering', 'Diploma — Mechanical Engineering', 'B.E. — Electrical Engineering', 'B.Tech — Polymer Technology'],
    institutes: ['College of Engineering Pune', 'Government Polytechnic Mumbai', 'Manipal Institute of Technology', 'PSG College of Technology', 'Jadavpur University'],
  },
  {
    industry: 'Healthcare & Pharma',
    functionalArea: 'Quality, Regulatory & Clinical',
    companies: ['MediCore Pharma', 'HealWell Laboratories', 'Novacare Biotech', 'Zenith Hospital Group', 'CurePoint CRO'],
    roles: [
      ['Regulatory Affairs Specialist', ['CDSCO', 'FDA Submissions', 'Dossier Preparation', 'ICH Guidelines', 'Regulatory Documentation', 'eCTD']],
      ['QA/QC Executive', ['GMP', 'HPLC', 'Validation', 'Documentation', 'Deviation Management', 'USFDA Audits']],
      ['Clinical Research Associate', ['GCP', 'Clinical Monitoring', 'Protocol Deviations', 'SAE Reporting', 'CTMS', 'Site Management']],
      ['Pharmacovigilance Officer', ['Adverse Event Reporting', 'MedDRA', 'Case Processing', 'Signal Detection', 'Argus Safety']],
    ],
    certs: ['Certified Clinical Research Professional', 'GMP Certification', 'Regulatory Affairs Certificate (RAC)', 'ISO 13485 Lead Auditor'],
    degrees: ['B.Pharm — Pharmacy', 'M.Pharm — Pharmacology', 'BDS — Dental Surgery', 'M.Sc — Microbiology', 'B.Sc — Life Sciences'],
    institutes: ['Manipal College of Pharmaceutical Sciences', 'Bombay College of Pharmacy', 'JSS College of Pharmacy', 'Delhi Institute of Pharmaceutical Sciences'],
  },
  {
    industry: 'Sales & Business Development',
    functionalArea: 'Sales & Account Management',
    companies: ['GrowthRocket SaaS', 'Vertex Digital', 'Meridian Capital Bank', 'Bharat Distribution Co.', 'NimbusEdge Technologies', 'Skyline Realty Group'],
    roles: [
      ['Enterprise Account Executive', ['B2B Sales', 'SaaS Sales', 'Pipeline Management', 'Salesforce CRM', 'Negotiation', 'Solution Selling', 'Key Accounts']],
      ['Inside Sales Specialist', ['Lead Qualification', 'Cold Calling', 'CRM', 'HubSpot', 'Email Outreach', 'Sales Demos']],
      ['Key Account Manager', ['Account Growth', 'Upselling', 'Client Retention', 'QBRs', 'Contract Negotiation', 'Cross-sell']],
      ['Regional Sales Manager', ['Team Management', 'Channel Sales', 'Distributor Management', 'Sales Target Planning', 'Market Expansion']],
    ],
    certs: ['Salesforce Certified Administrator', 'HubSpot Inbound Sales', 'Sandler Sales Certification', 'Google Ads Certification'],
    degrees: ['BBA — Marketing', 'MBA — Sales & Marketing', 'B.Com — General', 'BA — Economics'],
    institutes: ['Symbiosis Pune', 'Amity University', 'Delhi University', 'Welingkar Institute', 'Loyola College Chennai'],
  },
  {
    industry: 'HR & Recruitment',
    functionalArea: 'Human Resources & Talent',
    companies: ['TalentBridge Consulting', 'PeopleFirst HR', 'TechNova Solutions', 'MeritHire Advisory', 'Skyline Realty Group'],
    roles: [
      ['Technical Recruiter', ['Sourcing', 'Boolean Search', 'ATS', 'Advanced Sourcing', 'LinkedIn Recruiter', 'Technical Screening', 'Offer Negotiation']],
      ['HR Business Partner', ['Employee Relations', 'Performance Management', 'HRIS', 'Talent Reviews', 'Compensation Benchmarking', 'Engagement Surveys']],
      ['Talent Acquisition Lead', ['Hiring Strategy', 'Campus Hiring', 'Employer Branding', 'Interview Panels', 'ATS', 'Workforce Planning']],
      ['HR Operations Specialist', ['Onboarding', 'Payroll Coordination', 'HRMS', 'Background Verification', 'Statutory Compliance']],
    ],
    certs: ['SHRM-CP', 'Certified HR Analytics Professional', 'LinkedIn Certified Professional Recruiter', 'Green Belt — HR Six Sigma'],
    degrees: ['MBA — Human Resources', 'MA — Personnel Management', 'BBA — HR Specialisation', 'MSW — Labour Welfare'],
    institutes: ['TISS Mumbai', 'XISS Ranchi', 'Symbiosis Pune', 'Madras School of Social Work'],
  },
  {
    industry: 'Logistics & Supply Chain',
    functionalArea: 'Operations & Supply Chain',
    companies: ['SwiftMove Logistics', 'Bharat Distribution Co.', 'Portline Shipping', 'ColdChain Express', 'MetroWare Fulfilment'],
    roles: [
      ['Supply Chain Analyst', ['Demand Planning', 'S&OP', 'SQL', 'Power BI', 'Inventory Optimisation', 'SAP MM']],
      ['Warehouse Operations Manager', ['WMS', 'Fulfilment Operations', 'Team Management', 'Safety Compliance', 'Lean Warehousing', 'Slotting']],
      ['Procurement Specialist', ['Vendor Management', 'Sourcing', 'Negotiation', 'SAP Ariba', 'Cost Reduction', 'Purchase Orders']],
      ['Fleet & Transport Coordinator', ['Route Optimisation', 'Fleet Management', 'GPS Tracking', 'Statutory Permits', 'Cost Control']],
    ],
    certs: ['APICS CSCP', 'Six Sigma Yellow Belt', 'Certified in Logistics, Transportation and Distribution (CLTD)', 'SAP MM Certification'],
    degrees: ['B.Tech — Industrial Engineering', 'MBA — Operations', 'B.Sc — Logistics Management', 'B.Com — General'],
    institutes: ['NITIE Mumbai', 'ASBM University', 'IISWBM Kolkata', 'GITAM University'],
  },
  {
    industry: 'Design, Media & Marketing',
    functionalArea: 'Design, Content & Growth',
    companies: ['PixelForge Labs', 'BrandWave Studio', 'GrowthRocket SaaS', 'AdVantage Media', 'Craftly Design Co.'],
    roles: [
      ['Senior UI/UX Designer', ['Figma', 'Design Systems', 'User Research', 'Prototyping', 'Accessibility', 'Wireframing', 'Adobe XD']],
      ['Digital Marketing Manager', ['SEO', 'Google Ads', 'Meta Ads', 'Google Analytics', 'Content Strategy', 'Email Marketing', 'HubSpot']],
      ['Brand & Visual Designer', ['Adobe Illustrator', 'Photoshop', 'Brand Identity', 'Typography', 'Packaging Design', 'Print Production']],
      ['Growth Marketing Specialist', ['A/B Testing', 'Lifecycle Marketing', 'CRO', 'SEO', 'SQL', 'Mixpanel', 'Email Automation']],
    ],
    certs: ['Google Analytics Individual Qualification', 'Meta Certified Media Buying Professional', 'Nielsen Norman Group UX Certification', 'HubSpot Content Marketing'],
    degrees: ['B.Des — Visual Communication', 'BFA — Applied Arts', 'BA — Mass Communication', 'B.Sc — Animation & Multimedia'],
    institutes: ['National Institute of Design', 'Symbiosis Institute of Design', 'MIT Institute of Design', 'DJ Academy of Design'],
  },
]

const AVATAR_SEED_WORDS = ['nova', 'pulse', 'orbit', 'ember', 'quartz', 'delta', 'atlas', 'zephyr', 'lumen', 'crest']

/* ------------------------------ profile builder --------------------------- */
interface DraftWork {
  title: string
  company: string
  isCurrent: boolean
  startDate: string
  endDate?: string
  description: string
}

function monthsAgoLabel(m: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - m)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function buildCandidate(idx: number) {
  const track = TRACKS[Math.floor(rand() * TRACKS.length)]
  const [designation, skillPool] = pick(track.roles)
  const skills = pickMany(skillPool, Math.min(skillPool.length, int(5, 8)))
  const secondary = pickMany(['MS Excel', 'Communication', 'Stakeholder Management', 'Documentation', 'Reporting', 'Training'], int(1, 3))
  const allSkills = [...new Set([...skills, ...secondary])]
  const experienceYears = Math.round((rand() * 16 + 0.5) * 2) / 2
  const currentEmployer = pick(track.companies)
  const city = pick(CITIES)
  const name = `${pick(FIRST)} ${pick(LAST)}`
  const currentSalary = Math.max(3, Math.round((3 + experienceYears * 1.35 + (rand() * 2 - 1)) * 10) / 10)
  const expectedSalary = Math.round((currentSalary * (1.15 + rand() * 0.45)) * 10) / 10
  const noticeRoll = rand()
  const noticePeriodDays = noticeRoll < 0.22 ? 0 : noticeRoll < 0.5 ? 30 : noticeRoll < 0.7 ? 60 : noticeRoll < 0.85 ? 90 : 15
  const languages = pickMany(LANGS, int(2, 3))
  const preferred = pickMany(CITIES.filter((c) => c !== city), int(1, 3))

  // employment history (most recent = current)
  const jobs: DraftWork[] = []
  const historyLen = Math.max(1, Math.min(4, Math.floor(experienceYears / 2.5) + 1))
  let monthsBack = Math.round(experienceYears * 12)
  for (let j = 0; j < historyLen; j++) {
    const isCurrent = j === 0
    const title = j === 0 ? designation : pick(track.roles)[0].replace('Senior ', '')
    const company = j === 0 ? currentEmployer : pick(track.companies.filter((c) => c !== currentEmployer))
    const span = isCurrent ? int(10, Math.max(12, monthsBack)) : Math.max(8, Math.floor(monthsBack / (historyLen - j)))
    const startDate = monthsAgoLabel(monthsBack)
    const endDate = isCurrent ? undefined : monthsAgoLabel(Math.max(1, monthsBack - span))
    jobs.push({
      title,
      company,
      isCurrent,
      startDate,
      endDate,
      description: isCurrent
        ? `Currently working as ${title} at ${company}. Core stack: ${skills.slice(0, 4).join(', ')}. Delivered measurable improvements to ${pick(['throughput', 'quality', 'reliability', 'delivery timelines', 'cost efficiency'])} within the first two quarters.`
        : `Worked as ${title} at ${company}, owning ${pick(['delivery', 'quality', 'operations', 'client engagements'])} and building expertise in ${skills.slice(0, 3).join(', ')}.`,
    })
    monthsBack = Math.max(2, monthsBack - span)
  }

  const degree = pick(track.degrees)
  const institute = pick(track.institutes)
  const certList = pickMany(track.certs, int(0, 2))
  const gradYear = new Date().getFullYear() - Math.max(1, Math.round(experienceYears)) - int(0, 2)

  const resumeText = [
    `${designation} with ${experienceYears} years of experience in ${track.industry}, currently at ${currentEmployer} (${city}).`,
    `Key skills: ${allSkills.join(', ')}.`,
    `Career history includes ${jobs.map((j) => `${j.title} @ ${j.company}`).join('; ')}.`,
    certList.length ? `Certifications: ${certList.join('; ')}.` : '',
    `Education: ${degree}, ${institute} (${gradYear}).`,
    `Languages: ${languages.join(', ')}. Open to ${pick(['Full-time', 'Contract', 'Full-time'])} roles; preferred locations: ${[city, ...preferred].join(', ')}.`,
    '-- SYNTHETIC TEST PROFILE generated for the SeeWe demo talent database. Not a real person — safe to delete.',
  ]
    .filter(Boolean)
    .join('\n')

  // freshness: 40% last week, 30% last month, 20% last quarter, 10% stale
  const roll = rand()
  const daysAgo = roll < 0.4 ? int(0, 7) : roll < 0.7 ? int(8, 30) : roll < 0.9 ? int(31, 90) : int(91, 420)
  const lastActiveAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  const createdAt = new Date(Date.now() - int(30, 700) * 24 * 60 * 60 * 1000)

  return {
    email: `talent${String(idx + 1).padStart(3, '0')}.${name.toLowerCase().replace(/[^a-z]+/g, '.')}@synthetic.seewee.test`,
    password: null as string | null, // synthetic profiles cannot log in
    name,
    role: 'CANDIDATE',
    phone: `+919${String(int(100000000, 999999999))}`,
    headline: `${designation} · ${skills[0]} · ${experienceYears} yrs`,
    location: city,
    company: currentEmployer, // public-facing company field (kept in sync)
    skills: allSkills.join(', '),
    experienceYears,
    currentSalary,
    expectedSalary,
    education: `${degree}, ${institute}`,
    resumeText,
    avatarSeed: `${pick(AVATAR_SEED_WORDS)}-${idx}`,
    noticePeriodDays,
    profileVisible: rand() > 0.04, // ~4% keep their profile hidden (privacy testing)
    currentEmployer,
    desiredRole: designation,
    desiredLocations: [city, ...preferred].join(', '),
    desiredJobType: pick(['Full-time', 'Full-time', 'Contract', 'Part-time']),
    desiredIndustry: track.industry,
    functionalArea: track.functionalArea,
    industry: track.industry,
    employmentTypePref: pick(['Full-time', 'Full-time', 'Contract', 'Part-time']),
    preferredLocations: preferred.join(', '),
    languages: languages.join(', '),
    lastActiveAt,
    profileSource: 'SYNTHETIC_SEED',
    createdAt,
    updatedAt: lastActiveAt,
    cvFileName: null as string | null,
    workExperiences: {
      create: jobs.map((j) => ({
        title: j.title,
        company: j.company,
        isCurrent: j.isCurrent,
        startDate: j.startDate,
        endDate: j.endDate ?? null,
        location: city,
        description: j.description,
        createdAt: createdAt,
      })),
    },
    educationEntries: {
      create: [
        {
          degree,
          institution: institute,
          startYear: String(gradYear - 4),
          endYear: String(gradYear),
          score: `${int(60, 92)}%`,
        },
      ],
    },
    certifications: {
      create: certList.map((c) => ({ name: c, issuer: track.industry, year: String(int(2015, 2024)) })),
    },
  }
}

/* --------------------------------- main ----------------------------------- */
async function main() {
  const N = 150
  console.log(`Seeding ${N} SYNTHETIC candidates (profileSource=SYNTHETIC_SEED)...`)

  // Idempotent: remove previous synthetic cohort (children cascade via FK).
  const gone = await db.user.deleteMany({ where: { profileSource: 'SYNTHETIC_SEED' } })
  if (gone.count) console.log(`  removed ${gone.count} previous synthetic profiles`)

  let created = 0
  for (let i = 0; i < N; i++) {
    const c = buildCandidate(i)
    try {
      await db.user.create({
        data: c as unknown as Parameters<typeof db.user.create>[0]['data'],
      })
      created++
    } catch (err) {
      console.error(`  ✗ failed candidate #${i + 1}:`, (err as Error).message)
    }
  }
  console.log(`Created ${created} synthetic candidates.`)

  // Demo saved searches for the primary recruiter account (ananya@technova.com)
  const recruiter = await db.user.findUnique({ where: { email: 'ananya@technova.com' } })
  if (recruiter) {
    await db.savedSearch.deleteMany({ where: { recruiterId: recruiter.id } })
    await db.savedSearch.createMany({
      data: [
        {
          recruiterId: recruiter.id,
          name: 'Senior React talent — Bengaluru/Pune',
          query: JSON.stringify({
            q: 'react AND (redux OR "next.js")',
            skillsMandatory: 'React',
            skillsPreferred: 'Redux, Next.js',
            exclude: 'intern, fresher',
            minExperience: '4', maxExperience: '12',
            locations: 'Bengaluru, Pune',
            minCTC: '', maxCTC: '',
            noticeMax: '60',
            industry: 'IT Services & Consulting',
            functionalArea: '', employmentType: '',
            education: '', institute: '', employerCurrent: '', employerPrevious: '',
            lastActiveDays: '90', updatedWithinDays: '',
            sort: 'relevance',
          }),
          alertFrequency: 'DAILY',
          lastRunAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
        },
        {
          recruiterId: recruiter.id,
          name: 'Plant maintenance (TPM/OEE) — Manufacturing',
          query: JSON.stringify({
            q: '"Maintenance Manager" OR "Plant Maintenance Head"',
            skillsMandatory: 'TPM',
            skillsPreferred: 'OEE, SAP PM',
            exclude: 'trainee, intern',
            minExperience: '8', maxExperience: '20',
            locations: '',
            minCTC: '', maxCTC: '28',
            noticeMax: '90',
            industry: 'Manufacturing & Industrial',
            functionalArea: 'Maintenance & Plant Operations',
            employmentType: 'Full-time',
            education: '', institute: '', employerCurrent: '', employerPrevious: '',
            lastActiveDays: '', updatedWithinDays: '',
            sort: 'relevance',
          }),
          alertFrequency: 'WEEKLY',
        },
      ],
    })
    console.log('Seeded 2 demo saved searches for ananya@technova.com')
  }

  const total = await db.user.count({ where: { role: 'CANDIDATE' } })
  const synth = await db.user.count({ where: { profileSource: 'SYNTHETIC_SEED' } })
  const work = await db.workExperience.count()
  const edu = await db.educationEntry.count()
  const cert = await db.certification.count()
  console.log(`✓ done. candidates=${total} (synthetic=${synth}) workExps=${work} edu=${edu} certs=${cert}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
