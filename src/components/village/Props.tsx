import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useRef, useState } from 'react'
import { AdditiveBlending, type Mesh } from 'three'
import type { LedState, NodeStatus } from '../../lib/village'
import Label from '../three/Label'
import SpeechBubble from '../three/SpeechBubble'
import { POLE_H, type V3 } from './layout'
import { glowTexture } from './textures'

/** 라벨에 상태 줄까지 보여줄 상태 (평소엔 이름만) */
const ALARM_STATUS: NodeStatus[] = ['WARNING', 'FAULT', 'OUTAGE']

export const STATUS_COLOR: Record<NodeStatus, string> = {
  NORMAL: '#ffd43b',
  OFF: '#495057',
  NO_DATA: '#868e96',
  WARNING: '#ff922b',
  FAULT: '#ff3b3b',
  OUTAGE: '#495057',
}

// ── 전봇대 ──────────────────────────────────────────────
export const Pole = memo(function Pole({ p, transformer = false }: { p: V3; transformer?: boolean }) {
  return (
    <group position={p}>
      <mesh position={[0, POLE_H / 2, 0]} castShadow>
        <cylinderGeometry args={[0.075, 0.12, POLE_H, 10]} />
        <meshStandardMaterial color="#9a9c9e" roughness={0.8} />
      </mesh>
      <mesh position={[0, POLE_H - 0.25, 0]} castShadow>
        <boxGeometry args={[1.3, 0.09, 0.09]} />
        <meshStandardMaterial color="#5c5f62" metalness={0.5} roughness={0.5} />
      </mesh>
      {[-0.5, 0, 0.5].map((x) => (
        <group key={x} position={[x, POLE_H - 0.12, 0]}>
          {[0, 0.06, 0.12].map((y) => (
            <mesh key={y} position={[0, y - 0.04, 0]}>
              <cylinderGeometry args={[0.055, 0.055, 0.035, 10]} />
              <meshStandardMaterial color="#e8eef2" roughness={0.3} />
            </mesh>
          ))}
        </group>
      ))}
      {transformer && (
        <group position={[0, POLE_H - 1.3, 0.22]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.2, 0.2, 0.55, 14]} />
            <meshStandardMaterial color="#8d9399" metalness={0.6} roughness={0.4} />
          </mesh>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.21, 0.21, 0.05, 14]} />
            <meshStandardMaterial color="#6c737a" metalness={0.6} />
          </mesh>
        </group>
      )}
    </group>
  )
})

// ── FRTU (배전자동화 단말장치) ─────────────────────────
/** 전봇대 중간의 회색 철제 제어함. 마을 계측의 '현장 단말' 역할이라 맥동 고리로 강조하고, 누르면 FRTU 요약 패널이 열림.
 *  name: 라벨 이름, fi: 고장표시가 떠 있는지, dx: 같은 전봇대에 여러 대를 달 때 옆으로 비킬 거리, labelY: 라벨 높이 */
export function Frtu({ p, status, selected, onSelect, name = 'FRTU', fi = false, dx = 0, labelY = 2.7 }: { p: V3; status: NodeStatus; selected: boolean; onSelect: () => void; name?: string; fi?: boolean; dx?: number; labelY?: number }) {
  const ring = useRef<Mesh>(null)
  const [hover, setHover] = useState(false)
  const alarm = fi || status === 'WARNING' || status === 'FAULT' || status === 'OUTAGE'
  const tone = alarm ? STATUS_COLOR[status === 'NORMAL' || status === 'OFF' || status === 'NO_DATA' ? 'WARNING' : status] : '#3d7bff'
  useFrame(({ clock }) => {
    const m = ring.current
    if (!m) return
    const k = (clock.elapsedTime * (alarm ? 1.6 : 0.8)) % 1
    m.scale.setScalar(1 + k * 1.6)
    ;(m.material as { opacity: number }).opacity = (1 - k) * 0.85
  })
  return (
    <group
      position={[p[0] + dx, 0, p[2] + 0.2]}
      scale={1.35}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onPointerOver={(e) => {
        e.stopPropagation()
        setHover(true)
        document.body.style.cursor = 'pointer'
      }}
      onPointerOut={() => {
        setHover(false)
        document.body.style.cursor = ''
      }}
    >
      {/* 받침 브래킷 */}
      <mesh position={[0, 1.75, -0.1]}>
        <boxGeometry args={[0.08, 0.5, 0.12]} />
        <meshStandardMaterial color="#5c5f62" metalness={0.5} roughness={0.5} />
      </mesh>
      {/* 철제 함 */}
      <RoundedBox args={[0.62, 0.8, 0.34]} radius={0.04} position={[0, 1.75, 0.1]} castShadow>
        <meshStandardMaterial color={hover || selected ? '#b9c3cf' : '#a3abb4'} metalness={0.55} roughness={0.45} emissive={tone} emissiveIntensity={selected ? 0.35 : hover ? 0.2 : 0.06} />
      </RoundedBox>
      {/* 문 손잡이 · 상태등 */}
      <mesh position={[0.2, 1.75, 0.28]}>
        <boxGeometry args={[0.03, 0.16, 0.03]} />
        <meshStandardMaterial color="#3a3f45" />
      </mesh>
      <mesh position={[-0.18, 2.03, 0.28]}>
        <sphereGeometry args={[0.035, 10, 10]} />
        <meshBasicMaterial color={alarm ? tone : '#40c057'} toneMapped={false} />
      </mesh>
      {/* 강조 고리 */}
      <mesh ref={ring} position={[0, 0.03, 0.1]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.55, 0.68, 40]} />
        <meshBasicMaterial color={tone} transparent opacity={0.6} toneMapped={false} depthWrite={false} />
      </mesh>
      {/* 평소에는 맥동 고리만, 고장표시가 떴거나 가리키거나 골랐을 때만 이름 */}
      {(alarm || hover || selected) && <Label lines={[alarm ? `${name} · 고장표시` : name]} position={[0, labelY, 0.1]} lineHeight={0.3} bg={tone} pointer />}
    </group>
  )
}

