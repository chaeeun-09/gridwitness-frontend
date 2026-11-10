import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { DiagnosisBadge, StageBadge } from '../components/Badges'
import { IconAnalysis, IconPlus } from '../components/Icons'
import ModelCardPanel from '../components/ModelCardPanel'
import { Badge, Empty, ErrorState, PageHeader, TableSkeleton } from '../components/ui'
import { fmtTime } from '../lib/actor'
import { API_CHANGED_EVENT } from '../lib/backend'
import type { CaseSummary } from '../types'

type Filter = 'ALL' | 'PENDING' | 'REVIEWED'
const FILTER_LABEL: Record<Filter, string> = { ALL: '전체', PENDING: '검토 대기', REVIEWED: '검토 완료' }

/** 고장파형 분석 사건 목록. 검토 상태별로 걸러 볼 수 있음 (IoT 이상 사건은 스마트 마을 이벤트에서 열림) */
export default function CaseList() {
  const nav = useNavigate()
  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('ALL')
  const load = useCallback(() => {
    setError(null)
    api.listCases().then((all) => setCases(all.filter((c) => c.caseType === 'WAVEFORM'))).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(() => {
    load()
    const refresh = () => { if (!document.hidden) load() }
    const timer = setInterval(refresh, 30_000)
    window.addEventListener('focus', refresh)
    window.addEventListener(API_CHANGED_EVENT, load)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener(API_CHANGED_EVENT, load) }
  }, [load])

  const match = (c: CaseSummary, f: Filter) => f === 'ALL' || (f === 'REVIEWED') === (c.stage === 'REVIEWED')
  const shown = cases?.filter((c) => match(c, filter))
  const count = (f: Filter) => cases?.filter((c) => match(c, f)).length ?? 0
  const pathOf = (c: CaseSummary) => `/cases/${c.id}`

  return (
    <>
      <PageHeader
        title="고장파형 분석"
        description="CN 7채널·RU 5채널 입력을 각 모델 계약에 맞춰 검사하고, 분석 결과와 사람의 검토를 서버에 기록합니다."
        actions={
          <Link to="/cases/new" className="btn btn-primary">
            <IconPlus />
            고장파형 등록
          </Link>
        }
      />
      {cases?.some((c) => c.sync?.error) && <div className="alert alert-warn" role="status">{cases.find((c) => c.sync?.error)?.sync?.error} <button className="btn btn-sm" onClick={load}>다시 불러오기</button></div>}

      <div className="tabs" role="tablist">
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <button key={f} role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
            {FILTER_LABEL[f]}
            <span className="count">{count(f)}</span>
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !shown ? (
        <TableSkeleton />
      ) : shown.length === 0 ? (
        <Empty
          icon={<IconAnalysis />}
          title={filter === 'ALL' ? '분석한 고장파형이 없습니다' : `${FILTER_LABEL[filter]} 사건이 없습니다`}
          description="CSV 파형을 올리면 해시를 남기고 입력 진단부터 시작합니다. 실제 공개 파형 샘플로 바로 시험해 볼 수도 있습니다."
          action={filter === 'ALL' ? <Link to="/cases/new" className="btn btn-primary">고장파형 등록</Link> : undefined}
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>사건</th>
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
                    <div className="mono xs faint">{c.id}{c.needsWaveform && <> · <Badge tone="warn">원본 CSV 필요</Badge></>}</div>
                  </td>
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
      <div className="section">
        <ModelCardPanel />
      </div>
    </>
  )
}
