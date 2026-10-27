import type { ReactNode } from 'react'
import { IconBars, IconBrain, IconPerson, IconSearch, IconShieldCheck, IconWave } from './Icons'

// 소개 화면과 개요 화면이 함께 쓰는 문구·그림

export function BrandMark() {
  return (
    <svg className="land-mark" viewBox="0 0 150 64" fill="none" aria-hidden>
      <path d="M0 40h22l6-18 10 36 9-30 6 12h20" stroke="#2f62d6" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
      <g stroke="#1b3aa8" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M112 4v8M102 12h20M106 12l-7 48M118 12l7 48M104 28h16M101 44h22M106 12l12 16M118 12l-12 16M104 28l16 16M120 28l-16 16" />
      </g>
    </svg>
  )
}

export const FEATURES = [
  { icon: <IconShieldCheck />, text: '데이터 품질부터\n꼼꼼하게' },
  { icon: <IconBrain />, text: '파형을 분석하고\n이벤트 유형 판단' },
  { icon: <IconBars />, text: '판단의 근거를\n함께 제시' },
  { icon: <IconPerson />, text: '사람의 검토로\n더 신뢰할 수 있게' },
]

export const FLOW = [
  { icon: <IconWave />, title: '고장파형 입력', text: '계측된 전압·전류 파형\n(CSV·COMTRADE) 입력' },
  { icon: <IconSearch />, title: '품질 검사', text: '결측, 채널 순서, 샘플링\n조건을 자동 점검' },
  { icon: <IconBrain />, title: 'AI 판단', text: '품질이 확인된 파형만\n이벤트 유형 분석' },
  { icon: <IconBars />, title: '근거 제시', text: '피크값, RMS, 사건 시점\n등 근거 제공' },
  { icon: <IconPerson />, title: '사람 검토', text: '전문가가 결과를 검토하여\n최종 판단' },
]


export function IntroFeatures() {
  return (
    <ul className="land-features">
      {FEATURES.map((f, k) => (
        <li key={k}>
          <span className="land-ficon">{f.icon}</span>
          <span>{f.text}</span>
        </li>
      ))}
    </ul>
  )
}

export function IntroFlow({ children }: { children?: ReactNode }) {
  return (
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
      {children}
    </section>
  )
}
