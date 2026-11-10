import type { GridWitnessApi } from '.'
import { ApiError, apiBase, apiHeaders, apiRequest } from '../lib/backend'
import { buildSampleCase, SAMPLE_ID } from '../lib/sample'
import { diagnose, parseCsv, PREPROCESS_VERSION, sha256Hex } from '../lib/waveform'
import { ingest } from './ingest'
import { buildIotCase } from './iotCase'
import { summarize } from './util'
import { getVillagePersistence, listVillageRecords, saveVillageRecord } from './village'
import { exportLocalAssistantRecords } from './assistant'
import { exportLocalFieldNotes } from './fieldNotes'
import {
  type AiDetail,
  ANALYSIS_LABEL,
  CHANNELS,
  EVENT_LABELS,
  RU_EVENT_LABELS,
  channelsFor,
  VERDICT_LABEL,
  type AnalysisResult,
  type AnyCase,
  type ChannelFeatures,
  type DiagnosisIssue,
  type EventLabel,
  type HistoryEvent,
  type IncidentCase,
  type InputDiagnosis,
  type IotCase,
  type Review,
  type SourceRecord,
  type SourceType,
  needsWaveform,
} from '../types'

// 서버 기록을 기준으로 동기화하고 브라우저에는 서버별 캐시를 둔다.

const KEY = 'gridwitness.cases.backend.v1'
let scope = apiBase()
const cacheKey = () => `${KEY}.${encodeURIComponent(scope)}`
let cacheReadError: string | null = null
const SOURCE_CODE: Record<SourceType, string> = {
  PUBLIC_DATASET: 'public-dataset',
  FIELD_FRTU: 'field-frtu',
  SYNTHETIC: 'synthetic',
  UNKNOWN: 'unknown',
}
const VERDICT_CODE: Record<Review['verdict'], string> = { AGREE: 'agree', DISAGREE: 'disagree', NEEDS_INVESTIGATION: 'needs_investigation' }
const REASON_KO: Record<string, string> = {
  MODEL_NOT_CONFIGURED: '서버에 분석 모델이 아직 연결되지 않아 특징값만 계산하고 유형 판단은 보류합니다.',
}
const AUDIT_KO: Record<string, string> = {
  'incident.registered': '원본 등록',
  'incident.validation.completed': '입력 진단',
  'incident.analysis.completed': '서버 분석',
  'review.created': '사람 검토',
  'assistant.answered': '현장 AI 답변',
  'field_note.created': '현장 메모',
}

function load(migrate = false): AnyCase[] {
  cacheReadError = null
  try {
    let raw = localStorage.getItem(cacheKey())
    const legacy = migrate && !localStorage.getItem(`${KEY}.migrated`) ? localStorage.getItem(KEY) : null
    if (!raw && legacy) {
      // 기존 공통 캐시는 현재 설정된 서버로 한 번만 옮긴다. 다른 서버에 재사용하지 않는다.
      JSON.parse(legacy)
      localStorage.setItem(cacheKey(), legacy)
      localStorage.setItem(`${KEY}.migrated`, scope)
      raw = legacy
    }
    const data: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(data)) throw new Error('사건 캐시 형식 오류')
    return data as AnyCase[]
  } catch {
    cacheReadError = '브라우저 사건 보관본을 읽지 못했습니다. 서버 기록은 다시 불러오며 로컬 자료의 복원은 확인이 필요합니다.'
    return []
  }
}
let store = load(true)
function ensureScope() {
  if (scope !== apiBase()) {
    scope = apiBase()
    store = load()
  }
}
function assertScope(expected: string) {
  if (expected !== apiBase()) throw new Error('서버 주소가 변경되었습니다. 새 서버에서 다시 불러오세요.')
}
function save() {
  try {
    localStorage.setItem(cacheKey(), JSON.stringify(store))
  } catch {
    store.forEach((c) => { c.sync = { checkedAt: c.sync?.checkedAt ?? null, error: '브라우저 저장 공간에 기록하지 못했습니다. 서버 기록을 다시 불러올 수 있지만 로컬 기록은 내보내야 합니다.' } })
  }
}
function put<T extends AnyCase>(c: T): T {
  store = [c, ...store.filter((x) => x.id !== c.id)]
  save()
  return structuredClone(c)
}
function find(id: string): AnyCase {
  ensureScope()
  const c = store.find((x) => x.id === id)
  if (!c) throw new Error(`사건 ${id}를 현재 서버에서 찾지 못했습니다. 보관 처리 여부와 서버 주소를 확인하세요.`)
  return c
}
function findWaveform(id: string): IncidentCase {
  const c = find(id)
  if (c.caseType !== 'WAVEFORM') throw new Error('고장파형 사건이 아닙니다.')
  return c
}
const now = () => new Date().toISOString()

// ── HTTP ────────────────────────────────────────────────
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(`/api/v1${path}`, init)
}
const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

