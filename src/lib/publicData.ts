import type { DiagnosisIssue } from '../types'

// 한전 지역·시간대별 전력사용량 분석.
// 기본 데이터 = 한전 공공데이터 15151157 (지역본부 시간별 전력사용량 2022~2024) 실제 값의 월·평일/주말별 평균
// (gridwitness-ai scripts/export_profiles.py → public/data/profiles.json). 직접 받은 CSV를 가져오면 그 값으로 교체.
// 한전 시간별 자료에는 계약종별(주택·일반·산업) 구분이 없어서, 기본 데이터에서는 계약종별을 고를 수 없다.

export type Contract = 'RESIDENTIAL' | 'GENERAL' | 'INDUSTRIAL'
export type DayType = 'WEEKDAY' | 'WEEKEND'

export const CONTRACT_LABEL: Record<Contract, string> = { RESIDENTIAL: '주택용', GENERAL: '일반용', INDUSTRIAL: '산업용' }
export const DAYTYPE_LABEL: Record<DayType, string> = { WEEKDAY: '평일', WEEKEND: '주말·공휴일' }

export interface UsageRow {
  region: string
  contract: Contract
  month: number
  dayType: DayType
  hour: number
  kwh: number
}

type Profiles = Record<string, Record<string, Record<DayType, (number | null)[]>>>

export interface UsageDataset {
  label: string
  /** kepco = 한전 실제 시간별 자료(기본), csv = 사용자가 가져온 파일 */
  kind: 'kepco' | 'csv'
  fileName?: string
  regions: string[]
  rows: UsageRow[] | null
  profiles?: Profiles
  /** 값 단위 */
  unit: string
  /** 계약종별로 나뉜 자료인지 */
  hasContract: boolean
  source?: { dataset: string; url: string; range: [string, string]; note: string }
}

interface ProfilesFile {
  source: { dataset: string; url: string }
  range: [string, string]
  unit: string
  regions: string[]
  profiles: Profiles
  note: string
}

