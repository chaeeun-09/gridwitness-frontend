// FRTU 상세 화면의 대화 도우미.
// 지금은 LLM 없이 질문 의도를 규칙으로 골라 현재 계측·AI 판정 값을 그대로 읽어 줌 (값을 지어내지 않음).
// shortcut: 정해진 질문 유형만 이해함, 서버에 대화 모델이 붙으면 answer()를 그 호출로 바꾸면 됨.

import { getVillage, IOT_CHANNELS, setChannel, setRelay, STATUS_LABEL, type ChannelId } from './village'
import type { AnalyzedEvent } from './villageEvents'

export interface ChatMsg {
  role: 'user' | 'bot'
  text: string
}

export const SUGGESTIONS = ['지금 상태 어때?', '왜 이상이야?', '마지막 사건 판정은?', '주택 2 꺼줘', '전체 다시 켜줘', '정전 발생시켜줘']

const has = (t: string, ...words: string[]) => words.some((w) => t.includes(w))

function findChannel(t: string): ChannelId | null {
  const s = t.replace(/\s/g, '')
  for (const c of IOT_CHANNELS) if (s.includes(c.name.replace(/\s/g, ''))) return c.id
  const m = /(?:LED|엘이디|채널)(\d)/i.exec(s)
  if (m) return IOT_CHANNELS.find((c) => c.ch === Number(m[1]))?.id ?? null
  return null
}

function verdictText(a: AnalyzedEvent): string {
  const v = a.verdict
  if (v.kind === 'ANSWERED') {
    const why = v.evidence.slice(0, 2).map((e) => e.label).join(', ')
    return `사건 #${a.e.ev}은(는) '${v.labelKo}'(으)로 판정했어요. 점수 ${Math.round(v.score * 100)}%, 주요 근거는 ${why}입니다.`
  }
  if (v.kind === 'WITHHELD') return `사건 #${a.e.ev}은(는) 판정을 보류했어요. 1순위는 '${v.labelKo}'였지만 ${v.reasons[0] ?? '근거가 부족'}해서요.`
  if (v.kind === 'NO_MODEL') return `사건 #${a.e.ev}의 파형은 기록했지만, 원인 분류 모델이 아직 학습 전이라 판정하지 않았어요.`
  return `사건 #${a.e.ev}은(는) 입력 검사에서 거부됐어요: ${v.reasons[0]}`
}

/** 질문 하나에 대한 답. 조작 요청이면 실제로 장치(또는 시뮬레이터)에 명령을 보냄 */
export function answer(text: string, events: AnalyzedEvent[]): string {
  const t = text.trim()
  const s = getVillage()
  if (!t) return '무엇이 궁금하신가요?'

  // 조작
  if (has(t, '정전') && has(t, '발생', '일으', '내줘', '시켜')) {
    if (!s.connected) return '장치가 연결되어 있지 않아 정전을 일으킬 수 없어요.'
    setRelay(false)
    return '마을 전원을 차단했어요. 이상 감지와 AI 판정이 어떻게 바뀌는지 지켜보세요.'
  }
  if (has(t, '복구', '다시 켜', '전체 켜', '모두 켜')) {
    if (!s.connected) return '장치가 연결되어 있지 않아요.'
    if (!s.relay) setRelay(true)
    IOT_CHANNELS.forEach((c) => !s.leds[c.id].channelOn && setChannel(c.id, true))
    return '마을 전원과 모든 LED를 다시 켰어요.'
  }
  const ch = findChannel(t)
  if (ch && has(t, '꺼', '끄', '켜')) {
    const on = has(t, '켜') && !has(t, '꺼', '끄')
    const name = s.leds[ch].name
    if (!s.connected || !s.canControl) return `${name}을(를) 조종할 수 없어요 (장치 연결 또는 채널 제어 지원 확인).`
    setChannel(ch, on)
    return `${name}을(를) ${on ? '켰어요' : '껐어요'}.`
  }

  // 조회
  if (has(t, '마지막', '최근', '판정', '사건')) {
    if (!events.length) return '아직 AI가 판정할 사건 파형이 없어요. LED를 끄거나 켜면 사건이 기록돼요.'
    return verdictText(events[0])
  }
  if (has(t, '왜', '이유', '원인', '근거')) {
    if (s.diagnosis) {
      const who = s.diagnosis.candidates.map((id) => s.leds[id].name).join(', ')
      return `${s.diagnosis.kind === 'LOW' ? '켠 LED 중 전류가 흐르지 않는 것이 있어요' : '예상보다 전류가 많이 흘러요'}${who ? `. 의심 위치: ${who}` : ''}. 측정 ${(s.i * 1000).toFixed(1)} mA, 예상 ${(s.expected * 1000).toFixed(1)} mA입니다.`
    }
    if (events[0]) return verdictText(events[0])
    return `지금은 이상 근거가 없어요. 이상 점수 ${s.score.toFixed(2)}로 기준(주의 0.3) 아래입니다.`
  }
  if (has(t, '전류')) return `마을 전체 전류는 ${(s.i * 1000).toFixed(1)} mA, 예상값은 ${(s.expected * 1000).toFixed(1)} mA예요.`
  if (has(t, '전압')) return `전압은 ${s.v.toFixed(2)} V예요.`
  if (has(t, '상태', '어때', '괜찮', '현황')) {
    if (!s.connected) return '실측 장치와 연결이 끊겨 있어요. 메뉴의 실측 장치에서 다시 연결해 주세요.'
    const off = IOT_CHANNELS.filter((c) => !s.leds[c.id].channelOn).map((c) => c.name)
    return `마을은 '${STATUS_LABEL[s.status]}' 상태예요. ${s.v.toFixed(2)} V, ${(s.i * 1000).toFixed(1)} mA, 이상 점수 ${s.score.toFixed(2)}${off.length ? `. 꺼 둔 LED: ${off.join(', ')}` : '. LED는 모두 켜져 있어요'}.`
  }
  return "아직 그 질문은 이해하지 못해요. '지금 상태 어때?', '왜 이상이야?', '주택 2 꺼줘'처럼 물어봐 주세요."
}

