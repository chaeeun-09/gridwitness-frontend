import type { GridWitnessApi } from '.'
import { computeFeatures, PREPROCESS_VERSION, sha256Hex } from '../lib/waveform'
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
  type EventLabel,
  type IncidentCase,
} from '../types'

// 백엔드가 준비되기 전까지 브라우저에서 파이프라인을 흉내 내는 목 서버.
// 점수는 설명용 가짜 값이며 실제 모델 성능과 무관함.

const KEY = 'gridwitness.cases.v1'
const MOCK_MODEL = 'rf-baseline-MOCK-0.0'
const WITHHOLD_THRESHOLD = 0.55

function load(): AnyCase[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as AnyCase[]
    // caseType 도입 이전 데이터는 고장파형 사건
    return raw.map((c) => {
      const out = { ...c, caseType: c.caseType ?? 'WAVEFORM' } as AnyCase
      // 채널 용어 도입 이전 IoT 사건
      if (out.caseType === 'IOT') {
        const d = out.device as typeof out.device & { houseName?: string; channelName?: string; ledOn?: boolean }
        out.device = { ...d, scope: d.scope ?? d.channelName ?? d.houseName ?? '', relayOn: d.relayOn ?? d.ledOn ?? true }
      }
      return out
    })
  } catch {
    return []
  }
}
function save(cases: AnyCase[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cases))
  } catch {
    // 저장 공간 부족 시 메모리에서만 유지
  }
}
let store = load()

/** 예시 데이터를 넣는 동안에는 지연 없이 처리 */
let instant = false
const delay = (ms = 250) => (instant ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)))
const now = () => new Date().toISOString()

function find(id: string): AnyCase {
  const c = store.find((x) => x.id === id)
  if (!c) throw new Error(`사건 ${id}를 찾을 수 없습니다.`)
  return c
}
function findWaveform(id: string): IncidentCase {
  const c = find(id)
  if (c.caseType !== 'WAVEFORM') throw new Error('고장파형 사건이 아닙니다.')
  return c
}
function put<T extends AnyCase>(c: T): T {
  store = [c, ...store.filter((x) => x.id !== c.id)]
  save(store)
  return structuredClone(c)
}

function nextId(): string {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const seq = store.filter((c) => c.id.includes(ymd)).length + 1
  return `GW-${ymd}-${String(seq).padStart(3, '0')}`
}

function mockScores(sha: string): Record<EventLabel, number> {
  const raw = EVENT_LABELS.map((_, i) => parseInt(sha.slice(i * 4, i * 4 + 4), 16) / 0xffff)
  const exp = raw.map((v) => Math.exp(v * 7))
  const sum = exp.reduce((a, b) => a + b, 0)
  return Object.fromEntries(EVENT_LABELS.map((l, i) => [l, exp[i] / sum])) as Record<EventLabel, number>
}

