import { Fragment, lazy, memo, Suspense, useEffect, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { IconMoon, IconSun } from '../components/Icons'
import SceneBoundary from '../components/SceneBoundary'
import { Badge, ErrorState, Metric, Metrics, PageHeader, Section, Segmented, Skeleton, Status, Switch, type Tone } from '../components/ui'
import { nightness, SUB_COLOR, type CitySelection } from '../components/city/shared'
import { CHART } from '../lib/chart'
import {
  CITY,
  clockText,
  faultFeeder,
  faultSub,
  RISKY_TRANSFER,
  resetCity,
  restoreAll,
  restoreFeeder,
  restoreSub,
  runScenario,
  SAFE_TRANSFER,
  SCENARIOS,
  setAuto,
  setDemandResponse,
  setHeat,
  setPlaying,
  setCityData,
  cityDataReady,
  setProfile,
  setSpeed,
  setTime,
  setTransferLimit,
  stepMinutes,
  useCity,
  type CitySnap,
  type FeederState,
  type SubStatus,
} from '../lib/city'
import { loadKepcoDataset, type DayType } from '../lib/publicData'

const CityScene = lazy(() => import('../components/city/CityScene'))

const SUB_TEXT: Record<SubStatus, [string, Tone]> = {
  OK: ['정상', 'ok'],
  HIGH: ['부하 높음', 'warn'],
  OVERLOAD: ['과부하', 'err'],
  FAULT: ['사고', 'err'],
  OUT: ['정전', 'err'],
}
const FEEDER_TEXT: Record<FeederState, [string, Tone]> = { OK: ['정상', 'ok'], FAULT: ['사고', 'err'], TRIPPED: ['과부하 트립', 'err'] }
const SPEEDS = [
  { value: '5', label: '느리게' },
  { value: '20', label: '보통' },
  { value: '60', label: '빠르게' },
  { value: '180', label: '매우 빠르게' },
]
const mw = (kw: number) => (kw / 1000).toFixed(1)
const pct = (x: number) => `${Math.round(x * 100)}%`

export default function City() {
  const [regions, setRegions] = useState<string[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  useEffect(() => {
    loadKepcoDataset().then(
      (ds) => {
        setCityData(ds)
        setRegions(ds.regions)
      },
      (e) => setLoadError(String(e)),
    )
  }, [])
  if (loadError) return <ErrorState message={`한전 데이터를 불러오지 못했습니다: ${loadError}`} onRetry={() => location.reload()} />
  if (!regions || !cityDataReady()) return <Skeleton h={560} />
  return <CityView regions={regions} />
}

function CityView({ regions }: { regions: string[] }) {
  const snap = useCity()
  const [selection, setSelection] = useState<CitySelection>(null)
  const night = nightness(snap.time) > 0.5
  const unserved = snap.demandKw - snap.servedKw
  const worstSub = snap.subs.reduce((a, b) => (b.util > a.util ? b : a))
  const selFeeder = selection?.kind === 'feeder' ? snap.feeders[selection.id] : null
  const selSub = selection?.kind === 'sub' ? snap.subs[selection.id] : null

  return (
    <>
      <PageHeader
        title="도시 시뮬레이션"
        description={`블록 ${CITY.nBlocks.toLocaleString()}개·건물 ${CITY.nBuild.toLocaleString()}동 규모 도시의 전력 계통을 시뮬레이션합니다. 발전소 → 변전소 ${CITY.subs.length}곳 → 배전선로 ${CITY.feeders.length}개 → 건물로 이어지고, 사고와 과부하가 정전으로 번지는 과정을 볼 수 있습니다.`}
        meta={<span>부하 패턴: 한전 지역본부 실제 시간별 사용량(2022~2024)의 월·평일/주말 평균 · 계약종별 구분 자료가 없어 모든 구역이 같은 지역 패턴 사용 · 도시 구성·설비 용량은 가정 · 교육용 모형 (전압·위상 계산 없음)</span>}
      />

      <div className="scene city-scene">
        <div className="scene-canvas city-canvas">
          <SceneBoundary>
            <Suspense fallback={<Skeleton h={560} style={{ borderRadius: 0 }} />}>
              <CityScene snap={snap} selection={selection} onSelect={setSelection} />
            </Suspense>
          </SceneBoundary>
        </div>

        <div className="scene-tools">
          <div className="city-clock glass">
            {night ? <IconMoon /> : <IconSun />}
            <strong className="num">{clockText(snap.time)}</strong>
            <span className="small muted">{snap.day === 'WEEKDAY' ? '평일' : '주말'}</span>
          </div>
          <button className="btn btn-sm glass" onClick={() => setPlaying(!snap.playing)} aria-pressed={snap.playing}>
            {snap.playing ? '일시정지' : '재생'}
          </button>
          <Segmented className="glass" value={String(snap.speed)} onChange={(v) => setSpeed(Number(v))} options={SPEEDS} />
        </div>

        <div className="scene-legend glass" aria-label="범례">
          <span><i className="legend-box" style={{ background: SUB_COLOR.OK }} />변전소 정상</span>
          <span><i className="legend-box" style={{ background: SUB_COLOR.HIGH }} />부하 높음</span>
          <span><i className="legend-box" style={{ background: SUB_COLOR.FAULT }} />사고·정전</span>
          <span><i className="legend-box" style={{ background: '#8c2a2a' }} />정전 구역</span>
          <span><i className="legend-box" style={{ background: '#2b66e8' }} />다른 선로가 대신 공급</span>
          <span className="muted">드래그 회전 · 휠 확대 · 블록/변전소 클릭 선택</span>
        </div>
      </div>

      <div className="section">
        <Metrics cols={5}>
          <Metric label="전체 수요" value={mw(snap.demandKw)} unit="MW" foot={`설비 용량 ${mw(snap.capKw)} MW`} />
          <Metric label="공급" value={mw(snap.servedKw)} unit="MW" foot={unserved > 1 ? `미공급 ${mw(unserved)} MW` : '모두 공급 중'}>
            <Status tone={unserved > 1 ? 'err' : 'ok'} live={unserved > 1}>{unserved > 1 ? '공급 부족' : '정상'}</Status>
          </Metric>
          <Metric label="정전 건물" value={snap.outBuildings.toLocaleString()} unit={`/ ${snap.totalBuildings.toLocaleString()}`} foot={`정전 블록 ${snap.outBlocks}개`} />
          <Metric label="최대 변전소 이용률" value={pct(worstSub.util)} foot={`${worstSub.def.name} 변전소`} />
          <Metric label="누적 정전" value={Math.round(snap.outBuildingHours).toLocaleString()} unit="건물·시간" foot="정전 건물 수 × 시간" />
        </Metrics>
      </div>

      <div className="section">
        <Section title="시나리오" description="누르면 설비를 초기화하고 해당 상황을 바로 시작합니다. 시간이 흘러야 과부하 트립과 연쇄가 일어납니다.">
          <div className="cluster">
            {SCENARIOS.map((s) => (
              <button key={s.id} className={`btn ${snap.scenario === s.id ? 'btn-primary' : ''}`} onClick={() => runScenario(s.id)} title={s.note}>{s.label}</button>
            ))}
            <button className="btn btn-ghost" onClick={restoreAll}>모든 설비 복구</button>
            <button className="btn btn-ghost" onClick={resetCity}>처음으로</button>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>{SCENARIOS.find((s) => s.id === snap.scenario)?.note}</p>

          <div className="city-controls">
            <label className="field">
              시각 {clockText(snap.time)}
              <input type="range" min={0} max={23.75} step={0.25} value={snap.time} onChange={(e) => setTime(Number(e.target.value))} />
            </label>
            <label className="field">
              기온 부하 배율 ×{snap.heat.toFixed(2)}
              <input type="range" min={0.8} max={1.4} step={0.01} value={snap.heat} onChange={(e) => setHeat(Number(e.target.value))} />
            </label>
            <div className="field">
              시뮬레이션 시간 건너뛰기
              <div className="cluster">
                <button className="btn btn-sm" onClick={() => stepMinutes(30)}>+30분</button>
                <button className="btn btn-sm" onClick={() => stepMinutes(60)}>+1시간</button>
                <button className="btn btn-sm" onClick={() => stepMinutes(180)}>+3시간</button>
              </div>
            </div>
          </div>

          <div className="city-controls">
            <label className="field">
              지역 패턴
              <select value={snap.region} onChange={(e) => setProfile(e.target.value, snap.month, snap.day)}>
                {regions.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <label className="field">
              월
              <select value={snap.month} onChange={(e) => setProfile(snap.region, Number(e.target.value), snap.day)}>
                {Array.from({ length: 12 }, (_, k) => <option key={k} value={k + 1}>{k + 1}월</option>)}
              </select>
            </label>
            <label className="field">
              요일
              <select value={snap.day} onChange={(e) => setProfile(snap.region, snap.month, e.target.value as DayType)}>
                <option value="WEEKDAY">평일</option>
                <option value="WEEKEND">주말·공휴일</option>
              </select>
            </label>
          </div>

          <dl className="dl-rows" style={{ marginTop: 16 }}>
            <div>
              <dt>자동 절체</dt>
              <dd className="row gap">
                <Switch on={snap.auto} onToggle={() => setAuto(!snap.auto)} label="자동 절체" />
                <span className="small muted">사고 선로의 부하를 이웃 선로가 남는 용량만큼 넘겨받습니다.</span>
              </dd>
            </div>
            <div>
              <dt>절체 허용 한도</dt>
              <dd className="row gap">
                <Segmented
                  value={String(snap.transferLimit)}
                  onChange={(v) => setTransferLimit(Number(v))}
                  options={[
                    { value: String(SAFE_TRANSFER), label: `안전 ${Math.round(SAFE_TRANSFER * 100)}%` },
                    { value: String(RISKY_TRANSFER), label: `무리 ${Math.round(RISKY_TRANSFER * 100)}%` },
                  ]}
                />
                <span className="small muted">{snap.transferLimit > SAFE_TRANSFER ? '용량을 넘겨 받아 이웃이 연쇄로 트립할 수 있습니다.' : '넘겨받은 뒤에도 용량 안에 들어올 때만 받습니다.'}</span>
              </dd>
            </div>
            <div>
              <dt>수요 반응</dt>
              <dd className="row gap">
                <Switch on={snap.dr} onToggle={() => setDemandResponse(!snap.dr)} label="수요 반응" />
                <span className="small muted">변전소 이용률이 90%를 넘으면 전체 부하를 12% 줄입니다.</span>
              </dd>
            </div>
          </dl>
        </Section>
      </div>

      <HistoryChart history={snap.history} />

      <div className="section">
        <Section
          title="변전소와 배전선로"
          description="행을 누르면 3D에서 해당 구역이 밝게 표시됩니다. 선로가 용량의 110%를 15분(시뮬레이션) 넘기면 트립합니다."
          actions={selection && <button className="btn btn-sm btn-ghost" onClick={() => setSelection(null)}>선택 해제</button>}
        >
          <div className="table-wrap">
            <table className="city-table">
              <thead>
                <tr><th>설비</th><th>이용률</th><th>부하 / 용량</th><th>상태</th><th>대신 공급</th><th /></tr>
              </thead>
              <tbody>
                {snap.subs.map((s) => (
                  <Fragment key={s.def.id}>
                    <tr key={`s${s.def.id}`} className={`clickable city-sub ${selSub?.def.id === s.def.id ? 'sel' : ''}`} onClick={() => setSelection({ kind: 'sub', id: s.def.id })}>
                      <td className="strong"><i className="legend-box" style={{ background: SUB_COLOR[s.status] }} />{s.def.name} 변전소</td>
                      <td><Util value={s.util} /></td>
                      <td className="num" style={{ textAlign: 'left' }}>{mw(s.loadKw)} / {mw(s.def.capKw)} MW</td>
                      <td><Status tone={SUB_TEXT[s.status][1]}>{SUB_TEXT[s.status][0]}</Status></td>
                      <td />
                      <td style={{ textAlign: 'right' }}>
                        {s.fault ? (
                          <button className="btn btn-sm" onClick={(e) => (e.stopPropagation(), restoreSub(s.def.id))}>복구</button>
                        ) : (
                          <button className="btn btn-sm btn-ghost" onClick={(e) => (e.stopPropagation(), faultSub(s.def.id))}>사고 발생</button>
                        )}
                      </td>
                    </tr>
                    {s.def.feeders.map((fid) => {
                      const f = snap.feeders[fid]
                      return (
                        <tr key={`f${fid}`} className={`clickable ${selFeeder?.def.id === fid ? 'sel' : ''}`} onClick={() => setSelection({ kind: 'feeder', id: fid })}>
                          <td className="muted" style={{ paddingLeft: 28 }}>{f.def.name} 선로 <span className="xs faint">블록 {f.def.blocks.length}</span></td>
                          <td><Util value={f.util} /></td>
                          <td className="num muted" style={{ textAlign: 'left' }}>{mw(f.loadKw)} / {mw(f.def.capKw)} MW</td>
                          <td>
                            <Status tone={FEEDER_TEXT[f.state][1]}>{FEEDER_TEXT[f.state][0]}</Status>
                            {f.state === 'OK' && f.overloadMin > 0 && <span className="small text-bad"> · 과부하 {Math.round(f.overloadMin)}분</span>}
                          </td>
                          <td className="small">{f.borrowed > 0 ? <Badge tone="accent">블록 {f.borrowed}개 인수</Badge> : f.outBlocks > 0 ? <Badge tone="err">정전 {f.outBlocks}블록</Badge> : '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            {f.state === 'OK' ? (
                              <button className="btn btn-sm btn-ghost" onClick={(e) => (e.stopPropagation(), faultFeeder(fid))}>사고 발생</button>
                            ) : (
                              <button className="btn btn-sm" onClick={(e) => (e.stopPropagation(), restoreFeeder(fid))}>복구</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </div>

      <div className="section">
        <Section title="이벤트 로그" description="사고, 트립, 복구를 시뮬레이션 시각과 함께 기록합니다.">
          {snap.log.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>아직 사건이 없습니다. 시나리오를 시작하거나 선로에서 사고를 발생시켜 보세요.</p>
          ) : (
            <ul className="list">
              {snap.log.slice(0, 20).map((l) => (
                <li key={l.id} className="list-item">
                  <span className="mono small muted">{l.clock}</span>
                  <span style={{ flex: 1 }} className={l.level === 'err' ? 'text-bad' : ''}>{l.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="section">
        <Section title="모형의 가정과 한계">
          <ul className="plain-list small">
            <li>건물 수요 = 기준 용량(가정) × 시간대 패턴(한전 지역본부 실제 시간별 사용량 평균, 계약종별 구분 없음) × 기온 배율. 전압·위상·손실은 계산하지 않습니다.</li>
            <li>선로·변전소 용량은 설계 조건(서울 · 8월 · 평일)의 하루 최대 부하로 정해져 있어, 지역·월을 바꾸거나 배율을 올리면 설비가 모자랄 수 있습니다.</li>
            <li>자동 절체는 블록 단위로 이웃 선로에 부하를 넘기는 단순화입니다. 실제 계통의 개폐기 위치와 보호 협조는 반영하지 않습니다.</li>
            <li>마을 모형(Arduino·INA219)의 IoT 데이터, 고장파형 AI와는 섞지 않는 별개 시뮬레이션입니다.</li>
          </ul>
        </Section>
      </div>
    </>
  )
}

function Util({ value }: { value: number }) {
  const color = value > 1.05 ? 'var(--err)' : value > 0.9 ? 'var(--warn)' : 'var(--ok)'
  return (
    <div className="score-cell">
      <div className="bar"><div style={{ width: `${Math.min(100, value * 100)}%`, background: color }} /></div>
      <span className="num small">{pct(value)}</span>
    </div>
  )
}

/** 15분마다만 바뀌므로 매 틱 다시 그리지 않음 */
const HistoryChart = memo(function HistoryChart({ history }: { history: CitySnap['history'] }) {
  return (
    <div className="section">
      <Section title="수요와 공급 (최근 24시간)" description="시뮬레이션 시간 기준, 15분마다 기록합니다.">
        <div className="legend" style={{ marginBottom: 8 }}>
          <span><i style={{ background: CHART.ink }} />공급</span>
          <span style={{ color: CHART.secondary }}><i className="dash" />수요</span>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={history} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="clock" interval="preserveStartEnd" minTickGap={40} tick={CHART.tick} axisLine={CHART.axisLine} tickLine={CHART.tickLine} />
            <YAxis unit="MW" domain={[0, 'auto']} tick={CHART.tick} axisLine={CHART.axisLine} tickLine={CHART.tickLine} width={58} />
            <Tooltip formatter={(v) => `${Number(v).toFixed(1)} MW`} />
            <Line name="수요" dataKey="demand" stroke={CHART.secondary} strokeDasharray="4 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            <Line name="공급" dataKey="served" stroke={CHART.ink} dot={false} strokeWidth={1.75} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </Section>
    </div>
  )
})
