import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { IconUpload } from '../components/Icons'
import { DIAG_LABEL, PageHeader, Section } from '../components/ui'
import { getActor } from '../lib/actor'
import { INPUT_SCENARIOS } from '../lib/scenarios'
import { MODEL_SCOPE } from '../lib/waveform'
import { CHANNELS, SOURCE_LABEL, type SourceType } from '../types'

const ext = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? ''
const base = (f: File) => f.name.replace(/\.[^.]+$/, '').toLowerCase()

/** 고른 파일들을 CSV 하나 또는 COMTRADE 짝(.cfg + .dat)으로 해석 */
function pickFiles(list: File[]): { file: File | null; cfg: File | null; error: string | null } {
  const cfg = list.find((f) => ext(f) === 'cfg') ?? null
  const dat = list.find((f) => ext(f) === 'dat') ?? null
  const csv = list.find((f) => ['csv', 'txt'].includes(ext(f))) ?? null
  const other = list.find((f) => !['cfg', 'dat', 'csv', 'txt'].includes(ext(f)))
  if (cfg || dat) {
    if (!cfg) return { file: null, cfg: null, error: 'COMTRADE는 .cfg 파일도 함께 선택해야 합니다 (.dat만 선택됨).' }
    if (!dat) return { file: null, cfg: null, error: 'COMTRADE는 .dat 파일도 함께 선택해야 합니다 (.cfg만 선택됨).' }
    if (base(cfg) !== base(dat)) return { file: dat, cfg, error: `파일 이름이 다릅니다 (${cfg.name}, ${dat.name}). 같은 기록인지 확인하세요.` }
    return { file: dat, cfg, error: null }
  }
  if (csv) return { file: csv, cfg: null, error: null }
  if (other) {
    const e = ext(other)
    const hint = e === 'cff' ? 'COMTRADE 2013 단일 파일(.cff)은 아직 지원하지 않습니다. .cfg + .dat로 내보내 주세요.' : e === 'xlsx' || e === 'xls' ? '엑셀은 CSV로 저장해서 올려주세요.' : `.${e} 형식은 지원하지 않습니다.`
    return { file: null, cfg: null, error: hint }
  }
  return { file: null, cfg: null, error: null }
}

