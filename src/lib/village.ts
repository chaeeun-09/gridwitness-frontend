import { useSyncExternalStore } from 'react'
import type { IotPoint } from '../types'
import { openSerial, parseFrame, type SerialLink, type SerialReading } from './serial'

// 스마트 마을 모형 계측 (최종 구성도 기준).
//   5V DC 어댑터 → 1채널 릴레이(Arduino D2, 마을 전체 ON/OFF) → INA219(전체 전압·전류) → 브레드보드 → LED 5개 병렬
// 출처: MOCK(브라우저 시뮬레이터) 또는 SERIAL(실제 모형, Web Serial).
// LED별 전류는 측정하지 않음. 전체 전류로 켜진 LED 수만 추정. 교류 고장파형과는 별개 데이터.

export type ChannelId = 'h1' | 'h2' | 'h3' | 'l1' | 'l2'
export type ChannelKind = 'HOUSE' | 'LAMP'
export type DataSource = 'MOCK' | 'SERIAL'
/** LED 위치 고장(OPEN·GROUND)과 전원·제어 고장(SAG·OUTAGE·STUCK) */
export type FaultKind = 'OPEN' | 'GROUND' | 'SAG' | 'OUTAGE' | 'STUCK'
export type NodeStatus = 'NORMAL' | 'OFF' | 'WARNING' | 'FAULT' | 'OUTAGE' | 'NO_DATA'

export interface ChannelDef {
  id: ChannelId
  /** LED 번호 (구성도의 LED 1~5) */
  ch: number
  kind: ChannelKind
  name: string
  /** 꽂힌 브레드보드 */
  board: string
}

/** 마을 부하: 주택 3 + 가로등 2, 모두 병렬 */
export const IOT_CHANNELS: ChannelDef[] = [
  { id: 'h1', ch: 1, kind: 'HOUSE', name: '주택 1', board: '브레드보드 2' },
  { id: 'h2', ch: 2, kind: 'HOUSE', name: '주택 2', board: '브레드보드 2' },
  { id: 'h3', ch: 3, kind: 'HOUSE', name: '주택 3', board: '브레드보드 2' },
  { id: 'l1', ch: 4, kind: 'LAMP', name: '가로등 1', board: '브레드보드 3' },
  { id: 'l2', ch: 5, kind: 'LAMP', name: '가로등 2', board: '브레드보드 3' },
]

export const SOURCE_LABEL: Record<DataSource, string> = {
  MOCK: '시뮬레이터',
  SERIAL: '실측 · Arduino',
}

export const FAULT_LABEL: Record<FaultKind, string> = {
  OPEN: 'LED 단선',
  GROUND: '누설·과전류',
  SAG: '어댑터 전압 강하',
  OUTAGE: '어댑터 전원 상실',
  STUCK: '릴레이 접점 고착',
}
/** 특정 LED 위치에 거는 고장인지 */
export const FAULT_AT_LED: Record<FaultKind, boolean> = { OPEN: true, GROUND: true, SAG: false, OUTAGE: false, STUCK: false }

export const STATUS_LABEL: Record<NodeStatus, string> = {
  NORMAL: '정상',
  OFF: '차단됨',
  WARNING: '주의',
  FAULT: '이상',
  OUTAGE: '정전',
  NO_DATA: '데이터 없음',
}

