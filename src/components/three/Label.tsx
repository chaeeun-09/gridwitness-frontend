import { Billboard } from '@react-three/drei'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CanvasTexture, LinearFilter } from 'three'

interface Props {
  lines: string[]
  position: [number, number, number]
  /** 월드 단위 글자 줄 높이 */
  lineHeight?: number
  color?: string
  bg?: string
  border?: string
  /** 말풍선 꼬리 */
  pointer?: boolean
  bold?: boolean
}

const SCALE = 4

/**
 * DOM 오버레이 대신 캔버스 텍스처 라벨 (언마운트 경합 없음, 폰트 다운로드 없음).
 * 글자가 바뀌면 같은 캔버스·텍스처에 다시 그리고 크기는 scale로만 바꿔 GPU 자원을 새로 만들지 않음.
 */
export default function Label({ lines, position, lineHeight = 0.36, color = '#ffffff', bg, border, pointer = false, bold = true }: Props) {
  const [tex] = useState(() => {
    const t = new CanvasTexture(document.createElement('canvas'))
    t.minFilter = LinearFilter
    t.generateMipmaps = false
    return t
  })
  const [size, setSize] = useState<[number, number]>([1, 1])
  const key = lines.join('\n')
  const last = useRef('')

  useLayoutEffect(() => {
    const sig = `${key}|${color}|${bg}|${border}|${pointer}|${bold}`
    if (sig === last.current) return
    last.current = sig
    const canvas = tex.image as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const fontPx = 14 * SCALE
    const font = (i: number) => `${bold || i === 0 ? 700 : 600} ${fontPx}px 'Wanted Sans Variable', -apple-system, 'Apple SD Gothic Neo', sans-serif`
    const padX = bg ? 14 * SCALE : 4 * SCALE
    const padY = bg ? 8 * SCALE : 2 * SCALE
    const lineGap = fontPx * 1.3
    const tail = pointer ? 8 * SCALE : 0
    const textW = Math.max(...lines.map((l, i) => ((ctx.font = font(i)), ctx.measureText(l).width)))
    const w = Math.ceil(textW + padX * 2)
    const boxH = Math.ceil(lines.length * lineGap + padY * 2)
    const h = boxH + tail
    // 캔버스 크기가 바뀔 때만 텍스처를 다시 할당
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
      tex.dispose()
    } else {
      ctx.clearRect(0, 0, w, h)
    }
    if (bg) {
      const r = 8 * SCALE
      ctx.beginPath()
      ctx.roundRect(2, 2, w - 4, boxH - 4, r)
      if (pointer) {
        ctx.moveTo(w / 2 - tail, boxH - 4)
        ctx.lineTo(w / 2, boxH + tail - 4)
        ctx.lineTo(w / 2 + tail, boxH - 4)
      }
      ctx.fillStyle = bg
      ctx.fill()
      if (border) {
        ctx.lineWidth = 2 * SCALE
        ctx.strokeStyle = border
        ctx.beginPath()
        ctx.roundRect(SCALE, SCALE, w - 2 * SCALE, boxH - 2 * SCALE, r)
        ctx.stroke()
      }
    }
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    lines.forEach((l, i) => {
      ctx.font = font(i)
      ctx.fillText(l, w / 2, padY + lineGap * (i + 0.5))
    })
    tex.needsUpdate = true
    const worldH = (h / lineGap) * lineHeight
    setSize((prev) => (prev[0] === (w / h) * worldH && prev[1] === worldH ? prev : [(w / h) * worldH, worldH]))
    // lines는 key로 비교
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, color, bg, border, pointer, bold, lineHeight, tex])

  useEffect(() => () => tex.dispose(), [tex])

  return (
    <Billboard position={position}>
      <mesh position={[0, pointer ? size[1] / 2 : 0, 0]} scale={[size[0], size[1], 1]} renderOrder={10}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={tex} transparent depthWrite={false} depthTest={false} toneMapped={false} />
      </mesh>
    </Billboard>
  )
}
