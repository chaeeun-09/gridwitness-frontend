import { useSyncExternalStore } from 'react'
import { deviation, type DeviationParams } from './deviation'

// 가상 대단지: 마을 모형(집마다 릴레이 + 전류 측정 → 예상과 비교해 이상 판정)을 실제 규모 아파트 단지로 키운 소프트웨어 모형.
//
// 무엇이 실제이고 무엇이 가정인지 (화면에도 그대로 표시):
//   실제  · 지역본부 시간별 전력사용량·고객호수 (한전 공공데이터 15151157, 2024년, 원본 값)
//         · 같은 시각 우리 AI(KR 부하 모델, 2023년까지만 학습)의 예측과 이상 점수, 그 해에 실제로 판정한 사건
//         · 세대 월평균 사용량 기준 363 kWh (한전 발표 2024년 8월 주택용 가구 평균, 뉴시스 2024-09-09 보도)
//   가정  · 단지 구성(동·층·호), 모든 세대가 같은 양을 씀, 시간 패턴은 지역 전체(주택·상가·산업 합계)의 패턴을 그대로 씀
//         · 가로등 개수·소비전력·점등 시각, 사람이 넣는 가상 고장의 크기
//   센서 잡음은 넣지 않는다 (만든 값이 섞이지 않게).

export const DATA_BASE = `${import.meta.env.BASE_URL}data/complex/`

export const ANCHOR_KWH_MONTH = 363
export const ANCHOR_SOURCE = '한전 발표 2024년 8월 주택용 가구당 평균 사용량 363 kWh (뉴시스 2024-09-09 보도)'
export const ANCHOR_URL = 'https://www.newsis.com/view/NISX20240909_0002881110'
const AUG_START = 213 * 24 // 2024-08-01 00시 (윤년: 1~7월 213일)
const AUG_HOURS = 31 * 24

export const LAMP_KW = 0.1 // 가정: LED 가로등 1개 100 W
export const LAMP_ON = (hour: number) => hour >= 18 || hour < 6 // 가정: 18시~다음날 6시 점등
export const NOMINAL_V = 220
const V_MIN = 0.9 * NOMINAL_V
// 세대 계량기 판정: 스마트 마을과 같은 규칙(deviation.ts). 세대별 실측이 없어 흔들림·여유는 가정값
//   흔들림 = 정상의 5%, k = 4 (마을 학습값과 같은 배수), 여유 = 0.05 kW
export const UNIT_RULE = { sigmaRel: 0.05, k: 4, tolKw: 0.05 }
const unitParams = (expected: number): DeviationParams => ({ sigma: UNIT_RULE.sigmaRel * expected, k: UNIT_RULE.k, tol: UNIT_RULE.tolKw })

export type UnitFault = 'OPEN' | 'LEAK' | 'STUCK'
export type BuildingFault = 'OUTAGE' | 'SAG'
export type UnitStatus = 'NORMAL' | 'OFF' | 'WARNING' | 'FAULT' | 'OUTAGE' | 'NO_DATA'

export const UNIT_FAULT_LABEL: Record<UnitFault, string> = {
  OPEN: '인입선 단선 (전기가 안 들어감)',
  LEAK: '누설·과전류 (+1 kW, 가상)',
  STUCK: '차단기 고착 (꺼도 전기가 흐름)',
}
export const BUILDING_FAULT_LABEL: Record<BuildingFault, string> = { OUTAGE: '동 정전', SAG: '동 전압 강하 (85%)' }
export const UNIT_STATUS_LABEL: Record<UnitStatus, string> = {
  NORMAL: '정상',
  OFF: '차단',
  WARNING: '주의',
  FAULT: '이상',
  OUTAGE: '정전',
  NO_DATA: '데이터 없음',
}

// ── 실제 데이터 ─────────────────────────────────────
export interface RealEvent {
  node: string
  kind: 'DROP' | 'SPIKE'
  scope: string
  start: string
  end: string
  hours: number
  worst_z: number
  worst_ratio: number
  expected: number
  actual: number
  data_check: string | null
}
export interface WideEvent {
  start: string
  end: string
  hours: number
  max_nodes: number
  nodes: string[]
}
export interface ComplexIndex {
  year: number
  time_basis: string
  unit: string
  source: { dataset: string; url: string; license: string; file: string; sha256: string; note: string }
  model: { version: Record<string, string>; trained_until: string; z_node: number; z_wide: number; code_commit: string; fleet_joblib_sha256: string; note: string; weather?: string | null }
  regions: { region: string; file: string; missing_hours: number }[]
  /** 한전 '가구 평균 전력사용량' 지역본부별 1~12월 가구당 평균 (kWh) */
  household?: { dataset: string; url: string; kwh_month_by_region: Record<string, (number | null)[]>; national_kwh_by_month: Record<string, number>; note: string }
  events: RealEvent[]
  wide_area: WideEvent[]
}
export interface RegionData {
  region: string
  start: string
  hours: number
  use: (number | null)[]
  cust: (number | null)[]
  exp: (number | null)[]
  z: (number | null)[]
  holiday: number[]
  /** 지역 대표 기상청 ASOS 관측소 이름과 관측 기온(℃, 빈 값은 null) */
  station?: string
  ta?: (number | null)[]
}

