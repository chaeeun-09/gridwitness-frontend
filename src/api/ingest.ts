import type { RegisterCaseInput } from '.'
import { parseComtrade } from '../lib/comtrade'
import { diagnose, parseCsv, sha256Hex, toCsv, type ParsedCsv } from '../lib/waveform'
import { channelsFor, type DiagnosisIssue, type InputDiagnosis, type SourceRecord } from '../types'

/** 업로드한 파일(CSV 또는 COMTRADE)을 읽어 브라우저에서 할 수 있는 처리를 한 결과. */
export interface Ingested {
  parsed: ParsedCsv
  samplingRateHz: number
  systemFrequencyHz: 50 | 60
  format: 'CSV' | 'COMTRADE'
  comtrade?: SourceRecord['comtrade']
  /** COMTRADE에서 채널을 맞추며 생긴 안내·오류 */
  preIssues: DiagnosisIssue[]
  fileName: string
  fileSize: number
  /** 해시를 낼 원본 바이트 (COMTRADE는 .cfg + .dat) */
  hashInput: ArrayBuffer
  /** 브라우저 쪽 입력 진단과 파형 */
  local: { diagnosis: InputDiagnosis; matrix: number[][] | null }
  /** 서버에 올릴 CSV. COMTRADE는 7채널로 맞춘 CSV로 변환. 변환할 수 없으면 null */
  uploadFile: File | null
  provenance: NonNullable<SourceRecord['provenance']>
}

export async function ingest(input: RegisterCaseInput): Promise<Ingested> {
  const buf = await input.file.arrayBuffer()
  let parsed: ParsedCsv
  let samplingRateHz = input.samplingRateHz
  let systemFrequencyHz = input.systemFrequencyHz
  let comtrade: SourceRecord['comtrade']
  let preIssues: DiagnosisIssue[] = []
  let hashInput: ArrayBuffer = buf
  let fileName = input.file.name
  let fileSize = input.file.size
  let uploadFile: File | null = input.file
  const originalFiles: NonNullable<SourceRecord['provenance']>['originalFiles'] = [{ name: input.file.name, size: buf.byteLength, sha256: await sha256Hex(buf), role: input.cfg ? 'dat' : 'csv' }]

  if (input.cfg) {
    // COMTRADE: .cfg로 채널·배율·주파수를 읽고 7채널로 맞춤
    const cfgBuf = await input.cfg.arrayBuffer()
    originalFiles.unshift({ name: input.cfg.name, size: cfgBuf.byteLength, sha256: await sha256Hex(cfgBuf), role: 'cfg' })
    const r = parseComtrade(new TextDecoder().decode(cfgBuf), buf)
    preIssues = r.issues
    if (r.samplingRate > 0) samplingRateHz = r.samplingRate
    if (r.lineFrequency === 50 || r.lineFrequency === 60) systemFrequencyHz = r.lineFrequency
    comtrade = { station: r.station, device: r.device, revYear: r.revYear, fileType: r.fileType, mapping: r.mapping as Record<string, string> }
    parsed = r.matrix ? { header: [...r.channels], rows: r.matrix.map((row) => row.map(String)) } : { header: null, rows: [] }
    uploadFile = r.matrix ? new File([toCsv(r.matrix, r.channels)], `${input.cfg.name.replace(/\.[^.]+$/, '')}_converted.csv`, { type: 'text/csv' }) : null
    const joined = new Uint8Array(cfgBuf.byteLength + buf.byteLength)
    joined.set(new Uint8Array(cfgBuf), 0)
    joined.set(new Uint8Array(buf), cfgBuf.byteLength)
    hashInput = joined.buffer
    fileName = `${input.cfg.name} + ${input.file.name}`
    fileSize = cfgBuf.byteLength + buf.byteLength
  } else {
    parsed = parseCsv(new TextDecoder().decode(buf))
    if (/\.txt$/i.test(input.file.name)) uploadFile = new File([buf], input.file.name.replace(/\.txt$/i, '.csv'), { type: 'text/csv' })
  }

  const result = diagnose(parsed, fileSize, { samplingRateHz, systemFrequencyHz, sourceType: input.sourceType })
  let diagnosis = result.diagnosis
  let matrix = result.matrix
  if (preIssues.length) {
    // COMTRADE 채널 맞추기 실패는 빈 데이터 오류 대신 그 이유만 보여줌
    const own = parsed.rows.length ? diagnosis.issues : diagnosis.issues.filter((i) => i.code !== 'EMPTY' && i.code !== 'NO_HEADER')
    const issues = [...preIssues, ...own]
    const status = issues.some((i) => i.severity === 'error') ? 'REJECTED' : diagnosis.status
    diagnosis = { ...diagnosis, issues, status }
    if (status === 'REJECTED') matrix = null
  }

  return {
    parsed,
    samplingRateHz,
    systemFrequencyHz,
    format: input.cfg ? 'COMTRADE' : 'CSV',
    comtrade,
    preIssues,
    fileName,
    fileSize,
    hashInput,
    local: { diagnosis, matrix },
    uploadFile,
    provenance: { format: input.cfg ? 'COMTRADE' : 'CSV', channelOrder: parsed.header ?? [...channelsFor(matrix?.[0]?.length ?? 0)], originalFiles, originalSha256: await sha256Hex(hashInput), comtrade },
  }
}
