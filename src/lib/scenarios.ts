import { toComtrade } from './comtrade'
import { CHANNELS, type DiagnosisStatus, type SourceType } from '../types'
import { synthesize, syntheticCsv, toCsv } from './waveform'

// 고장파형 입력 예시 시나리오. 모두 합성 데이터(실제 계측 아님).
// 정상 입력뿐 아니라 형식 오류·범위 밖·COMTRADE 변형까지 입력 진단이 어떻게 반응하는지 확인하는 용도.

export interface ScenarioFiles {
  file: File
  cfg?: File
  title: string
  sourceType: SourceType
  samplingRateHz: number
  systemFrequencyHz: 50 | 60
}

export interface InputScenario {
  id: string
  group: '정상 입력' | '범위 밖' | '형식 오류' | 'COMTRADE'
  label: string
  /** 기대하는 입력 진단 결과 */
  expect: DiagnosisStatus
  note: string
  build: () => ScenarioFiles
}

const csv = (name: string, text: string) => new File([text], name, { type: 'text/csv' })
const meta = (title: string, fs = 4096, hz: 50 | 60 = 50) => ({ title, sourceType: 'SYNTHETIC' as const, samplingRateHz: fs, systemFrequencyHz: hz })

export const INPUT_SCENARIOS: InputScenario[] = [
  { id: 'a-ground', group: '정상 입력', label: 'A상 지락', expect: 'ACCEPTED', note: 'A상 전류 급증 · 전압 강하', build: () => ({ file: csv('a_ground.csv', toCsv(synthesize({ phase: 0 }))), ...meta('A상 지락') }) },
  { id: 'b-transient', group: '정상 입력', label: 'B상 순간 이상', expect: 'ACCEPTED', note: '약 2주기만 이상 후 회복', build: () => ({ file: csv('b_transient.csv', toCsv(synthesize({ phase: 1, onset: 700, duration: 180, currentGain: 2.4, voltageGain: 0.75 }))), ...meta('B상 순간 이상') }) },
  { id: 'ab-short', group: '정상 입력', label: 'A·B 2상 단락', expect: 'ACCEPTED', note: '두 상 전류 동시 증가', build: () => ({ file: csv('ab_short.csv', toCsv(synthesize({ phase: [0, 1], currentGain: 7, voltageGain: 0.45 }))), ...meta('A·B 2상 단락') }) },
  { id: 'abc-short', group: '정상 입력', label: '3상 단락', expect: 'ACCEPTED', note: '세 상 모두 전류 증가 · 전압 붕괴', build: () => ({ file: csv('abc_short.csv', toCsv(synthesize({ phase: [0, 1, 2], currentGain: 8, voltageGain: 0.15 }))), ...meta('3상 단락') }) },
  {
    id: 'no-header',
    group: '정상 입력',
    label: '헤더 없는 CSV',
    expect: 'ACCEPTED',
    note: '채널 순서를 가정하고 경고',
    build: () => ({ file: csv('no_header.csv', toCsv(synthesize({ phase: 0 })).split('\n').slice(1).join('\n')), ...meta('헤더 없는 CSV') }),
  },
  { id: 'fs-2000', group: '범위 밖', label: '샘플링 2,000Hz', expect: 'LIMITED', note: '학습 조건(4,096Hz)과 다름', build: () => ({ file: csv('fs_2000.csv', toCsv(synthesize({ phase: 0, fs: 2000, rows: 1312 }))), ...meta('샘플링 2,000Hz', 2000) }) },
  { id: 'len-2048', group: '범위 밖', label: '길이 2,048샘플', expect: 'LIMITED', note: '학습 조건(1,312)보다 김', build: () => ({ file: csv('len_2048.csv', toCsv(synthesize({ phase: 1, rows: 2048, onset: 900 }))), ...meta('길이 2,048샘플') }) },
  { id: 'hz-60', group: '범위 밖', label: '국내 60Hz 계통', expect: 'LIMITED', note: '50Hz 공개 데이터로만 학습됨', build: () => ({ file: csv('kr_60hz.csv', toCsv(synthesize({ phase: 2, systemHz: 60 }))), ...meta('국내 60Hz 계통', 4096, 60) }) },
  { id: 'broken', group: '형식 오류', label: '결측·문자·6채널', expect: 'REJECTED', note: 'NaN, 문자, 채널 누락', build: () => ({ file: csv('broken.csv', syntheticCsv('broken')), ...meta('결측·문자·6채널') }) },
  {
    id: 'order',
    group: '형식 오류',
    label: '채널 순서 뒤바뀜',
    expect: 'REJECTED',
    note: '전압 열이 전류보다 앞에 옴',
    build: () => {
      const m = synthesize({ phase: 0 }).map((r) => [...r.slice(4), ...r.slice(0, 4)])
      return { file: csv('swapped.csv', toCsv(m, [...CHANNELS.slice(4), ...CHANNELS.slice(0, 4)])), ...meta('채널 순서 뒤바뀜') }
    },
  },
  { id: 'empty', group: '형식 오류', label: '빈 파일', expect: 'REJECTED', note: '헤더만 있고 값이 없음', build: () => ({ file: csv('empty.csv', CHANNELS.join(',')), ...meta('빈 파일') }) },
  {
    id: 'ct-60',
    group: 'COMTRADE',
    label: '국내 FRTU 60Hz (ASCII)',
    expect: 'LIMITED',
    note: '.cfg에서 60Hz·3,840Hz 자동 인식',
    build: () => {
      const { cfg, dat } = toComtrade(synthesize({ phase: 2, systemHz: 60, fs: 3840, rows: 1280, onset: 640 }), { station: 'EXAMPLE_SS', device: 'FRTU-EX01', fs: 3840, lf: 60 })
      return { file: new File([dat], 'frtu_60hz.dat'), cfg: new File([cfg], 'frtu_60hz.cfg'), ...meta('국내 FRTU 60Hz (COMTRADE)', 3840, 60) }
    },
  },
  {
    id: 'ct-bin',
    group: 'COMTRADE',
    label: '50Hz BINARY',
    expect: 'ACCEPTED',
    note: '이진 .dat · 배율 적용',
    build: () => {
      const { cfg, dat } = toComtrade(synthesize({ phase: 0 }), { station: 'EXAMPLE_LAB', device: 'REC-50', fs: 4096, lf: 50, fileType: 'BINARY' })
      return { file: new File([dat], 'lab_50hz.dat'), cfg: new File([cfg], 'lab_50hz.cfg'), ...meta('50Hz BINARY (COMTRADE)') }
    },
  },
  {
    id: 'ct-no-in',
    group: 'COMTRADE',
    label: '중성선(In) 채널 없음',
    expect: 'ACCEPTED',
    note: 'In을 Ia+Ib+Ic로 계산',
    build: () => {
      const { cfg, dat } = toComtrade(synthesize({ phase: 1 }), { station: 'EXAMPLE_LAB', device: 'REC-6CH', fs: 4096, lf: 50, channels: [0, 1, 2, 4, 5, 6] })
      return { file: new File([dat], 'no_neutral.dat'), cfg: new File([cfg], 'no_neutral.cfg'), ...meta('In 채널 없음 (COMTRADE)') }
    },
  },
  {
    id: 'ct-current-only',
    group: 'COMTRADE',
    label: '전압 채널 없음',
    expect: 'REJECTED',
    note: '전류만 기록된 장치',
    build: () => {
      const { cfg, dat } = toComtrade(synthesize({ phase: 0 }), { station: 'EXAMPLE_LAB', device: 'CT-ONLY', fs: 4096, lf: 50, channels: [0, 1, 2, 3] })
      return { file: new File([dat], 'current_only.dat'), cfg: new File([cfg], 'current_only.cfg'), ...meta('전압 채널 없음 (COMTRADE)') }
    },
  },
]
