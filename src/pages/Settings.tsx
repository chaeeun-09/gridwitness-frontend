import { useState, type ReactNode } from 'react'
import { clearBackendCache } from '../api/backend'
import ChannelMap from '../components/ChannelMap'
import DevicePanel from '../components/DevicePanel'
import { PageHeader } from '../components/ui'
import { useActor } from '../lib/actor'
import { apiBase, checkHealth, DEFAULT_API, setApiBase, useBackendHealth } from '../lib/backend'
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
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const health = useBackendHealth()
  const [url, setUrl] = useState(apiBase)

  function reset() {
    clearBackendCache()
    setConfirming(false)
    setDone('이 브라우저에 보관한 사건 기록과 파형을 비웠습니다.')
  }

  return (
    <>
      <PageHeader title="설정" description="데이터 출처와 회로 구성, 분석 모델, 작업자 정보를 관리합니다." />

      <Row
        title="분석 서버"
        description="파일 등록·입력 진단·분석·검토 기록이 FastAPI 서버에 저장됩니다."
      >
        <div className="stack" style={{ gap: 14 }}>
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
            사건 목록은 서버에서 불러오고, 원본 파형은 등록한 브라우저에만 보관합니다. 지금 서버에는 분석 모델이 연결되어 있지 않아 이벤트 유형은 '판단 보류'로 나오고 특징값만 계산됩니다.
          </p>
        </div>
      </Row>

      <Row title="데이터 출처" description="실제 모형이 없으면 시뮬레이터 값으로 같은 화면을 시연할 수 있습니다. (사건 데이터가 아니라 마을 계측값입니다)">
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

      <Row title="사건 데이터" description="원본 파형과 작업 기록은 이 브라우저(localStorage)에 저장됩니다. '비우기'는 이 브라우저의 보관본만 지우며 서버 기록은 삭제되지 않고, 목록에는 다시 나타납니다(파형 제외).">
        {confirming ? (
          <div className="alert alert-err" style={{ margin: 0, alignItems: 'center' }}>
            <span style={{ flex: 1 }}>이 브라우저에 보관한 파형과 기록을 지웁니다. 서버 기록은 남고 목록에는 다시 나타나지만 파형은 다시 등록해야 볼 수 있습니다.</span>
            <button className="btn btn-sm" onClick={() => setConfirming(false)}>취소</button>
            <button className="btn btn-sm btn-danger on" onClick={reset}>진행</button>
          </div>
        ) : (
          <div className="cluster">
            <button className="btn btn-danger" onClick={() => setConfirming(true)}>보관본 비우기</button>
            {done && <span className="small" style={{ color: 'var(--ok)' }} role="status">{done}</span>}
          </div>
        )}
      </Row>
    </>
  )
}
