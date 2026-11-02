import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Color } from 'three'
import { CITY, type CitySnap, type SubStatus } from '../../lib/city'
import Label from '../three/Label'
import { Buildings, Decor, Ground } from './miniature'
import { nightness, SUB_COLOR, type CitySelection } from './shared'

// 약 1만 동 건물을 InstancedMesh 두 개(건물·블록 바닥)로 그린다. 상태가 바뀔 때만(최대 8Hz) 색을 다시 쓰고 그린다.
// 그림자·점광원·후처리 없음. 화면 밖이거나 탭이 숨겨지면 멈춘다.

function useCssZoom(ref: { current: HTMLElement | null }) {
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect().width / Math.max(1, el.offsetWidth)
      setZoom((z) => (Math.abs(z - r) > 0.01 ? r : z))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return zoom
}

function Frame({ active, version }: { active: boolean; version: number }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    if (active) invalidate()
  }, [active, version, invalidate])
  return null
}

function useOnScreen<T extends Element>() {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(true)
  const [tab, setTab] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.02 })
    io.observe(el)
    const onVis = () => setTab(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])
  return [ref, visible && tab] as const
}

const FeederLine = memo(function FeederLine({ id, state, over, night, sel }: { id: number; state: string; over: boolean; night: boolean; sel: boolean }) {
  const f = CITY.feeders[id]
  const sub = CITY.subs[f.sub].pos
  // 도로를 따라 꺾이는 간선 (대각선이 아니라 가로·세로로만 이동)
  const points = useMemo<[number, number, number][]>(
    () => [
      [sub[0], 2.4, sub[1]],
      [f.centroid[0], 1.8, sub[1]],
      [f.centroid[0], 1.4, f.centroid[1]],
      [f.far[0], 1.0, f.centroid[1]],
      [f.far[0], 0.7, f.far[1]],
    ],
    [f, sub],
  )
  const color = state === 'FAULT' ? '#e5484d' : state === 'TRIPPED' ? '#f0771f' : over ? '#f0a020' : night ? '#6fe3b0' : '#1c9c66'
  return <Line points={points} color={color} lineWidth={sel ? 5 : state === 'OK' ? 2.2 : 4} />
})

const TransLine = memo(function TransLine({ sub, down, night }: { sub: number; down: boolean; night: boolean }) {
  const pos = CITY.subs[sub].pos
  const points = useMemo<[number, number, number][]>(() => [[CITY.plant[0], 2.4, CITY.plant[1]], [pos[0], 2.2, pos[1]]], [pos])
  return <Line points={points} color={down ? '#e5484d' : night ? '#9fb4ff' : '#4a5b86'} lineWidth={down ? 3 : 2} dashed dashSize={2.2} gapSize={1.2} />
})

const SubBox = memo(function SubBox({ id, status, pctLabel, sel, onSelect }: { id: number; status: SubStatus; pctLabel: string; sel: boolean; onSelect: (s: CitySelection) => void }) {
  const def = CITY.subs[id]
  return (
    <group position={[def.pos[0], 0, def.pos[1]]} onClick={(e) => (e.delta > 4 ? undefined : (e.stopPropagation(), onSelect({ kind: 'sub', id })))}>
      <mesh position={[0, 0.9, 0]}>
        <boxGeometry args={[3.4, 1.8, 3.4]} />
        <meshLambertMaterial color={sel ? '#ffffff' : '#2b3340'} />
      </mesh>
      <mesh position={[0, 2.05, 0]}>
        <boxGeometry args={[2.4, 0.5, 2.4]} />
        <meshBasicMaterial color={SUB_COLOR[status]} toneMapped={false} />
      </mesh>
      <mesh position={[0, 6.5, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 8, 6]} />
        <meshBasicMaterial color={SUB_COLOR[status]} />
      </mesh>
      <Label lines={[`${def.name} 변전소`, pctLabel]} position={[0, 17, 0]} lineHeight={2.1} bg={`${SUB_COLOR[status]}e6`} />
    </group>
  )
})

