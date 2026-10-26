// 마을 모형 바닥판 내부 부품·핀·배선 (최종 구성도 기준).
// 표(설정 > 회로 구성)와 3D 지하 배선 보기가 같은 데이터를 씀.

import type { ChannelId } from './village'

export type PartId = 'adapter' | 'relay' | 'arduino' | 'ina219' | 'bb1' | 'bb2' | 'bb3'
export type NetKind = 'power' | 'gnd' | 'ctrl' | 'sda' | 'scl' | 'ledPlus' | 'ledMinus'

export interface Part {
  id: PartId
  name: string
  role: string
  spec: string
  /** 핀 이름 → 설명 */
  pins: Record<string, string>
}

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
    name: '1채널 릴레이 모듈',
    role: '마을 전체 전원 ON/OFF',
    spec: '5V 코일 · 접점 NO/COM/NC',
    pins: { IN: '제어 입력 (HIGH = 접점 닫힘)', VCC: '모듈 전원 5V', GND: '모듈 GND', COM: '공통 접점 (5V 입력)', NO: '평상시 열림 → 닫히면 출력', NC: '평상시 닫힘 (사용 안 함)' },
  },
  {
    id: 'arduino',
    name: 'Arduino UNO R3',
    role: '릴레이 제어 · INA219 측정 · 웹 통신',
    spec: 'ATmega328P · USB(Web Serial 115200)',
    pins: { D2: '릴레이 제어 출력', '5V': '모듈 전원 공급', GND: '공통 GND', A4: 'I2C SDA', A5: 'I2C SCL', USB: '노트북 연결 (전원·통신)' },
  },
  {
    id: 'ina219',
    name: 'INA219',
    role: '마을 전체 전압·전류 측정',
    spec: 'I2C 0x40 · 션트 0.1Ω · 최대 3.2A',
    pins: { VCC: '센서 전원 5V', GND: 'GND', SCL: 'I2C 클럭', SDA: 'I2C 데이터', 'VIN+': '측정 입력 (릴레이 쪽)', 'VIN−': '측정 출력 (부하 쪽)' },
  },
  {
    id: 'bb1',
    name: '브레드보드 1',
    role: '전원 분배',
    spec: '+ / − 레일',
    pins: { '+in': '+ 레일 입력', '−in': '− 레일 입력', '+out': '+ 레일 출력', '−out': '− 레일 출력' },
  },
  {
    id: 'bb2',
    name: '브레드보드 2',
    role: '주택 3채 LED',
    spec: '나사 단자 3쌍 → 집 내부 LED 1~3',
    pins: { '+in': '+ 레일 입력', '−in': '− 레일 입력', '+out': '+ 레일 출력', '−out': '− 레일 출력', 'h1+': '주택 1 LED +', 'h1−': '주택 1 LED −', 'h2+': '주택 2 LED +', 'h2−': '주택 2 LED −', 'h3+': '주택 3 LED +', 'h3−': '주택 3 LED −' },
  },
  {
    id: 'bb3',
    name: '브레드보드 3',
    role: '가로등 2개 LED',
    spec: '나사 단자 2쌍 → 가로등 내부 LED 4~5',
    pins: { '+in': '+ 레일 입력', '−in': '− 레일 입력', 'l1+': '가로등 1 LED +', 'l1−': '가로등 1 LED −', 'l2+': '가로등 2 LED +', 'l2−': '가로등 2 LED −' },
  },
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

export const NETS: Net[] = [
  { id: 'n-supply', a: 'adapter.+', b: 'relay.COM', kind: 'power', signal: '5V 입력' },
  { id: 'n-switched', a: 'relay.NO', b: 'ina219.VIN+', kind: 'power', signal: '릴레이를 거친 5V' },
  { id: 'n-measured', a: 'ina219.VIN−', b: 'bb1.+in', kind: 'power', signal: '측정을 거친 5V → 분배' },
  { id: 'n-bb12p', a: 'bb1.+out', b: 'bb2.+in', kind: 'power', signal: '5V 분배' },
  { id: 'n-bb23p', a: 'bb2.+out', b: 'bb3.+in', kind: 'power', signal: '5V 분배' },
  { id: 'n-gnd-supply', a: 'adapter.−', b: 'bb1.−in', kind: 'gnd', signal: '전원 GND' },
  { id: 'n-bb12g', a: 'bb1.−out', b: 'bb2.−in', kind: 'gnd', signal: 'GND 분배' },
  { id: 'n-bb23g', a: 'bb2.−out', b: 'bb3.−in', kind: 'gnd', signal: 'GND 분배' },
  { id: 'n-common-gnd', a: 'arduino.GND', b: 'bb1.−in', kind: 'gnd', signal: '공통 접지 (제어부 ↔ 전원부)' },
  { id: 'n-d2', a: 'arduino.D2', b: 'relay.IN', kind: 'ctrl', signal: 'D2 제어 신호' },
  { id: 'n-relay-vcc', a: 'arduino.5V', b: 'relay.VCC', kind: 'power', signal: '릴레이 모듈 전원 (Arduino 5V)' },
  { id: 'n-relay-gnd', a: 'arduino.GND', b: 'relay.GND', kind: 'gnd', signal: '릴레이 모듈 GND' },
  { id: 'n-ina-vcc', a: 'arduino.5V', b: 'ina219.VCC', kind: 'power', signal: 'INA219 전원 (Arduino 5V)' },
  { id: 'n-ina-gnd', a: 'arduino.GND', b: 'ina219.GND', kind: 'gnd', signal: 'INA219 GND' },
  { id: 'n-sda', a: 'arduino.A4', b: 'ina219.SDA', kind: 'sda', signal: 'I2C 데이터 (SDA)' },
  { id: 'n-scl', a: 'arduino.A5', b: 'ina219.SCL', kind: 'scl', signal: 'I2C 클럭 (SCL)' },
]

/** 브레드보드 단자 → 집·가로등 내부 LED (LED와 220Ω 저항은 지면 위 건물 안에 있음) */
export interface LoadLine {
  led: ChannelId
  board: PartId
  ledNo: number
  name: string
}
export const LOAD_LINES: LoadLine[] = [
  { led: 'h1', board: 'bb2', ledNo: 1, name: '주택 1' },
  { led: 'h2', board: 'bb2', ledNo: 2, name: '주택 2' },
  { led: 'h3', board: 'bb2', ledNo: 3, name: '주택 3' },
  { led: 'l1', board: 'bb3', ledNo: 4, name: '가로등 1' },
  { led: 'l2', board: 'bb3', ledNo: 5, name: '가로등 2' },
]

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
  ctrl: '초록색 · D2 (릴레이 제어)',
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
