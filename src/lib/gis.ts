// 설비 연결정보(GIS) 어댑터.
// 실제 사업화에서는 한전KDN K-GIS 같은 전력 GIS의 계통 추적 결과를 받아 "고장 구간 → 실제 설비·점검 순서"로 바꾼다.
// K-GIS는 국제 표준(OGC WFS)으로 설비를 GeoJSON으로 내주므로, 여기서는 같은 모양(FeatureCollection)을 받는 통로를 만든다.
//
// 지금은 K-GIS에 접속할 수 없으므로 마을 모형의 실제 배선(변전소 → 전봇대 → 분기 → 주택·가로등)을
// 같은 GeoJSON 모양의 목업으로 넣는다. 화면에는 항상 "K-GIS 연계 예정 · 현재 모형 목업"이라고 출처를 밝힌다.
//
// 좌표는 위경도가 아니라 3D 마을 좌표(x, z)다.

import { HOUSE_POS, LAMP_POS, POLES, SUBSTATION } from '../components/village/layout'
import type { FaultScope, FrtuId } from './frtu'

export type GisKind = 'SUBSTATION' | 'POLE' | 'FRTU' | 'LOAD' | 'SPAN'
/** 계통 갈래: IN = 분기점 앞(인입), H = 주택 분기, L = 가로등 분기 */
export type Branch = 'IN' | 'H' | 'L'

export interface GisFeature {
  type: 'Feature'
  id: string
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'LineString'; coordinates: [number, number][] }
  properties: {
    kind: GisKind
    name: string
    branch: Branch
    /** SPAN(경간): 위쪽·아래쪽 설비 id */
    from?: string
    to?: string
    /** FRTU: 달린 전봇대와 마을 FRTU id */
    pole?: string
    frtu?: FrtuId
    /** LOAD: 고객 수 */
    customers?: number
  }
}

export interface GisFeatureCollection {
  type: 'FeatureCollection'
  features: GisFeature[]
}

/** 설비 정보를 주는 곳. 지금은 모형 목업, 나중에 K-GIS(WFS)로 바꿔 끼움 */
export interface EquipmentProvider {
  id: string
  label: string
  standard: string
  load(): Promise<GisFeatureCollection>
}

// ── 마을 모형 목업 (layout.ts의 실제 배치·배선 그대로) ─────────────────
const xz = (p: readonly number[]): [number, number] => [+p[0].toFixed(2), +p[2].toFixed(2)]
const node = (id: string, kind: GisKind, name: string, branch: Branch, at: readonly number[], extra: Partial<GisFeature['properties']> = {}): GisFeature => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: xz(at) },
  properties: { kind, name, branch, ...extra },
})

const AT: Record<string, readonly number[]> = {
  'SS-01': SUBSTATION,
  'P-01': POLES[0],
  'P-02': POLES[1],
  'P-03': POLES[2],
  'P-05': POLES[4],
  'L-H1': HOUSE_POS.h1.pos,
  'L-H2': HOUSE_POS.h2.pos,
  'L-H3': HOUSE_POS.h3.pos,
  'L-L1': LAMP_POS.l1.pos,
  'L-L2': LAMP_POS.l2.pos,
}
const span = (from: string, to: string, branch: Branch): GisFeature => ({
  type: 'Feature',
  id: `${from}~${to}${branch === 'IN' ? '' : `:${branch}`}`,
  geometry: { type: 'LineString', coordinates: [xz(AT[from]), xz(AT[to])] },
  properties: { kind: 'SPAN', name: `${from} → ${to}`, branch, from, to },
})

