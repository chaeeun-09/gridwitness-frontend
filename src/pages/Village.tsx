import { useState } from 'react'
import { Link } from 'react-router-dom'
import Channels from '../components/Channels'
import PartPanel from '../components/PartPanel'
import SceneBoundary from '../components/SceneBoundary'
import EventList from '../components/EventList'
import { IconMoon, IconSun, IconX } from '../components/Icons'
import Sparkline from '../components/Sparkline'
import { Badge, Metric, Metrics, NODE_TONE, PageHeader, Section, Segmented, Status } from '../components/ui'
import VillageScene from '../components/village/VillageScene'
import { NET_COLOR, NET_KIND_LABEL, type NetKind, type PartId } from '../lib/hardware'
import {
  clearFault,
  FAULT_AT_LED,
  FAULT_LABEL,
  injectFault,
  IOT_CHANNELS,
  lightView,
  setConnected,
  setRelay,
  STATUS_LABEL,
  stopScenario,
  useVillage,
  type ChannelId,
  type FaultKind,
} from '../lib/village'

/** 보기 설정은 브라우저별로 기억 */
function useStoredFlag(key: string, initial: boolean) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw === null ? initial : raw === '1'
    } catch {
      return initial
    }
  })
  const set = (next: boolean) => {
    setV(next)
    try {
      localStorage.setItem(key, next ? '1' : '0')
    } catch {
      // 저장 불가 환경은 무시
    }
  }
  return [v, set] as const
}

