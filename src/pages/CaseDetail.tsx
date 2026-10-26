import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { api } from '../api'
import { DiagnosisBadge, StageBadge, Steps, WAVEFORM_STEPS, waveformStepsDone } from '../components/Badges'
import IotCaseView from '../components/IotCaseView'
import IssueList from '../components/IssueList'
import ReviewPanel from '../components/ReviewPanel'
import { ErrorState, PageHeader, PageSkeleton, Section, Segmented, Skeleton } from '../components/ui'
import WaveformChart from '../components/WaveformChart'
import { fmtTime, getActor } from '../lib/actor'
import { ANALYSIS_LABEL, SOURCE_LABEL, type AnalysisResult, type AnalysisType, type AnyCase, type ChannelFeatures, type EventLabel, type IncidentCase } from '../types'

const Waveform3D = lazy(() => import('../components/Waveform3D'))

type Tab = 'diagnosis' | 'waveform' | 'analysis' | 'review' | 'source'
const TABS: [Tab, string][] = [
  ['diagnosis', '입력 진단'],
  ['waveform', '파형'],
  ['analysis', 'AI 분석'],
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
  const [tab, setTab] = useState<Tab>('diagnosis')
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
        {tab === 'waveform' && <WaveformPanel c={c} />}
        {tab === 'analysis' && <AnalysisPanel c={c} onChange={onChange} onReview={() => setTab('review')} />}
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

function WaveformPanel({ c }: { c: IncidentCase }) {
  const [view, setView] = useState<'3d' | '2d'>('2d')
  if (!c.waveform) {
    return <ErrorState message="입력 진단에서 거부된 자료라 파형을 표시하지 않습니다. 입력 진단 탭의 수정 방법을 확인하세요." />
  }
  return (
    <Section
      title="7채널 파형"
      description={`${c.diagnosis.rows.toLocaleString()} 샘플 · ${c.source.samplingRateHz} Hz · 계통 ${c.source.systemFrequencyHz} Hz`}
      actions={<Segmented value={view} onChange={setView} options={[{ value: '2d', label: '2D 상세' }, { value: '3d', label: '3D 개요' }]} />}
    >
      {view === '3d' ? (
        <Suspense fallback={<Skeleton h={460} style={{ borderRadius: 12 }} />}>
          <Waveform3D matrix={c.waveform} samplingRateHz={c.source.samplingRateHz} systemFrequencyHz={c.source.systemFrequencyHz} />
        </Suspense>
      ) : (
        <WaveformChart matrix={c.waveform} samplingRateHz={c.source.samplingRateHz} />
      )}
    </Section>
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

function AnalysisPanel({ c, onChange, onReview }: { c: IncidentCase; onChange: (c: AnyCase) => void; onReview: () => void }) {
  const [type, setType] = useState<AnalysisType>('EVENT_TYPE')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rejected = c.diagnosis.status === 'REJECTED'

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

  return (
    <>
      <div className="filters no-print">
        <label className="field" style={{ flex: '1 1 320px' }}>
          요청할 분석
          <select value={type} onChange={(e) => setType(e.target.value as AnalysisType)} disabled={rejected}>
            {Object.entries(ANALYSIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" onClick={run} disabled={busy || rejected}>{busy ? '확인 중…' : c.analysis ? '다시 실행' : '지원 여부 확인 후 실행'}</button>
      </div>
      {rejected && <div className="alert alert-err">입력 진단에서 거부된 자료는 분석하지 않습니다.</div>}
      {error && <div className="alert alert-err">{error}</div>}
      {busy && !c.analysis && <Skeleton h={160} style={{ marginTop: 24 }} />}
      {c.analysis && <AnalysisResultView r={c.analysis} onReview={onReview} />}
    </>
  )
}

function AnalysisResultView({ r, onReview }: { r: AnalysisResult; onReview: () => void }) {
  return (
    <Section
      title={r.kind === 'COMPLETED' ? 'AI 결과' : '추가 확인 필요'}
      description={ANALYSIS_LABEL[r.analysisType]}
      actions={<button className="btn btn-sm" onClick={onReview}>검토 기록하기</button>}
      style={{ marginTop: 32 }}
    >
      {r.kind === 'COMPLETED' ? (
        <>
          <div className="result-head">
            <div>
              <div className="small muted">예측 이벤트 유형</div>
              <div className="pred">{r.predictedLabel}</div>
            </div>
            <ScoreBars scores={r.scores} highlight={r.predictedLabel} />
          </div>
          <div className="alert alert-warn">
            <div>
              <strong>함께 확인할 제한사항</strong>
              <ul>{r.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="verdict warn">
            <span><strong>결과를 내지 않았습니다.</strong> 근거가 부족한 상태에서 원인을 임의로 추정하지 않습니다.</span>
          </div>
          <div className="grid-2">
            <div>
              <h3 className="section-title" style={{ fontSize: 13.5, marginBottom: 8 }}>보류 이유</h3>
              <ul className="small">{r.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
            <div>
              <h3 className="section-title" style={{ fontSize: 13.5, marginBottom: 8 }}>추가로 필요한 정보</h3>
              <ul className="small">{r.neededInfo.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          </div>
          {r.scores && (
            <div style={{ marginTop: 24 }}>
              <div className="small muted" style={{ marginBottom: 8 }}>참고: 모델 출력 (판단에 쓰지 않음)</div>
              <ScoreBars scores={r.scores} />
            </div>
          )}
        </>
      )}
      {r.features && <FeatureTable features={r.features} />}
      <dl className="kv small">
        <div><dt>모델</dt><dd className="mono">{r.modelVersion ?? '실행 안 함'}</dd></div>
        <div><dt>전처리</dt><dd className="mono">{r.preprocessVersion ?? '—'}</dd></div>
        <div><dt>실행 시각</dt><dd className="num">{fmtTime(r.executedAt)}</dd></div>
      </dl>
    </Section>
  )
}

function ScoreBars({ scores, highlight }: { scores: Record<EventLabel, number>; highlight?: EventLabel }) {
  return (
    <div className="scores">
      {Object.entries(scores).map(([k, v]) => (
        <div key={k} className={`score ${k === highlight ? 'hl' : ''}`}>
          <span className="mono">{k}</span>
          <div className="bar"><div style={{ width: `${v * 100}%` }} /></div>
          <span className="num" style={{ textAlign: 'right' }}>{v.toFixed(2)}</span>
        </div>
      ))}
      <p className="hint">보정되지 않은 점수입니다. 정답일 확률이 아닙니다.</p>
    </div>
  )
}

function FeatureTable({ features }: { features: ChannelFeatures[] }) {
  return (
    <div style={{ marginTop: 28 }}>
      <div className="small muted" style={{ marginBottom: 8 }}>참고 특징값</div>
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