export const VILLAGE_FEATURES: GisFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    node('SS-01', 'SUBSTATION', '마을 변전소 (5V 전원·전체 릴레이)', 'IN', AT['SS-01']),
    node('P-01', 'POLE', '전주 P-01', 'IN', AT['P-01']),
    node('P-02', 'POLE', '전주 P-02 (분기점)', 'IN', AT['P-02']),
    node('P-03', 'POLE', '전주 P-03', 'H', AT['P-03']),
    node('P-05', 'POLE', '전주 P-05', 'H', AT['P-05']),
    node('FRTU-IN', 'FRTU', '인입 FRTU', 'IN', AT['P-01'], { pole: 'P-01', frtu: 'inlet' }),
    node('FRTU-H', 'FRTU', 'FRTU-주택 분기', 'H', AT['P-02'], { pole: 'P-02', frtu: 'house' }),
    node('FRTU-L', 'FRTU', 'FRTU-가로등 분기', 'L', AT['P-02'], { pole: 'P-02', frtu: 'lamp' }),
    node('L-H1', 'LOAD', '주택 1', 'H', AT['L-H1'], { customers: 1 }),
    node('L-H2', 'LOAD', '주택 2', 'H', AT['L-H2'], { customers: 1 }),
    node('L-H3', 'LOAD', '주택 3', 'H', AT['L-H3'], { customers: 1 }),
    node('L-L1', 'LOAD', '가로등 1', 'L', AT['L-L1'], { customers: 0 }),
    node('L-L2', 'LOAD', '가로등 2', 'L', AT['L-L2'], { customers: 0 }),
    span('SS-01', 'P-01', 'IN'),
    span('P-01', 'P-02', 'IN'),
    span('P-02', 'L-H1', 'H'),
    span('P-02', 'L-H3', 'H'),
    span('P-02', 'P-03', 'H'),
    span('P-03', 'P-05', 'H'),
    span('P-05', 'L-H2', 'H'),
    span('P-02', 'L-L1', 'L'),
    span('P-02', 'P-03', 'L'),
    span('P-03', 'L-L2', 'L'),
  ],
}

export const villageMockProvider: EquipmentProvider = {
  id: 'village-mock',
  label: 'K-GIS 연계 예정 · 현재 모형 목업',
  standard: 'OGC WFS 2.0 GetFeature (GeoJSON)',
  load: async () => VILLAGE_FEATURES,
}

/** 실제 WFS 서버(K-GIS 등)에서 설비를 받아오는 통로. 공모전 단계에서는 쓰지 않음 (접속 권한 없음) */
export function wfsProvider(baseUrl: string, typeNames: string, label = 'K-GIS (WFS)'): EquipmentProvider {
  return {
    id: `wfs:${baseUrl}`,
    label,
    standard: 'OGC WFS 2.0 GetFeature (GeoJSON)',
    async load() {
      const q = new URLSearchParams({ service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames, outputFormat: 'application/json' })
      const res = await fetch(`${baseUrl}?${q}`)
      if (!res.ok) throw new Error(`설비 정보 서버 오류 (${res.status})`)
      return (await res.json()) as GisFeatureCollection
    },
  }
}

// ── 계통 추적 ─────────────────────────────────────────────
export interface Topology {
  byId: Map<string, GisFeature>
  /** 갈래별 아래쪽 연결: from → [to...] */
  down: Map<string, { to: string; branch: Branch }[]>
  frtuPole: Record<FrtuId, string>
}

export function buildTopology(fc: GisFeatureCollection): Topology {
  const byId = new Map(fc.features.map((f) => [f.id, f]))
  const down = new Map<string, { to: string; branch: Branch }[]>()
  const frtuPole = { inlet: 'P-01', house: 'P-02', lamp: 'P-02' } as Record<FrtuId, string>
  for (const f of fc.features) {
    const p = f.properties
    if (p.kind === 'SPAN' && p.from && p.to) down.set(p.from, [...(down.get(p.from) ?? []), { to: p.to, branch: p.branch }])
    if (p.kind === 'FRTU' && p.frtu && p.pole) frtuPole[p.frtu] = p.pole
  }
  return { byId, down, frtuPole }
}

export const VILLAGE_TOPOLOGY = buildTopology(VILLAGE_FEATURES)

