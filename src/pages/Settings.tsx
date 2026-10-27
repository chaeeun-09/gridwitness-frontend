import { useState, type ReactNode } from 'react'
import { isMock } from '../api'
import { clearBackendCache } from '../api/backend'
import { resetCases } from '../api/mock'
import ChannelMap from '../components/ChannelMap'
import DevicePanel from '../components/DevicePanel'
import { PageHeader } from '../components/ui'
import { useActor } from '../lib/actor'
import { apiBase, apiMode, checkHealth, DEFAULT_API, setApiBase, setApiMode, useBackendHealth } from '../lib/backend'
import { AI_MODELS } from '../lib/models'
import { NOMINAL_V, useVillage } from '../lib/village'

function Row({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-row">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </section>
  )
}

export default function Settings() {
  const snap = useVillage()
  const [actor, setActor] = useActor()
  const [confirming, setConfirming] = useState<null | 'examples' | 'empty'>(null)
  const [done, setDone] = useState<string | null>(null)
  const health = useBackendHealth()
  const [url, setUrl] = useState(apiBase)

  async function reset(withExamples: boolean) {
    if (isMock) await resetCases(withExamples)
    else clearBackendCache()
    setConfirming(null)
    setDone(withExamples ? '예시 사건을 다시 넣었습니다.' : '사건을 모두 비웠습니다.')
  }

  return (
    <>
      <PageHeader title="설정" description="데이터 출처와 회로 구성, 분석 모델, 작업자 정보를 관리합니다." />

      <Row
        title="분석 서버"
        description="기본은 이 브라우저 안의 Mock입니다. 서버 연결로 바꾸면 파일 등록·입력 진단·분석·검토 기록이 FastAPI 서버에 저장됩니다."
      >
        <div className="stack" style={{ gap: 14 }}>
          <div className="cluster">
            <button className={`btn ${apiMode() === 'MOCK' ? 'btn-primary' : ''}`} aria-pressed={apiMode() === 'MOCK'} onClick={() => apiMode() !== 'MOCK' && setApiMode('MOCK')}>Mock (브라우저)</button>
            <button className={`btn ${apiMode() === 'BACKEND' ? 'btn-primary' : ''}`} aria-pressed={apiMode() === 'BACKEND'} onClick={() => apiMode() !== 'BACKEND' && (setApiBase(url), setApiMode('BACKEND'))}>서버 연결</button>
          </div>
          <label className="field" style={{ maxWidth: 480 }}>
            서버 주소
            <input value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => setApiBase(url)} spellCheck={false} />
          </label>
          <div className="cluster">
            <button className="btn btn-sm" onClick={() => { setApiBase(url); void checkHealth() }} disabled={health.state === 'checking'}>{health.state === 'checking' ? '확인 중…' : '연결 확인'}</button>
            {health.state !== 'idle' && health.state !== 'checking' && (
              <span className="small" style={{ color: health.state === 'ok' ? 'var(--ok)' : 'var(--err)' }} role="status">{health.detail}</span>
            )}
            {url !== DEFAULT_API && <button className="btn btn-sm btn-ghost" onClick={() => setUrl(DEFAULT_API)}>기본 주소</button>}
          </div>
          <p className="hint">
            서버에 사건 목록 조회 기능이 아직 없어서 목록과 파형은 이 브라우저에 보관합니다. 지금 서버에는 분석 모델이 연결되어 있지 않아 이벤트 유형은 '판단 보류'로 나오고 특징값만 계산됩니다.
            모드를 바꾸면 사건 목록이 서로 달라집니다(Mock 사건과 서버 사건은 따로 보관).
          </p>
        </div>
      </Row>

      <Row title="데이터 출처" description="실제 모형이 없으면 Mock 시뮬레이터로 같은 화면을 시연할 수 있습니다.">
        <DevicePanel snap={snap} />
      </Row>

      <Row
        title="회로 구성"
        description={<>최종 구성도 기준. 5V DC 전원을 릴레이 하나로 마을 전체에 공급하고, INA219 하나로 전체 전압·전류를 측정합니다. LED 5개는 저항과 함께 병렬로 연결됩니다 (정격 {NOMINAL_V} V).</>}
      >
        <ChannelMap />
      </Row>

      <Row title="분석 모델" description="목적별로 분리된 두 모델입니다. 데이터를 섞어 학습하지 않습니다.">
        <div className="stack" style={{ gap: 28 }}>
          {AI_MODELS.map((m) => (
            <div key={m.name}>
              <div className="row gap" style={{ marginBottom: 8 }}>
                <strong>{m.name}</strong>
                <span className="mono xs faint">{m.version}</span>
              </div>
              <dl className="dl-rows">
                <div><dt>데이터</dt><dd>{m.data}</dd></div>
                <div><dt>입력</dt><dd>{m.input}</dd></div>
                <div><dt>출력</dt><dd>{m.output}</dd></div>
              </dl>
            </div>
          ))}
        </div>
      </Row>

      <Row title="작업자" description="검토와 실행 이력에 이 이름이 기록됩니다.">
        <label className="field" style={{ maxWidth: 320 }}>
          이름
          <input value={actor} onChange={(e) => setActor(e.target.value)} />
        </label>
      </Row>

      <Row title="사건 데이터" description={<>사건 목록은 이 브라우저(localStorage)에 저장됩니다. Mock에서는 처음 열면 [예시] 사건 8건이 들어 있습니다.{!isMock && ' 서버 연결 모드의 \'모두 비우기\'는 이 브라우저의 목록만 지우며 서버에 남은 기록은 삭제되지 않습니다.'}</>}>
        {confirming ? (
          <div className="alert alert-err" style={{ margin: 0, alignItems: 'center' }}>
            <span style={{ flex: 1 }}>
              {confirming === 'examples' ? '지금 사건을 모두 지우고 예시 8건으로 되돌립니다.' : '예시를 포함해 모든 사건과 검토 기록을 지웁니다.'} 되돌릴 수 없습니다.
            </span>
            <button className="btn btn-sm" onClick={() => setConfirming(null)}>취소</button>
            <button className="btn btn-sm btn-danger on" onClick={() => reset(confirming === 'examples')}>진행</button>
          </div>
        ) : (
          <div className="cluster">
            {isMock && <button className="btn" onClick={() => setConfirming('examples')}>예시 사건으로 되돌리기</button>}
            <button className="btn btn-danger" onClick={() => setConfirming('empty')}>모두 비우기</button>
            {done && <span className="small" style={{ color: 'var(--ok)' }} role="status">{done}</span>}
          </div>
        )}
      </Row>
    </>
  )
}
