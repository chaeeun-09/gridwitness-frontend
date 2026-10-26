import type { GridWitnessApi, RegisterCaseInput } from '.'
import { toComtrade } from '../lib/comtrade'
import { LED_A, type VillageEvent } from '../lib/village'
import { synthesize, syntheticCsv, toCsv } from '../lib/waveform'
import type { AnyCase, IotPoint } from '../types'

// 처음 실행할 때 넣는 예시 사건. 모두 합성 데이터이며 제목에 [예시]를 붙임.
// 처리 과정은 실제 업로드와 같은 코드(입력 진단·분석·검토)를 그대로 거침.

type Step = ((api: GridWitnessApi) => Promise<AnyCase>) & { when: Date }

const HOUR = 3600_000
const ago = (h: number) => new Date(Date.now() - h * HOUR)

function step(hoursAgo: number, run: (api: GridWitnessApi) => Promise<AnyCase>): Step {
  return Object.assign(run, { when: ago(hoursAgo) })
}

const csvFile = (name: string, text: string) => new File([text], name, { type: 'text/csv' })

const base = (title: string, file: File, extra: Partial<RegisterCaseInput> = {}): RegisterCaseInput => ({
  title,
  file,
  sourceType: 'SYNTHETIC',
  datasetId: 'gridwitness-example',
  samplingRateHz: 4096,
  systemFrequencyHz: 50,
  labelMeaning: '이벤트 유형(SIF/MIF/PF/TD), 물리적 원인 아님',
  actor: '분석 담당자',
  ...extra,
})

/** IoT 이상 구간 (0.5초 간격 40점, 20번째부터 이상) */
function iotWindow(kind: 'open' | 'sag' | 'stuck', startMs: number): IotPoint[] {
  let seed = kind === 'open' ? 7 : kind === 'sag' ? 11 : 13
  const n = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  return Array.from({ length: 40 }, (_, k) => {
    const after = k >= 20
    // 고착: 20번째에 차단 명령(예상 0 A)을 보냈지만 전류가 그대로 흐름
    const expected = kind === 'stuck' && after ? 0 : LED_A * 5
    const v = kind === 'sag' && after ? 4.25 + n() * 0.04 : 5.02 + n() * 0.01
    const i = kind === 'open' && after ? LED_A * 4 + n() * 0.002 : kind === 'sag' && after ? 0.238 + n() * 0.003 : LED_A * 5 + n() * 0.003
    const score = Math.min(1, Math.max(Math.abs(i - expected) / (LED_A * 2), Math.max(0, 4.75 - v) / 0.75))
    return { t: startMs + k * 500, v, i, expected, score }
  })
}

function iotEvent(kind: 'open' | 'sag' | 'stuck', when: Date): VillageEvent {
  const window = iotWindow(kind, when.getTime() - 10_000)
  return {
    id: { open: 9001, sag: 9002, stuck: 9003 }[kind],
    label: { open: '[예시] 전체 전류가 LED 1개 분량 감소', sag: '[예시] 어댑터 전압 강하', stuck: '[예시] 차단 명령 후에도 전류 흐름' }[kind],
    source: 'MOCK',
    at: new Date(window[20].t).toISOString(),
    injected: ({ open: 'OPEN', sag: 'SAG', stuck: 'STUCK' } as const)[kind],
    injectedAt: new Date(window[19].t).toISOString(),
    status: kind === 'open' ? 'WARNING' : 'FAULT',
    relayOn: kind !== 'stuck',
    maxScore: Math.max(...window.map((p) => p.score)),
    expected: kind === 'stuck' ? 0 : LED_A * 5,
    window,
    clearedAt: new Date(window[39].t + 4000).toISOString(),
    caseId: null,
  }
}

