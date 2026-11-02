import { Line, RoundedBox } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { CatmullRomCurve3, TubeGeometry, Vector3, type Mesh } from 'three'
import { LOAD_LINES, NET_COLOR, NETS, PART_BY_ID, pinLabel, splitPin, type ChPartId, type Net, type NetKind, type PartId, type PinRef } from '../../lib/hardware'
import { contactClosed, FAULT_LABEL, type ChannelId, type VillageSnapshot } from '../../lib/village'
import Label from '../three/Label'
import { BOX_FLOOR, type V3 } from './layout'
import { ARDUINO_PIN, ARDUINO_SIZE, arduinoTexture, INA_SIZE, inaTexture, RELAY_SIZE, relayTexture } from './textures'

// 바닥판 내부 배선. 부품을 한 줄로 늘어놓지 않고 상자 안에 자유롭게 흩어 놓았다(살짝씩 돌려 손으로 놓은 느낌).
// 선은 핀에서 올라와 부드러운 호를 그리며 건너가고, 선 종류마다 높이를 달리해 겹쳐도 구분된다.
// LED는 220Ω 저항과 함께 판 위에 실제 부품으로 놓여 상태(켜짐·꺼짐·고장)에 따라 빛난다.

const Y = BOX_FLOOR
/** 전체 릴레이·채널 릴레이는 RELAY_SIZE 기준 모듈을 줄여서 사용 */
const MASTER_SIZE = { w: 3.5, d: 1.9 }
const CH_SIZE = { w: 2.6, d: 2.2 }
const MASTER_SCALE: [number, number, number] = [MASTER_SIZE.w / RELAY_SIZE.w, 1, MASTER_SIZE.d / RELAY_SIZE.d]
const CH_SCALE: [number, number, number] = [CH_SIZE.w / RELAY_SIZE.w, 1, CH_SIZE.d / RELAY_SIZE.d]

interface Place {
  x: number
  z: number
  /** 위에서 본 회전(라디안) */
  rot: number
  w: number
  d: number
  top: number
}
const at = (x: number, z: number, rot: number, w: number, d: number, top = 0.35): Place => ({ x, z, rot, w, d, top })

/** 부품 위치: 왼쪽 위 어댑터 → 전체 릴레이 → 가운데 아래 Arduino → INA219 → 오른쪽 채널 릴레이 */
export const PLACE: Record<PartId, Place> = {
  adapter: at(-19.5, -9, 0.1, 3.2, 2.0, 0.9),
  relay: at(-13, -3.5, -0.14, MASTER_SIZE.w, MASTER_SIZE.d),
  arduino: at(-8.5, 8, -0.1, ARDUINO_SIZE.w, ARDUINO_SIZE.d),
  inaH: at(-1.5, 4.5, 0.08, INA_SIZE.w, INA_SIZE.d),
  inaL: at(-1.2, -8.5, -0.06, INA_SIZE.w, INA_SIZE.d),
  ch1: at(5.5, 3, 0.12, CH_SIZE.w, CH_SIZE.d),
  ch2: at(11, 6.5, -0.07, CH_SIZE.w, CH_SIZE.d),
  ch3: at(17, 4, 0.1, CH_SIZE.w, CH_SIZE.d),
  ch4: at(6.5, -10, -0.1, CH_SIZE.w, CH_SIZE.d),
  ch5: at(13.5, -7.5, 0.08, CH_SIZE.w, CH_SIZE.d),
}

/** LED 놓는 판(저항 + LED) 중심. 각 채널 릴레이 앞쪽 */
const STATION: Record<ChannelId, { x: number; z: number; rot: number }> = {
  h1: { x: 5.2, z: 12.3, rot: 0.06 },
  h2: { x: 11.2, z: 14.4, rot: -0.05 },
  h3: { x: 17.4, z: 12.2, rot: 0.08 },
  l1: { x: 8, z: -2.4, rot: -0.07 },
  l2: { x: 15, z: -1.4, rot: 0.05 },
}
/** 공통 GND 버스바 (LED − 를 모아 Arduino GND로 한 줄) */
const BUS = {
  house: { x: 11.3, z: 16.7, len: 15 },
  lamp: { x: 11.5, z: 0.9, len: 12 },
}
const LED_BUS = (led: ChannelId) => (led === 'l1' || led === 'l2' ? BUS.lamp : BUS.house)

/** 릴레이 모듈 핀 로컬 좌표 [x, z] (전체 릴레이 기준 좌표를 모듈 크기에 맞게 줄임) */
function relayPins(id: PartId, sx: number, sz: number) {
  const k = (x: number, z: number): [number, number] => [x * sx, z * sz]
  PIN_LOCAL[`${id}.VCC`] = k(-2.25, -0.55)
  PIN_LOCAL[`${id}.GND`] = k(-2.25, 0)
  PIN_LOCAL[`${id}.IN`] = k(-2.25, 0.55)
  PIN_LOCAL[`${id}.NO`] = k(2.1, -0.4)
  PIN_LOCAL[`${id}.COM`] = k(2.1, 0)
  PIN_LOCAL[`${id}.NC`] = k(2.1, 0.4)
}

