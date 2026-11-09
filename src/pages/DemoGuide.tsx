import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHeader, Section } from '../components/ui'
import { switchToMock, useVillage } from '../lib/village'

interface Step {
  id: string
  title: string
  /** 권장 시간 (초) */
  sec: number
  to: string
  open: string
  /** 화면에서 할 일 */
  doIt: string
  /** 발표자가 말할 한 문장 */
  say: string
}

const STEPS: Step[] = [
  { id: 'problem', title: '문제 제기', sec: 30, to: '/impact', open: '사업화 근거 열기', doIt: '2025년 전국 일시정전 건수와 우리 지역 순위를 보여 준다.', say: '지난해 원인을 조사해야 했던 정전만 전국 842건입니다. 매번 엔지니어가 파형을 직접 읽습니다.' },
  { id: 'dashboard', title: '관제 화면', sec: 30, to: '/dashboard', open: '대시보드 열기', doIt: 'FRTU 3대 고장표시, 처리할 사건, 대응 현황을 훑는다.', say: 'GridWitness는 처리할 사건과 현장 FRTU 상태를 한 화면에 모읍니다.' },
  { id: 'break', title: '사고 만들기', sec: 40, to: '/village', open: '3D 마을 열기', doIt: '모형의 주택 LED를 뽑거나, 제어판 → 고장 시뮬레이션 → LED 단선을 누른다. 실시간 사건 화면이 저절로 올라온다.', say: '지금 주택 쪽 선을 끊었습니다. 0.5초 안에 FRTU가 고장표시를 띄웁니다.' },
  { id: 'incident', title: '실시간 사건 읽기', sec: 50, to: '/village', open: '3D 마을로', doIt: '사건 전후 전류, 단선도, 점검 후보 구간과 순서, 원인 판정을 가리킨다.', say: '어느 분기인지, 어디부터 점검할지, 왜 그렇게 봤는지를 근거와 함께 보여 줍니다.' },
  { id: 'ask', title: 'AI에게 묻기', sec: 40, to: '/village', open: '3D 마을로', doIt: '사건 화면의 "AI에게 묻기" → "어느 분기가 문제야?"를 음성으로 묻는다.', say: '현장 담당자는 화면을 뒤질 필요 없이 말로 묻고, AI는 계측값을 근거로 답합니다.' },
  { id: 'recover', title: '복구 · 등록', sec: 30, to: '/village', open: '3D 마을로', doIt: 'LED를 다시 꽂거나 "이 LED 복구"를 누른다. "복구됨 · N초 만에"를 보여 주고 사건으로 등록한다.', say: '복구까지 걸린 시간이 기록되고, 사건은 검토 이력으로 남습니다.' },
  { id: 'withhold', title: '모르면 보류', sec: 50, to: '/field/GW-SAMPLE01', open: '현장 화면 열기', doIt: '교류 고장파형 사건에서 "어디를 먼저 점검해야 해?", "원인이 뭐야?"를 묻는다. 둘 다 보류와 필요한 정보가 나온다.', say: '근거가 없으면 지어내지 않고 보류합니다. 시험 48건 중 답한 45건의 정확도는 97.8%입니다.' },
  { id: 'note', title: '현장 메모', sec: 20, to: '/field/GW-SAMPLE01', open: '현장 화면 열기', doIt: '"현장 메모 남기기"에 한 줄 쓰고 "내용을 확인했어요"를 체크해 저장한다.', say: 'AI 제안과 담당자의 최종 판단은 따로, 담당자 이름으로 남습니다.' },
  { id: 'close', title: '마무리', sec: 30, to: '/impact', open: '사업화 근거 열기', doIt: '"GridWitness가 붙는 자리"를 보여 준다.', say: 'GridWitness는 DAS와 K-GIS 사이에서 파형 판독만 맡는 부가 모듈입니다. 판단은 끝까지 사람이 합니다.' },
]

const KEY = 'gridwitness.demo.done.v1'
const load = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

/** 시연 가이드: 발표 흐름대로 화면을 열고, 할 일과 말할 문장을 확인한다 */
export default function DemoGuide() {
  const snap = useVillage()
  const [done, setDone] = useState<string[]>(load)
  const toggle = (id: string) => {
    const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id]
    setDone(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // 저장 못 해도 화면에서는 동작
    }
  }
  const total = STEPS.reduce((n, s) => n + s.sec, 0)
  const live = snap.connected && snap.status !== 'NO_DATA'

  return (
    <>
      <PageHeader
        title="시연 가이드"
        description={`발표 흐름대로 ${STEPS.length}단계, 권장 ${Math.round(total / 60)}분 ${total % 60 ? `${total % 60}초` : ''}. 단계마다 열 화면, 할 일, 말할 한 문장을 정리했어요.`}
        actions={done.length > 0 && <button className="btn btn-sm" onClick={() => (setDone([]), localStorage.removeItem(KEY))}>체크 초기화</button>}
      />

      <div className={`demo-plan-b ${live ? 'ok' : ''}`}>
        <div>
          <strong>{live ? `계측 정상 · ${snap.source === 'MOCK' ? '시뮬레이터' : '실측 장치'}` : '계측값이 없어요'}</strong>
          <span>플랜 B: 실측 장치가 끊기면 시뮬레이터로 바꿔 같은 흐름을 그대로 시연해요.</span>
        </div>
        {snap.source !== 'MOCK' && <button className="btn btn-sm" onClick={() => void switchToMock()}>시뮬레이터로 전환</button>}
      </div>

      <Section>
        <ol className="demo-steps">
          {STEPS.map((s, k) => (
            <li key={s.id} className={done.includes(s.id) ? 'done' : ''}>
              <button type="button" className="demo-check" onClick={() => toggle(s.id)} aria-pressed={done.includes(s.id)} aria-label={`${s.title} 완료 표시`}>{done.includes(s.id) ? '✓' : k + 1}</button>
              <div className="demo-body">
                <div className="demo-head"><strong>{s.title}</strong><span className="xs muted">약 {s.sec}초</span></div>
                <p className="demo-do">{s.doIt}</p>
                <p className="demo-say">“{s.say}”</p>
              </div>
              <Link to={s.to} className="btn btn-sm">{s.open}</Link>
            </li>
          ))}
        </ol>
      </Section>
    </>
  )
}