let kepcoPromise: Promise<UsageDataset> | null = null
/** 한전 실제 시간대별 패턴 (지역본부 × 월 × 평일/주말·공휴일) */
export function loadKepcoDataset(): Promise<UsageDataset> {
  kepcoPromise ??= fetch(`${import.meta.env.BASE_URL}data/profiles.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`profiles.json: HTTP ${r.status}`)
      return r.json() as Promise<ProfilesFile>
    })
    .then((f) => ({
      label: '한전 지역본부 시간별 전력사용량 (2022~2024 실제 값 평균)',
      kind: 'kepco' as const,
      regions: f.regions,
      rows: null,
      profiles: f.profiles,
      unit: 'MWh',
      hasContract: false,
      source: { dataset: f.source.dataset, url: f.source.url, range: f.range, note: f.note },
    }))
    .catch((e) => {
      kepcoPromise = null
      throw e
    })
  return kepcoPromise
}

export function getProfile(ds: UsageDataset, region: string, contract: Contract, month: number, dayType: DayType): number[] | null {
  if (ds.profiles) {
    const p = ds.profiles[region]?.[String(month)]?.[dayType]
    return p ? p.map((v) => (v == null ? NaN : v)) : null
  }
  if (!ds.rows) return null
  const rows = ds.rows.filter((r) => r.region === region && r.contract === contract && r.month === month && r.dayType === dayType)
  if (rows.length === 0) return null
  const out = Array<number>(24).fill(NaN)
  rows.forEach((r) => (out[r.hour] = r.kwh))
  return out
}

export interface ProfileStats {
  total: number
  peak: number
  peakHour: number
  min: number
  minHour: number
  loadFactor: number
  pattern: string
  missingHours: number
}

export function profileStats(p: number[]): ProfileStats {
  const valid = p.map((v, h) => ({ v, h })).filter((x) => Number.isFinite(x.v))
  const total = valid.reduce((s, x) => s + x.v, 0)
  const peakX = valid.reduce((a, b) => (b.v > a.v ? b : a), valid[0])
  const minX = valid.reduce((a, b) => (b.v < a.v ? b : a), valid[0])
  const avg = total / valid.length
  const loadFactor = avg / peakX.v
  const pattern =
    loadFactor > 0.85 ? '평탄형 (상시 부하)' : peakX.h >= 17 && peakX.h <= 23 ? '저녁 피크형' : peakX.h >= 9 && peakX.h <= 16 ? '주간 피크형' : '아침·야간 피크형'
  return { total, peak: peakX.v, peakHour: peakX.h, min: minX.v, minHour: minX.h, loadFactor, pattern, missingHours: 24 - valid.length }
}

// ── 공공데이터 CSV 가져오기 + 적합성 점검 ────────────────────
const HEADER_ALIASES: Record<keyof UsageRow, string[]> = {
  region: ['region', '지역', '시도'],
  contract: ['contract', '계약종별', '계약종'],
  month: ['month', '월'],
  dayType: ['daytype', '요일구분', '요일'],
  hour: ['hour', '시간', '시간대'],
  kwh: ['kwh', '사용량', '전력사용량', '사용량(kwh)'],
}
const CONTRACT_ALIASES: Record<string, Contract> = { 주택용: 'RESIDENTIAL', residential: 'RESIDENTIAL', 일반용: 'GENERAL', general: 'GENERAL', 산업용: 'INDUSTRIAL', industrial: 'INDUSTRIAL' }
const DAYTYPE_ALIASES: Record<string, DayType> = { 평일: 'WEEKDAY', weekday: 'WEEKDAY', 주말: 'WEEKEND', weekend: 'WEEKEND', 휴일: 'WEEKEND' }

export interface ImportResult {
  dataset: UsageDataset | null
  issues: DiagnosisIssue[]
  rowCount: number
}

export function importUsageCsv(text: string, fileName: string): ImportResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const issues: DiagnosisIssue[] = []
  if (lines.length < 2) return { dataset: null, rowCount: 0, issues: [{ code: 'EMPTY', severity: 'error', message: '데이터 행이 없습니다.' }] }

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const col = {} as Record<keyof UsageRow, number>
  for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [keyof UsageRow, string[]][]) {
    col[key] = header.findIndex((h) => aliases.includes(h))
  }
  const missing = (Object.keys(col) as (keyof UsageRow)[]).filter((k) => col[k] < 0)
  if (missing.length) {
    return {
      dataset: null,
      rowCount: lines.length - 1,
      issues: [{ code: 'MISSING_COLUMNS', severity: 'error', message: `필요한 열이 없습니다: ${missing.join(', ')}`, fix: '열 이름을 region(지역), contract(계약종별), month(월), daytype(요일구분), hour(시간), kwh(사용량)으로 맞추세요.' }],
    }
  }

  const rows: UsageRow[] = []
  let bad = 0
  let firstBad = ''
  for (const [k, line] of lines.slice(1).entries()) {
    const c = line.split(',').map((x) => x.trim())
    const contract = CONTRACT_ALIASES[c[col.contract]?.toLowerCase()] ?? CONTRACT_ALIASES[c[col.contract]]
    const dayType = DAYTYPE_ALIASES[c[col.dayType]?.toLowerCase()] ?? DAYTYPE_ALIASES[c[col.dayType]]
    const month = Number(c[col.month])
    const hour = Number(c[col.hour])
    const kwh = Number(c[col.kwh])
    if (!c[col.region] || !contract || !dayType || !(month >= 1 && month <= 12) || !Number.isInteger(hour) || hour < 0 || hour > 24 || !(kwh >= 0)) {
      bad++
      firstBad ||= `${k + 2}행`
      continue
    }
    rows.push({ region: c[col.region], contract, month, dayType, hour, kwh })
  }
  if (bad) issues.push({ code: 'INVALID_ROWS', severity: 'warning', message: `형식이 맞지 않는 행 ${bad}개를 제외했습니다 (처음: ${firstBad}).`, fix: '계약종별(주택용/일반용/산업용), 요일구분(평일/주말), 월(1~12), 시간(0~23) 값을 확인하세요.' })

  const groupKey = (r: UsageRow) => `${r.region}|${r.contract}|${r.month}|${r.dayType}`
  const groups = new Map<string, Set<number>>()
  rows.forEach((r) => {
    const k = groupKey(r)
    if (!groups.has(k)) groups.set(k, new Set())
    groups.get(k)!.add(r.hour)
  })
  // 1~24시 표기는 그 조합만 0~23으로 변환
  const oneBased = [...groups].filter(([, hours]) => hours.has(24) && !hours.has(0)).map(([k]) => k)
  if (oneBased.length) {
    rows.forEach((r) => oneBased.includes(groupKey(r)) && (r.hour -= 1))
    oneBased.forEach((k) => groups.set(k, new Set([...groups.get(k)!].map((h) => h - 1))))
    issues.push({ code: 'HOUR_1_BASED', severity: 'info', message: `시간이 1~24로 표기된 조합 ${oneBased.length}개를 0~23으로 변환했습니다.` })
  }
  const outOfRange = rows.filter((r) => r.hour > 23).length
  if (outOfRange) {
    issues.push({ code: 'HOUR_OUT_OF_RANGE', severity: 'warning', message: `0시와 24시가 함께 있는 등 시간 범위를 벗어난 행 ${outOfRange}개를 제외했습니다.` })
    for (let k = rows.length - 1; k >= 0; k--) if (rows[k].hour > 23) rows.splice(k, 1)
  }
  const incomplete = [...groups.values()].filter((s) => s.size < 24).length
  if (incomplete) issues.push({ code: 'MISSING_HOURS', severity: 'warning', message: `24시간이 다 채워지지 않은 조합 ${incomplete}개가 있습니다. 빈 시간은 그래프에서 비워 둡니다.` })
  issues.push({ code: 'NO_FAULT_LABEL', severity: 'info', message: '전력사용량 데이터에는 고장·이상 라벨이 없어 이상 탐지 모델 학습에는 쓰지 않습니다. 패턴 분석·비교와 마을 부하 시나리오에만 사용합니다.' })

  if (rows.length === 0) return { dataset: null, rowCount: lines.length - 1, issues: [{ code: 'NO_VALID_ROWS', severity: 'error', message: '유효한 행이 없습니다.' }, ...issues] }
  const regions = [...new Set(rows.map((r) => r.region))]
  return { dataset: { label: `가져온 데이터: ${fileName}`, kind: 'csv', fileName, regions, rows, unit: 'kWh', hasContract: true }, rowCount: lines.length - 1, issues }
}

/** 다른 사람이 형식을 맞출 수 있게 내려받는 템플릿 (열 이름만. 값은 직접 받은 자료로 채운다) */
export function templateCsv(): string {
  return ['지역', '계약종별', '월', '요일구분', '시간', '사용량'].join(',') + String.fromCharCode(10)
}
