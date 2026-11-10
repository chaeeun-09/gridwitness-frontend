// 현장 메모: 담당자가 내용을 확인한 경우에만 저장한다 (지시서 P1).
// 서버(제안 API)를 먼저 부르고, 아직 없으면 이 브라우저에 사건별로 저장한다.
//
//   POST /api/v1/incidents/{id}/field-notes  { text, actor, confirmed: true, source_message_id? }
//        → { note_id, text, actor, created_at }
//   GET  /api/v1/incidents/{id}/field-notes  → { items: [...] }
//
// 메모의 작성자는 항상 담당자다. AI 답변을 그대로 저장하지 않는다.

import { apiBase } from '../lib/backend'
import type { IncidentCase } from '../types'

export interface FieldNote {
  id: string
  text: string
  actor: string
  at: string
  /** server = 서버에 저장됨, local = 이 브라우저에만 */
  stored: 'server' | 'local'
}

const KEY = (caseId: string) => `gridwitness.fieldnotes.v1.${caseId}`
const loadLocal = (caseId: string): FieldNote[] => {
  try {
    return JSON.parse(localStorage.getItem(KEY(caseId)) ?? '[]') as FieldNote[]
  } catch {
    return []
  }
}
const saveLocal = (caseId: string, notes: FieldNote[]) => {
  try {
    localStorage.setItem(KEY(caseId), JSON.stringify(notes.slice(0, 100)))
  } catch {
    // 저장 공간이 모자라면 화면에서만
  }
}

interface ServerNote {
  note_id: string
  text: string
  actor: string
  created_at: string
}
const fromServer = (n: ServerNote): FieldNote => ({ id: n.note_id, text: n.text, actor: n.actor, at: n.created_at, stored: 'server' })

export async function listFieldNotes(c: IncidentCase): Promise<FieldNote[]> {
  const local = loadLocal(c.id)
  const id = c.backend?.incidentId
  if (!id) return local
  try {
    const res = await fetch(`${apiBase()}/api/v1/incidents/${id}/field-notes`)
    if (!res.ok) return local
    const body = (await res.json()) as { items?: ServerNote[] }
    return [...(body.items ?? []).map(fromServer), ...local].sort((a, b) => b.at.localeCompare(a.at))
  } catch {
    return local
  }
}

/** confirmed가 true일 때만 부른다 (화면에서 확인 체크를 해야 버튼이 열림) */
export async function saveFieldNote(c: IncidentCase, text: string, actor: string): Promise<FieldNote> {
  const id = c.backend?.incidentId
  if (id) {
    try {
      const res = await fetch(`${apiBase()}/api/v1/incidents/${id}/field-notes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, actor, confirmed: true }),
      })
      if (res.ok) return fromServer((await res.json()) as ServerNote)
      if (res.status === 401 || res.status === 403) throw new Error('이 사건에 메모를 남길 권한이 없어요')
      if (![404, 405, 501].includes(res.status)) throw new Error(`서버 오류 (${res.status})`)
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('이 사건')) throw e
      // 서버 미구현·연결 실패 → 이 브라우저에 저장
    }
  }
  const note: FieldNote = { id: `local-${Date.now().toString(36)}`, text, actor, at: new Date().toISOString(), stored: 'local' }
  saveLocal(c.id, [note, ...loadLocal(c.id)])
  return note
}