export function seedPlan(): Step[] {
  return [
    // 1. 정상 입력 → 분류 완료 → 사람 검토까지 끝난 사건
    step(74, async (api) => {
      const c = await api.registerCase(base('[예시] A상 지락 · 분석·검토 완료', csvFile('example_a_ground.csv', toCsv(synthesize({ phase: 0, seed: 101, currentGain: 6.2 })))))
      await api.runAnalysis(c.id, 'EVENT_TYPE', '분석 담당자')
      return api.submitReview(c.id, {
        reviewer: '검토 담당자',
        verdict: 'AGREE',
        finalJudgment: 'AI 이벤트 유형 결과를 참고로 채택. 물리적 원인은 현장 조사 후 별도 기록.',
        additionalInvestigation: '해당 구간 순시 점검 요청',
      })
    }),
    // 2. 짧은 순간 이상 → 점수가 기준 미만이면 보류
    step(51, async (api) => {
      const c = await api.registerCase(base('[예시] B상 순간 이상 · 판단 보류', csvFile('example_b_transient.csv', toCsv(synthesize({ phase: 1, seed: 202, onset: 700, duration: 180, currentGain: 2.4, voltageGain: 0.75 })))))
      return api.runAnalysis(c.id, 'EVENT_TYPE', '분석 담당자')
    }),
    // 3. 국내 60Hz FRTU 형식 (COMTRADE) → 모델 학습 범위 밖이라 제한·보류
    step(27, async (api) => {
      const m = synthesize({ phase: 2, seed: 303, systemHz: 60, fs: 3840, rows: 1280, onset: 640 })
      const { cfg, dat } = toComtrade(m, { station: 'EXAMPLE_SS', device: 'FRTU-EX01', fs: 3840, lf: 60 })
      const c = await api.registerCase({
        ...base('[예시] 국내 60Hz FRTU 기록 (COMTRADE) · 범위 밖', new File([dat], 'frtu_example.dat'), { datasetId: 'FRTU-EX01', systemFrequencyHz: 60, samplingRateHz: 3840, labelMeaning: '라벨 없음 (현장 기록 형식 예시)' }),
        cfg: new File([cfg], 'frtu_example.cfg'),
      })
      return api.runAnalysis(c.id, 'EVENT_TYPE', '분석 담당자')
    }),
    // 4. 형식 오류 → 입력 진단에서 거부
    step(26, async (api) => api.registerCase(base('[예시] 결측·채널 누락 기록 · 입력 거부', csvFile('example_broken.csv', syntheticCsv('broken', { seed: 404 }))))),
    // 5. 지원하지 않는 분석(물리적 원인) 요청 → 보류
    step(5, async (api) => {
      const c = await api.registerCase(base('[예시] C상 지락 · 원인 추정 요청', csvFile('example_c_ground.csv', toCsv(synthesize({ phase: 2, seed: 505 })))))
      return api.runAnalysis(c.id, 'PHYSICAL_CAUSE', '분석 담당자')
    }),
    // 6. IoT: LED 1개 분량 전류 감소 → 사람이 현장에서 주택 2 LED 단선 확인
    step(30, async (api) => {
      const c = await api.registerIotEvent({ event: iotEvent('open', new Date()), actor: '분석 담당자' })
      return api.submitReview(c.id, {
        reviewer: '검토 담당자',
        verdict: 'AGREE',
        finalJudgment: '모형 확인 결과 주택 2 LED 다리 접촉 불량. 재삽입 후 정상.',
        additionalInvestigation: '브레드보드 2 단자 나사 재체결',
      })
    }),
    // 7. IoT: 어댑터 전압 강하 → 검토 대기
    step(3, async (api) => api.registerIotEvent({ event: iotEvent('sag', new Date()), actor: '분석 담당자' })),
    // 8. IoT: 정전 명령을 보냈는데 전류가 계속 흐름 (릴레이 접점 고착) → 검토 대기
    step(1, async (api) => api.registerIotEvent({ event: iotEvent('stuck', new Date()), actor: '분석 담당자' })),
  ]
}