/** start에서 아래로, 같은 갈래만 따라가며 만나는 설비 (가까운 순 = 점검 순서) */
export function trace(topo: Topology, start: string, branch: Branch): GisFeature[] {
  const out: GisFeature[] = []
  const seen = new Set<string>([start])
  let level = [start]
  while (level.length) {
    const next: string[] = []
    for (const id of level)
      for (const e of topo.down.get(id) ?? [])
        if (e.branch === branch && !seen.has(e.to)) {
          seen.add(e.to)
          next.push(e.to)
          const f = topo.byId.get(e.to)
          if (f) out.push(f)
        }
    level = next
  }
  return out
}

export interface InspectionStep {
  id: string
  label: string
  detail: string
}

export interface InspectionCandidate {
  scope: FaultScope
  /** 고장 구간 한 줄 */
  section: string
  /** 구간 경계 (어느 FRTU 아래인지) */
  boundary: string
  /** 점검 순서 (위쪽 → 아래쪽) */
  steps: InspectionStep[]
  customers: number
  /** 강조할 갈래 (단선도용) */
  branches: Branch[]
  source: string
}

function branchSteps(topo: Topology, branch: 'H' | 'L'): InspectionStep[] {
  const frtuId = branch === 'H' ? 'house' : 'lamp'
  const pole = topo.frtuPole[frtuId]
  const head: InspectionStep = { id: `${pole}:${branch}`, label: `${pole} ${branch === 'H' ? '주택' : '가로등'} 분기 접속부`, detail: `FRTU-${branch === 'H' ? '주택' : '가로등'} 분기 바로 아래 · 분기 개폐기·접속 상태` }
  return [
    head,
    ...trace(topo, pole, branch).map((f) => ({
      id: f.id,
      label: f.properties.kind === 'LOAD' ? `${f.properties.name} 인입선` : `${f.properties.name} 경간`,
      detail: f.properties.kind === 'LOAD' ? `${f.id} · 인입선·LED 접속` : `${f.id} · 전선·접속부`,
    })),
  ]
}

/** 고장 구간(FRTU 고장표시 판정) → 설비 연결정보로 점검 후보와 순서 */
export function inspectionCandidate(scope: FaultScope, topo: Topology = VILLAGE_TOPOLOGY, source = villageMockProvider.label): InspectionCandidate | null {
  const count = (branch: Branch) => trace(topo, 'P-02', branch).reduce((n, f) => n + (f.properties.customers ?? 0), 0)
  switch (scope) {
    case 'HOUSE':
      return { scope, section: '주택 분기 (P-02 아래 → 주택 1·2·3)', boundary: 'FRTU-주택 분기(P-02) 아래', steps: branchSteps(topo, 'H'), customers: count('H'), branches: ['H'], source }
    case 'LAMP':
      return { scope, section: '가로등 분기 (P-02 아래 → 가로등 1·2)', boundary: 'FRTU-가로등 분기(P-02) 아래', steps: branchSteps(topo, 'L'), customers: count('L'), branches: ['L'], source }
    case 'BOTH':
      return { scope, section: '두 분기 모두 (P-02 아래 전체)', boundary: 'FRTU-주택·가로등 분기(P-02) 아래', steps: [...branchSteps(topo, 'H'), ...branchSteps(topo, 'L')], customers: count('H') + count('L'), branches: ['H', 'L'], source }
    case 'UPSTREAM':
      return {
        scope,
        section: '분기점 앞 (변전소 → P-01 → P-02)',
        boundary: '인입 FRTU(P-01) 위쪽 포함',
        steps: [
          { id: 'SS-01', label: '마을 변전소 전원', detail: 'SS-01 · 5V 어댑터·전체 릴레이' },
          { id: 'SS-01~P-01', label: 'SS-01 → P-01 경간', detail: '인입선·접속부' },
          { id: 'P-01~P-02', label: 'P-01 → P-02 경간', detail: '인입 FRTU 아래 · 분기점까지' },
        ],
        customers: count('H') + count('L'),
        branches: ['IN'],
        source,
      }
    default:
      return null
  }
}
