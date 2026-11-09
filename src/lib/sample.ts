import { CHANNELS, type IncidentCase } from '../types'
import { loadRealSamples, XIONG_DATASET_ID } from './scenarios'
import { computeFeatures, diagnose, parseCsv, PREPROCESS_VERSION, sha256Hex } from './waveform'

export const SAMPLE_ID = 'GW-SAMPLE01'

/** 서버 없이도 그래프를 볼 수 있는 샘플 사건 = 실제 공개 파형(Xiong 87, SIF) 원본. 앱의 사건 목록과 소개 화면이 같은 것을 쓴다 */
export async function buildSampleCase(): Promise<IncidentCase> {
  const sample = (await loadRealSamples()).SIF
  const csv = sample.text
  const matrix = sample.matrix
  const bytes = new TextEncoder().encode(csv)
  const sha256 = await sha256Hex(bytes.buffer as ArrayBuffer)
  const samplingRateHz = 4096
  const systemFrequencyHz = 50
  const { diagnosis } = diagnose(parseCsv(csv), bytes.length, { samplingRateHz, systemFrequencyHz, sourceType: 'PUBLIC_DATASET' })
  const t = new Date().toISOString()
  return {
    caseType: 'WAVEFORM',
    id: SAMPLE_ID,
    title: 'SIF · Xiong 공개 파형 87 (샘플)',
    createdAt: t,
    stage: 'WITHHELD',
    source: { fileName: `${sample.id}.csv`, fileSize: bytes.length, sha256, sourceType: 'PUBLIC_DATASET', datasetId: XIONG_DATASET_ID, samplingRateHz, systemFrequencyHz, channelOrder: [...CHANNELS], labelMeaning: '데이터셋 라벨: SIF (이벤트 유형, 물리적 원인 아님)', format: 'CSV' },
    diagnosis,
    waveform: matrix,
    analysis: {
      kind: 'WITHHELD',
      analysisType: 'EVENT_TYPE',
      reasons: ['이 샘플은 브라우저에만 있는 사건이라 서버 AI 분석을 하지 않았습니다. 아래 근거는 파형에서 직접 계산한 값입니다.'],
      neededInfo: ['같은 파일을 새 사건으로 등록하면 서버 AI가 분석합니다'],
      features: computeFeatures(matrix),
      scores: null,
      modelVersion: null,
      preprocessVersion: PREPROCESS_VERSION,
      executedAt: t,
    },
    reviews: [],
    history: [{ at: t, actor: 'system', action: '샘플 생성', detail: 'Xiong 공개 파형 원본(MIT) · 이 브라우저에만 있고 서버에는 올리지 않음' }],
  }
}
