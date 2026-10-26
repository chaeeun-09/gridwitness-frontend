import { CHANNELS, type Channel, type ChannelFeatures, type DiagnosisIssue, type InputDiagnosis, type SourceRecord } from '../types'

// 모델 학습 조건 (Xiong et al. 공개 데이터, 기획서 4.3)
export const MODEL_SCOPE = {
  rows: 1312,
  cols: 7,
  samplingRateHz: 4096,
  systemFrequencyHz: 50,
} as const

export const PREPROCESS_VERSION = 'prep-v0.1 (채널별 max-abs 정규화)'
export const MAX_FILE_BYTES = 5 * 1024 * 1024

export interface ParsedCsv {
  header: string[] | null
  rows: string[][]
}

export function parseCsv(text: string): ParsedCsv {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  const rows = lines.map((l) => l.split(/[,\t;]/).map((c) => c.trim()))
  if (rows.length === 0) return { header: null, rows: [] }
  const first = rows[0]
  const looksLikeHeader = first.some((c) => c !== '' && Number.isNaN(Number(c)) && !/^(nan|inf|-inf|infinity)$/i.test(c))
  return looksLikeHeader ? { header: first, rows: rows.slice(1) } : { header: null, rows }
}

/** 입력 품질검사 + 분석 범위 확인 (파이프라인 2~3단계) */
export function diagnose(
  parsed: ParsedCsv,
  fileSize: number,
  meta: Pick<SourceRecord, 'samplingRateHz' | 'systemFrequencyHz' | 'sourceType'>,
): { diagnosis: InputDiagnosis; matrix: number[][] | null } {
  const issues: DiagnosisIssue[] = []
  const rowCount = parsed.rows.length
  const colCount = rowCount ? Math.max(...parsed.rows.map((r) => r.length)) : 0

  if (fileSize > MAX_FILE_BYTES) {
    issues.push({ code: 'FILE_TOO_LARGE', severity: 'error', message: `파일 크기 ${(fileSize / 1024 / 1024).toFixed(1)}MB가 허용 한도 5MB를 넘습니다.`, fix: '한 사고 기록 단위로 파일을 나눠 등록하세요.' })
  }
  if (rowCount === 0) {
    issues.push({ code: 'EMPTY', severity: 'error', message: '데이터 행이 없습니다.', fix: 'CSV에 측정값이 들어 있는지 확인하세요.' })
  }

  if (colCount !== MODEL_SCOPE.cols && rowCount > 0) {
    issues.push({ code: 'COL_MISMATCH', severity: 'error', message: `채널 수가 ${colCount}개입니다. 7채널(${CHANNELS.join(', ')})이 필요합니다.`, fix: '누락된 채널을 포함하거나 채널 구성을 확인하세요.' })
  }
  const ragged = parsed.rows.findIndex((r) => r.length !== colCount)
  if (ragged >= 0) {
    issues.push({ code: 'RAGGED_ROWS', severity: 'error', message: `${ragged + 1}번째 행의 열 개수가 다른 행과 다릅니다.`, fix: '구분자와 빈 칸을 확인하세요.' })
  }

  if (parsed.header) {
    const order = parsed.header.map((h) => h.replace(/[^A-Za-z]/g, ''))
    const mismatch = CHANNELS.some((c, i) => order[i]?.toLowerCase() !== c.toLowerCase())
    if (mismatch) {
      issues.push({ code: 'CHANNEL_ORDER', severity: 'error', message: `채널 순서가 다릅니다: [${parsed.header.join(', ')}]`, fix: `열 순서를 ${CHANNELS.join(', ')}로 맞추세요.` })
    }
  } else {
    issues.push({ code: 'NO_HEADER', severity: 'warning', message: `헤더가 없어 채널 순서를 ${CHANNELS.join(', ')}로 가정했습니다.`, fix: '첫 행에 채널 이름을 넣으면 순서를 검증할 수 있습니다.' })
  }

  // 숫자형 / NaN / Inf
  let nonNumeric = 0
  let nanInf = 0
  let firstNonNumeric: string | null = null
  let firstNanInf: string | null = null
  const matrix: number[][] = parsed.rows.map((r, i) =>
    r.map((c, j) => {
      const v = Number(c)
      if (c === '' || (Number.isNaN(v) && !/^nan$/i.test(c))) {
        nonNumeric++
        firstNonNumeric ??= `${i + 1}행 ${j + 1}열 "${c}"`
      } else if (!Number.isFinite(v)) {
        nanInf++
        firstNanInf ??= `${i + 1}행 ${j + 1}열`
      }
      return v
    }),
  )
  if (nonNumeric > 0) {
    issues.push({ code: 'NON_NUMERIC', severity: 'error', message: `숫자가 아닌 값 ${nonNumeric}개 (처음: ${firstNonNumeric}).`, fix: '문자·빈 칸을 제거하거나 원본에서 다시 추출하세요.' })
  }
  if (nanInf > 0) {
    issues.push({ code: 'NAN_INF', severity: 'error', message: `NaN/Inf 값 ${nanInf}개 (처음: ${firstNanInf}).`, fix: '결측 구간을 확인하세요. 임의 보간은 하지 않습니다.' })
  }

  // 분석 범위 확인: 학습 조건과 비교
  if (rowCount > 0 && rowCount !== MODEL_SCOPE.rows) {
    issues.push({ code: 'LENGTH_OUT_OF_SCOPE', severity: 'warning', message: `샘플 수 ${rowCount}개는 모델 학습 조건(${MODEL_SCOPE.rows}개)과 다릅니다.`, fix: '같은 길이의 구간으로 잘라 등록하면 분석할 수 있습니다.' })
  }
  if (meta.samplingRateHz !== MODEL_SCOPE.samplingRateHz) {
    issues.push({ code: 'FS_OUT_OF_SCOPE', severity: 'warning', message: `샘플링 ${meta.samplingRateHz}Hz는 학습 조건(${MODEL_SCOPE.samplingRateHz}Hz)과 다릅니다.`, fix: '리샘플링 기능은 아직 지원하지 않습니다.' })
  }
  if (meta.systemFrequencyHz !== MODEL_SCOPE.systemFrequencyHz) {
    issues.push({ code: 'FREQ_OUT_OF_SCOPE', severity: 'warning', message: `계통 ${meta.systemFrequencyHz}Hz 데이터입니다. 현재 모델은 ${MODEL_SCOPE.systemFrequencyHz}Hz 공개 데이터로만 학습되었습니다.`, fix: '국내 60Hz 현장 검증 전에는 결과를 참고용으로만 다룹니다.' })
  }
  if (meta.sourceType === 'UNKNOWN') {
    issues.push({ code: 'UNKNOWN_SOURCE', severity: 'warning', message: '출처가 불명확한 자료는 현장 데이터로 승격하지 않습니다.', fix: '데이터셋 ID 또는 FRTU 승인 정보를 입력하세요.' })
  }
  if (meta.sourceType === 'SYNTHETIC') {
    issues.push({ code: 'SYNTHETIC', severity: 'info', message: '합성 데이터입니다. 기능 시험용으로만 사용하세요.' })
  }

  const hasError = issues.some((i) => i.severity === 'error')
  const hasScopeWarning = issues.some((i) => i.code.endsWith('OUT_OF_SCOPE'))
  const status = hasError ? 'REJECTED' : hasScopeWarning ? 'LIMITED' : 'ACCEPTED'

  return {
    diagnosis: { status, rows: rowCount, cols: colCount, issues, checkedAt: new Date().toISOString() },
    matrix: hasError ? null : matrix,
  }
}

