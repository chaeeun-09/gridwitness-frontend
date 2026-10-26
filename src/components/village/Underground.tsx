import { Line, RoundedBox } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { memo, useMemo, useRef, useState, type ReactNode } from 'react'
import { CatmullRomCurve3, TubeGeometry, Vector3, type Mesh } from 'three'
import { LOAD_LINES, NET_COLOR, NETS, PART_BY_ID, pinLabel, splitPin, type Net, type PartId, type PinRef } from '../../lib/hardware'
import { contactClosed, type ChannelId, type VillageSnapshot } from '../../lib/village'
import Label from '../three/Label'
import { BOX_FLOOR, PART_Z, type V3 } from './layout'
import { ARDUINO_PIN, ARDUINO_SIZE, arduinoTexture, breadboardTexture, INA_SIZE, inaTexture, RELAY_SIZE, relayTexture } from './textures'

// 바닥판 내부 배선 — 도면 "1. 바닥판 내부 전체 사진(위에서 본 모습)" 배치 그대로.
// 왼쪽부터 5V 어댑터 → 릴레이 → Arduino → INA219 → 브레드보드 1(분배) → 2(주택 LED) → 3(가로등 LED).
// 배선은 뒤쪽 배선 통로로 묶여 지나가고, LED 선은 천장 관통부로 올라가 건물 안 LED(220Ω 포함)에 연결됨.

const Y = BOX_FLOOR
const BB = { w: 5.4, d: 3.6 }

/** 부품 중심 x, 크기, 윗면 높이(바닥 기준) */
export const PLACE: Record<PartId, { x: number; w: number; d: number; top: number }> = {
  adapter: { x: -19.2, w: 3.2, d: 2.0, top: 0.9 },
  relay: { x: -13.4, ...RELAY_SIZE, top: 0.35 },
  arduino: { x: -6.2, ...ARDUINO_SIZE, top: 0.35 },
  ina219: { x: -0.8, ...INA_SIZE, top: 0.35 },
  bb1: { x: 4.8, ...BB, top: 0.45 },
  bb2: { x: 11.0, ...BB, top: 0.45 },
  bb3: { x: 17.2, ...BB, top: 0.45 },
}

/** LED 단자쌍 위치 (브레드보드 로컬 x) */
const TERMINAL_X: Record<ChannelId, number> = { h1: -1.8, h2: 0, h3: 1.8, l1: -1.1, l2: 1.1 }
const TERMINAL_Z = -0.45
const RAIL_P = -1.67
const RAIL_N = -1.36

/** 핀 로컬 좌표 [x, z] */
const PIN_LOCAL: Record<string, [number, number]> = {
  'adapter.+': [1.15, -0.2],
  'adapter.−': [1.15, 0.2],
  'relay.VCC': [-2.25, -0.55],
  'relay.GND': [-2.25, 0],
  'relay.IN': [-2.25, 0.55],
  'relay.NO': [2.1, -0.4],
  'relay.COM': [2.1, 0],
  'relay.NC': [2.1, 0.4],
  'arduino.D2': [ARDUINO_PIN.digitalX(13), ARDUINO_PIN.headerZ.back],
  'arduino.5V': [ARDUINO_PIN.powerX(3), ARDUINO_PIN.headerZ.front],
  'arduino.GND': [ARDUINO_PIN.powerX(4), ARDUINO_PIN.headerZ.front],
  'arduino.A4': [ARDUINO_PIN.analogX(4), ARDUINO_PIN.headerZ.front],
  'arduino.A5': [ARDUINO_PIN.analogX(5), ARDUINO_PIN.headerZ.front],
  'ina219.VCC': [-0.95, 0.82],
  'ina219.GND': [-0.57, 0.82],
  'ina219.SCL': [-0.19, 0.82],
  'ina219.SDA': [0.19, 0.82],
  'ina219.VIN+': [-0.2, -0.55],
  'ina219.VIN−': [0.2, -0.55],
}
for (const b of ['bb1', 'bb2', 'bb3'] as const) {
  PIN_LOCAL[`${b}.+in`] = [-2.5, RAIL_P]
  PIN_LOCAL[`${b}.−in`] = [-2.5, RAIL_N]
  PIN_LOCAL[`${b}.+out`] = [2.5, RAIL_P]
  PIN_LOCAL[`${b}.−out`] = [2.5, RAIL_N]
}
for (const l of LOAD_LINES) {
  PIN_LOCAL[`${l.board}.${l.led}+`] = [TERMINAL_X[l.led] - 0.2, TERMINAL_Z]
  PIN_LOCAL[`${l.board}.${l.led}−`] = [TERMINAL_X[l.led] + 0.2, TERMINAL_Z]
}

