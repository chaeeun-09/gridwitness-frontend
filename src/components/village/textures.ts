import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'

// 외부 이미지 없이 캔버스로 만드는 절차적 텍스처. 한 번 만들어 재사용.

const cache = new Map<string, CanvasTexture>()

function rng(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
}

function make(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number, r: () => number) => void): CanvasTexture {
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  draw(ctx, size, rng(key.length * 7919 + size))
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 8
  cache.set(key, t)
  return t
}

/** 같은 이미지를 공유하면서 반복 횟수만 다른 텍스처 */
export function tiled(t: Texture, rx: number, ry: number): Texture {
  const c = t.clone()
  c.repeat.set(rx, ry)
  c.needsUpdate = true
  return c
}

function speckle(ctx: CanvasRenderingContext2D, s: number, r: () => number, colors: string[], n: number, size: [number, number]) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)]
    const w = size[0] + r() * (size[1] - size[0])
    ctx.globalAlpha = 0.25 + r() * 0.5
    ctx.fillRect(r() * s, r() * s, w, w * (0.6 + r()))
  }
  ctx.globalAlpha = 1
}

export const grassTexture = () =>
  make('grass', 512, (ctx, s, r) => {
    ctx.fillStyle = '#5f9c45'
    ctx.fillRect(0, 0, s, s)
    // 큰 얼룩
    for (let i = 0; i < 40; i++) {
      const g = ctx.createRadialGradient(r() * s, r() * s, 0, r() * s, r() * s, 40 + r() * 80)
      g.addColorStop(0, r() > 0.5 ? 'rgba(140,190,100,0.35)' : 'rgba(70,120,55,0.3)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    }
    speckle(ctx, s, r, ['#4f8a38', '#76b255', '#43792f', '#88bf63'], 9000, [1, 3])
  })

export const asphaltTexture = () =>
  make('asphalt', 512, (ctx, s, r) => {
    ctx.fillStyle = '#50555c'
    ctx.fillRect(0, 0, s, s)
    speckle(ctx, s, r, ['#3e4248', '#60666e', '#6b7079', '#45494f'], 14000, [1, 2.5])
    // 보수 자국
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(40,43,48,0.25)'
      ctx.fillRect(r() * s, r() * s, 40 + r() * 90, 20 + r() * 50)
    }
  })

export const pavingTexture = () =>
  make('paving', 256, (ctx, s, r) => {
    ctx.fillStyle = '#d3cec4'
    ctx.fillRect(0, 0, s, s)
    const n = 4
    const step = s / n
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const l = 78 + r() * 8
        ctx.fillStyle = `hsl(40, 10%, ${l}%)`
        ctx.fillRect(x * step + 2, y * step + 2, step - 4, step - 4)
      }
    speckle(ctx, s, r, ['#bdb7ac', '#e2ded6'], 1500, [1, 2])
  })

export const soilTexture = () =>
  make('soil', 256, (ctx, s, r) => {
    const bands = ['#7a5a3c', '#6b4e33', '#856346', '#5f442d', '#735437']
    let y = 0
    while (y < s) {
      const h = 10 + r() * 30
      ctx.fillStyle = bands[Math.floor(r() * bands.length)]
      ctx.fillRect(0, y, s, h)
      y += h
    }
    speckle(ctx, s, r, ['#9c7a58', '#4a3524', '#a88a66'], 2500, [1, 4])
  })

export const shingleTexture = (base: string) =>
  make(`shingle${base}`, 256, (ctx, s, r) => {
    const c = new Color(base)
    ctx.fillStyle = base
    ctx.fillRect(0, 0, s, s)
    const rows = 8
    const rh = s / rows
    for (let y = 0; y < rows; y++) {
      const off = (y % 2) * (rh * 0.75)
      for (let x = -1; x < 6; x++) {
        const v = 0.85 + r() * 0.3
        ctx.fillStyle = `#${c.clone().multiplyScalar(v).getHexString()}`
        ctx.fillRect(x * rh * 1.5 + off + 1, y * rh + 1, rh * 1.5 - 2, rh - 2)
      }
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.fillRect(0, y * rh + rh - 3, s, 3)
    }
  })

