import { RoundedBox } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { memo, useEffect, useMemo } from 'react'
import { AdditiveBlending, Color, ExtrudeGeometry, MeshStandardMaterial, Shape } from 'three'
import type { LedState, NodeStatus } from '../../lib/village'
import Label from '../three/Label'
import SpeechBubble from '../three/SpeechBubble'
import { glowTexture, shingleTexture, sidingTexture, tiled } from './textures'
import { HOUSE_SPECS, mastTop, type HouseStyle, type Spec } from './houseGeometry'

/** 라벨에 상태 줄까지 보여줄 상태 (평소엔 이름만) */
const ALARM_STATUS: NodeStatus[] = ['WARNING', 'FAULT', 'OUTAGE']

const LABEL_BG: Record<NodeStatus, string> = {
  NORMAL: 'rgba(20,22,27,0.86)',
  OFF: 'rgba(110,116,128,0.86)',
  NO_DATA: 'rgba(150,155,165,0.86)',
  WARNING: 'rgba(184,100,0,0.92)',
  FAULT: 'rgba(207,52,52,0.94)',
  OUTAGE: 'rgba(40,43,50,0.92)',
}
const METER_COLOR: Record<NodeStatus, string> = {
  NORMAL: '#40c057',
  OFF: '#868e96',
  NO_DATA: '#adb5bd',
  WARNING: '#ff922b',
  FAULT: '#ff3b3b',
  OUTAGE: '#343a40',
}

const GableRoof = memo(function GableRoof({ s }: { s: Spec }) {
  const overhang = 0.28
  const shingles = useMemo(() => tiled(shingleTexture(s.roof), (s.w + 0.56) / 1.1, 2), [s])
  const siding = useMemo(() => tiled(sidingTexture(s.wall), s.d / 1.6, s.roofH / 1.6), [s])
  const a = Math.atan2(s.roofH, s.d / 2)
  const len = s.d / 2 / Math.cos(a) + overhang
  const ridgeY = s.wallH + s.roofH
  const gable = useMemo(() => {
    const sh = new Shape()
    sh.moveTo(-s.d / 2, 0)
    sh.lineTo(s.d / 2, 0)
    sh.lineTo(0, s.roofH)
    sh.closePath()
    return new ExtrudeGeometry(sh, { depth: s.w, bevelEnabled: false })
  }, [s])
  useEffect(() => () => gable.dispose(), [gable])

  return (
    <group>
      {/* 박공벽 (지붕 아래 삼각 벽) */}
      <mesh geometry={gable} position={[-s.w / 2, s.wallH, 0]} rotation={[0, Math.PI / 2, 0]} castShadow receiveShadow>
        <meshStandardMaterial map={siding} />
      </mesh>
      {/* 지붕판 앞/뒤 */}
      {[1, -1].map((side) => (
        <mesh
          key={side}
          position={[0, ridgeY - (Math.sin(a) * len) / 2 + 0.04, side * ((Math.cos(a) * len) / 2)]}
          rotation={[side * a, 0, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[s.w + overhang * 2, 0.12, len]} />
          <meshStandardMaterial map={shingles} roughness={0.85} />
        </mesh>
      ))}
      {/* 용마루 */}
      <mesh position={[0, ridgeY + 0.05, 0]} castShadow>
        <boxGeometry args={[s.w + overhang * 2 + 0.02, 0.1, 0.16]} />
        <meshStandardMaterial color={new Color(s.roof).multiplyScalar(0.7)} />
      </mesh>
    </group>
  )
})

const Window = memo(function Window({ x, y, z, ry = 0, w = 0.62, h = 0.72, glass, trim }: { x: number; y: number; z: number; ry?: number; w?: number; h?: number; glass: MeshStandardMaterial; trim: string }) {
  return (
    <group position={[x, y, z]} rotation={[0, ry, 0]}>
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[w + 0.12, h + 0.12, 0.05]} />
        <meshStandardMaterial color={trim} />
      </mesh>
      <mesh position={[0, 0, 0.05]} material={glass}>
        <planeGeometry args={[w, h]} />
      </mesh>
      {/* 창살 */}
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[0.04, h, 0.02]} />
        <meshStandardMaterial color={trim} />
      </mesh>
      <mesh position={[0, 0, 0.06]}>
        <boxGeometry args={[w, 0.04, 0.02]} />
        <meshStandardMaterial color={trim} />
      </mesh>
      {/* 창턱 */}
      <mesh position={[0, -h / 2 - 0.08, 0.08]}>
        <boxGeometry args={[w + 0.2, 0.05, 0.12]} />
        <meshStandardMaterial color={trim} />
      </mesh>
    </group>
  )
})

