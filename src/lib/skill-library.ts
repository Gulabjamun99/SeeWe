/**
 * SeeWe skill library — the app serves EVERY hiring domain, not just IT.
 *
 * Each domain carries:
 *  - a short label + emoji for the picker chips
 *  - lowercase `keywords` used to AUTO-DETECT the domain from the job title /
 *    description as the recruiter types (staff nurse → Healthcare, accountant
 *    → Finance, sales manager → Sales …)
 *  - a curated, India-market-flavoured skill set offered as one-tap chips
 *
 * `detectSkillDomain` scores every domain by counting keyword hits and returns
 * the best match (null when nothing matches). The UI defaults to Auto mode and
 * lets the recruiter override with a manual domain pick.
 */

export interface SkillDomain {
  id: string
  label: string
  emoji: string
  keywords: string[]
  skills: string[]
}

export const SKILL_DOMAINS: SkillDomain[] = [
  {
    id: 'it',
    label: 'IT & Software',
    emoji: '💻',
    keywords: [
      'developer', 'engineer', 'software', 'react', 'frontend', 'back end', 'backend',
      'full stack', 'fullstack', 'node', 'java', 'python', 'android', 'ios',
      'mobile app', 'web', 'programmer', 'sde', 'devops', 'qa', 'tester', 'testing',
      'php', '.net', 'laravel', 'react native', 'flutter', 'app developer',
    ],
    skills: [
      'React', 'Node.js', 'TypeScript', 'Python', 'Java', 'SQL', 'AWS', 'Docker',
      'Kubernetes', 'Git', 'REST APIs', 'Flutter', 'React Native', 'MongoDB',
      'PHP', '.NET', 'CI/CD', 'Linux', 'Next.js', 'Jest',
    ],
  },
  {
    id: 'data',
    label: 'Data & AI',
    emoji: '📊',
    keywords: [
      'data', 'analyst', 'analytics', 'machine learning', 'ai', 'data science',
      'business intelligence', 'bi ', 'deep learning', 'nlp', 'statistic',
      'data engineer', 'data entry',
    ],
    skills: [
      'SQL', 'Python', 'Pandas', 'Power BI', 'Tableau', 'Excel', 'Machine Learning',
      'Statistics', 'Data Visualization', 'ETL', 'R', 'Spark', 'Data Cleaning',
      'Google Analytics', 'Reporting',
    ],
  },
  {
    id: 'design',
    label: 'Design & Creative',
    emoji: '🎨',
    keywords: [
      'designer', 'design', 'ui', 'ux', 'graphic', 'creative', 'illustrator',
      'video editor', 'video editing', 'animation', 'branding', 'artist', 'photo',
    ],
    skills: [
      'Figma', 'Adobe Photoshop', 'Adobe Illustrator', 'UI Design', 'UX Research',
      'Wireframing', 'Prototyping', 'Graphic Design', 'Video Editing',
      'Motion Graphics', 'Canva', 'Adobe XD', 'Typography', 'Branding',
      'After Effects',
    ],
  },
  {
    id: 'marketing',
    label: 'Marketing & Content',
    emoji: '📣',
    keywords: [
      'marketing', 'seo', 'digital marketing', 'content', 'social media', 'growth',
      'brand', 'copywriter', 'copywriting', 'ads', 'ppc', 'communications', 'pr ',
      'campaign',
    ],
    skills: [
      'SEO', 'Google Ads', 'Meta Ads', 'Content Writing', 'Social Media Marketing',
      'Email Marketing', 'Copywriting', 'Google Analytics', 'Canva',
      'Influencer Marketing', 'Keyword Research', 'Marketing Strategy',
      'Landing Pages', 'A/B Testing', 'CRM',
    ],
  },
  {
    id: 'sales',
    label: 'Sales & BD',
    emoji: '🤝',
    keywords: [
      'sales', 'business development', 'bd ', 'account manager', 'telecaller',
      'telecalling', 'telesales', 'inside sales', 'field sales', 'bde', 'bdm',
      'presales', 'pre sales',
    ],
    skills: [
      'Lead Generation', 'B2B Sales', 'Cold Calling', 'Negotiation', 'CRM',
      'Salesforce', 'Zoho CRM', 'Key Account Management', 'Client Relationship',
      'Pipeline Management', 'Quotations', 'Market Research', 'Follow-ups',
      'Closing Deals', 'Territory Management',
    ],
  },
  {
    id: 'finance',
    label: 'Finance & Accounts',
    emoji: '💰',
    keywords: [
      'accountant', 'accounts', 'finance', 'auditor', 'audit', 'tax', 'ca ', 'icwa',
      'bookkeeper', 'bookkeeping', 'tally', 'banking', 'investment', 'treasury',
      'cashier',
    ],
    skills: [
      'Tally', 'GST Filing', 'Bookkeeping', 'Accounts Payable',
      'Accounts Receivable', 'Financial Modeling', 'Excel', 'Auditing',
      'Income Tax', 'Balance Sheet', 'SAP FICO', 'Budgeting', 'MIS Reports',
      'Reconciliation', 'Banking Operations',
    ],
  },
  {
    id: 'hr',
    label: 'HR & Admin',
    emoji: '🧑‍💼',
    keywords: [
      'hr ', 'human resource', 'recruiter', 'recruitment', 'talent', 'payroll',
      'admin', 'administration', 'people ops', 'hiring', 'office manager',
    ],
    skills: [
      'Recruitment', 'Onboarding', 'Payroll Processing', 'HRMS',
      'Employee Engagement', 'Performance Management', 'Labour Laws',
      'Screening & Interviewing', 'Office Administration', 'Excel',
      'Leave Management', 'Training Coordination', 'Grievance Handling',
      'Documentation', 'MS Office',
    ],
  },
  {
    id: 'ops',
    label: 'Operations & Supply Chain',
    emoji: '📦',
    keywords: [
      'operations', 'supply chain', 'logistics', 'warehouse', 'inventory',
      'procurement', 'purchase', 'store keeper', 'storekeeper', 'production',
      'dispatch', 'delivery', 'fleet', 'driver',
    ],
    skills: [
      'Inventory Management', 'Logistics Coordination', 'Procurement',
      'Vendor Management', 'Warehouse Management', 'SAP MM',
      'Supply Chain Planning', 'Six Sigma', 'Demand Forecasting',
      'Fleet Management', 'Quality Checks', 'ERP', 'Store Management',
      'Route Planning', 'Excel',
    ],
  },
  {
    id: 'healthcare',
    label: 'Healthcare & Pharma',
    emoji: '🏥',
    keywords: [
      'nurse', 'nursing', 'doctor', 'medical', 'hospital', 'pharma', 'pharmacist',
      'physio', 'clinic', 'lab technician', 'healthcare', 'patient', 'mbbs',
      'gnm', 'anm', 'dental', 'ayurveda',
    ],
    skills: [
      'Patient Care', 'Nursing Procedures', 'Medication Administration',
      'Medical Coding', 'Phlebotomy', 'Physiotherapy', 'Pharmacy Dispensing',
      'Clinical Documentation', 'BLS/CPR', 'Lab Testing', 'Patient Counseling',
      'ICU Care', 'Infection Control', 'Medical Records', 'Vital Monitoring',
    ],
  },
  {
    id: 'education',
    label: 'Education & Training',
    emoji: '🎓',
    keywords: [
      'teacher', 'teaching', 'tutor', 'faculty', 'professor', 'trainer',
      'training', 'education', 'school', 'academic', 'coaching', 'lecturer',
      'principal', 'nursery',
    ],
    skills: [
      'Lesson Planning', 'Classroom Management', 'Curriculum Design',
      'Student Assessment', 'Online Teaching', 'Subject Expertise',
      'Corporate Training', 'Mentoring', 'Parent Communication',
      'E-learning Tools', 'Smartboard Teaching', 'Career Counseling',
      'Activity Planning', 'Discipline Handling',
    ],
  },
  {
    id: 'hospitality',
    label: 'Hospitality & Retail',
    emoji: '🍽️',
    keywords: [
      'hotel', 'chef', 'cook', 'waiter', 'restaurant', 'hospitality',
      'front office', 'housekeeping', 'retail', 'sales associate', 'mall',
      'cabin crew', 'flight attendant', 'travel', 'barista', 'steward',
    ],
    skills: [
      'Customer Service', 'F&B Service', 'Front Office Operations',
      'Housekeeping', 'Food Preparation', 'Cash Handling', 'POS Systems',
      'Merchandising', 'Inventory Count', 'Guest Relations',
      'Reservation Handling', 'Upselling', 'Hygiene & Safety', 'Billing',
      'Table Service',
    ],
  },
  {
    id: 'core',
    label: 'Manufacturing & Core Engineering',
    emoji: '🏭',
    keywords: [
      'mechanical', 'civil', 'electrical', 'autocad', 'factory', 'technician',
      'maintenance', 'fitter', 'welder', 'electrician', 'site engineer',
      'quality control', 'qc ', 'production engineer', 'plant', 'foreman',
    ],
    skills: [
      'AutoCAD', 'Quality Control', 'CNC Operation', 'Maintenance & Repair',
      'Electrical Wiring', 'Mechanical Fitting', 'Welding', 'Site Supervision',
      'Safety Compliance', 'Blueprint Reading', 'Production Planning',
      'ISO Standards', 'Testing & Inspection', 'Preventive Maintenance',
      'Hand & Power Tools',
    ],
  },
  {
    id: 'legal',
    label: 'Legal & Compliance',
    emoji: '⚖️',
    keywords: [
      'legal', 'advocate', 'lawyer', 'attorney', 'compliance',
      'company secretary', ' paralegal', 'contract', 'litigation', 'judicial',
    ],
    skills: [
      'Contract Drafting', 'Legal Research', 'Compliance Management',
      'Corporate Law', 'Due Diligence', 'Litigation Support', 'IPR',
      'Labour Law', 'Legal Notices', 'Documentation', 'Regulatory Filings',
      'Risk Assessment', 'Court Representation', 'Negotiation',
    ],
  },
  {
    id: 'general',
    label: 'General & Soft Skills',
    emoji: '🧩',
    keywords: ['helper', 'assistant', 'office boy', 'peon', 'receptionist', 'data entry operator', 'executive'],
    skills: [
      'Communication', 'MS Office', 'Team Management', 'Time Management',
      'Problem Solving', 'English Proficiency', 'Multitasking', 'Leadership',
      'Attention to Detail', 'Customer Handling', 'Reporting',
      'Email Etiquette', 'Telephone Handling', 'Basic Computers', 'Hindi Typing',
    ],
  },
]

const DEFAULT_DOMAIN_ID = 'general'

function countHits(haystack: string, keyword: string): number {
  // Word-boundary match so 'hr ' does not fire inside 'three'; cap per-keyword
  // hits at 2 so one repeated word cannot dominate the score.
  const pattern = new RegExp(`\\b${keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')
  return Math.min(2, (haystack.match(pattern) ?? []).length)
}

/**
 * Auto-detect the hiring domain from free text (job title + description).
 * Returns the best-scoring domain, or null when nothing matches.
 */
export function detectSkillDomain(text: string): SkillDomain | null {
  const hay = ` ${text.toLowerCase()} `
  let best: SkillDomain | null = null
  let bestScore = 0
  for (const domain of SKILL_DOMAINS) {
    let score = 0
    for (const kw of domain.keywords) score += countHits(hay, kw)
    if (score > bestScore) {
      bestScore = score
      best = domain
    }
  }
  return bestScore > 0 ? best : null
}

export function getSkillDomain(id: string): SkillDomain {
  return SKILL_DOMAINS.find((d) => d.id === id) ?? SKILL_DOMAINS.find((d) => d.id === DEFAULT_DOMAIN_ID)!
}
