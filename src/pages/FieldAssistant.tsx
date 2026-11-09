import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import AssistantChat from '../components/AssistantChat'
import FieldNotes from '../components/FieldNotes'
import { IconChevron } from '../components/Icons'
import { Empty, ErrorState, PageSkeleton } from '../components/ui'
import { eventKo } from '../lib/incidentContext'
import type { AnyCase, IncidentCase } from '../types'

/** 현장 담당자용 사건 화면 (스마트폰 우선): 사건 요약 한 줄 + 음성·글 대화 */
export default function FieldAssistant() {
  const { id = '' } = useParams()
  const [c, setC] = useState<AnyCase | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    api.getCase(id).then(setC).catch((e: Error) => setError(e.message))
  }, [id])
  useEffect(load, [load])

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!c) return <PageSkeleton />
  if (c.caseType !== 'WAVEFORM')
    return (
      <Empty
        title="현장 대응 AI는 고장파형 사건만 다뤄요"
        description="이 사건은 마을 모형의 직류 계측 기록이에요. 교류 고장파형 분석과 섞지 않기 위해 대화 AI에 연결하지 않아요."
        action={<Link className="btn" to={`/cases/${c.id}`}>사건 화면으로</Link>}
      />
    )
  return <FieldView c={c} />
}

function FieldView({ c }: { c: IncidentCase }) {
  const a = c.analysis
  const last = c.reviews[c.reviews.length - 1]
  const aiText = !a ? '분석 전' : a.kind === 'COMPLETED' ? eventKo(a.predictedLabel) : '판단 보류'
  const aiTone = !a ? 'off' : a.kind === 'COMPLETED' ? 'ok' : 'warn'
  return (
    <div className="field-page">
      <header className="field-head">
        <Link to={`/cases/${c.id}`} className="field-back" aria-label="사건 상세로 돌아가기"><IconChevron /></Link>
        <div className="field-title">
          <span className="mono small muted">{c.id}</span>
          <h1>{c.title}</h1>
        </div>
      </header>
      <div className="field-chips">
        <span className={`field-chip ${aiTone}`}><small>AI 결과</small>{aiText}</span>
        <span className={`field-chip ${c.diagnosis.status === 'ACCEPTED' ? 'ok' : c.diagnosis.status === 'LIMITED' ? 'warn' : 'err'}`}>
          <small>입력 검사</small>{{ ACCEPTED: '통과', LIMITED: '제한', REJECTED: '거부' }[c.diagnosis.status]}
        </span>
        <span className={`field-chip ${last ? 'ok' : 'off'}`}><small>담당자 검토</small>{last ? '완료' : '대기'}</span>
      </div>
      <details className="fnotes-fold">
        <summary>현장 메모 남기기</summary>
        <FieldNotes c={c} />
      </details>
      <AssistantChat c={c} variant="field" />
    </div>
  )
}