const core: GridWitnessApi = {
  async listCases() {
    await delay()
    return store.map(summarize)
  },

  async listActivity() {
    await delay()
    return store
      .flatMap((c) => c.history.map((h) => ({ ...h, caseId: c.id, caseTitle: c.title, caseType: c.caseType })))
      .sort((a, b) => b.at.localeCompare(a.at))
  },

  async exportCases() {
    await delay()
    return structuredClone(store)
  },

  async getCase(id) {
    await delay()
    return structuredClone(find(id))
  },

  async registerCase(input) {
    await delay()
    const g = await ingest(input)
    const sha256 = await sha256Hex(g.hashInput)
    const { parsed, samplingRateHz, systemFrequencyHz, comtrade, fileName, fileSize } = g
    const { diagnosis, matrix } = g.local
    const t = now()
    const c: IncidentCase = {
      caseType: 'WAVEFORM',
      id: nextId(),
      title: input.title,
      createdAt: t,
      stage: 'DIAGNOSED',
      source: {
        fileName,
        fileSize,
        sha256,
        sourceType: input.sourceType,
        datasetId: input.datasetId,
        samplingRateHz,
        systemFrequencyHz,
        channelOrder: parsed.header ?? [...CHANNELS],
        labelMeaning: input.labelMeaning,
        format: g.format,
        comtrade,
      },
      diagnosis,
      waveform: matrix,
      analysis: null,
      reviews: [],
      history: [
        { at: t, actor: input.actor, action: '원본 등록', detail: `${g.format} · ${fileName} · SHA-256 ${sha256.slice(0, 12)}…` },
        { at: t, actor: 'system', action: '입력 진단', detail: `${diagnosis.status} · 이슈 ${diagnosis.issues.length}건` },
      ],
    }
    return put(c)
  },

  async runAnalysis(id, analysisType, actor) {
    await delay(600)
    const c = findWaveform(id)
    if (c.diagnosis.status === 'REJECTED' || !c.waveform) {
      throw new Error('입력 진단에서 거부된 자료는 분석할 수 없습니다.')
    }
    const t = now()
    let result: AnalysisResult

    if (analysisType === 'PHYSICAL_CAUSE') {
      result = {
        kind: 'WITHHELD',
        analysisType,
        reasons: ['현재 학습 데이터에는 이벤트 유형 라벨만 있고 물리적 원인 라벨이 없습니다.', '파형만으로 수목 접촉·절연 파괴 등의 실제 원인을 단정할 수 없습니다.'],
        neededInfo: ['현장 조사 결과(원인 라벨)', '설비 이력·정비 기록', '같은 시각 다른 지점의 파형'],
        features: null,
        scores: null,
        modelVersion: null,
        preprocessVersion: null,
        executedAt: t,
      }
    } else if (analysisType === 'NORMAL_VS_FAULT') {
      result = {
        kind: 'WITHHELD',
        analysisType,
        reasons: ['공개 학습 데이터에 정상 클래스가 없어 정상/고장 판별 모델이 없습니다.'],
        neededInfo: ['정상 운전 구간이 라벨링된 데이터셋'],
        features: null,
        scores: null,
        modelVersion: null,
        preprocessVersion: null,
        executedAt: t,
      }
    } else {
      const features = computeFeatures(c.waveform)
      const scopeIssues = c.diagnosis.issues.filter((i) => i.code.endsWith('OUT_OF_SCOPE'))
      if (scopeIssues.length > 0) {
        result = {
          kind: 'WITHHELD',
          analysisType,
          reasons: scopeIssues.map((i) => i.message),
          neededInfo: scopeIssues.map((i) => i.fix ?? '').filter(Boolean),
          features,
          scores: null,
          modelVersion: MOCK_MODEL,
          preprocessVersion: PREPROCESS_VERSION,
          executedAt: t,
        }
      } else {
        const scores = mockScores(c.source.sha256)
        const [top, topScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] as [EventLabel, number]
        result =
          topScore < WITHHOLD_THRESHOLD
            ? {
                kind: 'WITHHELD',
                analysisType,
                reasons: [`최고 점수(${top} ${topScore.toFixed(2)})가 판단 보류 기준 ${WITHHOLD_THRESHOLD} 미만입니다.`],
                neededInfo: ['담당자의 파형 직접 확인', '설비 이력 또는 다른 지점 파형'],
                features,
                scores,
                modelVersion: MOCK_MODEL,
                preprocessVersion: PREPROCESS_VERSION,
                executedAt: t,
              }
            : {
                kind: 'COMPLETED',
                analysisType,
                predictedLabel: top,
                scores,
                features,
                limitations: [
                  '점수는 보정되지 않은 모델 출력이며 정답 확률이 아닙니다.',
                  '50Hz 공개 데이터 기준 결과입니다. 국내 60Hz 현장 성능은 검증되지 않았습니다.',
                  '이벤트 유형 분류이며 물리적 고장원인이 아닙니다.',
                ],
                modelVersion: MOCK_MODEL,
                preprocessVersion: PREPROCESS_VERSION,
                executedAt: t,
              }
      }
    }

    c.analysis = result
    c.stage = result.kind === 'COMPLETED' ? 'ANALYZED' : 'WITHHELD'
    c.history.push({
      at: t,
      actor,
      action: result.kind === 'COMPLETED' ? 'AI 분석 완료' : '분석 보류',
      detail: `${ANALYSIS_LABEL[analysisType]}${result.kind === 'COMPLETED' ? ` → ${result.predictedLabel}` : ''} · ${result.modelVersion ?? '모델 미실행'}`,
    })
    return put(c)
  },

  async registerIotEvent({ event: e, actor }) {
    await delay()
    return put(buildIotCase(e, actor, nextId()))
  },

  async submitReview(id, review) {
    await delay()
    const c = find(id)
    const r = { ...review, reviewedAt: now() }
    c.reviews.push(r)
    c.stage = 'REVIEWED'
    c.history.push({ at: r.reviewedAt, actor: review.reviewer, action: '사람 검토', detail: VERDICT_LABEL[review.verdict] })
    return put(c)
  },
}

