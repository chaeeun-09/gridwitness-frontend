import { useEffect, useRef, useState } from 'react'
import { answer, SUGGESTIONS, type ChatMsg } from '../lib/assistant'
import { useVillageEvents } from '../lib/villageEvents'

// 브라우저 음성 인식 (Chrome·Edge·Safari). 없으면 마이크 버튼을 숨김
type Rec = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void }
const RecCtor = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ko-KR'
  window.speechSynthesis.speak(u)
}

/** FRTU 대화 도우미: 글이나 음성으로 묻고, 장치 조작도 말로 */
export default function AssistantChat() {
  const events = useVillageEvents()
  const [msgs, setMsgs] = useState<ChatMsg[]>([{ role: 'bot', text: "마을 FRTU의 상태와 AI 판정을 알려 드려요.\n예: '지금 상태 어때?', '왜 이상이야?', '주택 2 꺼줘'" }])
  const [input, setInput] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceReply, setVoiceReply] = useState(false)
  const rec = useRef<Rec | null>(null)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [msgs])

  function send(text: string, viaVoice = false) {
    const q = text.trim()
    if (!q) return
    const a = answer(q, events)
    setMsgs((m) => [...m, { role: 'user', text: q }, { role: 'bot', text: a }])
    setInput('')
    if (viaVoice || voiceReply) speak(a)
  }

  function toggleMic() {
    if (!RecCtor) return
    if (listening) return rec.current?.stop()
    const r = new RecCtor()
    r.lang = 'ko-KR'
    r.interimResults = false
    r.onresult = (e) => send(e.results[0][0].transcript, true)
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    rec.current = r
    setListening(true)
    r.start()
  }

  return (
    <div className="chat">
      <div className="chat-log" aria-live="polite">
        {msgs.map((m, k) => <div key={k} className={`chat-msg ${m.role}`}>{m.text}</div>)}
        {listening && <div className="chat-msg user listening">듣는 중…</div>}
        <div ref={end} />
      </div>
      <div className="chat-chips">
        {SUGGESTIONS.map((s) => <button key={s} className="chat-chip" onClick={() => send(s)}>{s}</button>)}
      </div>
      <form className="chat-input" onSubmit={(e) => (e.preventDefault(), send(input))}>
        {RecCtor && (
          <button type="button" className={`chat-mic ${listening ? 'on' : ''}`} onClick={toggleMic} aria-label={listening ? '음성 입력 멈추기' : '음성으로 말하기'} title="음성으로 말하기">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
        )}
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="예: 지금 상태 어때?" aria-label="질문" />
        <button type="submit" className="chat-send" aria-label="보내기" disabled={!input.trim()}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M4 12 20 4l-6 16-3-7-7-1Z" /></svg>
        </button>
      </form>
      <label className="chat-voice small muted">
        <input type="checkbox" checked={voiceReply} onChange={(e) => setVoiceReply(e.target.checked)} /> 답변을 소리로 읽기
      </label>
    </div>
  )
}
