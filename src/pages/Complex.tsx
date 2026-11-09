import { useEffect, useMemo, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, ErrorState, Metric, Metrics, PageHeader, Section, Skeleton, Status, Switch, type Tone } from '../components/ui'
import { Link, useSearchParams } from 'react-router-dom'
import { CHART } from '../lib/chart'
import {
  ANCHOR_KWH_MONTH,
  ANCHOR_SOURCE,
  ANCHOR_URL,
  BUILDING_FAULT_LABEL,
  clearBuildingFault,
  clearUnitFault,
  eventsAt,
  hourLabel,
  hourOf,
  householdKw,
  injectBuildingFault,
  injectUnitFault,
  LAMP_KW,
  lampKey,
  loadIndex,
  loadRegion,
  measure,
  noteDetections,
  resetComplex,
  monthIndex,
  scaleFor,
  setBuildingPower,
  setHour,
  setLayout,
  setPlaying,
  setSpeed,
  toggleUnit,
  UNIT_FAULT_LABEL,
  UNIT_RULE,
  UNIT_STATUS_LABEL,
  unitKey,
  unitName,
  useComplex,
  type BuildingFault,
  type ComplexIndex,
  type RegionData,
  type UnitFault,
  type UnitStatus,
} from '../lib/complex'

const STATUS_TONE: Record<UnitStatus, Tone> = { NORMAL: 'ok', OFF: 'off', WARNING: 'warn', FAULT: 'err', OUTAGE: 'err', NO_DATA: 'off' }
const CELL_COLOR: Record<UnitStatus, string> = {
  NORMAL: 'var(--ok)',
  OFF: 'var(--fill-2)',
  WARNING: 'var(--warn)',
  FAULT: 'var(--err)',
  OUTAGE: '#3a3d45',
  NO_DATA: 'var(--line-strong)',
}
const fmt = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d }))

type Sel = { kind: 'unit' | 'lamp'; b: number; i: number } | null

