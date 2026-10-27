import { LOAD_LINES, NET_COLOR, NETS, PART_BY_ID, pinLabel, splitPin, type PartId, type PinRef } from '../lib/hardware'
import { contactClosed, type VillageSnapshot } from '../lib/village'
import { IconX } from './Icons'
import { Status, type Tone } from './ui'

/** 부품의 현재 동작 상태 한 줄 */
function liveOf(id: PartId, snap: VillageSnapshot): [Tone, string] {
  const supplyOk = snap.supplyFault !== 'OUTAGE' && snap.status !== 'NO_DATA'
  const powered = contactClosed(snap) && supplyOk
  const lit = LOAD_LINES.filter((l) => l.board === id && snap.leds[l.led].lit).map((l) => l.name)
  switch (id) {
    case 'adapter':
      if (!supplyOk) return ['err', '출력 없음']
      return [snap.relay || snap.supplyFault === 'STUCK' ? 'ok' : 'off', `5V 출력${snap.supplyFault === 'SAG' ? ' · 전압 강하' : ''}${contactClosed(snap) ? '' : ' · 릴레이가 열려 있어 전류는 흐르지 않음'}`]
    case 'relay':
      if (snap.supplyFault === 'STUCK' && !snap.relay) return ['err', 'IN = LOW인데 접점이 붙어 있음 (고착) · 전원이 차단되지 않음']
      return snap.relay ? ['ok', 'IN = HIGH · 접점 닫힘 (COM → NO 연결)'] : ['off', 'IN = LOW · 접점 열림 (마을 전체 차단)']
    case 'arduino':
      return snap.connected ? ['ok', `D2 ${snap.relay ? 'HIGH' : 'LOW'} · I2C로 0.5초마다 측정 · ${snap.source === 'MOCK' ? '시뮬레이터' : '실측'}`] : ['err', '연결 끊김']
    case 'ina219':
      return snap.status === 'NO_DATA' ? ['off', '데이터 없음'] : ['ok', `${snap.v.toFixed(2)} V · ${snap.i.toFixed(3)} A · ${snap.p.toFixed(2)} W`]
    case 'bb1':
      return powered ? ['ok', '+ / − 레일에 5V 분배 중'] : ['off', '전원 없음']
    default:
      return powered ? [lit.length ? 'ok' : 'warn', lit.length ? `켜짐: ${lit.join(', ')}` : '켜진 LED 없음'] : ['off', '전원 없음']
  }
}

/** 핀에 연결된 상대편 목록 */
function peers(ref: PinRef): { color: string; text: string }[] {
  const out = NETS.filter((n) => n.a === ref || n.b === ref).map((n) => ({ color: NET_COLOR[n.kind], text: `${pinLabel(n.a === ref ? n.b : n.a)} · ${n.signal}` }))
  const [part, pin] = splitPin(ref)
  for (const l of LOAD_LINES) {
    if (l.board !== part) continue
    if (pin === `${l.led}+`) out.push({ color: NET_COLOR.ledPlus, text: `${l.name} LED ${l.ledNo} (+) · 220Ω 건물 안` })
    if (pin === `${l.led}−`) out.push({ color: NET_COLOR.ledMinus, text: `${l.name} LED ${l.ledNo} (−)` })
  }
  return out
}

export default function PartPanel({ id, snap, onClose }: { id: PartId; snap: VillageSnapshot; onClose: () => void }) {
  const part = PART_BY_ID[id]
  const [tone, live] = liveOf(id, snap)
  return (
    <div className="part-panel" role="dialog" aria-label={`${part.name} 상세`}>
      <div className="row between">
        <h3>{part.name}</h3>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="닫기"><IconX /></button>
      </div>
      <p className="small muted" style={{ marginTop: 2 }}>{part.role} · {part.spec}</p>
      <div className="live"><Status tone={tone}>{live}</Status></div>
      <dl className="pin-rows">
        {Object.entries(part.pins).map(([pin, desc]) => {
          const ref = `${id}.${pin}` as PinRef
          const to = peers(ref)
          return (
            <div key={pin}>
              <dt>{pin}</dt>
              <dd>
                {desc}
                {to.length === 0 ? (
                  <span className="to">연결 없음</span>
                ) : (
                  to.map((p, k) => (
                    <span key={k} className="to"><span className="wire-chip" style={{ background: p.color }} />{p.text}</span>
                  ))
                )}
              </dd>
            </div>
          )
        })}
      </dl>
    </div>
  )
}
