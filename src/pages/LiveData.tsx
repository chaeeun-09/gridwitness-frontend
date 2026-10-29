import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import EventList from '../components/EventList'
import HardwareFlow from '../components/HardwareFlow'
import { Metric, Metrics, NODE_TONE, PageHeader, Section, Status } from '../components/ui'
import { CHART } from '../lib/chart'
import { IOT_MODEL, LED_A, STATUS_LABEL, THRESHOLDS, TICK_MS, useVillage, ZONE_LABEL, ZONE_SENSOR, zoneChannels } from '../lib/village'

/** 실시간 분석: 예상 전류 vs 실제 전류, 이상 점수, 경고 이력 */
export default function LiveData() {
  const snap = useVillage()
  const t0 = snap.history[0]?.t ?? 0
  const data = snap.history.map((h) => ({
    s: +((h.t - t0) / 1000).toFixed(1),
    i: +h.i.toFixed(3),
    expected: +h.expected.toFixed(3),
    score: +h.score.toFixed(2),
  }))
  const residual = snap.i - snap.expected
  const ledUnits = residual / LED_A
  const warnings = snap.events.length
  const axis = { tick: CHART.tick, axisLine: CHART.axisLine, tickLine: CHART.tickLine }
  const scoreColor = (s: number) => (s >= THRESHOLDS.fault ? CHART.err : s >= THRESHOLDS.warn ? CHART.warn : CHART.ink)

  return (
    <>
      <PageHeader
        title="실시간 분석"
        description={`릴레이 상태로 마을 전체 예상 전류를 정하고, INA219가 잰 실제 전류와의 차이와 전압 강하로 이상 점수를 계산합니다. 최근 ${Math.round((snap.history.length * TICK_MS) / 1000)}초.`}
        meta={<span className="mono">{IOT_MODEL}</span>}
      />

      <Metrics cols={3}>
        <Metric label="실제 / 예상 전류" value={snap.i.toFixed(3)} unit={`/ ${snap.expected.toFixed(3)} A`} foot={<span className={Math.abs(residual) > 0.04 ? 'bad' : ''}>차이 {residual >= 0 ? '+' : ''}{residual.toFixed(3)} A · LED {ledUnits >= 0 ? '+' : ''}{ledUnits.toFixed(1)}개 분량</span>} />
        <Metric label="이상 점수" value={<span style={{ color: scoreColor(snap.score) }}>{snap.score.toFixed(2)}</span>} foot={`주의 ≥ ${THRESHOLDS.warn} · 이상 ≥ ${THRESHOLDS.fault}`} />
        <Metric label="경고 이력" value={warnings} unit="건" foot={`진행 중 ${snap.events.filter((e) => !e.clearedAt).length}건`} />
      </Metrics>

      <div className="grid-2 section">
        <Section title="예상 대비 실제 전류" description="마을 전체 합계">
          <div className="legend" style={{ marginBottom: 8 }}>
            <span><i style={{ background: CHART.ink }} />실제</span>
            <span style={{ color: CHART.secondary }}><i className="dash" />예상</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="s" unit="s" type="number" domain={['dataMin', 'dataMax']} {...axis} />
              <YAxis unit="A" domain={[0, 'auto']} {...axis} width={52} />
              <Tooltip />
              <Line name="실제 전류" dataKey="i" stroke={CHART.ink} dot={false} strokeWidth={1.75} isAnimationActive={false} />
              <Line name="예상 전류" dataKey="expected" stroke={CHART.secondary} strokeDasharray="4 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Section>
        <Section title="이상 점수" description="0 = 예상대로, 1 = LED 2개 분량 이상 차이 또는 큰 전압 강하">
          <div className="legend" style={{ marginBottom: 8 }}>
            <span style={{ color: CHART.warn }}><i className="dash" />주의 {THRESHOLDS.warn}</span>
            <span style={{ color: CHART.err }}><i className="dash" />이상 {THRESHOLDS.fault}</span>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="s" unit="s" type="number" domain={['dataMin', 'dataMax']} {...axis} />
              <YAxis domain={[0, 1]} {...axis} width={52} />
              <Tooltip />
              <ReferenceLine y={THRESHOLDS.warn} stroke={CHART.warn} strokeDasharray="3 4" />
              <ReferenceLine y={THRESHOLDS.fault} stroke={CHART.err} strokeDasharray="3 4" />
              <Line name="이상 점수" dataKey="score" stroke={CHART.ink} dot={false} strokeWidth={1.75} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </Section>
      </div>

      <Section title="판정 근거" description={snap.zones ? '주택 구간과 가로등 구간을 INA219 두 개로 따로 잽니다. 예상 전류는 켜진 채널 수 × LED 1개 정격(0.056 A)이고, 이상 점수는 전체와 구간 중 가장 큰 값입니다.' : 'INA219 하나로 마을 전체만 측정하는 예전 장치입니다. LED별 상태는 전류 차이를 LED 1개 정격(0.056 A)으로 나눠 추정합니다.'}>
        <dl className="dl-rows">
          <div><dt>릴레이</dt><dd>{snap.relay ? '닫힘 — 5개 LED에 전원 공급' : '열림 — 마을 전체 차단'}</dd></div>
          <div><dt>전압</dt><dd className="num">{snap.v.toFixed(2)} V <span className="muted">(정격 5 V, {THRESHOLDS.vMin} V 미만이면 점수 상승)</span></dd></div>
          <div><dt>실제 전류</dt><dd className="num">{snap.i.toFixed(3)} A</dd></div>
          <div><dt>예상 전류</dt><dd className="num">{snap.expected.toFixed(3)} A <span className="muted">(켜져야 할 LED × {LED_A} A)</span></dd></div>
          <div><dt>차이</dt><dd className={`num ${Math.abs(residual) > 0.04 ? 'text-bad' : ''}`}>{residual >= 0 ? '+' : ''}{residual.toFixed(3)} A · LED {ledUnits >= 0 ? '+' : ''}{ledUnits.toFixed(1)}개 분량</dd></div>
          <div><dt>전력</dt><dd className="num">{snap.p.toFixed(2)} W</dd></div>
          <div><dt>켜진 LED (추정)</dt><dd className="num">{snap.estLit} / 5 <span className="muted">(채널 켜짐 {Object.values(snap.channels).filter(Boolean).length}개)</span></dd></div>
          {snap.zones &&
            (['HOUSE', 'LAMP'] as const).map((k) => {
              const z = snap.zones![k]
              const d = z.i - z.expected
              return (
                <div key={k}>
                  <dt>{ZONE_LABEL[k]} <span className="muted xs">{ZONE_SENSOR[k]}</span></dt>
                  <dd className="num">
                    {z.i.toFixed(3)} A / 예상 {z.expected.toFixed(3)} A · <span className={Math.abs(d) > 0.04 ? 'text-bad' : ''}>차이 {d >= 0 ? '+' : ''}{d.toFixed(3)} A</span> · LED {z.estLit}/{zoneChannels(k).length} · 점수 {z.score.toFixed(2)}
                  </dd>
                </div>
              )
            })}
          <div>
            <dt>판정</dt>
            <dd className="row gap">
              <Status tone={NODE_TONE[snap.status]}>{STATUS_LABEL[snap.status]}</Status>
              <div className="score-cell"><div className="bar"><div style={{ width: `${snap.score * 100}%`, background: scoreColor(snap.score) }} /></div><span className="num small">{snap.score.toFixed(2)}</span></div>
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="경고 이력" description="이상 구간을 사건으로 등록하면 계측 기록 그대로 검토 단계로 넘어갑니다.">
        <EventList events={snap.events} limit={20} />
      </Section>

      <HardwareFlow />
    </>
  )
}
