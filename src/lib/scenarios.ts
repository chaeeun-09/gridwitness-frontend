import { toComtrade } from './comtrade'
import { CHANNELS, type DiagnosisStatus, type SourceType } from '../types'
import { parseCsv } from './waveform'

// 고장파형 입력 예시. 만든(합성) 파형은 쓰지 않는다.
// - 실제 공개 파형: Xiong et al. 공개 데이터(MIT) 원본 4건 (public/data/xiong, 유형마다 1건). AI 분석까지 가능
// - AI가 보류한 실제 사례: 시험 세트(학습에 안 씀)에서 배포 모델이 실제로 보류한 파형 3건 (xiong-87 은 위 SIF 와 같은 파일)
//   gridwitness-ai scripts/export_model_card.py 가 모델을 돌려 찾고 원본 값 그대로 내보냄
// - 입력 검사용: 위 실제 파일을 일부러 망가뜨리거나(헤더 삭제·순서 변경·결측) 잘못된 설정값을 넣은 파일.
//   입력 진단이 어떻게 반응하는지 보는 용도이고, 데이터셋 ID를 'gridwitness-input-check'로 둬서 AI가 고장 유형을 판단하지 않는다

export interface ScenarioFiles {
  file: File
  cfg?: File
  title: string
  sourceType: SourceType
  datasetId: string
  samplingRateHz: number
  systemFrequencyHz: 50 | 60
}

export interface RealSample {
  id: string
  label: string
  text: string
  /** 원본 문자열 값 (행 × 7) */
  rows: string[][]
  matrix: number[][]
}
export type RealSamples = Record<'SIF' | 'MIF' | 'PF' | 'TD' | 'ABS1' | 'ABS2', RealSample>

export interface InputScenario {
  id: string
  group: '실제 공개 파형' | 'AI가 보류한 실제 사례' | '입력 검사 · 설정값' | '입력 검사 · 형식 오류' | '입력 검사 · COMTRADE'
  label: string
  /** 기대하는 입력 진단 결과 */
  expect: DiagnosisStatus
  note: string
  build: (s: RealSamples) => ScenarioFiles
}

const XIONG = `${import.meta.env.BASE_URL}data/xiong/`
const FILES: Record<keyof RealSamples, string> = { SIF: 'xiong-87', MIF: 'xiong-214', PF: 'xiong-44', TD: 'xiong-227', ABS1: 'xiong-1', ABS2: 'xiong-195' }
/** 보류 사례의 실제 유형 (Xiong 라벨) */
const TRUE_LABEL: Partial<Record<keyof RealSamples, string>> = { ABS1: 'PF', ABS2: 'PF' }
export const XIONG_DATASET_ID = 'Xiong-public-fault-dataset'
export const CHECK_DATASET_ID = 'gridwitness-input-check'

let samples: Promise<RealSamples> | null = null
/** 실제 공개 파형 4건을 불러온다 (원본 값 그대로, 머리줄만 추가된 CSV) */
export function loadRealSamples(): Promise<RealSamples> {
  samples ??= Promise.all(
    (Object.entries(FILES) as [keyof RealSamples, string][]).map(async ([label, id]) => {
      const r = await fetch(`${XIONG}${id}.csv`)
      if (!r.ok) throw new Error(`${id}.csv: HTTP ${r.status}`)
      const text = await r.text()
      const rows = parseCsv(text).rows
      return [label, { id, label: TRUE_LABEL[label] ?? label, text, rows, matrix: rows.map((r) => r.map(Number)) }] as const
    }),
  )
    .then((xs) => Object.fromEntries(xs) as RealSamples)
    .catch((e) => {
      samples = null
      throw e
    })
  return samples
}

const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })
const real = (s: RealSample) => ({
  file: csv(`${s.id}.csv`, s.text),
  title: `${s.label} · Xiong 공개 파형 ${s.id}`,
  sourceType: 'PUBLIC_DATASET' as const,
  datasetId: XIONG_DATASET_ID,
  samplingRateHz: 4096,
  systemFrequencyHz: 50 as const,
})
const check = (title: string, fs = 4096, hz: 50 | 60 = 50) => ({ title: `[입력 검사] ${title}`, sourceType: 'PUBLIC_DATASET' as const, datasetId: CHECK_DATASET_ID, samplingRateHz: fs, systemFrequencyHz: hz })
const lines = (t: string) => t.trimEnd().split(/\r?\n/)
/** 값은 원본 문자열 그대로 (반올림하지 않음) */
const joinCsv = (header: readonly string[], rows: string[][]) => [header.join(','), ...rows.map((r) => r.join(','))].join('\n')

