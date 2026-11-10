import test from 'node:test'
import assert from 'node:assert/strict'

localStorage.setItem('gridwitness.cases.backend.v1', JSON.stringify([{
  caseType: 'IOT', id: 'GW-IOT-LEGACY', title: '이전 브라우저의 현장 기록', createdAt: '2026-11-09T00:00:00Z', stage: 'REVIEWED',
  device: { deviceId: 'uno', scope: '마을 전체' }, window: [{ t: 1, i: 0.1, v: 5 }], diagnosis: { status: 'ACCEPTED' }, detection: { findings: ['실측'] }, reviews: [{ reviewer: '작업자' }], history: [],
}]))
const { backendApi } = await import('../src/api/backend.ts')
const { setApiBase } = await import('../src/lib/backend.ts')

test('existing local IoT case survives scoped cache migration without appearing on another server', async () => {
  const local = await backendApi.getCase('GW-IOT-LEGACY')
  assert.equal(local.title, '이전 브라우저의 현장 기록')
  assert.equal(local.reviews[0].reviewer, '작업자')
  setApiBase('https://other-cache-server.example')
  await assert.rejects(() => backendApi.getCase('GW-IOT-LEGACY'), /찾지 못|기록/)
})