export function pinWorld(ref: PinRef): V3 {
  const [part] = splitPin(ref)
  const p = PLACE[part]
  const [lx, lz] = PIN_LOCAL[ref] ?? [0, 0]
  return [p.x + lx, Y + p.top + 0.1, PART_Z + lz]
}

export function partCenter(id: PartId): V3 {
  return [PLACE[id].x, Y + PLACE[id].top, PART_Z]
}

// ── 배선 경로 ───────────────────────────────────────────
const LANE_Z = PART_Z - 3.1 // 뒤쪽 배선 통로
const EXIT_Z = PART_Z - 5.4 // 천장 관통부
const LANE_ORDER: Net['kind'][] = ['power', 'gnd', 'ctrl', 'sda', 'scl']

function v(x: number, y: number, z: number) {
  return new Vector3(x, y, z)
}

/** 핀 → 위로 → 배선 통로 → 옆으로 → 상대 핀 */
function laneRoute(a: V3, b: V3, lane: number, k: number): Vector3[] {
  const z = LANE_Z - lane * 0.16 - k * 0.04
  const h = Y + 1.0 + lane * 0.05
  const dir = Math.sign(b[0] - a[0]) || 1
  return [
    v(...a),
    v(a[0], a[1] + 0.35, a[2]),
    v(a[0], h, a[2] + (z - a[2]) * 0.35),
    v(a[0] + dir * 0.4, h, z),
    v(b[0] - dir * 0.4, h, z),
    v(b[0], h, b[2] + (z - b[2]) * 0.35),
    v(b[0], b[1] + 0.35, b[2]),
    v(...b),
  ]
}

/** LED 단자 → 천장 관통부 (위로 올라가 건물 안 LED로) */
function exitPoint(led: ChannelId, sign: 1 | -1): V3 {
  const l = LOAD_LINES.find((x) => x.led === led)!
  return [PLACE[l.board].x + TERMINAL_X[led] + sign * 0.09, Y + 2.4, EXIT_Z]
}
function loadRoute(a: V3, top: V3): Vector3[] {
  return [v(...a), v(a[0], a[1] + 0.4, a[2]), v(a[0], Y + 1.2, (a[2] + top[2]) / 2 + 0.6), v(top[0], Y + 1.3, top[2] + 0.4), v(...top)]
}

