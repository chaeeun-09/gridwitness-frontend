import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART } from '../lib/chart'
import { clearVillageEvents, EVENT_MODEL, eventModelReady, useVillageEvents, type AnalyzedEvent } from '../lib/villageEvents'
import { Badge, Section } from './ui'

const CH_NAME = ['주택 1', '주택 2', '주택 3', '가로등 1', '가로등 2']

function cmdText(cmd: string): string {
  const m = /^CH (\d) ([01])$/.exec(cmd)
  if (m) return `${CH_NAME[Number(m[1]) - 1]} ${m[2] === '1' ? '켜기' : '끄기'} 명령`
  if (cmd === 'RELAY 0') return '마을 전원 차단 명령'
  if (cmd === 'RELAY 1') return '마을 전원 복구 명령'
  return cmd
}

function VerdictBadge({ a }: { a: AnalyzedEvent }) {
  const v = a.verdict
  if (v.kind === 'REJECTED') return <Badge tone="err">입력 거부</Badge>
  if (v.kind === 'NO_MODEL') return <Badge tone="off">모델 학습 전</Badge>
  if (v.kind === 'WITHHELD') return <Badge tone="warn">보류</Badge>
  return <Badge tone={v.isFault ? 'err' : 'ok'}>{v.labelKo}</Badge>
}