/** 핀 로컬 좌표 [x, z] */
const PIN_LOCAL: Record<string, [number, number]> = {
  'adapter.+': [1.15, -0.2],
  'adapter.−': [1.15, 0.2],
  'arduino.D2': [ARDUINO_PIN.digitalX(13), ARDUINO_PIN.headerZ.back],
  'arduino.D3': [ARDUINO_PIN.digitalX(12), ARDUINO_PIN.headerZ.back],
  'arduino.D4': [ARDUINO_PIN.digitalX(11), ARDUINO_PIN.headerZ.back],
  'arduino.D5': [ARDUINO_PIN.digitalX(10), ARDUINO_PIN.headerZ.back],
  'arduino.D6': [ARDUINO_PIN.digitalX(9), ARDUINO_PIN.headerZ.back],
  'arduino.D7': [ARDUINO_PIN.digitalX(8), ARDUINO_PIN.headerZ.back],
  'arduino.5V': [ARDUINO_PIN.powerX(3), ARDUINO_PIN.headerZ.front],
  'arduino.GND': [ARDUINO_PIN.powerX(4), ARDUINO_PIN.headerZ.front],
  'arduino.A4': [ARDUINO_PIN.analogX(4), ARDUINO_PIN.headerZ.front],
  'arduino.A5': [ARDUINO_PIN.analogX(5), ARDUINO_PIN.headerZ.front],
}
relayPins('relay', MASTER_SCALE[0], MASTER_SCALE[2])
for (const id of ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'] as const) relayPins(id, CH_SCALE[0], CH_SCALE[2])
for (const id of ['inaH', 'inaL'] as const) {
  PIN_LOCAL[`${id}.VCC`] = [-0.95, 0.82]
  PIN_LOCAL[`${id}.GND`] = [-0.57, 0.82]
  PIN_LOCAL[`${id}.SCL`] = [-0.19, 0.82]
  PIN_LOCAL[`${id}.SDA`] = [0.19, 0.82]
  PIN_LOCAL[`${id}.VIN+`] = [-0.2, -0.55]
  PIN_LOCAL[`${id}.VIN−`] = [0.2, -0.55]
}

/** 부품 로컬 좌표를 부품의 회전·위치로 옮김 */
function toWorld(p: { x: number; z: number; rot: number }, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.rot)
  const s = Math.sin(p.rot)
  return [p.x + lx * c + lz * s, p.z - lx * s + lz * c]
}

export function pinWorld(ref: PinRef): V3 {
  const [part] = splitPin(ref)
  const p = PLACE[part]
  const [lx, lz] = PIN_LOCAL[ref] ?? [0, 0]
  const [x, z] = toWorld(p, lx, lz)
  return [x, Y + p.top + 0.1, z]
}

export function partCenter(id: PartId): V3 {
  return [PLACE[id].x, Y + PLACE[id].top, PLACE[id].z]
}

// ── LED 놓는 판: 저항(220Ω) → LED, LED − 는 GND 버스로 ─────
const LED_Y = Y + 0.42
function stationPins(led: ChannelId) {
  const s = STATION[led]
  const at2 = (lx: number): V3 => {
    const [x, z] = toWorld(s, lx, 0)
    return [x, LED_Y, z]
  }
  return { resIn: at2(-1.5), resOut: at2(-0.4), anode: at2(0.42), cathode: at2(0.68), led: at2(0.55) }
}
const busPoint = (led: ChannelId, x: number): V3 => {
  const b = LED_BUS(led)
  return [Math.min(b.x + b.len / 2 - 0.4, Math.max(b.x - b.len / 2 + 0.4, x)), Y + 0.52, b.z]
}