// ── 공통 부품 요소 ───────────────────────────────────────
function Pcb({ id, map, children }: { id: PartId; map: ReturnType<typeof arduinoTexture>; children?: ReactNode }) {
  const p = PLACE[id]
  return (
    <group position={[p.x, Y, PART_Z]}>
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
    <group position={[p.x, Y, PART_Z]}>
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

function Relay({ on }: { on: boolean }) {
  const map = useMemo(() => relayTexture(), [])
  return (
    <Pcb id="relay" map={map}>
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
      <Led x={-1.15} z={-0.95} on={on} color="#ff4040" />
      <Led x={-1.15} z={0.95} on color="#40ff70" />
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

function Ina219() {
  const map = useMemo(() => inaTexture(), [])
  return (
    <Pcb id="ina219" map={map}>
      <Terminal x={0} z={-0.55} n={2} along="x" />
      <Header x0={-0.95} z={0.82} n={6} pitch={0.38} />
      {/* 션트 저항 R100, INA219 칩 */}
      <Smd x={0.25} z={0.15} w={0.55} d={0.3} color="#2a2a2a" h={0.1} />
      <Smd x={-0.6} z={0.15} w={0.35} d={0.35} />
    </Pcb>
  )
}

function Breadboard({ id, children }: { id: PartId; children?: ReactNode }) {
  const tex = useMemo(() => breadboardTexture(), [])
  const p = PLACE[id]
  return (
    <group position={[p.x, Y, PART_Z]}>
      <mesh position={[0, p.top / 2, 0]}>
        <boxGeometry args={[p.w, p.top, p.d]} />
        <meshStandardMaterial color="#f1efe9" roughness={0.7} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, p.top + 0.001, 0]}>
        <planeGeometry args={[p.w, p.d]} />
        <meshStandardMaterial map={tex} roughness={0.7} />
      </mesh>
      <group position={[0, p.top, 0]}>{children}</group>
    </group>
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

/** 레일 → 단자 브레드보드 내부 점퍼 (빨강 +, 검정 −) */
function Jumper({ from, to, color }: { from: [number, number]; to: [number, number]; color: string }) {
  const pts = useMemo(() => [v(from[0], 0.02, from[1]), v((from[0] + to[0]) / 2, 0.35, (from[1] + to[1]) / 2), v(to[0], 0.02, to[1])], [from, to])
  return <Wire points={pts} color={color} radius={0.035} />
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

/** 배선 통로의 케이블 클립 + 천장 관통부 레일 */
const Clips = memo(function Clips() {
  return (
    <>
      {Array.from({ length: 9 }, (_, k) => -20 + k * 5).map((x) => (
        <group key={x} position={[x, Y, LANE_Z - 0.35]}>
          <mesh position={[0, 0.03, 0]}>
            <boxGeometry args={[0.5, 0.06, 1.3]} />
            <meshStandardMaterial color="#e9ecef" roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.65, 0]}>
            <torusGeometry args={[0.62, 0.06, 6, 18, Math.PI]} />
            <meshStandardMaterial color="#e9ecef" roughness={0.5} />
          </mesh>
        </group>
      ))}
      <mesh position={[(PLACE.bb2.x + PLACE.bb3.x) / 2, Y + 0.05, EXIT_Z]}>
        <boxGeometry args={[12.5, 0.1, 0.6]} />
        <meshStandardMaterial color="#9c7546" roughness={0.8} />
      </mesh>
    </>
  )
})

function PartOutline({ id, color }: { id: PartId; color: string }) {
  const p = PLACE[id]
  const pad = 0.25
  const y = Y + 0.03
  const x0 = p.x - p.w / 2 - pad
  const x1 = p.x + p.w / 2 + pad
  const z0 = PART_Z - p.d / 2 - pad
  const z1 = PART_Z + p.d / 2 + pad
  return <Line points={[[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [x0, y, z0]]} color={color} lineWidth={2.5} />
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

  const nets = useMemo(() => {
    const laneCount: Record<string, number> = {}
    return NETS.map((n) => {
      const lane = LANE_ORDER.indexOf(n.kind)
      const k = (laneCount[n.kind] = (laneCount[n.kind] ?? -1) + 1)
      const points = laneRoute(pinWorld(n.a), pinWorld(n.b), lane, k)
      return { net: n, points, curve: new CatmullRomCurve3(points, false, 'centripetal') }
    })
  }, [])

  const loads = useMemo(
    () =>
      LOAD_LINES.map((l) => {
        const plus = loadRoute(pinWorld(`${l.board}.${l.led}+` as PinRef), exitPoint(l.led, -1))
        const minus = loadRoute(pinWorld(`${l.board}.${l.led}−` as PinRef), exitPoint(l.led, 1))
        return { line: l, plus, minus, curve: new CatmullRomCurve3(plus, false, 'centripetal') }
      }),
    [],
  )

  const related = (n: Net) => !selectedPart || n.a.startsWith(`${selectedPart}.`) || n.b.startsWith(`${selectedPart}.`)
  const loadRelated = (board: PartId) => !selectedPart || selectedPart === board
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

  return (
    <group>
      {/* 부품 */}
      <group {...partProps('adapter')}><Adapter ok={supplyOk} /></group>
      <group {...partProps('relay')}><Relay on={contactClosed(snap)} /></group>
      <group {...partProps('arduino')}><Arduino blink={connected && snap.packets % 2 === 0} /></group>
      <group {...partProps('ina219')}><Ina219 /></group>
      <group {...partProps('bb1')}>
        <Breadboard id="bb1">
          <Jumper from={[-1.5, RAIL_P]} to={[-1.5, 1.65]} color="#d63a2f" />
          <Jumper from={[1.5, RAIL_N]} to={[1.5, 1.34]} color="#1f2125" />
        </Breadboard>
      </group>
      {(['bb2', 'bb3'] as const).map((b) => (
        <group key={b} {...partProps(b)}>
          <Breadboard id={b}>
            {LOAD_LINES.filter((l) => l.board === b).map((l) => {
              const x = TERMINAL_X[l.led]
              return (
                <group key={l.led}>
                  <Terminal x={x} z={TERMINAL_Z} n={2} along="x" />
                  <Jumper from={[x - 0.2, RAIL_P]} to={[x - 0.2, TERMINAL_Z - 0.3]} color="#d63a2f" />
                  <Jumper from={[x + 0.2, RAIL_N]} to={[x + 0.2, TERMINAL_Z - 0.3]} color="#1f2125" />
                </group>
              )
            })}
          </Breadboard>
        </group>
      ))}
      <Clips />

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
      {loads.map(({ line, plus, minus }) => {
        const led = snap.leds[line.led]
        const ex = exitPoint(line.led, 1)[0] - 0.09
        return (
          <group key={line.led}>
            <Wire points={plus} color={NET_COLOR.ledPlus} radius={0.045} dim={!loadRelated(line.board)} onHover={wireHover(`${PART_BY_ID[line.board].name} 단자 → ${line.name} LED ${line.ledNo} (+) · 220Ω는 건물 안`)} onLeave={wireLeave} />
            <Wire points={minus} color={NET_COLOR.ledMinus} radius={0.045} dim={!loadRelated(line.board)} onHover={wireHover(`${line.name} LED ${line.ledNo} (−) → ${PART_BY_ID[line.board].name} − 레일`)} onLeave={wireLeave} />
            {/* 천장 관통부 */}
            <mesh position={[ex, Y + 0.12, EXIT_Z]} rotation={[-Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.24, 0.07, 8, 20]} />
              <meshStandardMaterial color="#2a2c31" />
            </mesh>
            {loadRelated(line.board) && <Label
              lines={[`↑ ${line.name}`, `LED ${line.ledNo} · ${led.fault ? '고장' : led.lit ? '켜짐' : '꺼짐'}`]}
              position={[ex, Y + 3.1, EXIT_Z - 0.4]}
              bg={led.fault ? 'rgba(207,52,52,0.92)' : led.lit ? 'rgba(168,106,0,0.92)' : 'rgba(110,116,128,0.88)'}
              lineHeight={selectedPart ? 0.24 : 0.36}
            />}
          </group>
        )
      })}

      {/* 전류·신호 흐름 */}
      {supplyOk && <Flow curves={[curveOf('n-supply')]} color="#ffd43b" />}
      {powered && <Flow curves={['n-switched', 'n-measured', 'n-bb12p', 'n-bb23p'].map(curveOf)} color="#ffd43b" />}
      {powered && <Flow curves={loads.filter((l) => snap.leds[l.line.led].lit).map((l) => l.curve)} color="#ffb347" speed={0.4} />}
      {connected && snap.relay && <Flow curves={[curveOf('n-d2')]} color="#69db7c" speed={0.25} size={0.06} />}
      {connected && <Flow curves={[curveOf('n-sda'), curveOf('n-scl')]} color="#a5d8ff" speed={0.9} size={0.05} />}

      {/* 부품 이름 (앞쪽). 확대 중에는 패널이 대신 보여줌 */}
      {!selectedPart && (Object.keys(PLACE) as PartId[]).map((id) => (
        <Label
          key={id}
          lines={[PART_BY_ID[id].name, id === 'ina219' ? `${snap.v.toFixed(2)} V · ${snap.i.toFixed(3)} A` : id === 'relay' ? `D2 ${snap.relay ? 'HIGH' : 'LOW'} · ${contactClosed(snap) ? '닫힘' : '열림'}${snap.supplyFault === 'STUCK' ? ' (고착)' : ''}` : PART_BY_ID[id].role]}
          position={[PLACE[id].x, Y + 0.6, PART_Z + PLACE[id].d / 2 + 1.25]}
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
