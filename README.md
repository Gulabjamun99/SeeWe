# SeeWe — Universal AI Recruitment Portal

Full-stack AI hiring portal built with **Next.js 16 (App Router) + TypeScript + Prisma (SQLite) + Tailwind CSS 4 + shadcn/ui**.

Serves 4 role experiences: **Candidate**, **Recruiter**, **Client**, and **Admin**.

---

## Quick Start (Cloud & Local)

> Requirements: **Node.js 20+** with npm or pnpm.

```bash
# 1. Clone repository
git clone <your-repo-url>
cd SeeWe

# 2. Copy environment file
cp .env.example .env

# 3. Install dependencies (Prisma client auto-generates on postinstall)
npm install

# 4. Start the dev server
npm run dev

# 5. Open the app
# http://localhost:3000
```

The **database ships pre-seeded** (`db/custom.db`) with 160+ candidates (full CVs), jobs, applications, AI interview recordings, transcripts, talent ads, and requisitions.

---

## Universal AI Configuration

SeeWe is engineered to run seamlessly across all environments:

1. **Zero-Config Smart Fallback (Default)**:
   Runs 100% out-of-the-box without requiring any API keys. Generates realistic contextual interview questions, scoring, and evaluations offline.
2. **Google Gemini (Recommended Free Tier)**:
   Add to `.env`:
   ```env
   GEMINI_API_KEY="your-gemini-api-key"
   GEMINI_MODEL="gemini-1.5-flash"
   ```
3. **OpenAI / Groq / Compatible**:
   Add to `.env`:
   ```env
   OPENAI_API_KEY="your-openai-api-key"
   OPENAI_MODEL="gpt-4o-mini"
   ```

---

## Demo Accounts (Passwordless Demo Login)

Pick a role on the login screen and use one of these emails:

| Role      | Email                                                            |
| --------- | ---------------------------------------------------------------- |
| Recruiter | `ananya@technova.com` (TechNova Solutions)                       |
| Recruiter | `rahul@cloudnine.com`, `priya@dataforge.com`                     |
| Client    | `partnerships@flipkart-demo.com`                                 |
| Admin     | `admin@seewee.ai`                                                |
| Candidate | `arjun.mehta@gmail.com` — or **Sign Up** as a new candidate      |

---

## Core Features

- **Talent Search (Recruiter)**: Full CV search across 11 fields, Boolean search (OR / AND / NOT / quotes), AI JD-driven matching with 3-gate scoring, and highlighted CV snippet evidence.
- **AI Video Interview Room**: Pre-interview device check (camera / mic / speaker), TTS-read questions with barge-in detection, audio recording + transcription, question-by-question scoring, and final advisory evaluation report.
- **Client Portal**: Shortlisted candidate dossiers, shared interview recordings & transcripts, hiring feedback.
- **Candidate Hub**: Job search, ATS resume matching, profile builder, resume versions, and video resume.
- **ATS Hub**: Integrations, sync, push payloads, and webhook support.
- **Admin**: User management, platform analytics, job moderation.

---

## Project Structure

```
src/app            → App router pages + 70+ REST API endpoints
src/components     → shadcn/ui primitives + SeeWe role modules
src/lib            → Universal AI client, search engine, auth, media utils
src/store          → Zustand application store
prisma/            → schema.prisma (SQLite database schema)
db/custom.db       → Pre-seeded database with 160+ candidates
scripts/           → Maintenance & database seed scripts
docs/              → Flowcharts and architecture manual
```
