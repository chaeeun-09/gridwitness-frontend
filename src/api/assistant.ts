// 사건별 현장 대화. 서버 기록과 미전송 브라우저 기록을 질문 식별자로 병합한다.
import { apiBase, apiRequest, getCapabilities } from '../lib/backend'
import { groundedAnswer, type AnswerStatus } from '../lib/groundedAnswer'
import { buildIncidentContext, type EvidenceItem, type IncidentContext } from '../lib/incidentContext'
import type { IncidentCase } from '../types'

export interface AssistantMeta {
  mode: 'server' | 'local'
  answerMode: 'llm' | 'rules' | 'browser_rules' | 'unknown'
  llmModel: string | null
  fallbackReason: string | null
  status: AnswerStatus
  evidence: EvidenceItem[]
  /** 파형 분류기 버전이며 대화 LLM 모델과 다르다. */
  modelVersion: string | null
  abstainReasons: string[]
  neededInfo: string[]
  notice?: { tone: 'warn' | 'err' | 'info'; text: string }
}
export interface AssistantTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  via?: 'voice' | 'text'
  meta?: AssistantMeta
  clientTurnId?: string
  conversationId?: string
  actor?: string
  sync?: 'pending' | 'synced' | 'local'
}
const KEY = (caseId: string) => `gridwitness.assistant.v2.${encodeURIComponent(apiBase())}.${caseId}`
const uid = () => crypto.randomUUID()
const conversationId = (caseId: string) => localStorage.getItem(`${KEY(caseId)}.conversation`) ?? 'default'
export const getAssistantConversationNotice = (c: IncidentCase) => localStorage.getItem(`${KEY(c.id)}.notice`)
function loadLocal(caseId: string): AssistantTurn[] {
  try {
    const key = KEY(caseId)
    const legacyKey = `gridwitness.assistant.v1.${caseId}`
    const legacy = localStorage.getItem(legacyKey)
    if (!localStorage.getItem(key) && legacy) {
      localStorage.setItem(key, legacy)
      localStorage.removeItem(legacyKey)
    }
    const data: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(data) ? data as AssistantTurn[] : []
  } catch { return [] }
}
function saveLocal(caseId: string, turns: AssistantTurn[]) {
  try { localStorage.setItem(KEY(caseId), JSON.stringify(turns)) }
  catch { throw new Error('브라우저에 대화를 보존하지 못했어요. 저장 공간·브라우저 설정을 확인하세요.') }
}
export const getCachedAssistantMessages = (c: IncidentCase): AssistantTurn[] => loadLocal(c.id)
export function exportLocalAssistantRecords(caseId: string): { key: string; turns: AssistantTurn[] }[] {
  const prefix = KEY(caseId)
  const records: { key: string; turns: AssistantTurn[] }[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key === prefix || key?.startsWith(`${prefix}.archive.`)) records.push({ key, turns: JSON.parse(localStorage.getItem(key) ?? '[]') as AssistantTurn[] })
  }
  return records
}
/** 같은 문장을 다시 질문한 경우는 유지하고, 같은 요청의 서버·브라우저 사본만 합친다. */
export function mergeAssistantMessages(server: AssistantTurn[], local: AssistantTurn[]): AssistantTurn[] {
  const merged = [...server]
  for (const turn of local) {
    const duplicate = merged.some((other) => other.id === turn.id ||
      (turn.clientTurnId && turn.clientTurnId === other.clientTurnId && turn.role === other.role) ||
      (!turn.clientTurnId && turn.role === other.role && turn.text === other.text && Math.abs(Date.parse(turn.at) - Date.parse(other.at)) < 10_000))
    if (!duplicate) merged.push(turn)
  }
  return merged.sort((a, b) => a.at.localeCompare(b.at) || (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1))
}
interface ServerMessage {
  message_id: string
  client_turn_id?: string | null
  conversation_id?: string | null
  role?: 'user' | 'assistant'
  text?: string
  answer?: string
  input_mode?: 'voice' | 'text'
  status?: AnswerStatus
  answer_mode?: 'llm' | 'rules'
  llm_model?: string | null
  fallback_reason?: string | null
  evidence?: EvidenceItem[]
  model_version?: string | null
  abstain_reasons?: string[]
  needed_info?: string[]
  data_status?: 'ok' | 'missing' | 'stale'
  created_at: string
}
const DATA_NOTICE: Record<string, AssistantMeta['notice']> = {
  missing: { tone: 'warn', text: '일부 분석 데이터가 없어 답이 제한돼요.' },
  stale: { tone: 'warn', text: '오래된 계측값을 바탕으로 한 답이에요. 최신 기록을 확인하세요.' },
}
function fromServer(m: ServerMessage): AssistantTurn {
  const role = m.role ?? 'assistant'
  return {
    id: m.message_id, clientTurnId: m.client_turn_id ?? undefined, conversationId: m.conversation_id ?? undefined, sync: 'synced',
    role, text: m.answer ?? m.text ?? '', at: m.created_at, via: m.input_mode,
    meta: role === 'assistant' ? {
      mode: 'server', answerMode: m.answer_mode === 'llm' ? 'llm' : m.answer_mode === 'rules' ? 'rules' : 'unknown',
      llmModel: m.llm_model ?? null, fallbackReason: m.fallback_reason ?? null,
      status: m.status ?? 'answered', evidence: m.evidence ?? [], modelVersion: m.model_version ?? null,
      abstainReasons: m.abstain_reasons ?? [], neededInfo: m.needed_info ?? [],
      notice: m.data_status ? DATA_NOTICE[m.data_status] : undefined,
    } : undefined,
  }
}
const path = (id: string, suffix: string) => `/api/v1/incidents/${encodeURIComponent(id)}/assistant/${suffix}`
export const assistantTimeoutMs = () => Math.min(90_000, Math.max(10_000, ((getCapabilities().data?.assistant.timeout_seconds ?? 20) + 10) * 1000))
export async function getAssistantContext(c: IncidentCase): Promise<IncidentContext> {
  const local = buildIncidentContext(c)
  if (!local.incidentId) return local
  try {
    const s = await apiRequest<{ evidence?: EvidenceItem[] }>(path(local.incidentId, 'context'))
    return s.evidence?.length ? { ...local, evidence: s.evidence } : local
  } catch { return local }
}
/** 조회 실패 때에도 미전송 대화는 사라지지 않는다. 재전송은 명시적 재시도에서 한다. */
export async function listAssistantMessages(c: IncidentCase): Promise<AssistantTurn[]> {
  let local = loadLocal(c.id)
  const id = c.backend?.incidentId
  if (!id) return local
  try {
    const r = await apiRequest<{ items: ServerMessage[]; conversation_id?: string }>(path(id, 'messages'))
    if (r.conversation_id && r.conversation_id !== conversationId(c.id)) {
      if (local.length) localStorage.setItem(`${KEY(c.id)}.archive.${uid()}`, JSON.stringify(local))
      localStorage.setItem(`${KEY(c.id)}.conversation`, r.conversation_id)
      localStorage.setItem(`${KEY(c.id)}.notice`, '다른 기기에서 새 대화가 시작됐어요. 이전 브라우저 대화와 미전송 문답은 보관했으며 현재 대화로 재전송하지 않아요.')
      local = []
    }
    const next = mergeAssistantMessages(r.items.map(fromServer), local.filter((t) => t.sync !== 'synced'))
    saveLocal(c.id, next)
    return next
  } catch (e) {
    return local.map((turn) => turn.meta ? { ...turn, meta: { ...turn.meta, notice: { tone: 'warn' as const, text: `서버 이력을 확인하지 못했어요. 브라우저 보관본이에요. ${(e as Error).message}` } } } : turn)
  }
}
async function postQuestion(c: IncidentCase, turn: AssistantTurn, signal?: AbortSignal): Promise<AssistantTurn> {
  const id = c.backend?.incidentId
  if (!id) throw new Error('이 사건은 서버에 등록되지 않았어요')
  const message = await apiRequest<ServerMessage>(path(id, 'messages'), {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal,
    body: JSON.stringify({ question: turn.text, input_mode: turn.via ?? 'text', actor: turn.actor ?? '담당자', client_turn_id: turn.clientTurnId, conversation_id: turn.conversationId ?? conversationId(c.id) }),
  }, assistantTimeoutMs())
  return fromServer({ ...message, client_turn_id: message.client_turn_id ?? turn.clientTurnId, role: 'assistant' })
}
export async function askAssistant(c: IncidentCase, question: string, via: 'voice' | 'text', actor: string, history: AssistantTurn[], signal?: AbortSignal): Promise<AssistantTurn[]> {
  const clientTurnId = uid()
  const user: AssistantTurn = { id: `${clientTurnId}-user`, clientTurnId, conversationId: conversationId(c.id), role: 'user', text: question, at: new Date().toISOString(), via, actor, sync: c.backend?.incidentId ? 'pending' : 'local' }
  const base = mergeAssistantMessages(history, loadLocal(c.id))
  saveLocal(c.id, [...base, user])
  let reply: AssistantTurn
  try {
    reply = await postQuestion(c, user, signal)
    user.sync = 'synced'
  } catch (e) {
    if (signal?.aborted) throw e
    const ctx = buildIncidentContext(c)
    const g = groundedAnswer(question, ctx)
    reply = {
      id: `${clientTurnId}-assistant`, clientTurnId, conversationId: user.conversationId, role: 'assistant', text: g.text, at: new Date().toISOString(), sync: user.sync,
      meta: {
        mode: 'local', answerMode: 'browser_rules', llmModel: null, fallbackReason: (e as Error).message,
        status: g.status, evidence: ctx.evidence.filter((ev) => g.evidenceIds.includes(ev.id)), modelVersion: ctx.model.version,
        abstainReasons: g.abstainReasons, neededInfo: g.neededInfo,
        notice: { tone: 'warn', text: `${(e as Error).message}. 브라우저 규칙으로 기록을 읽었어요.${c.backend?.incidentId ? ' 이 문답은 서버 전송 대기 중이며 다시 동기화할 수 있어요.' : ' 이 브라우저에 보관돼요.'}` },
      },
    }
  }
  const next = [...base, user, reply]
  try { saveLocal(c.id, next) }
  catch (e) { if (reply.meta) reply.meta.notice = { tone: 'err', text: (e as Error).message } }
  return next
}
export async function retryAssistantMessages(c: IncidentCase, signal?: AbortSignal): Promise<AssistantTurn[]> {
  let turns = await listAssistantMessages(c)
  for (const user of turns.filter((t) => t.role === 'user' && t.sync === 'pending' && t.clientTurnId)) {
    const reply = await postQuestion(c, user, signal)
    turns = turns.filter((t) => !(t.clientTurnId === user.clientTurnId && t.role === 'assistant'))
      .map((t) => t.id === user.id ? { ...t, sync: 'synced' as const } : t)
    turns.push(reply)
    saveLocal(c.id, turns)
  }
  return listAssistantMessages(c)
}
/** 서버 대화는 보관 후 새 대화로 전환한다. 서버 실패 시 현재 대화를 유지한다. */
export async function resetAssistantConversation(c: IncidentCase, actor: string): Promise<void> {
  const local = loadLocal(c.id)
  if (local.length) {
    try { localStorage.setItem(`${KEY(c.id)}.archive.${uid()}`, JSON.stringify(local)) }
    catch { throw new Error('현재 대화를 브라우저에 보관하지 못했어요. 초기화를 중단했어요.') }
  }
  if (c.backend?.incidentId) {
    const result = await apiRequest<{ conversation_id: string }>(path(c.backend.incidentId, 'reset'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor }) })
    localStorage.setItem(`${KEY(c.id)}.conversation`, result.conversation_id)
  }
  localStorage.removeItem(`${KEY(c.id)}.notice`)
  saveLocal(c.id, [])
}