const Door = memo(function Door({ z, trim, lit }: { z: number; trim: string; lit: boolean }) {
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 0.62, 0.02]}>
        <boxGeometry args={[0.72, 1.12, 0.05]} />
        <meshStandardMaterial color={trim} />
      </mesh>
      <mesh position={[0, 0.6, 0.05]}>
        <boxGeometry args={[0.58, 1.02, 0.04]} />
        <meshStandardMaterial color="#6b3f26" roughness={0.6} />
      </mesh>
      <mesh position={[0.2, 0.58, 0.09]}>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color="#d4a72c" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* 계단 */}
      <mesh position={[0, 0.06, 0.32]} castShadow receiveShadow>
        <boxGeometry args={[1, 0.12, 0.5]} />
        <meshStandardMaterial color="#b9b4aa" />
      </mesh>
      {/* 차양 */}
      <mesh position={[0, 1.3, 0.28]} rotation={[0.35, 0, 0]} castShadow>
        <boxGeometry args={[1.05, 0.06, 0.6]} />
        <meshStandardMaterial color="#5c4033" />
      </mesh>
      {/* 현관등 */}
      <mesh position={[0.5, 1.05, 0.08]}>
        <sphereGeometry args={[0.06, 10, 10]} />
        <meshStandardMaterial color="#fff3bf" emissive="#ffd43b" emissiveIntensity={lit ? 2 : 0} toneMapped={false} />
      </mesh>
    </group>
  )
})

const FLOWERS: [number, number, string][] = [
  [-0.35, -0.08, '#ff6b9a'], [-0.15, 0.08, '#ffd43b'], [0.05, -0.06, '#f8f9fa'], [0.25, 0.07, '#ff8787'], [0.38, -0.08, '#b197fc'],
  [-0.25, 0.1, '#69db7c'], [0.15, 0.1, '#69db7c'],
]

const Yard = memo(function Yard({ s }: { s: Spec }) {
  const yw = s.w + 1.8
  const back = -s.d / 2 - 0.8
  const front = s.d / 2 + 1.8
  const hedge = (x: number, z: number, w: number, d: number, k: string) => (
    <RoundedBox key={k} args={[w, 0.45, d]} radius={0.12} smoothness={2} position={[x, 0.22, z]} castShadow receiveShadow>
      <meshStandardMaterial color="#3f8f46" roughness={1} />
    </RoundedBox>
  )
  const gap = 1.2
  const side = (yw - gap) / 2
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, (front + back) / 2]} receiveShadow>
        <planeGeometry args={[yw, front - back]} />
        <meshStandardMaterial color="#8fc574" />
      </mesh>
      {/* 디딤돌 길 */}
      {Array.from({ length: 4 }, (_, k) => (
        <mesh key={k} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, s.d / 2 + 0.75 + k * 0.42]} receiveShadow>
          <circleGeometry args={[0.2, 12]} />
          <meshStandardMaterial color="#cfc8bb" />
        </mesh>
      ))}
      {/* 화단 */}
      {[-1, 1].map((sx) => (
        <group key={sx} position={[sx * (s.w / 2 - 0.55), 0, s.d / 2 + 0.35]}>
          <mesh position={[0, 0.07, 0]} receiveShadow>
            <boxGeometry args={[1.0, 0.14, 0.4]} />
            <meshStandardMaterial color="#5b3f2c" roughness={1} />
          </mesh>
          {FLOWERS.map(([fx, fz, c], k) => (
            <mesh key={k} position={[fx, 0.2, fz]} castShadow>
              <icosahedronGeometry args={[0.08, 0]} />
              <meshStandardMaterial color={c} roughness={0.6} />
            </mesh>
          ))}
        </group>
      ))}
      {/* 우체통 */}
      <group position={[0.85, 0, front - 0.35]}>
        <mesh position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.7, 6]} />
          <meshStandardMaterial color="#495057" />
        </mesh>
        <RoundedBox args={[0.2, 0.18, 0.32]} radius={0.06} position={[0, 0.75, 0]} castShadow>
          <meshStandardMaterial color="#c92a2a" roughness={0.4} />
        </RoundedBox>
      </group>
      {hedge(0, back, yw, 0.35, 'b')}
      {hedge(-yw / 2, (front + back) / 2, 0.35, front - back, 'l')}
      {hedge(yw / 2, (front + back) / 2, 0.35, front - back, 'r')}
      {hedge(-yw / 2 + side / 2, front, side, 0.35, 'fl')}
      {hedge(yw / 2 - side / 2, front, side, 0.35, 'fr')}
    </group>
  )
})

