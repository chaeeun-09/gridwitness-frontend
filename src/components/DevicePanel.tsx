import { useState } from 'react'
import { serialSupported } from '../lib/serial'
import { connectSerial, DEVICE_INFO, setConnected, switchToMock, TICK_MS, type VillageSnapshot } from '../lib/village'
import { Status } from './ui'

/** 데이터 출처(시뮬레이터 / 실측) 선택과 장치 연결 상태 */
export default function DevicePanel({ snap }: { snap: VillageSnapshot }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supported = serialSupported()
  const info = DEVICE_INFO[snap.source]

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      await connectSerial()
    } catch (e) {
      const msg = (e as Error).message
      // 포트 선택 창에서 취소한 경우는 오류로 보지 않음
      if (!/No port selected|cancel/i.test(msg)) setError(msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="source-switch" role="radiogroup" aria-label="데이터 출처">
        <button role="radio" aria-checked={snap.source === 'MOCK'} className={`source-opt ${snap.source === 'MOCK' ? 'on' : ''}`} onClick={() => switchToMock()}>
          <strong>시뮬레이터</strong>
          <span>브라우저에서 계측값을 만들고 고장을 주입합니다</span>
        </button>
        <button role="radio" aria-checked={snap.source === 'SERIAL'} className={`source-opt ${snap.source === 'SERIAL' ? 'on' : ''}`} onClick={connect} disabled={!supported || busy}>
          <strong>{busy ? '포트 선택 중…' : snap.source === 'SERIAL' ? '실측 장치 (다른 포트 선택)' : '실측 장치'}</strong>
          <span>{supported ? 'Arduino를 USB로 연결하고 시리얼 포트를 고릅니다' : '이 브라우저는 Web Serial을 지원하지 않습니다 · Chrome 또는 Edge'}</span>
        </button>
      </div>

      {(error || snap.lastError) && <div className="alert alert-err">{error ?? snap.lastError}</div>}

      <dl className="dl-rows" style={{ marginTop: 20 }}>
        <div>
          <dt>연결</dt>
          <dd className="row between">
            <Status tone={snap.connected ? 'ok' : 'err'} live={snap.connected}>{snap.connected ? '수신 중' : '끊김'}</Status>
            {snap.source === 'MOCK' && (
              <button className="btn btn-sm btn-ghost" onClick={() => setConnected(!snap.connected)}>
                {snap.connected ? '끊김 재현' : '다시 연결'}
              </button>
            )}
          </dd>
        </div>
        <div><dt>장치</dt><dd className="mono">{info.deviceId}</dd></div>
        <div><dt>센서</dt><dd>{info.sensor}</dd></div>
        <div><dt>포트</dt><dd className="mono">{info.port}</dd></div>
        <div><dt>수신</dt><dd className="num">{snap.packets.toLocaleString()}회 · {1000 / TICK_MS} Hz{snap.source === 'SERIAL' && ` · 형식 오류 ${snap.badFrames}줄`}</dd></div>
      </dl>

      <details className="protocol">
        <summary>시리얼 프로토콜</summary>
        <pre>{`115200 baud, 줄 단위

장치 → 웹  0.5초마다 (INA219 전체 값 + 릴레이 상태)
{"v":5.02,"i":0.281,"relay":1}

웹 → 장치  (D2 릴레이)
RELAY 0    → 정전 발생 (마을 전체 차단)
RELAY 1    → 전력 복구`}</pre>
        <p className="small muted">Arduino 예제: <code>arduino/gridwitness_village/gridwitness_village.ino</code></p>
      </details>
    </div>
  )
}
