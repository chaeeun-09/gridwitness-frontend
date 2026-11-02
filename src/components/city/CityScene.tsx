import { Line, OrbitControls } from '@react-three/drei'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Color, InstancedBufferAttribute, MeshLambertMaterial, Object3D, type InstancedMesh } from 'three'
import { BLOCK, CITY, cityLive, SPAN, type CitySnap, type SubStatus } from '../../lib/city'
import Label from '../three/Label'
import { nightness, SUB_COLOR, type CitySelection } from './shared'

// 약 1만 동 건물을 InstancedMesh 두 개(건물·블록 바닥)로 그린다. 상태가 바뀔 때만(최대 8Hz) 색을 다시 쓰고 그린다.
// 그림자·점광원·후처리 없음. 화면 밖이거나 탭이 숨겨지면 멈춘다.

const sq = (c: [number, number, number]): [number, number, number] => [c[0] * c[0], c[1] * c[1], c[2] * c[2]]

const TILE_DAY = [sq([0.66, 0.72, 0.62]), sq([0.58, 0.61, 0.67]), sq([0.66, 0.6, 0.55]), sq([0.36, 0.58, 0.34])]
const BLD_DAY = [sq([0.8, 0.76, 0.7]), sq([0.62, 0.7, 0.82]), sq([0.82, 0.64, 0.46])]
const WARM = sq([1, 0.84, 0.48])
const DARK_NIGHT = sq([0.11, 0.13, 0.2])
const OUT_DAY = sq([0.34, 0.31, 0.36])
const OUT_NIGHT = sq([0.1, 0.11, 0.17])

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

/** 밤에는 인스턴스 색이 그대로 빛나게(창문이 켜진 느낌). 낮에는 일반 조명만 받는다 */
function useGlowMaterial() {
  return useMemo(() => {
    const glow = { value: 0 }
    const material = new MeshLambertMaterial()
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uGlow = glow
      shader.fragmentShader = shader.fragmentShader.replace('uniform vec3 emissive;', 'uniform vec3 emissive;\nuniform float uGlow;').replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = emissive + vColor.rgb * uGlow;')
    }
    return { material, glow }
  }, [])
}

