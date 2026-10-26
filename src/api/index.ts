import type { VillageEvent } from '../lib/village'
import type { AnalysisType, AnyCase, CaseSummary, IncidentCase, IotCase, Review, SourceType } from '../types'
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
  getCase(id: string): Promise<AnyCase>
  registerCase(input: RegisterCaseInput): Promise<IncidentCase>
  runAnalysis(id: string, analysisType: AnalysisType, actor: string): Promise<IncidentCase>
  registerIotEvent(input: { event: VillageEvent; actor: string }): Promise<IotCase>
  submitReview(id: string, review: Omit<Review, 'reviewedAt'>): Promise<AnyCase>
}

// 시연용: 브라우저 목 API(localStorage)로만 동작
export const api: GridWitnessApi = mockApi
export const isMock = true