// ── 배선 경로: 부드러운 호 ─────────────────────────────────
const LIFT: Record<NetKind, number> = { power: 0, gnd: 0.35, ctrl: 0.7, sda: 1.05, scl: 1.35, ledPlus: 0.2, ledMinus: 0.5 }
const hash = (s: string) => {
  let h = 2166136261
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h >>> 0) % 1000) / 1000
}
function v(x: number, y: number, z: number) {
  return new Vector3(x, y, z)
}
/** a → b를 옆으로 살짝 휘고 위로 솟는 호로 잇는다. 거리가 멀수록 높이 솟음 */
function arc(a: V3, b: V3, seed: string, kind: NetKind): Vector3[] {
  const dx = b[0] - a[0]
  const dz = b[2] - a[2]
  const D = Math.max(0.01, Math.hypot(dx, dz))
  const nx = -dz / D
  const nz = dx / D
  const bow = (hash(seed) - 0.5) * Math.min(D * 0.3, 5.5)
  const lift = Math.min(0.5 + D * 0.11, 3.0) + LIFT[kind] + hash(seed + 'y') * 0.3
  const pts: Vector3[] = [v(...a), v(a[0], a[1] + 0.45, a[2])]
  for (const t of [0.22, 0.5, 0.78]) {
    const s = Math.sin(Math.PI * t)
    pts.push(v(a[0] + dx * t + nx * bow * s, a[1] + (b[1] - a[1]) * t + lift * Math.pow(s, 0.85), a[2] + dz * t + nz * bow * s))
  }
  pts.push(v(b[0], b[1] + 0.45, b[2]), v(...b))
  return pts
}

// ── 공통 부품 요소 ───────────────────────────────────────
function Pcb({ id, map, children }: { id: PartId; map: ReturnType<typeof arduinoTexture>; children?: ReactNode }) {
  const p = PLACE[id]
  return (
    <group position={[p.x, Y, p.z]} rotation={[0, p.rot, 0]}>
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sz) => (
          <mesh key={`${sx}${sz}`} position={[(sx * (p.w - 0.35)) / 2, 0.125, (sz * (p.d - 0.35)) / 2]}>
            <cylinderGeometry args={[0.08, 0.08, 0.25, 8]} />
            <meshStandardMaterial color="#c9c9c9" metalness={0.6} roughness={0.4} />
          </mesh>
        )),
      )}
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[p.w, 0.1, p.d]} />
        <meshStandardMaterial color="#112233" roughness={0.6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.351, 0]}>
        <planeGeometry args={[p.w, p.d]} />
        <meshStandardMaterial map={map} roughness={0.55} />
      </mesh>
      <group position={[0, 0.35, 0]}>{children}</group>
    </group>
  )
}

