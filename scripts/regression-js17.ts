/* Regression for js-gaps-17: profileVisible, postedWithin, HIRED/SHARED notifications */
const BASE = 'http://localhost:3000'
let pass = 0, fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) { pass++; console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
async function j(path: string, init?: RequestInit) {
  const res = await fetch(BASE + path, init)
  let body: unknown = null
  try { body = await res.json() } catch {}
  return { status: res.status, body } as { status: number; body: never }
}

async function main() {
  console.log('== 1. profileVisible toggle ==')
  const cand = await j('/api/candidates') as never as { body: { data: Array<{ id: string; name: string; email: string; profileVisible: boolean }> } }
  const meghna = cand.body.data.find((u) => u.name === 'Meghna Pillai')!
  check('candidates list carries profileVisible=true', meghna.profileVisible === true)

  // hide her
  const hide = await j(`/api/candidates/${meghna.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileVisible: false }) })
  check('PATCH profileVisible:false → 200', hide.status === 200, `status=${hide.status}`)
  const afterHide = await j('/api/candidates') as never as { body: { data: Array<{ id: string }> } }
  check('hidden candidate excluded from talent search', !afterHide.body.data.some((u) => u.id === meghna.id), `visible=${afterHide.body.data.length}`)
  // invalid value
  const bad = await j(`/api/candidates/${meghna.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileVisible: 'yes' }) })
  check('PATCH profileVisible:"yes" → 400', bad.status === 400, `status=${bad.status}`)
  // her own profile fetch still works while hidden
  const own = await j(`/api/candidates/${meghna.id}`)
  check('hidden candidate GET by id still 200', own.status === 200)
  // restore
  const show = await j(`/api/candidates/${meghna.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileVisible: true }) })
  const afterShow = await j('/api/candidates') as never as { body: { data: Array<{ id: string }> } }
  check('PATCH profileVisible:true restores visibility', show.status === 200 && afterShow.body.data.some((u) => u.id === meghna.id))

  console.log('== 2. postedWithin freshness filter ==')
  const all = await j('/api/jobs?limit=100') as never as { body: { data: { total: number } } }
  const d3 = await j('/api/jobs?limit=100&postedWithin=3') as never as { body: { data: { total: number; jobs: Array<{ createdAt: string }> } } }
  const d30 = await j('/api/jobs?limit=100&postedWithin=30') as never as { body: { data: { total: number } } }
  check('postedWithin=3 returns <= postedWithin=30 <= all', d3.body.data.total <= d30.body.data.total && d30.body.data.total <= all.body.data.total, `3d=${d3.body.data.total} 30d=${d30.body.data.total} all=${all.body.data.total}`)
  const cutoff = Date.now() - 3 * 24 * 3600 * 1000
  check('all 3d jobs created within 3 days', d3.body.data.jobs.every((jj) => new Date(jj.createdAt).getTime() >= cutoff))
  const badf = await j('/api/jobs?limit=5&postedWithin=-5') as never as { body: { data: { total: number } } }
  check('postedWithin=-5 treated as no filter', badf.body.data.total === all.body.data.total, `${badf.body.data.total} vs ${all.body.data.total}`)

  console.log('== 3. currentSalary PATCH (profile form parity) ==')
  const cur = await j(`/api/candidates/${meghna.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentSalary: 14 }) })
  check('PATCH currentSalary:14 → 200', cur.status === 200, `status=${cur.status}`)
  const curBad = await j(`/api/candidates/${meghna.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentSalary: 9999 }) })
  check('PATCH currentSalary:9999 → 400 (cap 500)', curBad.status === 400)
  // restore original (was null in seed? set to 12 for Arjun-like realism — read back then null it)
  await j(`/api/candidates/${meghna.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentSalary: 11 }) })

  console.log('== 4. HIRED + SHARED_WITH_CLIENT candidate notifications ==')
  // Meghna applies to a job (throwaway) → walk the pipeline → verify notifications → cleanup
  const jobs = await j('/api/jobs?limit=50') as never as { body: { data: { jobs: Array<{ id: string; title: string; recruiterId: string }> } } }
  const job = jobs.body.data.jobs.find((jj) => jj.title === 'Staff Frontend Engineer') ?? jobs.body.data.jobs.find((jj) => jj.title !== 'Senior Python Engineer')!
  const apply = await j('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: job.id, candidateId: meghna.id }) })
  check('throwaway application created', apply.status === 200 || apply.status === 201, `status=${apply.status}`)
  const appBody = apply.body as never as { data?: { id: string }; error?: string }
  const appId = appBody.data?.id
  if (appId) {
    const shared = await j(`/api/applications/${appId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'SHARED_WITH_CLIENT' }) })
    check('PATCH → SHARED_WITH_CLIENT 200', shared.status === 200, `status=${shared.status}`)
    const hired = await j(`/api/applications/${appId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'HIRED' }) })
    check('PATCH → HIRED 200', hired.status === 200, `status=${hired.status}`)
    // notifications arrive async (void notify) — small wait
    await new Promise((r) => setTimeout(r, 600))
    const notifs = await j(`/api/notifications?userId=${meghna.id}&limit=10`) as never as { body: { data?: { notifications?: Array<{ title: string }> } } }
    const titles = notifs.body.data?.notifications?.map((n) => n.title) ?? []
    check('offer notification delivered', titles.some((t) => t.includes('🎉 Offer received')), titles.slice(0, 2).join(' | '))
    check('shared-with-client notification delivered', titles.some((t) => t.includes('📤 Shared with client')))
  } else {
    check('application id present', false, appBody.error ?? 'no id')
  }
  console.log(`RESULT: ${pass} pass / ${fail} fail`)
  if (fail > 0) process.exit(1)
}
main().catch((e) => { console.error('SCRIPT ERROR', e); process.exit(1) })
