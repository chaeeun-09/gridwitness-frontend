import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART } from '../lib/chart'
import { fmtTime } from '../lib/actor'
import { STATUS_LABEL, THRESHOLDS } from '../lib/village'
import type { AnyCase, IotCase } from '../types'
import { DiagnosisBadge, StageBadge, Steps } from './Badges'
import IssueList from './IssueList'
import ReviewPanel from './ReviewPanel'
import { Badge, Metric, Metrics, NODE_TONE, PageHeader, Section, Status } from './ui'

type Tab = 'record' | 'detection' | 'review'

const STEPS = ['이상 감지', '계측 기록', '데이터 점검', '이상 점수', '사람 검토']

export default function IotCaseView({ c, onChange }: { c: IotCase; onChange: (c: AnyCase) => void }) {
  const [tab, setTab] = useState<Tab>('record')
  const d = c.detection
  const t0 = c.window[0]?.t ?? 0
  const data = c.window.map((p) => ({
    s: +((p.t - t0) / 1000).toFixed(1),
    v: +p.v.toFixed(2),
    i: +p.i.toFixed(3),
    expected: +p.expected.toFixed(3),
    score: +p.score.toFixed(2),
  }))
  const axis = { tick: CHART.tick, axisLine: CHART.axisLine, tickLine: CHART.tickLine }

  return (
    <>
      <PageHeader
        crumbs={[{ label: '사건·검토 이력', to: '/history' }, { label: c.id }]}
        title={c.title}
        meta={
          <>
            <span className="mono">{c.id}</span>
            <Badge outline>IoT 이상 이벤트</Badge>
            <DiagnosisBadge status={c.diagnosis.status} />
            <StageBadge stage={c.stage} />
            <span className="num">{fmtTime(c.createdAt)}</span>
          </>
        }
        actions={<button className="btn no-print" onClick={() => window.print()}>PDF로 내보내기</button>}
      />
      <Steps steps={STEPS} done={c.stage === 'REVIEWED' ? 5 : 4} />

      <div className="tabs no-print" role="tablist">
        {([['record', '계측 기록'], ['detection', '이상 탐지 결과'], ['review', '검토·보고']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div key={tab} className="tab-panel">
        {tab === 'record' && (
          <>
            <Section title="예상 전류와 실제 전류" description={`${c.device.scope} · 릴레이 ${c.device.relayOn ? '켜짐' : '차단'} 상태에서 예상 ${c.device.expectedA.toFixed(2)} A`}>
              <div className="legend" style={{ marginBottom: 8 }}>
                <span><i style={{ background: CHART.ink }} />실제 전류</span>
                <span style={{ color: CHART.secondary }}><i className="dash" />예상 전류</span>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="s" unit="s" type="number" domain={['dataMin', 'dataMax']} {...axis} />
                  <YAxis unit="A" {...axis} width={52} />
                  <Tooltip />
                  <Line name="실제 전류" dataKey="i" stroke={CHART.ink} dot={false} strokeWidth={1.75} isAnimationActive={false} />
                  <Line name="예상 전류" dataKey="expected" stroke={CHART.secondary} strokeDasharray="4 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Section>
            <Section title="전압">
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="s" unit="s" type="number" domain={['dataMin', 'dataMax']} {...axis} />
                  <YAxis unit="V" domain={[0, 13]} {...axis} width={52} />
                  <Tooltip />
                  <Line name="전압" dataKey="v" stroke={CHART.ink} dot={false} strokeWidth={1.75} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Section>
            <div className="grid-2 section">
              <Section title="장치">
                <dl className="dl-rows">
                  <div><dt>장치</dt><dd className="mono">{c.device.deviceId}</dd></div>
                  <div><dt>센서</dt><dd>{c.device.sensor}</dd></div>
                  <div><dt>측정 범위</dt><dd>{c.device.scope}</dd></div>
                  <div><dt>정격</dt><dd>{c.device.nominalV} V DC</dd></div>
                  <div><dt>시뮬레이션 주입</dt><dd>{c.device.faultInjected ?? '없음'}</dd></div>
                </dl>
              </Section>
              <Section title="데이터 점검">
                <IssueList issues={c.diagnosis.issues} />
              </Section>
            </div>
          </>
        )}

        {tab === 'detection' && (
          <>
            <Metrics>
              <Metric label="판정" value={<Status tone={NODE_TONE[d.status]}><span style={{ fontSize: 20, fontWeight: 600 }}>{STATUS_LABEL[d.status]}</span></Status>} />
              <Metric label="최대 이상 점수" value={d.maxScore.toFixed(2)} foot={`주의 ≥ ${THRESHOLDS.warn} · 이상 ≥ ${THRESHOLDS.fault}`} />
              <Metric label="최대 잔차" value={d.maxResidualA.toFixed(2)} unit="A" foot="|실제 − 예상|" />
              <Metric label="최저 전압" value={d.minV.toFixed(2)} unit="V" />
            </Metrics>
            <Section title="이상 점수 추이">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="s" unit="s" type="number" domain={['dataMin', 'dataMax']} {...axis} />
                  <YAxis domain={[0, 1]} {...axis} width={52} />
                  <Tooltip />
                  <ReferenceLine y={THRESHOLDS.warn} stroke={CHART.warn} strokeDasharray="3 4" label={{ value: '주의', fontSize: 11, fill: CHART.warn, position: 'insideTopLeft' }} />
                  <ReferenceLine y={THRESHOLDS.fault} stroke={CHART.err} strokeDasharray="3 4" label={{ value: '이상', fontSize: 11, fill: CHART.err, position: 'insideTopLeft' }} />
                  <Line dataKey="score" name="이상 점수" stroke={CHART.ink} dot={false} strokeWidth={1.75} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Section>
            <Section title="근거">
              <ul>{d.findings.map((f) => <li key={f}>{f}</li>)}</ul>
              <div className="alert alert-warn" style={{ marginTop: 16 }}>
                <div>
                  <strong>함께 확인할 제한사항</strong>
                  <ul>{d.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
                </div>
              </div>
              <dl className="kv small">
                <div><dt>모델</dt><dd className="mono">{d.model}</dd></div>
                <div><dt>실행 시각</dt><dd className="num">{fmtTime(d.executedAt)}</dd></div>
              </dl>
            </Section>
          </>
        )}

        {tab === 'review' && (
          <ReviewPanel
            c={c}
            onChange={onChange}
            aiSummary={
              <>
                <span className="pred-sm">{STATUS_LABEL[d.status]}</span> <span className="muted num">점수 {d.maxScore.toFixed(2)}</span>
                <div className="xs muted mono">{d.model}</div>
              </>
            }
          />
        )}
      </div>
    </>
  )
}