function Detail({ a }: { a: AnalyzedEvent }) {
  const { e, verdict: v } = a
  const data = e.i100.map((x, k) => ({ t: (k - e.pre) * e.dtMs, mA: x / 100 }))
  const maxAbs = v.kind === 'ANSWERED' || v.kind === 'WITHHELD' ? Math.max(...v.evidence.map((x) => Math.abs(x.contribution)), 1e-9) : 1
  return (
    <div className="grid-2" style={{ gap: 16, alignItems: 'start' }}>
      <div>
        <div className="small muted" style={{ marginBottom: 4 }}>
          사건 #{e.ev} 파형 · 마을 전체 전류 · {e.dtMs} ms 간격 · {e.src === 'cmd' ? cmdText(e.cmd) : '명령 없이 전류가 갑자기 변함'}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={CHART.tick} axisLine={false} tickLine={false} unit=" ms" />
            <YAxis tick={CHART.tick} axisLine={false} tickLine={false} width={44} domain={['auto', 'auto']} />
            <Tooltip formatter={(x) => (typeof x === 'number' ? `${x.toFixed(2)} mA` : x)} labelFormatter={(t) => `${t} ms`} />
            <ReferenceLine x={0} stroke="#cf3434" strokeDasharray="4 3" label={{ value: '사건 시점', position: 'top', fill: '#cf3434', fontSize: 11 }} />
            <Line dataKey="mA" stroke={CHART.ink} dot={false} strokeWidth={1.4} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div>
        {v.kind === 'REJECTED' || v.kind === 'NO_MODEL' ? (
          <>
            <p className="fa-withheld">{v.kind === 'REJECTED' ? '입력 검사에서 거부되어 분석하지 않았습니다.' : '원인을 추정하지 않았습니다.'}</p>
            <ul className="small">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </>
        ) : (
          <>
            {v.kind === 'ANSWERED' ? (
              <div className="fa-result">
                <div>
                  <div className="small muted">AI 원인 분석</div>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{v.labelKo}</div>
                  <div className="small">{v.isFault ? '고장으로 판단 · 현장 확인 필요' : '고장 아님'}</div>
                </div>
                <div className="fa-score">
                  <span className="small muted">모델 점수</span>
                  <strong className="num">{v.score.toFixed(2)}</strong>
                </div>
              </div>
            ) : (
              <>
                <p className="fa-withheld">근거가 부족해 원인을 정하지 않았습니다 (보류).</p>
                <ul className="small">{v.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </>
            )}
            <div className="small muted" style={{ margin: '8px 0 4px' }}>유형별 점수 (보정 안 된 값, 확률 아님)</div>
            <ul className="small plain-list">
              {v.ranking.slice(0, 3).map((r) => (
                <li key={r.label}>{r.labelKo} <span className="num muted">{r.score.toFixed(2)}</span></li>
              ))}
            </ul>
            <div className="small muted" style={{ margin: '10px 0 6px' }}>{v.kind === 'ANSWERED' ? '판단에 영향을 준 특징' : '1순위 후보 점수를 움직인 특징 (참고용)'}</div>
            <ul className="ai-feats">
              {v.evidence.map((f) => (
                <li key={f.name}>
                  <span className="ai-feat-name" title={`${f.name} = ${f.value.toFixed(2)}`}>{f.label} <span className="muted num">({f.value.toFixed(f.name.endsWith('_ms') || f.name.startsWith('n_') || f.name === 'transitions' ? 0 : 2)})</span></span>
                  <span className="ai-feat-bar"><i className={f.contribution >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(f.contribution) / maxAbs) * 50}%` }} /></span>
                  <span className="num small">{f.contribution >= 0 ? '+' : '−'}{Math.abs(f.contribution).toFixed(3)}</span>
                </li>
              ))}
            </ul>
            <p className="hint">경로 기여도(Saabas): 숲의 각 나무에서 그 특징으로 갈라질 때 1순위 유형 점수가 바뀐 양의 평균.</p>
          </>
        )}
      </div>
    </div>
  )
}

/** 스케치 v3 가 보낸 사건 파형마다 원인을 분석해 보여준다 (고장파형 AI 와 같은 흐름을 마을 규모로) */
export default function EventCausePanel() {
  const list = useVillageEvents()
  const [sel, setSel] = useState<number | null>(null)
  const chosen = list.find((a) => a.e.ev === sel) ?? list[0]
  const m = EVENT_MODEL.metrics
  return (
    <Section
      title="사건 원인 분석"
      description="모형에서 전류가 갑자기 바뀌면 우노가 그 앞 0.6초·뒤 2.0초를 녹화해 보냅니다. 파형으로 단선·순간/반복 접촉 불량·정상 개폐·복구를 가리고, 근거가 부족하면 보류합니다."
      actions={list.length > 0 && <button className="btn btn-sm btn-ghost" onClick={clearVillageEvents}>목록 비우기</button>}
    >
      {list.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          아직 받은 사건이 없습니다. 모형에서 LED를 뽑거나 건드리거나, 스위치로 채널을 끄고 켜 보세요. (우노에 스케치 v3.1이 올라가 있어야 합니다)
        </p>
      ) : (
        <>
          <div className="row gap" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
            {list.map((a) => (
              <button key={a.e.ev} className={`btn btn-sm ${chosen === a ? 'btn-primary' : ''}`} onClick={() => setSel(a.e.ev)}>
                #{a.e.ev} <VerdictBadge a={a} />
              </button>
            ))}
          </div>
          {chosen && <Detail a={chosen} />}
        </>
      )}
      <p className="xs muted" style={{ marginTop: 12 }}>
        {eventModelReady() && m
          ? `모델 ${EVENT_MODEL.version} · 우리 모형에서 실제로 만든 사건 ${m.n_train + m.n_test}개로 학습·평가 (시험 ${m.n_test}개: 전부 답하면 정확도 ${(m.test_all.accuracy * 100).toFixed(1)}%, 보류 ${m.test_selective.abstained}개, 답한 것 정확도 ${m.test_selective.selective_accuracy == null ? '–' : (m.test_selective.selective_accuracy * 100).toFixed(1) + '%'}, 고장 아닌 사건을 고장이라 한 수 ${m.fault_vs_not.nonfault_called_fault}) · 직류 모형 전류라 한전 교류 고장파형과 같은 신호는 아닙니다.`
          : '원인 분류 모델은 아직 학습 전입니다. 우리 모형에서 실제로 사건을 만들어 모은 뒤 학습합니다 (지어낸 데이터로 학습하지 않음).'}
      </p>
    </Section>
  )
}