export default function Village() {
  const snap = useVillage()
  const [selected, setSelected] = useState<ChannelId | null>(null)
  const [target, setTarget] = useState<ChannelId>('h2')
  const [night, setNight] = useStoredFlag('gridwitness.village.night', false)
  const [fx, setFx] = useStoredFlag('gridwitness.village.fx2', false)
  const [underground, setUnderground] = useState(false)
  const [part, setPart] = useState<PartId | null>(null)
  const [showPins, setShowPins] = useState(false)
  const sel = selected ? snap.leds[selected] : null
  const selView = sel ? lightView(sel, snap) : null
  const mock = snap.source === 'MOCK'
  const residual = snap.i - snap.expected
  const pending = snap.relayPending !== null

  return (
    <>
      <PageHeader
        title="스마트 마을"
        description="5V 전원이 릴레이 하나를 거쳐 주택 3채와 가로등 2개에 함께 공급됩니다. INA219가 마을 전체 전압·전류를 측정합니다."
        actions={
          snap.relay ? (
            <button className="btn btn-danger" onClick={() => setRelay(false)} disabled={!snap.connected || pending}>
              {pending ? '차단 중…' : '정전 발생'}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => setRelay(true)} disabled={!snap.connected || pending}>
              {pending ? '복구 중…' : '전력 복구'}
            </button>
          )
        }
      />

      <Metrics>
        <Metric
          label="상태"
          value={<Status tone={NODE_TONE[snap.status]} live={snap.status === 'FAULT' || snap.status === 'OUTAGE' || snap.status === 'WARNING'}><span style={{ fontSize: 20, fontWeight: 600 }}>{STATUS_LABEL[snap.status]}</span></Status>}
          foot={`릴레이 ${snap.relay ? '닫힘' : '열림'} · 켜진 LED ${snap.estLit}/5${mock ? '' : ' (추정)'}`}
        />
        <Metric label="전압" value={snap.v.toFixed(2)} unit="V" foot="정격 5 V DC" />
        <Metric label="전류" value={snap.i.toFixed(3)} unit="A" foot={<span className={Math.abs(residual) > 0.04 ? 'bad' : ''}>예상 {snap.expected.toFixed(3)} A · 차이 {residual >= 0 ? '+' : ''}{residual.toFixed(3)}</span>}>
          <Sparkline values={snap.history.map((h) => h.i)} minSpan={0.06} />
        </Metric>
        <Metric label="전력" value={snap.p.toFixed(2)} unit="W" foot={`이상 점수 ${snap.score.toFixed(2)}`} />
      </Metrics>

      {snap.scenario && (
        <div className="alert alert-info" style={{ marginTop: 20, alignItems: 'center' }}>
          <span style={{ flex: 1 }}>
            <strong>부하 시나리오 재생 중 (시뮬레이터)</strong> — {snap.scenario.label}, {Math.max(0, snap.scenario.hour)}시. 공공데이터 시간대 패턴대로 켜진 LED 수를 바꿉니다.
          </span>
          <button className="btn btn-sm" onClick={stopScenario}>정지</button>
        </div>
      )}

      <div className="scene" style={{ marginTop: 24 }}>
        <div className="scene-canvas">
          <SceneBoundary>
            <VillageScene snap={snap} selected={selected} onSelect={setSelected} night={night} fx={fx} underground={underground} selectedPart={part} onPart={setPart} showPins={showPins} />
          </SceneBoundary>
        </div>
        <div className="scene-tools">
          <Segmented
            className="glass"
            value={underground ? 'under' : 'surface'}
            onChange={(v) => {
              setUnderground(v === 'under')
              setSelected(null)
              setPart(null)
            }}
            options={[
              { value: 'surface', label: '지상' },
              { value: 'under', label: '지하 배선' },
            ]}
          />
          <Segmented
            className="glass"
            value={night ? 'night' : 'day'}
            onChange={(v) => setNight(v === 'night')}
            options={[
              { value: 'day', label: <span className="row" style={{ gap: 5 }}><IconSun />낮</span> },
              { value: 'night', label: <span className="row" style={{ gap: 5 }}><IconMoon />밤</span> },
            ]}
          />
          <button className={`btn btn-sm glass ${fx ? 'on' : ''}`} onClick={() => setFx(!fx)} aria-pressed={fx} title="AO·블룸 후처리, 고해상도, 60fps (GPU 사용량 증가)">
            고화질 {fx ? '켜짐' : '꺼짐'}
          </button>
          {underground && (
            <>
              <button className={`btn btn-sm glass ${showPins ? 'on' : ''}`} onClick={() => setShowPins(!showPins)} aria-pressed={showPins}>
                핀 이름 {showPins ? '켜짐' : '꺼짐'}
              </button>
              {part && <button className="btn btn-sm glass" onClick={() => setPart(null)}>전체 보기</button>}
            </>
          )}
        </div>
        {underground ? (
          <div className="scene-legend glass">
            <strong>배선 색상</strong>
            {(Object.keys(NET_KIND_LABEL) as NetKind[]).map((k) => (
              <span key={k}><i style={{ background: NET_COLOR[k] }} />{NET_KIND_LABEL[k]}</span>
            ))}
            <span className="muted" style={{ marginLeft: 'auto' }}>부품 클릭: 상세 · 선 위에 마우스: 연결</span>
          </div>
        ) : (
          <div className="scene-hint glass">드래그 회전 · 휠 확대 · 객체 클릭</div>
        )}
        {underground && part && <PartPanel id={part} snap={snap} onClose={() => setPart(null)} />}
        {sel && selView && !underground && (
          <div className="scene-pop" role="dialog" aria-label={`${sel.name} 상세`}>
            <div className="scene-pop-head">
              <strong>{sel.name}</strong>
              <span className="tag">LED {sel.ch}</span>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelected(null)} aria-label="닫기"><IconX /></button>
            </div>
            <Status tone={NODE_TONE[selView.status]}>{selView.text}</Status>
            <dl className="kv" style={{ marginTop: 14 }}>
              <div><dt>위치</dt><dd>{sel.board}</dd></div>
              <div><dt>연결</dt><dd>저항 직렬 · 병렬</dd></div>
              <div><dt>마을 전류</dt><dd>{snap.i.toFixed(3)} A</dd></div>
              <div><dt>켜진 LED</dt><dd>{snap.estLit} / 5</dd></div>
            </dl>
            <p className="hint">INA219가 1개라 LED별 전류는 측정하지 않습니다. 전체 전류로 켜진 개수를 추정합니다.</p>
            <button className="btn btn-sm" style={{ marginTop: 12, width: '100%' }} onClick={() => setUnderground(true)}>지하 배선에서 보기</button>
          </div>
        )}
      </div>

      <Section title="부하" description="LED 5개가 병렬로 연결되어 릴레이 하나로 함께 켜지고 꺼집니다." actions={<Link to="/settings" className="small">회로 구성 →</Link>}>
        <Channels snap={snap} selected={selected} onSelect={setSelected} />
      </Section>

      <div className="split section">
        <Section title="이상 이벤트">
          <EventList events={snap.events} />
        </Section>
        <Section title="고장 시뮬레이션" description="계측값만으로 판정하는지 확인하는 Mock 전용 기능입니다." actions={!mock && <Badge>실측 모드에서는 사용 안 함</Badge>}>
          <div className="form">
            <label className="field">
              LED 위치 고장
              <select value={target} onChange={(e) => setTarget(e.target.value as ChannelId)} disabled={!mock}>
                {IOT_CHANNELS.map((c) => <option key={c.id} value={c.id}>LED {c.ch} · {c.name}</option>)}
              </select>
            </label>
            <div className="cluster">
              {(Object.keys(FAULT_LABEL) as FaultKind[]).filter((k) => FAULT_AT_LED[k]).map((k) => (
                <button key={k} className={`btn ${snap.faults[target] === k ? 'btn-danger on' : ''}`} aria-pressed={snap.faults[target] === k} onClick={() => injectFault(target, k)} disabled={!mock}>
                  {FAULT_LABEL[k]}
                </button>
              ))}
              <button className="btn btn-ghost" onClick={() => clearFault(target)} disabled={!mock || !snap.faults[target]}>이 LED 복구</button>
            </div>
            <div className="field">전원·제어·통신 고장</div>
            <div className="cluster" style={{ marginTop: -8 }}>
              {(Object.keys(FAULT_LABEL) as FaultKind[]).filter((k) => !FAULT_AT_LED[k]).map((k) => (
                <button key={k} className={`btn ${snap.supplyFault === k ? 'btn-danger on' : ''}`} aria-pressed={snap.supplyFault === k} onClick={() => injectFault(target, k)} disabled={!mock}>
                  {FAULT_LABEL[k]}
                </button>
              ))}
              <button className={`btn ${!snap.connected ? 'btn-danger on' : ''}`} aria-pressed={!snap.connected} onClick={() => setConnected(!snap.connected)} disabled={!mock}>
                통신 끊김
              </button>
              <button className="btn btn-ghost" onClick={() => { clearFault(); setConnected(true) }} disabled={!mock || (Object.keys(snap.faults).length === 0 && !snap.supplyFault && snap.connected)}>전체 복구</button>
            </div>
          </div>
        </Section>
      </div>
    </>
  )
}