/** 핀 헤더 줄 */
function Header({ x0, z, n, pitch = 0.255, female = false }: { x0: number; z: number; n: number; pitch?: number; female?: boolean }) {
  const len = n * pitch
  return (
    <group position={[x0 + ((n - 1) * pitch) / 2, 0, z]}>
      <mesh position={[0, female ? 0.22 : 0.1, 0]}>
        <boxGeometry args={[len + 0.05, female ? 0.44 : 0.2, 0.24]} />
        <meshStandardMaterial color="#17181b" roughness={0.6} />
      </mesh>
      {Array.from({ length: n }, (_, k) => (
        <mesh key={k} position={[-len / 2 + pitch * (k + 0.5), female ? 0.445 : 0.32, 0]}>
          <boxGeometry args={[0.07, female ? 0.01 : 0.24, 0.07]} />
          <meshStandardMaterial color={female ? '#000000' : '#d8b34a'} metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
    </group>
  )
}

/** 파란 나사 단자대 */
function Terminal({ x, z, n, along = 'z' }: { x: number; z: number; n: number; along?: 'x' | 'z' }) {
  const len = n * 0.4
  const size: [number, number, number] = along === 'z' ? [0.55, 0.45, len] : [len, 0.45, 0.55]
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.225, 0]}>
        <boxGeometry args={size} />
        <meshStandardMaterial color="#2357c6" roughness={0.45} />
      </mesh>
      {Array.from({ length: n }, (_, k) => {
        const o = (k - (n - 1) / 2) * 0.4
        return (
          <group key={k} position={along === 'z' ? [0, 0.455, o] : [o, 0.455, 0]}>
            <mesh>
              <cylinderGeometry args={[0.13, 0.13, 0.02, 16]} />
              <meshStandardMaterial color="#c4c8ce" metalness={0.85} roughness={0.25} />
            </mesh>
            <mesh position={[0, 0.012, 0]} rotation={[0, Math.PI / 4, 0]}>
              <boxGeometry args={[0.2, 0.01, 0.035]} />
              <meshStandardMaterial color="#555555" />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

function Smd({ x, z, w, d, color = '#141414', h = 0.08 }: { x: number; z: number; w: number; d: number; color?: string; h?: number }) {
  return (
    <mesh position={[x, h / 2, z]}>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={color} roughness={0.4} />
    </mesh>
  )
}

function Led({ x, z, on, color }: { x: number; z: number; on: boolean; color: string }) {
  return (
    <mesh position={[x, 0.05, z]}>
      <boxGeometry args={[0.16, 0.08, 0.1]} />
      <meshStandardMaterial color={on ? color : '#3a3a3a'} emissive={color} emissiveIntensity={on ? 3.5 : 0} toneMapped={false} />
    </mesh>
  )
}

// ── 부품 ────────────────────────────────────────────────
function Adapter({ ok }: { ok: boolean }) {
  const p = PLACE.adapter
  return (
    <group position={[p.x, Y, p.z]} rotation={[0, p.rot, 0]}>
      {/* 어댑터에서 오는 케이블 (상자 밖에서 들어옴) */}
      <mesh position={[-2.6, 0.18, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.13, 0.13, 2.2, 12]} />
        <meshStandardMaterial color="#1b1c1f" roughness={0.6} />
      </mesh>
      {/* DC 플러그 */}
      <RoundedBox args={[1.5, 0.55, 0.55]} radius={0.12} position={[-0.95, 0.28, 0]}>
        <meshStandardMaterial color="#1b1c1f" roughness={0.5} />
      </RoundedBox>
      <mesh position={[-0.1, 0.28, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.2, 0.2, 0.3, 16]} />
        <meshStandardMaterial color="#c9ccd1" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* DC 잭 → 나사 단자 어댑터 */}
      <mesh position={[0.6, 0.3, 0]}>
        <boxGeometry args={[0.9, 0.6, 1.1]} />
        <meshStandardMaterial color="#202226" roughness={0.5} />
      </mesh>
      <group position={[0, 0.45, 0]}>
        <Terminal x={1.15} z={0} n={2} />
      </group>
      <Label lines={[ok ? '5V' : '0V']} position={[1.15, 1.35, -0.55]} lineHeight={0.18} color="#ffffff" bg={ok ? 'rgba(214,58,47,0.9)' : 'rgba(110,116,128,0.9)'} />
    </group>
  )
}

function Relay({ id, on, scale, redLed = true }: { id: PartId; on: boolean; scale: [number, number, number]; redLed?: boolean }) {
  const map = useMemo(() => relayTexture(), [])
  return (
    <Pcb id={id} map={map}>
      <group scale={scale}>
      {/* 릴레이 본체 */}
      <mesh position={[-0.15, 0.6, 0]}>
        <boxGeometry args={[1.9, 1.2, 1.55]} />
        <meshStandardMaterial color="#1f5fd1" roughness={0.3} />
      </mesh>
      <Terminal x={2.1} z={0} n={3} />
      {[-0.55, 0, 0.55].map((z) => (
        <group key={z}>
          <mesh position={[-2.25, 0.12, z]}>
            <boxGeometry args={[0.24, 0.24, 0.24]} />
            <meshStandardMaterial color="#17181b" />
          </mesh>
          <mesh position={[-2.25, 0.3, z]}>
            <boxGeometry args={[0.07, 0.24, 0.07]} />
            <meshStandardMaterial color="#d8b34a" metalness={0.7} roughness={0.3} />
          </mesh>
        </group>
      ))}
      <Smd x={-1.55} z={-0.9} w={0.35} d={0.2} color="#2b2b2b" />
      <Smd x={-1.6} z={0.85} w={0.45} d={0.3} color="#1e1e1e" />
      <Led x={-1.15} z={-0.95} on={on && redLed} color="#ff4040" />
      <Led x={-1.15} z={0.95} on color="#40ff70" />
      </group>
    </Pcb>
  )
}

function Arduino({ blink }: { blink: boolean }) {
  const map = useMemo(() => arduinoTexture(), [])
  return (
    <Pcb id="arduino" map={map}>
      {/* USB-B, DC 잭 */}
      <mesh position={[-2.75, 0.4, -1.25]}>
        <boxGeometry args={[1.2, 0.8, 0.95]} />
        <meshStandardMaterial color="#c9ccd1" metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[-2.8, 0.38, 1.35]}>
        <boxGeometry args={[1.1, 0.75, 0.7]} />
        <meshStandardMaterial color="#141414" roughness={0.6} />
      </mesh>
      {/* 헤더 */}
      <Header x0={ARDUINO_PIN.digitalX(0)} z={ARDUINO_PIN.headerZ.back} n={16} female />
      <Header x0={ARDUINO_PIN.powerX(0)} z={ARDUINO_PIN.headerZ.front} n={7} female />
      <Header x0={ARDUINO_PIN.analogX(0)} z={ARDUINO_PIN.headerZ.front} n={6} female />
      {/* ATmega328P DIP, 16U2, 크리스탈, 리셋 버튼, 전해 캐패시터 */}
      <Smd x={1.3} z={0.9} w={2.5} d={0.55} h={0.25} />
      {Array.from({ length: 14 }, (_, k) => (
        <group key={k}>
          <Smd x={0.2 + k * 0.17} z={0.58} w={0.05} d={0.1} h={0.12} color="#c9ccd1" />
          <Smd x={0.2 + k * 0.17} z={1.22} w={0.05} d={0.1} h={0.12} color="#c9ccd1" />
        </group>
      ))}
      <Smd x={-1.5} z={-0.95} w={0.5} d={0.5} />
      <Smd x={-0.7} z={-0.4} w={0.45} d={0.18} color="#c9ccd1" h={0.15} />
      <mesh position={[-2.1, 0.12, -0.15]}>
        <boxGeometry args={[0.4, 0.2, 0.4]} />
        <meshStandardMaterial color="#c9ccd1" metalness={0.8} />
      </mesh>
      <mesh position={[-2.1, 0.25, -0.15]}>
        <cylinderGeometry args={[0.1, 0.1, 0.1, 12]} />
        <meshStandardMaterial color="#b02020" />
      </mesh>
      {[-1.9, -1.4].map((x) => (
        <mesh key={x} position={[x, 0.3, 1.0]}>
          <cylinderGeometry args={[0.2, 0.2, 0.6, 14]} />
          <meshStandardMaterial color="#1c1c1c" roughness={0.4} />
        </mesh>
      ))}
      <Led x={-1.05} z={-0.95} on color="#40ff70" />
      <Led x={-0.35} z={-1.2} on={blink} color="#ffcc33" />
    </Pcb>
  )
}

function Ina219({ id }: { id: PartId }) {
  const map = useMemo(() => inaTexture(), [])
  return (
    <Pcb id={id} map={map}>
      <Terminal x={0} z={-0.55} n={2} along="x" />
      <Header x0={-0.95} z={0.82} n={6} pitch={0.38} />
      {/* 션트 저항 R100, INA219 칩 */}
      <Smd x={0.25} z={0.15} w={0.55} d={0.3} color="#2a2a2a" h={0.1} />
      <Smd x={-0.6} z={0.15} w={0.35} d={0.35} />
    </Pcb>
  )
}

// ── 배선 ────────────────────────────────────────────────
function Wire({
  points,
  color,
  radius = 0.05,
  dim = false,
  onHover,
  onLeave,
}: {
  points: Vector3[]
  color: string
  radius?: number
  dim?: boolean
  onHover?: (e: ThreeEvent<PointerEvent>) => void
  onLeave?: () => void
}) {
  const geo = useMemo(() => new TubeGeometry(new CatmullRomCurve3(points, false, 'centripetal'), 64, radius, 8, false), [points, radius])
  return (
    <mesh geometry={geo} onPointerOver={onHover} onPointerMove={onHover} onPointerOut={onLeave}>
      <meshStandardMaterial color={color} roughness={0.4} transparent={dim} opacity={dim ? 0.15 : 1} />
    </mesh>
  )
}

/** 선 위를 흐르는 전류·신호 */
function Flow({ curves, color, speed = 0.3, size = 0.08 }: { curves: CatmullRomCurve3[]; color: string; speed?: number; size?: number }) {
  const refs = useRef<(Mesh | null)[]>([])
  const phase = useRef(Math.random())
  const N = 5
  useFrame((_, dt) => {
    phase.current = (phase.current + dt * speed) % 1
    curves.forEach((c, ci) => {
      for (let k = 0; k < N; k++) {
        const m = refs.current[ci * N + k]
        if (m) m.position.copy(c.getPointAt((phase.current + k / N) % 1))
      }
    })
  })
  return (
    <>
      {curves.flatMap((_, ci) =>
        Array.from({ length: N }, (_, k) => (
          <mesh key={`${ci}-${k}`} ref={(m) => void (refs.current[ci * N + k] = m)}>
            <sphereGeometry args={[size, 10, 10]} />
            <meshBasicMaterial color={color} toneMapped={false} />
          </mesh>
        )),
      )}
    </>
  )
}


// ── LED 놓는 판 (220Ω 저항 + LED) ────────────────────────
const RES_BANDS: [number, string][] = [[-0.34, '#c0392b'], [-0.16, '#c0392b'], [0.02, '#6b3f1d'], [0.3, '#d4af37']]

function ledLook(snap: VillageSnapshot, id: ChannelId) {
  const led = snap.leds[id]
  if (snap.status === 'NO_DATA') return { core: '#555a62', glow: 0, text: '데이터 없음', bg: 'rgba(110,116,128,0.9)' }
  if (led.fault === 'GROUND') return { core: '#ff5252', glow: 1, text: `${FAULT_LABEL.GROUND}`, bg: 'rgba(207,52,52,0.92)' }
  if (led.fault === 'OPEN') return { core: '#3a3d42', glow: 0, text: `${FAULT_LABEL.OPEN} · 소등`, bg: 'rgba(184,100,0,0.92)' }
  if (!snap.relay && !led.lit) return { core: '#555a62', glow: 0, text: '마을 정전 · 소등', bg: 'rgba(110,116,128,0.9)' }
  if (!led.channelOn) return { core: '#555a62', glow: 0, text: '채널 OFF · 소등', bg: 'rgba(110,116,128,0.9)' }
  if (led.lit) return { core: '#ffd35a', glow: 1, text: '켜짐', bg: 'rgba(168,106,0,0.92)' }
  return { core: '#7a6a45', glow: 0, text: '전류 없음 · 소등', bg: 'rgba(184,100,0,0.92)' }
}

function LedStation({ id, snap, showLabel }: { id: ChannelId; snap: VillageSnapshot; showLabel: boolean }) {
  const s = STATION[id]
  const line = LOAD_LINES.find((l) => l.led === id)!
  const look = ledLook(snap, id)
  return (
    <group position={[s.x, Y, s.z]} rotation={[0, s.rot, 0]}>
      <RoundedBox args={[4.4, 0.24, 1.9]} radius={0.08} position={[0, 0.12, 0]}>
        <meshStandardMaterial color="#efe9dc" roughness={0.7} />
      </RoundedBox>
      {/* 220Ω 저항 (빨강·빨강·갈색·금색 띠) */}
      <group position={[-0.95, 0.42, 0]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.17, 0.17, 1.05, 14]} />
          <meshStandardMaterial color="#d9c9a5" roughness={0.6} />
        </mesh>
        {RES_BANDS.map(([x, c]) => (
          <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.176, 0.176, 0.07, 14]} />
            <meshStandardMaterial color={c} roughness={0.5} />
          </mesh>
        ))}
        <mesh position={[-0.75, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.03, 0.03, 0.5, 6]} />
          <meshStandardMaterial color="#c9ccd1" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0.75, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.03, 0.03, 0.5, 6]} />
          <meshStandardMaterial color="#c9ccd1" metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
      {/* LED */}
      <group position={[0.55, 0.24, 0]}>
        {[-0.13, 0.13].map((x) => (
          <mesh key={x} position={[x, 0.18, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.36, 6]} />
            <meshStandardMaterial color="#c9ccd1" metalness={0.8} roughness={0.3} />
          </mesh>
        ))}
        <mesh position={[0, 0.52, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.32, 18]} />
          <meshStandardMaterial color={look.core} transparent opacity={0.9} emissive={look.core} emissiveIntensity={look.glow ? 2.4 : 0.1} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.68, 0]}>
          <sphereGeometry args={[0.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          <meshStandardMaterial color={look.core} transparent opacity={0.92} emissive={look.core} emissiveIntensity={look.glow ? 2.8 : 0.1} toneMapped={false} />
        </mesh>
        {look.glow > 0 && (
          <mesh position={[0, 0.62, 0]}>
            <sphereGeometry args={[0.95, 16, 12]} />
            <meshBasicMaterial color={look.core} transparent opacity={0.2} depthWrite={false} toneMapped={false} />
          </mesh>
        )}
      </group>
      {showLabel && (
        <Label lines={[`${line.name} · LED ${line.ledNo}`, `220Ω · ${look.text}`]} position={[0, 1.9, 0.2]} bg={look.bg} lineHeight={0.36} />
      )}
    </group>
  )
}

