import { FAULT_LABEL, IOT_CHANNELS, type ChannelId, type VillageSnapshot } from '../lib/village'
import { IconHouse, IconLamp } from './Icons'
import { Status, type Tone } from './ui'

/**
 * 마을 부하(LED 5개) 목록. 개별 전류는 측정하지 않으므로 켜짐 여부만 보여줌.
 * 시뮬레이터는 시뮬레이터가 아는 실제 상태, 실측은 전체 전류로 추정한 켜진 개수.
 */
export default function Channels({ snap, selected, onSelect }: { snap: VillageSnapshot; selected?: ChannelId | null; onSelect?: (id: ChannelId) => void }) {
  const measured = snap.source === 'SERIAL'
  return (
    <div className="channels" role="list">
      {IOT_CHANNELS.map((def) => {
        const led = snap.leds[def.id]
        const [label, tone]: [string, Tone] =
          snap.status === 'NO_DATA'
            ? ['데이터 없음', 'off']
            : led.fault
              ? [FAULT_LABEL[led.fault], led.fault === 'OPEN' ? 'warn' : 'err']
              : led.lit
                ? [measured ? '켜짐 (추정)' : '켜짐', 'ok']
                : [!snap.relay ? '차단됨' : measured ? '꺼짐 (추정)' : '꺼짐', 'off']
        return (
          <div
            key={def.id}
            role="listitem"
            tabIndex={onSelect ? 0 : undefined}
            className={`channel load ${selected === def.id ? 'sel' : ''}`}
            onClick={() => onSelect?.(def.id)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect?.(def.id)}
          >
            <div className="channel-name">
              <span className={`channel-glyph ${led.lit ? 'lit' : ''}`}>{def.kind === 'HOUSE' ? <IconHouse /> : <IconLamp />}</span>
              <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                <strong>{def.name}</strong>
                <span className="xs muted">LED {def.ch}</span>
              </span>
            </div>
            <span className="small muted">{def.board}</span>
            <span className="small muted">저항 직렬 · 병렬 연결</span>
            <Status tone={tone}>{label}</Status>
          </div>
        )
      })}
    </div>
  )
}
