import { useCallback, useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { api } from '../api'
import { DiagnosisBadge, StageBadge, Steps, WAVEFORM_STEPS, waveformStepsDone } from '../components/Badges'
import FaultAnalysis from '../components/FaultAnalysis'
import IotCaseView from '../components/IotCaseView'
import IssueList from '../components/IssueList'
import ReviewPanel from '../components/ReviewPanel'
import { ErrorState, PageHeader, PageSkeleton, Section } from '../components/ui'
import { fmtTime, getActor } from '../lib/actor'
import { SOURCE_LABEL, type AnalysisType, type AnyCase, type ChannelFeatures, type IncidentCase } from '../types'

type Tab = 'analysis' | 'diagnosis' | 'review' | 'source'
const TABS: [Tab, string][] = [
  ['analysis', '분석'],
  ['diagnosis', '입력 진단'],
  ['review', '검토·보고'],
  ['source', '원본 정보'],
]

export default function CaseDetail() {
  const { id = '' } = useParams()
  const [c, setC] = useState<AnyCase | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    setError(null)
    api.getCase(id).then(setC).catch((e: Error) => setError(e.message))
  }, [id])
  useEffect(load, [load])

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!c) return <PageSkeleton />
  return c.caseType === 'IOT' ? <IotCaseView c={c} onChange={setC} /> : <WaveformCaseView c={c} onChange={setC} />
}

function WaveformCaseView({ c, onChange }: { c: IncidentCase; onChange: (c: AnyCase) => void }) {
  const [tab, setTab] = useState<Tab>(c.diagnosis.status === 'REJECTED' ? 'diagnosis' : 'analysis')
  const fromHistory = useLocation().pathname.startsWith('/history')
  const ai = c.analysis
  return (
    <>
      <PageHeader
        crumbs={[fromHistory ? { label: '사건·검토 이력', to: '/history' } : { label: '고장파형 분석', to: '/cases' }, { label: c.id }]}
        title={c.title}
        meta={
          <>
            <span className="mono">{c.id}</span>
            <DiagnosisBadge status={c.diagnosis.status} />
            <StageBadge stage={c.stage} />
            <span>{SOURCE_LABEL[c.source.sourceType]}</span>
            <span className="num">{fmtTime(c.createdAt)}</span>
          </>
        }
        actions={<button className="btn no-print" onClick={() => window.print()}>PDF로 내보내기</button>}
      />
      <Steps steps={WAVEFORM_STEPS} done={waveformStepsDone(c.stage)} />

      <div className="tabs no-print" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      <div key={tab} className="tab-panel">
        {tab === 'source' && <SourcePanel c={c} />}
        {tab === 'diagnosis' && <DiagnosisPanel c={c} onNext={() => setTab('analysis')} />}
        {tab === 'analysis' && <AnalysisTab c={c} onChange={onChange} onReview={() => setTab('review')} />}
        {tab === 'review' && (
          <ReviewPanel
            c={c}
            onChange={onChange}
            aiSummary={
              !ai ? (
                <span className="muted">분석 기록 없음</span>
              ) : ai.kind === 'COMPLETED' ? (
                <>
                  <span className="pred-sm">{ai.predictedLabel}</span>
                  <div className="xs muted mono">{ai.modelVersion}</div>
                </>
              ) : (
                <>
                  <span className="pred-sm">판단 보류</span>
                  <div className="small muted">{ai.reasons[0]}</div>
                </>
              )
            }
          />
        )}
      </div>
    </>
  )
}

function SourcePanel({ c }: { c: IncidentCase }) {
  const s = c.source
  const rows: [string, React.ReactNode][] = [
    ['파일', s.fileName],
    ['크기', `${(s.fileSize / 1024).toFixed(1)} KB`],
    ['SHA-256', <span className="mono break">{s.sha256}</span>],
    ['출처', SOURCE_LABEL[s.sourceType]],
    ['데이터셋 / 장비 ID', s.datasetId || '—'],
    ['채널 순서', s.channelOrder.join(', ')],
    ['샘플링', `${s.samplingRateHz} Hz`],
    ['계통 주파수', `${s.systemFrequencyHz} Hz`],
    ['라벨 의미', s.labelMeaning || '—'],
    ['등록 시각', fmtTime(c.createdAt)],
  ]
  return (
    <Section title="원본 기록" description="같은 사고를 다시 볼 때 어떤 자료로 분석했는지 확인할 수 있도록 보존합니다.">
      <dl className="dl-rows">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
    </Section>
  )
}

