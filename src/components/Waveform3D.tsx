import { Grid, Line, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef, useState } from 'react'
import type { Mesh } from 'three'
import { preprocess } from '../lib/waveform'
import { CHANNELS } from '../types'
import Label from './three/Label'
import { COLORS } from './WaveformChart'

const X_SPAN = 12
const Z_GAP = 1.3
const Y_SCALE = 1.1

/** 한 주기 RMS가 처음 주기의 2배를 넘는 첫 지점 (시각화용 표시, 판정 아님) */
function findChangePoint(m: number[][], fs: number, f: number): number | null {
  const win = Math.round(fs / f)
  const rms = (s: number) => {
    let acc = 0
    for (let i = s; i < s + win; i++) for (let j = 0; j < 3; j++) acc += m[i][j] ** 2
    return Math.sqrt(acc / (win * 3))
  }
  if (m.length < win * 2) return null
  const base = rms(0)
  for (let s = win; s + win <= m.length; s += Math.round(win / 4)) {
    if (rms(s) > base * 2) return s
  }
  return null
}

function Playhead({ playing, onPos }: { playing: boolean; onPos: (x: number) => void }) {
  const ref = useRef<Mesh>(null)
  useFrame((_, dt) => {
    if (!ref.current || !playing) return
    let x = ref.current.position.x + dt * 2.2
    if (x > X_SPAN / 2) x = -X_SPAN / 2
    ref.current.position.x = x
    onPos(x)
  })
  return (
    <mesh ref={ref} position={[-X_SPAN / 2, 0, 0]}>
      <planeGeometry args={[0.03, Y_SCALE * 2.4]} />
      <meshBasicMaterial color="#ffd43b" transparent opacity={0.9} />
    </mesh>
  )
}

export default function Waveform3D({ matrix, samplingRateHz, systemFrequencyHz }: { matrix: number[][]; samplingRateHz: number; systemFrequencyHz: number }) {
  const [playing, setPlaying] = useState(true)
  const cursorRef = useRef<HTMLSpanElement>(null)
  const durationMs = (matrix.length / samplingRateHz) * 1000

  const lines = useMemo(() => {
    const m = preprocess(matrix)
    const step = Math.max(1, Math.floor(m.length / 800))
    return CHANNELS.map((c, j) => {
      const z = (j - (CHANNELS.length - 1) / 2) * Z_GAP
      const pts: [number, number, number][] = []
      for (let i = 0; i < m.length; i += step) {
        pts.push([(i / (m.length - 1) - 0.5) * X_SPAN, m[i][j] * Y_SCALE, z])
      }
      return { c, z, pts }
    })
  }, [matrix])

  const change = useMemo(() => findChangePoint(matrix, samplingRateHz, systemFrequencyHz), [matrix, samplingRateHz, systemFrequencyHz])
  const changeX = change == null ? null : (change / (matrix.length - 1) - 0.5) * X_SPAN
  const zMax = ((CHANNELS.length - 1) / 2) * Z_GAP + 0.6

  return (
    <div className="w3d">
      <div className="w3d-toolbar">
        <button className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? '⏸ 일시정지' : '▶ 재생'}</button>
        <span className="mono small">t = <span ref={cursorRef}>0.0</span> ms / {durationMs.toFixed(1)} ms</span>
        <span className="hint" style={{ margin: 0 }}>드래그: 회전 · 휠: 확대 · 우클릭 드래그: 이동</span>
      </div>
      <Canvas camera={{ position: [9, 7, 14], fov: 42 }} dpr={[1, 2]}>
        <color attach="background" args={['#0f1d2e']} />
        <ambientLight intensity={0.8} />
        <Grid
          position={[0, -Y_SCALE - 0.3, 0]}
          args={[X_SPAN + 2, zMax * 2 + 2]}
          cellSize={0.5}
          sectionSize={2}
          cellColor="#24384f"
          sectionColor="#35557a"
          fadeDistance={40}
          infiniteGrid={false}
        />
        {lines.map(({ c, z, pts }) => (
          <group key={c}>
            <Line points={pts} color={COLORS[c]} lineWidth={1.6} />
            <Line points={[[-X_SPAN / 2, 0, z], [X_SPAN / 2, 0, z]]} color="#2c4562" lineWidth={0.6} />
            <Label lines={[c]} position={[-X_SPAN / 2 - 0.5, 0, z]} color={COLORS[c]} lineHeight={0.3} />
          </group>
        ))}
        {changeX != null && (
          <group position={[changeX, 0, 0]}>
            <mesh rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[zMax * 2, Y_SCALE * 2.4]} />
              <meshBasicMaterial color="#ff6b6b" transparent opacity={0.12} depthWrite={false} side={2} />
            </mesh>
            <Label lines={[`급변 지점 · ${((change! / samplingRateHz) * 1000).toFixed(1)} ms`]} position={[0, Y_SCALE * 1.4, -zMax]} color="#ff8787" bg="rgba(15,29,46,0.85)" lineHeight={0.26} />
          </group>
        )}
        <group position={[0, 0, zMax]}>
          <Playhead playing={playing} onPos={(x) => {
            if (cursorRef.current) cursorRef.current.textContent = ((x / X_SPAN + 0.5) * durationMs).toFixed(1)
          }} />
        </group>
        <Label lines={['시간 →']} position={[X_SPAN / 2 + 0.6, -Y_SCALE - 0.3, zMax]} color="#b8c4d4" lineHeight={0.3} />
        <OrbitControls makeDefault enableDamping target={[0, 0, 0]} />
      </Canvas>
      <p className="hint">채널별 max-abs 정규화 후 표시. 붉은 면은 전류 RMS가 첫 주기의 2배를 넘은 지점으로, 시각적 참고용이며 판정이 아닙니다.</p>
    </div>
  )
}