const Plant = memo(function Plant({ mwLabel }: { mwLabel: string }) {
  const plant = CITY.plant
  return (
    <group position={[plant[0], 0, plant[1]]}>
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[9, 2.4, 6]} />
        <meshLambertMaterial color="#8d949e" />
      </mesh>
      {[-2.6, 0, 2.6].map((x) => (
        <mesh key={x} position={[x, 4.2, -1.2]}>
          <cylinderGeometry args={[0.7, 0.9, 5.2, 12]} />
          <meshLambertMaterial color="#b9bec6" />
        </mesh>
      ))}
      <Label lines={['발전소', mwLabel]} position={[0, 9.5, 0]} lineHeight={2.1} bg="rgba(20,22,27,0.88)" />
    </group>
  )
})

function Grid({ snap, selection, onSelect }: { snap: CitySnap; selection: CitySelection; onSelect: (s: CitySelection) => void }) {
  const night = nightness(snap.time) > 0.5
  return (
    <>
      <Plant mwLabel={`${Math.round(snap.servedKw / 5000) * 5} MW 공급`} />
      {snap.subs.map((s) => (
        <TransLine key={`t${s.def.id}`} sub={s.def.id} down={s.status === 'FAULT' || s.status === 'OUT'} night={night} />
      ))}
      {snap.subs.map((s) => (
        <SubBox key={s.def.id} id={s.def.id} status={s.status} pctLabel={s.status === 'FAULT' ? '사고' : `${Math.round(s.util * 20) * 5}%`} sel={selection?.kind === 'sub' && selection.id === s.def.id} onSelect={onSelect} />
      ))}
      {snap.feeders.map((f) => (
        <FeederLine key={f.def.id} id={f.def.id} state={f.state} over={f.util > 1} night={night} sel={selection?.kind === 'feeder' && selection.id === f.def.id} />
      ))}
    </>
  )
}

export default function CityScene({ snap, selection, onSelect }: { snap: CitySnap; selection: CitySelection; onSelect: (s: CitySelection) => void }) {
  const [wrap, active] = useOnScreen<HTMLDivElement>()
  const night = nightness(snap.time)
  const bg = useMemo(() => new Color().setRGB(0.62 * (1 - night) + 0.03 * night, 0.78 * (1 - night) + 0.05 * night, 0.92 * (1 - night) + 0.1 * night), [night])
  // 앱이 넓은 화면에서 CSS zoom(1.12~1.2배)으로 확대되면 캔버스 버퍼가 zoom 이전 크기로 잡혀 흐려지므로 배율만큼 해상도를 올림
  const zoom = useCssZoom(wrap)
  const dpr = Math.min(window.devicePixelRatio * zoom, 2)
  return (
    <div ref={wrap} style={{ width: '100%', height: '100%' }}>
      <Canvas
        frameloop="demand"
        resize={{ offsetSize: true }}
        dpr={dpr}
        camera={{ position: [-100, 118, 120], fov: 42, near: 1, far: 800 }}
        gl={{ antialias: true, powerPreference: 'default' }}
        onPointerMissed={() => onSelect(null)}
      >
        <Frame active={active} version={snap.version} />
        <color attach="background" args={[bg.r, bg.g, bg.b]} />
        <fog attach="fog" args={[bg, 220, 520]} />
        <hemisphereLight args={[night > 0.5 ? '#4a5f94' : '#eaf4ff', night > 0.5 ? '#141a28' : '#566c42', 0.5 + 0.5 * (1 - night)]} />
        <directionalLight position={[-40, 80, 30]} intensity={2.0 * (1 - night) + 0.3 * night} color={night > 0.5 ? '#9db4ff' : '#fff1dc'} />
        <Ground night={night > 0.5} />
        <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[900, 900]} />
          <meshLambertMaterial color={night > 0.5 ? '#0d1410' : '#8aa070'} />
        </mesh>
        <Buildings snap={snap} selection={selection} onSelect={onSelect} />
        <Decor />
        <Grid snap={snap} selection={selection} onSelect={onSelect} />
        <OrbitControls makeDefault enableDamping target={[-14, 0, -8]} maxPolarAngle={Math.PI / 2.15} minDistance={12} maxDistance={340} />
      </Canvas>
    </div>
  )
}