/** 지역 고객 1호당 시간 사용량(kWh) */
const perCust = (d: RegionData, h: number, which: 'use' | 'exp'): number | null => {
  const v = d[which][h]
  const c = d.cust[h]
  return v == null || c == null || c <= 0 ? null : (v * 1000) / c
}

export interface Scale {
  /** 월별(0~11) 세대 사용량 = 지역 1호당 사용량 × factor[월]. 그 달 기준값이 없으면 null (채우지 않음) */
  factor: (number | null)[]
  /** monthly = 한전 가구 평균(지역·월), anchor = 전국 363 kWh 하나 */
  basis: 'monthly' | 'anchor'
  /** 지역·월 가구당 평균 사용량 (kWh) */
  kwhMonth: (number | null)[]
}
const monthOf = (d: RegionData, h: number) => {
  const t = new Date(d.start.replace(' ', 'T') + 'Z')
  t.setUTCHours(t.getUTCHours() + h)
  return t.getUTCMonth()
}
/** 세대 기준 = 그 지역·그 달의 실제 가구 평균(있으면), 시간 변화 = 지역 전체의 실제 시간 패턴 */
export function scaleFor(d: RegionData, idx: ComplexIndex | null): Scale | null {
  const sum = new Array(12).fill(0)
  const cnt = new Array(12).fill(0)
  const hours = new Array(12).fill(0)
  for (let h = 0; h < d.hours; h++) {
    const m = monthOf(d, h)
    hours[m]++
    const v = perCust(d, h, 'use')
    if (v != null) {
      sum[m] += v
      cnt[m]++
    }
  }
  const monthly = idx?.household?.kwh_month_by_region[d.region]
  if (monthly) {
    return { basis: 'monthly', kwhMonth: monthly, factor: monthly.map((k, m) => (k == null || !cnt[m] ? null : k / hours[m] / (sum[m] / cnt[m]))) }
  }
  const aug = 7
  if (!cnt[aug]) return null
  const f = ANCHOR_KWH_MONTH / AUG_HOURS / (sum[aug] / cnt[aug])
  return { basis: 'anchor', kwhMonth: new Array(12).fill(ANCHOR_KWH_MONTH), factor: new Array(12).fill(f) }
}

/** 세대 1곳의 그 시각 사용량 (kW = 1시간 kWh) */
export function householdKw(d: RegionData, sc: Scale, h: number, which: 'use' | 'exp' = 'use'): number | null {
  const v = perCust(d, h, which)
  const f = sc.factor[monthOf(d, h)]
  return v == null || f == null ? null : v * f
}
export const monthIndex = monthOf

