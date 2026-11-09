import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { useActor } from '../lib/actor'
import { CHART } from '../lib/chart'
import { STATUS_LABEL, type VillageSnapshot } from '../lib/village'
import { MODEL_SCOPE, parseCsv, diagnose } from '../lib/waveform'
import type { AnalysisResult, InputDiagnosis } from '../types'
import EventCausePanel from './EventCausePanel'
import FaultAnalysis from './FaultAnalysis'
import { IconX } from './Icons'
import { Badge, NODE_TONE, Segmented, Status } from './ui'

type Tab = 'live' | 'csv'

/** FRTU가 보내는 실시간 계측 (마을 전체 전류·전압, 최근 1분) */
function LiveWave({ snap }: { snap: VillageSnapshot }) {
  const t0 = snap.history.length ? snap.history[snap.history.length - 1].t : 0
  const data = snap.history.map((h) => ({ t: (h.t - t0) / 1000, mA: h.i * 1000, v: h.v }))
  return (
    <>
      <div className="ai-sub">전류 (mA)</div>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 0]} tick={CHART.tick} axisLine={false} tickLine={false} unit="s" />
          <YAxis tick={CHART.tick} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
          <Tooltip formatter={(x) => (typeof x === 'number' ? x.toFixed(1) : x)} labelFormatter={(t) => `${Number(t).toFixed(1)} s`} />
          <Line dataKey="mA" stroke="#3157e0" dot={false} strokeWidth={1.6} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="ai-sub">전압 (V)</div>
      <ResponsiveContainer width="100%" height={90}>
        <LineChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={CHART.grid} vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 0]} hide />
          <YAxis tick={CHART.tick} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
          <Line dataKey="v" stroke="#24835a" dot={false} strokeWidth={1.6} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </>
  )
}

/** CSV 고장파형을 넣으면 바로 그려 보고, 서버 AI 분석을 요청 */
function CsvAnalysis() {
  const [actor] = useActor()
  const [file, setFile] = useState<File | null>(null)
  const [matrix, setMatrix] = useState<number[][] | null>(null)
  const [diag, setDiag] = useState<InputDiagnosis | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function load(f: File | undefined) {
    setFile(f ?? null)
    setMatrix(null)
    setDiag(null)
    setAnalysis(null)
    setErr(null)
    if (!f) return
    const parsed = parseCsv(await f.text())
    const r = diagnose(parsed, f.size, { samplingRateHz: MODEL_SCOPE.samplingRateHz, systemFrequencyHz: MODEL_SCOPE.systemFrequencyHz, sourceType: 'PUBLIC_DATASET' })
    setDiag(r.diagnosis)
    setMatrix(r.matrix)
  }

  async function run() {
    if (!file) return
    setBusy(true)
    setErr(null)
    try {
      const c = await api.registerCase({ title: file.name, file, sourceType: 'PUBLIC_DATASET', datasetId: 'upload', samplingRateHz: MODEL_SCOPE.samplingRateHz, systemFrequencyHz: MODEL_SCOPE.systemFrequencyHz, labelMeaning: '', actor })
      const done = await api.runAnalysis(c.id, 'EVENT_TYPE', actor)
      setAnalysis(done.analysis)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <label className="ai-drop">
        <input type="file" accept=".csv,text/csv" onChange={(e) => void load(e.target.files?.[0])} />
        <strong>{file ? file.name : '고장파형 CSV 넣기'}</strong>
        <span className="small muted">7채널 (Ia Ib Ic In Va Vb Vc) · {MODEL_SCOPE.samplingRateHz} Hz</span>
      </label>
      {diag && (
        <div className="row gap" style={{ flexWrap: 'wrap' }}>
          <Badge tone={diag.status === 'ACCEPTED' ? 'ok' : diag.status === 'LIMITED' ? 'warn' : 'err'}>
            입력 검사 {diag.status === 'ACCEPTED' ? '통과' : diag.status === 'LIMITED' ? '제한' : '거부'}
          </Badge>
          {diag.issues.slice(0, 2).map((i) => <span key={i.code} className="small muted">{i.message}</span>)}
        </div>
      )}
      {err && <div className="alert alert-err small">{err}</div>}
      {matrix && (
        <FaultAnalysis matrix={matrix} fs={MODEL_SCOPE.samplingRateHz} hz={MODEL_SCOPE.systemFrequencyHz} analysis={analysis} blocked={diag?.status === 'REJECTED'} busy={busy} types={['EVENT_TYPE']} onRun={run} compact />
      )}
    </div>
  )
}

/** 화면 오른쪽에 붙는 AI 분석 패널 (FRTU를 누르면 열림) */
export default function AiPanel({ snap, onClose }: { snap: VillageSnapshot; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('live')
  const alarm = useMemo(() => ['WARNING', 'FAULT', 'OUTAGE'].includes(snap.status), [snap.status])
  return (
    <aside className="ai-panel" aria-label="AI 분석">
      <div className="ai-head">
        <div style={{ minWidth: 0 }}>
          <div className="small muted">FRTU · 마을 인입 구간</div>
          <strong>AI 분석</strong>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="닫기"><IconX /></button>
      </div>
      <Segmented
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { value: 'live', label: '실시간 파형' },
          { value: 'csv', label: 'CSV 고장파형' },
        ]}
      />
      <div className="ai-body">
        {tab === 'live' ? (
          <>
            <div className={`ai-verdict ${alarm ? 'alarm' : ''}`}>
              <Status tone={NODE_TONE[snap.status]} live={alarm}><strong>{STATUS_LABEL[snap.status]}</strong></Status>
              <span className="num small">이상 점수 {snap.score.toFixed(2)}</span>
            </div>
            {snap.diagnosis && (
              <p className="small" style={{ margin: '8px 0 0' }}>
                {snap.diagnosis.kind === 'LOW' ? '켠 채널 중 전류를 안 흘리는 것이 있습니다' : '예상보다 전류가 많습니다'}
                {snap.diagnosis.candidates.length > 0 && ` · 의심: ${snap.diagnosis.candidates.map((id) => snap.leds[id].name).join(', ')}`}
              </p>
            )}
            <LiveWave snap={snap} />
            <div className="ai-events">
              <EventCausePanel />
            </div>
          </>
        ) : (
          <CsvAnalysis />
        )}
      </div>
    </aside>
  )
}