function CityMeshes({ snap, selection, onSelect }: { snap: CitySnap; selection: CitySelection; onSelect: (s: CitySelection) => void }) {
  const invalidate = useThree((s) => s.invalidate)
  const tiles = useRef<InstancedMesh>(null)
  const blds = useRef<InstancedMesh>(null)
  const bldMat = useGlowMaterial()
  const blockIndex = useMemo(() => {
    const idx: number[] = []
    for (let k = 0; k < CITY.nBlocks; k++) idx.push(k)
    return idx
  }, [])

  // 위치·크기는 한 번만
  useLayoutEffect(() => {
    const o = new Object3D()
    const t = tiles.current!
    const b = blds.current!
    blockIndex.forEach((k, n) => {
      o.position.set(CITY.bx[k], 0.05, CITY.bz[k])
      o.scale.set(BLOCK, 0.1, BLOCK)
      o.updateMatrix()
      t.setMatrixAt(n, o.matrix)
    })
    for (let n = 0; n < CITY.nBuild; n++) {
      o.position.set(CITY.bx0[n], CITY.bh[n] / 2 + 0.1, CITY.bz0[n])
      o.scale.set(CITY.bw[n], CITY.bh[n], CITY.bd[n])
      o.updateMatrix()
      b.setMatrixAt(n, o.matrix)
    }
    t.instanceMatrix.needsUpdate = true
    b.instanceMatrix.needsUpdate = true
    // 색 버퍼 만들기
    t.instanceColor = new InstancedBufferAttribute(new Float32Array(CITY.nBlocks * 3), 3)
    b.instanceColor = new InstancedBufferAttribute(new Float32Array(CITY.nBuild * 3), 3)
    t.computeBoundingSphere()
    b.computeBoundingSphere()
  }, [blockIndex])

  // 블록마다 색 3가지(정전·켜짐·꺼짐)를 한 번만 계산하고 건물은 골라 쓴다 (임시 객체를 만들지 않음)
  const scratch = useMemo(() => ({ out: new Float32Array(CITY.nBlocks * 3), lit: new Float32Array(CITY.nBlocks * 3), unlit: new Float32Array(CITY.nBlocks * 3), litFrac: new Float32Array(CITY.nBlocks) }), [])
  const selKey = selection ? `${selection.kind}${selection.id}` : ''
  useEffect(() => {
    const t = tiles.current
    const b = blds.current
    if (!t?.instanceColor || !b?.instanceColor) return
    const night = nightness(snap.time)
    const tc = t.instanceColor.array as Float32Array
    const bc = b.instanceColor.array as Float32Array
    const { supplier, blockDemand } = cityLive
    const selFeeder = selection?.kind === 'feeder' ? selection.id : -1
    const selSub = selection?.kind === 'sub' ? selection.id : -1
    const tileTone = 1 - night * 0.62
    const { out, lit, unlit, litFrac } = scratch
    const lerp = (x: number, y: number, k: number) => x + (y - x) * k

    for (let k = 0; k < CITY.nBlocks; k++) {
      const z = CITY.zone[k]
      const i3 = k * 3
      const noPower = z !== 3 && supplier[k] < 0
      const def = CITY.blockFeeder[k]
      const borrowed = z !== 3 && !noPower && supplier[k] !== def
      const hot = def >= 0 && (def === selFeeder || CITY.feeders[def].sub === selSub)
      const td = TILE_DAY[z]
      let r = td[0]
      let g = td[1]
      let bl = td[2]
      if (noPower) {
        r = lerp(r, 0.55, 0.75)
        g = lerp(g, 0.06, 0.75)
        bl = lerp(bl, 0.06, 0.75)
      } else if (borrowed) {
        r = lerp(r, 0.1, 0.6)
        g = lerp(g, 0.35, 0.6)
        bl = lerp(bl, 0.95, 0.6)
      }
      if (hot) {
        r = lerp(r, 1, 0.35)
        g = lerp(g, 1, 0.35)
        bl = lerp(bl, 1, 0.35)
      }
      tc[i3] = r * tileTone
      tc[i3 + 1] = g * tileTone
      tc[i3 + 2] = bl * tileTone

      if (z === 3) continue
      const frac = CITY.baseKw[k] > 0 ? Math.min(1.25, blockDemand[k] / (CITY.baseKw[k] * 0.9)) : 0
      const f1 = Math.min(1, frac)
      litFrac[k] = Math.min(1, 0.2 + frac * 0.85)
      const day = BLD_DAY[z]
      const dk = 0.82 + 0.18 * f1
      const wk = 0.55 + 0.45 * f1
      for (let c = 0; c < 3; c++) {
        const d = day[c] * dk
        out[i3 + c] = lerp(OUT_DAY[c], OUT_NIGHT[c], night)
        lit[i3 + c] = lerp(d, WARM[c] * wk, night)
        unlit[i3 + c] = lerp(d, DARK_NIGHT[c], night)
      }
    }

    for (let n = 0; n < CITY.nBuild; n++) {
      const k = CITY.bBlock[n]
      const src = supplier[k] < 0 ? out : CITY.bRand[n] < litFrac[k] ? lit : unlit
      const i3 = k * 3
      bc[n * 3] = src[i3]
      bc[n * 3 + 1] = src[i3 + 1]
      bc[n * 3 + 2] = src[i3 + 2]
    }
    t.instanceColor.needsUpdate = true
    b.instanceColor.needsUpdate = true
    bldMat.glow.value = night * 0.8
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.version, selKey])

  // 타일은 인스턴스 번호가 곧 블록 번호, 건물은 건물이 속한 블록을 찾아 그 블록의 선로를 선택
  const pick = (fromBuilding: boolean) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return
    e.stopPropagation()
    const id = e.instanceId ?? -1
    const k = id < 0 ? -1 : fromBuilding ? CITY.bBlock[id] : blockIndex[id]
    const f = k === undefined || k < 0 ? -1 : CITY.blockFeeder[k]
    onSelect(f >= 0 ? { kind: 'feeder', id: f } : null)
  }

  return (
    <>
      <instancedMesh ref={tiles} args={[undefined, undefined, CITY.nBlocks]} onClick={pick(false)} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={blds} args={[undefined, undefined, CITY.nBuild]} onClick={pick(true)} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <primitive object={bldMat.material} attach="material" />
      </instancedMesh>
    </>
  )
}

const FeederLine = memo(function FeederLine({ id, state, over, night, sel }: { id: number; state: string; over: boolean; night: boolean; sel: boolean }) {
  const f = CITY.feeders[id]
  const sub = CITY.subs[f.sub].pos
  const points = useMemo<[number, number, number][]>(() => [[sub[0], 2.4, sub[1]], [f.centroid[0], 1.6, f.centroid[1]], [f.far[0], 0.9, f.far[1]]], [f, sub])
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
      <Label lines={[`${def.name} 변전소`, pctLabel]} position={[0, 12.5, 0]} lineHeight={2.1} bg={`${SUB_COLOR[status]}e6`} />
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
  const dpr = Math.min(window.devicePixelRatio, 1.5)
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
        <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[SPAN + 40, SPAN + 40]} />
          <meshLambertMaterial color={night > 0.5 ? '#12161d' : '#454a54'} />
        </mesh>
        <mesh position={[0, -0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[900, 900]} />
          <meshLambertMaterial color={night > 0.5 ? '#0d1410' : '#7d9468'} />
        </mesh>
        <CityMeshes snap={snap} selection={selection} onSelect={onSelect} />
        <Grid snap={snap} selection={selection} onSelect={onSelect} />
        <OrbitControls makeDefault enableDamping target={[-14, 0, -8]} maxPolarAngle={Math.PI / 2.15} minDistance={12} maxDistance={340} />
      </Canvas>
    </div>
  )
}
