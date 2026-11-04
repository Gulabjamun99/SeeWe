// READ-ONLY DB audit for SeeWe portal — never writes, never deletes.
import { Database } from 'bun:sqlite'

const db = new Database('/home/z/my-project/db/custom.db', { readonly: true })

const q = (label: string, sql: string) => {
  try {
    const rows = db.prepare(sql).all()
    console.log(`\n== ${label} ==`)
    console.log(JSON.stringify(rows))
  } catch (e) {
    console.log(`\n== ${label} == ERROR: ${String(e)}`)
  }
}

console.log('== ALL TABLES ==')
console.log(JSON.stringify(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all()))

q('Users by role (incl disabled count)',
  `SELECT role, COUNT(*) AS n, SUM(CASE WHEN disabled=1 THEN 1 ELSE 0 END) AS disabledCount,
          SUM(CASE WHEN password IS NOT NULL AND password != '' THEN 1 ELSE 0 END) AS withPassword
   FROM "User" GROUP BY role ORDER BY role`)

q('Demo accounts (role/email/name only)',
  `SELECT role, email, name, disabled FROM "User" ORDER BY role, email LIMIT 60`)

q('Jobs by status', `SELECT status, COUNT(*) AS n FROM "Job" GROUP BY status`)
q('Jobs sample', `SELECT id, title, company, status, experienceMin, experienceMax FROM "Job" LIMIT 10`)
q('Jobs with AI config', `SELECT COUNT(*) AS n FROM "Job" WHERE aiInterviewConfig IS NOT NULL AND aiInterviewConfig != ''`)

q('Applications by status', `SELECT status, COUNT(*) AS n FROM "Application" GROUP BY status`)
q('Shortlists by status', `SELECT status, COUNT(*) AS n FROM "Shortlist" GROUP BY status`)
q('Shortlist client decisions', `SELECT clientDecision, COUNT(*) AS n FROM "Shortlist" GROUP BY clientDecision`)
q('Interviews by status', `SELECT status, COUNT(*) AS n FROM "Interview" GROUP BY status`)
q('Answers recorded', `SELECT COUNT(*) AS n FROM "Answer"`)
q('Mock interviews', `SELECT COUNT(*) AS n FROM "MockInterview"`)

q('EmailLog by kind', `SELECT kind, COUNT(*) AS n FROM "EmailLog" GROUP BY kind`)
q('Notifications', `SELECT COUNT(*) AS n FROM "Notification"`)
q('AuthChallenge by type', `SELECT type, COUNT(*) AS n FROM "AuthChallenge" GROUP BY type`)
q('Clients', `SELECT id, name, contactEmail FROM "Client" LIMIT 10`)
q('ATS integrations', `SELECT id, name, active FROM "AtsIntegration"`)
q('ATS push logs', `SELECT COUNT(*) AS n FROM "AtsPushLog"`)
q('Job alerts', `SELECT COUNT(*) AS n FROM "JobAlert"`)
q('Saved jobs', `SELECT COUNT(*) AS n FROM "SavedJob"`)
q('Job reports (moderation)', `SELECT status, COUNT(*) AS n FROM "JobReport" GROUP BY status`)
q('Requisitions', `SELECT status, COUNT(*) AS n FROM "Requisition" GROUP BY status`)
q('Profile sections counts',
  `SELECT
     (SELECT COUNT(*) FROM "WorkExperience") AS experiences,
     (SELECT COUNT(*) FROM "UserProject") AS projects,
     (SELECT COUNT(*) FROM "EducationEntry") AS education,
     (SELECT COUNT(*) FROM "Certification") AS certifications`)
q('Assessment attempts', `SELECT COUNT(*) AS n FROM "AssessmentAttempt"`)
q('Skill badges', `SELECT COUNT(*) AS n FROM "SkillBadge"`)
q('Messages', `SELECT COUNT(*) AS n FROM "Message"`)
q('Folder + members',
  `SELECT (SELECT COUNT(*) FROM "CandidateFolder") AS folders,
          (SELECT COUNT(*) FROM "CandidateFolderMember") AS folderMembers`)
q('Consent records', `SELECT COUNT(*) AS n FROM "ConsentRecord"`)

db.close()
console.log('\n[audit-db-readonly done — no writes performed]')
