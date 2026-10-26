import { useId } from 'react'

/** 추세만 보여주는 작은 선 그래프. 축·눈금 없음 */
export default function Sparkline({ values, color = '#1c1e24', height = 32, minSpan = 0, fill = true }: { values: number[]; color?: string; height?: number; minSpan?: number; fill?: boolean }) {
  const id = useId()
  const W = 200
  if (values.length < 2) return <svg className="spark" viewBox={`0 0 ${W} ${height}`} style={{ height }} aria-hidden />
  // 노이즈만 있을 때 과하게 확대되지 않도록 최소 범위 유지
  const mid = (Math.min(...values) + Math.max(...values)) / 2
  const span = Math.max(Math.max(...values) - Math.min(...values), minSpan) || 1
  const lo = mid - span / 2
  const line = values.map((v, i) => `${(i / (values.length - 1)) * W},${height - 3 - ((v - lo) / span) * (height - 6)}`).join(' ')
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" style={{ height }} aria-hidden>
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.1} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={`0,${height} ${line} ${W},${height}`} fill={`url(#${id})`} />
        </>
      )}
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  )
}
