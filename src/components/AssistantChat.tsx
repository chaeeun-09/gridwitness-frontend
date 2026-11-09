import { useEffect, useRef, useState } from 'react'
import { askAssistant, clearLocalConversation, listAssistantMessages, type AssistantMeta, type AssistantTurn } from '../api/assistant'
import { getActor } from '../lib/actor'
import { EVIDENCE_GROUP_LABEL, type EvidenceGroup } from '../lib/incidentContext'
import type { IncidentCase } from '../types'

// ── 브라우저 음성 인식 (Chrome·Edge·Safari, 노트북·스마트폰 내장 마이크) ──
type RecResult = { isFinal: boolean; 0: { transcript: string } }
type Rec = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: (e: { resultIndex: number; results: ArrayLike<RecResult> }) => void
  onend: () => void
  onerror: (e: { error: string }) => void
  start: () => void
  stop: () => void
}
const RecCtor = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition
const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

const MIC_ERROR: Record<string, string> = {
  'not-allowed': '마이크 권한이 없어요. 브라우저 주소창에서 마이크를 허용하거나 글로 질문해 주세요.',
  'service-not-allowed': '이 브라우저에서 음성 인식을 쓸 수 없어요. 글로 질문해 주세요.',
  'no-speech': '말소리를 듣지 못했어요. 다시 눌러 말하거나 글로 질문해 주세요.',
  'audio-capture': '마이크를 찾지 못했어요. 글로 질문해 주세요.',
  network: '음성 인식 서버에 연결하지 못했어요. 글로 질문해 주세요.',
}

function speak(text: string) {
  if (!canSpeak) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ko-KR'
  window.speechSynthesis.speak(u)
}

const FIELD_SUGGESTIONS = ['현재 어떤 고장이 발생했어?', '어디를 먼저 점검해야 해?', '이 판단의 근거는 뭐야?', '어떤 모델로 분석했어?', '담당자 검토는 어떻게 됐어?']

const STATUS_CHIP: Record<AssistantMeta['status'], [string, string]> = {
  answered: ['ok', '근거 있는 답'],
  abstained: ['warn', '판단 보류'],
  refused: ['err', '요청 거절'],
}

function BotMeta({ m, text }: { m: AssistantMeta; text: string }) {
  const groups = Object.entries(
    m.evidence.reduce<Record<string, typeof m.evidence>>((acc, e) => ((acc[e.group] ??= []).push(e), acc), {}),
  ) as [EvidenceGroup, typeof m.evidence][]
  const [tone, label] = STATUS_CHIP[m.status]
  return (
    <div className="chat-meta">
      <div className="chat-meta-row">
        <span className={`chat-tag ${tone}`}>{label}</span>
        <span className="chat-tag">{m.mode === 'server' ? '서버 AI' : '기록 기반'}</span>
        {m.modelVersion && <span className="chat-tag mono">{m.modelVersion}</span>}
        {canSpeak && <button type="button" className="chat-replay" onClick={() => speak(text)} aria-label="이 답 다시 듣기">다시 듣기</button>}
      </div>
      {m.notice && <div className={`chat-notice ${m.notice.tone}`}>{m.notice.text}</div>}
      {m.abstainReasons.length > 0 && (
        <div className="chat-why"><b>{m.status === 'refused' ? '거절 이유' : '보류 이유'}</b> {m.abstainReasons.join(' · ')}</div>
      )}
      {m.neededInfo.length > 0 && (
        <div className="chat-why"><b>더 필요한 정보</b><ul>{m.neededInfo.map((n) => <li key={n}>{n}</li>)}</ul></div>
      )}
      {m.evidence.length > 0 && (
        <details className="chat-evidence">
          <summary>답에 쓴 근거 {m.evidence.length}건</summary>
          {groups.map(([g, items]) => (
            <div key={g} className="chat-ev-group">
              <div className="chat-ev-head">{EVIDENCE_GROUP_LABEL[g] ?? g}</div>
              <dl>{items.map((e) => <div key={e.id}><dt>{e.label}</dt><dd>{e.value}</dd></div>)}</dl>
            </div>
          ))}
        </details>
      )}
      <div className="chat-disclaimer">AI 제안이에요. 최종 판단과 설비 조작은 담당자가 해요.</div>
    </div>
  )
}

