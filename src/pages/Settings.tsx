import { useState, type ReactNode } from 'react'
import { resetCases } from '../api/mock'
import ChannelMap from '../components/ChannelMap'
import DevicePanel from '../components/DevicePanel'
import { PageHeader } from '../components/ui'
import { useActor } from '../lib/actor'
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

  async function reset(withExamples: boolean) {
    await resetCases(withExamples)
    setConfirming(null)
    setDone(withExamples ? '예시 사건을 다시 넣었습니다.' : '사건을 모두 비웠습니다.')
  }

  return (
    <>
      <PageHeader title="설정" description="데이터 출처와 회로 구성, 분석 모델, 작업자 정보를 관리합니다." />

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

      <Row title="사건 데이터" description="사건과 검토 기록은 이 브라우저(localStorage)에만 저장됩니다. 처음 열면 [예시] 사건 8건이 들어 있습니다.">
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
            <button className="btn" onClick={() => setConfirming('examples')}>예시 사건으로 되돌리기</button>
            <button className="btn btn-danger" onClick={() => setConfirming('empty')}>모두 비우기</button>
            {done && <span className="small" style={{ color: 'var(--ok)' }} role="status">{done}</span>}
          </div>
        )}
      </Row>
    </>
  )
}
