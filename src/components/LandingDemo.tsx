import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route } from 'react-router-dom'
import { Shell } from '../AppShell'
import { WaveformCaseView } from '../pages/CaseDetail'
import type { IncidentCase } from '../types'
import { useMedia } from '../lib/useMedia'
import { IconPerson } from './Icons'

// 소개 화면의 노트북. 실제 앱 화면(사이드바 + 고장파형 분석·스마트 마을·실시간 분석)을 그대로 띄운다.
// 고장파형은 실제 공개 파형(Xiong 87) 샘플 사건이고, 마을 계측값은 시뮬레이터 값이다.

type TabId = 'cases' | 'village' | 'live'
const TABS: { id: TabId; label: string; path: string }[] = [
  { id: 'cases', label: '고장파형 분석', path: '/cases/demo' },
  { id: 'village', label: '스마트 마을', path: '/village' },
  { id: 'live', label: '실시간 분석', path: '/live' },
]
/** 앱 화면을 이 폭으로 그린 뒤 노트북 폭에 맞게 줄임 */
const EMBED_W = 1180
const EMBED_H = 780
/** 폰에서는 사이드바를 빼고 더 좁게 그려 글자가 읽히게 함 */
const NARROW_W = 800
const NARROW_H = 600
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

export default function LandingDemo({ demoCase }: { demoCase: IncidentCase }) {
  const narrow = useMedia('(max-width: 700px)')
  const [active, setActive] = useState<TabId>('cases')
  const [auto, setAuto] = useState(true)

  useEffect(() => {
    if (!auto || reduceMotion()) return
    const t = setInterval(() => {
      if (document.hidden) return
      setActive((a) => TABS[(TABS.findIndex((x) => x.id === a) + 1) % TABS.length].id)
    }, CYCLE_MS)
    return () => clearInterval(t)
  }, [auto])

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
      <div className="laptop-body">
        <div key={active} className="laptop-panel">
          <ScaleToFit width={narrow ? NARROW_W : EMBED_W} height={narrow ? NARROW_H : EMBED_H}>
            <EmbeddedApp narrow={narrow} path={TABS.find((t) => t.id === active)!.path} demoCase={demoCase} />
          </ScaleToFit>
        </div>
      </div>
    </div>
  )
}

/** 안쪽 화면을 고정 폭으로 그린 뒤 컨테이너 폭에 맞게 줄여서 보여줌 */
function ScaleToFit({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const update = () => setScale(Math.min(1, el.clientWidth / width))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={box} style={{ width: '100%', height: height * scale, overflow: 'hidden' }}>
      <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div>
    </div>
  )
}

/** 앱을 별도 React 루트로 띄움. 소개 화면이 이미 라우터 안이라 라우터를 겹쳐 쓸 수 없기 때문 */
function EmbeddedApp({ path, demoCase, narrow }: { path: string; demoCase: IncidentCase; narrow: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = host.current
    if (!el) return
    const mount = document.createElement('div')
    mount.style.height = '100%'
    el.appendChild(mount)
    const root = createRoot(mount)
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <Shell extraRoutes={<Route path="/cases/demo" element={<WaveformCaseView c={demoCase} onChange={() => {}} />} />} />
      </MemoryRouter>,
    )
    return () => {
      queueMicrotask(() => {
        root.unmount()
        mount.remove()
      })
    }
  }, [path, demoCase])
  return <div ref={host} className={`embed-app ${narrow ? 'embed-narrow' : ''}`} inert aria-hidden />
}
