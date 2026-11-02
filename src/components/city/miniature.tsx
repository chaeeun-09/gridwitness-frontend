import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  MeshLambertMaterial,
  Object3D,
  SRGBColorSpace,
  type IUniform,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { BLOCK, CITY, cityLive, GRID, PITCH, SPAN, type CitySnap } from '../../lib/city'
import { nightness, type CitySelection } from './shared'

// 3D 프린트 미니어처 도시 느낌: 건물 6가지 모양, 절차적 창문 격자(밤에 창마다 점등, 정전은 소등),
// 노란 점선 도로, 공원 나무, 돔 건물, 저장탱크. 건물은 모양별 InstancedMesh 6개로 그린다.

const lin = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
  return [c[0] * c[0], c[1] * c[1], c[2] * c[2]]
}
const PALETTE = [
  ['#8fc3bd', '#e8dcc2', '#a8c2d6', '#e0946a', '#f0f0f2', '#7fa6bf'].map(lin), // 상업: 청록·크림·하늘·주황·흰색·강철
  ['#efe3c8', '#f2c9a6', '#d9d5cc', '#f4e7a8', '#d99a7a', '#c7d8c9'].map(lin), // 주거
  ['#d8b98e', '#e6a35c', '#a9b4bd', '#cdbfa6', '#e8d9b0', '#9fb0a4'].map(lin), // 산업
]
const TILE_DAY = [lin('#d3cfc4'), lin('#c9cfd6'), lin('#d2c6b0'), lin('#5fa04e')]
const TREE = ['#4f9a45', '#5fae52', '#3f8a3c', '#78b856'].map(lin)

// ── 건물 모양 (y -0.5~0.5, 폭·깊이 -0.5~0.5 안에 들어가는 단위 모양) ──
function merged(parts: BufferGeometry[]): BufferGeometry {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)))!
}
const bx = (w: number, h: number, d: number, x: number, y: number, z: number) => new BoxGeometry(w, h, d).translate(x, y, z)

function archetype(type: number): BufferGeometry {
  switch (type) {
    case 1: // 계단식 고층
      return merged([bx(1, 0.55, 1, 0, -0.225, 0), bx(0.72, 0.3, 0.72, 0, 0.2, 0), bx(0.42, 0.15, 0.42, 0, 0.425, 0)])
    case 2: // 옥상 설비를 얹은 고층
      return merged([bx(1, 0.9, 1, 0, -0.05, 0), bx(0.4, 0.1, 0.4, -0.15, 0.45, 0.1), bx(0.2, 0.06, 0.2, 0.28, 0.43, -0.25)])
    case 3: // 뾰족 지붕 주택
      return merged([bx(1, 0.62, 1, 0, -0.19, 0), new ConeGeometry(0.78, 0.38, 4).rotateY(Math.PI / 4).translate(0, 0.31, 0)])
    case 4: // 공장 (지붕창 + 굴뚝)
      return merged([bx(1, 0.78, 1, 0, -0.11, 0), bx(0.9, 0.22, 0.36, 0, 0.39, 0.05), new CylinderGeometry(0.07, 0.07, 0.3, 8).translate(0.35, 0.35, -0.32)])
    case 5: // 높이가 다른 쌍둥이
      return merged([bx(0.48, 1, 1, -0.26, 0, 0), bx(0.48, 0.68, 1, 0.26, -0.16, 0)])
    default:
      return new BoxGeometry(1, 1, 1)
  }
}

