/**
 * seed-candidate-cvs.ts — generate simple one-page PDF CVs for every
 * synthetic candidate that has no CV attached.
 *
 * ⚠️  DATA LINEAGE: same synthetic seed universe as seed-talent-db.ts —
 * these PDFs are generated FROM the synthetic profile data already in the
 * database (never real people). They make the recruiter-side CV download
 * flow demonstrable end-to-end.
 *
 * Idempotent: only touches User rows where cvFileName IS NULL.
 *
 * PDF generation is hand-rolled (no dependency): a minimal single-page PDF
 * with Helvetica text lines — valid enough for browsers and PDF viewers.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/* ── minimal PDF writer ─────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

interface PdfLine {
  text: string
  bold?: boolean
  size?: number
  gapAfter?: number
}

/** Build a valid one-page A4-ish PDF from wrapped text lines. */
function buildPdf(lines: PdfLine[]): Buffer {
  const content: string[] = ['BT']
  let y = 800
  for (const l of lines) {
    const size = l.size ?? 10
    const font = l.bold ? '/F2' : '/F1'
    content.push(`${font} ${size} Tf`)
    content.push(`1 0 0 1 50 ${y} Tm`)
    content.push(`(${esc(l.text)}) Tj`)
    y -= (l.gapAfter ?? 6) + size
    if (y < 50) break
  }
  content.push('ET')
  const stream = content.join('\n')

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, i) => {
    offsets.push(pdf.length)
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(pdf, 'latin1')
}

/* ── CV content from the synthetic profile ──────────────────────────────── */

function wrap(text: string, max = 92): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > max) {
      if (line) out.push(line.trim())
      line = w
    } else {
      line = (line + ' ' + w).trim()
    }
  }
  if (line) out.push(line.trim())
  return out
}

interface CandidateRow {
  id: string
  name: string
  headline: string | null
  location: string | null
  skills: string | null
  experienceYears: number | null
  education: string | null
  resumeText: string | null
  email: string
  workExperiences: { title: string; company: string; isCurrent: boolean }[]
}

function cvLines(c: CandidateRow): PdfLine[] {
  const lines: PdfLine[] = [
    { text: c.name, bold: true, size: 20, gapAfter: 2 },
    { text: c.headline || 'Professional', size: 11, gapAfter: 4 },
    {
      text: [c.location, c.experienceYears !== null ? `${c.experienceYears} yrs experience` : null]
        .filter(Boolean)
        .join('  ·  '),
      size: 9,
      gapAfter: 12,
    },
    { text: 'SKILLS', bold: true, size: 11, gapAfter: 4 },
    ...wrap((c.skills || '').split(',').map((s) => s.trim()).filter(Boolean).join('  ·  ')).map(
      (t) => ({ text: t, size: 9, gapAfter: 3 })
    ),
    { text: '', gapAfter: 8 },
    { text: 'WORK EXPERIENCE', bold: true, size: 11, gapAfter: 4 },
  ]
  for (const w of c.workExperiences.slice(0, 5)) {
    lines.push({ text: `${w.title} — ${w.company}${w.isCurrent ? ' (current)' : ''}`, size: 9.5, bold: true, gapAfter: 2 })
  }
  if (c.workExperiences.length === 0 && c.resumeText) {
    lines.push(...wrap(c.resumeText.split('\n')[0] || '').slice(0, 2).map((t) => ({ text: t, size: 9 })))
  }
  lines.push({ text: '', gapAfter: 8 })
  if (c.education) {
    lines.push({ text: 'EDUCATION', bold: true, size: 11, gapAfter: 4 })
    lines.push(...wrap(c.education).slice(0, 2).map((t) => ({ text: t, size: 9, gapAfter: 3 })))
    lines.push({ text: '', gapAfter: 8 })
  }
  lines.push({ text: 'Summary', bold: true, size: 11, gapAfter: 4 })
  if (c.resumeText) {
    lines.push(...wrap(c.resumeText.replace(/\s+/g, ' ')).slice(0, 14).map((t) => ({ text: t, size: 9, gapAfter: 3 })))
  }
  lines.push({ text: '', gapAfter: 6 })
  lines.push({ text: 'Generated for the SeeWe synthetic demo database — not a real person.', size: 7.5 })
  return lines
}

/* ── main ────────────────────────────────────────────────────────────────── */

function slug(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function main() {
  const candidates = (await prisma.user.findMany({
    where: { role: 'CANDIDATE', cvFileName: null },
    select: {
      id: true,
      name: true,
      headline: true,
      location: true,
      skills: true,
      experienceYears: true,
      education: true,
      resumeText: true,
      email: true,
      workExperiences: { select: { title: true, company: true, isCurrent: true } },
    },
  })) as CandidateRow[]

  console.log(`[seed-candidate-cvs] generating CVs for ${candidates.length} candidates…`)
  let n = 0
  for (const c of candidates) {
    const pdf = buildPdf(cvLines(c))
    const fileName = `${slug(c.name)}-CV.pdf`
    await prisma.user.update({
      where: { id: c.id },
      data: {
        cvFileName: fileName,
        cvMimeType: 'application/pdf',
        cvData: pdf.toString('base64'),
        cvUploadedAt: new Date(),
      },
    })
    n++
  }
  console.log(`[seed-candidate-cvs] attached generated PDF CVs to ${n} candidates.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => void prisma.$disconnect())