export const sidingTexture = (base: string) =>
  make(`siding${base}`, 256, (ctx, s, r) => {
    ctx.fillStyle = base
    ctx.fillRect(0, 0, s, s)
    const rows = 16
    const rh = s / rows
    for (let y = 0; y < rows; y++) {
      ctx.fillStyle = 'rgba(0,0,0,0.07)'
      ctx.fillRect(0, y * rh + rh - 2, s, 2)
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.fillRect(0, y * rh, s, 1)
    }
    speckle(ctx, s, r, ['rgba(0,0,0,0.05)'], 600, [1, 3])
  })

export const gravelTexture = () =>
  make('gravel', 256, (ctx, s, r) => {
    ctx.fillStyle = '#a9a69f'
    ctx.fillRect(0, 0, s, s)
    speckle(ctx, s, r, ['#8d8a84', '#c4c1ba', '#76736d', '#b5b1a8'], 6000, [1.5, 4])
  })

/** 화면 배경용 세로 그라데이션 */
export function skyGradient(top: string, bottom: string): CanvasTexture {
  return make(`sky${top}${bottom}`, 512, (ctx, s) => {
    const g = ctx.createLinearGradient(0, 0, 0, s)
    g.addColorStop(0, top)
    g.addColorStop(1, bottom)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  })
}

/** 바닥 빛 번짐 (가산 혼합용 원형 그라데이션) */
export const glowTexture = () =>
  make('glow', 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  })

/** 바닥판 상자용 원목 */
export const woodTexture = () =>
  make('wood', 512, (ctx, s, r) => {
    ctx.fillStyle = '#c9a06a'
    ctx.fillRect(0, 0, s, s)
    for (let y = 0; y < s; y += 2) {
      const wave = Math.sin(y / 23) * 6 + Math.sin(y / 7) * 2
      ctx.fillStyle = `rgba(${120 + r() * 30}, ${80 + r() * 20}, ${40 + r() * 15}, ${0.05 + r() * 0.08})`
      ctx.fillRect(0, y + wave * 0.2, s, 1 + r() * 2)
    }
    for (let k = 0; k < 5; k++) {
      ctx.strokeStyle = 'rgba(110,70,35,0.18)'
      ctx.lineWidth = 2
      ctx.beginPath()
      const y0 = r() * s
      for (let x = 0; x <= s; x += 8) ctx.lineTo(x, y0 + Math.sin(x / 40 + k) * 10)
      ctx.stroke()
    }
  })

/** 브레드보드 윗면 (구멍 격자 + 전원 레일) */
export const breadboardTexture = () =>
  make('breadboard', 512, (ctx, s) => {
    ctx.fillStyle = '#f4f2ec'
    ctx.fillRect(0, 0, s, s)
    const rail = (y: number, color: string) => {
      ctx.fillStyle = color
      ctx.fillRect(16, y, s - 32, 3)
    }
    rail(18, '#d33'), rail(62, '#26c'), rail(s - 66, '#d33'), rail(s - 22, '#26c')
    ctx.fillStyle = '#b9b5ab'
    ctx.fillRect(16, s / 2 - 6, s - 32, 12)
    const hole = (x: number, y: number) => {
      ctx.fillStyle = '#4a4741'
      ctx.fillRect(x - 3, y - 3, 6, 6)
    }
    for (let x = 28; x < s - 20; x += 16) {
      for (const y of [32, 48, s - 52, s - 36]) hole(x, y)
      for (let y = 92; y < s / 2 - 14; y += 16) hole(x, y)
      for (let y = s / 2 + 22; y < s - 80; y += 16) hole(x, y)
    }
  })

// ── PCB 윗면 (실크 인쇄) ─────────────────────────────────
// 캔버스 위쪽 = 부품 뒤쪽(−z). 좌표는 부품 로컬 (x, z)를 비율로 변환해 그림.
type Silk = { text: string; x: number; z: number; size?: number; bold?: boolean; align?: CanvasTextAlign }