/** 구리색 공통 GND 버스바 */
function BusBar({ bus, name }: { bus: { x: number; z: number; len: number }; name: string }) {
  return (
    <group position={[bus.x, Y, bus.z]}>
      <mesh position={[0, 0.2, 0]}>
        <boxGeometry args={[bus.len + 0.8, 0.4, 0.9]} />
        <meshStandardMaterial color="#e9e3d3" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.46, 0]}>
        <boxGeometry args={[bus.len, 0.14, 0.34]} />
        <meshStandardMaterial color="#b4764a" metalness={0.8} roughness={0.35} />
      </mesh>
      <Label lines={[name]} position={[bus.len / 2 + 1.6, 0.6, 0]} bg="rgba(20,22,27,0.86)" lineHeight={0.3} />
    </group>
  )
}

function PartOutline({ id, color }: { id: PartId; color: string }) {
  const p = PLACE[id]
  const pad = 0.25
  const y = Y + 0.03
  const hw = p.w / 2 + pad
  const hd = p.d / 2 + pad
  const c = ([[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd], [-hw, -hd]] as [number, number][]).map(([lx, lz]) => {
    const [x, z] = toWorld(p, lx, lz)
    return [x, y, z] as V3
  })
  return <Line points={c} color={color} lineWidth={2.5} />
}

