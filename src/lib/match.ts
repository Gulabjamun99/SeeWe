// SeeWe - Skill match scoring helper
// Computes a 0-100 % overlap between a job's skills CSV and a candidate's skills CSV.
// Case-insensitive, whitespace-tolerant, duplicate-safe (uses sets).

function parseSkills(csv?: string | null): string[] {
  if (!csv) return []
  return csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
}

/**
 * Returns the percentage (0-100) of the job's required skills that the
 * candidate covers, or null when either side has no skills.
 */
export function computeMatchScore(
  jobSkillsCsv: string,
  candidateSkillsCsv?: string | null
): number | null {
  const jobSkills = parseSkills(jobSkillsCsv)
  const candidateSkills = parseSkills(candidateSkillsCsv)
  if (jobSkills.length === 0 || candidateSkills.length === 0) return null

  const jobSet = new Set(jobSkills)
  const candidateSet = new Set(candidateSkills)
  let matched = 0
  for (const skill of jobSet) {
    if (candidateSet.has(skill)) matched++
  }
  return Math.round((matched / jobSet.size) * 100)
}