export const DEVICE_INFO: Record<DataSource, { deviceId: string; sensor: string; port: string }> = {
  MOCK: { deviceId: 'arduino-sim-01', sensor: 'INA219 ×1 (시뮬레이터)', port: 'SIM' },
  SERIAL: { deviceId: 'arduino-village', sensor: 'INA219 ×1', port: 'Web Serial 115200' },
}
export const IOT_MODEL = 'iot-anomaly-0.2 (전체 전류 잔차)'
export const NOMINAL_V = 5
/** LED 1개(저항 포함) 정격 전류 A — 5개 합 ≈ 0.28 A */
export const LED_A = 0.056
/** 이상 탐지 기준. 관리자 페이지에서 바꾸면 이 브라우저에 저장됨 */
export interface Thresholds {
  /** 이 점수 이상이면 '주의' */
  warn: number
  /** 이 점수 이상이면 '이상' */
  fault: number
  /** 릴레이가 닫혀 있을 때 이 전압(V) 아래로 내려가면 점수가 오름 */
  vMin: number
}
export const DEFAULT_THRESHOLDS: Thresholds = { warn: 0.3, fault: 0.6, vMin: 4.75 }
const TH_KEY = 'gridwitness.thresholds.v1'
function loadThresholds(): Thresholds {
  try {
    const raw = JSON.parse(localStorage.getItem(TH_KEY) ?? 'null') as Partial<Thresholds> | null
    if (raw && typeof raw.warn === 'number' && typeof raw.fault === 'number' && typeof raw.vMin === 'number' && raw.warn < raw.fault) return { warn: raw.warn, fault: raw.fault, vMin: raw.vMin }
  } catch {
    // 저장값을 못 읽으면 기본값
  }
  return { ...DEFAULT_THRESHOLDS }
}
/** 항상 같은 객체를 갱신해서 어디서 읽어도 최신 값 */
export const THRESHOLDS: Thresholds = loadThresholds()
export function setThresholds(next: Partial<Thresholds>) {
  Object.assign(THRESHOLDS, next)
  // 주의 기준이 이상 기준 이상이면 화면에서만 보여주고 저장하지 않음 (다시 열면 마지막 정상 값)
  if (THRESHOLDS.warn < THRESHOLDS.fault) {
    try {
      localStorage.setItem(TH_KEY, JSON.stringify(THRESHOLDS))
    } catch {
      // 저장 불가 환경은 무시
    }
  }
  emit()
}
export function resetThresholds() {
  setThresholds({ ...DEFAULT_THRESHOLDS })
}
export const TICK_MS = 500
const HISTORY = 120
const COMMAND_LATENCY_MS = 350 // 시뮬레이터 릴레이 응답 지연

export interface LedState extends ChannelDef {
  /** 켜져 있다고 보는지. Mock은 시뮬레이터 값, 실측은 추정 */
  lit: boolean
  fault: FaultKind | null
}

export interface VillageEvent {
  id: number
  source: DataSource
  /** 사건 제목으로 쓸 이름 (없으면 상태로 만듦) */
  label?: string
  at: string
  injected: FaultKind | null
  injectedAt: string | null
  status: Exclude<NodeStatus, 'NORMAL' | 'OFF' | 'NO_DATA'>
  maxScore: number
  relayOn: boolean
  expected: number
  window: IotPoint[]
  clearedAt: string | null
  caseId: string | null
}

export interface Scenario {
  label: string
  profile: number[]
  hour: number
}

export interface VillageSnapshot {
  source: DataSource
  connected: boolean
  lastError: string | null
  badFrames: number
  lastPacketAt: number | null
  packets: number
  /** 마을 전체 전원(릴레이) */
  relay: boolean
  relayPending: boolean | null
  v: number
  i: number
  p: number
  expected: number
  score: number
  status: NodeStatus
  /** 전체 전류로 추정한 켜진 LED 수 */
  estLit: number
  leds: Record<ChannelId, LedState>
  history: { t: number; v: number; i: number; p: number; expected: number; score: number }[]
  events: VillageEvent[]
  faults: Partial<Record<ChannelId, FaultKind>>
  supplyFault: FaultKind | null
  scenario: Scenario | null
  thresholds: Thresholds
}

/** IoT 이상 탐지: 릴레이 상태로 예상 전류를 정하고, 실제 전류와의 차이(LED 2개 분량 = 1.0)와 전압 강하로 점수 산출 */
export function anomalyScore(v: number, i: number, expected: number): number {
  const ri = Math.abs(i - expected) / (LED_A * 2)
  const rv = expected > 0 ? Math.max(0, THRESHOLDS.vMin - v) / 0.75 : 0
  return Math.min(1, Math.max(ri, rv))
}

export function classify(v: number, i: number, score: number, relay: boolean): NodeStatus {
  if (!relay) return i > 0.03 ? 'FAULT' : 'OFF'
  if (v < 1) return 'OUTAGE'
  if (score >= THRESHOLDS.fault) return 'FAULT'
  if (score >= THRESHOLDS.warn) return 'WARNING'
  return 'NORMAL'
}

const RANK: Record<NodeStatus, number> = { OFF: 0, NORMAL: 0, NO_DATA: 1, WARNING: 2, FAULT: 3, OUTAGE: 4 }
const noise = (amp: number) => (Math.random() - 0.5) * 2 * amp
const isAbnormal = (s: NodeStatus): s is VillageEvent['status'] => s === 'WARNING' || s === 'FAULT' || s === 'OUTAGE'

let t = 0
let eventSeq = 0
const faults: Partial<Record<ChannelId, FaultKind>> = {}
let supplyFault: FaultKind | null = null
let lastInjectedAt: string | null = null
let relay = true
let relayPending: boolean | null = null
let commandTimer: ReturnType<typeof setTimeout> | undefined
/** 시나리오 재생용 가상 부하 (시뮬레이터 전용, 실제 회로에는 LED별 스위치가 없음) */
const enabled: Record<ChannelId, boolean> = { h1: true, h2: true, h3: true, l1: true, l2: true }
let connected = true
let source: DataSource = 'MOCK'
let link: SerialLink | null = null
let latest: { at: number; frame: SerialReading } | null = null
let badFrames = 0
let lastError: string | null = null
let scenario: Scenario | null = null
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

