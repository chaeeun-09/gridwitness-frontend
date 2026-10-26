// 고장파형에서 사건 발생 시점과 변화량을 직접 계산한다.
// AI 분류 점수와는 별개이며, "무엇이 얼마나 바뀌었는지"를 보여주는 근거용 값이다.
// 방법: 계통 주파수 한 주기 전 같은 위상의 값과 비교해 처음 크게 달라지는 지점을 찾는다 (정상 파형은 주기적이라 차이가 거의 없음).

const PHASE = ['A', 'B', 'C'] as const
const I_COLS = [0, 1, 2]
const V_COLS = [4, 5, 6]
const IN_COL = 3

export interface PhaseChange {
  phase: (typeof PHASE)[number]
  before: number
  after: number
  ratio: number
}

export interface FaultFeatures {
  /** 한 주기 샘플 수 */
  cycle: number
  onset: { sample: number; seconds: number } | null
  /** 전류 변화가 가장 큰 상 */
  dominant: (PhaseChange & { peakBefore: number; peakAfter: number; peakPct: number; rmsPct: number }) | null
  currents: PhaseChange[]
  voltages: PhaseChange[]
  zeroSeq: { before: number; after: number; ratio: number } | null
  /** 기록 끝까지 이상이 이어지는지 */
  persistent: boolean
  /** 이상이 끝난 시점(초). 이어지면 null */
  recoverSeconds: number | null
  patterns: string[]
}

const rms = (x: number[], from: number, to: number) => {
  const a = Math.max(0, from)
  const b = Math.min(x.length, to)
  if (b <= a) return 0
  let s = 0
  for (let i = a; i < b; i++) s += x[i] * x[i]
  return Math.sqrt(s / (b - a))
}
const peak = (x: number[], from: number, to: number) => {
  let m = 0
  for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) m = Math.max(m, Math.abs(x[i]))
  return m
}

export function analyzeWaveform(matrix: number[][], fs: number, systemHz: number): FaultFeatures {
  const n = matrix.length
  const cycle = Math.max(8, Math.round(fs / systemHz))
  const col = (j: number) => matrix.map((r) => r[j])
  const cols = [...I_COLS, ...V_COLS].map((j) => ({ j, x: col(j) }))
  const empty: FaultFeatures = { cycle, onset: null, dominant: null, currents: [], voltages: [], zeroSeq: null, persistent: false, recoverSeconds: null, patterns: [] }
  if (n < cycle * 3) return empty

  // 첫 한 주기를 기준으로 열별 정상 크기
  const basePeak = new Map(cols.map((c) => [c.j, Math.max(peak(c.x, 0, cycle), 1e-9)]))
  const deviates = (i: number) =>
    cols.some((c) => Math.abs(c.x[i] - c.x[i - cycle]) > 0.35 * (basePeak.get(c.j) ?? 1))

  // 연속 3샘플 이상 달라지면 사건 시작
  let onset = -1
  for (let i = cycle; i < n - 2; i++) {
    if (deviates(i) && deviates(i + 1) && deviates(i + 2)) {
      onset = i
      break
    }
  }
  if (onset < 0) return empty

  const afterEnd = Math.min(n, onset + cycle)
  const before = (x: number[]) => rms(x, onset - cycle, onset)
  const after = (x: number[]) => rms(x, onset, afterEnd)
  const change = (j: number, k: number): PhaseChange => {
    const x = col(j)
    const b = before(x)
    const a = after(x)
    return { phase: PHASE[k], before: b, after: a, ratio: b > 0 ? a / b : 0 }
  }
  const currents = I_COLS.map((j, k) => change(j, k))
  const voltages = V_COLS.map((j, k) => change(j, k))

  const domIdx = currents.reduce((best, c, k) => (c.ratio > currents[best].ratio ? k : best), 0)
  const dc = currents[domIdx]
  const dx = col(I_COLS[domIdx])
  const peakBefore = peak(dx, onset - cycle, onset)
  const peakAfter = peak(dx, onset, Math.min(n, onset + 2 * cycle))
  const dominant = dc.ratio > 1.15 ? { ...dc, peakBefore, peakAfter, peakPct: peakBefore > 0 ? (peakAfter / peakBefore - 1) * 100 : 0, rmsPct: (dc.ratio - 1) * 100 } : null

  const inX = col(IN_COL)
  const zb = before(inX)
  const za = after(inX)
  const zeroSeq = { before: zb, after: za, ratio: zb > 0 ? za / zb : 0 }

  // 이상이 이어지는지: 마지막 한 주기와 정상 때 비교
  const lastDev = I_COLS.some((j, k) => {
    const x = col(j)
    const b = currents[k].before
    return b > 0 && rms(x, n - cycle, n) > 1.3 * b
  }) || V_COLS.some((j, k) => voltages[k].before > 0 && rms(col(j), n - cycle, n) < 0.8 * voltages[k].before)
  const persistent = lastDev
  let recoverSeconds: number | null = null
  if (!persistent) {
    // 한 주기 구간의 전류·전압 크기가 고장 전 값의 ±15% 안으로 돌아온 첫 지점
    const near = (j: number, base: number, from: number) => base <= 0 || Math.abs(rms(col(j), from, from + cycle) / base - 1) < 0.15
    const step = Math.max(1, Math.floor(cycle / 8))
    for (let i = onset; i <= n - cycle; i += step) {
      if (I_COLS.every((j, k) => near(j, currents[k].before, i)) && V_COLS.every((j, k) => near(j, voltages[k].before, i))) {
        recoverSeconds = i / fs
        break
      }
    }
  }

  const patterns: string[] = []
  const up = currents.filter((c) => c.ratio > 1.3)
  if (up.length >= 2) patterns.push(`${up.map((c) => c.phase).join('·')}상 전류 동시 증가`)
  else if (dominant && dominant.ratio > 1.3) patterns.push(`${dominant.phase}상 전류 ${dominant.ratio.toFixed(1)}배 증가`)
  const sag = voltages.reduce((w, v) => (v.ratio < w.ratio ? v : w), voltages[0])
  if (sag.before > 0 && sag.ratio < 0.9) patterns.push(`${sag.phase}상 전압 ${((1 - sag.ratio) * 100).toFixed(0)}% 강하`)
  if (zeroSeq.ratio > 3 && zeroSeq.after > 0.3 * Math.max(...currents.map((c) => c.before), 1)) patterns.push('영상전류(3I0) 급증')
  patterns.push(persistent ? '기록 끝까지 이상 지속' : recoverSeconds !== null ? `일시적 이상 (${(recoverSeconds - onset / fs).toFixed(3)} s 후 회복)` : '이상 후 회복')

  return { cycle, onset: { sample: onset, seconds: onset / fs }, dominant, currents, voltages, zeroSeq, persistent, recoverSeconds, patterns }
}

/** 전류 크기를 읽기 쉽게 (1,000 A 이상은 kA) */
export function fmtCurrent(a: number): string {
  return a >= 1000 ? `${(a / 1000).toFixed(2)} kA` : `${a.toFixed(a >= 100 ? 0 : 1)} A`
}
export function fmtPct(p: number): string {
  return `${p >= 0 ? '+' : ''}${p.toFixed(0)}%`
}
