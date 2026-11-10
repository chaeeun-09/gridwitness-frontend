import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { diagnose, parseCsv, computeFeatures, preprocess } from '../src/lib/waveform.ts'
import { analyzeWaveform } from '../src/lib/faultAnalysis.ts'
import { parseComtrade, toComtrade } from '../src/lib/comtrade.ts'

const ru = Array.from({ length: 512 }, (_, i) => [1, 2, 3, 4, 5].map((a) => a * Math.sin(2 * Math.PI * i / 32)))

test('native Russian waveform accepts five measured channels at 1600 Hz', () => {
  const result = diagnose({ header: ['Ia', 'Ic', 'Va', 'Vb', 'Vc'], rows: ru.map((r) => r.map(String)) }, 20000, { samplingRateHz: 1600, systemFrequencyHz: 50, sourceType: 'PUBLIC_DATASET' })
  assert.equal(result.diagnosis.status, 'ACCEPTED')
  assert.equal(result.matrix[0].length, 5)
  assert.deepEqual(computeFeatures(ru).map((f) => f.channel), ['Ia', 'Ic', 'Va', 'Vb', 'Vc'])
  assert.ok(preprocess(ru).flat().every(Number.isFinite))
})

test('Russian input does not silently invent missing current channels', () => {
  const result = diagnose({ header: ['Ia', 'Ib', 'Va', 'Vb', 'Vc'], rows: ru.map((r) => r.map(String)) }, 20000, { samplingRateHz: 1600, systemFrequencyHz: 50, sourceType: 'PUBLIC_DATASET' })
  assert.equal(result.diagnosis.status, 'REJECTED')
  const summary = analyzeWaveform(ru, 1600, 50)
  assert.equal(summary.zeroSeq, null)
  assert.ok(summary.currents.every((c) => c.phase !== 'B'))
})

test('PF44 does not report immediate recovery from the onset sample', async () => {
  const text = await readFile(new URL('../public/data/xiong/xiong-44.csv', import.meta.url), 'utf8')
  const matrix = parseCsv(text).rows.map((r) => r.map(Number))
  const summary = analyzeWaveform(matrix, 4096, 50)
  assert.ok(summary.onset)
  assert.equal(summary.recoverSeconds, null)
  assert.ok(summary.patterns.some((p) => p.includes('회복 확인 못함')))
})

test('recovery needs a sustained abnormal window followed by return to baseline', () => {
  const matrix = Array.from({ length: 640 }, (_, i) => [1, 1, 1, 0.02, 100, 100, 100].map((a, j) => a * Math.sin(2 * Math.PI * i / 32) * (i >= 160 && i < 320 && j < 3 ? 4 : 1)))
  const summary = analyzeWaveform(matrix, 1600, 50)
  assert.ok(summary.onset)
  assert.ok(summary.recoverSeconds >= 320 / 1600)
  assert.ok(summary.recoverSeconds > summary.onset.seconds)
})

test('COMTRADE keeps native RU channels and rejects absent CN neutral rather than deriving it', () => {
  const cn = Array.from({ length: 512 }, () => [10, 20, 30, 1, 100, 110, 120])
  const parse = (channels) => {
    const { cfg, dat } = toComtrade(cn, { station: 'S', device: 'D', fs: 1600, lf: 50, channels })
    return parseComtrade(cfg, new TextEncoder().encode(dat).buffer)
  }
  const native = parse([0, 2, 4, 5, 6])
  assert.deepEqual(native.matrix[0], [10, 30, 100, 110, 120])
  const absent = parse([0, 1, 2, 4, 5, 6])
  assert.equal(absent.matrix, null)
  assert.ok(absent.issues.some((i) => i.severity === 'error'))
})