export function hourLabel(start: string, h: number): string {
  const t = new Date(start.replace(' ', 'T') + 'Z')
  t.setUTCHours(t.getUTCHours() + h)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())} ${p(t.getUTCHours())}:00`
}
export function hourOf(start: string, label: string): number {
  const a = Date.parse(start.replace(' ', 'T') + 'Z')
  const b = Date.parse(label.replace(' ', 'T').slice(0, 16) + ':00Z')
  return Math.round((b - a) / 3600_000)
}

/** 그 시각 이 지역에 실제 AI 가 낸 사건 */
export function eventsAt(idx: ComplexIndex, d: RegionData, h: number) {
  const inside = (s: string, e: string) => h >= hourOf(d.start, s) && h <= hourOf(d.start, e)
  return {
    local: idx.events.filter((e) => e.node === d.region && inside(e.start, e.end)),
    wide: idx.wide_area.filter((w) => w.nodes.includes(d.region) && inside(w.start, w.end)),
  }
}

// ── 단지 상태 ───────────────────────────────────────
export interface Layout {
  buildings: number
  floors: number
  perFloor: number
  lampsPerBuilding: number
}
export const DEFAULT_LAYOUT: Layout = { buildings: 12, floors: 15, perFloor: 4, lampsPerBuilding: 4 }

export interface UnitReading {
  kw: number | null
  expected: number | null
  v: number
  status: UnitStatus
  score: number
}
export interface BuildingReading {
  kw: number
  expected: number
  v: number
  units: UnitReading[]
  lamps: UnitReading[]
  counts: Record<UnitStatus, number>
  fault: BuildingFault | null
}
export interface ComplexEvent {
  id: number
  at: string
  where: string
  status: UnitStatus
  text: string
}

export interface ComplexSnap {
  layout: Layout
  hour: number
  playing: boolean
  speed: number
  /** 세대 차단기 꺼짐 (key = `${b}-${u}`) */
  off: Set<string>
  unitFaults: Map<string, UnitFault>
  buildingFaults: Map<number, BuildingFault>
  log: ComplexEvent[]
  version: number
}

let snap: ComplexSnap = {
  layout: DEFAULT_LAYOUT,
  hour: AUG_START + 6 * 24 + 19, // 기본: 2024-08-07(수) 19시
  playing: false,
  speed: 1,
  off: new Set(),
  unitFaults: new Map(),
  buildingFaults: new Map(),
  log: [],
  version: 0,
}

const listeners = new Set<() => void>()
function emit(patch: Partial<ComplexSnap> = {}) {
  snap = { ...snap, ...patch, version: snap.version + 1 }
  listeners.forEach((l) => l())
}
export function useComplex(): ComplexSnap {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snap,
  )
}

export const unitKey = (b: number, u: number) => `${b}-${u}`
export const lampKey = (b: number, l: number) => `${b}-L${l}`
export function unitName(layout: Layout, b: number, u: number): string {
  const floor = Math.floor(u / layout.perFloor) + 1
  const no = (u % layout.perFloor) + 1
  return `${101 + b}동 ${floor}${String(no).padStart(2, '0')}호`
}

// ── 측정과 판정 (마을 모형과 같은 규칙) ─────────────────
function judge(kw: number | null, expected: number | null, v: number, on: boolean): UnitReading {
  if (kw == null || expected == null) return { kw, expected, v, status: 'NO_DATA', score: 0 }
  if (v < 0.5 * NOMINAL_V) return { kw, expected, v, status: 'OUTAGE', score: 1 }
  if (!on) return { kw, expected, v, status: kw > 0.05 ? 'FAULT' : 'OFF', score: kw > 0.05 ? 1 : 0 }
  const dv = deviation(kw, expected, unitParams(expected))
  // 전압 강하는 따로: 정격의 90% 아래부터 주의
  const rv = Math.max(0, V_MIN - v) / (0.15 * NOMINAL_V)
  const score = Math.min(1, Math.max(dv.score, rv))
  const level = dv.level === 'FAULT' || rv >= 0.6 ? 'FAULT' : dv.level === 'WARNING' || rv >= 0.3 ? 'WARNING' : 'NORMAL'
  return { kw, expected, v, status: level, score }
}

const EMPTY_COUNTS = (): Record<UnitStatus, number> => ({ NORMAL: 0, OFF: 0, WARNING: 0, FAULT: 0, OUTAGE: 0, NO_DATA: 0 })

export function measure(s: ComplexSnap, d: RegionData, sc: Scale): BuildingReading[] {
  const base = householdKw(d, sc, s.hour)
  const hourOfDay = (new Date(d.start.replace(' ', 'T') + 'Z').getUTCHours() + s.hour) % 24
  const lampOn = LAMP_ON(hourOfDay)
  const out: BuildingReading[] = []
  const nUnits = s.layout.floors * s.layout.perFloor
  for (let b = 0; b < s.layout.buildings; b++) {
    const bf = s.buildingFaults.get(b) ?? null
    const v = bf === 'OUTAGE' ? 0 : bf === 'SAG' ? 0.85 * NOMINAL_V : NOMINAL_V
    // 전압이 내려가면 같은 기기도 전력이 줄어든다 (저항성 부하 가정: 전압비²)
    const vk = (v / NOMINAL_V) ** 2
    const counts = EMPTY_COUNTS()
    const units: UnitReading[] = []
    let kw = 0
    let expected = 0
    for (let u = 0; u < nUnits; u++) {
      const key = unitKey(b, u)
      const on = !s.off.has(key)
      const f = s.unitFaults.get(key)
      let m: number | null = null
      if (base != null) {
        const flows = on || f === 'STUCK'
        m = !flows || f === 'OPEN' ? 0 : base * vk + (f === 'LEAK' ? 1 : 0)
      }
      const r = judge(m, base == null ? null : on ? base : 0, v, on)
      units.push(r)
      counts[r.status]++
      kw += m ?? 0
      expected += on ? (base ?? 0) : 0
    }
    const lamps: UnitReading[] = []
    for (let l = 0; l < s.layout.lampsPerBuilding; l++) {
      const key = lampKey(b, l)
      const on = lampOn && !s.off.has(key)
      const f = s.unitFaults.get(key)
      const flows = on || f === 'STUCK'
      const m = !flows || f === 'OPEN' ? 0 : LAMP_KW * vk + (f === 'LEAK' ? 1 : 0)
      const r = judge(m, on ? LAMP_KW : 0, v, on)
      lamps.push(r)
      kw += m
      expected += on ? LAMP_KW : 0
    }
    out.push({ kw, expected, v, units, lamps, counts, fault: bf })
  }
  return out
}

// ── 조작 ────────────────────────────────────────────
let logId = 0
function log(d: RegionData | null, where: string, status: UnitStatus, text: string) {
  const at = d ? hourLabel(d.start, snap.hour) : ''
  snap.log = [{ id: ++logId, at, where, status, text }, ...snap.log].slice(0, 60)
}

export function setLayout(next: Partial<Layout>) {
  emit({ layout: { ...snap.layout, ...next }, off: new Set(), unitFaults: new Map(), buildingFaults: new Map(), log: [] })
}
export function setHour(h: number) {
  emit({ hour: Math.max(0, Math.min(8783, Math.round(h))) })
}
export function setSpeed(speed: number) {
  emit({ speed })
}
export function toggleUnit(key: string) {
  const off = new Set(snap.off)
  if (off.has(key)) off.delete(key)
  else off.add(key)
  emit({ off })
}
export function setBuildingPower(b: number, units: number, lamps: number, on: boolean) {
  const off = new Set(snap.off)
  const keys = [...Array.from({ length: units }, (_, u) => unitKey(b, u)), ...Array.from({ length: lamps }, (_, l) => lampKey(b, l))]
  for (const k of keys) {
    if (on) off.delete(k)
    else off.add(k)
  }
  emit({ off })
}
export function injectUnitFault(d: RegionData | null, key: string, where: string, f: UnitFault) {
  const m = new Map(snap.unitFaults)
  m.set(key, f)
  snap.unitFaults = m
  log(d, where, 'FAULT', `가상 고장 주입: ${UNIT_FAULT_LABEL[f]}`)
  emit()
}
export function clearUnitFault(key: string) {
  const m = new Map(snap.unitFaults)
  m.delete(key)
  emit({ unitFaults: m })
}
export function injectBuildingFault(d: RegionData | null, b: number, f: BuildingFault) {
  const m = new Map(snap.buildingFaults)
  m.set(b, f)
  snap.buildingFaults = m
  log(d, `${101 + b}동`, f === 'OUTAGE' ? 'OUTAGE' : 'WARNING', `가상 고장 주입: ${BUILDING_FAULT_LABEL[f]}`)
  emit()
}
export function clearBuildingFault(b: number) {
  const m = new Map(snap.buildingFaults)
  m.delete(b)
  emit({ buildingFaults: m })
}
export function resetComplex() {
  emit({ off: new Set(), unitFaults: new Map(), buildingFaults: new Map(), log: [] })
}
export function noteDetections(d: RegionData, found: { where: string; status: UnitStatus; text: string }[]) {
  for (const f of found) log(d, f.where, f.status, f.text)
  if (found.length) emit()
}

let timer: ReturnType<typeof setInterval> | null = null
export function setPlaying(on: boolean) {
  if (timer) clearInterval(timer)
  timer = null
  if (on) {
    timer = setInterval(() => {
      if (snap.hour >= 8783) return setPlaying(false)
      emit({ hour: snap.hour + 1 })
    }, 700 / snap.speed)
  }
  emit({ playing: on })
}

// ── 데이터 불러오기 ─────────────────────────────────
let indexPromise: Promise<ComplexIndex> | null = null
const regionCache = new Map<string, Promise<RegionData>>()
async function getJson<T>(file: string): Promise<T> {
  const r = await fetch(DATA_BASE + file)
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`)
  return (await r.json()) as T
}
export function loadIndex(): Promise<ComplexIndex> {
  indexPromise ??= getJson<ComplexIndex>('index.json').catch((e) => {
    indexPromise = null
    throw e
  })
  return indexPromise
}
export function loadRegion(file: string): Promise<RegionData> {
  let p = regionCache.get(file)
  if (!p) {
    p = getJson<RegionData>(file).catch((e) => {
      regionCache.delete(file)
      throw e
    })
    regionCache.set(file, p)
  }
  return p
}