export function column(matrix: number[][], j: number): number[] {
  return matrix.map((r) => r[j])
}

export function computeFeatures(matrix: number[][]): ChannelFeatures[] {
  return CHANNELS.map((channel: Channel, j) => {
    const x = column(matrix, j)
    const rms = Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
    const peak = Math.max(...x.map(Math.abs))
    const d = x.slice(1).map((v, i) => v - x[i])
    const diffRms = Math.sqrt(d.reduce((s, v) => s + v * v, 0) / Math.max(d.length, 1))
    return { channel, rms, peak, crestFactor: rms === 0 ? 0 : peak / rms, diffRms }
  })
}

/** 고정 전처리: 채널별 max-abs 정규화 */
export function preprocess(matrix: number[][]): number[][] {
  const scale = CHANNELS.map((_, j) => Math.max(...column(matrix, j).map(Math.abs)) || 1)
  return matrix.map((r) => r.map((v, j) => v / scale[j]))
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type SyntheticKind = 'fault' | 'broken'

export interface SynthOptions {
  /** 고장 상 0=A, 1=B, 2=C (여러 상이면 배열: 2상·3상 단락) */
  phase?: 0 | 1 | 2 | (0 | 1 | 2)[]
  systemHz?: 50 | 60
  fs?: number
  rows?: number
  /** 고장 시작 샘플 */
  onset?: number
  /** 고장 지속 샘플 (생략하면 끝까지) */
  duration?: number
  /** 고장 상 전류 배율 */
  currentGain?: number
  /** 고장 상 전압 배율 */
  voltageGain?: number
  /** 같은 값이면 같은 파형 (예시 데이터 재현용) */
  seed?: number
}

/** 시연용 합성 3상 파형 [샘플][Ia, Ib, Ic, In, Va, Vb, Vc]. 실제 계측 자료가 아님. */
export function synthesize(o: SynthOptions = {}): number[][] {
  const fs = o.fs ?? MODEL_SCOPE.samplingRateHz
  const f = o.systemHz ?? MODEL_SCOPE.systemFrequencyHz
  const n = o.rows ?? MODEL_SCOPE.rows
  const onset = o.onset ?? 600
  const end = o.duration === undefined ? Infinity : onset + o.duration
  const faulted = new Set(Array.isArray(o.phase) ? o.phase : [o.phase ?? 0])
  let seed = o.seed ?? Math.floor(Math.random() * 1e9)
  const rnd = () => ((seed = (seed * 16807 + 11) % 2147483647) / 2147483647 - 0.5) * 2
  const ang = [0, (-2 * Math.PI) / 3, (2 * Math.PI) / 3]
  const out: number[][] = []
  for (let i = 0; i < n; i++) {
    const t = i / fs
    const inFault = i >= onset && i < end
    const hit = (k: number) => inFault && faulted.has(k as 0 | 1 | 2)
    const cur = [0, 1, 2].map((k) => 150 * (hit(k) ? (o.currentGain ?? 6) : 1) * Math.sin(2 * Math.PI * f * t + ang[k]) + rnd() * 5)
    const vol = [0, 1, 2].map((k) => 18700 * (hit(k) ? (o.voltageGain ?? 0.32) : 1) * Math.sin(2 * Math.PI * f * t + ang[k]) + rnd() * 50)
    out.push([cur[0], cur[1], cur[2], cur[0] + cur[1] + cur[2], ...vol])
  }
  return out
}

export function toCsv(matrix: (number | string)[][], header: readonly string[] = CHANNELS): string {
  return [header.join(','), ...matrix.map((r) => r.map((x) => (typeof x === 'number' ? x.toFixed(3) : x)).join(','))].join('\n')
}

/** 시연용 합성 CSV. broken은 6채널 + NaN + 문자 섞인 오류 입력 */
export function syntheticCsv(kind: SyntheticKind, o: SynthOptions = {}): string {
  const m = synthesize(o)
  if (kind === 'fault') return toCsv(m)
  const broken: (number | string)[][] = m.map((r, i) => {
    const row: (number | string)[] = r.slice(0, 6)
    if (i === 200) row[1] = 'NaN'
    if (i === 450) row[2] = 'err'
    return row
  })
  return toCsv(broken, CHANNELS.slice(0, 6))
}
