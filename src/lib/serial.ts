// Web Serial로 Arduino와 통신 (Chrome·Edge 지원).
// 프로토콜 (115200 baud, 줄 단위):
//   장치 → 웹: {"v":5.02,"i":0.281,"relay":1}   (INA219 전체 전압·전류, 릴레이 상태, 0.5초마다)
//   웹 → 장치: RELAY <0|1>                     (D2 릴레이로 마을 전체 전원 차단·복구)

export interface SerialReading {
  v: number
  i: number
  relay: boolean
}

export interface SerialLink {
  write(line: string): Promise<void>
  close(): Promise<void>
}

// TS DOM 타입에 Web Serial이 없어 필요한 부분만 선언
interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>
}

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator

/** 한 줄을 측정값으로 해석. 형식이 틀리면 null */
export function parseFrame(line: string): SerialReading | null {
  try {
    const obj = JSON.parse(line) as { v?: unknown; i?: unknown; relay?: unknown }
    const v = Number(obj.v)
    const i = Number(obj.i)
    if (!Number.isFinite(v) || !Number.isFinite(i) || obj.relay === undefined) return null
    return { v, i, relay: Number(obj.relay) === 1 }
  } catch {
    return null
  }
}

export async function openSerial(onLine: (line: string) => void, onClose: (reason: string) => void): Promise<SerialLink> {
  const serial = (navigator as unknown as { serial: SerialLike }).serial
  const port = await serial.requestPort()
  await port.open({ baudRate: 115200 })
  if (!port.readable || !port.writable) throw new Error('포트를 열 수 없습니다.')

  const reader = port.readable.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader()
  const writer = port.writable.getWriter()
  const encoder = new TextEncoder()
  let closed = false

  ;(async () => {
    let buf = ''
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += value
        let nl: number
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim()
          buf = buf.slice(nl + 1)
          if (line) onLine(line)
        }
      }
      if (!closed) onClose('장치 연결이 끊겼습니다.')
    } catch (e) {
      if (!closed) onClose(`수신 오류: ${(e as Error).message}`)
    }
  })()

  return {
    write: (line) => writer.write(encoder.encode(`${line}\n`)),
    async close() {
      closed = true
      await reader.cancel().catch(() => {})
      writer.releaseLock()
      await port.close().catch(() => {})
    },
  }
}