/** 접점이 실제로 닫혀 있는지 (고착이면 명령과 상관없이 닫힘) */
export function contactClosed(s: Pick<VillageSnapshot, 'relay' | 'supplyFault'>): boolean {
  return s.relay || s.supplyFault === 'STUCK'
}

/** 시뮬레이터: LED가 실제로 빛나는지 (릴레이·전원·고장·시나리오 반영) */
function mockLit(id: ChannelId): boolean {
  return contactClosed({ relay, supplyFault }) && supplyFault !== 'OUTAGE' && enabled[id] && faults[id] !== 'OPEN'
}

function mockMeasure(): { v: number; i: number } {
  // 회로가 열려 있으면 INA219는 0 V·0 A (표시 자릿수 아래의 잡음만)
  if (!contactClosed({ relay, supplyFault }) || supplyFault === 'OUTAGE') return { v: Math.abs(noise(0.004)), i: Math.abs(noise(0.0004)) }
  const vSupply = supplyFault === 'SAG' ? 4.25 + noise(0.05) : 5.03 + noise(0.015)
  let i = 0
  for (const c of IOT_CHANNELS) {
    if (!mockLit(c.id)) continue
    i += LED_A * (vSupply / 5) * (1 + 0.03 * Math.sin(t / 7 + c.ch))
    if (faults[c.id] === 'GROUND') i += 0.22
  }
  i += noise(0.003)
  return { v: vSupply - i * 0.06, i: Math.max(0, i) }
}

function expectedNow(): number {
  if (!relay) return 0
  const on = IOT_CHANNELS.filter((c) => enabled[c.id]).length
  return on * LED_A
}

function ledStates(estLit: number): Record<ChannelId, LedState> {
  // 실측은 LED별 전류가 없으므로 "켜진 수"만 앞에서부터 채워 표시
  return Object.fromEntries(
    IOT_CHANNELS.map((c, k) => [
      c.id,
      { ...c, lit: source === 'MOCK' ? mockLit(c.id) : k < estLit, fault: source === 'MOCK' ? (faults[c.id] ?? null) : null },
    ]),
  ) as Record<ChannelId, LedState>
}

function initial(): VillageSnapshot {
  return {
    source,
    connected,
    lastError: null,
    badFrames: 0,
    lastPacketAt: null,
    packets: 0,
    relay,
    relayPending: null,
    v: NOMINAL_V,
    i: LED_A * 5,
    p: NOMINAL_V * LED_A * 5,
    expected: LED_A * 5,
    score: 0,
    status: 'NORMAL',
    estLit: 5,
    leds: ledStates(5),
    history: [],
    events: [],
    faults: {},
    supplyFault: null,
    scenario: null,
    thresholds: { ...THRESHOLDS },
  }
}

let snap: VillageSnapshot = initial()

function emit(patch: Partial<VillageSnapshot> = {}) {
  const estLit = patch.estLit ?? snap.estLit
  snap = {
    ...snap,
    ...patch,
    source,
    connected,
    lastError,
    badFrames,
    relay,
    relayPending,
    leds: ledStates(estLit),
    faults: { ...faults },
    supplyFault,
    scenario: scenario && { ...scenario },
    thresholds: { ...THRESHOLDS },
  }
  listeners.forEach((l) => l())
}

function advanceScenario() {
  if (!scenario || source !== 'MOCK' || t % 4 !== 0) return
  scenario.hour = (scenario.hour + 1) % 24
  const max = Math.max(...scenario.profile)
  const n = Math.round((scenario.profile[scenario.hour] / max) * IOT_CHANNELS.length)
  IOT_CHANNELS.forEach((c, k) => (enabled[c.id] = k < n))
}