// ── 건물 셰이더: 벽·지붕·창문을 절차적으로 칠하고 밤에는 창마다 불을 켠다 ──
function useBuildingMaterial() {
  return useMemo(() => {
    const uniforms: Record<string, IUniform> = { uNight: { value: 0 } }
    const material = new MeshLambertMaterial()
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uNight = uniforms.uNight
      shader.vertexShader = shader.vertexShader
        .replace('void main() {', 'attribute float aLit;\nattribute float aSeed;\nvarying float vLit;\nvarying float vSeed;\nvarying vec3 vObjPos;\nvarying vec3 vObjN;\nvarying vec3 vInstScale;\nvoid main() {')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vLit = aLit; vSeed = aSeed; vObjPos = position; vObjN = normal;
          #ifdef USE_INSTANCING
            vInstScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          #else
            vInstScale = vec3(1.0);
          #endif`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uNight;\nvarying float vLit;\nvarying float vSeed;\nvarying vec3 vObjPos;\nvarying vec3 vObjN;\nvarying vec3 vInstScale;\nvoid main() {')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 pal = diffuseColor.rgb;
            vec3 on3 = normalize(vObjN);
            float top = step(0.35, on3.y);
            float outage = step(vLit, -0.5);
            float lit = max(vLit, 0.0);
            float along = (abs(on3.x) > 0.5) ? vObjPos.z * vInstScale.z : vObjPos.x * vInstScale.x;
            float yy = (vObjPos.y + 0.5) * vInstScale.y;
            vec2 cell = vec2(along / 0.6, yy / 0.7);
            vec2 f = fract(cell);
            float win = step(0.1, f.x) * step(f.x, 0.9) * step(0.3, f.y) * step(f.y, 0.7) * (1.0 - top) * step(0.45, yy);
            float h = fract(sin(dot(floor(cell) + vec2(vSeed * 37.0, vSeed * 91.0), vec2(12.9898, 78.233))) * 43758.5453);
            float on = step(h, lit);
            vec3 grey = vec3(dot(pal, vec3(0.333)));
            vec3 wall = mix(mix(pal, grey * 0.5, outage), mix(pal * 0.14, vec3(0.025, 0.028, 0.04), outage), uNight);
            vec3 roofBase = mix(vec3(0.2, 0.5, 0.46), vec3(0.74, 0.4, 0.26), step(0.0, pal.b - pal.r));
            roofBase = mix(roofBase, pal * 0.7, step(0.72, fract(vSeed * 7.0)));
            vec3 roofDay = mix(roofBase, grey * 0.4, outage);
            vec3 roof = mix(roofDay, roofDay * 0.12, uNight);
            vec3 glass = mix(mix(vec3(0.27, 0.42, 0.53), vec3(0.12), outage), vec3(0.03, 0.04, 0.07), uNight);
            vec3 col = mix(wall, glass, win);
            col = mix(col, roof, top);
            diffuseColor.rgb = col;
            float lamp = win * (1.0 - top) * (1.0 - outage) * on * uNight;
            totalEmissiveRadiance += vec3(1.0, 0.78, 0.42) * lamp * 0.95;
          }`,
        )
    }
    return { material, uniforms }
  }, [])
}

/** 도로 바닥: 아스팔트 + 노란 점선 차선 (블록 사이 길 가운데) */
function useRoadTexture() {
  return useMemo(() => {
    const S = 2048
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = S
    const ctx = canvas.getContext('2d')!
    const U = S / (SPAN + 1) // 월드 1칸 = 몇 픽셀
    ctx.fillStyle = '#5d626d'
    ctx.fillRect(0, 0, S, S)
    ctx.fillStyle = '#e8c547'
    const gap = 0.7
    for (let i = 0; i <= GRID; i++) {
      const c = (i - GRID / 2) * PITCH
      const px = (c + SPAN / 2 + 0.5) * U
      for (let j = 0; j < GRID; j++) {
        const z0 = (j - GRID / 2) * PITCH + gap * 0.7
        const z1 = (j + 1 - GRID / 2) * PITCH - gap * 0.7
        for (let z = z0; z < z1 - 0.2; z += 0.75) {
          const len = Math.min(0.42, z1 - z)
          ctx.fillRect(px - 0.025 * U, (z + SPAN / 2 + 0.5) * U, 0.05 * U, len * U) // 세로 길
          ctx.fillRect((z + SPAN / 2 + 0.5) * U, px - 0.025 * U, len * U, 0.05 * U) // 가로 길
        }
      }
    }
    const tex = new CanvasTexture(canvas)
    tex.colorSpace = SRGBColorSpace
    tex.anisotropy = 8
    tex.minFilter = LinearMipmapLinearFilter
    return tex
  }, [])
}

export function Ground({ night }: { night: boolean }) {
  const tex = useRoadTexture()
  return (
    <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[SPAN + 1, SPAN + 1]} />
      <meshLambertMaterial map={tex} color={night ? '#6a6f7c' : '#ffffff'} />
    </mesh>
  )
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** 공원 나무, 산업단지 저장탱크, 중앙 돔 건물 */
export function Decor() {
  const trees = useRef<InstancedMesh>(null)
  const tanks = useRef<InstancedMesh>(null)
  const parks = useMemo(() => [...Array(CITY.nBlocks).keys()].filter((k) => CITY.zone[k] === 3 && !CITY.tank[k]), [])
  const tankBlocks = useMemo(() => [...Array(CITY.nBlocks).keys()].filter((k) => CITY.tank[k]), [])
  // 돔 건물은 주변이 가장 낮고 트인 공원에 둔다 (고층 숲 한가운데면 가려져 안 보임)
  const dome = useMemo(() => {
    const top = new Float32Array(CITY.nBlocks)
    for (let n = 0; n < CITY.nBuild; n++) top[CITY.bBlock[n]] = Math.max(top[CITY.bBlock[n]], CITY.bh[n])
    let best = parks[0]
    let bs = Infinity
    for (const k of parks) {
      const dc = Math.hypot(CITY.bx[k], CITY.bz[k])
      if (dc < 10 || dc > 48) continue
      const i = k % GRID
      const j = Math.floor(k / GRID)
      let sum = 0
      let cnt = 0
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= GRID || jj >= GRID) continue
          sum += top[jj * GRID + ii]
          cnt++
        }
      }
      const score = sum / Math.max(1, cnt) + dc * 0.01
      if (score < bs) {
        bs = score
        best = k
      }
    }
    return best
  }, [parks])

  useLayoutEffect(() => {
    const o = new Object3D()
    const c = new Color()
    const t = trees.current!
    let n = 0
    for (const k of parks) {
      if (k === dome) continue
      for (let m = 0; m < 7; m++) {
        const r = hash(k * 13 + m)
        const s = 0.3 + hash(k * 7 + m * 3) * 0.28
        o.position.set(CITY.bx[k] + (hash(k * 3 + m) - 0.5) * (BLOCK - 0.5), 0.1 + s * 0.7, CITY.bz[k] + (hash(k * 5 + m * 2) - 0.5) * (BLOCK - 0.5))
        o.scale.set(s, s * 1.15, s)
        o.updateMatrix()
        t.setMatrixAt(n, o.matrix)
        const g = TREE[Math.floor(r * TREE.length)]
        c.setRGB(g[0], g[1], g[2])
        t.setColorAt(n, c)
        n++
      }
    }
    t.count = n
    t.instanceMatrix.needsUpdate = true
    if (t.instanceColor) t.instanceColor.needsUpdate = true

    const tk = tanks.current!
    let q = 0
    for (const k of tankBlocks) {
      for (let m = 0; m < 4; m++) {
        const ox = (m % 2 ? 1 : -1) * 0.55
        const oz = (m < 2 ? 1 : -1) * 0.55
        const h = 0.6 + hash(k * 3 + m) * 0.4
        o.position.set(CITY.bx[k] + ox, 0.1 + h / 2, CITY.bz[k] + oz)
        o.scale.set(0.8, h, 0.8)
        o.updateMatrix()
        tk.setMatrixAt(q, o.matrix)
        c.setRGB(0.86, 0.85, 0.8)
        tk.setColorAt(q, c)
        q++
      }
    }
    tk.count = q
    tk.instanceMatrix.needsUpdate = true
    if (tk.instanceColor) tk.instanceColor.needsUpdate = true
  }, [parks, tankBlocks, dome])

  return (
    <>
      <instancedMesh ref={trees} args={[undefined, undefined, parks.length * 7]} frustumCulled={false}>
        <icosahedronGeometry args={[0.5, 0]} />
        <meshLambertMaterial />
      </instancedMesh>
      <instancedMesh ref={tanks} args={[undefined, undefined, Math.max(1, tankBlocks.length * 4)]} frustumCulled={false}>
        <cylinderGeometry args={[0.5, 0.5, 1, 14]} />
        <meshLambertMaterial />
      </instancedMesh>
      {dome !== undefined && (
        <group position={[CITY.bx[dome], 0.1, CITY.bz[dome]]} scale={1.25}>
          <mesh position={[0, 0.12, 0]}>
            <boxGeometry args={[2.1, 0.24, 2.1]} />
            <meshLambertMaterial color="#e6dfcf" />
          </mesh>
          <mesh position={[0, 0.7, 0]}>
            <boxGeometry args={[1.8, 0.95, 1.5]} />
            <meshLambertMaterial color="#efe3c6" />
          </mesh>
          <mesh position={[0, 1.43, 0]}>
            <cylinderGeometry args={[0.62, 0.66, 0.5, 20]} />
            <meshLambertMaterial color="#e9dcbc" />
          </mesh>
          <mesh position={[0, 1.68, 0]}>
            <sphereGeometry args={[0.63, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshLambertMaterial color="#d8bd7a" />
          </mesh>
          <mesh position={[0, 2.18, 0]}>
            <cylinderGeometry args={[0.07, 0.1, 0.35, 8]} />
            <meshLambertMaterial color="#f0e6c8" />
          </mesh>
        </group>
      )}
    </>
  )
}

/** 건물(모양별 6개 메시)과 블록 바닥. 상태가 바뀔 때만 색·점등 값을 다시 쓴다 */
export function Buildings({ snap, selection, onSelect }: { snap: CitySnap; selection: CitySelection; onSelect: (s: CitySelection) => void }) {
  const invalidate = useThree((s) => s.invalidate)
  const tiles = useRef<InstancedMesh>(null)
  const { material, uniforms } = useBuildingMaterial()

  // 모양별 메시: 위치·크기·팔레트 색·난수는 한 번만 쓴다
  const groups = useMemo(() => {
    const ids: number[][] = [[], [], [], [], [], []]
    for (let n = 0; n < CITY.nBuild; n++) ids[CITY.bType[n]].push(n)
    const o = new Object3D()
    const c = new Color()
    return ids.map((list, type) => {
      const geo = archetype(type)
      const lit = new Float32Array(Math.max(1, list.length))
      const seed = new Float32Array(Math.max(1, list.length))
      geo.setAttribute('aLit', new InstancedBufferAttribute(lit, 1))
      geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 1))
      const mesh = new InstancedMesh(geo, material, Math.max(1, list.length))
      mesh.count = list.length
      mesh.frustumCulled = false
      list.forEach((n, j) => {
        const z = CITY.zone[CITY.bBlock[n]]
        o.position.set(CITY.bx0[n], CITY.bh[n] / 2 + 0.1, CITY.bz0[n])
        o.rotation.set(0, 0, 0)
        o.scale.set(CITY.bw[n], CITY.bh[n], CITY.bd[n])
        o.updateMatrix()
        mesh.setMatrixAt(j, o.matrix)
        const p = PALETTE[z === 3 ? 0 : z][CITY.bPal[n] % 6]
        c.setRGB(p[0], p[1], p[2])
        mesh.setColorAt(j, c)
        seed[j] = CITY.bRand[n]
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()
      return { mesh, list, lit, geo }
    })
  }, [material])

  const blockIndex = useMemo(() => [...Array(CITY.nBlocks).keys()], [])
  useLayoutEffect(() => {
    const o = new Object3D()
    const t = tiles.current!
    blockIndex.forEach((k, n) => {
      o.position.set(CITY.bx[k], 0.05, CITY.bz[k])
      o.scale.set(BLOCK, 0.1, BLOCK)
      o.updateMatrix()
      t.setMatrixAt(n, o.matrix)
    })
    t.instanceMatrix.needsUpdate = true
    t.instanceColor = new InstancedBufferAttribute(new Float32Array(CITY.nBlocks * 3), 3)
    t.computeBoundingSphere()
  }, [blockIndex])

  const litFrac = useMemo(() => new Float32Array(CITY.nBlocks), [])
  const selKey = selection ? `${selection.kind}${selection.id}` : ''
  useEffect(() => {
    const t = tiles.current
    if (!t?.instanceColor) return
    const night = nightness(snap.time)
    uniforms.uNight.value = night
    const tc = t.instanceColor.array as Float32Array
    const { supplier, blockDemand } = cityLive
    const selFeeder = selection?.kind === 'feeder' ? selection.id : -1
    const selSub = selection?.kind === 'sub' ? selection.id : -1
    const tileTone = 1 - night * 0.6
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
      let b = td[2]
      if (noPower) {
        r = lerp(r, 0.55, 0.7)
        g = lerp(g, 0.06, 0.7)
        b = lerp(b, 0.06, 0.7)
      } else if (borrowed) {
        r = lerp(r, 0.1, 0.55)
        g = lerp(g, 0.35, 0.55)
        b = lerp(b, 0.95, 0.55)
      }
      if (hot) {
        r = lerp(r, 1, 0.4)
        g = lerp(g, 1, 0.4)
        b = lerp(b, 1, 0.4)
      }
      tc[i3] = r * tileTone
      tc[i3 + 1] = g * tileTone
      tc[i3 + 2] = b * tileTone
      const frac = CITY.baseKw[k] > 0 ? Math.min(1.25, blockDemand[k] / (CITY.baseKw[k] * 0.9)) : 0
      litFrac[k] = Math.min(1, 0.2 + frac * 0.85)
    }
    t.instanceColor.needsUpdate = true

    // 건물: 정전이면 -1, 아니면 창문이 켜질 비율
    for (const g of groups) {
      for (let j = 0; j < g.list.length; j++) {
        const k = CITY.bBlock[g.list[j]]
        g.lit[j] = supplier[k] < 0 ? -1 : litFrac[k]
      }
      ;(g.geo.getAttribute('aLit') as InstancedBufferAttribute).needsUpdate = true
    }
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.version, selKey])

  const pickTile = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return
    e.stopPropagation()
    const k = blockIndex[e.instanceId ?? -1]
    const f = k === undefined ? -1 : CITY.blockFeeder[k]
    onSelect(f >= 0 ? { kind: 'feeder', id: f } : null)
  }
  const pickBuilding = (list: number[]) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return
    e.stopPropagation()
    const n = list[e.instanceId ?? -1]
    const f = n === undefined ? -1 : CITY.blockFeeder[CITY.bBlock[n]]
    onSelect(f >= 0 ? { kind: 'feeder', id: f } : null)
  }

  return (
    <>
      <instancedMesh ref={tiles} args={[undefined, undefined, CITY.nBlocks]} onClick={pickTile} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshLambertMaterial />
      </instancedMesh>
      {groups.map((g, i) => (
        <primitive key={i} object={g.mesh} onClick={pickBuilding(g.list)} />
      ))}
    </>
  )
}
