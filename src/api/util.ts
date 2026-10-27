import { SOURCE_LABEL, type AnyCase, type CaseSummary } from '../types'

/** 목록에 보여줄 요약 */
export function summarize(c: AnyCase): CaseSummary {
  return {
    caseType: c.caseType,
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    stage: c.stage,
    source: c.caseType === 'IOT' ? `IoT 모형 · ${c.device.scope}` : SOURCE_LABEL[c.source.sourceType],
    diagnosisStatus: c.diagnosis.status,
  }
}
