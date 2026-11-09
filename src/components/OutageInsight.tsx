import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Section } from './ui'
import { CHART } from '../lib/chart'
import { KEPCO_OUTAGE_2025, KEPCO_OUTAGE_SOURCE, loadRegion, outageTotals, saveRegion } from '../data/kepcoOutage'

const fmt = (n: number) => n.toLocaleString('ko-KR')

/** 공공데이터 분석 화면 안의 사업화 근거: 문제 크기(한전 정전 통계) · 판독 시간 절감 계산(가정 입력) · 연계 구조 */
export default function OutageInsight() {
  const [region, setRegionState] = useState(loadRegion)
  const setRegion = (r: string) => (setRegionState(r), saveRegion(r))
  const rows = [...KEPCO_OUTAGE_2025].sort((a, b) => b.sustained - a.sustained)
  const total = outageTotals()
  const mine = KEPCO_OUTAGE_2025.find((r) => r.region === region)!
  const rank = rows.findIndex((r) => r.region === region) + 1

  // 판독 시간 계산: 기본값은 예시 가정값 (현업 인터뷰로 확정 필요)
  const [before, setBefore] = useState(30)
  const [after, setAfter] = useState(2)
  const [scope, setScope] = useState<'region' | 'nation'>('region')
  const cases = scope === 'region' ? mine.sustained : total.sustained
  const savedHours = Math.max(0, (cases * (before - after)) / 60)

  return (
    <>
      <div className="section" id="outage">
      <Section
        title="배전 정전 통계 · 2025년"
        description="일시정전은 원인을 조사해야 하는 정전, 순시·순간정전은 짧게 끊겼다 바로 돌아온 정전이에요."
        actions={
          <select className="impact-select" value={region} onChange={(e) => setRegion(e.target.value)} aria-label="지역본부">
            {KEPCO_OUTAGE_2025.map((r) => <option key={r.region} value={r.region}>{r.region}</option>)}
          </select>
        }
      >
        <div className="impact-stats">
          <div><span>전국 일시정전</span><strong>{fmt(total.sustained)}<small>건</small></strong></div>
          <div><span>전국 순시·순간정전</span><strong>{fmt(total.momentary)}<small>건</small></strong></div>
          <div className="hl"><span>{region} 일시정전</span><strong>{fmt(mine.sustained)}<small>건 · 전국 {rank}위</small></strong></div>
          <div className="hl"><span>{region} 순시·순간정전</span><strong>{fmt(mine.momentary)}<small>건</small></strong></div>
        </div>
        <ResponsiveContainer width="100%" height={420}>
          <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }} barGap={2}>
            <CartesianGrid stroke={CHART.grid} horizontal={false} />
            <XAxis type="number" tick={CHART.tick} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="region" width={110} tick={CHART.tick} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v) => `${v}건`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="sustained" name="일시정전" fill="#d64545" isAnimationActive={false} radius={[0, 4, 4, 0]}>
              {rows.map((r) => <Cell key={r.region} fill={r.region === region ? '#d64545' : '#f0a6a6'} />)}
            </Bar>
            <Bar dataKey="momentary" name="순시·순간정전" fill="#2f6bff" isAnimationActive={false} radius={[0, 4, 4, 0]}>
              {rows.map((r) => <Cell key={r.region} fill={r.region === region ? '#2f6bff' : '#b8cbff'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <p className="xs muted">
          출처: <a href={KEPCO_OUTAGE_SOURCE.url} target="_blank" rel="noreferrer">{KEPCO_OUTAGE_SOURCE.name}</a> · {KEPCO_OUTAGE_SOURCE.provider} · 기준 {KEPCO_OUTAGE_SOURCE.asOf} · {KEPCO_OUTAGE_SOURCE.license}. 통계 자료라 AI 학습·판정에는 쓰지 않아요.
        </p>
      </Section>
      </div>

      <div className="section">
        <Section title="판독 시간 절감 계산" description="정전 1건마다 고장파형을 읽고 원인 후보를 정리하는 시간을 얼마나 줄이는지 계산해요.">
          <div className="calc">
            <div className="calc-inputs">
              <label className="field">
                대상
                <select value={scope} onChange={(e) => setScope(e.target.value as 'region' | 'nation')}>
                  <option value="region">{region} 일시정전 {fmt(mine.sustained)}건</option>
                  <option value="nation">전국 일시정전 {fmt(total.sustained)}건</option>
                </select>
              </label>
              <label className="field">
                지금 판독 시간 (분/건)
                <input type="number" min={0} max={600} value={before} onChange={(e) => setBefore(Math.max(0, Number(e.target.value)))} />
              </label>
              <label className="field">
                GridWitness 판독 시간 (분/건)
                <input type="number" min={0} max={600} value={after} onChange={(e) => setAfter(Math.max(0, Number(e.target.value)))} />
              </label>
            </div>
            <div className="calc-out">
              <span>연간 줄어드는 판독 시간</span>
              <strong>{fmt(Math.round(savedHours))}<small>시간</small></strong>
              <em>{fmt(cases)}건 × ({before} − {after})분</em>
            </div>
          </div>
          <p className="calc-note">
            기본값은 <b>예시 가정값</b>이에요. 지금 판독 시간은 현업 인터뷰로 확인해야 하고, GridWitness 판독 시간(1~2분)은 기획서의 목표치예요. 최종 판단·출동 시간은 담당자 몫이라 계산에 넣지 않았어요.
          </p>
        </Section>
      </div>

      <div className="section">
        <Section title="GridWitness가 붙는 자리" description="기존 시스템을 대체하지 않고, 파형 판독만 보조해요.">
          <ol className="chain">
            <li><b>FRTU</b><span>현장 · 사고 순간 파형 녹화</span></li>
            <li><b>DAS</b><span>고장 구간 분리 · 복구</span></li>
            <li className="me"><b>GridWitness</b><span>유형 판독 · 근거 · 점검 순서 · 모르면 보류</span></li>
            <li><b>K-GIS</b><span>설비 위치 · 계통 추적 · 출동 지시 (연계 예정)</span></li>
            <li><b>담당자</b><span>최종 판단 · 설비 조작</span></li>
          </ol>
        </Section>
      </div>
    </>
  )
}