export default function Complex() {
  const s = useComplex()
  const [index, setIndex] = useState<ComplexIndex | null>(null)
  const [params] = useSearchParams()
  const fromCity = params.get('from') === 'city'
  const [region, setRegion] = useState(params.get('region') || '서울본부')
  const [data, setData] = useState<RegionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sel, setSel] = useState<Sel>(null)

  useEffect(() => {
    loadIndex().then(setIndex, (e) => setError(String(e)))
  }, [])
  useEffect(() => {
    if (!index) return
    const r = index.regions.find((x) => x.region === region)
    if (!r) {
      if (region !== '서울본부') setRegion('서울본부')
      return
    }
    setData(null)
    let alive = true
    loadRegion(r.file).then(
      (d) => alive && setData(d),
      (e) => alive && setError(String(e)),
    )
    return () => {
      alive = false
    }
  }, [index, region])
  useEffect(() => () => setPlaying(false), [])

  const scale = useMemo(() => (data ? scaleFor(data, index) : null), [data, index])
  const readings = useMemo(() => (data && scale ? measure(s, data, scale) : null), [s, data, scale])

  // 상태가 바뀐 세대·가로등을 기록 (판정 규칙이 새로 잡은 것만)
  const prev = useRef<Map<string, UnitStatus>>(new Map())
  useEffect(() => {
    if (!readings || !data) return
    const found: { where: string; status: UnitStatus; text: string }[] = []
    const next = new Map<string, UnitStatus>()
    readings.forEach((b, bi) => {
      const check = (key: string, where: string, st: UnitStatus, kw: number | null, exp: number | null) => {
        next.set(key, st)
        const was = prev.current.get(key)
        if ((st === 'WARNING' || st === 'FAULT') && was !== st && found.length < 20) {
          found.push({ where, status: st, text: `판정: ${UNIT_STATUS_LABEL[st]} · 측정 ${fmt(kw)} kW / 예상 ${fmt(exp)} kW` })
        }
      }
      b.units.forEach((r, u) => check(unitKey(bi, u), unitName(s.layout, bi, u), r.status, r.kw, r.expected))
      b.lamps.forEach((r, l) => check(lampKey(bi, l), `${101 + bi}동 가로등 ${l + 1}`, r.status, r.kw, r.expected))
    })
    prev.current = next
    if (found.length) noteDetections(data, found)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readings])

  if (error) return <ErrorState message={`데이터를 불러오지 못했습니다: ${error}`} onRetry={() => location.reload()} />

  const nUnits = s.layout.floors * s.layout.perFloor
  const totalUnits = nUnits * s.layout.buildings
  const totalKw = readings?.reduce((a, b) => a + b.kw, 0) ?? 0
  const counts = readings?.reduce(
    (a, b) => {
      b.units.forEach((r) => a[r.status]++)
      b.lamps.forEach((r) => a[r.status]++)
      return a
    },
    { NORMAL: 0, OFF: 0, WARNING: 0, FAULT: 0, OUTAGE: 0, NO_DATA: 0 } as Record<UnitStatus, number>,
  )
  const abnormal = counts ? counts.WARNING + counts.FAULT + counts.OUTAGE : 0
  const now = data ? hourLabel(data.start, s.hour) : ''
  const ev = index && data ? eventsAt(index, data, s.hour) : null
  const z = data?.z[s.hour] ?? null
  const holiday = data?.holiday[s.hour] === 1
  const hhKw = data && scale ? householdKw(data, scale, s.hour) : null
  const hhExp = data && scale ? householdKw(data, scale, s.hour, 'exp') : null

  return (
    <>
      <PageHeader
        title="가상 대단지"
        description="스마트 마을 모형(집마다 차단기 + 전력 측정 → 예상과 비교해 이상 판정)을 실제 규모 아파트 단지로 키운 소프트웨어 모형입니다. 사용량의 시간 변화는 한전 실제 데이터를 그대로 재생하고, 같은 시각 우리 AI가 실제로 낸 판단을 함께 보여줍니다."
        actions={
          <div className="row gap">
            <button className="btn" onClick={resetComplex}>
              고장·차단 모두 해제
            </button>
            <button className={`btn ${s.playing ? '' : 'btn-primary'}`} onClick={() => setPlaying(!s.playing)} disabled={!data}>
              {s.playing ? '일시정지' : '재생'}
            </button>
          </div>
        }
      />

      {fromCity && (
        <div className="card small" style={{ padding: 12, marginBottom: 16 }}>
          도시 시뮬레이션의 <strong>아파트 1동 = 이 대단지 1곳</strong>입니다. 세대 하나는 스마트 마을 모형의 집 1채와 같은 규칙으로 판정합니다. <Link to="/city">← 도시 시뮬레이션으로 돌아가기</Link>
        </div>
      )}
      <TruthNote index={index} />

      <Section
        title="시각과 지역"
        description="2024년 1시간 단위. 2024년은 AI가 학습할 때 보지 않은 기간입니다."
        actions={
          <div className="row gap">
            <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="지역본부">
              {(index?.regions ?? []).map((r) => (
                <option key={r.region} value={r.region}>
                  {r.region}
                </option>
              ))}
            </select>
            <select value={s.speed} onChange={(e) => {
              setSpeed(Number(e.target.value))
              if (s.playing) setPlaying(true)
            }} aria-label="재생 속도">
              {[1, 3, 10].map((v) => (
                <option key={v} value={v}>
                  {v}배속
                </option>
              ))}
            </select>
          </div>
        }
      >
        {data ? (
          <>
            <div className="row gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <strong className="num" style={{ fontSize: 18 }}>{now}</strong>
              {data.station && <Badge tone="neutral">{data.station} 관측 {data.ta?.[s.hour] != null ? `${data.ta[s.hour]}℃` : '기온 없음'}</Badge>}
              {holiday && <Badge tone="neutral">공휴일 · AI 판단 보류</Badge>}
              <button className="btn btn-sm" onClick={() => setHour(s.hour - 24)}>−1일</button>
              <button className="btn btn-sm" onClick={() => setHour(s.hour - 1)}>−1시간</button>
              <button className="btn btn-sm" onClick={() => setHour(s.hour + 1)}>+1시간</button>
              <button className="btn btn-sm" onClick={() => setHour(s.hour + 24)}>+1일</button>
            </div>
            <input type="range" min={0} max={data.hours - 1} value={s.hour} onChange={(e) => setHour(Number(e.target.value))} className="cx-range" aria-label="시각" />
          </>
        ) : (
          <Skeleton h={40} />
        )}
      </Section>

      <Metrics cols={4}>
        <Metric label="세대 · 가로등" value={totalUnits.toLocaleString('ko-KR')} unit="세대" foot={`${s.layout.buildings}개 동 · 가로등 ${s.layout.buildings * s.layout.lampsPerBuilding}개`} />
        <Metric
          label="단지 전체 사용"
          value={fmt(totalKw, 0)}
          unit="kW"
          foot={`세대당 ${fmt(hhKw)} kW · ${region} ${data ? monthIndex(data, s.hour) + 1 : ''}월 가구 평균 ${scale && data ? fmt(scale.kwhMonth[monthIndex(data, s.hour)], 0) : '–'} kWh${scale?.basis === 'anchor' ? ' (전국 기준값)' : ''}`}
        />
        <Metric label="이상 판정" value={abnormal} unit="곳" foot={counts ? `주의 ${counts.WARNING} · 이상 ${counts.FAULT} · 정전 ${counts.OUTAGE} · 차단 ${counts.OFF}` : ''} />
        <Metric label={`실제 AI · ${region}`} value={holiday ? '보류' : fmt(z)} unit={holiday ? '' : 'z'} foot={index ? `기준 |z| > ${index.model.z_node} 이면 이상 · 지역 예측 대비 ${hhKw && hhExp ? fmt((hhKw / hhExp - 1) * 100, 1) + '%' : '–'}` : ''} />
      </Metrics>

      {ev && (ev.local.length > 0 || ev.wide.length > 0) && (
        <div className="scenario-banner cx-alarm">
          <div style={{ minWidth: 0 }}>
            <strong>이 시각, 실제 AI가 {region}에 이상을 판정했습니다</strong>
            <div className="small muted">
              {ev.local.map((e) => `지역 사건 ${e.kind === 'DROP' ? '급감' : '급증'} · 최대 z ${e.worst_z} · 실제/예측 ${e.worst_ratio}`).join(' / ')}
              {ev.local.length > 0 && ev.wide.length > 0 && ' / '}
              {ev.wide.map((w) => `광역 사건 · 동시에 ${w.max_nodes}개 지역`).join(' / ')}
              {' '}· 실제 원인은 확인되지 않았습니다 (정답 라벨 없음)
            </div>
          </div>
        </div>
      )}

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', alignItems: 'start' }}>
        <Section
          title="단지 배치"
          description="칸 하나 = 세대 1곳 (위가 높은 층). 아래 작은 칸 = 가로등. 칸을 눌러 차단기·고장을 조작합니다."
          actions={<LayoutControls />}
        >
          {readings ? (
            <div className="cx-grid">
              {readings.map((b, bi) => (
                <div key={bi} className={`cx-bldg${b.fault ? ' has-fault' : ''}`}>
                  <div className="cx-bldg-head">
                    <strong>{101 + bi}동</strong>
                    <span className="small muted num">{fmt(b.kw, 0)} kW</span>
                  </div>
                  <div className="cx-units" style={{ gridTemplateColumns: `repeat(${s.layout.perFloor}, 1fr)` }}>
                    {Array.from({ length: s.layout.floors }, (_, row) => s.layout.floors - 1 - row).flatMap((floor) =>
                      Array.from({ length: s.layout.perFloor }, (_, no) => {
                        const u = floor * s.layout.perFloor + no
                        const r = b.units[u]
                        const active = sel?.kind === 'unit' && sel.b === bi && sel.i === u
                        return (
                          <button
                            key={u}
                            className={`cx-cell${active ? ' sel' : ''}`}
                            style={{ background: CELL_COLOR[r.status] }}
                            title={`${unitName(s.layout, bi, u)} · ${UNIT_STATUS_LABEL[r.status]} · ${fmt(r.kw)} kW`}
                            onClick={() => setSel({ kind: 'unit', b: bi, i: u })}
                          />
                        )
                      }),
                    )}
                  </div>
                  <div className="cx-lamps">
                    {b.lamps.map((r, l) => (
                      <button
                        key={l}
                        className={`cx-lamp${sel?.kind === 'lamp' && sel.b === bi && sel.i === l ? ' sel' : ''}`}
                        style={{ background: CELL_COLOR[r.status] }}
                        title={`${101 + bi}동 가로등 ${l + 1} · ${UNIT_STATUS_LABEL[r.status]}`}
                        onClick={() => setSel({ kind: 'lamp', b: bi, i: l })}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Skeleton h={320} />
          )}
          <div className="row gap small muted" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            {(['NORMAL', 'OFF', 'WARNING', 'FAULT', 'OUTAGE'] as UnitStatus[]).map((k) => (
              <span key={k} className="row" style={{ gap: 6 }}>
                <i className="cx-cell" style={{ background: CELL_COLOR[k], display: 'inline-block', width: 10, height: 10 }} />
                {UNIT_STATUS_LABEL[k]}
              </span>
            ))}
          </div>
        </Section>

        <div>
          <SelPanel sel={sel} data={data} readings={readings} />
          <Section title="판정 기록" description="판정 규칙이 새로 잡은 이상과 사람이 넣은 가상 고장">
            {s.log.length === 0 ? (
              <p className="small muted">아직 없습니다. 세대 칸을 눌러 가상 고장을 넣어 보세요.</p>
            ) : (
              <ul className="cx-log">
                {s.log.slice(0, 15).map((e) => (
                  <li key={e.id}>
                    <Status tone={STATUS_TONE[e.status]}>{e.where}</Status>
                    <div className="small muted">{e.at} · {e.text}</div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      {index && data && <RealAI index={index} data={data} hour={s.hour} />}
    </>
  )
}

function TruthNote({ index }: { index: ComplexIndex | null }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div className="grid-2" style={{ gap: 12 }}>
        <div>
          <Badge tone="ok">실제 데이터</Badge>
          <ul className="small" style={{ margin: '8px 0 0 16px' }}>
            <li>
              지역본부 시간별 사용량·고객호수: <a href={index?.source.url} target="_blank" rel="noreferrer">{index?.source.dataset ?? '한전 공공데이터'}</a> (2024년, 원본 값)
            </li>
            <li>AI 예측·이상 점수·사건: 우리 KR 부하 모델 ({index?.model.version.model ?? ''}, {index?.model.trained_until?.slice(0, 10)}까지 학습)이 실제로 계산한 값</li>
            {index?.model.weather && (
              <li>
                기온·습도: <a href="https://www.data.go.kr/data/15057210/openapi.do" target="_blank" rel="noreferrer">기상청 ASOS 시간자료</a> 관측값 (AI 입력으로 사용)
              </li>
            )}
            {index?.household ? (
              <li>
                세대 월 사용량: <a href={index.household.url} target="_blank" rel="noreferrer">한전 전력데이터 개방포털 가구 평균 전력사용량</a> (지역·월별, 시군구 값을 가구수로 가중 평균)
              </li>
            ) : (
              <li>
                세대 월평균 {ANCHOR_KWH_MONTH} kWh: <a href={ANCHOR_URL} target="_blank" rel="noreferrer">{ANCHOR_SOURCE}</a>
              </li>
            )}
          </ul>
        </div>
        <div>
          <Badge tone="warn">가정 (실제 아님)</Badge>
          <ul className="small" style={{ margin: '8px 0 0 16px' }}>
            <li>단지 구성(동·층·호)과 가로등 개수·{LAMP_KW * 1000} W·18~6시 점등</li>
            {index?.model.weather && <li>지역본부마다 대표 기상 관측소 1곳 (예: 경기본부 → 수원)</li>}
            <li>모든 세대가 같은 양을 씀(그 지역·그 달 가구 평균). 하루 중 시간 패턴은 지역 전체(주택·상가·산업 합계) 패턴을 씀. 세대별 실측 데이터는 없음</li>
            {index?.household && <li>지역본부↔시도 대응 (서울·남서울본부 = 서울 전체, 경기·경기북부본부 = 경기 전체, 세종 자료 없음)</li>}
            <li>가상 고장의 크기(누설 +1 kW, 전압 85%)와 측정은 잡음 없는 계산값</li>
            <li>세대 판정 규칙은 스마트 마을에서 실측으로 검증한 것과 같은 코드지만, 세대 흔들림({UNIT_RULE.sigmaRel * 100}%)·여유({UNIT_RULE.tolKw} kW)는 가정값</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function LayoutControls() {
  const s = useComplex()
  const num = (label: string, key: 'buildings' | 'floors' | 'perFloor', min: number, max: number) => (
    <label className="row small" style={{ gap: 4 }}>
      {label}
      <input
        className="num"
        type="number"
        min={min}
        max={max}
        value={s.layout[key]}
        style={{ width: 56 }}
        onChange={(e) => {
          const v = Math.max(min, Math.min(max, Number(e.target.value) || min))
          setLayout({ [key]: v })
        }}
      />
    </label>
  )
  return (
    <div className="row gap" style={{ flexWrap: 'wrap' }}>
      {num('동', 'buildings', 1, 40)}
      {num('층', 'floors', 1, 30)}
      {num('층당 호', 'perFloor', 1, 8)}
    </div>
  )
}

function SelPanel({ sel, data, readings }: { sel: Sel; data: RegionData | null; readings: ReturnType<typeof measure> | null }) {
  const s = useComplex()
  if (!sel || !readings || !readings[sel.b]) {
    return (
      <Section title="선택">
        <p className="small muted">단지 배치에서 세대나 가로등 칸을 누르세요.</p>
      </Section>
    )
  }
  const b = readings[sel.b]
  const r = sel.kind === 'unit' ? b.units[sel.i] : b.lamps[sel.i]
  if (!r) return null
  const key = sel.kind === 'unit' ? unitKey(sel.b, sel.i) : lampKey(sel.b, sel.i)
  const name = sel.kind === 'unit' ? unitName(s.layout, sel.b, sel.i) : `${101 + sel.b}동 가로등 ${sel.i + 1}`
  const fault = s.unitFaults.get(key)
  const on = !s.off.has(key)
  const bf = s.buildingFaults.get(sel.b)
  const nUnits = s.layout.floors * s.layout.perFloor
  return (
    <Section title={name} actions={<Status tone={STATUS_TONE[r.status]}>{UNIT_STATUS_LABEL[r.status]}</Status>}>
      <Metrics cols={2}>
        <Metric small label="측정" value={fmt(r.kw)} unit="kW" />
        <Metric small label="예상" value={fmt(r.expected)} unit="kW" foot={`전압 ${fmt(r.v, 0)} V`} />
      </Metrics>
      <div style={{ margin: '12px 0' }}>
        <Switch on={on} onToggle={() => toggleUnit(key)} label={on ? '차단기 켜짐' : '차단기 꺼짐'} />
      </div>
      <h3 className="small" style={{ margin: '12px 0 6px' }}>가상 고장 넣기</h3>
      <div className="row gap" style={{ flexWrap: 'wrap' }}>
        {(Object.keys(UNIT_FAULT_LABEL) as UnitFault[]).map((f) => (
          <button key={f} className={`btn btn-sm ${fault === f ? 'btn-danger on' : ''}`} onClick={() => (fault === f ? clearUnitFault(key) : injectUnitFault(data, key, name, f))}>
            {UNIT_FAULT_LABEL[f].split(' (')[0]}
          </button>
        ))}
      </div>
      {fault && <p className="hint">지금 들어간 고장: {UNIT_FAULT_LABEL[fault]}</p>}
      <h3 className="small" style={{ margin: '16px 0 6px' }}>{101 + sel.b}동 전체</h3>
      <div className="row gap" style={{ flexWrap: 'wrap' }}>
        {(Object.keys(BUILDING_FAULT_LABEL) as BuildingFault[]).map((f) => (
          <button key={f} className={`btn btn-sm ${bf === f ? 'btn-danger on' : ''}`} onClick={() => (bf === f ? clearBuildingFault(sel.b) : injectBuildingFault(data, sel.b, f))}>
            {BUILDING_FAULT_LABEL[f]}
          </button>
        ))}
        <button className="btn btn-sm" onClick={() => setBuildingPower(sel.b, nUnits, s.layout.lampsPerBuilding, false)}>
          동 전체 차단
        </button>
        <button className="btn btn-sm" onClick={() => setBuildingPower(sel.b, nUnits, s.layout.lampsPerBuilding, true)}>
          동 전체 투입
        </button>
      </div>
      <p className="hint">
        판정 규칙(스마트 마을과 같은 코드): |측정 − 정상| &gt; {UNIT_RULE.k} × 흔들림 + {UNIT_RULE.tolKw} kW 이면 이상, 그 80%부터 주의 · 꺼졌는데 전기가 흐르면 이상 · 전압 50% 미만이면 정전. 흔들림은 정상의 {UNIT_RULE.sigmaRel * 100}%로 가정(세대 실측 없음). 동 전력 {fmt(b.kw, 0)} kW / 예상 {fmt(b.expected, 0)} kW
      </p>
    </Section>
  )
}

function RealAI({ index, data, hour }: { index: ComplexIndex; data: RegionData; hour: number }) {
  const from = Math.max(0, hour - 24 * 4)
  const to = Math.min(data.hours - 1, hour + 24 * 2)
  const rows = useMemo(() => {
    const out = []
    for (let h = from; h <= to; h++) {
      out.push({ h, t: hourLabel(data.start, h).slice(5), actual: data.use[h], forecast: data.exp[h], z: data.z[h] })
    }
    return out
  }, [data, from, to])
  const regionEvents = index.events.filter((e) => e.node === data.region)
  const wide = index.wide_area.filter((w) => w.nodes.includes(data.region))
  return (
    <Section title={`실제 AI 판단 · ${data.region}`} description={`실제 사용량(MWh)과 AI 예측. 이 단지 화면의 세대 사용량은 이 실제 곡선을 세대 1곳 크기로 줄인 것입니다. ${index.model.note}`}>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="t" tick={CHART.tick} axisLine={CHART.axisLine} tickLine={CHART.tickLine} interval={23} />
            <YAxis tick={CHART.tick} axisLine={CHART.axisLine} tickLine={CHART.tickLine} width={52} />
            <Tooltip formatter={(v, n) => [typeof v === 'number' ? v.toLocaleString('ko-KR') : '–', n === 'actual' ? '실제' : 'AI 예측']} />
            <ReferenceLine x={hourLabel(data.start, hour).slice(5)} stroke={CHART.accent} strokeDasharray="3 3" />
            <Line type="monotone" dataKey="actual" stroke={CHART.ink} dot={false} strokeWidth={1.6} isAnimationActive={false} connectNulls={false} />
            <Line type="monotone" dataKey="forecast" stroke={CHART.accent} dot={false} strokeWidth={1.2} strokeDasharray="4 3" isAnimationActive={false} connectNulls={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="hint">검은 선 = 실제, 파란 점선 = AI 예측 (하루 전 시점 정보로 예측). 공휴일은 판단 보류.</p>
      <h3>2024년에 AI가 실제로 판정한 사건 · {data.region}</h3>
      {regionEvents.length === 0 && wide.length === 0 ? (
        <p className="small muted">이 지역은 2024년에 판정된 사건이 없습니다. 다른 지역을 골라 보세요 (충북·제주·대전세종충남에 지역 사건이 있습니다).</p>
      ) : (
        <ul className="cx-log">
          {regionEvents.map((e, k) => (
            <li key={`l${k}`} className="row gap" style={{ justifyContent: 'space-between' }}>
              <span className="small">
                <Badge tone="err">지역</Badge> {e.start.slice(0, 16)} · {e.kind === 'DROP' ? '급감' : '급증'} {e.hours}시간 · z {e.worst_z} · 실제/예측 {e.worst_ratio}
                {e.data_check && ' · 기록 오류 의심'}
              </span>
              <button className="btn btn-sm" onClick={() => setHour(hourOf(data.start, e.start))}>이 시각으로</button>
            </li>
          ))}
          {wide.map((w, k) => (
            <li key={`w${k}`} className="row gap" style={{ justifyContent: 'space-between' }}>
              <span className="small">
                <Badge tone="warn">광역</Badge> {w.start.slice(0, 16)} · {w.hours}시간 · 동시에 최대 {w.max_nodes}개 지역
              </span>
              <button className="btn btn-sm" onClick={() => setHour(hourOf(data.start, w.start))}>이 시각으로</button>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">사건의 실제 원인(설비 고장·행사·기록 오류 등)은 확인되지 않았습니다. 정답 라벨이 없는 데이터라 사람이 확인해야 합니다.</p>
    </Section>
  )
}