// ── 서버 응답 모양 ───────────────────────────────────────
interface ServerIssue {
  code: string
  message: string
  details?: unknown
}
interface Registered {
  incident_id: string
  sha256: string
}
interface Validation {
  validation_id: string
  status: 'accepted' | 'limited' | 'rejected'
  row_count: number
  channels: unknown
  errors: ServerIssue[]
  warnings: ServerIssue[]
  fixes: string[]
  created_at: string
}
interface Analysis {
  analysis_id: string
  analysis_status: string
  features: Record<string, { rms: number; peak: number; crest_factor: number; derivative_rms: number }>
  classification: unknown
  deferred_reasons: { code: string; message: string; details?: { required?: unknown } }[]
  preprocessing_version: string
  model_version: string
  created_at: string
}
interface AuditEvent {
  event_type: string
  payload?: Record<string, unknown>
  created_at: string
}

function toDiagnosis(v: Validation, extra: DiagnosisIssue[]): InputDiagnosis {
  // fixes는 오류 뒤에 경고 순서로 같은 길이를 이룬다
  const issues: DiagnosisIssue[] = [
    ...v.errors.map((e, k) => ({ code: e.code, severity: 'error' as const, message: e.message, fix: v.fixes[k] })),
    ...v.warnings.map((w, k) => ({ code: w.code, severity: 'warning' as const, message: w.message, fix: v.fixes[v.errors.length + k] })),
  ]
  const all = [...extra, ...issues]
  const status = v.status === 'rejected' || extra.some((i) => i.severity === 'error') ? 'REJECTED' : v.status === 'limited' ? 'LIMITED' : 'ACCEPTED'
  const cols = Array.isArray(v.channels) ? v.channels.length : typeof v.channels === 'number' ? v.channels : CHANNELS.length
  return { status, rows: v.row_count, cols, issues: all, checkedAt: v.created_at }
}

function toFeatures(f: Analysis['features']): ChannelFeatures[] {
  return CHANNELS.filter((ch) => f[ch]).map((ch) => ({ channel: ch, rms: f[ch].rms, peak: f[ch].peak, crestFactor: f[ch].crest_factor, diffRms: f[ch].derivative_rms }))
}

interface GwAi {
  status?: string
  prediction?: { label: string } | null
  evidence?: { top_features?: { name: string; value: number; contribution: number }[]; top_features_method?: string; top_score?: number | null; margin?: number | null; ood_ratio?: number | null; thresholds?: Record<string, number> } | null
  reasons?: { code: string }[]
  versions?: Record<string, string>
  model_country?: string | null
  model_dataset?: string | null
  file_sha256?: string | null
  limitations?: string[]
}

/** 서버 분석의 features.gw_ai (AI 결과 원문)에서 근거·추적 정보만 꺼낸다. 없거나 모양이 다르면 undefined */
function toAiDetail(raw: unknown): AiDetail | undefined {
  const g = raw as GwAi | undefined
  if (!g || typeof g !== 'object' || !g.status) return undefined
  const ev = g.evidence ?? null
  const top = ev?.top_features ?? []
  // 1순위 유형: 답했으면 그 유형, 보류면 근거 계산에 쓴 1순위 (화면에서 답으로 보이지 않게만 씀)
  const cls = g.prediction?.label ?? null
  return {
    status: g.status === 'ok' || g.status === 'abstained' || g.status === 'rejected' ? g.status : 'abstained',
    method: ev?.top_features_method ?? '',
    topFeatures: top.map((f) => ({ name: f.name, value: f.value, contribution: f.contribution })),
    topLabel: cls,
    topScore: ev?.top_score ?? null,
    margin: ev?.margin ?? null,
    oodRatio: ev?.ood_ratio ?? null,
    thresholds: ev?.thresholds ?? {},
    reasonCodes: (g.reasons ?? []).map((r) => r.code),
    versions: g.versions ?? {},
    modelCountry: g.model_country ?? null,
    modelDataset: g.model_dataset ?? null,
    fileSha256: g.file_sha256 ?? null,
    limitations: g.limitations ?? [],
  }
}

