import { LOAD_LINES, NET_COLOR, NET_KIND_LABEL, NETS, PART_BY_ID, PARTS, pinLabel, type NetKind } from '../lib/hardware'

/** 부품 목록 + 핀 단위 배선표 + 배선 색상 규칙 (도면 기준) */
export default function ChannelMap() {
  return (
    <div className="stack" style={{ gap: 28 }}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>부품</th><th>역할</th><th>사양</th></tr>
          </thead>
          <tbody>
            {PARTS.map((p) => (
              <tr key={p.id}>
                <td className="strong" style={{ whiteSpace: 'nowrap' }}>{p.name}</td>
                <td className="muted">{p.role}</td>
                <td className="small">{p.spec}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>선</th><th>시작</th><th>끝</th><th>신호</th></tr>
          </thead>
          <tbody>
            {NETS.map((n) => (
              <tr key={n.id}>
                <td><span className="wire-chip" style={{ background: NET_COLOR[n.kind] }} /></td>
                <td className="small">{pinLabel(n.a)}</td>
                <td className="small">{pinLabel(n.b)}</td>
                <td className="small muted">{n.signal}</td>
              </tr>
            ))}
            {LOAD_LINES.flatMap((l) => [
              <tr key={`${l.led}+`}>
                <td><span className="wire-chip" style={{ background: NET_COLOR.ledPlus }} /></td>
                <td className="small">{PART_BY_ID[l.board].name} NO</td>
                <td className="small">{l.name} LED {l.ledNo} (+) · 220Ω 건물 안</td>
                <td className="small muted">LED 전원</td>
              </tr>,
              <tr key={`${l.led}−`}>
                <td><span className="wire-chip" style={{ background: NET_COLOR.ledMinus }} /></td>
                <td className="small">{l.name} LED {l.ledNo} (−)</td>
                <td className="small">공통 GND (Arduino GND)</td>
                <td className="small muted">LED 귀선</td>
              </tr>,
            ])}
          </tbody>
        </table>
      </div>

      <div className="cluster" style={{ gap: '8px 20px' }}>
        {(Object.keys(NET_KIND_LABEL) as NetKind[]).map((k) => (
          <span key={k} className="small muted row" style={{ gap: 8 }}>
            <span className="wire-chip" style={{ background: NET_COLOR[k] }} />
            {NET_KIND_LABEL[k]}
          </span>
        ))}
      </div>
    </div>
  )
}
