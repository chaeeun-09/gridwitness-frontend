// 사건별 현장 대응 AI 대화.
// 서버(제안 API)를 먼저 부르고, 아직 없거나 닿지 않으면 이 브라우저의 사건 기록으로 근거형 답을 만든다.
//
//   POST /api/v1/incidents/{id}/assistant/messages   { question, input_mode: 'voice'|'text', actor }
//        → { message_id, answer, status: 'answered'|'abstained'|'refused',
//            evidence: [{ id, group, label, value }], model_version, abstain_reasons, needed_info,
//            data_status?: 'ok'|'missing'|'stale', created_at }
//   GET  /api/v1/incidents/{id}/assistant/messages   → { items: [{ message_id, role: 'user'|'assistant', text, created_at, ...위 필드 }] }
//   GET  /api/v1/incidents/{id}/assistant/context    → IncidentContext 와 같은 모양 (snake_case)
//
// 대화 AI는 분석 결과를 읽기만 한다. 장치 제어(lib/village)를 여기서 부르지 않는다.

import { apiBase } from '../lib/backend'
import { groundedAnswer, type AnswerStatus } from '../lib/groundedAnswer'
import { buildIncidentContext, type EvidenceItem, type IncidentContext } from '../lib/incidentContext'
import type { IncidentCase } from '../types'

export interface AssistantMeta {
  /** server = 서버 대화 AI, local = 서버 없이 기록된 분석 결과로 답함 */
  mode: 'server' | 'local'
  status: AnswerStatus
  evidence: EvidenceItem[]
  modelVersion: string | null
  abstainReasons: string[]
  neededInfo: string[]
  /** 정상 답과 구분해서 보여줄 안내 (서버 오류, 데이터 누락, 오래된 계측값 등) */
  notice?: { tone: 'warn' | 'err' | 'info'; text: string }
}

export interface AssistantTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  at: string
  via?: 'voice' | 'text'
  meta?: AssistantMeta
}

const KEY = (caseId: string) => `gridwitness.assistant.v1.${caseId}`
const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

function loadLocal(caseId: string): AssistantTurn[] {
  try {
    return JSON.parse(localStorage.getItem(KEY(caseId)) ?? '[]') as AssistantTurn[]
  } catch {
    return []
  }
}
function saveLocal(caseId: string, turns: AssistantTurn[]) {
  try {
    localStorage.setItem(KEY(caseId), JSON.stringify(turns.slice(-200)))
  } catch {
    // 저장 공간이 모자라면 화면에서만 유지
  }
}
export function clearLocalConversation(caseId: string) {
  try {
    localStorage.removeItem(KEY(caseId))
  } catch {
    // 무시
  }
}

// ── 서버 호출 ───────────────────────────────────────────
/** 서버에 이 API가 없음 (아직 구현 전) → 조용히 로컬로 */
class NotAvailable extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${apiBase()}/api/v1${path}`, init)
  } catch {
    throw new Error('분석 서버에 연결할 수 없어요')
  }
  if (res.status === 404 || res.status === 405 || res.status === 501) throw new NotAvailable()
  if (res.status === 401 || res.status === 403) throw new Error('이 사건을 볼 권한이 없어요')
  if (!res.ok) throw new Error(`서버 대화 AI 오류 (${res.status})`)
  return (await res.json()) as T
}

interface ServerMessage {
  message_id: string
  role?: 'user' | 'assistant'
  text?: string
  answer?: string
  status?: AnswerStatus
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
    id: m.message_id,
    role,
    text: m.answer ?? m.text ?? '',
    at: m.created_at,
    meta:
      role === 'assistant'
        ? {
            mode: 'server',
            status: m.status ?? 'answered',
            evidence: m.evidence ?? [],
            modelVersion: m.model_version ?? null,
            abstainReasons: m.abstain_reasons ?? [],
            neededInfo: m.needed_info ?? [],
            notice: m.data_status ? DATA_NOTICE[m.data_status] : undefined,
          }
        : undefined,
  }
}

// ── 공개 함수 ───────────────────────────────────────────

/** 사건의 근거 묶음. 서버 것이 있으면 그것을, 없으면 이 브라우저 기록으로 */
export async function getAssistantContext(c: IncidentCase): Promise<IncidentContext> {
  const local = buildIncidentContext(c)
  if (!local.incidentId) return local
  try {
    const s = await request<{ evidence?: EvidenceItem[] }>(`/incidents/${local.incidentId}/assistant/context`)
    return s.evidence?.length ? { ...local, evidence: s.evidence } : local
  } catch {
    return local
  }
}

/** 사건별 대화 이력 */
export async function listAssistantMessages(c: IncidentCase): Promise<AssistantTurn[]> {
  const id = c.backend?.incidentId
  if (id) {
    try {
      const r = await request<{ items: ServerMessage[] }>(`/incidents/${id}/assistant/messages`)
      if (r.items.length) return r.items.map(fromServer)
    } catch {
      // 서버 이력이 없으면 이 브라우저 기록
    }
  }
  return loadLocal(c.id)
}

/** 질문 하나 → 답 하나. 두 턴을 이력에 더해 돌려준다 */
export async function askAssistant(c: IncidentCase, question: string, via: 'voice' | 'text', actor: string, history: AssistantTurn[]): Promise<AssistantTurn[]> {
  const userTurn: AssistantTurn = { id: uid(), role: 'user', text: question, at: new Date().toISOString(), via }
  let reply: AssistantTurn
  const id = c.backend?.incidentId
  let fallbackNotice: AssistantMeta['notice'] = { tone: 'info', text: '서버 대화 AI가 아직 연결되지 않아, 이 사건에 기록된 분석 결과만으로 답했어요.' }

  try {
    if (!id) throw new NotAvailable()
    const m = await request<ServerMessage>(`/incidents/${id}/assistant/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, input_mode: via, actor }),
    })
    reply = fromServer({ ...m, role: 'assistant' })
  } catch (e) {
    if (!id) fallbackNotice = { tone: 'info', text: '이 사건은 서버에 등록되지 않아, 이 브라우저에 기록된 분석 결과만으로 답했어요.' }
    else if (!(e instanceof NotAvailable)) fallbackNotice = { tone: 'err', text: `${(e as Error).message}. 서버 답 대신 이 사건에 기록된 분석 결과만으로 답했어요.` }
    const ctx = buildIncidentContext(c)
    const g = groundedAnswer(question, ctx)
    reply = {
      id: uid(),
      role: 'assistant',
      text: g.text,
      at: new Date().toISOString(),
      meta: {
        mode: 'local',
        status: g.status,
        evidence: ctx.evidence.filter((ev) => g.evidenceIds.includes(ev.id)),
        modelVersion: ctx.model.version,
        abstainReasons: g.abstainReasons,
        neededInfo: g.neededInfo,
        notice: fallbackNotice,
      },
    }
  }
  const next = [...history, userTurn, reply]
  saveLocal(c.id, next)
  return next
}
