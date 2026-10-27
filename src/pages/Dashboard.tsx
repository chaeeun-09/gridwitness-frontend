import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { DiagnosisBadge, StageBadge } from '../components/Badges'
import EventList from '../components/EventList'
import { IconHistory } from '../components/Icons'
import Sparkline from '../components/Sparkline'
import { Empty, ErrorState, Metric, Metrics, NODE_TONE, PageHeader, Section, Status, TableSkeleton } from '../components/ui'
import { fmtTime } from '../lib/actor'
import { STATUS_LABEL, useVillage } from '../lib/village'
import type { CaseSummary } from '../types'

export default function Dashboard() {
  const snap = useVillage()
  const nav = useNavigate()
  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    api.listCases().then(setCases).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const alarm = snap.status === 'WARNING' || snap.status === 'FAULT' || snap.status === 'OUTAGE'
  const openEvents = snap.events.filter((e) => !e.clearedAt).length
  const pendingReview = cases?.filter((c) => c.stage !== 'REVIEWED').length ?? 0
  const residual = snap.i - snap.expected

  return (
    <>
      <PageHeader
        title="개요"
        description="마을 전력 상태와 최근 사건"
        actions={
          <>
            <Link to="/cases/new" className="btn">고장파형 등록</Link>
            <Link to="/village" className="btn btn-primary">스마트 마을 열기</Link>
          </>
        }
      />

      <Metrics>
        <Metric
          label="마을 전력"
          value={<Status tone={NODE_TONE[snap.status]} live={alarm}><span style={{ fontSize: 20, fontWeight: 600 }}>{STATUS_LABEL[snap.status]}</span></Status>}
          foot={`켜진 LED ${snap.estLit}/5 · ${snap.v.toFixed(2)} V · ${snap.p.toFixed(2)} W`}
        />
        <Metric label="전류" value={snap.i.toFixed(3)} unit="A" foot={<span className={Math.abs(residual) > 0.04 ? 'bad' : ''}>예상 {snap.expected.toFixed(3)} A · 차이 {residual >= 0 ? '+' : ''}{residual.toFixed(3)}</span>}>
          <Sparkline values={snap.history.map((h) => h.i)} minSpan={0.06} />
        </Metric>
        <Metric label="진행 중 이상" value={openEvents} unit="건" foot={cases ? `검토 대기 사건 ${pendingReview}건` : ' '} />
      </Metrics>

      <Section title="이상 이벤트" description="이상 점수가 기준을 넘으면 기록됩니다" actions={<Link to="/live" className="small">실시간 분석 →</Link>}>
        <EventList events={snap.events} limit={3} />
      </Section>

      <Section title="최근 사건" actions={<Link to="/history" className="small">전체 보기 →</Link>}>
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !cases ? (
          <TableSkeleton rows={3} />
        ) : cases.length === 0 ? (
          <Empty compact icon={<IconHistory />} title="아직 등록된 사건이 없습니다" description="이상 이벤트를 사건으로 등록하거나 고장파형을 올리면 여기에 쌓입니다." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>사건</th><th>데이터 점검</th><th>단계</th><th className="num">등록</th></tr>
              </thead>
              <tbody>
                {cases.slice(0, 4).map((c) => (
                  <tr key={c.id} className="clickable" onClick={() => nav(`/${c.caseType === 'IOT' ? 'history' : 'cases'}/${c.id}`)}>
                    <td><span className="strong">{c.title}</span></td>
                    <td><DiagnosisBadge status={c.diagnosisStatus} /></td>
                    <td><StageBadge stage={c.stage} /></td>
                    <td className="num muted">{fmtTime(c.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  )
}
