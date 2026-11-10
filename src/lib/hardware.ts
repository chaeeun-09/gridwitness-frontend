// 마을 모형 바닥판 내부 부품·핀·배선 (최종 구성도 기준).
// 표(설정 > 회로 구성)와 3D 지하 배선 보기가 같은 데이터를 씀.

import type { ChannelId } from './village'

// 채널 릴레이 구성 (도면 기준)
//   5V 어댑터 → 전체 릴레이(D2, COM→NC) ┬→ INA219 ① 0x40 → 채널 릴레이 ①②③ (D3·D4·D5) → 주택 1~3 LED
//                                        └→ INA219 ② 0x41 → 채널 릴레이 ④⑤ (D6·D7)      → 가로등 1~2 LED
//   Arduino: A4 SDA · A5 SCL (INA219 두 개 공통).
//   빵판의 +/− 레일이 모든 모듈의 전원(5V)과 접지(GND)를 나눠 준다. LED의 − 선도 빵판 GND 레일로 모은다.

export type ChPartId = 'ch1' | 'ch2' | 'ch3' | 'ch4' | 'ch5'
export type PartId = 'adapter' | 'relay' | 'arduino' | 'bb' | 'inaH' | 'inaL' | ChPartId
export type NetKind = 'power' | 'gnd' | 'ctrl' | 'sda' | 'scl' | 'ledPlus' | 'ledMinus'

export interface Part {
  id: PartId
  name: string
  role: string
  spec: string
  /** 핀 이름 → 설명 */
  pins: Record<string, string>
}

const CH_PARTS: { id: ChPartId; led: ChannelId; ledNo: number; name: string; pin: string; zone: 'inaH' | 'inaL' }[] = [
  { id: 'ch1', led: 'h1', ledNo: 1, name: '주택 1', pin: 'D3', zone: 'inaH' },
  // 실제 배선에서 주택 2·3이 서로 바뀌어 있음 (village.ts IOT_CHANNELS 와 같게: 채널 ② D4 = 주택 3, 채널 ③ D5 = 주택 2)
  { id: 'ch2', led: 'h3', ledNo: 3, name: '주택 3', pin: 'D4', zone: 'inaH' },
  { id: 'ch3', led: 'h2', ledNo: 2, name: '주택 2', pin: 'D5', zone: 'inaH' },
  { id: 'ch4', led: 'l1', ledNo: 4, name: '가로등 1', pin: 'D6', zone: 'inaL' },
  { id: 'ch5', led: 'l2', ledNo: 5, name: '가로등 2', pin: 'D7', zone: 'inaL' },
]

const inaPins = {
  VCC: '센서 전원 5V',
  GND: 'GND',
  SCL: 'I2C 클럭 (두 INA219 공통)',
  SDA: 'I2C 데이터 (두 INA219 공통)',
  'VIN+': '측정 입력 (전체 릴레이 쪽)',
  'VIN−': '측정 출력 (채널 릴레이 쪽)',
}

/** 빵판 + 레일 구멍(모듈 전원용) */
const chPart = (id: ChPartId) => ({ id: id as PartId, name: `${CH_PARTS.find((c) => c.id === id)!.name} 채널 릴레이` })
// 구멍 순서는 모듈이 놓인 위치(왼쪽→오른쪽)와 맞춰서 선이 엇갈리지 않게 한다
const BB_MODULES: { id: PartId; name: string }[] = [
  { id: 'relay', name: '전체 릴레이' },
  chPart('ch1'),
  chPart('ch2'),
  { id: 'inaH', name: 'INA219 ①' },
  chPart('ch3'),
  chPart('ch4'),
  { id: 'inaL', name: 'INA219 ②' },
  chPart('ch5'),
]
const BB_PLUS_PINS: Record<string, string> = Object.fromEntries(BB_MODULES.map((m, k) => [`+${k + 1}`, `${m.name} 전원`]))
/** 빵판 − 레일 구멍: 모듈 GND 8개 + LED − 5개 */
const BB_MINUS_PINS: Record<string, string> = {
  ...Object.fromEntries(BB_MODULES.map((m, k) => [`−${k + 1}`, `${m.name} GND`])),
  ...Object.fromEntries(CH_PARTS.map((c, k) => [`−${BB_MODULES.length + k + 1}`, `${c.name} LED −`])),
}
/** LED 하나의 − 선이 꽂히는 빵판 − 레일 구멍 */
export const LED_GND_HOLE: Record<ChannelId, string> = Object.fromEntries(CH_PARTS.map((c, k) => [c.led, `−${BB_MODULES.length + k + 1}`])) as Record<ChannelId, string>

