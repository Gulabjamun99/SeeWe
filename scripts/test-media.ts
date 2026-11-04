// Throwaway E2E harness for interview-media (run: bun scripts/test-media.ts)
import { PrismaClient } from '@prisma/client'
import { unlink } from 'node:fs/promises'
import path from 'node:path'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'

// Minimal but valid EBML/webm header (MediaRecorder emits files starting with these bytes)
const ebmlHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
const fakeVideo = Buffer.concat([ebmlHeader, Buffer.alloc(2048, 0x42)])

async function main() {
  // 1) Seed throwaway chain: user -> application -> shortlist -> interview
  const user = await db.user.create({
    data: {
      email: `media-e2e-${Date.now()}@test.local`,
      name: 'Media E2E',
      role: 'CANDIDATE',
    },
  })
  const job = await db.job.findFirst()
  if (!job) throw new Error('no job seeded')
  const app = await db.application.create({
    data: { jobId: job.id, candidateId: user.id, status: 'INTERVIEWED' },
  })
  const shortlist = await db.shortlist.create({
    data: { applicationId: app.id, status: 'INTERVIEW_IN_PROGRESS' },
  })
  const interview = await db.interview.create({
    data: {
      shortlistId: shortlist.id,
      candidateName: 'Media E2E',
      jobTitle: job.title,
      domain: 'QA',
      status: 'IN_PROGRESS',
      startedAt: new Date(),
      questions: JSON.stringify([
        {
          qIndex: 0,
          question: 'What is a test automation pyramid?',
          focusArea: 'QA strategy',
          modelAnswerPoints: ['unit heavy', 'integration middle', 'e2e top'],
        },
      ]),
    },
  })
  console.log('SEEDED interview', interview.id)

  // 2) Submit an answer WITH video media
  const b64 = `data:video/webm;base64,${fakeVideo.toString('base64')}`
  const res = await fetch(`${BASE}/api/interview/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      interviewId: interview.id,
      qIndex: 0,
      transcript: 'The test automation pyramid has many unit tests at the base.',
      audioPresent: true,
      media_base64: b64,
      mediaSeconds: 42.3,
    }),
  })
  const json = await res.json()
  const ans = json?.data
  console.log('ANSWER STATUS', res.status, 'mediaPath=', ans?.mediaPath, 'kind=', ans?.mediaKind, 'secs=', ans?.mediaSeconds)

  // 3) Stream it back: full GET + Range GET
  if (ans?.mediaPath) {
    const full = await fetch(`${BASE}/api/interview/media/${ans.mediaPath}`)
    console.log('FULL GET', full.status, full.headers.get('content-type'), full.headers.get('accept-ranges'), 'len=', full.headers.get('content-length'))

    const rng = await fetch(`${BASE}/api/interview/media/${ans.mediaPath}`, {
      headers: { Range: 'bytes=100-199' },
    })
    console.log('RANGE GET', rng.status, rng.headers.get('content-range'), 'len=', rng.headers.get('content-length'))

    const trav = await fetch(`${BASE}/api/interview/media/..%2F..%2Fpackage.json`)
    console.log('TRAVERSAL GET (want 400/404)', trav.status)

    const missing = await fetch(`${BASE}/api/interview/media/nonexistent-q0-1.webm`)
    console.log('MISSING GET (want 404)', missing.status)
  }

  // 4) Transcript payload carries media fields
  const t = await fetch(`${BASE}/api/interview/${interview.id}`)
  const tj = await t.json()
  const a0 = tj?.data?.answers?.[0]
  console.log('TRANSCRIPT ANSWER media:', a0?.mediaPath, a0?.mediaKind, a0?.mediaSeconds)

  // 5) Cleanup: cascade deletes interview/answer/shortlist/application/user; remove file
  const mediaFile = a0?.mediaPath
  await db.user.delete({ where: { id: user.id } })
  if (mediaFile) {
    await unlink(path.join(process.cwd(), 'upload', 'interview-media', mediaFile)).catch(() => {})
  }
  console.log('CLEANED UP')
}

main()
  .catch((e) => {
    console.error('E2E FAILED:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
