import { CHANNELS, RU_CHANNELS, channelsFor, type ChannelFeatures, type DiagnosisIssue, type InputDiagnosis, type SourceRecord } from '../types'

// 모델 학습 조건 (Xiong et al. 공개 데이터, 기획서 4.3)
export const MODEL_SCOPE = {
  rows: 1312,
  cols: 7,
  samplingRateHz: 4096,
  systemFrequencyHz: 50,
} as const
export const MODEL_SCOPES = {
  CN: { ...MODEL_SCOPE, channels: CHANNELS },
  RU: { rows: 512, cols: 5, samplingRateHz: 1600, systemFrequencyHz: 50, channels: RU_CHANNELS },
} as const
export const modelScopeFor = (columns: number) => columns === 5 ? MODEL_SCOPES.RU : MODEL_SCOPES.CN

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
  const scope = modelScopeFor(colCount || parsed.header?.length || 7)
  const channels = scope.channels

  if (fileSize > MAX_FILE_BYTES) {
    issues.push({ code: 'FILE_TOO_LARGE', severity: 'error', message: `파일 크기 ${(fileSize / 1024 / 1024).toFixed(1)}MB가 허용 한도 5MB를 넘습니다.`, fix: '한 사고 기록 단위로 파일을 나눠 등록하세요.' })
  }
  if (rowCount === 0) {
    issues.push({ code: 'EMPTY', severity: 'error', message: '데이터 행이 없습니다.', fix: 'CSV에 측정값이 들어 있는지 확인하세요.' })
  }

  if (![5, 7].includes(colCount) && rowCount > 0) {
    issues.push({ code: 'COL_MISMATCH', severity: 'error', message: `채널 수가 ${colCount}개입니다. CN 7채널(${CHANNELS.join(', ')}) 또는 RU 5채널(${RU_CHANNELS.join(', ')})이 필요합니다.`, fix: '원래 모델의 채널 구성을 확인하세요. 없는 채널은 임의로 채우지 않습니다.' })
  }
  const ragged = parsed.rows.findIndex((r) => r.length !== colCount)
  if (ragged >= 0) {
    issues.push({ code: 'RAGGED_ROWS', severity: 'error', message: `${ragged + 1}번째 행의 열 개수가 다른 행과 다릅니다.`, fix: '구분자와 빈 칸을 확인하세요.' })
  }

  if (parsed.header) {
    const order = parsed.header.map((h) => h.replace(/[^A-Za-z]/g, ''))
    const mismatch = parsed.header.length !== channels.length || channels.some((c, i) => order[i]?.toLowerCase() !== c.toLowerCase())
    if (mismatch) {
      issues.push({ code: 'CHANNEL_ORDER', severity: 'error', message: `채널 순서가 다릅니다: [${parsed.header.join(', ')}]`, fix: `열 순서를 ${channels.join(', ')}로 맞추세요.` })
    }
  } else {
    issues.push({ code: 'NO_HEADER', severity: 'warning', message: `헤더가 없어 채널 순서를 ${channels.join(', ')}로 가정했습니다.`, fix: '첫 행에 채널 이름을 넣으면 순서를 검증할 수 있습니다.' })
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
  if (rowCount > 0 && rowCount !== scope.rows) {
    issues.push({ code: 'LENGTH_OUT_OF_SCOPE', severity: 'warning', message: `샘플 수 ${rowCount}개는 모델 학습 조건(${scope.rows}개)과 다릅니다.`, fix: '같은 길이의 구간으로 잘라 등록하면 분석할 수 있습니다.' })
  }
  if (!Number.isFinite(meta.samplingRateHz) || meta.samplingRateHz <= 0) {
    issues.push({ code: 'INVALID_FS', severity: 'error', message: '샘플링 주파수는 유한한 양수여야 합니다.' })
  } else if (meta.samplingRateHz !== scope.samplingRateHz) {
    issues.push({ code: 'FS_OUT_OF_SCOPE', severity: 'warning', message: `샘플링 ${meta.samplingRateHz}Hz는 학습 조건(${scope.samplingRateHz}Hz)과 다릅니다.`, fix: '리샘플링 기능은 아직 지원하지 않습니다.' })
  }
  if (meta.systemFrequencyHz !== scope.systemFrequencyHz) {
    issues.push({ code: 'FREQ_OUT_OF_SCOPE', severity: 'warning', message: `계통 ${meta.systemFrequencyHz}Hz 데이터입니다. 해당 모델은 ${scope.systemFrequencyHz}Hz 공개 데이터로 학습되었습니다.`, fix: '국내 60Hz 현장 검증 전에는 결과를 참고용으로만 다룹니다.' })
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
  if (!matrix.length) return []
  return channelsFor(matrix[0].length).map((channel, j) => {
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
  const scale = (matrix[0] ?? []).map((_, j) => Math.max(...column(matrix, j).map(Math.abs)) || 1)
  return matrix.map((r) => r.map((v, j) => v / scale[j]))
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function toCsv(matrix: (number | string)[][], header: readonly string[] = CHANNELS): string {
  return [header.join(','), ...matrix.map((r) => r.map((x) => (typeof x === 'number' ? x.toFixed(3) : x)).join(','))].join('\n')
}
