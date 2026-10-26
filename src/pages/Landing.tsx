import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import FaultAnalysis from '../components/FaultAnalysis'
import { IconArrowRight, IconBars, IconBrain, IconPerson, IconSearch, IconShieldCheck, IconWave } from '../components/Icons'
import { computeFeatures, PREPROCESS_VERSION, synthesize } from '../lib/waveform'
import type { AnalysisResult } from '../types'

/** 안쪽 화면을 고정 폭으로 그린 뒤 컨테이너 폭에 맞게 줄여서 보여줌 (노트북 화면용) */
function ScaleToFit({ width, children }: { width: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [h, setH] = useState(0)
  useEffect(() => {
    const el = box.current
    const inn = inner.current
    if (!el || !inn) return
    const update = () => {
      setScale(Math.min(1, el.clientWidth / width))
      setH(inn.offsetHeight)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    ro.observe(inn)
    return () => ro.disconnect()
  }, [width])
  return (
    <div ref={box} style={{ width: '100%', height: h * scale, overflow: 'hidden' }}>
      <div ref={inner} style={{ width, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{children}</div>
    </div>
  )
}

function Tower({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 320" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M60 8v30M30 38h60M42 38l-20 282M78 38l20 282M36 100h48M30 150h60M24 210h72M42 38l36 62M78 38l-36 62M36 100l48 50M84 100l-48 50M30 150l60 60M90 150l-60 60M60 8l-8 14M60 8l8 14M8 62h104M20 62v14M100 62v14" />
    </svg>
  )
}

function BrandMark() {
  return (
    <svg className="land-mark" viewBox="0 0 150 64" fill="none" aria-hidden>
      <path d="M0 40h22l6-18 10 36 9-30 6 12h20" stroke="#2f62d6" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <g stroke="#1b3aa8" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M112 4v8M102 12h20M106 12l-7 48M118 12l7 48M104 28h16M101 44h22M106 12l12 16M118 12l-12 16M104 28l16 16M120 28l-16 16" />
      </g>
    </svg>
  )
}

const FEATURES = [
  { icon: <IconShieldCheck />, text: '데이터 품질부터\n꼼꼼하게' },
  { icon: <IconBrain />, text: '파형을 분석하고\n이벤트 유형 판단' },
  { icon: <IconBars />, text: '판단의 근거를\n함께 제시' },
  { icon: <IconPerson />, text: '사람의 검토로\n더 신뢰할 수 있게' },
]

const SIGNALS = [
  { icon: <IconWave />, title: '이벤트 유형 판단', text: 'SIF·MIF·PF·TD 4종으로 분류하고, 근거가 부족하면 판단을 보류합니다' },
  { icon: <IconBars />, title: '신뢰할 수 있는 근거 제시', text: '피크값, RMS, 사건 시점 등 파형에서 직접 계산한 수치와 그래프를 함께 보여줍니다' },
  { icon: <IconPerson />, title: '사람의 최종 검토', text: 'AI 결과는 그대로 보존하고, 담당자의 판단과 조사 내용을 따로 기록합니다' },
]

const FLOW = [
  { icon: <IconWave />, title: '고장파형 입력', text: '계측된 전압·전류 파형\n(CSV·COMTRADE) 입력' },
  { icon: <IconSearch />, title: '품질 검사', text: '결측, 채널 순서, 샘플링\n조건을 자동 점검' },
  { icon: <IconBrain />, title: 'AI 판단', text: '품질이 확인된 파형만\n이벤트 유형 분석' },
  { icon: <IconBars />, title: '근거 제시', text: '피크값, RMS, 사건 시점\n등 근거 제공' },
  { icon: <IconPerson />, title: '사람 검토', text: '전문가가 결과를 검토하여\n최종 판단' },
]

export default function Landing() {
  // 소개 화면용 합성 예시 (실제 계측 자료가 아님)
  const { matrix, analysis } = useMemo(() => {
    const m = synthesize({ phase: 0, seed: 101, currentGain: 6.2 })
    const a: AnalysisResult = {
      kind: 'COMPLETED',
      analysisType: 'EVENT_TYPE',
      predictedLabel: 'SIF',
      scores: { SIF: 0.78, MIF: 0.1, PF: 0.04, TD: 0.08 },
      features: computeFeatures(m),
      limitations: [],
      modelVersion: 'example',
      preprocessVersion: PREPROCESS_VERSION,
      executedAt: new Date().toISOString(),
    }
    return { matrix: m, analysis: a }
  }, [])

  return (
    <div className="landing">
      <Tower className="land-tower l" />
      <Tower className="land-tower r" />

      <header className="land-nav">
        <Link to="/" className="land-logo">
          <span className="brand-mark"><IconTowerSmall /></span>
          GridWitness
        </Link>
        <nav>
          <Link to="/village">스마트 마을</Link>
          <Link to="/cases">고장파형 분석</Link>
          <Link to="/public-data">공공데이터</Link>
          <Link to="/dashboard" className="btn btn-primary btn-sm">시작하기</Link>
        </nav>
      </header>

      <section className="land-hero">
        <div className="land-copy">
          <h1 className="land-wordmark">
            Grid<span>Witness</span>
            <BrandMark />
          </h1>
          <p className="land-lead">AI가 읽는 전력의 이상, 더 안전한 오늘을 만듭니다.</p>
          <p className="land-sub">고장파형을 올바르게 보고, 근거로 판단하는 AI 기반 전력계통 고장 분석 시스템</p>
          <div className="land-cta">
            <Link to="/dashboard" className="btn btn-xl btn-primary">
              시작하기
              <IconArrowRight />
            </Link>
            <Link to="/village" className="btn btn-xl">스마트 마을 보기</Link>
          </div>
        </div>
        <ul className="land-features">
          {FEATURES.map((f, k) => (
            <li key={k}>
              <span className="land-ficon">{f.icon}</span>
              <span>{f.text}</span>
            </li>
          ))}
        </ul>
        <p className="land-quote">전력의 안정,<br />사람의 일상을 지키는 기술</p>
      </section>

      <section className="land-stage">
        <div className="land-laptop">
          <div className="laptop-screen">
            <div className="laptop-bar">
              <span className="laptop-logo">GridWitness</span>
              <span className="laptop-tabs">
                <i>대시보드</i>
                <i className="on">파형 분석</i>
                <i>AI 분석 결과</i>
                <i>이력 관리</i>
              </span>
              <span className="laptop-user"><IconPerson /></span>
            </div>
            <div className="laptop-body">
              <ScaleToFit width={1060}>
                <div style={{ padding: 16 }}>
                  <FaultAnalysis matrix={matrix} fs={4096} hz={50} analysis={analysis} compact />
                </div>
              </ScaleToFit>
            </div>
          </div>
          <div className="laptop-base" />
          <div className="land-caption">합성 예시 화면입니다. 실제 계측 자료가 아닙니다.</div>
        </div>

        <aside className="land-signals">
          <div className="land-signals-head">AI가 찾는 전력계통의 이상 신호</div>
          {SIGNALS.map((s) => (
            <div key={s.title} className="land-signal">
              <span className="land-sicon">{s.icon}</span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </div>
            </div>
          ))}
        </aside>
      </section>

      <section className="land-flow">
        <div className="land-flow-brand">
          <span>Grid<b>Witness</b></span>
          <small>분석이 아닌, 신뢰할 수 있는 판단으로</small>
        </div>
        <ol>
          {FLOW.map((f, k) => (
            <li key={f.title}>
              <span className="land-step-no">{k + 1}</span>
              <div className="land-step-body">
                <strong>{f.title}</strong>
                <p>{f.text}</p>
              </div>
              <span className="land-step-icon">{f.icon}</span>
            </li>
          ))}
        </ol>
      </section>

      <footer className="land-foot">
        <span>2026 빛가람 AI·ICT 경진대회 · 팀 시험기간</span>
        <Link to="/dashboard">대시보드로 이동 →</Link>
      </footer>
    </div>
  )
}

function IconTowerSmall() {
  return (
    <svg width="15" height="15" viewBox="0 0 64 64" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M32 18 L19 52 M32 18 L45 52" />
        <path d="M20 26 H44 M23 35 H41" />
        <path d="M26.5 35 L37.5 45 M37.5 35 L26.5 45" />
      </g>
      <circle cx="32" cy="11" r="5.5" fill="#7c97ff" />
    </svg>
  )
}
