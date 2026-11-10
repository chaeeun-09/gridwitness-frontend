import { memo, useMemo } from 'react'
import { Color, Object3D, type InstancedMesh } from 'three'
import { GROUND_D, GROUND_W, HOUSE_POS, LAMP_POS, POLES, ROAD_A_Z, ROAD_B_X, ROAD_W, rng } from './layout'

type Tree = { x: number; z: number; s: number; round: boolean; tint: number }

/** 침엽수 + 둥근 활엽수 (인스턴싱, 나무마다 색 약간씩 다름) */
export default memo(function Trees() {
  const trees = useMemo(() => {
    const r = rng(42)
    const blocked = (x: number, z: number) =>
      Math.abs(z - ROAD_A_Z) < ROAD_W / 2 + 1.3 ||
      (Math.abs(x - ROAD_B_X) < ROAD_W / 2 + 1.3 && z < ROAD_A_Z) ||
      Object.values(HOUSE_POS).some(({ pos }) => Math.hypot(x - pos[0], z - pos[2]) < 4.2) ||
      POLES.some((p) => Math.hypot(x - p[0], z - p[2]) < 1.2) ||
      Object.values(LAMP_POS).some(({ pos }) => Math.hypot(x - pos[0], z - pos[2]) < 1.2)
    const out: Tree[] = []
    let guard = 0
    while (out.length < 80 && guard++ < 5000) {
      const x = -GROUND_W / 2 + 1.2 + r() * (GROUND_W - 2.4)
      const z = -GROUND_D / 2 + 1.2 + r() * (GROUND_D - 2.4)
      if (!blocked(x, z) && out.every((o) => Math.hypot(o.x - x, o.z - z) > 1.7)) {
        out.push({ x, z, s: 0.75 + r() * 0.6, round: r() < 0.6, tint: r() })
      }
    }
    return out
  }, [])
  const conifers = trees.filter((t) => !t.round)
  const rounds = trees.filter((t) => t.round)
  const blobs = rounds.flatMap((t) => [
    { t, dx: 0, dy: 2.05, dz: 0, k: 1 },
    { t, dx: 0.5, dy: 1.65, dz: 0.2, k: 0.72 },
    { t, dx: -0.45, dy: 1.7, dz: -0.25, k: 0.7 },
    { t, dx: 0.05, dy: 1.75, dz: 0.5, k: 0.62 },
  ])

  const place = (m: InstancedMesh | null, items: Tree[], y: number, sy = 1, light: number | null = 0.3) => {
    if (!m) return
    const d = new Object3D()
    items.forEach((t, k) => {
      d.position.set(t.x, y * t.s, t.z)
      d.scale.set(t.s, t.s * sy, t.s)
      d.rotation.set(0, t.tint * 6, 0)
      d.updateMatrix()
      m.setMatrixAt(k, d.matrix)
      if (light !== null) m.setColorAt(k, new Color().setHSL(0.33 + t.tint * 0.05, 0.55, light - 0.04 + t.tint * 0.07))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }
  const placeBlobs = (m: InstancedMesh | null) => {
    if (!m) return
    const d = new Object3D()
    blobs.forEach(({ t, dx, dy, dz, k }, i) => {
      d.position.set(t.x + dx * t.s, dy * t.s, t.z + dz * t.s)
      d.scale.setScalar(t.s * k)
      d.rotation.set(t.tint * 3 + i, t.tint * 5, 0)
      d.updateMatrix()
      m.setMatrixAt(i, d.matrix)
      m.setColorAt(i, new Color().setHSL(0.24 + t.tint * 0.07, 0.6, 0.3 + t.tint * 0.09 + (k < 1 ? -0.04 : 0)))
    })
    m.instanceMatrix.needsUpdate = true
    if (m.instanceColor) m.instanceColor.needsUpdate = true
  }

  return (
    <group>
      <instancedMesh ref={(m) => place(m, trees, 0.6, 1.2, null)} args={[undefined, undefined, trees.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.09, 0.15, 1, 7]} />
        <meshStandardMaterial color="#6b4f35" roughness={1} />
      </instancedMesh>
      <instancedMesh ref={(m) => place(m, conifers, 1.7, 1, 0.27)} args={[undefined, undefined, conifers.length]} castShadow receiveShadow>
        <coneGeometry args={[0.85, 1.7, 8]} />
        <meshStandardMaterial flatShading roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={(m) => place(m, conifers, 2.55, 1, 0.31)} args={[undefined, undefined, conifers.length]} castShadow receiveShadow>
        <coneGeometry args={[0.62, 1.35, 8]} />
        <meshStandardMaterial flatShading roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={placeBlobs} args={[undefined, undefined, blobs.length]} castShadow receiveShadow>
        <icosahedronGeometry args={[0.8, 1]} />
        <meshStandardMaterial flatShading roughness={0.9} />
      </instancedMesh>
    </group>
  )
})
