import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconPerson } from './Icons'

// 소개 화면의 노트북 목업. 실제 메뉴(고장파형 분석·스마트 마을·실시간 분석)가 돌아가며 움직인다.
// 모두 합성 화면이며 실제 계측값이 아님.

type TabId = 'cases' | 'village' | 'live'
const TABS: { id: TabId; label: string }[] = [
  { id: 'cases', label: '고장파형 분석' },
  { id: 'village', label: '스마트 마을' },
  { id: 'live', label: '실시간 분석' },
]
const CYCLE_MS = 7000

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** 화면에 들어올 때 한 번 나타나는 래퍼 */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.12 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div ref={ref} className={`reveal ${shown ? 'in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

export default function LandingDemo({ casesView }: { casesView: ReactNode }) {
  const [active, setActive] = useState<TabId>('cases')
  const [auto, setAuto] = useState(true)
  const [minH, setMinH] = useState(0)
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!auto || reduceMotion()) return
    const t = setInterval(() => {
      if (document.hidden) return
      setActive((a) => TABS[(TABS.findIndex((x) => x.id === a) + 1) % TABS.length].id)
    }, CYCLE_MS)
    return () => clearInterval(t)
  }, [auto])

  // 가장 큰 화면 높이에 맞춰 탭을 바꿔도 노트북이 출렁이지 않게 함
  useEffect(() => {
    const el = body.current
    if (!el) return
    const ro = new ResizeObserver(() => setMinH((h) => Math.max(h, el.offsetHeight)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div className="laptop-screen" onMouseEnter={() => setAuto(false)} onMouseLeave={() => setAuto(true)}>
      <div className="laptop-bar">
        <span className="laptop-logo">GridWitness</span>
        <span className="laptop-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? 'on' : ''} onClick={() => setActive(t.id)}>
              {t.label}
            </button>
          ))}
        </span>
        <span className="laptop-user"><IconPerson /></span>
      </div>
      <div className="laptop-progress" aria-hidden>
        {auto && !reduceMotion() && <i key={active} style={{ animationDuration: `${CYCLE_MS}ms` }} />}
      </div>
      <div ref={body} className="laptop-body" style={{ minHeight: minH || undefined }}>
        <div key={active} className="laptop-panel">
          {active === 'cases' && <div className="demo-cases">{casesView}</div>}
          {active === 'village' && <VillageDemo />}
          {active === 'live' && <LiveDemo />}
        </div>
      </div>
    </div>
  )
}

/** 스마트 마을: 전원이 들어왔다 나갔다 하며 숫자가 바뀐다 */
function VillageDemo() {
  const [on, setOn] = useState(true)
  useEffect(() => {
    if (reduceMotion()) return
    const t = setInterval(() => setOn((v) => !v), 2800)
    return () => clearInterval(t)
  }, [])
  const houses = [34, 150, 266]
  return (
    <div className="demo demo-village">
      <div className="demo-main sky">
        <div className="demo-title">
          <strong>스마트 마을</strong>
          <span className={`demo-pill ${on ? 'ok' : 'bad'}`}>{on ? '전력 공급 중' : '정전 발생'}</span>
        </div>
        <svg viewBox="0 0 520 250" className={`village-svg ${on ? 'on' : 'off'}`} role="img" aria-label="스마트 마을 예시 화면">
          <rect x="14" y="196" width="492" height="38" rx="8" className="v-deck" />
          <path d="M26 215 H494" className="v-wire" />
          <path d="M26 215 H494" className="v-flow" />
          <rect x="22" y="150" width="30" height="46" rx="4" className="v-adapter" />
          <text x="37" y="178" textAnchor="middle" className="v-label">5V</text>
          {houses.map((x, k) => (
            <g key={x} transform={`translate(${x + 56} 0)`}>
              <rect x="0" y="118" width="86" height="78" rx="4" className="v-house" />
              <path d="M-8 120 L43 78 L94 120 Z" className="v-roof" />
              <rect x="28" y="140" width="30" height="30" rx="3" className="v-win" style={{ transitionDelay: `${k * 90}ms` }} />
              <rect x="28" y="140" width="30" height="30" rx="3" className="v-glow" style={{ transitionDelay: `${k * 90}ms` }} />
            </g>
          ))}
          {[418, 468].map((x) => (
            <g key={x}>
              <path d={`M${x} 196 V110`} className="v-pole" />
              <circle cx={x} cy="104" r="9" className="v-bulb" />
              <circle cx={x} cy="104" r="26" className="v-halo" />
            </g>
          ))}
        </svg>
      </div>
      <div className="demo-side">
        <div className="demo-card">
          <span className="demo-k">전압</span>
          <b className="num">{on ? '5.02' : '0.00'} <small>V</small></b>
        </div>
        <div className="demo-card">
          <span className="demo-k">전류</span>
          <b className="num">{on ? '0.281' : '0.000'} <small>A</small></b>
        </div>
        <div className="demo-card">
          <span className="demo-k">켜진 LED (추정)</span>
          <b className="num">{on ? 5 : 0} <small>/ 5</small></b>
        </div>
        <p className="demo-note">릴레이 하나로 마을 전체를 켜고 끕니다.</p>
      </div>
    </div>
  )
}

/** 실시간 분석: 실제 전류가 예상에서 벗어나면 이상 점수가 오른다 */
function LiveDemo() {
  const { actual, expected } = useMemo(() => {
    const pts: string[] = []
    for (let x = 0; x <= 520; x += 5) {
      const base = 120 + Math.sin(x * 0.45) * 3 + Math.sin(x * 2.9) * 1.6
      const dev = x > 300 ? Math.min(1, (x - 300) / 18) * (48 + Math.sin(x * 1.1) * 7) : 0
      pts.push(`${x},${(base - dev).toFixed(1)}`)
    }
    return { actual: `M${pts.join(' L')}`, expected: 'M0,120 H520' }
  }, [])
  return (
    <div className="demo demo-live">
      <div className="demo-main">
        <div className="demo-title">
          <strong>예상 대비 실제 전류</strong>
          <span className="demo-legend"><i className="a" />실제 <i className="e" />예상</span>
        </div>
        <svg viewBox="0 0 520 200" className="live-svg" role="img" aria-label="실시간 분석 예시 화면">
          {[40, 80, 120, 160].map((y) => <path key={y} d={`M0 ${y} H520`} className="l-grid" />)}
          <path d={expected} className="l-exp" />
          <path d={actual} className="l-act" pathLength={1} />
          <path d="M300 10 V190" className="l-mark" />
          <text x="306" y="22" className="l-marktext">이상 감지</text>
        </svg>
      </div>
      <div className="demo-side">
        <div className="demo-card">
          <span className="demo-k">이상 점수</span>
          <b className="num score-num">
            <span className="sc-a">0.04</span>
            <span className="sc-b">0.82</span>
          </b>
          <div className="gauge"><i /></div>
          <div className="gauge-scale"><span>정상</span><span>주의 0.3</span><span>이상 0.6</span></div>
        </div>
        <div className="demo-card">
          <span className="demo-k">판정</span>
          <b className="demo-verdict"><span className="vd-a">정상</span><span className="vd-b">이상</span></b>
        </div>
        <p className="demo-note">릴레이 상태로 예상 전류를 정하고 실제 전류와의 차이로 점수를 계산합니다.</p>
      </div>
    </div>
  )
}
