import { useEffect, useState } from 'react'
import { listFieldNotes, saveFieldNote, type FieldNote } from '../api/fieldNotes'
import { fmtTime, getActor } from '../lib/actor'
import type { IncidentCase } from '../types'

/** 현장 메모: 담당자가 "확인했어요"에 체크해야 저장된다. AI 제안과 따로, 담당자 이름으로 남는다 */
export default function FieldNotes({ c }: { c: IncidentCase }) {
  const [notes, setNotes] = useState<FieldNote[]>([])
  const [text, setText] = useState('')
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listFieldNotes(c).then((n) => alive && setNotes(n))
    return () => {
      alive = false
    }
  }, [c])

  async function save() {
    if (!ok || !text.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const n = await saveFieldNote(c, text.trim(), getActor())
      setNotes((xs) => [n, ...xs])
      setText('')
      setOk(false)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="fnotes">
      <div className="fnotes-head">
        <strong>현장 메모</strong>
        <span className="xs muted">담당자가 확인한 내용만 저장돼요 · AI 답변과 따로 기록</span>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="예: P-02 분기 접속부 타버림 흔적 확인, 교체 요청" aria-label="현장 메모" />
      <div className="fnotes-actions">
        <label className="fnotes-check">
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} disabled={!text.trim()} />
          내용을 확인했어요 ({getActor()} 이름으로 저장)
        </label>
        <button type="button" className="btn btn-sm btn-primary" disabled={!ok || !text.trim() || busy} onClick={save}>{busy ? '저장 중…' : '메모 저장'}</button>
      </div>
      {err && <div className="alert alert-err small">{err}</div>}
      {notes.length > 0 && (
        <ul className="fnotes-list">
          {notes.map((n) => (
            <li key={n.id}>
              <p>{n.text}</p>
              <span className="xs muted">{n.actor} · {fmtTime(n.at)} · {n.stored === 'server' ? '서버에 저장' : '이 브라우저에만 저장 (서버 메모 API 준비 전)'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