function toResult(a: Analysis): AnalysisResult {
  const features = toFeatures(a.features ?? {})
  const ai = toAiDetail((a.features as Record<string, unknown> | undefined)?.gw_ai)
  const base = { analysisType: 'EVENT_TYPE' as const, features, modelVersion: a.model_version, preprocessVersion: a.preprocessing_version || PREPROCESS_VERSION, executedAt: a.created_at, ai }
  // 서버가 분류까지 내놓기 시작하면 { label, scores } 모양을 기대한다. 모양이 다르면 확정하지 않고 보류로 둔다.
  const cls = a.classification as { label?: string; predicted_label?: string; scores?: Record<string, number> } | null
  const label = cls?.predicted_label ?? cls?.label
  const labels = (RU_EVENT_LABELS as readonly string[]).includes(label ?? '') ? RU_EVENT_LABELS : EVENT_LABELS
  const scores = cls?.scores && labels.every((l) => typeof cls.scores?.[l] === 'number' && Number.isFinite(cls.scores[l]))
    ? Object.fromEntries(labels.map((l) => [l, cls.scores![l]])) : null
  if (!['deferred', 'abstained', 'rejected'].includes(a.analysis_status) && cls && label && (labels as readonly string[]).includes(label) && scores) {
    return {
      kind: 'COMPLETED',
      ...base,
      predictedLabel: label as EventLabel,
      scores,
      limitations: ['점수는 보정되지 않은 모델 출력이며 정답 확률이 아닙니다.', '이벤트 유형 분류이며 물리적 고장원인이 아닙니다.', labels === EVENT_LABELS ? 'CN 모델에는 정상·개폐 유형이 없어 정상/고장 탐지로 사용할 수 없습니다.' : 'RU OscGrid의 이벤트 유형 분류이며 국내 현장 성능은 별도 검증이 필요합니다.'],
    }
  }
  const reasons = a.deferred_reasons?.length ? a.deferred_reasons.map((r) => REASON_KO[r.code] ?? r.message) : ['서버가 분류 결과를 돌려주지 않았습니다.']
  const needed = a.deferred_reasons?.flatMap((r) => (Array.isArray(r.details?.required) ? (r.details.required as unknown[]).map(String) : [])) ?? []
  return { kind: 'WITHHELD', ...base, reasons, neededInfo: needed.length ? needed : ['서버 모델 상태와 분석 응답 확인'], scores }
}

function fromAudit(events: AuditEvent[], local: HistoryEvent[]): HistoryEvent[] {
  // 서버는 작업자를 모르므로, 같은 작업의 로컬 기록에서 작업자 이름을 가져온다
  const actorOf = (action: string) => local.find((h) => h.action === action)?.actor
  return events.map((e) => {
    const action = AUDIT_KO[e.event_type] ?? e.event_type
    const reviewer = typeof e.payload?.reviewer === 'string' ? e.payload.reviewer : typeof e.payload?.actor === 'string' ? e.payload.actor : undefined
    const localHit = local.find((h) => h.action === action && Math.abs(new Date(h.at).getTime() - new Date(e.created_at).getTime()) < 60_000)
    return { at: e.created_at, actor: reviewer ?? localHit?.actor ?? actorOf(action) ?? 'system', action, detail: localHit?.detail }
  })
}

interface ServerIncident {
  incident_id: string
  original_filename: string
  sha256: string
  source: string
  dataset_id: string | null
  sampling_rate_hz: number
  system_frequency_hz: number
  status: string
  created_at: string
  title?: string | null
  label_meaning?: string | null
  provenance?: SourceRecord['provenance'] | null
  archived?: boolean
  original_files?: SourceRecord['originalFiles']
}

const SOURCE_FROM_CODE = Object.fromEntries(Object.entries(SOURCE_CODE).map(([k, v]) => [v, k])) as Record<string, SourceType>

/** 서버 목록에만 있는 사건(다른 브라우저에서 등록한 것)을 파형 없는 기록으로 만든다 */
function stub(i: ServerIncident): IncidentCase {
  const st = i.status
  const status = st.includes('rejected') ? 'REJECTED' : st.includes('limited') ? 'LIMITED' : 'ACCEPTED'
  const stage = st.includes('review') ? 'REVIEWED' : st === 'analysis_completed' || st === 'analyzed' ? 'ANALYZED' : st.includes('deferred') || st.includes('withheld') || st === 'analysis_abstained' ? 'WITHHELD' : st === 'registered' ? 'REGISTERED' : 'DIAGNOSED'
  const channels = i.provenance?.channelOrder ?? [...channelsFor(i.sampling_rate_hz === 1600 ? 5 : 7)]
  return {
    caseType: 'WAVEFORM',
    id: `GW-${i.incident_id.slice(0, 8).toUpperCase()}`,
    title: i.title || i.original_filename,
    createdAt: i.created_at,
    stage,
    archived: i.archived || i.status === 'archived',
    source: {
      fileName: i.original_filename,
      fileSize: 0,
      sha256: i.sha256,
      sourceType: SOURCE_FROM_CODE[i.source] ?? 'UNKNOWN',
      datasetId: i.dataset_id ?? '',
      samplingRateHz: i.sampling_rate_hz,
      systemFrequencyHz: i.system_frequency_hz === 60 ? 60 : 50,
      channelOrder: channels,
      labelMeaning: i.label_meaning ?? '',
      format: i.provenance?.format,
      comtrade: i.provenance?.comtrade,
      provenance: i.provenance ?? undefined,
      originalFiles: i.original_files,
    },
    diagnosis: {
      status,
      rows: 0,
      cols: channels.length,
      issues: [{ code: 'REMOTE_RECORD', severity: 'info', message: '다른 곳에서 등록된 사건입니다. 사건을 열면 서버에 보관된 원본 파형·입력 진단·AI 분석·검토 기록을 불러옵니다.' }],
      checkedAt: i.created_at,
    },
    waveform: null,
    analysis: null,
    reviews: [],
    history: [],
    backend: { incidentId: i.incident_id, validationId: null, analysisId: null },
  }
}

