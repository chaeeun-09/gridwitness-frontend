import { Link, useNavigate } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ModelCardPanel from '../components/ModelCardPanel'
import { Badge, Dot, Metric, Metrics, NODE_TONE, PageHeader, Section, Status, type Tone } from '../components/ui'
import { CHART } from '../lib/chart'
import { useCity, type SubStatus } from '../lib/city'
import { STATUS_LABEL, useVillage } from '../lib/village'
import { useVillageEvents, type AnalyzedEvent } from '../lib/villageEvents'

const SUB_TONE: Record<SubStatus, Tone> = { OK: 'ok', HIGH: 'warn', OVERLOAD: 'err', FAULT: 'err', OUT: 'err' }
const SUB_TEXT: Record<SubStatus, string> = { OK: '정상', HIGH: '부하 높음', OVERLOAD: '과부하', FAULT: '사고', OUT: '정전' }
const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { hour12: false })

/** AI 판정 한 줄: 답했으면 유형과 점수, 아니면 왜 안 했는지 */
function VerdictRow({ a }: { a: AnalyzedEvent }) {
  const v = a.verdict
  const [tone, text]: [Tone, string] =
    v.kind === 'ANSWERED' ? [v.isFault ? 'err' : 'ok', `${v.labelKo} · ${Math.round(v.score * 100)}%`]
    : v.kind === 'WITHHELD' ? ['warn', `보류 · 1순위 ${v.labelKo}`]
    : v.kind === 'NO_MODEL' ? ['off', '모델 학습 전 · 파형만 기록']
    : ['err', '입력 거부']
  return (
    <li className="feed-row">
      <span className="num small muted">{hhmmss(a.e.receivedAt)}</span>
      <Badge tone={tone}>{text}</Badge>
      <span className="small muted feed-why">사건 #{a.e.ev} · {a.e.src === 'cmd' ? '개폐 명령 직후' : '전류 급변'}</span>
    </li>
  )
}

export default function Dashboard() {
  const snap = useVillage()
  const city = useCity()
  const events = useVillageEvents()
  const nav = useNavigate()
  const alarm = ['WARNING', 'FAULT', 'OUTAGE'].includes(snap.status)
  const answered = events.filter((a) => a.verdict.kind === 'ANSWERED').length
  const withheld = events.filter((a) => a.verdict.kind === 'WITHHELD').length
  const subsOk = city.subs.filter((s) => s.status === 'OK').length
  const t0 = snap.history.length ? snap.history[snap.history.length - 1].t : 0
  const data = snap.history.map((h) => ({ t: (h.t - t0) / 1000, mA: h.i * 1000, v: h.v }))

  return (
    <>
      <PageHeader title="AI 관제" description="FRTU가 보내는 파형과 AI 판정을 한 화면에서" actions={<Link to="/village?ai=1" className="btn btn-primary">마을에서 AI 분석 보기</Link>} />

      <Metrics cols={4}>
        <Metric label="마을 FRTU" value={<Status tone={NODE_TONE[snap.status]} live={alarm}><span style={{ fontSize: 20, fontWeight: 600 }}>{STATUS_LABEL[snap.status]}</span></Status>} foot={`이상 점수 ${snap.score.toFixed(2)} · ${snap.v.toFixed(2)} V`} />
        <Metric label="AI 판정" value={events.length} unit="건" foot={`답함 ${answered} · 보류 ${withheld}`} />
        <Metric label="규칙 기반 이상" value={snap.events.filter((e) => !e.clearedAt).length} unit="건 진행 중" foot={`누적 ${snap.events.length}건`} />
        <Metric label="도시 변전소" value={`${subsOk}/${city.subs.length}`} unit="정상" foot={<Link to="/city">도시 시뮬레이션 →</Link>} />
      </Metrics>

      <div className="dash-grid">
        <Section title="실시간 파형" description="마을 인입 FRTU · 최근 1분 (0.5초 간격)">
          <div className="ai-sub">전류 (mA)</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 0]} tick={CHART.tick} axisLine={false} tickLine={false} unit="s" />
              <YAxis tick={CHART.tick} axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} />
              <Tooltip formatter={(x) => (typeof x === 'number' ? x.toFixed(1) : x)} labelFormatter={(t) => `${Number(t).toFixed(1)} s`} />
              <Line dataKey="mA" stroke="#3157e0" dot={false} strokeWidth={1.8} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          <div className="ai-sub">전압 (V)</div>
          <ResponsiveContainer width="100%" height={100}>
            <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="t" type="number" domain={['dataMin', 0]} hide />
              <YAxis tick={CHART.tick} axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} />
              <Line dataKey="v" stroke="#24835a" dot={false} strokeWidth={1.6} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          {data.length === 0 && <p className="small muted" style={{ margin: '8px 0 0' }}>실측 장치가 연결되면 파형이 그려집니다. 메뉴 아래 '실측 장치'에서 연결하세요.</p>}
        </Section>

        <div className="stack" style={{ gap: 20 }}>
        <Section title="AI 판정" description="사건 파형마다 AI가 내린 판정 (최신순)">
          {events.length === 0 && snap.events.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>아직 판정할 사건이 없습니다. 마을에서 LED를 끄거나 정전을 일으키면 여기에 쌓입니다.</p>
          ) : (
            <ul className="feed">
              {events.slice(0, 8).map((a) => <VerdictRow key={a.e.ev + a.e.receivedAt} a={a} />)}
              {snap.events.slice(0, Math.max(0, 8 - events.length)).map((e) => (
                <li key={`r${e.id}`} className="feed-row clickable" onClick={() => nav('/village?ai=1')}>
                  <span className="num small muted">{hhmmss(e.at)}</span>
                  <Badge tone={e.status === 'WARNING' ? 'warn' : 'err'}>{STATUS_LABEL[e.status]} · 규칙</Badge>
                  <span className="small muted feed-why">이상 점수 최대 {e.maxScore.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="FRTU 장치" description="현장 단말과 상태">
          <ul className="feed">
            <li className="feed-row clickable" onClick={() => nav('/village?ai=1')}>
              <Dot tone={NODE_TONE[snap.status]} live={alarm} />
              <strong>마을 인입 FRTU</strong>
              <span className="small muted feed-why">{snap.connected ? STATUS_LABEL[snap.status] : '연결 끊김'}</span>
            </li>
            {city.subs.map((s) => (
              <li key={s.def.id} className="feed-row clickable" onClick={() => nav('/city')}>
                <Dot tone={SUB_TONE[s.status]} />
                <strong>{s.def.name} 변전소</strong>
                <span className="small muted feed-why">{SUB_TEXT[s.status]} · 부하 {Number.isFinite(s.util) ? `${Math.round(s.util * 100)}%` : '—'}</span>
              </li>
            ))}
          </ul>
        </Section>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <ModelCardPanel />
      </div>
    </>
  )
}
