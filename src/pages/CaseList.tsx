import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { DiagnosisBadge, StageBadge } from '../components/Badges'
import { IconAnalysis, IconHistory, IconPlus } from '../components/Icons'
import { Empty, ErrorState, PageHeader, TableSkeleton } from '../components/ui'
import { fmtTime } from '../lib/actor'
import { CASE_TYPE_LABEL, type CaseSummary, type CaseType } from '../types'

type Filter = 'ALL' | CaseType

/** mode=waveform: 고장파형 분석 화면 / mode=all: 사건·검토 이력 (유형별 구분) */
export default function CaseList({ mode }: { mode: 'waveform' | 'all' }) {
  const nav = useNavigate()
  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('ALL')
  const load = useCallback(() => {
    setError(null)
    api.listCases().then(setCases).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const effective: Filter = mode === 'waveform' ? 'WAVEFORM' : filter
  const shown = cases?.filter((c) => effective === 'ALL' || c.caseType === effective)
  const count = (t: Filter) => cases?.filter((c) => t === 'ALL' || c.caseType === t).length ?? 0
  const pathOf = (c: CaseSummary) => `/${c.caseType === 'IOT' ? 'history' : 'cases'}/${c.id}`

  return (
    <>
      <PageHeader
        title={mode === 'waveform' ? '고장파형 분석' : '사건·검토 이력'}
        description={
          mode === 'waveform'
            ? '공개 고장파형 데이터 기준으로 7채널 입력을 검사하고, 지원하는 분석만 실행한 뒤 사람이 검토합니다.'
            : 'IoT 이상 이벤트와 고장파형 분석 사건의 진행 상황과 검토 기록을 추적합니다.'
        }
        actions={
          <Link to="/cases/new" className="btn btn-primary">
            <IconPlus />
            고장파형 등록
          </Link>
        }
      />

      {mode === 'all' && (
        <div className="tabs" role="tablist">
          {(['ALL', 'IOT', 'WAVEFORM'] as Filter[]).map((f) => (
            <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'ALL' ? '전체' : CASE_TYPE_LABEL[f]}
              <span className="count">{count(f)}</span>
            </button>
          ))}
        </div>
      )}

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !shown ? (
        <TableSkeleton />
      ) : shown.length === 0 ? (
        effective === 'IOT' ? (
          <Empty icon={<IconHistory />} title="IoT 이상 사건이 없습니다" description="스마트 마을이나 실시간 분석에서 이상 이벤트를 사건으로 등록하면 여기에 나타납니다." action={<Link to="/village" className="btn">스마트 마을 열기</Link>} />
        ) : (
          <Empty
            icon={<IconAnalysis />}
            title={mode === 'waveform' ? '분석한 고장파형이 없습니다' : '등록된 사건이 없습니다'}
            description="CSV 파형을 올리면 해시를 남기고 입력 진단부터 시작합니다. 합성 예시로 바로 시험해 볼 수도 있습니다."
            action={<Link to="/cases/new" className="btn btn-primary">고장파형 등록</Link>}
          />
        )
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>사건</th>
                {mode === 'all' && <th>유형</th>}
                <th>출처</th>
                <th>데이터 점검</th>
                <th>단계</th>
                <th className="num">등록</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className="clickable" onClick={() => nav(pathOf(c))}>
                  <td>
                    <Link to={pathOf(c)} className="strong" style={{ color: 'var(--ink)' }} onClick={(e) => e.stopPropagation()}>{c.title}</Link>
                    <div className="mono xs faint">{c.id}</div>
                  </td>
                  {mode === 'all' && <td className="muted">{CASE_TYPE_LABEL[c.caseType]}</td>}
                  <td className="muted">{c.source}</td>
                  <td><DiagnosisBadge status={c.diagnosisStatus} /></td>
                  <td><StageBadge stage={c.stage} /></td>
                  <td className="num muted">{fmtTime(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
