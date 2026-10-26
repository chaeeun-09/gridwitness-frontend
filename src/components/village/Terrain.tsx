import { RoundedBox } from '@react-three/drei'
import { memo, useMemo } from 'react'
import { A_NORTH, A_SOUTH, B_EAST, B_WEST, BOX_FLOOR, DECK_BOTTOM, GROUND_D, GROUND_W, ROAD_A_Z, ROAD_B_END, ROAD_B_X, ROAD_W, SIDEWALKS } from './layout'
import { asphaltTexture, grassTexture, pavingTexture, soilTexture, tiled, woodTexture } from './textures'

const flat = [-Math.PI / 2, 0, 0] as const

/** 지면 판 (흙·잔디). 지하 배선 보기에서는 이 판이 통째로 들어 올려짐 */
function Deck() {
  const grass = useMemo(() => tiled(grassTexture(), GROUND_W / 8, GROUND_D / 8), [])
  const soil = useMemo(() => tiled(soilTexture(), 6, 0.3), [])
  return (
    <group>
      <RoundedBox args={[GROUND_W, 0.5, GROUND_D]} radius={0.12} smoothness={3} position={[0, -0.4, 0]} receiveShadow>
        <meshStandardMaterial map={soil} roughness={1} />
      </RoundedBox>
      <RoundedBox args={[GROUND_W + 0.02, 0.3, GROUND_D + 0.02]} radius={0.14} smoothness={3} position={[0, -0.15, 0]} receiveShadow>
        <meshStandardMaterial color="#5f9a4a" roughness={1} />
      </RoundedBox>
      <mesh rotation={flat} position={[0, 0.002, 0]} receiveShadow>
        <planeGeometry args={[GROUND_W - 0.2, GROUND_D - 0.2]} />
        <meshStandardMaterial map={grass} roughness={1} />
      </mesh>
    </group>
  )
}

/** 지면 판 아래 배선이 들어가는 원목 상자. open이면 앞판을 열어 내부를 보여줌 */
export const WiringBox = memo(function WiringBox({ open }: { open: boolean }) {
  const wood = useMemo(() => tiled(woodTexture(), 4, 1), [])
  const woodFloor = useMemo(() => tiled(woodTexture(), 4, 3), [])
  const boxH = DECK_BOTTOM - BOX_FLOOR
  const t = 0.4
  return (
    <group>
      <mesh position={[0, BOX_FLOOR - 0.15, 0]}>
        <boxGeometry args={[GROUND_W, 0.3, GROUND_D]} />
        <meshStandardMaterial map={woodFloor} roughness={0.85} />
      </mesh>
      <mesh position={[0, BOX_FLOOR + boxH / 2, -GROUND_D / 2 + t / 2]}>
        <boxGeometry args={[GROUND_W, boxH, t]} />
        <meshStandardMaterial map={wood} roughness={0.85} />
      </mesh>
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[(sx * (GROUND_W - t)) / 2, BOX_FLOOR + boxH / 2, 0]}>
          <boxGeometry args={[t, boxH, GROUND_D]} />
          <meshStandardMaterial map={wood} roughness={0.85} />
        </mesh>
      ))}
      {!open && (
        <mesh position={[0, BOX_FLOOR + boxH / 2, GROUND_D / 2 - t / 2]}>
          <boxGeometry args={[GROUND_W, boxH, t]} />
          <meshStandardMaterial map={wood} roughness={0.85} />
        </mesh>
      )}
    </group>
  )
})