function pcb(key: string, w: number, d: number, base: string, silk: Silk[], extra?: (ctx: CanvasRenderingContext2D, W: number, H: number) => void) {
  return make(key, 1024, (ctx, s) => {
    const H = Math.round((s * d) / w)
    ctx.canvas.height = H
    ctx.fillStyle = base
    ctx.fillRect(0, 0, s, H)
    // 미세 패턴 (동박 배선 느낌)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 3
    for (let k = 0; k < 14; k++) {
      ctx.beginPath()
      const y = (k / 14) * H
      ctx.moveTo(0, y)
      ctx.lineTo(s * 0.3, y + 20)
      ctx.lineTo(s * 0.7, y + 20)
      ctx.stroke()
    }
    extra?.(ctx, s, H)
    ctx.fillStyle = 'rgba(255,255,255,0.92)'
    ctx.textBaseline = 'middle'
    for (const t of silk) {
      ctx.font = `${t.bold ? 800 : 600} ${t.size ?? 26}px 'Wanted Sans Variable', sans-serif`
      ctx.textAlign = t.align ?? 'center'
      ctx.fillText(t.text, (t.x / w + 0.5) * s, (t.z / d + 0.5) * H)
    }
  })
}

export const ARDUINO_SIZE = { w: 6.2, d: 4.6 }
export const arduinoTexture = () => {
  const { w, d } = ARDUINO_SIZE
  const digital = ['AREF', 'GND', '13', '12', '~11', '~10', '~9', '8', '7', '~6', '~5', '4', '~3', '2', 'TX1', 'RX0']
  const power = ['IOREF', 'RESET', '3.3V', '5V', 'GND', 'GND', 'VIN']
  const analog = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']
  const silk: Silk[] = [
    { text: 'UNO', x: 1.2, z: -0.3, size: 96, bold: true },
    { text: 'ARDUINO', x: 1.2, z: 0.45, size: 40, bold: true },
    { text: 'DIGITAL (PWM ~)', x: 0.9, z: -1.55, size: 22 },
    { text: 'POWER', x: -0.15, z: 1.6, size: 22 },
    { text: 'ANALOG IN', x: 2.05, z: 1.6, size: 22 },
    { text: 'ON', x: -1.05, z: -0.75, size: 20 },
    ...digital.map((t, k) => ({ text: t, x: ARDUINO_PIN.digitalX(k), z: -1.82, size: 15 })),
    ...power.map((t, k) => ({ text: t, x: ARDUINO_PIN.powerX(k), z: 1.82, size: 15 })),
    ...analog.map((t, k) => ({ text: t, x: ARDUINO_PIN.analogX(k), z: 1.82, size: 15 })),
  ]
  return pcb('arduino', w, d, '#0d6e8e', silk)
}
/** Arduino 헤더 핀 x 위치 (로컬) */
export const ARDUINO_PIN = {
  digitalX: (k: number) => -1.25 + k * 0.255,
  powerX: (k: number) => -0.9 + k * 0.255,
  analogX: (k: number) => 1.4 + k * 0.255,
  headerZ: { back: -2.05, front: 2.05 },
}

export const RELAY_SIZE = { w: 5.0, d: 2.6 }
export const relayTexture = () => {
  const { w, d } = RELAY_SIZE
  return pcb('relay', w, d, '#c3232c', [
    { text: '1 Relay Module', x: 0.2, z: 1.0, size: 28, bold: true },
    { text: 'High level trigger', x: 0.2, z: -1.0, size: 22 },
    { text: 'VCC', x: -2.0, z: -0.55, size: 20, align: 'left' },
    { text: 'GND', x: -2.0, z: 0, size: 20, align: 'left' },
    { text: 'IN', x: -2.0, z: 0.55, size: 20, align: 'left' },
    { text: 'NO', x: 1.65, z: -0.6, size: 20, align: 'right' },
    { text: 'COM', x: 1.65, z: 0, size: 20, align: 'right' },
    { text: 'NC', x: 1.65, z: 0.6, size: 20, align: 'right' },
  ])
}

export const INA_SIZE = { w: 2.6, d: 2.0 }
export const inaTexture = () => {
  const { w, d } = INA_SIZE
  const pins = ['VCC', 'GND', 'SCL', 'SDA', 'Vin−', 'Vin+']
  return pcb('ina219', w, d, '#1f45a6', [
    { text: 'INA219', x: 0.25, z: 0.05, size: 46, bold: true },
    { text: 'Vin+', x: -0.35, z: -0.3, size: 26 },
    { text: 'Vin−', x: 0.35, z: -0.3, size: 26 },
    ...pins.map((t, k) => ({ text: t, x: -0.95 + k * 0.38, z: 0.62, size: 22 })),
  ])
}
