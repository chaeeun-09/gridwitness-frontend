import type { VillageEvent } from '../lib/village'
import type { ActivityItem, AnalysisType, AnyCase, CaseSummary, IncidentCase, IotCase, Review, SourceType } from '../types'
import { apiMode } from '../lib/backend'
import { backendApi } from './backend'
import { mockApi } from './mock'

export interface RegisterCaseInput {
  title: string
  /** CSV 파일, 또는 COMTRADE .dat 파일 */
  file: File
  /** COMTRADE .cfg (있으면 COMTRADE로 읽음) */
  cfg?: File
  sourceType: SourceType
  datasetId: string
  samplingRateHz: number
  systemFrequencyHz: 50 | 60
  labelMeaning: string
  actor: string
}

export interface GridWitnessApi {
  listCases(): Promise<CaseSummary[]>
  /** 모든 사건의 이력을 최신순으로 */
  listActivity(): Promise<ActivityItem[]>
  /** 관리자 내보내기용 전체 사건 */
  exportCases(): Promise<AnyCase[]>
  getCase(id: string): Promise<AnyCase>
  registerCase(input: RegisterCaseInput): Promise<IncidentCase>
  runAnalysis(id: string, analysisType: AnalysisType, actor: string): Promise<IncidentCase>
  registerIotEvent(input: { event: VillageEvent; actor: string }): Promise<IotCase>
  submitReview(id: string, review: Omit<Review, 'reviewedAt'>): Promise<AnyCase>
}

// 설정의 모드에 따라 브라우저 Mock 또는 FastAPI 서버. 모드를 바꾸면 페이지를 새로 불러온다.
export const isMock = apiMode() === 'MOCK'
export const api: GridWitnessApi = isMock ? mockApi : backendApi
