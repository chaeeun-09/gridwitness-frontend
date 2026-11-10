import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { backendApi, clearBackendCache } from '../src/api/backend.ts'
import { setApiBase } from '../src/lib/backend.ts'
import { toComtrade } from '../src/lib/comtrade.ts'

const csv = 'Ia,Ic,Va,Vb,Vc\n' + Array.from({ length: 512 }, (_, i) => [i, i + 1, i + 2, i + 3, i + 4].join(',')).join('\n')
const digest = createHash('sha256').update(csv).digest('hex')
const incident = { incident_id: 'abcd1234-server-case', title: '공유 제목', original_filename: 'ru.csv', sha256: digest, source: 'public-dataset', dataset_id: 'RU', sampling_rate_hz: 1600, system_frequency_hz: 50, status: 'analysis_completed', created_at: '2026-11-10T01:00:00Z', label_meaning: 'NORMAL/SWITCHING/ABNORMAL/FAULT', provenance: { channelOrder: ['Ia', 'Ic', 'Va', 'Vb', 'Vc'] } }
let items = [incident]
let label = 'FAULT'
let reviews = []
let unavailable = false
let upload
let rejected = false
const village = new Map()
const ok = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
globalThis.fetch = async (input, init = {}) => {
  const url = String(input)
  if (url.includes('/data/xiong/')) return new Response(await readFile(new URL('../public/data/xiong/' + url.split('/').at(-1), import.meta.url)))
  if (unavailable) return okError('일시 장애', 503)
  if (url.endsWith('/health')) return ok({ status: 'ok' })
  if (url.includes('/village/records') && init.method === 'PUT') {
    const body = JSON.parse(init.body)
    const record = { record_id: url.split('/').at(-1), ...body, created_at: incident.created_at, updated_at: incident.created_at }
    village.set(record.record_id, record)
    return ok(record)
  }
  if (url.includes('/village/records')) return ok({ items: [...village.values()], total_count: village.size })
  if (/\/incidents\?/.test(url)) return ok({ items, total_count: items.length, per_page: 100 })
  if (url.endsWith('/incidents') && init.method === 'POST') { upload = init.body; return ok({ incident_id: incident.incident_id, sha256: digest }) }
  if (url.endsWith('/waveform')) return new Response(rejected ? 'Ia,Ic,Va,Vb,Vc\ninvalid,1,2,3,4' : csv)
  if (url.endsWith('/validation')) return ok({ validation_id: 'val', status: rejected ? 'rejected' : 'accepted', row_count: 512, channels: ['Ia', 'Ic', 'Va', 'Vb', 'Vc'], errors: rejected ? [{ code: 'NON_NUMERIC', message: '숫자 오류' }] : [], warnings: [], fixes: [], created_at: incident.created_at })
  if (url.endsWith('/analysis') && rejected) return okError('아직 분석 없음', 404)
  if (url.endsWith('/analysis')) return ok({ analysis_id: label, analysis_status: 'completed', features: {}, classification: { label, scores: { NORMAL: label === 'NORMAL' ? 0.95 : 0.01, SWITCHING: 0.01, ABNORMAL: 0.03, FAULT: label === 'FAULT' ? 0.95 : 0.01 } }, deferred_reasons: [], model_version: 'RU-real', preprocessing_version: 'prep', created_at: incident.created_at })
  if (url.endsWith('/reviews')) return ok({ items: reviews })
  if (url.endsWith('/audit')) return ok({ events: [{ event_type: 'incident.registered', payload: { actor: '등록자' }, created_at: incident.created_at }] })
  if (url.includes('/assistant/messages')) return ok({ items: [{ message_id: 'archived-evidence', archived: true }] })
  if (url.endsWith('/field-notes')) return ok({ items: [] })
  if (url.includes('/incidents/')) return ok(items.find((i) => url.endsWith(i.incident_id)) ?? incident)
  return okError('missing ' + url, 404)
}
const okError = (message, status) => new Response(JSON.stringify({ code: 'ERROR', message }), { status, headers: { 'content-type': 'application/json' } })

