import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { getActor } from '../lib/actor'
import { CHART } from '../lib/chart'
import { FRTUS } from '../lib/frtu'
import { dismissIncident, FI_SHORT, markIncidentRegistered, observeVillage, openIncident, useLiveIncidents, type LiveIncident } from '../lib/liveIncident'
import { ASSISTANT_OPEN_EVENT, askAssistantVillage, INCIDENT_OPEN_EVENT, PANEL_OPEN_EVENT } from '../lib/panels'
import { getVillage, linkEventToCase, useVillage } from '../lib/village'
import { useVillageEvents } from '../lib/villageEvents'
import { IconX } from './Icons'
import { Badge } from './ui'

const secs = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`
}
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

/** 화면에는 안 보이고 계측을 지켜보다 고장표시가 뜨면 사건을 만든다. 3D 마을에서는 사건 화면을 바로 띄움 */
export function IncidentWatcher() {
  const snap = useVillage()
  const { pathname } = useLocation()
  const { incidents } = useLiveIncidents()
  const seen = useRef(0)
  useEffect(() => observeVillage(snap), [snap])
  useEffect(() => {
    const top = incidents[0]
    if (!top || top.id === seen.current) return
    seen.current = top.id
    if (pathname === '/village') openIncident(top.id)
  }, [incidents, pathname])
  return null
}

/** 어느 화면에서든 위쪽에 뜨는 사건 알림 */
export function IncidentBanner() {
  const { incidents, openId, dismissed } = useLiveIncidents()
  const top = incidents[0]
  const now = useNow(!!top)
  if (!top || openId === top.id || dismissed.includes(top.id)) return null
  if (top.clearedAt && now - top.clearedAt > 60_000) return null
  const live = !top.clearedAt
  return (
    <div className={`incident-banner ${live ? 'live' : 'ok'} no-print`} role="alert">
      <span className="ib-dot" />
      <strong>{live ? top.title : `복구됨 · ${secs(top.clearedAt! - top.startedAt)} 만에`}</strong>
      <span className="ib-time">{live ? `${secs(now - top.startedAt)} 전 발생` : top.title}</span>
      <button type="button" className="btn btn-sm" onClick={() => openIncident(top.id)}>보기</button>
      <button type="button" className="ib-x" onClick={() => dismissIncident(top.id)} aria-label="알림 닫기"><IconX /></button>
    </div>
  )
}

/** 실시간 사건 화면: 사건 전후 파형 · 고장 구간 · 원인 판정 · 진행 · 등록/AI */
export function IncidentSheet() {
  const { incidents, openId } = useLiveIncidents()
  const inc = incidents.find((x) => x.id === openId) ?? null

  // 열리면 다른 패널을 비키게 하고, AI·마을 패널이 열리면 접힘
  useEffect(() => {
    if (inc) window.dispatchEvent(new Event(INCIDENT_OPEN_EVENT))
  }, [inc?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const close = () => openIncident(null)
    window.addEventListener(ASSISTANT_OPEN_EVENT, close)
    window.addEventListener(PANEL_OPEN_EVENT, close)
    return () => {
      window.removeEventListener(ASSISTANT_OPEN_EVENT, close)
      window.removeEventListener(PANEL_OPEN_EVENT, close)
    }
  }, [])

  if (!inc) return null
  return <SheetBody inc={inc} />
}

function SheetBody({ inc }: { inc: LiveIncident }) {
  const live = !inc.clearedAt
  const now = useNow(live)
  const events = useVillageEvents()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const data = inc.points.map((p) => ({ s: +((p.t - inc.startedAt) / 1000).toFixed(1), inlet: p.i * 1000, house: p.ih != null ? p.ih * 1000 : null, lamp: p.il != null ? p.il * 1000 : null }))
  // 우노가 녹화해 보낸 사건 파형이 이 시각 근처에 있으면 그 AI 판정도 함께 (실측 장치)
  const recorded = events.find((a) => Math.abs(new Date(a.e.receivedAt).getTime() - inc.startedAt) < 8000)
  const v = recorded?.verdict

  async function register() {
    const ev = getVillage().events.find((e) => e.id === inc.ruleEventId)
    if (!ev) return setErr('등록할 이상 기록이 아직 없어요. 잠시 뒤 다시 눌러 주세요.')
    setBusy(true)
    setErr(null)
    try {
      const c = await api.registerIotEvent({ event: ev, actor: getActor() })
      linkEventToCase(ev.id, c.id)
      markIncidentRegistered(inc.id, c.id)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="incident-sheet no-print" role="dialog" aria-label="실시간 사건">
      <header className="is-head">
        <div style={{ minWidth: 0 }}>
          <span className="is-kicker">실시간 사건 #{inc.id} · {inc.source === 'MOCK' ? '시뮬레이터' : '실측'} · 마을 직류 계측</span>
          <h2>{inc.title}</h2>
        </div>
        <Badge tone={live ? 'err' : 'ok'}>{live ? `진행 중 · ${secs(now - inc.startedAt)}` : `복구됨 · ${secs(inc.clearedAt! - inc.startedAt)} 만에`}</Badge>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => openIncident(null)} aria-label="닫기"><IconX /></button>
      </header>

      <div className="is-grid">
        <div className="is-wave">
          <div className="is-sub">사건 전후 전류 (mA) · 0초 = 고장표시 발생</div>
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={data} margin={{ top: 18, right: 10, left: -6, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="s" type="number" domain={['dataMin', 'dataMax']} unit="s" tick={CHART.tick} axisLine={false} tickLine={false} />
              <YAxis tick={CHART.tick} axisLine={false} tickLine={false} width={42} domain={[0, 'auto']} />
              <Tooltip formatter={(x) => (typeof x === 'number' ? `${x.toFixed(1)} mA` : x)} labelFormatter={(t) => `${t} s`} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine x={0} stroke="#d64545" strokeDasharray="4 3" label={{ value: '발생', position: 'top', fontSize: 11, fill: '#d64545' }} />
              {inc.clearedAt && <ReferenceLine x={+((inc.clearedAt - inc.startedAt) / 1000).toFixed(1)} stroke="#1f9d55" strokeDasharray="4 3" label={{ value: '복구', position: 'top', fontSize: 11, fill: '#1f9d55' }} />}
              <Line name="인입" dataKey="inlet" stroke="#2f6bff" dot={false} strokeWidth={1.8} isAnimationActive={false} />
              <Line name="주택 분기" dataKey="house" stroke="#e08a1e" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
              <Line name="가로등 분기" dataKey="lamp" stroke="#24835a" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          <ol className="is-timeline">
            <li className="err"><b>{new Date(inc.startedAt).toLocaleTimeString('ko-KR', { hour12: false })}</b> 고장표시 발생</li>
            {recorded && <li><b>{new Date(recorded.e.receivedAt).toLocaleTimeString('ko-KR', { hour12: false })}</b> FRTU가 사건 파형 녹화·전송</li>}
            {inc.caseId && <li><b>등록</b> IoT 사건 {inc.caseId}</li>}
            <li className={live ? 'wait' : 'ok'}>{live ? <><b>대기</b> 아직 복구되지 않음</> : <><b>{new Date(inc.clearedAt!).toLocaleTimeString('ko-KR', { hour12: false })}</b> 복구 ({secs(inc.clearedAt! - inc.startedAt)})</>}</li>
          </ol>
        </div>

        <div className="is-side">
          <div className="is-card">
            <span>원인 판정 <small>계측값 규칙</small></span>
            <strong>{inc.cause}</strong>
          </div>
          {v && (
            <div className="is-card">
              <span>사건 파형 AI <small>우노 녹화</small></span>
              <strong>{v.kind === 'ANSWERED' ? `${v.labelKo} · ${Math.round(v.score * 100)}%` : v.kind === 'WITHHELD' ? `판단 보류 (1순위 ${v.labelKo})` : v.kind === 'NO_MODEL' ? '모델 학습 전' : '입력 거부'}</strong>
            </div>
          )}
          <div className="is-fi">
            {FRTUS.map((f) => (
              <div key={f.id} className={inc.fi[f.id] !== 'NONE' ? 'hit' : ''}>
                <span>{f.short}</span>
                <b>{FI_SHORT[inc.fi[f.id]]}</b>
              </div>
            ))}
          </div>
          <ul className="is-reasons">{inc.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {err && <div className="alert alert-err small">{err}</div>}
          <div className="is-actions">
            {inc.caseId ? (
              <Link to={`/cases/${inc.caseId}`} className="btn btn-sm" onClick={() => openIncident(null)}>등록한 사건 보기</Link>
            ) : (
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={register}>{busy ? '등록 중…' : '사건으로 등록'}</button>
            )}
            <button type="button" className="btn btn-sm" onClick={askAssistantVillage}>AI에게 묻기</button>
          </div>
          <p className="xs muted">직류 모형 계측으로 낸 결과예요. 실제 현장에서는 이 자리에 FRTU가 녹화한 교류 고장파형과 그 AI 분석이 들어가요.</p>
        </div>
      </div>
    </section>
  )
}
