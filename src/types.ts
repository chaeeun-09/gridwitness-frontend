// 기획서 4.1 / 4.3 기준 도메인 타입. FastAPI 응답 스키마(Pydantic)와 1:1로 맞출 예정.

export const CHANNELS = ['Ia', 'Ib', 'Ic', 'In', 'Va', 'Vb', 'Vc'] as const
export type Channel = (typeof CHANNELS)[number]

export type SourceType = 'PUBLIC_DATASET' | 'FIELD_FRTU' | 'SYNTHETIC' | 'UNKNOWN'

export const SOURCE_LABEL: Record<SourceType, string> = {
  PUBLIC_DATASET: '공개 데이터셋',
  FIELD_FRTU: '현장 FRTU (승인 자료)',
  SYNTHETIC: '합성 데이터',
  UNKNOWN: '출처 불명',
}

/** ① 사고/원본 등록 */
export interface SourceRecord {
  fileName: string
  fileSize: number
  sha256: string
  sourceType: SourceType
  datasetId: string
  samplingRateHz: number
  systemFrequencyHz: 50 | 60
  channelOrder: string[]
  labelMeaning: string
  /** 업로드 형식 (없으면 CSV) */
  format?: 'CSV' | 'COMTRADE'
  /** COMTRADE .cfg에서 읽은 정보 */
  comtrade?: { station: string; device: string; revYear: string; fileType: string; mapping: Record<string, string> }
}

/** ② 입력 진단: 정상 / 제한 / 거부 */
export type DiagnosisStatus = 'ACCEPTED' | 'LIMITED' | 'REJECTED'

export interface DiagnosisIssue {
  code: string
  severity: 'error' | 'warning' | 'info'
  message: string
  fix?: string
}

export interface InputDiagnosis {
  status: DiagnosisStatus
  rows: number
  cols: number
  issues: DiagnosisIssue[]
  checkedAt: string
}

export type AnalysisType = 'EVENT_TYPE' | 'PHYSICAL_CAUSE' | 'NORMAL_VS_FAULT'

export const ANALYSIS_LABEL: Record<AnalysisType, string> = {
  EVENT_TYPE: '이벤트 유형 분류 (SIF·MIF·PF·TD)',
  PHYSICAL_CAUSE: '물리적 고장원인 추정 (수목 접촉·절연 파괴 등)',
  NORMAL_VS_FAULT: '정상/고장 탐지',
}

export const EVENT_LABELS = ['SIF', 'MIF', 'PF', 'TD'] as const
export type EventLabel = (typeof EVENT_LABELS)[number]

export interface ChannelFeatures {
  channel: Channel
  rms: number
  peak: number
  crestFactor: number
  diffRms: number
}

/** ④ AI 결과 / ⑤ 추가 확인 필요 */
export type AnalysisResult =
  | {
      kind: 'COMPLETED'
      analysisType: AnalysisType
      predictedLabel: EventLabel
      scores: Record<EventLabel, number>
      features: ChannelFeatures[]
      limitations: string[]
      modelVersion: string
      preprocessVersion: string
      executedAt: string
    }
  | {
      kind: 'WITHHELD'
      analysisType: AnalysisType
      reasons: string[]
      neededInfo: string[]
      features: ChannelFeatures[] | null
      scores: Record<EventLabel, number> | null
      modelVersion: string | null
      preprocessVersion: string | null
      executedAt: string
    }

/** ⑥ 사람 검토 — AI 결과와 분리 저장 */
export interface Review {
  reviewer: string
  verdict: 'AGREE' | 'DISAGREE' | 'NEEDS_INVESTIGATION'
  finalJudgment: string
  additionalInvestigation: string
  reviewedAt: string
}

export const VERDICT_LABEL: Record<Review['verdict'], string> = {
  AGREE: 'AI 결과에 동의',
  DISAGREE: 'AI 결과와 다르게 판단',
  NEEDS_INVESTIGATION: '추가 조사 필요',
}

export interface HistoryEvent {
  at: string
  actor: string
  action: string
  detail?: string
}

export type CaseStage = 'REGISTERED' | 'DIAGNOSED' | 'ANALYZED' | 'WITHHELD' | 'REVIEWED'

export type CaseType = 'WAVEFORM' | 'IOT'

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  WAVEFORM: '고장파형 분석',
  IOT: 'IoT 이상 이벤트',
}

export interface IncidentCase {
  caseType: 'WAVEFORM'
  id: string
  title: string
  createdAt: string
  stage: CaseStage
  source: SourceRecord
  diagnosis: InputDiagnosis
  /** 행 = 샘플, 열 = 채널 */
  waveform: number[][] | null
  analysis: AnalysisResult | null
  reviews: Review[]
  history: HistoryEvent[]
  /** 백엔드 모드에서 서버가 부여한 ID. Mock 사건에는 없음 */
  backend?: { incidentId: string; validationId: string | null; analysisId: string | null }
}

// ── IoT (Arduino + INA219 모형) ─────────────────────────

export interface IotPoint {
  t: number
  v: number
  i: number
  expected: number
  score: number
}

export interface IotDetection {
  model: string
  maxScore: number
  status: 'WARNING' | 'FAULT' | 'OUTAGE'
  maxResidualA: number
  minV: number
  findings: string[]
  limitations: string[]
  executedAt: string
}

/** IoT 이상 이벤트 사건. 모형의 DC 계측 기록이며 교류 고장파형과 섞지 않음. */
export interface IotCase {
  caseType: 'IOT'
  id: string
  title: string
  createdAt: string
  stage: CaseStage
  device: {
    deviceId: string
    sensor: string
    /** 측정 범위 (INA219 1개 → 마을 전체) */
    scope: string
    nominalV: number
    expectedA: number
    relayOn: boolean
    faultInjected: string | null
  }
  window: IotPoint[]
  diagnosis: InputDiagnosis
  detection: IotDetection
  reviews: Review[]
  history: HistoryEvent[]
}

export type AnyCase = IncidentCase | IotCase

export interface CaseSummary {
  caseType: CaseType
  id: string
  title: string
  createdAt: string
  stage: CaseStage
  source: string
  diagnosisStatus: DiagnosisStatus
}

/** 모든 사건의 실행 이력을 시간순으로 펼친 항목 (관리자 활동 기록용) */
export interface ActivityItem {
  at: string
  actor: string
  action: string
  detail?: string
  caseId: string
  caseTitle: string
  caseType: CaseType
}