test('cold server list honors completed status and server metadata', async () => {
  clearBackendCache()
  const listed = (await backendApi.listCases()).find((c) => c.id === 'GW-ABCD1234')
  assert.equal(listed.stage, 'ANALYZED')
  assert.equal(listed.title, '공유 제목')
  assert.equal(listed.needsWaveform, undefined)
})

test('returning to an existing case refreshes analysis and reviewer records', async () => {
  let c = await backendApi.getCase('GW-ABCD1234')
  assert.equal(c.analysis.kind, 'COMPLETED')
  assert.equal(c.analysis.predictedLabel, 'FAULT')
  assert.deepEqual(Object.keys(c.analysis.scores), ['NORMAL', 'SWITCHING', 'ABNORMAL', 'FAULT'])
  label = 'NORMAL'
  reviews = [{ reviewer: '다른 담당자', final_decision: 'agree', comment: '확인', created_at: incident.created_at }]
  c = await backendApi.getCase('GW-ABCD1234')
  assert.equal(c.analysis.predictedLabel, 'NORMAL')
  assert.equal(c.reviews.length, 1)
  assert.equal(c.stage, 'REVIEWED')
  assert.equal(c.history[0].actor, '등록자')
})

test('all-case export fetches waveform and records from a cold browser', async () => {
  clearBackendCache()
  const c = (await backendApi.exportCases()).find((c) => c.id === 'GW-ABCD1234')
  assert.equal(c.waveform.length, 512)
  assert.equal(c.analysis.predictedLabel, 'NORMAL')
  assert.equal(c.reviews.length, 1)
  assert.ok(c.history.length)
  assert.equal(c.serverRecords.assistantMessages.server.items[0].message_id, 'archived-evidence')
  assert.equal(Buffer.from(c.serverRecords.waveformFile.base64, 'base64').toString(), csv)
})

test('archive/list removal and API server changes cannot leak cached cases', async () => {
  items = []
  assert.equal((await backendApi.listCases()).some((c) => c.id === 'GW-ABCD1234'), false)
  items = [incident]
  await backendApi.listCases()
  setApiBase('https://another-server.example')
  items = []
  assert.equal((await backendApi.listCases()).some((c) => c.id === 'GW-ABCD1234'), false)
  setApiBase('')
  items = [incident]
})

test('upload keeps title actor label meaning and channel provenance', async () => {
  await backendApi.registerCase({ title: '제목', actor: '작업자', labelMeaning: 'RU labels', sourceType: 'PUBLIC_DATASET', datasetId: 'RU', samplingRateHz: 1600, systemFrequencyHz: 50, file: new File([csv], 'ru.csv') })
  assert.equal(upload.get('title'), '제목')
  assert.equal(upload.get('actor'), '작업자')
  assert.equal(upload.get('label_meaning'), 'RU labels')
  assert.deepEqual(JSON.parse(upload.get('provenance')).channelOrder, ['Ia', 'Ic', 'Va', 'Vb', 'Vc'])
})

test('COMTRADE upload sends both original files and per-file provenance hashes', async () => {
  const original = toComtrade(Array.from({ length: 1312 }, () => [1, 2, 3, 4, 100, 200, 300]), { station: '현장', device: '계전기', fs: 4096, lf: 50 })
  await backendApi.registerCase({ title: '원래 기록', actor: '작업자', labelMeaning: '원본 라벨', sourceType: 'FIELD_FRTU', datasetId: 'device', samplingRateHz: 4096, systemFrequencyHz: 50, file: new File([original.dat], 'field.dat'), cfg: new File([original.cfg], 'field.cfg') })
  assert.equal(await upload.get('original_cfg').text(), original.cfg)
  assert.equal(await upload.get('original_dat').text(), original.dat)
  const provenance = JSON.parse(upload.get('provenance'))
  assert.equal(provenance.comtrade.device, '계전기')
  assert.equal(provenance.originalFiles.find((f) => f.role === 'cfg').sha256, createHash('sha256').update(original.cfg).digest('hex'))
})