// ── 예시 데이터 ──────────────────────────────────────────
// 처음 열 때 한 번, 실제와 같은 처리 과정(등록 → 진단 → 분석 → 검토)을 거쳐 예시 사건을 만들고 시각만 과거로 옮김.
const SEED_KEY = 'gridwitness.seeded.v1'
let seeding: Promise<void> | null = null

function seeded(): boolean {
  try {
    return localStorage.getItem(SEED_KEY) === '1'
  } catch {
    return true
  }
}
function markSeeded() {
  try {
    localStorage.setItem(SEED_KEY, '1')
  } catch {
    // 무시
  }
}

/** 사건의 모든 시각을 when 기준으로 옮기고 ID를 그 날짜로 바꿈 */
function retime(c: AnyCase, when: Date, seq: number) {
  const shift = when.getTime() - new Date(c.createdAt).getTime()
  const mv = (iso: string) => new Date(new Date(iso).getTime() + shift).toISOString()
  const ymd = `${when.getFullYear()}${String(when.getMonth() + 1).padStart(2, '0')}${String(when.getDate()).padStart(2, '0')}`
  c.id = `GW-${ymd}-${String(seq).padStart(3, '0')}`
  c.createdAt = mv(c.createdAt)
  c.diagnosis.checkedAt = mv(c.diagnosis.checkedAt)
  c.history.forEach((h) => (h.at = mv(h.at)))
  c.reviews.forEach((r) => (r.reviewedAt = mv(r.reviewedAt)))
  if (c.caseType === 'WAVEFORM' && c.analysis) c.analysis.executedAt = mv(c.analysis.executedAt)
  if (c.caseType === 'IOT') {
    c.detection.executedAt = mv(c.detection.executedAt)
    c.window.forEach((p) => (p.t += shift))
  }
}

export async function seedExamples() {
  const { seedPlan } = await import('./seed')
  instant = true
  try {
    const made: { c: AnyCase; when: Date }[] = []
    for (const step of seedPlan()) made.push({ c: await step(core), when: step.when })
    // 날짜별 순번으로 ID를 다시 매기고 최신순 정렬
    const perDay: Record<string, number> = {}
    for (const m of made.sort((a, b) => a.when.getTime() - b.when.getTime())) {
      const key = m.when.toDateString()
      perDay[key] = (perDay[key] ?? 0) + 1
      const stored = store.find((x) => x.id === m.c.id)!
      retime(stored, m.when, perDay[key])
    }
    store.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    save(store)
  } finally {
    instant = false
    markSeeded()
  }
}

async function ready() {
  if (seeded()) return
  seeding ??= seedExamples()
  await seeding
}

/** 사건을 모두 지우고(선택) 예시를 다시 넣음 */
export async function resetCases(withExamples: boolean) {
  store = []
  save(store)
  try {
    localStorage.removeItem(SEED_KEY)
  } catch {
    // 무시
  }
  seeding = null
  if (withExamples) await ready()
  else markSeeded()
}

export const mockApi: GridWitnessApi = {
  listCases: async () => (await ready(), core.listCases()),
  listActivity: async () => (await ready(), core.listActivity()),
  exportCases: async () => (await ready(), core.exportCases()),
  getCase: async (id) => (await ready(), core.getCase(id)),
  registerCase: async (input) => (await ready(), core.registerCase(input)),
  runAnalysis: async (id, type, actor) => (await ready(), core.runAnalysis(id, type, actor)),
  registerIotEvent: async (input) => (await ready(), core.registerIotEvent(input)),
  submitReview: async (id, review) => (await ready(), core.submitReview(id, review)),
}