export const PARTS: Part[] = [
  {
    id: 'adapter',
    name: '5V DC 어댑터',
    role: '마을 전체 전원 공급',
    spec: '5V 2A · DC 잭 → 나사 단자 어댑터',
    pins: { '+': '5V 출력', '−': '0V (GND)' },
  },
  {
    id: 'relay',
    name: '전체 릴레이 (1채널)',
    role: '마을 전체 전원 ON/OFF (정전 발생·복구)',
    spec: '5V 코일 · COM→NC 사용 (코일이 꺼져 있을 때 전원이 들어감)',
    pins: { IN: '제어 입력 (D2)', VCC: '모듈 전원 5V', GND: '모듈 GND', COM: '공통 접점 (5V 입력)', NO: '평상시 열림 (사용 안 함)', NC: '평상시 닫힘 → 두 INA219 입력 (사용)' },
  },
  {
    id: 'arduino',
    name: 'Arduino UNO R3',
    role: '릴레이 6개 제어 · INA219 2개 측정 · 웹 통신',
    spec: 'ATmega328P · USB(Web Serial 115200)',
    pins: { D2: '전체 릴레이 제어', D3: '채널 ① 주택 1', D4: '채널 ② 주택 3', D5: '채널 ③ 주택 2', D6: '채널 ④ 가로등 1', D7: '채널 ⑤ 가로등 2', '5V': '릴레이·INA219 전원 공급', GND: '공통 GND', A4: 'I2C SDA', A5: 'I2C SCL', USB: '노트북 연결 (전원·통신)' },
  },
  {
    id: 'bb',
    name: '빵판 (전원·접지 레일)',
    role: '5V와 GND를 모든 모듈에 나눠 주는 배분판',
    spec: '+ 레일 = Arduino 5V · − 레일 = GND (어댑터 −, LED −도 여기로 모음)',
    pins: { '+in': '+ 레일 입력 (Arduino 5V)', '−in': '− 레일 입력 (Arduino GND · 어댑터 −)', ...BB_PLUS_PINS, ...BB_MINUS_PINS },
  },
  {
    id: 'inaH',
    name: 'INA219 ① 주택 구간',
    role: '주택 1~3 구간 전압·전류 측정',
    spec: 'I2C 0x40 · 션트 0.1Ω · 최대 3.2A',
    pins: inaPins,
  },
  {
    id: 'inaL',
    name: 'INA219 ② 가로등 구간',
    role: '가로등 1~2 구간 전압·전류 측정',
    spec: 'I2C 0x41 · 션트 0.1Ω · 최대 3.2A',
    pins: inaPins,
  },
  ...CH_PARTS.map(
    (c, k): Part => ({
      id: c.id,
      name: `채널 릴레이 ${'①②③④⑤'[k]} (${c.name})`,
      role: `${c.name} LED ${c.ledNo} 켜기·끄기`,
      spec: `1채널 릴레이 · ${c.pin} 제어 · COM→NO 사용 (코일이 켜져야 LED가 켜짐)`,
      pins: { IN: `제어 입력 (${c.pin})`, VCC: '모듈 전원 5V', GND: '모듈 GND', COM: `공통 접점 (${c.zone === 'inaH' ? 'INA219 ①' : 'INA219 ②'} 출력)`, NO: `${c.name} LED + (코일이 켜지면 연결)`, NC: '평상시 닫힘 (사용 안 함)' },
    }),
  ),
]

export const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p])) as Record<PartId, Part>

/** 핀 참조: "부품.핀" */
export type PinRef = `${PartId}.${string}`

export interface Net {
  id: string
  a: PinRef
  b: PinRef
  kind: NetKind
  signal: string
}

const pins = (id: string, a: PinRef, b: PinRef, kind: NetKind, signal: string): Net => ({ id, a, b, kind, signal })

