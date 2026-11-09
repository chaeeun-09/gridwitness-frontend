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
}

interface State {
  incidents: LiveIncident[]
  /** 화면에 펼쳐 둔 사건 */
  openId: number | null
  /** 알림 배너를 닫은 사건 */
  dismissed: number[]
}

const ACTIVE: FaultScope[] = ['HOUSE', 'LAMP', 'BOTH', 'UPSTREAM', 'UNKNOWN']
const REOPEN_MS = 3000 // 복구 직후 다시 고장표시가 뜨면 같은 사건으로 이어 봄 (깜빡임 방지)

let state: State = { incidents: [], openId: null, dismissed: [] }
let seq = 0
let lastPacket = -1
const listeners = new Set<() => void>()
const set = (next: Partial<State>) => {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l))

export const useLiveIncidents = () => useSyncExternalStore(subscribe, () => state)
export const openIncident = (id: number | null) => set({ openId: id })
export const dismissIncident = (id: number) => set({ dismissed: [...state.dismissed, id] })
export const markIncidentRegistered = (id: number, caseId: string) =>
  set({ incidents: state.incidents.map((x) => (x.id === id ? { ...x, caseId } : x)) })

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
    set({
      incidents: [
        {
          ...cur,
          points,
          clearedAt: active ? null : now,
          ...(active && { scope: loc.scope, title: loc.title, reasons: loc.reasons, cause: causeOf(s) }),
          fi: { inlet: worse('inlet'), house: worse('house'), lamp: worse('lamp') },
          ruleEventId: cur.ruleEventId ?? ruleEventId,
        },
        ...rest,
      ],
    })
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
  }
  set({ incidents: [inc, ...state.incidents].slice(0, 20) })
}

export const FI_SHORT: Record<FiKind, string> = { ...FI_LABEL, NONE: '정상' }
