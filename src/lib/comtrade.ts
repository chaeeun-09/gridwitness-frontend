import { CHANNELS, type Channel, type DiagnosisIssue } from '../types'

// COMTRADE (IEEE C37.111) 읽기·쓰기. 보호계전기·FRTU가 고장파형을 저장하는 표준 형식.
//   .cfg: 채널 정의, 단위, 배율, 계통 주파수, 샘플링
//   .dat: ASCII 또는 BINARY / BINARY32 / FLOAT32
// 아날로그 채널을 상(A·B·C·N)과 단위(A·V)로 Ia~Vc 7채널에 맞춤.

export interface ComtradeAnalog {
  index: number
  id: string
  phase: string
  unit: string
  a: number
  b: number
}

export interface ComtradeResult {
  station: string
  device: string
  revYear: string
  fileType: string
  lineFrequency: number
  samplingRate: number
  analogs: ComtradeAnalog[]
  /** CHANNELS 순서로 맞춘 행렬. 맞추지 못한 채널이 있으면 null */
  matrix: number[][] | null
  /** CHANNELS 순서 → 원본 채널 이름 */
  mapping: Partial<Record<Channel, string>>
  issues: DiagnosisIssue[]
}

const cells = (line: string) => line.split(',').map((c) => c.trim())

/** 원본 채널을 Ia~Vc 중 하나로 판단 */
function classify(ch: ComtradeAnalog): Channel | null {
  const unit = ch.unit.toLowerCase()
  const isCurrent = /^(k|m)?a$/.test(unit) || /^i/i.test(ch.id)
  const isVoltage = /^(k|m)?v$/.test(unit) || /^v|^u/i.test(ch.id)
  const ph = (ch.phase || ch.id.replace(/^(i|v|u)[_\s-]?/i, '')).toUpperCase()
  const p = /^(A|L1|R)$/.test(ph) || /A$|L1$/.test(ph) ? 'a' : /^(B|L2|S)$/.test(ph) || /B$|L2$/.test(ph) ? 'b' : /^(C|L3|T)$/.test(ph) || /C$|L3$/.test(ph) ? 'c' : /^(N|0|E|G)/.test(ph) || /N$/.test(ph) ? 'n' : null
  if (!p) return null
  if (isCurrent) return ({ a: 'Ia', b: 'Ib', c: 'Ic', n: 'In' } as const)[p]
  if (isVoltage && p !== 'n') return ({ a: 'Va', b: 'Vb', c: 'Vc' } as const)[p]
  return null
}

/** 단위를 A·V로 환산하는 배율 (kV → V 등) */
function unitScale(unit: string): number {
  const u = unit.toLowerCase()
  return u.startsWith('k') ? 1000 : u.startsWith('m') ? 0.001 : 1
}

