import type { ChannelId } from '../../lib/village'
import { mastTop, type HouseStyle } from './houseGeometry'

// 마을 배치 (단위: m 비슷한 월드 단위). 지면 y = 0.

export type V3 = [number, number, number]

export const GROUND_W = 48
export const GROUND_D = 36

export const ROAD_A_Z = 2 // 동서 도로 중심
export const ROAD_B_X = 2 // 남북 도로 중심 (북쪽으로만)
export const ROAD_W = 2.6
export const SW = 0.7 // 인도 폭

export const B_WEST = ROAD_B_X - ROAD_W / 2
export const B_EAST = ROAD_B_X + ROAD_W / 2
export const A_NORTH = ROAD_A_Z - ROAD_W / 2
export const A_SOUTH = ROAD_A_Z + ROAD_W / 2
export const ROAD_B_END = -GROUND_D / 2

/** [x, z, 폭, 깊이] */
export const SIDEWALKS: [number, number, number, number][] = [
  [(-GROUND_W / 2 + B_WEST - SW) / 2, A_NORTH - SW / 2, B_WEST - SW + GROUND_W / 2, SW],
  [(GROUND_W / 2 + B_EAST + SW) / 2, A_NORTH - SW / 2, GROUND_W / 2 - B_EAST - SW, SW],
  [0, A_SOUTH + SW / 2, GROUND_W, SW],
  [B_WEST - SW / 2, (ROAD_B_END + A_NORTH) / 2, SW, A_NORTH - ROAD_B_END],
  [B_EAST + SW / 2, (ROAD_B_END + A_NORTH) / 2, SW, A_NORTH - ROAD_B_END],
]

/** 마을 전원(SS-01) 위치: 3D 모델은 없고 GIS 단선도의 출발점으로만 쓴다 */
export const SUBSTATION: V3 = [-12.5, 0, 8]
export const POLE_H = 4.2
export const POLES: V3[] = [[-8.5, 0, A_NORTH - 0.35], [-3, 0, A_NORTH - 0.35], [3.8, 0, A_NORTH - 0.35], [9, 0, A_NORTH - 0.35], [B_EAST + 0.35, 0, -5.5]]

export type HouseChannel = 'h1' | 'h2' | 'h3'
export type LampChannel = 'l1' | 'l2'

/** 실제 회로 채널 CH4·CH5 가로등 */
export const LAMP_POS: Record<LampChannel, { pos: V3; rot: number }> = {
  l1: { pos: [-6, 0, A_SOUTH + 0.35], rot: Math.PI },
  l2: { pos: [5.5, 0, A_SOUTH + 0.35], rot: Math.PI },
}

/** 실제 회로 채널 CH1~CH3 주택 */
export const HOUSE_POS: Record<HouseChannel, { pos: V3; rot: number; style: HouseStyle }> = {
  h1: { pos: [-4.5, 0, -3.4], rot: 0, style: 'cottage' },
  h2: { pos: [7.8, 0, -6.5], rot: -Math.PI / 2, style: 'twoStory' },
  h3: { pos: [-3, 0, 7.4], rot: Math.PI, style: 'wide' },
}

// 첫 전봇대 → 전봇대 → 채널 경로 (전봇대 인덱스)
export const ROUTE: Record<ChannelId, number[]> = { h1: [0, 1], h2: [0, 1, 2, 4], h3: [0, 1], l1: [0, 1], l2: [0, 1, 2] }

const poleTop = (p: V3): V3 => [p[0], POLE_H - 0.1, p[2]]

/** 채널 인입점: 주택은 지붕 지지대 꼭대기, 가로등은 등기구 위 (월드 좌표) */
function channelAttach(id: ChannelId): V3 {
  if (id === 'l1' || id === 'l2') {
    const { pos } = LAMP_POS[id]
    return [pos[0], 2.85, pos[2]]
  }
  const { pos, rot, style } = HOUSE_POS[id]
  const [mx, my, mz] = mastTop(style)
  return [pos[0] + mx * Math.cos(rot) + mz * Math.sin(rot), my, pos[2] - mx * Math.sin(rot) + mz * Math.cos(rot)]
}

/** 두 점 사이 처진 전선 */
function sag(a: V3, b: V3, depth = 0.35, n = 14): V3[] {
  return Array.from({ length: n + 1 }, (_, k) => {
    const s = k / n
    return [a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s - Math.sin(Math.PI * s) * depth, a[2] + (b[2] - a[2]) * s]
  })
}

export function routePoints(id: ChannelId): V3[] {
  const stops: V3[] = [...ROUTE[id].map((i) => poleTop(POLES[i])), channelAttach(id)]
  const pts: V3[] = []
  for (let k = 0; k < stops.length - 1; k++) pts.push(...sag(stops[k], stops[k + 1]).slice(k === 0 ? 0 : 1))
  return pts
}

export function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

// ── 바닥판 내부 (지하 배선 상자) ─────────────────────────
/** 지면 판 아래면 = 상자 천장 */
export const DECK_BOTTOM = -0.65
/** 상자 바닥 윗면 */
export const BOX_FLOOR = -3.4
/** 부품이 놓이는 줄 (앞쪽) */
export const PART_Z = 4