export const NETS: Net[] = [
  pins('n-supply', 'adapter.+', 'relay.COM', 'power', '5V 입력'),
  pins('n-sw-h', 'relay.NC', 'inaH.VIN+', 'power', '전체 릴레이를 거친 5V → 주택 구간'),
  pins('n-sw-l', 'relay.NC', 'inaL.VIN+', 'power', '전체 릴레이를 거친 5V → 가로등 구간'),
  ...CH_PARTS.map((c) => pins(`n-meas-${c.id}`, `${c.zone}.VIN−`, `${c.id}.COM`, 'power', `측정을 거친 5V → ${c.name} 채널 릴레이`)),
  pins('n-5v-bb', 'arduino.5V', 'bb.+in', 'power', 'Arduino 5V → 빵판 + 레일'),
  pins('n-gnd-bb', 'arduino.GND', 'bb.−in', 'gnd', 'Arduino GND → 빵판 − 레일'),
  pins('n-gnd-supply', 'adapter.−', 'bb.−in', 'gnd', '어댑터 − → 빵판 − 레일 (전원부·제어부 공통 접지)'),
  ...BB_MODULES.map((m, k) => pins(`n-vcc-${m.id}`, `bb.+${k + 1}` as PinRef, `${m.id}.VCC` as PinRef, 'power', `${m.name} 전원 (빵판 + 레일)`)),
  ...BB_MODULES.map((m, k) => pins(`n-gnd-${m.id}`, `bb.−${k + 1}` as PinRef, `${m.id}.GND` as PinRef, 'gnd', `${m.name} GND (빵판 − 레일)`)),
  pins('n-d2', 'arduino.D2', 'relay.IN', 'ctrl', 'D2 제어 신호 (마을 전체)'),
  ...CH_PARTS.map((c) => pins(`n-${c.pin.toLowerCase()}`, `arduino.${c.pin}` as PinRef, `${c.id}.IN`, 'ctrl', `${c.pin} 제어 신호 (${c.name})`)),
  pins('n-sda-h', 'arduino.A4', 'inaH.SDA', 'sda', 'I2C 데이터 (SDA) → INA219 ①'),
  pins('n-sda-l', 'inaH.SDA', 'inaL.SDA', 'sda', 'I2C 데이터 (SDA) INA219 ① → ②로 이어서'),
  pins('n-scl-h', 'arduino.A5', 'inaH.SCL', 'scl', 'I2C 클럭 (SCL) → INA219 ①'),
  pins('n-scl-l', 'inaH.SCL', 'inaL.SCL', 'scl', 'I2C 클럭 (SCL) INA219 ① → ②로 이어서'),
]

/** 채널 릴레이 → 집·가로등 내부 LED (LED마다 220Ω 저항이 직렬로 붙음). LED +는 릴레이 NO, LED −는 공통 GND */
export interface LoadLine {
  led: ChannelId
  board: ChPartId
  ledNo: number
  name: string
}
export const LOAD_LINES: LoadLine[] = CH_PARTS.map((c) => ({ led: c.led, board: c.id, ledNo: c.ledNo, name: c.name }))

/** 도면 '7. 배선 색상 규칙' */
export const NET_COLOR: Record<NetKind, string> = {
  power: '#d63a2f',
  gnd: '#1f2125',
  ctrl: '#2f9e44',
  sda: '#2f62d6',
  scl: '#e8b400',
  ledPlus: '#f0771f',
  ledMinus: '#7c828c',
}
export const NET_KIND_LABEL: Record<NetKind, string> = {
  power: '빨간색 · 5V 전원 (+)',
  gnd: '검정색 · GND (−)',
  ctrl: '초록색 · D2~D7 (릴레이 제어)',
  sda: '파란색 · SDA (INA219)',
  scl: '노란색 · SCL (INA219)',
  ledPlus: '주황색 · LED (+)',
  ledMinus: '회색 · LED (−)',
}


export function splitPin(ref: PinRef): [PartId, string] {
  const i = ref.indexOf('.')
  return [ref.slice(0, i) as PartId, ref.slice(i + 1)]
}

export function pinLabel(ref: PinRef): string {
  const [part, pin] = splitPin(ref)
  return `${PART_BY_ID[part].name} ${pin}`
}

/** 부품에 연결된 배선 */
export function netsOf(part: PartId): Net[] {
  return NETS.filter((n) => n.a.startsWith(`${part}.`) || n.b.startsWith(`${part}.`))
}
