import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { DiagnosisBadge, StageBadge } from '../components/Badges'
import { IconAlert, IconArrowRight, IconBolt, IconBrain, IconChevron, IconInbox, IconWave } from '../components/Icons'
import { Badge, ErrorState, TableSkeleton, type Tone } from '../components/ui'
import { fmtTime } from '../lib/actor'
import { CHART } from '../lib/chart'
import { useCity } from '../lib/city'
import { STATUS_LABEL, useVillage } from '../lib/village'
import { useVillageEvents, type AnalyzedEvent } from '../lib/villageEvents'
import type { CaseSummary } from '../types'

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function Kpi({ label, value, chip, icon, primary }: { label: string; value: ReactNode; chip: ReactNode; icon: ReactNode; primary?: boolean }) {
  return (
    <div className={`kpi ${primary ? 'primary' : ''}`}>
      <div className="kpi-top">
        <span>{label}</span>
        <span className="kpi-icon">{icon}</span>
      </div>
      <div className="kpi-value">{value}</div>
      <span className="kpi-chip">{chip}</span>
    </div>
  )
}

function verdictOf(a: AnalyzedEvent): { tone: Tone; text: string; score: string } {
  const v = a.verdict
  if (v.kind === 'ANSWERED') return { tone: v.isFault ? 'err' : 'ok', text: v.labelKo, score: `${Math.round(v.score * 100)}%` }
  if (v.kind === 'WITHHELD') return { tone: 'warn', text: `보류 (1순위 ${v.labelKo})`, score: `${Math.round(v.score * 100)}%` }
  if (v.kind === 'NO_MODEL') return { tone: 'off', text: '모델 학습 전', score: '—' }
  return { tone: 'err', text: '입력 거부', score: '—' }
}

export default function Dashboard() {
  const snap = useVillage()
  const city = useCity()
  const events = useVillageEvents()
  const nav = useNavigate()
  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    api.listCases().then(setCases).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])
  const [now] = useState(() => new Date())

  const open = snap.events.filter((e) => !e.clearedAt)
  const withheld = events.filter((a) => a.verdict.kind === 'WITHHELD').length
  const pending = cases?.filter((c) => c.stage !== 'REVIEWED') ?? []
  const subsBad = city.subs.filter((s) => s.status !== 'OK').length
  const t0 = snap.history.length ? snap.history[snap.history.length - 1].t : 0
  const data = snap.history.map((h) => ({ t: (h.t - t0) / 1000, mA: h.i * 1000 }))

  // AI 판정과 규칙 기반 이상을 한 표에 시간순으로
  const rows = [
    ...events.map((a) => ({ key: `a${a.e.ev}${a.e.receivedAt}`, at: a.e.receivedAt, name: `사건 #${a.e.ev} · ${a.e.src === 'cmd' ? '개폐 명령 직후' : '전류 급변'}`, by: 'AI', ...verdictOf(a) })),
    ...snap.events.map((e) => ({ key: `r${e.id}`, at: e.at, name: e.label ?? `마을 ${STATUS_LABEL[e.status]}`, by: '규칙', tone: (e.status === 'WARNING' ? 'warn' : 'err') as Tone, text: STATUS_LABEL[e.status], score: e.maxScore.toFixed(2) })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6)

  return (
    <div className="dash">
      <Link to="/village" className="dash-back"><span className="dash-back-icon"><IconChevron /></span>3D 마을로</Link>
      <div className="dash-head">
        <div>
          <h1>오늘의 관제 현황</h1>
          <p>이상 신호, AI 판정, 검토할 사건을 한눈에 봐요.</p>
        </div>
        <span className="dash-stamp">기준 {now.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
      </div>

      <div className="kpi-row">
        <Kpi primary label="진행 중 이상" value={`${open.length}건`} chip={snap.connected ? `마을 ${STATUS_LABEL[snap.status]}` : '실측 장치 연결 끊김'} icon={<IconAlert />} />
        <Kpi label="AI 판정" value={`${events.length}건`} chip={`보류 ${withheld}건`} icon={<IconBrain />} />
        <Kpi label="검토 대기 사건" value={cases ? `${pending.length}건` : '—'} chip={cases ? `전체 ${cases.length}건` : '불러오는 중'} icon={<IconInbox />} />
        <Kpi label="도시 변전소" value={`${city.subs.length - subsBad}/${city.subs.length}`} chip={subsBad ? `이상 ${subsBad}곳` : '모두 정상'} icon={<IconBolt />} />
      </div>

      <div className="dash-cols">
        <section className="dash-card">
          <div className="dash-card-head">
            <h2>최근 판정</h2>
            <Link to="/village?ai=1" className="pill-link">AI 분석 열기 <IconArrowRight /></Link>
          </div>
          {rows.length === 0 ? (
            <p className="muted" style={{ margin: '8px 4px' }}>아직 판정할 사건이 없어요. 마을에서 LED를 끄거나 정전을 일으키면 여기에 쌓여요.</p>
          ) : (
            <table className="dash-table">
              <thead><tr><th>사건</th><th>판정</th><th>판정 주체</th><th className="num">점수</th><th className="num">시각</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="clickable" onClick={() => nav('/village?ai=1')}>
                    <td><span className="row-icon"><IconWave /></span>{r.name}</td>
                    <td><Badge tone={r.tone}>{r.text}</Badge></td>
                    <td className="muted">{r.by}</td>
                    <td className="num">{r.score}</td>
                    <td className="num muted">{hhmm(r.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="dash-sub">
            <span>실시간 전류 · 마을 인입 FRTU</span>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis dataKey="t" type="number" domain={['dataMin', 0]} tick={CHART.tick} axisLine={false} tickLine={false} unit="s" />
                <YAxis tick={CHART.tick} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
                <Tooltip formatter={(x) => (typeof x === 'number' ? `${x.toFixed(1)} mA` : x)} labelFormatter={(t) => `${Number(t).toFixed(1)} s`} />
                <Line dataKey="mA" stroke="#2f6bff" dot={false} strokeWidth={1.8} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="dash-card">
          <div className="dash-card-head">
            <h2>검토 대기 사건</h2>
            <Link to="/cases" className="pill-link">전체 보기 <IconArrowRight /></Link>
          </div>
          {error ? (
            <ErrorState message={error} onRetry={load} />
          ) : !cases ? (
            <TableSkeleton rows={4} />
          ) : pending.length === 0 ? (
            <p className="muted" style={{ margin: '8px 4px' }}>검토할 사건이 없어요.</p>
          ) : (
            <ul className="dash-list">
              {pending.slice(0, 6).map((c) => (
                <li key={c.id} className="clickable" onClick={() => nav(`/cases/${c.id}`)}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{c.title}</strong>
                    <span>{fmtTime(c.createdAt)}</span>
                  </div>
                  <div className="dash-chips">
                    <DiagnosisBadge status={c.diagnosisStatus} />
                    <StageBadge stage={c.stage} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
