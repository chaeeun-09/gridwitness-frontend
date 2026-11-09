import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { IconArrowRight, IconBars, IconPerson, IconWave } from '../components/Icons'
import { BrandMark, IntroFeatures, IntroFlow } from '../components/Intro'
import LandingDemo, { Reveal } from '../components/LandingDemo'
import { buildSampleCase } from '../lib/sample'
import type { IncidentCase } from '../types'

function Tower({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 320" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M60 8v30M30 38h60M42 38l-20 282M78 38l20 282M36 100h48M30 150h60M24 210h72M42 38l36 62M78 38l-36 62M36 100l48 50M84 100l-48 50M30 150l60 60M90 150l-60 60M60 8l-8 14M60 8l8 14M8 62h104M20 62v14M100 62v14" />
    </svg>
  )
}

const SIGNALS = [
  { icon: <IconWave />, title: '이벤트 유형 판단', text: 'SIF·MIF·PF·TD 4종으로 분류하고, 근거가 부족하면 판단을 보류합니다' },
  { icon: <IconBars />, title: '신뢰할 수 있는 근거 제시', text: 'AI가 통과한 판단 기준과 점수를 움직인 파형 특징(SHAP)을 보여주고, 시험에서 얼마나 맞고 보류했는지도 공개합니다' },
  { icon: <IconPerson />, title: '사람의 최종 검토', text: 'AI 결과는 그대로 보존하고, 담당자의 판단과 조사 내용을 따로 기록합니다' },
]


export default function Landing() {
  // 앱의 사건 목록에 있는 것과 같은 샘플 사건 = 실제 공개 파형 Xiong 87 원본
  const [demoCase, setDemoCase] = useState<IncidentCase | null>(null)
  useEffect(() => {
    void buildSampleCase().then(setDemoCase)
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
            <em className="wm-a">Grid</em>
            <span className="wm-b">Witness</span>
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
        <IntroFeatures />
        <p className="land-quote">전력의 안정,<br />사람의 일상을 지키는 기술</p>
      </section>

      <section className="land-stage">
        <Reveal className="land-laptop tilt">
          {demoCase ? <LandingDemo demoCase={demoCase} /> : <div className="laptop-screen laptop-wait" />}
          <div className="laptop-base" />
          <div className="land-caption">실제 공개 고장파형(Xiong et al., MIT) 원본입니다. 중국 10kV 배전 기록이며 국내 자료가 아닙니다.</div>
        </Reveal>

        <aside className="land-signals reveal-group">
          <div className="land-signals-head">AI가 찾는 전력계통의 이상 신호</div>
          {SIGNALS.map((s, k) => (
            <div key={s.title} className="land-signal" style={{ animationDelay: `${0.5 + k * 0.18}s` }}>
              <span className="land-sicon">{s.icon}</span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </div>
            </div>
          ))}
        </aside>
      </section>

      <Reveal className="land-flow-wrap">
        <IntroFlow />
      </Reveal>

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
