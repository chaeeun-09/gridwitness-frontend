// 담당자가 확인한 메모. 서버 전송 전에도 식별자와 원문을 브라우저에 보존한다.
import { apiBase, apiRequest } from '../lib/backend'
import type { IncidentCase } from '../types'

export interface FieldNote {
  id: string
  clientNoteId?: string
  text: string
  actor: string
  at: string
  stored: 'server' | 'pending' | 'local'
  syncError?: string
}
const KEY = (caseId: string) => `gridwitness.fieldnotes.v2.${encodeURIComponent(apiBase())}.${caseId}`
function loadLocal(caseId: string): FieldNote[] {
  try {
    const key = KEY(caseId)
    const legacyKey = `gridwitness.fieldnotes.v1.${caseId}`
    const old = localStorage.getItem(legacyKey)
    if (!localStorage.getItem(key) && old) {
      localStorage.setItem(key, old)
      localStorage.removeItem(legacyKey)
    }
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(data) ? data as FieldNote[] : []
  } catch { return [] }
}
function saveLocal(caseId: string, notes: FieldNote[]) {
  try { localStorage.setItem(KEY(caseId), JSON.stringify(notes)) }
  catch { throw new Error('브라우저에 메모를 보존하지 못했어요. 저장 공간·브라우저 설정을 확인하세요.') }
}
export function exportLocalFieldNotes(caseId: string): FieldNote[] {
  const raw = localStorage.getItem(KEY(caseId)) ?? localStorage.getItem(`gridwitness.fieldnotes.v1.${caseId}`) ?? '[]'
  const data: unknown = JSON.parse(raw)
  if (!Array.isArray(data)) throw new Error('보관된 현장 메모를 읽지 못해 전체 내보내기를 중단했어요.')
  return data as FieldNote[]
}
interface ServerNote { note_id: string; client_note_id?: string | null; text: string; actor: string; created_at: string }
const fromServer = (n: ServerNote): FieldNote => ({ id: n.note_id, clientNoteId: n.client_note_id ?? undefined, text: n.text, actor: n.actor, at: n.created_at, stored: 'server' })
const merge = (server: FieldNote[], local: FieldNote[]) => [...server, ...local.filter((n) => !server.some((s) => s.id === n.id || (n.clientNoteId && s.clientNoteId === n.clientNoteId)))].sort((a, b) => b.at.localeCompare(a.at))
const path = (c: IncidentCase) => `/api/v1/incidents/${encodeURIComponent(c.backend!.incidentId)}/field-notes`

export async function listFieldNotes(c: IncidentCase): Promise<FieldNote[]> {
  const local = loadLocal(c.id)
  if (!c.backend?.incidentId) return local
  try {
    const result = await apiRequest<{ items: ServerNote[] }>(path(c))
    const next = merge(result.items.map(fromServer), local)
    saveLocal(c.id, next)
    return next
  } catch (e) { return local.map((n) => ({ ...n, syncError: `최신 서버 메모를 확인하지 못했어요. ${(e as Error).message}` })) }
}
async function post(c: IncidentCase, note: FieldNote): Promise<FieldNote> {
  return fromServer(await apiRequest<ServerNote>(path(c), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: note.text, actor: note.actor, confirmed: true, client_note_id: note.clientNoteId }) }))
}
export async function saveFieldNote(c: IncidentCase, text: string, actor: string): Promise<FieldNote> {
  const clientNoteId = crypto.randomUUID()
  const note: FieldNote = { id: `local-${clientNoteId}`, clientNoteId, text, actor, at: new Date().toISOString(), stored: c.backend?.incidentId ? 'pending' : 'local' }
  const previous = loadLocal(c.id)
  saveLocal(c.id, [note, ...previous])
  if (!c.backend?.incidentId) return note
  try {
    const stored = await post(c, note)
    try { saveLocal(c.id, [stored, ...previous]) }
    catch (e) { stored.syncError = (e as Error).message }
    return stored
  } catch (e) {
    note.syncError = (e as Error).message
    saveLocal(c.id, [note, ...previous])
    return note
  }
}
export async function retryFieldNotes(c: IncidentCase): Promise<FieldNote[]> {
  let notes = await listFieldNotes(c)
  if (!c.backend?.incidentId) return notes
  for (const note of notes.filter((n) => n.stored !== 'server')) {
    // 旧 메모에도 최초 재전송 전에 영속 식별자를 부여한다.
    if (!note.clientNoteId) { note.clientNoteId = crypto.randomUUID(); saveLocal(c.id, notes) }
    const stored = await post(c, note)
    notes = notes.map((n) => n.id === note.id ? stored : n)
    saveLocal(c.id, notes)
  }
  return notes
}