function tick() {
  t++
  advanceScenario()
  const now = Date.now()
  // 실측: 최근 2초 안에 받은 프레임이 없으면 데이터 없음 (정전으로 판정하지 않음)
  const stale = source === 'SERIAL' && (!latest || now - latest.at > 2000)
  if (!connected || stale) return emit({ status: 'NO_DATA' })

  const { v, i } = source === 'SERIAL' ? latest!.frame : mockMeasure()
  const expected = expectedNow()
  const score = anomalyScore(v, i, expected)
  const status = classify(v, i, score, relay)
  const estLit = Math.max(0, Math.min(IOT_CHANNELS.length, Math.round(i / LED_A)))
  const point: IotPoint = { t: now, v, i, expected, score }

  const events = [...snap.events]
  const open = events.findIndex((e) => e.clearedAt === null)
  if (isAbnormal(status) && open < 0) {
    events.unshift({
      id: ++eventSeq,
      source,
      at: new Date(now).toISOString(),
      injected: source === 'MOCK' ? (supplyFault ?? Object.values(faults)[0] ?? null) : null,
      injectedAt: lastInjectedAt,
      status,
      maxScore: score,
      relayOn: relay,
      expected,
      window: snap.history.slice(-20).map(({ p: _p, ...h }) => h).concat(point),
      clearedAt: null,
      caseId: null,
    })
  } else if (open >= 0) {
    const e = events[open]
    events[open] = {
      ...e,
      status: isAbnormal(status) && RANK[status] > RANK[e.status] ? status : e.status,
      maxScore: Math.max(e.maxScore, score),
      window: [...e.window, point].slice(-80),
      clearedAt: isAbnormal(status) ? null : new Date(now).toISOString(),
    }
  }

  emit({
    v,
    i,
    p: v * i,
    expected,
    score,
    status,
    estLit,
    lastPacketAt: source === 'SERIAL' ? latest!.at : now,
    packets: snap.packets + 1,
    history: [...snap.history, { t: now, v, i, p: v * i, expected, score }].slice(-HISTORY),
    events: events.slice(0, 40),
  })
}

