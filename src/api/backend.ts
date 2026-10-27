import type { GridWitnessApi } from '.'
import { apiBase } from '../lib/backend'
import { PREPROCESS_VERSION, sha256Hex } from '../lib/waveform'
import { ingest } from './ingest'
import { buildIotCase } from './iotCase'
import { summarize } from './util'
import {
  ANALYSIS_LABEL,
  CHANNELS,
  EVENT_LABELS,
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
  type SourceType,
} from '../types'

// 실제 FastAPI 서버(/api/v1)를 호출하는 구현.
// 서버에 사건 목록·조회 API가 아직 없어서, 목록과 파형은 이 브라우저에 보관하고 서버에는 등록·진단·분석·검토 기록을 남긴다.

const KEY = 'gridwitness.cases.backend.v1'
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
}

function load(): AnyCase[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as AnyCase[]
  } catch {
    return []
  }
}
let store = load()
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // 저장 공간이 모자라면 메모리에서만 유지
  }
}
function put<T extends AnyCase>(c: T): T {
  store = [c, ...store.filter((x) => x.id !== c.id)]
  save()
  return structuredClone(c)
}
function find(id: string): AnyCase {
  const c = store.find((x) => x.id === id)
  if (!c) throw new Error(`사건 ${id}는 이 브라우저에 기록이 없습니다. 서버에는 목록 조회 기능이 아직 없어 다른 브라우저의 사건은 볼 수 없습니다.`)
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
  let res: Response
  try {
    res = await fetch(`${apiBase()}/api/v1${path}`, init)
  } catch {
    throw new Error('분석 서버에 연결할 수 없습니다. 설정에서 서버 상태를 확인하세요.')
  }
  if (!res.ok) {
    let msg = `서버 오류 (${res.status})`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') msg = `${msg}: ${body.detail}`
      else if (body.detail) msg = `${msg}: ${JSON.stringify(body.detail).slice(0, 200)}`
    } catch {
      // 본문이 JSON이 아니면 상태 코드만
    }
    throw new Error(msg)
  }
  return (await res.json()) as T
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

function toResult(a: Analysis): AnalysisResult {
  const features = toFeatures(a.features ?? {})
  const base = { analysisType: 'EVENT_TYPE' as const, features, modelVersion: a.model_version, preprocessVersion: a.preprocessing_version || PREPROCESS_VERSION, executedAt: a.created_at }
  // 서버가 분류까지 내놓기 시작하면 { label, scores } 모양을 기대한다. 모양이 다르면 확정하지 않고 보류로 둔다.
  const cls = a.classification as { label?: string; predicted_label?: string; scores?: Record<string, number> } | null
  const label = cls?.predicted_label ?? cls?.label
  if (a.analysis_status !== 'deferred' && cls && label && (EVENT_LABELS as readonly string[]).includes(label) && cls.scores) {
    return {
      kind: 'COMPLETED',
      ...base,
      predictedLabel: label as EventLabel,
      scores: Object.fromEntries(EVENT_LABELS.map((l) => [l, cls.scores?.[l] ?? 0])) as Record<EventLabel, number>,
      limitations: ['점수는 보정되지 않은 모델 출력이며 정답 확률이 아닙니다.', '이벤트 유형 분류이며 물리적 고장원인이 아닙니다.'],
    }
  }
  const reasons = a.deferred_reasons?.length ? a.deferred_reasons.map((r) => REASON_KO[r.code] ?? r.message) : ['서버가 분류 결과를 돌려주지 않았습니다.']
  const needed = a.deferred_reasons?.flatMap((r) => (Array.isArray(r.details?.required) ? (r.details.required as unknown[]).map(String) : [])) ?? []
  return { kind: 'WITHHELD', ...base, reasons, neededInfo: needed.length ? needed : ['서버에 분석 모델 설정'], scores: null }
}

function fromAudit(events: AuditEvent[], local: HistoryEvent[]): HistoryEvent[] {
  // 서버는 작업자를 모르므로, 같은 작업의 로컬 기록에서 작업자 이름을 가져온다
  const actorOf = (action: string) => local.find((h) => h.action === action)?.actor
  return events.map((e) => {
    const action = AUDIT_KO[e.event_type] ?? e.event_type
    const reviewer = typeof e.payload?.reviewer === 'string' ? e.payload.reviewer : undefined
    const localHit = local.find((h) => h.action === action && Math.abs(new Date(h.at).getTime() - new Date(e.created_at).getTime()) < 60_000)
    return { at: e.created_at, actor: reviewer ?? localHit?.actor ?? actorOf(action) ?? 'system', action, detail: localHit?.detail }
  })
}

export const backendApi: GridWitnessApi = {
  async listCases() {
    return store.map(summarize)
  },

  async listActivity() {
    return store
      .flatMap((c) => c.history.map((h) => ({ ...h, caseId: c.id, caseTitle: c.title, caseType: c.caseType })))
      .sort((a, b) => b.at.localeCompare(a.at))
  },

  async exportCases() {
    return structuredClone(store)
  },

  async getCase(id) {
    const c = find(id)
    if (c.caseType === 'WAVEFORM' && c.backend) {
      try {
        const audit = await call<{ events: AuditEvent[] }>(`/incidents/${c.backend.incidentId}/audit`)
        if (audit.events?.length) c.history = fromAudit(audit.events, c.history)
        put(c)
      } catch {
        // 이력 새로고침 실패는 보관된 기록으로 대체
      }
    }
    return structuredClone(c)
  },

  async registerCase(input) {
    const g = await ingest(input)
    const t = now()
    const { diagnosis: localDiag, matrix: localMatrix } = g.local
    const common = {
      fileName: g.fileName,
      fileSize: g.fileSize,
      sourceType: input.sourceType,
      datasetId: input.datasetId,
      samplingRateHz: g.samplingRateHz,
      systemFrequencyHz: g.systemFrequencyHz,
      channelOrder: g.parsed.header ?? [...CHANNELS],
      labelMeaning: input.labelMeaning,
      format: g.format,
      comtrade: g.comtrade,
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
    form.append('source', SOURCE_CODE[input.sourceType])
    if (input.datasetId) form.append('dataset_id', input.datasetId)
    form.append('sampling_rate_hz', String(g.samplingRateHz))
    form.append('system_frequency_hz', String(g.systemFrequencyHz))
    const reg = await call<Registered>('/incidents', { method: 'POST', body: form })
    const val = await call<Validation>(`/incidents/${reg.incident_id}/validation`, { method: 'POST' })
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
    if (analysisType !== 'EVENT_TYPE') throw new Error('서버 연결 모드에서는 이벤트 유형 분석만 지원합니다.')
    const c = findWaveform(id)
    if (!c.backend) throw new Error('이 사건은 서버에 등록되지 않아 서버 분석을 할 수 없습니다.')
    if (c.diagnosis.status === 'REJECTED') throw new Error('입력 진단에서 거부된 자료는 분석할 수 없습니다.')
    const a = await call<Analysis>(`/incidents/${c.backend.incidentId}/analysis`, { method: 'POST' })
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
    const id = `GW-IOT-${Date.now().toString(36).toUpperCase()}`
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
    return put(c)
  },

  async submitReview(id, review) {
    const c = find(id)
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
      return finish(fresh, review)
    }
    // IoT·서버에 올리지 못한 사건은 브라우저에만 기록
    return finish(c, review)
  },
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
  store = []
  save()
}