const DIAG_SUMMARY = {
  ACCEPTED: ['ok', '분석 가능', '모델 학습 범위 안의 입력입니다. 지원하는 분석을 실행할 수 있습니다.'],
  LIMITED: ['warn', '분석 제한', '형식은 올바르지만 모델 학습 조건과 달라 결과를 내지 않고 보류합니다.'],
  REJECTED: ['err', '분석 불가', '형식 오류가 있어 분석하지 않습니다. 아래 수정 방법을 확인하세요.'],
} as const

function DiagnosisPanel({ c, onNext }: { c: IncidentCase; onNext: () => void }) {
  const d = c.diagnosis
  const [tone, head, body] = DIAG_SUMMARY[d.status]
  return (
    <>
      <div className={`verdict ${tone}`}>
        <span>
          <strong>{head}</strong> — {body}
        </span>
        <span className="spacer" />
        {d.status !== 'REJECTED' && <button className="btn btn-primary btn-sm" onClick={onNext}>AI 분석으로</button>}
      </div>
      <div className="stats">
        <div>행(샘플)<strong>{d.rows.toLocaleString()}</strong></div>
        <div>열(채널)<strong>{d.cols}</strong></div>
        <div>오류<strong>{d.issues.filter((i) => i.severity === 'error').length}</strong></div>
        <div>경고<strong>{d.issues.filter((i) => i.severity === 'warning').length}</strong></div>
      </div>
      {d.issues.length === 0 ? <p className="muted">발견된 문제가 없습니다.</p> : <IssueList issues={d.issues} />}
    </>
  )
}

function AnalysisTab({ c, onChange, onReview }: { c: IncidentCase; onChange: (c: AnyCase) => void; onReview: () => void }) {
  const [type, setType] = useState<AnalysisType>(c.analysis?.analysisType ?? 'EVENT_TYPE')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rejected = c.diagnosis.status === 'REJECTED' || !c.waveform

  async function run() {
    setBusy(true)
    setError(null)
    try {
      onChange(await api.runAnalysis(c.id, type, getActor()))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!c.waveform) {
    return c.diagnosis.status === 'REJECTED' ? (
      <ErrorState message="입력 진단에서 거부된 자료라 파형을 표시하지 않습니다. 입력 진단 탭의 수정 방법을 확인하세요." />
    ) : (
      <ErrorState message="이 브라우저에는 원본 파형이 없어 표시할 수 없습니다. 같은 파일을 다시 등록하면 파형을 볼 수 있습니다." />
    )
  }
  const features = c.analysis?.features
  return (
    <>
      {error && <div className="alert alert-err" style={{ marginTop: 0 }}>{error}</div>}
      <FaultAnalysis
        matrix={c.waveform}
        fs={c.source.samplingRateHz}
        hz={c.source.systemFrequencyHz}
        analysis={c.analysis}
        blocked={rejected}
        busy={busy}
        analysisType={type}
        onType={setType}
        types={['EVENT_TYPE']}
        onRun={run}
        onReview={onReview}
      />
      {features && (
        <details className="fa-details" style={{ marginTop: 16 }}>
          <summary>채널별 특징값 (모델 입력에 쓰인 값)</summary>
          <FeatureTable features={features} />
        </details>
      )}
    </>
  )
}

function FeatureTable({ features }: { features: ChannelFeatures[] }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="table-wrap">
        <table>
          <thead><tr><th>채널</th><th className="num">RMS</th><th className="num">Peak</th><th className="num">Crest factor</th><th className="num">변화율 RMS</th></tr></thead>
          <tbody>
            {features.map((f) => (
              <tr key={f.channel}>
                <td className="mono">{f.channel}</td>
                <td className="num">{f.rms.toFixed(2)}</td>
                <td className="num">{f.peak.toFixed(2)}</td>
                <td className="num">{f.crestFactor.toFixed(3)}</td>
                <td className="num">{f.diffRms.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