export function parseComtrade(cfgText: string, dat: ArrayBuffer): ComtradeResult {
  const issues: DiagnosisIssue[] = []
  const lines = cfgText.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length < 6) throw new Error('.cfg 파일 형식이 올바르지 않습니다.')
  const [station = '', device = '', revYear = '1991'] = cells(lines[0])
  const counts = cells(lines[1])
  const nA = parseInt(counts[1])
  const nD = parseInt(counts[2])
  if (!Number.isFinite(nA) || !Number.isFinite(nD)) throw new Error('.cfg 둘째 줄의 채널 수를 읽을 수 없습니다.')

  const analogs: ComtradeAnalog[] = []
  for (let k = 0; k < nA; k++) {
    const c = cells(lines[2 + k] ?? '')
    analogs.push({ index: k, id: c[1] ?? `A${k + 1}`, phase: c[2] ?? '', unit: c[4] ?? '', a: Number(c[5] ?? 1) || 1, b: Number(c[6] ?? 0) || 0 })
  }
  let ln = 2 + nA + nD
  const lineFrequency = Number(cells(lines[ln++] ?? '')[0])
  const nrates = parseInt(cells(lines[ln++] ?? '')[0])
  let samplingRate = 0
  let totalSamples = 0
  for (let k = 0; k < Math.max(nrates, 1); k++) {
    const [samp, end] = cells(lines[ln++] ?? '').map(Number)
    if (k === 0) samplingRate = samp
    totalSamples = end || totalSamples
  }
  if (nrates > 1) issues.push({ code: 'MULTI_RATE', severity: 'warning', message: `샘플링 주파수가 ${nrates}단계로 바뀌는 기록입니다. 첫 단계(${samplingRate} Hz)만 기준으로 봅니다.` })
  ln += 2 // 시작·트리거 시각
  const fileType = (cells(lines[ln++] ?? 'ASCII')[0] || 'ASCII').toUpperCase()

  // .dat 읽기
  const raw: number[][] = []
  if (fileType === 'ASCII') {
    const text = new TextDecoder().decode(dat)
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      const c = cells(line)
      raw.push(analogs.map((_, k) => Number(c[2 + k])))
    }
  } else {
    const view = new DataView(dat)
    const width = fileType === 'BINARY' ? 2 : 4
    const digitalWords = Math.ceil(nD / 16)
    const recLen = 8 + nA * width + digitalWords * 2
    const n = Math.floor(dat.byteLength / recLen)
    for (let s = 0; s < n; s++) {
      const base = s * recLen + 8
      raw.push(
        analogs.map((_, k) => {
          const off = base + k * width
          if (fileType === 'BINARY') {
            const x = view.getInt16(off, true)
            return x === -32768 ? NaN : x
          }
          if (fileType === 'FLOAT32') return view.getFloat32(off, true)
          const x = view.getInt32(off, true)
          return x === -2147483648 ? NaN : x
        }),
      )
    }
  }
  if (totalSamples && raw.length !== totalSamples) {
    issues.push({ code: 'SAMPLE_COUNT', severity: 'warning', message: `.cfg에는 ${totalSamples}개 샘플로 되어 있는데 .dat에서 ${raw.length}개를 읽었습니다.`, fix: '.cfg와 .dat가 같은 기록인지 확인하세요.' })
  }

  // 7채널 맞추기
  const mapping: Partial<Record<Channel, string>> = {}
  const col: Partial<Record<Channel, ComtradeAnalog>> = {}
  for (const ch of analogs) {
    const target = classify(ch)
    if (target && !col[target]) {
      col[target] = ch
      mapping[target] = ch.id
    }
  }
  const missing = CHANNELS.filter((c) => !col[c])
  // 중성선 전류가 없으면 3상 합으로 계산 (흔한 경우)
  const derivedIn = missing.length === 1 && missing[0] === 'In' && col.Ia && col.Ib && col.Ic
  if (derivedIn) {
    issues.push({ code: 'DERIVED_IN', severity: 'info', message: '중성선 전류(In) 채널이 없어 Ia+Ib+Ic로 계산했습니다.' })
    mapping.In = 'Ia+Ib+Ic (계산)'
  } else if (missing.length) {
    issues.push({ code: 'CHANNEL_MAPPING', severity: 'error', message: `채널을 찾지 못했습니다: ${missing.join(', ')}. 원본 채널: ${analogs.map((a) => `${a.id}(${a.unit})`).join(', ')}`, fix: '.cfg의 상(ph)·단위(uu) 칸이 A/B/C/N, A/V로 되어 있는지 확인하세요.' })
  }
  const unmapped = analogs.filter((a) => !Object.values(col).includes(a))
  if (unmapped.length) issues.push({ code: 'EXTRA_CHANNELS', severity: 'info', message: `분석에 쓰지 않는 채널 ${unmapped.length}개: ${unmapped.map((a) => a.id).join(', ')}` })

  const value = (ch: ComtradeAnalog, x: number) => (ch.a * x + ch.b) * unitScale(ch.unit)
  const matrix =
    missing.length && !derivedIn
      ? null
      : raw.map((r) => {
          const get = (c: Channel) => {
            const ch = col[c]!
            return value(ch, r[ch.index])
          }
          const ia = get('Ia')
          const ib = get('Ib')
          const ic = get('Ic')
          return [ia, ib, ic, derivedIn ? ia + ib + ic : get('In'), get('Va'), get('Vb'), get('Vc')]
        })

  return { station, device, revYear, fileType, lineFrequency, samplingRate, analogs, matrix, mapping, issues }
}

/** 행렬을 COMTRADE(.cfg, .dat)로 저장 — 예시 파일 만들기용. channels로 일부 채널만 내보낼 수 있음 */
export function toComtrade(
  matrix: number[][],
  o: { station: string; device: string; fs: number; lf: number; fileType?: 'ASCII' | 'BINARY'; channels?: number[] },
): { cfg: string; dat: string | ArrayBuffer } {
  const ids = ['IA', 'IB', 'IC', 'IN', 'VA', 'VB', 'VC']
  const ph = ['A', 'B', 'C', 'N', 'A', 'B', 'C']
  const unit = ['A', 'A', 'A', 'A', 'kV', 'kV', 'kV']
  // 정수 저장 배율: 전류 0.1 A, 전압 0.01 kV 단위
  const a = [0.1, 0.1, 0.1, 0.1, 0.01, 0.01, 0.01]
  const use = o.channels ?? [0, 1, 2, 3, 4, 5, 6]
  const fileType = o.fileType ?? 'ASCII'
  const toStored = (x: number, k: number) => Math.round((k >= 4 ? x / 1000 : x) / a[k])
  const n = matrix.length
  const cfg = [
    `${o.station},${o.device},1999`,
    `${use.length},${use.length}A,0D`,
    ...use.map((k, j) => `${j + 1},${ids[k]},${ph[k]},,${unit[k]},${a[k]},0,0,-32767,32767,1,1,P`),
    `${o.lf}`,
    '1',
    `${o.fs},${n}`,
    '26/10/2026,09:12:31.000000',
    '26/10/2026,09:12:31.146000',
    fileType,
    '1',
  ].join('\r\n')
  const step = Math.round(1e6 / o.fs)
  if (fileType === 'BINARY') {
    const rec = 8 + use.length * 2
    const buf = new ArrayBuffer(rec * n)
    const view = new DataView(buf)
    matrix.forEach((r, i) => {
      view.setUint32(i * rec, i + 1, true)
      view.setUint32(i * rec + 4, i * step, true)
      use.forEach((k, j) => view.setInt16(i * rec + 8 + j * 2, Math.max(-32767, Math.min(32767, toStored(r[k], k))), true))
    })
    return { cfg, dat: buf }
  }
  const dat = matrix.map((r, i) => [i + 1, i * step, ...use.map((k) => toStored(r[k], k))].join(',')).join('\r\n')
  return { cfg, dat }
}