test('text CSV input is uploaded with an accepted CSV extension while preserving original provenance', async () => {
  await backendApi.registerCase({ title: '텍스트 파형', actor: '작업자', labelMeaning: 'RU labels', sourceType: 'PUBLIC_DATASET', datasetId: 'oscgrid_ru', samplingRateHz: 1600, systemFrequencyHz: 50, file: new File([csv], 'native.TXT') })
  assert.equal(upload.get('file').name, 'native.csv')
  assert.equal(await upload.get('file').text(), csv)
  assert.equal(JSON.parse(upload.get('provenance')).originalFiles[0].name, 'native.TXT')
})

test('headerless native RU input records five real channels in its source metadata', async () => {
  const c = await backendApi.registerCase({ title: '헤더 없음', actor: '작업자', labelMeaning: 'RU labels', sourceType: 'PUBLIC_DATASET', datasetId: 'oscgrid_ru', samplingRateHz: 1600, systemFrequencyHz: 50, file: new File([csv.split('\n').slice(1).join('\n')], 'native.csv') })
  assert.deepEqual(c.source.channelOrder, ['Ia', 'Ic', 'Va', 'Vb', 'Vc'])
})

test('full backup preserves rejected original bytes without pretending they are a drawable waveform', async () => {
  rejected = true
  const bad = 'Ia,Ic,Va,Vb,Vc\ninvalid,1,2,3,4'
  items = [{ ...incident, status: 'validation_rejected', sha256: createHash('sha256').update(bad).digest('hex') }]
  reviews = []
  clearBackendCache()
  try {
    const c = (await backendApi.exportCases()).find((c) => c.id === 'GW-ABCD1234')
    assert.equal(c.diagnosis.status, 'REJECTED')
    assert.equal(c.waveform, null)
    assert.equal(Buffer.from(c.serverRecords.waveformFile.base64, 'base64').toString(), bad)
  } finally { rejected = false; items = [incident] }
})

test('IoT event registration and reviewer decision persist as one shared server record', async () => {
  const event = { at: incident.created_at, source: 'MOCK', status: 'FAULT', maxScore: 0.9, expected: 0.1, relayOn: true, injected: null, window: Array.from({ length: 12 }, (_, i) => ({ t: 1000 + i * 500, i: 0.05, v: 5, expected: 0.1, score: 0.9 })) }
  const c = await backendApi.registerIotEvent({ event, actor: '담당자' })
  assert.equal(c.persistence, 'server')
  const reviewed = await backendApi.submitReview(c.id, { reviewer: '검토자', verdict: 'AGREE', finalJudgment: '배선 확인', additionalInvestigation: '' })
  clearBackendCache()
  const shared = await backendApi.getCase(reviewed.id)
  assert.equal(shared.reviews[0].finalJudgment, '배선 확인')
  assert.equal(shared.window.length, 12)
  assert.equal(shared.stage, 'REVIEWED')
})

test('simultaneous IoT registrations cannot overwrite a different shared case', async () => {
  const event = { at: incident.created_at, source: 'MOCK', status: 'FAULT', maxScore: 0.9, expected: 0.1, relayOn: true, injected: null, window: Array.from({ length: 12 }, (_, i) => ({ t: 1000 + i * 500, i: 0.05, v: 5, expected: 0.1, score: 0.9 })) }
  const original = Date.now
  Date.now = () => 1234567890000
  try {
    const [a, b] = await Promise.all([backendApi.registerIotEvent({ event, actor: '작업자1' }), backendApi.registerIotEvent({ event, actor: '작업자2' })])
    assert.notEqual(a.id, b.id)
  } finally { Date.now = original }
})

test('failed refresh labels cached cases stale and export refuses partial backup', async () => {
  await backendApi.listCases()
  unavailable = true
  const listed = await backendApi.listCases()
  assert.ok(listed.find((c) => c.id === 'GW-ABCD1234').sync?.error)
  await assert.rejects(() => backendApi.exportCases(), /장애|최신|내보내기/)
  unavailable = false
})