export const INPUT_SCENARIOS: InputScenario[] = [
  { id: 'x-sif', group: '실제 공개 파형', label: 'SIF (Xiong 87)', expect: 'ACCEPTED', note: '원본 그대로 · 시험에서 AI가 보류한 파형 (SIF·MIF 점수 차 0.02)', build: (s) => real(s.SIF) },
  { id: 'x-mif', group: '실제 공개 파형', label: 'MIF (Xiong 214)', expect: 'ACCEPTED', note: '원본 그대로 · AI 분석 가능', build: (s) => real(s.MIF) },
  { id: 'x-pf', group: '실제 공개 파형', label: 'PF (Xiong 44)', expect: 'ACCEPTED', note: '원본 그대로 · AI 분석 가능', build: (s) => real(s.PF) },
  { id: 'x-td', group: '실제 공개 파형', label: 'TD (Xiong 227)', expect: 'ACCEPTED', note: '원본 그대로 · AI 분석 가능', build: (s) => real(s.TD) },
  { id: 'x-abs1', group: 'AI가 보류한 실제 사례', label: '정답 PF (Xiong 1)', expect: 'ACCEPTED', note: '원본 그대로 · 시험에서 AI가 보류 (SIF·PF 점수 차 0.007)', build: (s) => real(s.ABS1) },
  { id: 'x-abs2', group: 'AI가 보류한 실제 사례', label: '정답 PF (Xiong 195)', expect: 'ACCEPTED', note: '원본 그대로 · 시험에서 AI가 보류 (PF·SIF 점수 차 0.08)', build: (s) => real(s.ABS2) },
  {
    id: 'no-header',
    group: '입력 검사 · 형식 오류',
    label: '헤더 없는 CSV',
    expect: 'ACCEPTED',
    note: '실제 파일에서 머리줄만 지움 · 채널 순서를 가정하고 경고',
    build: (s) => ({ file: csv('no_header.csv', lines(s.SIF.text).slice(1).join('\n')), ...check('헤더 없는 CSV') }),
  },
  {
    id: 'order',
    group: '입력 검사 · 형식 오류',
    label: '채널 순서 뒤바뀜',
    expect: 'REJECTED',
    note: '실제 파일의 전압 열을 전류 앞으로 옮김',
    build: (s) => {
      const m = s.SIF.rows.map((r) => [...r.slice(4), ...r.slice(0, 4)])
      return { file: csv('swapped.csv', joinCsv([...CHANNELS.slice(4), ...CHANNELS.slice(0, 4)], m)), ...check('채널 순서 뒤바뀜') }
    },
  },
  {
    id: 'broken',
    group: '입력 검사 · 형식 오류',
    label: '결측·문자·6채널',
    expect: 'REJECTED',
    note: '실제 파일에서 Vc 열을 빼고 두 칸을 NaN·문자로 바꿈',
    build: (s) => {
      const m = s.PF.rows.map((r, i) => {
        const row = r.slice(0, 6)
        if (i === 200) row[1] = 'NaN'
        if (i === 450) row[2] = 'err'
        return row
      })
      return { file: csv('broken.csv', joinCsv(CHANNELS.slice(0, 6), m)), ...check('결측·문자·6채널') }
    },
  },
  { id: 'empty', group: '입력 검사 · 형식 오류', label: '빈 파일', expect: 'REJECTED', note: '헤더만 있고 값이 없음', build: () => ({ file: csv('empty.csv', CHANNELS.join(',')), ...check('빈 파일') }) },
  {
    id: 'short',
    group: '입력 검사 · 설정값',
    label: '길이 1,000샘플',
    expect: 'LIMITED',
    note: '실제 파일의 앞 1,000행만 남김 (학습 조건 1,312)',
    build: (s) => ({ file: csv('short_1000.csv', lines(s.MIF.text).slice(0, 1001).join('\n')), ...check('길이 1,000샘플') }),
  },
  {
    id: 'fs-wrong',
    group: '입력 검사 · 설정값',
    label: '샘플링 값을 2,000Hz로 잘못 입력',
    expect: 'LIMITED',
    note: '실제는 4,096Hz 파일 · 설정값만 다르게',
    build: (s) => ({ file: csv(`${s.TD.id}.csv`, s.TD.text), ...check('샘플링 2,000Hz로 잘못 입력', 2000) }),
  },
  {
    id: 'hz-wrong',
    group: '입력 검사 · 설정값',
    label: '계통 주파수를 60Hz로 입력',
    expect: 'LIMITED',
    note: '실제는 50Hz 파일 · 국내(60Hz) 설정을 넣으면 어떻게 되는지',
    build: (s) => ({ file: csv(`${s.PF.id}.csv`, s.PF.text), ...check('계통 60Hz로 입력', 4096, 60) }),
  },
  {
    id: 'ct-bin',
    group: '입력 검사 · COMTRADE',
    label: 'COMTRADE BINARY 변환',
    expect: 'ACCEPTED',
    note: '실제 파일을 COMTRADE 이진 형식으로 바꿈 (배율 양자화, 단위 표기는 형식 시험용)',
    build: (s) => {
      const { cfg, dat } = toComtrade(s.SIF.matrix, { station: 'XIONG_PUBLIC', device: 'CONVERTED', fs: 4096, lf: 50, fileType: 'BINARY' })
      return { file: new File([dat], 'xiong87_bin.dat'), cfg: new File([cfg], 'xiong87_bin.cfg'), ...check('COMTRADE BINARY 변환') }
    },
  },
  {
    id: 'ct-no-in',
    group: '입력 검사 · COMTRADE',
    label: '중성선(In) 채널 없음',
    expect: 'REJECTED',
    note: 'In 열을 빼고 COMTRADE로 바꿈 · 없는 채널을 계산값으로 채우지 않아 거부',
    build: (s) => {
      const { cfg, dat } = toComtrade(s.MIF.matrix, { station: 'XIONG_PUBLIC', device: 'CONVERTED-6CH', fs: 4096, lf: 50, channels: [0, 1, 2, 4, 5, 6] })
      return { file: new File([dat], 'no_neutral.dat'), cfg: new File([cfg], 'no_neutral.cfg'), ...check('In 채널 없음 (COMTRADE)') }
    },
  },
  {
    id: 'ct-current-only',
    group: '입력 검사 · COMTRADE',
    label: '전압 채널 없음',
    expect: 'REJECTED',
    note: '전류 열만 남기고 COMTRADE로 바꿈',
    build: (s) => {
      const { cfg, dat } = toComtrade(s.PF.matrix, { station: 'XIONG_PUBLIC', device: 'CURRENT-ONLY', fs: 4096, lf: 50, channels: [0, 1, 2, 3] })
      return { file: new File([dat], 'current_only.dat'), cfg: new File([cfg], 'current_only.cfg'), ...check('전압 채널 없음 (COMTRADE)') }
    },
  },
]
