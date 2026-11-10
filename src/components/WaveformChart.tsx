import { useMemo, useState } from 'react'
import { Brush, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART } from '../lib/chart'
import { preprocess, PREPROCESS_VERSION } from '../lib/waveform'
import { Segmented } from './ui'
import { channelsFor, type Channel } from '../types'

// 상(A·B·C)별 색은 전류·전압이 같은 계열, 전압은 한 단계 밝게
export const COLORS: Record<Channel, string> = {
  Ia: '#c8462f', Ib: '#24835a', Ic: '#3157e0', In: '#7b808b',
  Va: '#e58a6f', Vb: '#5fb68c', Vc: '#7f99f0',
}

const GROUPS: { label: string; channels: Channel[] }[] = [
  { label: '전류', channels: ['Ia', 'Ib', 'Ic', 'In'] },
  { label: '전압', channels: ['Va', 'Vb', 'Vc'] },
]

export default function WaveformChart({ matrix, samplingRateHz }: { matrix: number[][]; samplingRateHz: number }) {
  const channels = channelsFor(matrix[0]?.length ?? 0)
  const [mode, setMode] = useState<'raw' | 'prep'>('raw')
  const [visible, setVisible] = useState<Set<Channel>>(new Set(['Ia', 'Ib', 'Ic', 'In']))

  const data = useMemo(() => {
    const m = mode === 'raw' ? matrix : preprocess(matrix)
    return m.map((r, i) => {
      const row: Record<string, number> = { t: +((i / samplingRateHz) * 1000).toFixed(2) }
      channels.forEach((c, j) => (row[c] = r[j]))
      return row
    })
  }, [matrix, mode, samplingRateHz, channels])

  const toggle = (c: Channel) =>
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(c)) next.delete(c)
      else next.add(c)
      return next
    })

  return (
    <div>
      <div className="chart-toolbar">
        <Segmented value={mode} onChange={setMode} options={[{ value: 'raw', label: '원본' }, { value: 'prep', label: '전처리 후' }]} />
        {GROUPS.map((g) => (
          <div key={g.label} className="chips">
            <span className="muted">{g.label}</span>
            {g.channels.filter((c) => channels.includes(c)).map((c) => (
              <button
                key={c}
                className={`chip ${visible.has(c) ? 'on' : ''}`}
                style={{ '--c': COLORS[c] } as React.CSSProperties}
                onClick={() => toggle(c)}
                aria-pressed={visible.has(c)}
              >
                {c}
              </button>
            ))}
          </div>
        ))}
      </div>
      {mode === 'prep' && <p className="hint" style={{ marginTop: 0, marginBottom: 8 }}>{PREPROCESS_VERSION} — AI에 입력된 형태입니다.</p>}
      <div className="chart">
        <ResponsiveContainer width="100%" height={360}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis dataKey="t" unit="ms" type="number" domain={['dataMin', 'dataMax']} tick={CHART.tick} axisLine={false} tickLine={false} />
            <YAxis tick={CHART.tick} axisLine={false} tickLine={false} width={64} />
            <Tooltip formatter={(v) => (typeof v === 'number' ? v.toFixed(3) : v)} labelFormatter={(t) => `${t} ms`} />
            {channels.filter((c) => visible.has(c)).map((c) => (
              <Line key={c} dataKey={c} stroke={COLORS[c]} dot={false} strokeWidth={1.25} isAnimationActive={false} />
            ))}
            <Brush dataKey="t" height={22} travellerWidth={8} stroke={CHART.secondary} fill="#fafafb" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="hint">아래 막대를 끌어 구간을 확대합니다. 전류와 전압은 단위가 달라 따로 보는 편이 읽기 쉽습니다.</p>
    </div>
  )
}