function Roads() {
  const roadA = useMemo(() => tiled(asphaltTexture(), GROUND_W / 4, 1), [])
  const roadB = useMemo(() => tiled(asphaltTexture(), 1, (A_NORTH - ROAD_B_END) / 4), [])
  const paving = useMemo(() => pavingTexture(), [])
  const lenB = A_NORTH - ROAD_B_END

  return (
    <group>
      <mesh rotation={flat} position={[0, 0.01, ROAD_A_Z]} receiveShadow>
        <planeGeometry args={[GROUND_W - 0.2, ROAD_W]} />
        <meshStandardMaterial map={roadA} roughness={0.95} />
      </mesh>
      <mesh rotation={flat} position={[ROAD_B_X, 0.011, (ROAD_B_END + A_NORTH) / 2 + 0.05]} receiveShadow>
        <planeGeometry args={[ROAD_W, lenB - 0.1]} />
        <meshStandardMaterial map={roadB} roughness={0.95} />
      </mesh>

      {/* 인도 + 연석 */}
      {SIDEWALKS.map(([x, z, w, d], k) => (
        <mesh key={k} position={[x, 0.06, z]} receiveShadow castShadow>
          <boxGeometry args={[w, 0.12, d]} />
          <meshStandardMaterial map={tiledOnce(paving, w / 1.4, d / 1.4)} roughness={1} />
        </mesh>
      ))}

      {/* 중앙선 (노란 실선 2줄) */}
      {[-0.07, 0.07].map((dz) => (
        <group key={dz}>
          <mesh rotation={flat} position={[(-GROUND_W / 2 + B_WEST - 1.6) / 2, 0.02, ROAD_A_Z + dz]}>
            <planeGeometry args={[B_WEST - 1.6 + GROUND_W / 2 - 0.3, 0.07]} />
            <meshStandardMaterial color="#f2c230" roughness={0.6} />
          </mesh>
          <mesh rotation={flat} position={[(GROUND_W / 2 + B_EAST + 1.6) / 2, 0.02, ROAD_A_Z + dz]}>
            <planeGeometry args={[GROUND_W / 2 - B_EAST - 1.6 - 0.3, 0.07]} />
            <meshStandardMaterial color="#f2c230" roughness={0.6} />
          </mesh>
        </group>
      ))}
      {/* 남북 도로 점선 */}
      {Array.from({ length: Math.floor((lenB - 3) / 2) }, (_, k) => A_NORTH - 2.6 - k * 2).map((z) => (
        <mesh key={z} rotation={flat} position={[ROAD_B_X, 0.021, z]}>
          <planeGeometry args={[0.1, 1]} />
          <meshStandardMaterial color="#f8f9fa" roughness={0.6} />
        </mesh>
      ))}
      {/* 차선 경계 (흰 실선) */}
      {[A_NORTH + 0.12, A_SOUTH - 0.12].map((z) => (
        <mesh key={z} rotation={flat} position={[0, 0.02, z]}>
          <planeGeometry args={[GROUND_W - 0.4, 0.05]} />
          <meshStandardMaterial color="#e9ecef" roughness={0.6} />
        </mesh>
      ))}

      {/* 횡단보도 */}
      <Crosswalk x={B_WEST - 1.0} z={ROAD_A_Z} along="z" />
      <Crosswalk x={B_EAST + 1.0} z={ROAD_A_Z} along="z" />
      <Crosswalk x={ROAD_B_X} z={A_NORTH - 1.0} along="x" />
    </group>
  )
}

const tiledCache = new Map<string, ReturnType<typeof tiled>>()
function tiledOnce(t: ReturnType<typeof pavingTexture>, rx: number, ry: number) {
  const key = `${rx.toFixed(2)}x${ry.toFixed(2)}`
  if (!tiledCache.has(key)) tiledCache.set(key, tiled(t, rx, ry))
  return tiledCache.get(key)!
}

function Crosswalk({ x, z, along }: { x: number; z: number; along: 'x' | 'z' }) {
  const n = 6
  const gap = ROAD_W / n
  return (
    <group position={[x, 0.022, z]}>
      {Array.from({ length: n }, (_, k) => {
        const o = -ROAD_W / 2 + gap * (k + 0.5)
        return (
          <mesh key={k} rotation={flat} position={along === 'z' ? [0, 0, o] : [o, 0, 0]}>
            <planeGeometry args={along === 'z' ? [1.2, gap * 0.55] : [gap * 0.55, 1.2]} />
            <meshStandardMaterial color="#f1f3f5" roughness={0.7} />
          </mesh>
        )
      })}
    </group>
  )
}

export default memo(function Terrain() {
  return (
    <group>
      <Deck />
      <Roads />
    </group>
  )
})
