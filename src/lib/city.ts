import { useSyncExternalStore } from 'react'
import { EXAMPLE_DATASET, getProfile, type Contract, type DayType } from './publicData'

// 도시 전력 시뮬레이션 (교육용 단순 모형).
//   발전소 → 변전소 5곳 → 배전선로(feeder) → 블록 → 건물
// 건물 수요 = 건물 기준 용량 × 시간대 패턴(공공데이터 예시 프로파일) × 기상 배율.
// 선로·변전소 용량을 넘으면 트립하고, 자동 절체를 켜면 이웃 선로가 남는 용량만큼 부하를 넘겨받는다.
// 전력 조류 계산(전압·위상)은 하지 않는다. 마을 모형(IoT)·고장파형 AI와는 별개 데이터다.

export const GRID = 40
export const PITCH = 3
export const BLOCK = 2.3
export const SPAN = GRID * PITCH

export type Zone = 0 | 1 | 2 | 3
export const ZONE_LABEL = ['주거', '상업', '산업', '공원'] as const
const ZONE_CONTRACT: Contract[] = ['RESIDENTIAL', 'GENERAL', 'INDUSTRIAL']

export const SAFE_TRANSFER = 1.05
export const RISKY_TRANSFER = 1.25
const TRIP_RATIO = 1.1
const TRIP_AFTER_MIN = 15
const FEEDER_HEADROOM = 1.1
const SUB_DIVERSITY = 0.92

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── 도시 생성 (한 번만, 항상 같은 모양) ─────────────────────
export interface SubDef {
  id: number
  name: string
  pos: [number, number]
  feeders: number[]
  capKw: number
}
export interface FeederDef {
  id: number
  sub: number
  name: string
  blocks: number[]
  centroid: [number, number]
  far: [number, number]
  capKw: number
}
export interface City {
  nBlocks: number
  bx: Float32Array
  bz: Float32Array
  zone: Uint8Array
  /** 블록 안 건물의 기준 용량 합 (kW) */
  baseKw: Float32Array
  blockFeeder: Int16Array
  /** 블록마다 절체 후보 선로 3개 (가까운 순) */
  alts: Int16Array
  nBuild: number
  /** 건물: 중심 x, z, 폭, 깊이, 높이 */
  bx0: Float32Array
  bz0: Float32Array
  bw: Float32Array
  bd: Float32Array
  bh: Float32Array
  bBlock: Uint16Array
  /** 건물마다 0~1 고정 난수 (밤에 불이 켜진 정도 등) */
  bRand: Float32Array
  /** 건물 모양(0 상자 · 1 계단식 · 2 설비 얹은 고층 · 3 뾰족 지붕 주택 · 4 공장 · 5 쌍둥이) */
  bType: Uint8Array
  /** 건물 색 번호 (구역별 팔레트 안에서) */
  bPal: Uint8Array
  /** 산업단지 안의 빈 블록은 공원 대신 저장탱크 단지 */
  tank: Uint8Array
  subs: SubDef[]
  feeders: FeederDef[]
  plant: [number, number]
}

const SUB_SITES: { name: string; pos: [number, number] }[] = [
  { name: '중앙', pos: [0, 0] },
  { name: '북서', pos: [-32, -32] },
  { name: '북동', pos: [32, -32] },
  { name: '남서', pos: [-32, 32] },
  { name: '남동(산업)', pos: [34, 30] },
]

/** 격자 위에서 부드럽게 변하는 값 (-1~1). 구역 경계가 반듯한 도형이 되지 않게 함 */
function wobble(i: number, j: number): number {
  return Math.sin(i * 0.31 + 1.3) * Math.sin(j * 0.27 + 0.7) * 0.55 + Math.sin(i * 0.12 + j * 0.17 + 2) * 0.45
}

function industrialRegion(bx: number, bz: number): boolean {
  const cx = (bx + 0.5) / GRID - 0.5
  const cz = (bz + 0.5) / GRID - 0.5
  return cx > 0.16 + 0.05 * wobble(bx, bz) && cz > 0.1 + 0.05 * wobble(bz, bx)
}