/** 원본 파일을 사건에 붙인다. 서버에 등록된 해시와 다르면 거부 (다른 파일로 바꿔치기 방지) */
async function applyWaveform(c: IncidentCase, buf: ArrayBuffer) {
  const sha = await sha256Hex(buf)
  if (sha !== c.source.sha256) throw new Error('서버에 등록된 파일과 내용이 다릅니다 (SHA-256 불일치). 등록할 때 쓴 원본 CSV를 선택하세요.')
  const text = new TextDecoder().decode(buf)
  const parsed = parseCsv(text)
  const { diagnosis, matrix } = diagnose(parsed, buf.byteLength, {
    samplingRateHz: c.source.samplingRateHz,
    systemFrequencyHz: c.source.systemFrequencyHz,
    sourceType: c.source.sourceType,
  })
  if (!matrix) throw new Error('파일을 파형으로 읽지 못했습니다.')
  c.waveform = matrix
  c.diagnosis = { ...c.diagnosis, rows: diagnosis.rows, cols: diagnosis.cols, issues: c.diagnosis.issues.filter((i) => i.code !== 'REMOTE_RECORD') }
  c.source = { ...c.source, fileSize: buf.byteLength, channelOrder: parsed.header ?? c.source.channelOrder }
}

const VERDICT_FROM_CODE = Object.fromEntries(Object.entries(VERDICT_CODE).map(([k, v]) => [v, k])) as Record<string, Review['verdict']>
interface ServerReview {
  reviewer: string
  final_decision: string
  comment?: string | null
  additional_investigation?: string | null
  created_at: string
}

/** 다른 브라우저(다른 노트북)에서 등록한 사건: 서버에 남은 원본 파형·입력 진단·AI 분석·검토를 받아 채운다.
 *  하나가 실패해도(아직 분석 안 함 등) 나머지는 채운다 */
function mergeIncident(i: ServerIncident, prior?: IncidentCase): IncidentCase {
  const fresh = stub(i)
  if (!prior) return fresh
  const sameFile = prior.source.sha256 === i.sha256
  return {
    ...prior, ...fresh,
    title: i.title || prior.title || i.original_filename,
    source: { ...prior.source, ...fresh.source, fileSize: sameFile ? prior.source.fileSize : 0 },
    waveform: sameFile ? prior.waveform : null,
    diagnosis: { ...prior.diagnosis, status: fresh.diagnosis.status },
    analysis: prior.analysis,
    reviews: prior.reviews,
    history: prior.history,
    backend: prior.backend,
  }
}