/** 사건 하나에 대한 현장 대응 AI 대화. 글·음성으로 묻고, 근거와 판단 보류 이유를 함께 보여준다. 설비는 조작하지 않는다 */
export default function AssistantChat({ c, variant = 'panel' }: { c: IncidentCase; variant?: 'panel' | 'field' | 'popup' }) {
  const [turns, setTurns] = useState<AssistantTurn[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [input, setInput] = useState('')
  const [fromVoice, setFromVoice] = useState(false)
  const [listening, setListening] = useState(false)
  const [micMsg, setMicMsg] = useState<string | null>(RecCtor ? null : '이 브라우저는 음성 인식을 지원하지 않아요. 글로 질문해 주세요.')
  const [voiceReply, setVoiceReply] = useState(variant === 'field')
  const rec = useRef<Rec | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const end = useRef<HTMLDivElement>(null)

  // 사건이 바뀌면 그 사건의 대화를 불러온다
  useEffect(() => {
    let alive = true
    listAssistantMessages(c).then((t) => {
      if (!alive) return
      setTurns(t)
      setLoading(false)
    })
    return () => {
      alive = false
      rec.current?.stop()
      if (canSpeak) window.speechSynthesis.cancel()
    }
  }, [c])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [turns, pending])

  async function send(text: string) {
    const q = text.trim()
    if (!q || pending) return
    const via = fromVoice ? 'voice' : 'text'
    setInput('')
    setFromVoice(false)
    setMicMsg(null)
    setPending(true)
    try {
      const next = await askAssistant(c, q, via, getActor(), turns)
      setTurns(next)
      const last = next[next.length - 1]
      if (via === 'voice' || voiceReply) speak(last.text)
    } finally {
      setPending(false)
    }
  }

  function toggleMic() {
    if (!RecCtor) return
    if (listening) return rec.current?.stop()
    setMicMsg(null)
    const r = new RecCtor()
    r.lang = 'ko-KR'
    r.interimResults = true
    r.continuous = false
    let finalText = ''
    r.onresult = (e) => {
      let interim = ''
      for (let k = e.resultIndex; k < e.results.length; k++) {
        const res = e.results[k]
        if (res.isFinal) finalText += res[0].transcript
        else interim += res[0].transcript
      }
      setInput((finalText + interim).trim())
    }
    r.onerror = (e) => setMicMsg(MIC_ERROR[e.error] ?? '음성을 알아듣지 못했어요. 글로 질문해 주세요.')
    r.onend = () => {
      setListening(false)
      // 인식한 문장을 바로 보내지 않고 입력창에 두어 고칠 수 있게 함
      if (finalText.trim()) {
        setFromVoice(true)
        setMicMsg('인식한 문장을 확인하고, 고칠 곳이 있으면 고친 뒤 보내세요.')
        inputRef.current?.focus()
      }
    }
    rec.current = r
    if (canSpeak) window.speechSynthesis.cancel()
    setListening(true)
    try {
      r.start()
    } catch {
      setListening(false)
      setMicMsg('마이크를 시작하지 못했어요. 글로 질문해 주세요.')
    }
  }

  function reset() {
    clearLocalConversation(c.id)
    setTurns([])
  }

  return (
    <div className={`chat chat-${variant}`}>
      <div className="chat-scope small muted">
        <span>사건 <b className="mono">{c.id}</b> · 교류 고장파형 분석 기록만 사용</span>
        {turns.length > 0 && <button type="button" className="chat-link" onClick={reset}>대화 지우기</button>}
      </div>
      <div className="chat-log" aria-live="polite">
        {!loading && turns.length === 0 && (
          <div className="chat-msg bot">이 사건의 분석 결과를 근거와 함께 알려 드려요. 기록에 없는 원인이나 위치는 지어내지 않고 판단을 보류해요.</div>
        )}
        {turns.map((t) => (
          <div key={t.id} className={`chat-msg ${t.role === 'user' ? 'user' : 'bot'}`}>
            {t.role === 'user' && t.via === 'voice' && <span className="chat-via">음성</span>}
            {t.text}
            {t.meta && <BotMeta m={t.meta} text={t.text} />}
          </div>
        ))}
        {pending && <div className="chat-msg bot pending">기록을 조회하고 있어요…</div>}
        <div ref={end} />
      </div>
      <div className="chat-dock">
      <div className="chat-chips">
        {FIELD_SUGGESTIONS.map((s) => <button key={s} type="button" className="chat-chip" onClick={() => send(s)} disabled={pending}>{s}</button>)}
      </div>
      {micMsg && <div className={`chat-micmsg ${fromVoice ? 'info' : ''}`} role="status">{micMsg}</div>}
      <form className="chat-input" onSubmit={(e) => (e.preventDefault(), send(input))}>
        {RecCtor && (
          <button type="button" className={`chat-mic ${listening ? 'on' : ''}`} onClick={toggleMic} aria-label={listening ? '음성 입력 멈추기' : '음성으로 질문하기'} title="음성으로 질문하기">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
        )}
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              send(input)
            }
          }}
          placeholder={listening ? '듣는 중… 말씀하세요' : '예: 어디를 먼저 점검해야 해?'}
          aria-label="질문"
        />
        <button type="submit" className="chat-send" aria-label="보내기" disabled={!input.trim() || pending}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 12 20 4l-6 16-3-7-7-1Z" /></svg>
        </button>
      </form>
      </div>
      {canSpeak && (
        <label className="chat-voice small muted">
          <input type="checkbox" checked={voiceReply} onChange={(e) => setVoiceReply(e.target.checked)} /> 답변을 소리로 읽기
          <span>(음성으로 물으면 항상 읽어요)</span>
        </label>
      )}
    </div>
  )
}
