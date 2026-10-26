import type { CaseStage, DiagnosisStatus } from '../types'
import { Badge, DIAG_LABEL, DIAG_TONE, STAGE_INFO, Status } from './ui'

export function DiagnosisBadge({ status }: { status: DiagnosisStatus }) {
  return <Status tone={DIAG_TONE[status]}>{DIAG_LABEL[status]}</Status>
}

export function StageBadge({ stage }: { stage: CaseStage }) {
  const [label, tone] = STAGE_INFO[stage]
  return <Badge tone={tone}>{label}</Badge>
}

/** 진행 단계 표시. done = 완료한 단계 수 */
export function Steps({ steps, done }: { steps: string[]; done: number }) {
  return (
    <ol className="steps" aria-label="진행 단계">
      {steps.map((label, i) => (
        <li key={label} className={i < done ? 'done' : i === done ? 'current' : ''} aria-current={i === done ? 'step' : undefined}>
          <span className="step-no">{i + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  )
}

export const WAVEFORM_STEPS = ['원본 등록', '입력 검사', '범위 확인', '분석·보류', '근거 제시', '사람 검토']

export function waveformStepsDone(stage: CaseStage): number {
  return { REGISTERED: 1, DIAGNOSED: 2, ANALYZED: 5, WITHHELD: 5, REVIEWED: 6 }[stage]
}