function zoneOf(bx: number, bz: number, rnd: () => number): Zone {
  const cx = (bx + 0.5) / GRID - 0.5
  const cz = (bz + 0.5) / GRID - 0.5
  const w = wobble(bx, bz)
  const dc = Math.hypot(cx, cz) / 0.707 + 0.07 * w
  if (Math.abs(cx - 0.02) < 0.05 && Math.abs(cz + 0.01) < 0.045) return 3 // 중앙 공원
  if (industrialRegion(bx, bz)) return rnd() < 0.07 ? 3 : 2 // 남동 산업단지
  if (dc < 0.34) return 1
  if (dc < 0.58 && w > 0.25 && rnd() < 0.7) return 1 // 외곽 상업 거점
  return rnd() < 0.05 ? 3 : 0
}

function generate(): City {
  const rnd = mulberry32(20261102)
  const nBlocks = GRID * GRID
  const bx = new Float32Array(nBlocks)
  const bz = new Float32Array(nBlocks)
  const zone = new Uint8Array(nBlocks)
  const bld: { x: number; z: number; w: number; d: number; h: number; block: number; kw: number; r: number; type: number; pal: number }[] = []
  const baseKw = new Float32Array(nBlocks)
  const tank = new Uint8Array(nBlocks)

  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const k = j * GRID + i
      bx[k] = (i - GRID / 2 + 0.5) * PITCH
      bz[k] = (j - GRID / 2 + 0.5) * PITCH
      const z = zoneOf(i, j, rnd)
      zone[k] = z
      if (z === 3) {
        if (industrialRegion(i, j)) tank[k] = 1
        continue
      }
      const dc = Math.hypot(bx[k], bz[k]) / (SPAN / 2)
      // 색은 동네(4×4블록) 단위로 어울리게, 가끔만 다른 색. 건물마다 제각각이면 어지러움
      const cluster = Math.floor((((Math.sin(Math.floor(i / 4) * 12.9898 + Math.floor(j / 4) * 78.233) * 43758.5453) % 1) + 1) % 1 * 6)
      const palOf = () => (rnd() < 0.8 ? cluster : Math.floor(rnd() * 6))
      const put = (x: number, zz: number, w: number, d: number, h: number, type: number) => {
        bld.push({ x, z: zz, w, d, h, block: k, kw: 0, r: rnd(), type, pal: palOf() })
      }
      const cx = bx[k]
      const cz = bz[k]
      if (z === 1) {
        // 도심은 2×2로 촘촘한 고층, 바깥은 블록당 크고 낮은 건물 하나. 건물이 적고 큼직해야 미니어처처럼 보임
        const core = Math.pow(Math.max(0, 1 - dc * 2.6), 1.5)
        const tall = (r: number) => 1.4 + core * 11 * (0.25 + r * rnd() * 1.6) + rnd() * 1.6
        const pickType = (h: number) => {
          const r = rnd()
          return h > 5 ? (r < 0.5 ? 1 : 2) : r < 0.4 ? 0 : r < 0.7 ? 2 : r < 0.85 ? 1 : 5
        }
        if (dc < 0.24) {
          const lot = BLOCK / 2
          for (let a = 0; a < 2; a++) {
            for (let b = 0; b < 2; b++) {
              if (rnd() < 0.3) continue
              const h = tall(rnd())
              put(cx - BLOCK / 2 + lot * (a + 0.5), cz - BLOCK / 2 + lot * (b + 0.5), lot * 0.84, lot * 0.84, h, pickType(h))
            }
          }
        } else {
          const h = 1.2 + core * 8 * rnd() + rnd() * 1.8
          put(cx, cz, BLOCK * 0.72, BLOCK * 0.72, h, pickType(h))
        }
      } else if (z === 2) {
        // 큰 공장 하나, 가끔 둘
        if (rnd() < 0.7) put(cx, cz, BLOCK * 0.82, BLOCK * 0.82, 0.9 + rnd() * 0.9, rnd() < 0.8 ? 4 : 0)
        else {
          const s2 = BLOCK * 0.4
          put(cx - 0.58, cz, s2, BLOCK * 0.78, 0.9 + rnd() * 0.7, 4)
          put(cx + 0.58, cz, s2, BLOCK * 0.78, 0.9 + rnd() * 0.7, 4)
        }
      } else {
        // 주거: 블록당 집 한 채(약 60%), 두 채(약 25%), 아파트(약 8%), 빈 땅
        const r = rnd()
        if (r < 0.08) put(cx, cz, BLOCK * 0.76, BLOCK * 0.76, 1.8 + rnd() * 1.8, rnd() < 0.6 ? 0 : 2)
        else if (r < 0.68) put(cx + (rnd() - 0.5) * 0.3, cz + (rnd() - 0.5) * 0.3, BLOCK * 0.6, BLOCK * 0.6, 0.55 + rnd() * 0.7, rnd() < 0.85 ? 3 : 5)
        else if (r < 0.92) {
          put(cx - 0.55, cz, BLOCK * 0.38, BLOCK * 0.6, 0.5 + rnd() * 0.6, 3)
          put(cx + 0.55, cz, BLOCK * 0.38, BLOCK * 0.6, 0.5 + rnd() * 0.6, 3)
        }
      }
    }
  }

  // 구역별 총 부하는 일정하게 맞춘다 (건물 수를 바꿔도 시나리오 결과가 같도록): 크기에 비례해 배분
  const ZONE_TOTAL_KW = [83800, 52400, 130400]
  const zoneSum = [0, 0, 0]
  const weight = (b: (typeof bld)[number]) => b.w * b.d * (b.type === 4 ? 1 : 0.5 + b.h)
  for (const b of bld) zoneSum[zone[b.block]] += weight(b)
  for (const b of bld) {
    const zn = zone[b.block]
    b.kw = (weight(b) / zoneSum[zn]) * ZONE_TOTAL_KW[zn]
    baseKw[b.block] += b.kw
  }

  // 변전소 → 구역(보로노이) → 사분면별 선로
  const subs: SubDef[] = SUB_SITES.map((s, id) => ({ id, name: s.name, pos: s.pos, feeders: [], capKw: 0 }))
  const feeders: FeederDef[] = []
  const blockFeeder = new Int16Array(nBlocks).fill(-1)
  const groups = new Map<string, number[]>()
  for (let k = 0; k < nBlocks; k++) {
    if (zone[k] === 3) continue
    let best = 0
    let bd = Infinity
    subs.forEach((s, i) => {
      const dd = Math.hypot(bx[k] - s.pos[0], bz[k] - s.pos[1])
      if (dd < bd) {
        bd = dd
        best = i
      }
    })
    const ang = Math.atan2(bz[k] - subs[best].pos[1], bx[k] - subs[best].pos[0])
    const sector = Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 4) % 4
    const key = `${best}-${sector}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(k)
  }
  for (const [key, blocks] of [...groups.entries()].sort()) {
    const sub = Number(key.split('-')[0])
    const id = feeders.length
    const cx = blocks.reduce((s, k) => s + bx[k], 0) / blocks.length
    const cz = blocks.reduce((s, k) => s + bz[k], 0) / blocks.length
    let far = blocks[0]
    for (const k of blocks) if (Math.hypot(bx[k] - subs[sub].pos[0], bz[k] - subs[sub].pos[1]) > Math.hypot(bx[far] - subs[sub].pos[0], bz[far] - subs[sub].pos[1])) far = k
    subs[sub].feeders.push(id)
    feeders.push({ id, sub, name: `${subs[sub].name} #${subs[sub].feeders.length}`, blocks, centroid: [cx, cz], far: [bx[far], bz[far]], capKw: 0 })
    blocks.forEach((k) => (blockFeeder[k] = id))
  }

  // 절체 후보: 다른 선로 중 중심이 가까운 3개
  const alts = new Int16Array(nBlocks * 3).fill(-1)
  for (let k = 0; k < nBlocks; k++) {
    if (blockFeeder[k] < 0) continue
    const ranked = feeders
      .filter((f) => f.id !== blockFeeder[k])
      .map((f) => ({ id: f.id, d: Math.hypot(bx[k] - f.centroid[0], bz[k] - f.centroid[1]) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
    ranked.forEach((r, n) => (alts[k * 3 + n] = r.id))
  }

  const nBuild = bld.length
  const out: City = {
    nBlocks,
    bx,
    bz,
    zone,
    baseKw,
    blockFeeder,
    alts,
    nBuild,
    bx0: new Float32Array(nBuild),
    bz0: new Float32Array(nBuild),
    bw: new Float32Array(nBuild),
    bd: new Float32Array(nBuild),
    bh: new Float32Array(nBuild),
    bBlock: new Uint16Array(nBuild),
    bRand: new Float32Array(nBuild),
    bType: new Uint8Array(nBuild),
    bPal: new Uint8Array(nBuild),
    tank,
    subs,
    feeders,
    plant: [-SPAN / 2 - 14, -SPAN / 2 - 10],
  }
  bld.forEach((b, n) => {
    out.bx0[n] = b.x
    out.bz0[n] = b.z
    out.bw[n] = b.w
    out.bd[n] = b.d
    out.bh[n] = b.h
    out.bBlock[n] = b.block
    out.bRand[n] = b.r
    out.bType[n] = b.type
    out.bPal[n] = b.pal
  })
  return out
}

export const CITY: City = generate()

// ── 시간대 패턴 ────────────────────────────────────────
function loadProfiles(region: string, month: number, day: DayType): number[][] {
  return ZONE_CONTRACT.map((c) => {
    const raw = getProfile(EXAMPLE_DATASET, region, c, month, day) ?? Array<number>(24).fill(1)
    const max = Math.max(...raw.filter(Number.isFinite), 1e-9)
    return raw.map((v) => (Number.isFinite(v) ? v / max : 0))
  })
}

// 용량은 설계 조건(서울·8월·평일)의 하루 최대 부하로 정해 항상 같다
;(() => {
  const prof = loadProfiles('서울', 8, 'WEEKDAY')
  const peak = new Float64Array(CITY.feeders.length)
  for (let h = 0; h < 24; h++) {
    const load = new Float64Array(CITY.feeders.length)
    for (let k = 0; k < CITY.nBlocks; k++) {
      const z = CITY.zone[k]
      const f = CITY.blockFeeder[k]
      if (z === 3 || f < 0) continue
      load[f] += CITY.baseKw[k] * prof[z][h]
    }
    load.forEach((v, f) => (peak[f] = Math.max(peak[f], v)))
  }
  CITY.feeders.forEach((f, i) => (f.capKw = peak[i] * FEEDER_HEADROOM))
  CITY.subs.forEach((s) => (s.capKw = s.feeders.reduce((sum, f) => sum + CITY.feeders[f].capKw, 0) * SUB_DIVERSITY))
})()

// ── 상태 ────────────────────────────────────────────
export type FeederState = 'OK' | 'FAULT' | 'TRIPPED'
export type SubStatus = 'OK' | 'HIGH' | 'OVERLOAD' | 'FAULT' | 'OUT'

export interface LogItem {
  id: number
  clock: string
  level: 'info' | 'warn' | 'err'
  text: string
}

export interface FeederView {
  def: FeederDef
  state: FeederState
  loadKw: number
  /** 용량 대비 부하 (1.0 = 설계 최대) */
  util: number
  /** 다른 선로에서 넘겨받은 블록 수 */
  borrowed: number
  /** 정전 중인 블록 수 */
  outBlocks: number
  overloadMin: number
}
export interface SubView {
  def: SubDef
  fault: boolean
  loadKw: number
  util: number
  status: SubStatus
}

export type ScenarioId = 'normal' | 'heat' | 'sub' | 'storm' | 'cascade'
export const SCENARIOS: { id: ScenarioId; label: string; note: string }[] = [
  { id: 'normal', label: '평상시', note: '모든 설비 정상 · 오전 9시' },
  { id: 'heat', label: '폭염 피크', note: '부하 +25% · 오후 1시. 용량을 넘긴 선로는 15분 뒤 트립. 수요 반응으로 막을 수 있음' },
  { id: 'sub', label: '변전소 사고', note: '중앙 변전소 고장 · 저녁 7시' },
  { id: 'storm', label: '태풍 (선로 다발 사고)', note: '선로 5개 동시 사고 · 오후 3시' },
  { id: 'cascade', label: '연쇄 정전', note: '피크 시간 대형 선로 사고 + 자동 절체 → 이웃 선로 과부하' },
]

export interface CitySnap {
  version: number
  time: number
  playing: boolean
  /** 실제 1초에 흐르는 시뮬레이션 시간(분) */
  speed: number
  heat: number
  auto: boolean
  /** 자동 절체로 이웃 선로가 받을 수 있는 한도 (용량 대비) */
  transferLimit: number
  dr: boolean
  region: string
  month: number
  day: DayType
  scenario: ScenarioId
  demandKw: number
  servedKw: number
  outBuildings: number
  totalBuildings: number
  outBlocks: number
  /** 누적 정전 건물·시간 */
  outBuildingHours: number
  capKw: number
  feeders: FeederView[]
  subs: SubView[]
  history: { abs: number; clock: string; demand: number; served: number }[]
  log: LogItem[]
}

const S = {
  time: 9,
  abs: 0,
  playing: true,
  speed: 20,
  heat: 1,
  auto: false,
  transferLimit: SAFE_TRANSFER,
  dr: false,
  region: '서울',
  month: 8,
  day: 'WEEKDAY' as DayType,
  scenario: 'normal' as ScenarioId,
  outBuildingHours: 0,
}
let profiles = loadProfiles(S.region, S.month, S.day)
const F = CITY.feeders.length
const feederState = new Uint8Array(F) // 0 OK 1 FAULT 2 TRIPPED
const subFault = new Uint8Array(CITY.subs.length)
const overload = new Float32Array(F)
const supplier = new Int16Array(CITY.nBlocks).fill(-1)
const blockDemand = new Float32Array(CITY.nBlocks)
const feederLoad = new Float64Array(F)
let lastUtil = 0
let logSeq = 0
let log: LogItem[] = []
let history: CitySnap['history'] = []
let lastSample = -1e9
let version = 0
let snap: CitySnap

const STATES: FeederState[] = ['OK', 'FAULT', 'TRIPPED']
export const clockText = (t: number) => `${String(Math.floor(t) % 24).padStart(2, '0')}:${String(Math.floor((t % 1) * 60)).padStart(2, '0')}`

function addLog(level: LogItem['level'], text: string) {
  log = [{ id: ++logSeq, clock: clockText(S.time), level, text }, ...log].slice(0, 80)
}

const healthy = (f: number) => feederState[f] === 0 && !subFault[CITY.feeders[f].sub]

function frame(dtMin: number) {
  if (dtMin > 0) {
    S.time += dtMin / 60
    S.abs += dtMin
    if (S.time >= 24) S.time -= 24
  }
  const h0 = Math.floor(S.time) % 24
  const h1 = (h0 + 1) % 24
  const fr = S.time - Math.floor(S.time)
  const prof = profiles.map((p) => p[h0] * (1 - fr) + p[h1] * fr)
  const heatZ = [S.heat, S.heat, 1 + (S.heat - 1) * 0.3]
  const drK = S.dr && lastUtil > 0.9 ? 0.88 : 1

  let demand = 0
  for (let k = 0; k < CITY.nBlocks; k++) {
    const z = CITY.zone[k]
    blockDemand[k] = z === 3 ? 0 : CITY.baseKw[k] * prof[z] * heatZ[z] * drK
    demand += blockDemand[k]
  }

  feederLoad.fill(0)
  const orphans: number[] = []
  for (let k = 0; k < CITY.nBlocks; k++) {
    const f = CITY.blockFeeder[k]
    if (f < 0) {
      supplier[k] = -1
      continue
    }
    if (healthy(f)) {
      supplier[k] = f
      feederLoad[f] += blockDemand[k]
    } else {
      supplier[k] = -1
      if (blockDemand[k] > 0) orphans.push(k)
    }
  }
  if (S.auto && orphans.length) {
    orphans.sort((a, b) => blockDemand[a] - blockDemand[b])
    for (const k of orphans) {
      for (let n = 0; n < 3; n++) {
        const alt = CITY.alts[k * 3 + n]
        if (alt >= 0 && healthy(alt) && feederLoad[alt] + blockDemand[k] <= CITY.feeders[alt].capKw * S.transferLimit) {
          supplier[k] = alt
          feederLoad[alt] += blockDemand[k]
          break
        }
      }
    }
  }

  // 과부하 트립
  for (let f = 0; f < F; f++) {
    if (!healthy(f)) {
      overload[f] = 0
      continue
    }
    const ratio = feederLoad[f] / CITY.feeders[f].capKw
    if (ratio > TRIP_RATIO) {
      overload[f] += dtMin
      if (overload[f] >= TRIP_AFTER_MIN) {
        feederState[f] = 2
        overload[f] = 0
        addLog('err', `${CITY.feeders[f].name} 선로 과부하 트립 (${Math.round(ratio * 100)}%)`)
      }
    } else overload[f] = Math.max(0, overload[f] - dtMin * 0.5)
  }

  // 집계
  let served = 0
  let outBuildings = 0
  let outBlocks = 0
  for (let k = 0; k < CITY.nBlocks; k++) {
    if (CITY.zone[k] === 3) continue
    if (supplier[k] >= 0) served += blockDemand[k]
    else {
      outBlocks++
    }
  }
  for (let b = 0; b < CITY.nBuild; b++) if (supplier[CITY.bBlock[b]] < 0) outBuildings++
  S.outBuildingHours += (outBuildings * dtMin) / 60

  const subs: SubView[] = CITY.subs.map((def) => {
    const loadKw = def.feeders.reduce((s, f) => s + feederLoad[f], 0)
    const util = loadKw / def.capKw
    const fault = subFault[def.id] === 1
    const allOut = def.feeders.every((f) => !healthy(f))
    const status: SubStatus = fault ? 'FAULT' : allOut ? 'OUT' : util > 1 ? 'OVERLOAD' : util > 0.9 ? 'HIGH' : 'OK'
    return { def, fault, loadKw, util, status }
  })
  lastUtil = subs.reduce((m, s) => Math.max(m, s.util), 0)

  const feeders: FeederView[] = CITY.feeders.map((def) => {
    let borrowed = 0
    let out = 0
    for (const k of def.blocks) if (supplier[k] < 0 && blockDemand[k] > 0) out++
    for (let k = 0; k < CITY.nBlocks; k++) if (supplier[k] === def.id && CITY.blockFeeder[k] !== def.id) borrowed++
    return { def, state: STATES[feederState[def.id]], loadKw: feederLoad[def.id], util: feederLoad[def.id] / def.capKw, borrowed, outBlocks: out, overloadMin: overload[def.id] }
  })

  if (S.abs - lastSample >= 15 || S.abs < lastSample) {
    lastSample = S.abs
    history = [...history, { abs: S.abs, clock: clockText(S.time), demand: demand / 1000, served: served / 1000 }].slice(-96)
  }

  snap = {
    version: ++version,
    time: S.time,
    playing: S.playing,
    speed: S.speed,
    heat: S.heat,
    auto: S.auto,
    transferLimit: S.transferLimit,
    dr: S.dr,
    region: S.region,
    month: S.month,
    day: S.day,
    scenario: S.scenario,
    demandKw: demand,
    servedKw: served,
    outBuildings,
    totalBuildings: CITY.nBuild,
    outBlocks,
    outBuildingHours: S.outBuildingHours,
    capKw: CITY.subs.reduce((s, x) => s + x.capKw, 0),
    feeders,
    subs,
    history,
    log,
  }
  listeners.forEach((l) => l())
}

// ── 스토어 ──────────────────────────────────────────
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
const TICK_MS = 200

function subscribe(l: () => void) {
  listeners.add(l)
  if (!timer) timer = setInterval(() => S.playing && frame((S.speed * TICK_MS) / 1000), TICK_MS)
  return () => {
    listeners.delete(l)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}
export function useCity(): CitySnap {
  return useSyncExternalStore(subscribe, () => snap)
}
export const getCity = () => snap

/** 장면이 매 프레임 직접 읽는 값 (복사하지 않음) */
export const cityLive = { supplier, blockDemand }

// ── 조작 ────────────────────────────────────────────
export function setPlaying(on: boolean) {
  S.playing = on
  frame(0)
}
export function setSpeed(minPerSec: number) {
  S.speed = minPerSec
  frame(0)
}
export function setTime(hour: number) {
  S.time = ((hour % 24) + 24) % 24
  frame(0)
}
export function setHeat(x: number) {
  S.heat = x
  frame(0)
}
export function setAuto(on: boolean) {
  S.auto = on
  addLog('info', on ? '자동 절체 켬: 사고 선로의 부하를 이웃 선로가 남는 용량만큼 넘겨받음' : '자동 절체 끔')
  frame(0)
}
export function setTransferLimit(x: number) {
  S.transferLimit = x
  addLog('info', x > SAFE_TRANSFER ? `절체 허용 한도 ${Math.round(x * 100)}%: 이웃 선로가 용량을 넘겨서까지 부하를 받음 (연쇄 정전 위험)` : `절체 허용 한도 ${Math.round(x * 100)}%: 남는 용량만 넘겨받음`)
  frame(0)
}
/** 시뮬레이션 시간을 빠르게 앞으로 돌림 (과부하 트립·연쇄를 보려고) */
export function stepMinutes(min: number) {
  for (let left = min; left > 0; left -= 5) frame(Math.min(5, left))
}
export function setDemandResponse(on: boolean) {
  S.dr = on
  addLog('info', on ? '수요 반응 켬: 변전소 이용률 90% 초과 시 부하 12% 감축' : '수요 반응 끔')
  frame(0)
}
export function setProfile(region: string, month: number, day: DayType) {
  S.region = region
  S.month = month
  S.day = day
  profiles = loadProfiles(region, month, day)
  frame(0)
}
export function faultFeeder(f: number) {
  if (feederState[f] === 1) return
  feederState[f] = 1
  addLog('err', `${CITY.feeders[f].name} 선로 사고 발생`)
  frame(0)
}
export function faultSub(s: number) {
  if (subFault[s]) return
  subFault[s] = 1
  addLog('err', `${CITY.subs[s].name} 변전소 사고 발생 (선로 ${CITY.subs[s].feeders.length}개 정전)`)
  frame(0)
}
export function restoreFeeder(f: number) {
  if (feederState[f] === 0) return
  feederState[f] = 0
  overload[f] = 0
  addLog('info', `${CITY.feeders[f].name} 선로 복구`)
  frame(0)
}
export function restoreSub(s: number) {
  if (!subFault[s]) return
  subFault[s] = 0
  addLog('info', `${CITY.subs[s].name} 변전소 복구`)
  frame(0)
}
export function restoreAll() {
  feederState.fill(0)
  subFault.fill(0)
  overload.fill(0)
  addLog('info', '모든 설비 복구')
  frame(0)
}

export function runScenario(id: ScenarioId) {
  feederState.fill(0)
  subFault.fill(0)
  overload.fill(0)
  S.outBuildingHours = 0
  history = []
  lastSample = -1e9
  S.scenario = id
  const biggest = [...CITY.feeders].sort((a, b) => b.capKw - a.capKw)
  switch (id) {
    case 'normal':
      S.heat = 1
      S.time = 9
      break
    case 'heat':
      S.heat = 1.25
      S.time = 13
      break
    case 'sub':
      S.heat = 1
      S.time = 19
      subFault[0] = 1
      addLog('err', '중앙 변전소 사고 발생')
      break
    case 'storm': {
      S.heat = 1
      S.time = 15
      const rnd = mulberry32(7)
      const pick = new Set<number>()
      while (pick.size < Math.min(5, F)) pick.add(Math.floor(rnd() * F))
      pick.forEach((f) => {
        feederState[f] = 1
      })
      addLog('err', `태풍으로 선로 ${pick.size}개 사고: ${[...pick].map((f) => CITY.feeders[f].name).join(', ')}`)
      break
    }
    case 'cascade':
      S.heat = 1.2
      S.time = 17.5
      S.auto = true
      S.transferLimit = RISKY_TRANSFER
      S.dr = false
      feederState[biggest[0].id] = 1
      addLog('err', `${biggest[0].name} 선로 사고 발생 (자동 절체 켬 · 허용 한도 ${Math.round(RISKY_TRANSFER * 100)}%)`)
      break
  }
  frame(0)
}

export function resetCity() {
  S.auto = false
  S.transferLimit = SAFE_TRANSFER
  S.dr = false
  log = []
  runScenario('normal')
}

frame(0)
