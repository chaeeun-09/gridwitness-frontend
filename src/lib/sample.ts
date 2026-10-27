import { CHANNELS, type IncidentCase } from '../types'
import { computeFeatures, diagnose, parseCsv, PREPROCESS_VERSION, sha256Hex, synthesize, toCsv } from './waveform'

export const SAMPLE_ID = 'GW-SAMPLE01'

/** 서버 없이도 그래프를 볼 수 있는 합성 샘플 사건. 앱의 사건 목록과 소개 화면이 같은 것을 쓴다 */
export async function buildSampleCase(): Promise<IncidentCase> {
  const matrix = synthesize({ phase: 0, seed: 101, currentGain: 6.2 })
  const csv = toCsv(matrix)
  const bytes = new TextEncoder().encode(csv)
  const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer)
  const samplingRateHz = 4096
  const systemFrequencyHz = 50
  const { diagnosis } = diagnose(parseCsv(csv), bytes.length, { samplingRateHz, systemFrequencyHz, sourceType: 'SYNTHETIC' })
  const t = new Date().toISOString()
  return {
    caseType: 'WAVEFORM',
    id: SAMPLE_ID,
    title: 'A상 지락 합성 샘플',
    createdAt: t,
    stage: 'WITHHELD',
    source: { fileName: 'sample_a_ground.csv', fileSize: bytes.length, sha256, sourceType: 'SYNTHETIC', datasetId: '', samplingRateHz, systemFrequencyHz, channelOrder: [...CHANNELS], labelMeaning: '', format: 'CSV' },
    diagnosis,
    waveform: matrix,
    analysis: {
      kind: 'WITHHELD',
      analysisType: 'EVENT_TYPE',
      reasons: ['서버에 분석 모델이 아직 연결되지 않아 유형 판단은 보류합니다. 아래 근거는 파형에서 직접 계산한 값입니다.'],
      neededInfo: ['서버에 분석 모델 설정'],
      features: computeFeatures(matrix),
      scores: null,
      modelVersion: null,
      preprocessVersion: PREPROCESS_VERSION,
      executedAt: t,
    },
    reviews: [],
    history: [{ at: t, actor: 'system', action: '샘플 생성', detail: '합성 파형 · 이 브라우저에만 있고 서버에는 올리지 않음' }],
  }
}