function subscribe(l: () => void) {
  listeners.add(l)
  if (!timer) {
    tick()
    timer = setInterval(tick, TICK_MS)
  }
  return () => {
    listeners.delete(l)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function useVillage(): VillageSnapshot {
  return useSyncExternalStore(subscribe, () => snap)
}

function fail(message: string) {
  lastError = message
  emit()
}

/** 웹 → 장치 릴레이 명령 (마을 전체 전원). 장치가 보고한 상태로 확인될 때까지 '전송 중'. */
export function setRelay(on: boolean) {
  if (!connected) return
  relayPending = on
  lastError = null
  clearTimeout(commandTimer)
  emit()
  if (source === 'SERIAL') {
    link?.write(`RELAY ${on ? 1 : 0}`).catch((e: Error) => fail(`명령 전송 실패: ${e.message}`))
    commandTimer = setTimeout(() => {
      if (relayPending === null) return
      relayPending = null
      fail('릴레이 명령에 장치가 응답하지 않았습니다.')
    }, 2000)
    return
  }
  commandTimer = setTimeout(() => {
    relay = on
    relayPending = null
    emit()
  }, COMMAND_LATENCY_MS)
}

function onSerialLine(line: string) {
  const frame = parseFrame(line)
  if (!frame) {
    badFrames++
    return
  }
  latest = { at: Date.now(), frame }
  relay = frame.relay
  if (relayPending === relay) {
    relayPending = null
    clearTimeout(commandTimer)
  }
}

/** 실제 모형 연결 (브라우저가 포트 선택 창을 띄움) */
export async function connectSerial() {
  const next = await openSerial(onSerialLine, (reason) => {
    link = null
    connected = false
    fail(reason)
  })
  await link?.close()
  link = next
  source = 'SERIAL'
  connected = true
  latest = null
  badFrames = 0
  lastError = null
  scenario = null
  IOT_CHANNELS.forEach((c) => (enabled[c.id] = true))
  clearFault()
  emit({ history: [] })
}

/** 시뮬레이터로 전환 */
export async function switchToMock() {
  await link?.close()
  link = null
  source = 'MOCK'
  connected = true
  lastError = null
  emit({ history: [] })
}

/** 고장 주입 (Mock 전용). LED 위치 고장은 id, 전원 고장은 id 무시 */
export function injectFault(id: ChannelId, kind: FaultKind) {
  if (source !== 'MOCK') return
  if (FAULT_AT_LED[kind]) faults[id] = kind
  else supplyFault = kind
  lastInjectedAt = new Date().toISOString()
  emit()
}

export function clearFault(id?: ChannelId) {
  if (id) delete faults[id]
  else {
    for (const k of Object.keys(faults)) delete faults[k as ChannelId]
    supplyFault = null
  }
  emit()
}

export function clearSupplyFault() {
  supplyFault = null
  emit()
}

/** 시뮬레이터 연결 끊김 재현 (Mock 전용) */
export function setConnected(on: boolean) {
  if (source !== 'MOCK') return
  connected = on
  emit()
}

/** 공공데이터 시간대 패턴으로 켜진 부하 수를 바꿔 재생 (시뮬레이터 전용) */
export function startScenario(label: string, profile: number[]) {
  if (source !== 'MOCK') return
  // 전원이 끊긴 채로는 켜지는 LED 수가 장면에 보이지 않으므로 재생과 함께 전력 복구
  clearTimeout(commandTimer)
  relay = true
  relayPending = null
  connected = true
  scenario = { label, profile, hour: -1 }
  t = 3 // 다음 tick에서 바로 0시 적용
  emit()
}

export function stopScenario() {
  scenario = null
  IOT_CHANNELS.forEach((c) => (enabled[c.id] = true))
  emit()
}

export function linkEventToCase(eventId: number, caseId: string) {
  snap = { ...snap, events: snap.events.map((e) => (e.id === eventId ? { ...e, caseId } : e)) }
  listeners.forEach((l) => l())
}

/** 3D·목록에서 LED 하나를 어떻게 보여줄지 (상태 색 + 짧은 설명) */
export function lightView(led: LedState, snap: VillageSnapshot): { status: NodeStatus; text: string } {
  if (snap.status === 'NO_DATA') return { status: 'NO_DATA', text: '데이터 없음' }
  if (led.fault) return { status: led.fault === 'OPEN' ? 'WARNING' : 'FAULT', text: FAULT_LABEL[led.fault] }
  if (!snap.relay) return led.lit ? { status: 'FAULT', text: '차단했는데 켜짐' } : { status: 'OFF', text: '차단됨' }
  if (snap.status === 'OUTAGE') return { status: 'OUTAGE', text: '정전' }
  if (!led.lit) return { status: 'OFF', text: snap.scenario ? '꺼짐 · 시나리오' : snap.source === 'SERIAL' ? '꺼짐 (추정)' : '꺼짐' }
  // 전체 전류 이상(LED 하나가 끊긴 경우 등)이 멀쩡한 LED의 색까지 바꾸면 고장 난 곳을 구분할 수 없으므로, 전원 쪽 고장일 때만 전체 색을 따른다
  const status = snap.supplyFault && (snap.status === 'WARNING' || snap.status === 'FAULT') ? snap.status : 'NORMAL'
  return { status, text: snap.source === 'SERIAL' ? '켜짐 (추정)' : '켜짐' }
}

/** 집·가로등이 상황에 따라 하는 말. 정전이나 고장일 때만 나옴 */
const HOUSE_LINES = {
  outage: ['큰일났다! 정전이야! 😱', '불이 다 꺼졌어요! 😰', '냉장고 어떡해… 😭'],
  noPower: ['전기가 안 들어와요! 😱', '갑자기 캄캄해졌어요 😨', '누가 전기 좀 살려줘요 🆘'],
  open: ['우리 집 불만 나갔어요! 😭', '내 전구가 끊어졌어요 💡'],
  ground: ['찌릿! 전기가 이상해요 ⚡', '무서워요, 전기가 새는 것 같아요 😨'],
  sag: ['불빛이 어두워졌어요 😟', '전기가 약해졌어요… 🥺'],
  stuck: ['정전이라더니 불이 켜져 있네? 🤔', '차단됐다는데 왜 켜져 있죠? 😮'],
  sleep: ['쿨쿨… 자는 중 😴', '불 끄고 자요 🌙'],
}
const LAMP_LINES = {
  outage: ['캄캄해요… 🌑', '가로등도 꺼졌어요 😢'],
  open: ['내 전구가 나갔어요 💡'],
  ground: ['깜빡깜빡… ⚡'],
  sag: ['어두워졌어요 😟'],
}

export function speech(led: LedState, snap: VillageSnapshot): string | null {
  if (snap.status === 'NO_DATA') return null
  const house = led.kind === 'HOUSE'
  const pick = (arr: string[]) => arr[led.ch % arr.length]
  const L = (house ? HOUSE_LINES : LAMP_LINES) as Record<string, string[] | undefined>
  if (led.fault === 'OPEN') return pick(L.open ?? [])
  if (led.fault === 'GROUND') return pick(L.ground ?? [])
  if (snap.supplyFault === 'STUCK' && !snap.relay) return house ? pick(HOUSE_LINES.stuck) : null
  if (!snap.relay) return pick(L.outage ?? [])
  if (snap.supplyFault === 'OUTAGE') return house ? pick(HOUSE_LINES.noPower) : pick(LAMP_LINES.outage)
  if (snap.supplyFault === 'SAG') return pick(L.sag ?? [])
  // 공공데이터 시나리오로 꺼진 집은 잠든 것으로 표현
  if (snap.scenario && house && !led.lit) return pick(HOUSE_LINES.sleep)
  return null
}
