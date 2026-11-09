// 실시간 사건: FRTU 고장표시가 뜨는 순간을 하나의 "사건"으로 묶어 발생 → 진행 → 복구까지 기록한다.
// 데이터는 마을 모형의 직류 계측(FRTU 3대)뿐이다. 교류 고장파형 분석과 섞지 않는다.
// 실제 현장이라면 같은 자리에 FRTU가 녹화한 교류 고장파형과 그 AI 분석이 들어간다.

import { useSyncExternalStore } from 'react'
import { FI_LABEL, frtuViews, locateFault, type FaultScope, type FiKind, type FrtuId } from './frtu'
import { ledA, type DataSource, type VillageSnapshot } from './village'

export interface IncidentPoint {
  t: number
  i: number
  ih: number | null
  il: number | null
}

export interface LiveIncident {
  id: number
  source: DataSource
  startedAt: number
  /** 복구된 시각 (아직 진행 중이면 null) */
  clearedAt: number | null
  scope: FaultScope
  title: string
  reasons: string[]
  /** 고장표시가 뜬 FRTU와 종류 (가장 심했을 때) */
  fi: Record<FrtuId, FiKind>
  /** 원인 판정 (계측값만으로 낸 규칙 판정) */
  cause: string
  /** 사건 전 10초 + 진행 중 계측 */
  points: IncidentPoint[]
  /** 규칙 기반 이상 이벤트 id (사건 등록에 씀) */
  ruleEventId: number | null
  caseId: string | null
  /** 처리 단계 (접수 → 출동 → 점검 → 복구 → 종결) */
  stage: IncidentStage
  /** 담당자 (출동·점검을 맡은 사람) */
  assignee: string | null
  /** 단계가 바뀐 기록 */
  stageLog: { stage: IncidentStage; at: number; by: string }[]
}

export type IncidentStage = 'RECEIVED' | 'DISPATCHED' | 'INSPECTING' | 'RESTORED' | 'CLOSED'
export const STAGES: IncidentStage[] = ['RECEIVED', 'DISPATCHED', 'INSPECTING', 'RESTORED', 'CLOSED']
export const STAGE_LABEL: Record<IncidentStage, string> = { RECEIVED: '접수', DISPATCHED: '출동', INSPECTING: '점검', RESTORED: '복구', CLOSED: '종결' }

interface State {
  incidents: LiveIncident[]
  /** 화면에 펼쳐 둔 사건 */
  openId: number | null
  /** 알림 배너를 닫은 사건 */
  dismissed: number[]
}

const ACTIVE: FaultScope[] = ['HOUSE', 'LAMP', 'BOTH', 'UPSTREAM', 'UNKNOWN']
const REOPEN_MS = 3000 // 복구 직후 다시 고장표시가 뜨면 같은 사건으로 이어 봄 (깜빡임 방지)

// 사건 목록은 이 브라우저에 저장해 새로고침해도 남긴다 (예전 형식 기록은 단계 정보를 채워 읽음)
const KEY = 'gridwitness.liveIncidents.v1'
function loadSaved(): LiveIncident[] {
  try {
    const xs = JSON.parse(localStorage.getItem(KEY) ?? '[]') as LiveIncident[]
    return xs.map((x) => ({ ...x, stage: x.stage ?? (x.clearedAt ? 'RESTORED' : 'RECEIVED'), assignee: x.assignee ?? null, stageLog: x.stageLog ?? [] }))
  } catch {
    return []
  }
}
let lastSave = 0
function persist(force = false) {
  const now = Date.now()
  if (!force && now - lastSave < 2000) return
  lastSave = now
  try {
    localStorage.setItem(KEY, JSON.stringify(state.incidents))
  } catch {
    // 저장 공간이 모자라면 화면에서만
  }
}

let state: State = { incidents: loadSaved(), openId: null, dismissed: [] }
let seq = state.incidents.reduce((m, x) => Math.max(m, x.id), 0)
let lastPacket = -1
const listeners = new Set<() => void>()
const set = (next: Partial<State>, force = false) => {
  state = { ...state, ...next }
  if (next.incidents) persist(force)
  listeners.forEach((l) => l())
}
const patch = (id: number, f: (x: LiveIncident) => LiveIncident) => set({ incidents: state.incidents.map((x) => (x.id === id ? f(x) : x)) }, true)

/** 처리 단계 바꾸기 (담당자가 직접) */
export const setIncidentStage = (id: number, stage: IncidentStage, by: string) =>
  patch(id, (x) => ({ ...x, stage, stageLog: [...x.stageLog, { stage, at: Date.now(), by }] }))
export const assignIncident = (id: number, name: string) => patch(id, (x) => ({ ...x, assignee: name.trim() || null }))
export const clearIncidentHistory = () => set({ incidents: state.incidents.filter((x) => !x.clearedAt) }, true)
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l))