// ── 가로등 (실제 회로 채널 CH4·CH5) ─────────────────────
const LAMP_LABEL_BG: Record<NodeStatus, string> = {
  NORMAL: 'rgba(20,22,27,0.86)',
  OFF: 'rgba(110,116,128,0.86)',
  NO_DATA: 'rgba(150,155,165,0.86)',
  WARNING: 'rgba(184,100,0,0.92)',
  FAULT: 'rgba(207,52,52,0.94)',
  OUTAGE: 'rgba(40,43,50,0.92)',
}

export function StreetLamp({ c, view, pos, rot, night, selected, onSelect, showLabel = true, speech = null }: { c: LedState; view: { status: NodeStatus; text: string }; pos: V3; rot: number; night: boolean; selected: boolean; onSelect: () => void; showLabel?: boolean; speech?: string | null }) {
  const lit = c.lit
  const color = view.status === 'FAULT' ? '#ff6b6b' : view.status === 'WARNING' ? '#ffa94d' : '#ffe8a3'
  return (
    <group
      position={pos}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = '')}
    >
      <group rotation={[0, rot, 0]}>
        <mesh position={[0, 0.08, 0]}>
          <cylinderGeometry args={[0.13, 0.15, 0.16, 12]} />
          <meshStandardMaterial color="#343a40" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 1.4, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.065, 2.8, 10]} />
          <meshStandardMaterial color="#343a40" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 2.78, 0.3]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.03, 0.03, 0.6, 6]} />
          <meshStandardMaterial color="#343a40" metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 2.72, 0.6]} castShadow>
          <boxGeometry args={[0.3, 0.1, 0.44]} />
          <meshStandardMaterial color="#212529" metalness={0.5} roughness={0.4} />
        </mesh>
        <mesh position={[0, 2.665, 0.6]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.26, 0.38]} />
          <meshStandardMaterial color={lit ? '#fff8e1' : '#495057'} emissive={color} emissiveIntensity={lit ? (night ? 6 : 2.5) : 0} toneMapped={false} side={2} />
        </mesh>
        {/* 실제 조명 대신 바닥 빛 번짐 데칼 */}
        {night && lit && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.14, 0.6]} renderOrder={1}>
            <planeGeometry args={[4.2, 4.2]} />
            <meshBasicMaterial map={glowTexture()} color={color} transparent opacity={0.55} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        )}
      </group>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.15, 0]}>
          <ringGeometry args={[0.55, 0.7, 40]} />
          <meshBasicMaterial color="#4dabf7" />
        </mesh>
      )}
      {showLabel && <Label
        lines={selected || c.fault || ALARM_STATUS.includes(view.status) ? [c.name, `${c.fault ? '⚠ ' : ''}LED ${c.ch} · ${view.text}`] : [c.name]}
        position={[0, 3.55, 0]}
        bg={LAMP_LABEL_BG[view.status]}
        border="rgba(255,255,255,0.14)"
        pointer
        lineHeight={0.36}
      />}
      {showLabel && speech && <SpeechBubble text={speech} y={4.7} tone={view.status === 'FAULT' || view.status === 'OUTAGE' ? 'err' : 'warn'} />}
    </group>
  )
}