export default function House({
  h,
  view,
  style,
  pos,
  rot,
  selected,
  onSelect,
  night,
  showLabel = true,
  speech = null,
}: {
  night: boolean
  showLabel?: boolean
  speech?: string | null
  h: LedState
  view: { status: NodeStatus; text: string }
  style: HouseStyle
  pos: [number, number, number]
  rot: number
  selected: boolean
  onSelect: () => void
}) {
  const s = HOUSE_SPECS[style]
  // LED가 켜져 있고 실제로 전류가 흐를 때만 창에 불이 들어옴
  const lit = h.lit
  const warm = view.status === 'FAULT' ? '#ff6b6b' : view.status === 'WARNING' ? '#ffa94d' : '#ffd877'

  const glass = useMemo(() => new MeshStandardMaterial({ color: '#2f3a45', roughness: 0.08, metalness: 0.6 }), [])
  useEffect(() => () => glass.dispose(), [glass])
  useEffect(() => {
    glass.color.set(lit ? warm : '#2f3a45')
    glass.metalness = lit ? 0 : 0.6
    glass.emissive.set(warm)
  }, [glass, lit, warm])
  useFrame(({ clock }) => {
    glass.emissiveIntensity = !lit
      ? 0
      : view.status === 'FAULT'
        ? 0.4 + Math.abs(Math.sin(clock.elapsedTime * 12)) * 1.4
        : view.status === 'WARNING'
          ? 0.7 + Math.sin(clock.elapsedTime * 3) * 0.25
          : 1.6
  })

  const wallTex = useMemo(() => tiled(sidingTexture(s.wall), s.w / 1.6, (s.wallH - 0.2) / 1.6), [s])
  const fz = s.d / 2 + 0.001
  const rows = s.floors === 2 ? [1.05, 2.55] : [1.15]
  const winX = style === 'wide' ? [-1.35, -0.75, 0.9, 1.5] : [-0.95, 0.95]
  const mast = mastTop(style)
  const labelY = s.wallH + s.roofH + 1.4

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
        <Yard s={s} />
        {/* 기초 */}
        <mesh position={[0, 0.1, 0]} castShadow receiveShadow>
          <boxGeometry args={[s.w + 0.16, 0.2, s.d + 0.16]} />
          <meshStandardMaterial color="#9a958c" roughness={1} />
        </mesh>
        {/* 벽 */}
        <mesh position={[0, 0.2 + (s.wallH - 0.2) / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[s.w, s.wallH - 0.2, s.d]} />
          <meshStandardMaterial map={wallTex} roughness={0.9} />
        </mesh>
        {/* 모서리 기둥 */}
        {[-1, 1].flatMap((sx) =>
          [-1, 1].map((sz) => (
            <mesh key={`${sx}${sz}`} position={[(sx * s.w) / 2, s.wallH / 2 + 0.1, (sz * s.d) / 2]}>
              <boxGeometry args={[0.1, s.wallH - 0.2, 0.1]} />
              <meshStandardMaterial color={s.trim} />
            </mesh>
          )),
        )}
        {s.floors === 2 && (
          <mesh position={[0, 1.8, 0]}>
            <boxGeometry args={[s.w + 0.04, 0.08, s.d + 0.04]} />
            <meshStandardMaterial color={s.trim} />
          </mesh>
        )}
        <GableRoof s={s} />

        {/* 창문: 앞면, 옆면 */}
        {rows.map((y, r) =>
          winX
            .filter((x) => !(r === 0 && Math.abs(x) < 0.5))
            .map((x) => <Window key={`f${r}${x}`} x={x} y={y} z={fz} glass={glass} trim={s.trim} />),
        )}
        {s.floors === 2 && <Window x={0} y={2.55} z={fz} glass={glass} trim={s.trim} w={0.5} />}
        {rows.map((y) => (
          <Window key={`s${y}`} x={s.w / 2 + 0.001} y={y} z={0} ry={Math.PI / 2} glass={glass} trim={s.trim} />
        ))}
        {rows.map((y) => (
          <Window key={`w${y}`} x={-s.w / 2 - 0.001} y={y} z={0} ry={-Math.PI / 2} glass={glass} trim={s.trim} />
        ))}
        {/* 뒷면 */}
        {rows.map((y, r) =>
          winX.map((x) => <Window key={`b${r}${x}`} x={x} y={y} z={-fz} ry={Math.PI} glass={glass} trim={s.trim} />),
        )}
        <group rotation={[0, Math.PI, 0]}>
          <Door z={fz} trim={s.trim} lit={lit} />
        </group>
        <Door z={fz} trim={s.trim} lit={lit} />

        {/* 굴뚝 */}
        <mesh position={[s.w / 2 - 0.6, s.wallH + s.roofH * 0.75, -s.d / 4]} castShadow>
          <boxGeometry args={[0.36, 1.1, 0.36]} />
          <meshStandardMaterial color="#8c5a45" />
        </mesh>
        <mesh position={[s.w / 2 - 0.6, s.wallH + s.roofH * 0.75 + 0.58, -s.d / 4]}>
          <boxGeometry args={[0.44, 0.08, 0.44]} />
          <meshStandardMaterial color="#5c3a2e" />
        </mesh>
        {/* 인입선 지지대 */}
        <mesh position={[mast[0], (mast[1] + s.wallH + s.roofH - 0.2) / 2, 0]}>
          <cylinderGeometry args={[0.03, 0.03, mast[1] - (s.wallH + s.roofH - 0.2), 6]} />
          <meshStandardMaterial color="#6c757d" metalness={0.6} />
        </mesh>
        {/* 계량기 (상태 표시) */}
        <group position={[s.w / 2 + 0.03, 1.0, s.d / 2 - 0.45]} rotation={[0, Math.PI / 2, 0]}>
          <mesh>
            <boxGeometry args={[0.3, 0.4, 0.1]} />
            <meshStandardMaterial color="#dee2e6" />
          </mesh>
          <mesh position={[0, 0.05, 0.06]}>
            <circleGeometry args={[0.09, 16]} />
            <meshStandardMaterial color={METER_COLOR[view.status]} emissive={METER_COLOR[view.status]} emissiveIntensity={1.2} toneMapped={false} />
          </mesh>
        </group>
        {/* 밤: 창문 불빛이 마당에 번지는 효과 (실제 조명 대신 가벼운 데칼) */}
        {night && lit && (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, s.d / 2 + 1.1]} renderOrder={1}>
            <planeGeometry args={[s.w + 1.6, 2.4]} />
            <meshBasicMaterial map={glowTexture()} color={warm} transparent opacity={0.45} blending={AdditiveBlending} depthWrite={false} toneMapped={false} />
          </mesh>
        )}
      </group>

      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[3.2, 3.4, 64]} />
          <meshBasicMaterial color="#4dabf7" />
        </mesh>
      )}
      {/* 평소에는 이름만 작게, 선택했거나 이상일 때만 LED·상태 줄까지 */}
      {showLabel && <Label
        lines={selected || h.fault || ALARM_STATUS.includes(view.status) ? [h.name, `${h.fault ? '⚠ ' : ''}LED ${h.ch} · ${view.text}`] : [h.name]}
        position={[0, labelY, 0]}
        bg={LABEL_BG[view.status]}
        border="rgba(255,255,255,0.14)"
        pointer
        lineHeight={0.4}
      />}
      {showLabel && speech && <SpeechBubble text={speech} y={labelY + 1.5} tone={view.status === 'FAULT' || view.status === 'OUTAGE' ? 'err' : 'warn'} />}
    </group>
  )
}