export const useLiveIncidents = () => useSyncExternalStore(subscribe, () => state)
export const openIncident = (id: number | null) => set({ openId: id })
export const dismissIncident = (id: number) => set({ dismissed: [...state.dismissed, id] })
export const markIncidentRegistered = (id: number, caseId: string) => patch(id, (x) => ({ ...x, caseId }))
export const getLiveIncident = (id: number) => state.incidents.find((x) => x.id === id) ?? null

const toPoint = (h: VillageSnapshot['history'][number]): IncidentPoint => ({ t: h.t, i: h.i, ih: h.ih ?? null, il: h.il ?? null })

/** 계측값만으로 낸 원인 판정 (고장표시 종류 + 전류 변화량) */
function causeOf(s: VillageSnapshot): string {
  const fv = frtuViews(s)
  const hit = [fv.house, fv.lamp].filter((f) => f.fi !== 'NONE')
  const one = hit[0] ?? fv.inlet
  const diff = one.expected - one.i
  const leds = Math.round(Math.abs(diff) / ledA())
  switch (one.fi) {
    case 'LOW':
      return `단선 의심 — ${one.def.short}에서 LED 약 ${leds || 1}개 분량 전류가 사라졌어요`
    case 'HIGH':
      return `누설·과전류 의심 — ${one.def.short}에 예상보다 ${(Math.abs(diff) * 1000).toFixed(0)} mA 더 흘러요`
    case 'VOLTAGE':
      return `전원 전압 강하 — ${one.v.toFixed(2)} V (분기점 앞 전원·어댑터 쪽)`
    case 'OUTAGE':
      return '전원 없음 — 분기점 앞에서 끊김'
    default:
      return '판단 보류 — 고장표시 종류를 정하기에 근거가 부족해요'
  }
}

const SEVERITY: Record<FiKind, number> = { NONE: 0, VOLTAGE: 1, HIGH: 2, LOW: 2, OUTAGE: 3 }

/** 계측이 새로 올 때마다 부른다 (상단 셸의 감시 컴포넌트에서) */
export function observeVillage(s: VillageSnapshot) {
  if (s.packets === lastPacket) return
  lastPacket = s.packets
  const loc = locateFault(s)
  // 계측값이 없으면 고장인지 복구인지 알 수 없으므로 아무것도 바꾸지 않는다 (새로고침 직후 등)
  if (loc.scope === 'NO_DATA') return
  const active = ACTIVE.includes(loc.scope)
  const now = Date.now()
  const last = s.history[s.history.length - 1]
  const [cur, ...rest] = state.incidents
  const fvNow = frtuViews(s)
  const fiNow = { inlet: fvNow.inlet.fi, house: fvNow.house.fi, lamp: fvNow.lamp.fi }
  const ruleEventId = s.events.find((e) => !e.clearedAt)?.id ?? null

  const reopen = cur && cur.clearedAt && active && now - cur.clearedAt < REOPEN_MS
  if (cur && (!cur.clearedAt || reopen)) {
    const points = last && cur.points[cur.points.length - 1]?.t !== last.t ? [...cur.points, toPoint(last)].slice(-200) : cur.points
    const worse = (k: FrtuId) => (SEVERITY[fiNow[k]] > SEVERITY[cur.fi[k]] ? fiNow[k] : cur.fi[k])
    // 계측이 정상으로 돌아오면 처리 단계를 '복구'로 (담당자가 이미 종결했으면 그대로)
    const justRestored = !active && !cur.clearedAt && cur.stage !== 'RESTORED' && cur.stage !== 'CLOSED'
    set({
      incidents: [
        {
          ...cur,
          ...(justRestored && { stage: 'RESTORED' as IncidentStage, stageLog: [...cur.stageLog, { stage: 'RESTORED' as IncidentStage, at: now, by: '계측 복구 감지' }] }),
          points,
          clearedAt: active ? null : now,
          ...(active && { scope: loc.scope, title: loc.title, reasons: loc.reasons, cause: causeOf(s) }),
          fi: { inlet: worse('inlet'), house: worse('house'), lamp: worse('lamp') },
          ruleEventId: cur.ruleEventId ?? ruleEventId,
        },
        ...rest,
      ],
    }, justRestored)
    return
  }
  if (!active) return
  const inc: LiveIncident = {
    id: ++seq,
    source: s.source,
    startedAt: now,
    clearedAt: null,
    scope: loc.scope,
    title: loc.title,
    reasons: loc.reasons,
    fi: fiNow,
    cause: causeOf(s),
    points: s.history.slice(-20).map(toPoint),
    ruleEventId,
    caseId: null,
    stage: 'RECEIVED',
    assignee: null,
    stageLog: [{ stage: 'RECEIVED', at: now, by: '고장표시 자동 접수' }],
  }
  set({ incidents: [inc, ...state.incidents].slice(0, 30) }, true)
}

export const FI_SHORT: Record<FiKind, string> = { ...FI_LABEL, NONE: '정상' }