async function download(path: string): Promise<ArrayBuffer> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 20_000)
  try {
    const res = await fetch(`${apiBase()}${path}`, { headers: apiHeaders(), signal: ctl.signal })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { message?: string; detail?: string; code?: string }
      throw new ApiError(body.message ?? body.detail ?? `원본 파일 조회 오류 (${res.status})`, res.status, body.code)
    }
    return await res.arrayBuffer()
  } catch (e) {
    if (ctl.signal.aborted) throw new Error('20초 안에 원본 파일을 받지 못했습니다. 다시 불러오세요.')
    throw e
  } finally { clearTimeout(timer) }
}
const base64 = (buffer: ArrayBuffer) => {
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function hydrateFromServer(c: IncidentCase, strict = false) {
  const expectedScope = apiBase()
  const id = c.backend!.incidentId
  const errors: string[] = []
  try {
    const metadata = await call<ServerIncident>(`/incidents/${id}`)
    Object.assign(c, mergeIncident(metadata, c))
    if (strict) c.serverRecords = { fieldNotes: null, assistantMessages: null, metadata }
  } catch (e) {
    if (e instanceof ApiError && [401, 403, 404].includes(e.status)) throw e
    errors.push(`사건 정보: ${(e as Error).message}`)
  }
  const missing = (e: unknown) => e instanceof ApiError && e.status === 404
  const reads = await Promise.allSettled([
    c.waveform && !strict ? Promise.resolve(null) : download(`/api/v1/incidents/${id}/waveform`),
    call<Validation>(`/incidents/${id}/validation`),
    call<Analysis>(`/incidents/${id}/analysis`),
    call<{ items: ServerReview[] }>(`/incidents/${id}/reviews`),
    call<{ events: AuditEvent[] }>(`/incidents/${id}/audit`),
  ])
  assertScope(expectedScope)
  const [waveform, validation, analysis, reviews, audit] = reads
  if (waveform.status === 'fulfilled') {
    if (waveform.value) {
      try {
        if ((validation.status === 'fulfilled' && validation.value.status === 'rejected') || (validation.status === 'rejected' && missing(validation.reason) && c.stage === 'REGISTERED')) {
          if (await sha256Hex(waveform.value) !== c.source.sha256) throw new Error('서버 원본 파일의 SHA-256이 등록 기록과 다릅니다.')
          c.waveform = null
          c.source.fileSize = waveform.value.byteLength
        } else await applyWaveform(c, waveform.value)
        if (strict && c.serverRecords) c.serverRecords.waveformFile = { name: c.source.fileName, base64: base64(waveform.value) }
      } catch (e) { errors.push((e as Error).message) }
    }
  } else errors.push(`파형: ${(waveform.reason as Error).message}`)
  if (validation.status === 'fulfilled') {
    c.diagnosis = toDiagnosis(validation.value, [])
    c.backend = { ...c.backend!, validationId: validation.value.validation_id }
    if (Array.isArray(validation.value.channels)) c.source.channelOrder = validation.value.channels.map(String)
  } else if (!missing(validation.reason) || c.stage !== 'REGISTERED') errors.push(`입력 진단: ${(validation.reason as Error).message}`)
  if (analysis.status === 'fulfilled') {
    c.analysis = toResult(analysis.value)
    c.backend = { ...c.backend!, analysisId: analysis.value.analysis_id }
    if (!c.archived) c.stage = c.analysis.kind === 'COMPLETED' ? 'ANALYZED' : 'WITHHELD'
  } else if (missing(analysis.reason) && !['ANALYZED', 'REVIEWED', 'WITHHELD'].includes(c.stage)) {
    c.analysis = null
    c.backend = { ...c.backend!, analysisId: null }
  } else errors.push(`AI 분석: ${(analysis.reason as Error).message}`)
  if (reviews.status === 'fulfilled') {
    c.reviews = reviews.value.items.map((x) => ({ reviewer: x.reviewer, verdict: VERDICT_FROM_CODE[x.final_decision] ?? 'NEEDS_INVESTIGATION', finalJudgment: x.comment ?? '', additionalInvestigation: x.additional_investigation ?? '', reviewedAt: x.created_at }))
    if (c.reviews.length) c.stage = 'REVIEWED'
  } else errors.push(`검토: ${(reviews.reason as Error).message}`)
  if (audit.status === 'fulfilled') c.history = fromAudit(audit.value.events ?? [], c.history)
  else errors.push(`이력: ${(audit.reason as Error).message}`)
  const denied = reads.find((r) => r.status === 'rejected' && r.reason instanceof ApiError && [401, 403].includes(r.reason.status))
  if (denied?.status === 'rejected') throw denied.reason
  if (strict && c.serverRecords) {
    if (validation.status === 'fulfilled') c.serverRecords.validation = validation.value
    if (analysis.status === 'fulfilled') c.serverRecords.analysis = analysis.value
    if (reviews.status === 'fulfilled') c.serverRecords.reviews = reviews.value
    if (audit.status === 'fulfilled') c.serverRecords.audit = audit.value
  }
  c.sync = { checkedAt: errors.length ? c.sync?.checkedAt ?? null : now(), error: errors.length ? `최신 서버 기록을 모두 확인하지 못했습니다. 보관된 자료가 포함됩니다. ${errors.join(' · ')}` : null }
  if (strict && errors.length) throw new Error(`전체 내보내기를 완료하지 못했습니다. ${c.sync.error}`)
}

/** 서버의 사건 목록을 받아 이 브라우저 기록에 없는 것을 채운다. 서버에 닿지 않으면 보관된 목록만 쓴다 */
/** 샘플 사건은 이 브라우저에만 있고 서버에는 올라가지 않는다 */
async function ensureSample() {
  if (store.some((c) => c.id === SAMPLE_ID)) return
  store.push(await buildSampleCase())
  store.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  save()
}

let syncing: { scope: string; promise: Promise<void> } | null = null
function syncList(): Promise<void> {
  ensureScope()
  if (!syncing || syncing.scope !== scope) {
    const current = { scope, promise: Promise.resolve() }
    current.promise = pull().finally(() => { if (syncing === current) syncing = null })
    syncing = current
  }
  return syncing.promise
}

async function fetchIncidents(includeArchived = false): Promise<ServerIncident[]> {
  const incidents: ServerIncident[] = []
  for (let page = 1; ; page++) {
    const r = await call<{ items: ServerIncident[]; total_count: number; per_page: number }>(`/incidents?page=${page}&per_page=100${includeArchived ? '&include_archived=true' : ''}`)
    incidents.push(...r.items)
    if (page * r.per_page >= r.total_count || r.items.length === 0) return incidents
    if (page >= 10_000) throw new Error('사건 목록이 너무 큽니다. 전체 목록을 확인하지 못했습니다.')
  }
}

async function pull() {
  const expectedScope = scope
  // 샘플 파일 장애가 실제 서버 사건 조회를 막지 않게 한다.
  await ensureSample().catch(() => undefined)
  try {
    const [incidents, iot] = await Promise.all([fetchIncidents(), listVillageRecords<IotCase>('iot_case')])
    assertScope(expectedScope)
    const existing = new Map(store.flatMap((c) => c.caseType === 'WAVEFORM' && c.backend ? [[c.backend.incidentId, c] as const] : []))
    const local = store.filter((c) => c.caseType !== 'WAVEFORM' || !c.backend)
    const persistence = getVillagePersistence()
    const remoteIot = new Map(iot.filter((r) => r.data?.caseType === 'IOT').map((r) => [r.data.id, { ...r.data, persistence: (persistence.error || persistence.pending ? 'pending' : 'server') as IotCase['persistence'], sync: { checkedAt: persistence.error ? null : now(), error: persistence.error } }]))
    store = [...local.filter((c) => !remoteIot.has(c.id)), ...remoteIot.values(), ...incidents.filter((i) => !i.archived && i.status !== 'archived').map((i) => ({ ...mergeIncident(i, existing.get(i.incident_id)), sync: { checkedAt: now(), error: cacheReadError } }))]
    store.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    save()
  } catch (e) {
    assertScope(expectedScope)
    if (e instanceof ApiError && [401, 403].includes(e.status)) throw e
    store.forEach((c) => { c.sync = { checkedAt: c.sync?.checkedAt ?? null, error: `최신 목록을 확인하지 못했습니다. 보관된 목록입니다. ${(e as Error).message}` } })
  }
}

export const backendApi: GridWitnessApi = {
  async listCases() {
    await syncList()
    return store.map(summarize)
  },

  async listActivity() {
    await syncList()
    await Promise.all(store.filter((c): c is IncidentCase => c.caseType === 'WAVEFORM' && !!c.backend).map(async (c) => {
      try {
        const audit = await call<{ events: AuditEvent[] }>(`/incidents/${c.backend!.incidentId}/audit`)
        c.history = fromAudit(audit.events ?? [], c.history)
      } catch (e) { c.sync = { checkedAt: c.sync?.checkedAt ?? null, error: `최신 이력을 확인하지 못했습니다. ${(e as Error).message}` } }
    }))
    return store
      .flatMap((c) => c.history.map((h) => ({ ...h, caseId: c.id, caseTitle: c.title, caseType: c.caseType })))
      .sort((a, b) => b.at.localeCompare(a.at))
  },

  async exportCases() {
    ensureScope()
    if (cacheReadError) throw new Error(`전체 내보내기를 완료하지 못했습니다. ${cacheReadError}`)
    const expectedScope = scope
    const incidents = await fetchIncidents(true)
    const all = store.filter((c) => c.caseType !== 'WAVEFORM' || !c.backend).map((c) => {
      const copy = structuredClone(c)
      if (copy.caseType === 'WAVEFORM') copy.serverRecords = { fieldNotes: { browser: exportLocalFieldNotes(copy.id) }, assistantMessages: { browser: exportLocalAssistantRecords(copy.id) } }
      return copy
    })
    for (const i of incidents) {
      const c = mergeIncident(i, store.find((c): c is IncidentCase => c.caseType === 'WAVEFORM' && c.backend?.incidentId === i.incident_id))
      await hydrateFromServer(c, true)
      const [fieldNotes, assistantMessages] = await Promise.all([call(`/incidents/${i.incident_id}/field-notes`), call(`/incidents/${i.incident_id}/assistant/messages?include_archived=true`)])
      const originalFiles = []
      for (const file of Object.values(c.source.originalFiles ?? {})) {
        const data = new Uint8Array(await download(file.download_url))
        if (await sha256Hex(data.buffer as ArrayBuffer) !== file.sha256) throw new Error(`${file.filename}: 원본 파일 해시가 달라 내보내기를 중단했습니다.`)
        originalFiles.push({ name: file.filename, base64: base64(data.buffer as ArrayBuffer) })
      }
      c.serverRecords = { ...c.serverRecords, fieldNotes: { server: fieldNotes, browser: exportLocalFieldNotes(c.id) }, assistantMessages: { server: assistantMessages, browser: exportLocalAssistantRecords(c.id) }, originalFiles }
      all.push(c)
    }
    const iot = await listVillageRecords<IotCase>('iot_case')
    if (getVillagePersistence().error) throw new Error(`서버의 전체 IoT 사건을 확인하지 못해 내보내기를 중단했습니다. ${getVillagePersistence().error}`)
    for (const record of iot) {
      if (record.data?.caseType !== 'IOT') continue
      const index = all.findIndex((c) => c.id === record.data.id)
      if (index >= 0) all[index] = record.data
      else all.push(record.data)
    }
    assertScope(expectedScope)
    return structuredClone(all)
  },

  async getCase(id) {
    // 주소로 바로 들어온 서버 사건은 목록을 한 번 받은 뒤에야 알 수 있다
    await syncList()
    const c = find(id)
    if (c.caseType === 'WAVEFORM' && c.backend) {
      await hydrateFromServer(c)
      put(c)
    }
    return structuredClone(c)
  },

  async registerCase(input) {
    ensureScope()
    const expectedScope = scope
    const g = await ingest(input)
    assertScope(expectedScope)
    const t = now()
    const { diagnosis: localDiag, matrix: localMatrix } = g.local
    const common = {
      fileName: g.fileName,
      fileSize: g.fileSize,
      sourceType: input.sourceType,
      datasetId: input.datasetId,
      samplingRateHz: g.samplingRateHz,
      systemFrequencyHz: g.systemFrequencyHz,
      channelOrder: g.parsed.header ?? [...channelsFor(localDiag.cols)],
      labelMeaning: input.labelMeaning,
      format: g.format,
      comtrade: g.comtrade,
      provenance: g.provenance,
    }

    // COMTRADE 채널을 맞추지 못한 경우: 서버에 보낼 CSV가 없으므로 브라우저에서만 기록한다
    if (!g.uploadFile) {
      const sha256 = await sha256Hex(g.hashInput)
      return put<IncidentCase>({
        caseType: 'WAVEFORM',
        id: `GW-${sha256.slice(0, 8).toUpperCase()}`,
        title: input.title,
        createdAt: t,
        stage: 'DIAGNOSED',
        source: { ...common, sha256 },
        diagnosis: localDiag,
        waveform: null,
        analysis: null,
        reviews: [],
        history: [
          { at: t, actor: input.actor, action: '원본 등록', detail: `${g.format} · ${g.fileName} · 서버에는 올리지 못함(채널 변환 실패)` },
          { at: t, actor: 'system', action: '입력 진단', detail: `${localDiag.status} · 브라우저에서만 검사` },
        ],
      })
    }

    const form = new FormData()
    form.append('file', g.uploadFile)
    form.append('title', input.title)
    form.append('actor', input.actor)
    form.append('label_meaning', input.labelMeaning)
    form.append('provenance', JSON.stringify(g.provenance))
    if (input.cfg) {
      form.append('original_cfg', input.cfg)
      form.append('original_dat', input.file)
    }
    form.append('source', SOURCE_CODE[input.sourceType])
    if (input.datasetId) form.append('dataset_id', input.datasetId)
    form.append('sampling_rate_hz', String(g.samplingRateHz))
    form.append('system_frequency_hz', String(g.systemFrequencyHz))
    const reg = await call<Registered>('/incidents', { method: 'POST', body: form })
    const val = await call<Validation>(`/incidents/${reg.incident_id}/validation`, { method: 'POST' })
    assertScope(expectedScope)
    const diagnosis = toDiagnosis(val, g.preIssues)
    return put<IncidentCase>({
      caseType: 'WAVEFORM',
      id: `GW-${reg.incident_id.slice(0, 8).toUpperCase()}`,
      title: input.title,
      createdAt: t,
      stage: 'DIAGNOSED',
      source: { ...common, sha256: reg.sha256 },
      diagnosis,
      waveform: diagnosis.status === 'REJECTED' ? null : localMatrix,
      analysis: null,
      reviews: [],
      history: [
        { at: t, actor: input.actor, action: '원본 등록', detail: `${g.format} · ${g.fileName} · SHA-256 ${reg.sha256.slice(0, 12)}…` },
        { at: val.created_at, actor: 'system', action: '입력 진단', detail: `${diagnosis.status} · 이슈 ${diagnosis.issues.length}건 (서버 검사)` },
      ],
      backend: { incidentId: reg.incident_id, validationId: val.validation_id, analysisId: null },
    })
  },

  async runAnalysis(id, analysisType, actor) {
    const expectedScope = apiBase()
    if (analysisType !== 'EVENT_TYPE') throw new Error('서버 연결 모드에서는 이벤트 유형 분석만 지원합니다.')
    const c = findWaveform(id)
    if (needsWaveform(c) && c.backend) await hydrateFromServer(c)
    if (needsWaveform(c)) throw new Error('서버에서 원본 파형을 받지 못해 분석할 수 없습니다. 연결 상태를 확인하고 다시 불러오세요.')
    if (!c.backend) throw new Error('이 사건은 서버에 등록되지 않은 샘플이라 서버 분석을 할 수 없습니다. 고장파형 등록으로 올리면 서버 분석이 됩니다.')
    if (c.diagnosis.status === 'REJECTED') throw new Error('입력 진단에서 거부된 자료는 분석할 수 없습니다.')
    const a = await call<Analysis>(`/incidents/${c.backend.incidentId}/analysis`, { method: 'POST' })
    assertScope(expectedScope)
    const result = toResult(a)
    c.analysis = result
    c.backend = { ...c.backend, analysisId: a.analysis_id }
    c.stage = result.kind === 'COMPLETED' ? 'ANALYZED' : 'WITHHELD'
    c.history.push({
      at: a.created_at,
      actor,
      action: result.kind === 'COMPLETED' ? 'AI 분석 완료' : '분석 보류',
      detail: `${ANALYSIS_LABEL[analysisType]}${result.kind === 'COMPLETED' ? ` → ${result.predictedLabel}` : ''} · ${result.modelVersion ?? '모델 미실행'}`,
    })
    return put(c)
  },

  async registerIotEvent({ event, actor }) {
    ensureScope()
    const expectedScope = scope
    const id = `GW-IOT-${crypto.randomUUID().toUpperCase()}`
    const c: IotCase = buildIotCase(event, actor, id)
    // 서버의 IoT 요약으로 평균·최대 전력과 이상 표본을 확인해 근거에 더한다. 실패해도 브라우저 판정은 그대로 둔다.
    try {
      const sum = await call<{ sample_count: number; average_power_w: number; max_power_w: number; status: string; anomaly_indices: number[] }>('/energy/iot/summary', json({
        device_id: c.device.deviceId,
        samples: c.window.map((p) => ({ timestamp: new Date(p.t).toISOString(), voltage_v: p.v, current_a: p.i })),
        current_limit_a: Math.max(c.device.expectedA * 1.3, 0.05),
      }))
      c.detection.findings.push(`서버 요약: 표본 ${sum.sample_count}개 · 평균 ${sum.average_power_w.toFixed(2)} W · 최대 ${sum.max_power_w.toFixed(2)} W · 이상 표본 ${sum.anomaly_indices.length}개 (${sum.status})`)
    } catch {
      c.detection.limitations.push('서버 요약을 가져오지 못해 브라우저 판정만 표시합니다.')
    }
    assertScope(expectedScope)
    return persistIotCase(c)
  },

  async attachWaveform(id, file) {
    const expectedScope = apiBase()
    const c = findWaveform(id)
    await applyWaveform(c, await file.arrayBuffer())
    assertScope(expectedScope)
    return put(c)
  },

  async submitReview(id, review) {
    const expectedScope = apiBase()
    const c = find(id)
    if (needsWaveform(c) && c.caseType === 'WAVEFORM' && c.backend) await hydrateFromServer(c)
    if (needsWaveform(c)) throw new Error('원본 CSV가 이 브라우저에 없어 검토할 수 없습니다. 파형을 보지 않고 판단하지 않도록 원본 CSV를 먼저 연결하세요.')
    if (c.caseType === 'WAVEFORM' && c.backend) {
      let analysisId = c.backend.analysisId
      if (!analysisId) {
        const done = await backendApi.runAnalysis(id, 'EVENT_TYPE', review.reviewer)
        analysisId = done.backend?.analysisId ?? null
      }
      const fresh = findWaveform(id)
      await call(`/incidents/${fresh.backend!.incidentId}/reviews`, json({
        reviewer: review.reviewer,
        analysis_id: analysisId,
        final_decision: VERDICT_CODE[review.verdict],
        comment: review.finalJudgment,
        additional_investigation: review.additionalInvestigation,
      }))
      assertScope(expectedScope)
      return finish(fresh, review)
    }
    const done = finish(c, review)
    return done.caseType === 'IOT' ? persistIotCase(done) : done
  },
}

async function persistIotCase(c: IotCase): Promise<IotCase> {
  const expectedScope = apiBase()
  c.persistence = 'pending'
  put(c)
  const record = await saveVillageRecord(c.id, 'iot_case', c.device.deviceId, c)
  assertScope(expectedScope)
  c.persistence = record ? 'server' : 'pending'
  c.sync = { checkedAt: record ? now() : null, error: record ? null : '서버 전송 대기 중입니다. 브라우저에 보관하고 연결이 돌아오면 재시도합니다.' }
  return put(c)
}

function finish(c: AnyCase, review: Omit<Review, 'reviewedAt'>): AnyCase {
  const r = { ...review, reviewedAt: now() }
  c.reviews.push(r)
  c.stage = 'REVIEWED'
  c.history.push({ at: r.reviewedAt, actor: review.reviewer, action: '사람 검토', detail: VERDICT_LABEL[review.verdict] })
  return put(c)
}

/** 이 브라우저에 보관한 서버 연결 사건 목록을 비움 (서버에 남은 기록은 지워지지 않음) */
export function clearBackendCache() {
  ensureScope()
  cacheReadError = null
  store = []
  save()
}
