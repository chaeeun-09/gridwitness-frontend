import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import Label from './Label'

/** 집·가로등 위로 뜨는 말풍선. 위아래로 살짝 흔들리고, 새로 나타날 때 튀어나옴 */
export default function SpeechBubble({ text, y, tone = 'warn' }: { text: string; y: number; tone?: 'warn' | 'err' }) {
  const ref = useRef<Group>(null)
  const born = useRef(performance.now())
  useFrame(({ clock }) => {
    const g = ref.current
    if (!g) return
    const age = Math.min(1, (performance.now() - born.current) / 260)
    const pop = 1 - Math.pow(1 - age, 3)
    g.scale.setScalar(0.4 + 0.6 * pop)
    g.position.y = y + Math.sin(clock.elapsedTime * 3.2) * 0.12
  })
  return (
    <group ref={ref} position={[0, y, 0]}>
      <Label
        lines={[text]}
        position={[0, 0, 0]}
        bg="rgba(255,255,255,0.97)"
        color={tone === 'err' ? '#b3261e' : '#14161b'}
        border={tone === 'err' ? 'rgba(207,52,52,0.55)' : 'rgba(20,22,27,0.18)'}
        pointer
        lineHeight={0.62}
      />
    </group>
  )
}
