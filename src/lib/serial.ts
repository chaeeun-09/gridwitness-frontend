// Web Serial로 Arduino와 통신 (Chrome·Edge 지원).
// 프로토콜 (115200 baud, 줄 단위):
//   장치 → 웹 (0.5초마다):
//     {"v":5.02,"i":0.281,"relay":1,"ch":[1,1,1,1,1],"vh":5.02,"ih":0.168,"vl":5.01,"il":0.113}
//     v·i 마을 전체 · relay 마을 전원 · ch 채널 1~5 릴레이 · vh·ih 주택 구간(INA219 0x40) · vl·il 가로등 구간(0x41)
//     ch·구간 값이 없는 예전 장치({"v","i","relay"}만)도 받음
//   웹 → 장치: RELAY <0|1>   마을 전체 전원 차단·복구 (D2)
//              CH <1~5> <0|1> 채널 하나 끄기·켜기 (D3~D7)

export interface ZoneReading {
  v: number
  i: number
}

export interface SerialReading {
  v: number
  i: number
  relay: boolean
  /** 채널 1~5 릴레이 상태. 예전 장치는 없음 */
  ch?: boolean[]
  /** 구간별 측정 (주택 = INA219 0x40, 가로등 = 0x41). 예전 장치는 없음 */
  zones?: { house: ZoneReading; lamp: ZoneReading }
}

export interface SerialLink {
  write(line: string): Promise<void>
  close(): Promise<void>
}

// TS DOM 타입에 Web Serial이 없어 필요한 부분만 선언
interface SerialPortLike {
  open(opts: { baudRate: number }): Promise<void>
  setSignals?(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  /** USB 장치면 제조사·제품 번호가 있음. 블루투스 직렬 포트에는 없음 */
  getInfo?(): { usbVendorId?: number; usbProductId?: number }
}
interface SerialLike {
  requestPort(opts?: { filters: { usbVendorId: number }[] }): Promise<SerialPortLike>
  /** 사용자가 이전에 허용한 포트 (허용 창 없이 얻음) */
  getPorts?(): Promise<SerialPortLike[]>
  addEventListener?(type: 'connect' | 'disconnect', cb: () => void): void
  removeEventListener?(type: 'connect' | 'disconnect', cb: () => void): void
}

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator

/** 한 줄을 측정값으로 해석. 형식이 틀리면 null */
export function parseFrame(line: string): SerialReading | null {
  try {
    // Arduino는 계산이 안 된 실수를 nan·inf로 찍어 JSON이 깨지므로 0으로 바꿔 읽는다
    const obj = JSON.parse(line.replace(/:\s*-?(nan|inf)\b/gi, ':0')) as Record<string, unknown>
    const v = Number(obj.v)
    const i = Number(obj.i)
    if (!Number.isFinite(v) || !Number.isFinite(i) || obj.relay === undefined) return null
    const out: SerialReading = { v, i, relay: Number(obj.relay) === 1 }
    if (Array.isArray(obj.ch)) {
      if (obj.ch.length !== 5) return null
      out.ch = obj.ch.map((x) => Number(x) === 1)
    }
    const z = ['vh', 'ih', 'vl', 'il'].map((k) => Number(obj[k]))
    if (obj.ih !== undefined) {
      if (!z.every(Number.isFinite)) return null
      out.zones = { house: { v: z[0], i: z[1] }, lamp: { v: z[2], i: z[3] } }
    }
    return out
  } catch {
    return null
  }
}

/** 아두이노에 쓰이는 USB 직렬 칩 제조사 번호: Arduino · Arduino.org · CH340 · FTDI · CP210x.
 *  포트 선택 창에 이것만 보여서 블루투스 직렬 포트(COM 여러 개)와 헷갈리지 않게 한다 */
const BOARD_VIDS = [0x2341, 0x2a03, 0x1a86, 0x0403, 0x10c4]
const vidOf = (p: SerialPortLike) => p.getInfo?.().usbVendorId

/** 허용된 포트가 없을 때 던지는 오류 메시지 (자동 재연결이 조용히 넘어가도록) */
export const NO_GRANTED_PORT = 'NO_GRANTED_PORT'

/** USB 장치가 꽂히면 알려줌. 해제 함수를 돌려줌 */
export function onSerialPlug(cb: () => void): () => void {
  const serial = (navigator as unknown as { serial?: SerialLike }).serial
  serial?.addEventListener?.('connect', cb)
  return () => serial?.removeEventListener?.('connect', cb)
}

/**
 * 시리얼 포트를 열어 줄 단위로 읽는다.
 * mode 'ask': 포트 선택 창을 띄움 / 'granted': 이전에 허용한 포트를 창 없이 엶 (자동 재연결)
 */
export async function openSerial(onLine: (line: string) => void, onClose: (reason: string) => void, mode: 'ask' | 'granted' = 'ask'): Promise<SerialLink> {
  const serial = (navigator as unknown as { serial: SerialLike }).serial
  let port: SerialPortLike
  if (mode === 'granted') {
    // 예전에 허용한 포트 중 아두이노(USB)만, 아는 칩 먼저. 블루투스 포트를 잘못 열고 멈추지 않게 하나씩 시도한다
    const ports = ((await serial.getPorts?.()) ?? []).filter((p) => vidOf(p) !== undefined)
    ports.sort((a, b) => Number(!BOARD_VIDS.includes(vidOf(a)!)) - Number(!BOARD_VIDS.includes(vidOf(b)!)))
    if (ports.length === 0) throw new Error(NO_GRANTED_PORT)
    let opened: SerialPortLike | null = null
    let lastErr: unknown = null
    for (const p of ports) {
      try {
        await p.open({ baudRate: 115200 })
        opened = p
        break
      } catch (e) {
        lastErr = e
      }
    }
    if (!opened) throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
    port = opened
  } else {
    port = await serial.requestPort({ filters: BOARD_VIDS.map((usbVendorId) => ({ usbVendorId })) })
    await port.open({ baudRate: 115200 })
  }
  if (!port.readable || !port.writable) throw new Error('포트를 열 수 없습니다.')
  // 일부 보드·브라우저는 DTR을 켜야 데이터를 보낸다 (지원하지 않으면 무시)
  await port.setSignals?.({ dataTerminalReady: true, requestToSend: true }).catch(() => {})

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