export default function NewCase() {
  const nav = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [cfg, setCfg] = useState<File | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [scenario, setScenario] = useState('')
  const [drag, setDrag] = useState(false)
  const [title, setTitle] = useState('')
  const [sourceType, setSourceType] = useState<SourceType>('PUBLIC_DATASET')
  const [datasetId, setDatasetId] = useState('Xiong-public-fault-dataset')
  const [samplingRateHz, setFs] = useState<number>(MODEL_SCOPE.samplingRateHz)
  const [systemFrequencyHz, setSysHz] = useState<50 | 60>(50)
  const [labelMeaning, setLabelMeaning] = useState('이벤트 유형(SIF/MIF/PF/TD), 물리적 원인 아님')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const comtrade = !!cfg
  const chosen = INPUT_SCENARIOS.find((s) => s.id === scenario)

  function takeFiles(list: File[]) {
    const r = pickFiles(list)
    setFile(r.file)
    setCfg(r.cfg)
    setPickError(r.error)
    setScenario('')
    setError(null)
  }

  function loadScenario(id: string) {
    setScenario(id)
    const s = INPUT_SCENARIOS.find((x) => x.id === id)
    if (!s) return
    const f = s.build()
    setFile(f.file)
    setCfg(f.cfg ?? null)
    setPickError(null)
    setTitle(f.title)
    setSourceType(f.sourceType)
    setDatasetId('gridwitness-example')
    setFs(f.samplingRateHz)
    setSysHz(f.systemFrequencyHz)
    setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file || pickError?.includes('함께')) return setError(pickError ?? '파형 파일을 선택하세요.')
    setBusy(true)
    setError(null)
    try {
      const c = await api.registerCase({
        title: title || (cfg ? cfg.name : file.name),
        file,
        cfg: cfg ?? undefined,
        sourceType,
        datasetId,
        samplingRateHz,
        systemFrequencyHz,
        labelMeaning,
        actor: getActor(),
      })
      nav(`/cases/${c.id}`)
    } catch (err) {
      setError(`등록하지 못했습니다: ${(err as Error).message}`)
      setBusy(false)
    }
  }

  const groups = [...new Set(INPUT_SCENARIOS.map((s) => s.group))]

  return (
    <>
      <PageHeader
        crumbs={[{ label: '고장파형 분석', to: '/cases' }, { label: '새 사건' }]}
        title="고장파형 등록"
        description="CSV 또는 COMTRADE(.cfg + .dat)를 올리면 SHA-256 해시를 남기고, 모델 학습 범위와 비교하는 입력 진단을 실행합니다."
      />

      <form onSubmit={submit}>
        <div className="split">
          <Section title="파형 파일" description={`CSV: 열 순서 ${CHANNELS.join(', ')} · COMTRADE: .cfg와 .dat를 함께 선택`}>
            <label
              className={`dropzone ${file ? 'has-file' : ''} ${drag ? 'drag' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setDrag(true)
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDrag(false)
                takeFiles([...e.dataTransfer.files])
              }}
            >
              <input type="file" multiple accept=".csv,.txt,.cfg,.dat" className="sr-only" onChange={(e) => takeFiles([...(e.target.files ?? [])])} />
              <span className="dropzone-icon"><IconUpload /></span>
              {file ? (
                <>
                  <strong>{cfg ? `${cfg.name} + ${file.name}` : file.name}</strong>
                  <span className="small muted">
                    {comtrade ? 'COMTRADE · 채널·주파수는 .cfg에서 읽습니다' : 'CSV'} · {((file.size + (cfg?.size ?? 0)) / 1024).toFixed(1)} KB · 눌러서 다시 선택
                  </span>
                </>
              ) : (
                <>
                  <strong>파일을 끌어다 놓거나 눌러서 선택</strong>
                  <span className="small muted">.csv · .txt · .cfg + .dat · 최대 5 MB</span>
                </>
              )}
            </label>
            {pickError && <div className={`alert ${file ? 'alert-warn' : 'alert-err'}`}>{pickError}</div>}

            <label className="field" style={{ marginTop: 16 }}>
              예시 시나리오로 시험하기
              <select value={scenario} onChange={(e) => loadScenario(e.target.value)}>
                <option value="">선택하세요</option>
                {groups.map((g) => (
                  <optgroup key={g} label={g}>
                    {INPUT_SCENARIOS.filter((s) => s.group === g).map((s) => (
                      <option key={s.id} value={s.id}>{s.label} — 예상: {DIAG_LABEL[s.expect]}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {chosen && <p className="hint">{chosen.note}. 기능 시험용 합성 데이터이며 실제 계측 자료가 아닙니다.</p>}
          </Section>

          <Section title="출처와 계측 조건">
            <div className="form">
              <label className="field">사건 제목<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: OO 선로 A상 고장" /></label>
              <div className="form-row">
                <label className="field">
                  데이터 출처
                  <select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType)}>
                    {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field">데이터셋 / 장비 ID<input value={datasetId} onChange={(e) => setDatasetId(e.target.value)} /></label>
              </div>
              <div className="form-row">
                <label className="field">
                  샘플링 (Hz)
                  <input type="number" value={samplingRateHz} onChange={(e) => setFs(Number(e.target.value))} disabled={comtrade} />
                </label>
                <label className="field">
                  계통 주파수
                  <select value={systemFrequencyHz} onChange={(e) => setSysHz(Number(e.target.value) as 50 | 60)} disabled={comtrade}>
                    <option value={50}>50 Hz</option>
                    <option value={60}>60 Hz</option>
                  </select>
                </label>
              </div>
              {comtrade && <p className="hint" style={{ marginTop: -8 }}>COMTRADE는 .cfg에 적힌 샘플링·계통 주파수를 그대로 씁니다.</p>}
              <label className="field">라벨 의미<input value={labelMeaning} onChange={(e) => setLabelMeaning(e.target.value)} /></label>
              <div className="scope">
                <strong>현재 모델 학습 범위</strong> — {MODEL_SCOPE.rows}×{MODEL_SCOPE.cols} · {MODEL_SCOPE.samplingRateHz} Hz · 계통 {MODEL_SCOPE.systemFrequencyHz} Hz · 이벤트 유형 4종. 이 조건과 다르면 분석이 보류됩니다.
              </div>
            </div>
          </Section>
        </div>

        <div className="row gap" style={{ justifyContent: 'flex-end', marginTop: 32, paddingTop: 20, borderTop: '1px solid var(--line)' }}>
          {error && <span className="small text-bad" role="alert" style={{ marginRight: 'auto' }}>{error}</span>}
          <Link to="/cases" className="btn btn-ghost">취소</Link>
          <button className="btn btn-primary" disabled={busy || !file}>{busy ? '등록·진단 중…' : '등록하고 입력 진단'}</button>
        </div>
      </form>
    </>
  )
}
