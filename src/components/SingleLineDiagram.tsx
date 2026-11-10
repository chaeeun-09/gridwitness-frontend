import type { FiKind, FrtuId } from '../lib/frtu'
import type { Branch, InspectionCandidate } from '../lib/gis'

/** 점검 후보 구간과 순서 (설비 연결정보로 추적한 결과) */
export function InspectionCard({ candidate }: { candidate: InspectionCandidate | null }) {
  if (!candidate) return null
  return (
    <div className="insp">
      <div className="insp-head">
        <span>점검 후보 구간 <small>계통 추적</small></span>
        <strong>{candidate.section}</strong>
        <em>{candidate.boundary} · 영향 고객 {candidate.customers}호</em>
      </div>
      <ol className="insp-steps">
        {candidate.steps.map((s, k) => (
          <li key={s.id}>
            <b>{k + 1}</b>
            <div><span>{s.label}</span><small>{s.detail}</small></div>
          </li>
        ))}
      </ol>
      <p className="xs muted">설비 정보: {candidate.source}. 실제 위치·출동은 GIS(K-GIS) 계통 추적과 담당자 판단으로 확정해요.</p>
    </div>
  )
}

/** 마을 계통 단선도: 변전소 → P-01(인입 FRTU) → P-02 분기점 → 주택 분기 / 가로등 분기.
 *  고장 후보 갈래는 빨갛게, 고장표시가 뜬 FRTU는 빨간 네모로. 설비 배치는 lib/gis 목업과 같다 */
export default function SingleLineDiagram({ highlight = [], fi = {}, candidate }: { highlight?: Branch[]; fi?: Partial<Record<FrtuId, FiKind>>; candidate?: InspectionCandidate | null }) {
  const hot = (b: Branch) => (highlight.includes(b) ? 'sld-line hot' : 'sld-line')
  const frtu = (id: FrtuId) => (!fi[id] ? 'sld-frtu' : fi[id] === 'NONE' ? 'sld-frtu ok' : 'sld-frtu hit')
  const first = candidate?.steps[0]?.id
  return (
    <figure className="sld">
      <svg viewBox="0 0 560 190" role="img" aria-label="마을 계통 단선도">
        {/* 분기점 앞 */}
        <path className={hot('IN')} d="M86 95 H290" />
        {/* 주택 분기 */}
        <path className={hot('H')} d="M290 95 V45 H540" />
        {/* 가로등 분기 */}
        <path className={hot('L')} d="M290 95 V150 H500" />

        <rect className="sld-sub" x="14" y="78" width="72" height="34" rx="8" />
        <text className="sld-t strong" x="50" y="99" textAnchor="middle">변전소</text>

        <circle className="sld-pole" cx="170" cy="95" r="5" />
        <text className="sld-t" x="170" y="120" textAnchor="middle">P-01</text>
        <rect className={frtu('inlet')} x="158" y="62" width="24" height="18" rx="4" />
        <text className="sld-t xs" x="170" y="56" textAnchor="middle">인입 FRTU</text>

        <circle className={`sld-pole ${first?.startsWith('P-02') ? 'first' : ''}`} cx="290" cy="95" r="7" />
        <text className="sld-t" x="304" y="99">P-02 분기점</text>

        <rect className={frtu('house')} x="318" y="36" width="24" height="18" rx="4" />
        <text className="sld-t xs" x="330" y="28" textAnchor="middle">FRTU-주택</text>
        <rect className={frtu('lamp')} x="318" y="141" width="24" height="18" rx="4" />
        <text className="sld-t xs" x="330" y="176" textAnchor="middle">FRTU-가로등</text>

        {[
          ['주택 1', 390, 45, 'L-H1'],
          ['주택 3', 445, 45, 'L-H3'],
          ['주택 2', 520, 45, 'L-H2'],
        ].map(([n, x, y, id]) => (
          <g key={id as string}>
            <rect className={`sld-load ${first === id ? 'first' : ''}`} x={(x as number) - 9} y={(y as number) - 9} width="18" height="18" rx="3" />
            <text className="sld-t xs" x={x as number} y={(y as number) + 24} textAnchor="middle">{n}</text>
          </g>
        ))}
        <text className="sld-t xs muted" x="482" y="36" textAnchor="middle">P-03·P-05</text>
        {[
          ['가로등 1', 400, 150, 'L-L1'],
          ['가로등 2', 490, 150, 'L-L2'],
        ].map(([n, x, y, id]) => (
          <g key={id as string}>
            <circle className={`sld-load ${first === id ? 'first' : ''}`} cx={x as number} cy={y as number} r="8" />
            <text className="sld-t xs" x={x as number} y={(y as number) + 24} textAnchor="middle">{n}</text>
          </g>
        ))}
        <text className="sld-t xs muted" x="445" y="141" textAnchor="middle">P-03</text>
      </svg>
      {candidate && <figcaption className="xs muted">설비 정보: {candidate.source}</figcaption>}
    </figure>
  )
}