/** 부품 이름표 아래 한 줄 */
function partReadout(id: PartId, snap: VillageSnapshot): string {
  if (id === 'inaH' || id === 'inaL') {
    const z = snap.zones?.[id === 'inaH' ? 'HOUSE' : 'LAMP']
    return z ? `${z.v.toFixed(2)} V · ${z.i.toFixed(3)} A` : `${snap.v.toFixed(2)} V · ${snap.i.toFixed(3)} A`
  }
  if (id === 'relay') return `D2 ${snap.relay ? 'LOW' : 'HIGH'} · ${contactClosed(snap) ? '공급' : '차단'}${snap.supplyFault === 'STUCK' ? ' (고착)' : ''}`
  const line = LOAD_LINES.find((l) => l.board === id)
  if (line) return `${PART_BY_ID[id].pins.IN.match(/D\d/)?.[0] ?? ''} ${snap.channels[line.led] ? 'ON' : 'OFF'}`
  return PART_BY_ID[id].role
}

// ── 장면 ────────────────────────────────────────────────
export default function Underground({
  snap,
  night,
  selectedPart,
  onPart,
  showPins,
}: {
  snap: VillageSnapshot
  night: boolean
  selectedPart: PartId | null
  onPart: (id: PartId | null) => void
  showPins: boolean
}) {
  const [hoverPart, setHoverPart] = useState<PartId | null>(null)
  const [hoverWire, setHoverWire] = useState<{ text: string; point: V3 } | null>(null)
  const supplyOk = snap.supplyFault !== 'OUTAGE' && snap.status !== 'NO_DATA'
  const powered = contactClosed(snap) && supplyOk
  const connected = snap.connected && snap.status !== 'NO_DATA'

  const nets = useMemo(
    () =>
      NETS.map((n) => {
        const points = arc(pinWorld(n.a), pinWorld(n.b), n.id, n.kind)
        return { net: n, points, curve: new CatmullRomCurve3(points, false, 'centripetal') }
      }),
    [],
  )

  // LED 쪽 선: 릴레이 NO → 저항 → LED → GND 버스 → Arduino GND
  const loads = useMemo(
    () =>
      LOAD_LINES.map((l) => {
        const p = stationPins(l.led)
        const plus = arc(pinWorld(`${l.board}.NO` as PinRef), p.resIn, `${l.led}+`, 'ledPlus')
        const link = arc(p.resOut, p.anode, `${l.led}~`, 'ledPlus')
        const minus = arc(p.cathode, busPoint(l.led, p.cathode[0]), `${l.led}-`, 'ledMinus')
        return { line: l, plus, link, minus, curve: new CatmullRomCurve3(plus, false, 'centripetal') }
      }),
    [],
  )
  const trunks = useMemo(
    () =>
      (['house', 'lamp'] as const).map((k) => {
        const b = BUS[k]
        return { key: k, points: arc([b.x - b.len / 2 - 0.2, Y + 0.52, b.z], pinWorld('arduino.GND'), `bus-${k}`, 'gnd') }
      }),
    [],
  )

  const related = (n: Net) => !selectedPart || n.a.startsWith(`${selectedPart}.`) || n.b.startsWith(`${selectedPart}.`)
  const loadRelated = (board: ChPartId) => !selectedPart || selectedPart === board || selectedPart === 'arduino'
  const curveOf = (id: string) => nets.find((n) => n.net.id === id)!.curve

  const partProps = (id: PartId) => ({
    onClick: (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      onPart(selectedPart === id ? null : id)
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation()
      setHoverPart(id)
      document.body.style.cursor = 'pointer'
    },
    onPointerOut: () => {
      setHoverPart((h) => (h === id ? null : h))
      document.body.style.cursor = ''
    },
  })

  const wireHover = (text: string) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    setHoverWire({ text, point: [e.point.x, e.point.y + 0.6, e.point.z] })
  }
  const wireLeave = () => setHoverWire(null)

  const pinsToShow = (Object.keys(PIN_LOCAL) as PinRef[]).filter((ref) => showPins || splitPin(ref)[0] === selectedPart)
  const ids = Object.keys(PLACE) as PartId[]

  return (
    <group>
      {/* 부품 */}
      <group {...partProps('adapter')}><Adapter ok={supplyOk} /></group>
      <group {...partProps('relay')}><Relay id="relay" on={!snap.relay && snap.supplyFault !== 'STUCK'} scale={MASTER_SCALE} /></group>
      <group {...partProps('arduino')}><Arduino blink={connected && snap.packets % 2 === 0} /></group>
      <group {...partProps('inaH')}><Ina219 id="inaH" /></group>
      <group {...partProps('inaL')}><Ina219 id="inaL" /></group>
      {LOAD_LINES.map((l) => (
        <group key={l.board} {...partProps(l.board)}><Relay id={l.board} on={snap.channels[l.led]} scale={CH_SCALE} /></group>
      ))}

      {/* LED (저항 포함) + GND 버스바 */}
      {LOAD_LINES.map((l) => (
        <LedStation key={l.led} id={l.led} snap={snap} showLabel={loadRelated(l.board)} />
      ))}
      <BusBar bus={BUS.house} name="공통 GND" />
      <BusBar bus={BUS.lamp} name="공통 GND" />

      {/* 강조 테두리 */}
      {hoverPart && hoverPart !== selectedPart && <PartOutline id={hoverPart} color="#9fb6f5" />}
      {selectedPart && <PartOutline id={selectedPart} color="#3157e0" />}

      {/* 배선 */}
      {nets.map(({ net, points }) => (
        <Wire
          key={net.id}
          points={points}
          color={NET_COLOR[net.kind]}
          radius={net.kind === 'power' || net.kind === 'gnd' ? 0.06 : 0.045}
          dim={!related(net)}
          onHover={wireHover(`${pinLabel(net.a)} → ${pinLabel(net.b)} · ${net.signal}`)}
          onLeave={wireLeave}
        />
      ))}
      {loads.map(({ line, plus, link, minus }) => {
        const dim = !loadRelated(line.board)
        return (
          <group key={line.led}>
            <Wire points={plus} color={NET_COLOR.ledPlus} radius={0.045} dim={dim} onHover={wireHover(`${PART_BY_ID[line.board].name} NO → 220Ω 저항 → ${line.name} LED ${line.ledNo} (+)`)} onLeave={wireLeave} />
            <Wire points={link} color={NET_COLOR.ledPlus} radius={0.04} dim={dim} onHover={wireHover(`220Ω 저항 → ${line.name} LED ${line.ledNo} (+)`)} onLeave={wireLeave} />
            <Wire points={minus} color={NET_COLOR.ledMinus} radius={0.04} dim={dim} onHover={wireHover(`${line.name} LED ${line.ledNo} (−) → 공통 GND`)} onLeave={wireLeave} />
          </group>
        )
      })}
      {trunks.map((t) => (
        <Wire key={t.key} points={t.points} color={NET_COLOR.gnd} radius={0.07} dim={!!selectedPart && selectedPart !== 'arduino'} onHover={wireHover('공통 GND 버스 → Arduino GND')} onLeave={wireLeave} />
      ))}

      {/* 전류·신호 흐름 */}
      {/* 전류 점은 회로가 닫혀 흐를 때만. 릴레이가 열리면 어댑터 쪽 선에 전압은 있어도 전류는 없음 */}
      {powered && <Flow curves={['n-supply', 'n-sw-h', 'n-sw-l', ...LOAD_LINES.filter((l) => snap.channels[l.led]).map((l) => `n-meas-${l.board}`)].map(curveOf)} color="#ffd43b" />}
      {powered && <Flow curves={loads.filter((l) => snap.leds[l.line.led].lit).map((l) => l.curve)} color="#ffb347" speed={0.4} />}
      {connected && !snap.relay && <Flow curves={[curveOf('n-d2')]} color="#69db7c" speed={0.25} size={0.06} />}
      {connected && <Flow curves={LOAD_LINES.filter((l) => snap.channels[l.led]).map((l) => curveOf(`n-d${l.led === 'h1' ? 3 : l.led === 'h2' ? 4 : l.led === 'h3' ? 5 : l.led === 'l1' ? 6 : 7}`))} color="#69db7c" speed={0.25} size={0.06} />}
      {connected && <Flow curves={['n-sda-h', 'n-sda-l', 'n-scl-h', 'n-scl-l'].map(curveOf)} color="#a5d8ff" speed={0.9} size={0.05} />}

      {/* 부품 이름 (앞쪽). 확대 중에는 패널이 대신 보여줌 */}
      {!selectedPart && ids.map((id, k) => (
        <Label
          key={id}
          lines={[PART_BY_ID[id].name, partReadout(id, snap)]}
          position={[PLACE[id].x, Y + 0.7, PLACE[id].z + PLACE[id].d / 2 + 1.3 + (k % 2) * 0.9]}
          bg="rgba(20,22,27,0.86)"
          lineHeight={0.5}
        />
      ))}

      {/* 핀 이름 */}
      {pinsToShow.map((ref, k) => {
        const p = pinWorld(ref)
        // 이웃한 핀 이름이 겹치지 않게 앞뒤로 엇갈려 배치
        const stagger = k % 2 === 0 ? 0.3 : 0.62
        return <Label key={ref} lines={[splitPin(ref)[1]]} position={[p[0], p[1] + 0.35, p[2] + stagger]} bg="rgba(255,255,255,0.94)" color="#14161b" lineHeight={selectedPart ? 0.16 : 0.24} />
      })}

      {hoverWire && <Label lines={[hoverWire.text]} position={hoverWire.point} bg="rgba(20,22,27,0.92)" pointer lineHeight={selectedPart ? 0.24 : 0.4} />}

      {night && <ambientLight intensity={0.9} color="#ffe9c7" />}
    </group>
  )
}
