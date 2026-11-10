import { useEffect, useSyncExternalStore } from 'react'
import { API_CHANGED_EVENT, apiBase, apiRequest } from '../lib/backend'

export type VillageRecordKind = 'event' | 'incident' | 'iot_case'
export interface VillageRecord<T = unknown> {
  record_id: string
  kind: VillageRecordKind
  device_id: string | null
  data: T
  created_at: string
  updated_at: string
}
export interface VillagePersistence { pending: number; error: string | null; syncing: boolean }
interface Store {
  records: Record<string, VillageRecord>
  pending: Record<string, number>
  revision: number
  status: VillagePersistence
  storageError: string | null
  inFlight: Map<string, Promise<VillageRecord | null>>
}
const stores = new Map<string, Store>()
const listeners = new Set<() => void>()
const key = (base: string) => `gridwitness.village.records.v1.${encodeURIComponent(base)}`
function current(base = apiBase()): Store {
  let s = stores.get(base)
  if (!s) {
    let saved: Partial<Store> = {}
    let error: string | null = null
    try { saved = JSON.parse(localStorage.getItem(key(base)) ?? '{}') as Partial<Store> }
    catch { error = '브라우저의 마을 기록을 읽지 못했어요. 저장 설정을 확인하세요.' }
    s = { records: saved.records ?? {}, pending: saved.pending ?? {}, revision: saved.revision ?? 0, status: { pending: Object.keys(saved.pending ?? {}).length, error, syncing: false }, storageError: error, inFlight: new Map() }
    stores.set(base, s)
  }
  return s
}
function emit(s: Store, error: string | null = s.status.error) {
  s.status = { pending: Object.keys(s.pending).length, error: s.storageError ?? error, syncing: s.inFlight.size > 0 }
  listeners.forEach((l) => l())
}
function mergeDisk(base: string, s: Store, acknowledged?: { id: string; at: string }) {
  const saved = JSON.parse(localStorage.getItem(key(base)) ?? '{}') as Partial<Store>
  for (const [id, record] of Object.entries(saved.records ?? {})) {
    if (acknowledged?.id === id && record.updated_at <= acknowledged.at) continue
    const local = s.records[id]
    if (!local || Date.parse(record.updated_at) > Date.parse(local.updated_at)) {
      s.records[id] = record
      if (saved.pending?.[id]) s.pending[id] = saved.pending[id]
    }
  }
  s.revision = Math.max(s.revision, saved.revision ?? 0)
}
function persist(base: string, s: Store, acknowledged?: { id: string; at: string }): boolean {
  try {
    // 다른 탭이 수신한 별도 UUID 기록을 오래된 메모리 사본으로 지우지 않는다.
    mergeDisk(base, s, acknowledged)
    localStorage.setItem(key(base), JSON.stringify({ records: s.records, pending: s.pending, revision: s.revision }))
    s.storageError = null
    return true
  } catch {
    s.storageError = '브라우저 저장 공간이 부족하거나 저장이 차단됐어요. 서버 전송 전까지 이 탭을 닫으면 기록이 사라질 수 있어요.'
    return false
  }
}
export const subscribeVillageRecords = (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener) }
export const getVillagePersistence = (): VillagePersistence => current().status
export function getVillageRecordState(recordId: string): 'server' | 'pending' | 'memory' | 'missing' {
  const s = current()
  return !s.records[recordId] ? 'missing' : s.pending[recordId] ? s.storageError ? 'memory' : 'pending' : 'server'
}
export function getCachedVillageRecords<T = unknown>(kind: VillageRecordKind): VillageRecord<T>[] {
  return Object.values(current().records).filter((r) => r.kind === kind) as VillageRecord<T>[]
}

async function sendRecord(base: string, s: Store, id: string): Promise<VillageRecord | null> {
  const existing = s.inFlight.get(id)
  if (existing) {
    await existing
    return s.pending[id] ? sendRecord(base, s, id) : s.records[id] ?? null
  }
  if (base !== apiBase() || !s.pending[id]) return null
  const revision = s.pending[id]
  const record = s.records[id]
  const task = (async () => {
    try {
      const saved = await apiRequest<VillageRecord>(`/api/v1/village/records/${encodeURIComponent(id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: record.kind, device_id: record.device_id, data: record.data }),
      })
      // 전송 중 새 계측/단계가 생겼다면 오래된 응답으로 덮어쓰지 않는다.
      if (s.pending[id] === revision) {
        s.records[id] = saved
        delete s.pending[id]
      }
      persist(base, s, { id, at: record.updated_at })
      emit(s, null)
      return saved
    } catch (e) {
      persist(base, s)
      emit(s, (e as Error).message)
      return null
    } finally {
      s.inFlight.delete(id)
      emit(s)
    }
  })()
  s.inFlight.set(id, task)
  emit(s)
  return task
}

/** 계측마다 먼저 로컬 큐를 갱신한다. 네트워크 전송은 묶어서 재시도할 수 있다. */
export function queueVillageRecord<T>(recordId: string, kind: VillageRecordKind, deviceId: string | null, data: T): void {
  const base = apiBase()
  const s = current(base)
  const at = new Date().toISOString()
  s.records[recordId] = { record_id: recordId, kind, device_id: deviceId, data: structuredClone(data), created_at: s.records[recordId]?.created_at ?? at, updated_at: at }
  s.pending[recordId] = ++s.revision
  persist(base, s)
  emit(s)
}
/** null은 브라우저에 보존된 전송 대기 기록이다. 양쪽 모두 저장 실패하면 오류를 알린다. */
export async function saveVillageRecord<T>(recordId: string, kind: VillageRecordKind, deviceId: string | null, data: T): Promise<VillageRecord<T> | null> {
  const base = apiBase()
  const s = current(base)
  queueVillageRecord(recordId, kind, deviceId, data)
  const result = await sendRecord(base, s, recordId)
  if (!result && s.storageError) throw new Error(s.storageError)
  return result as VillageRecord<T> | null
}

export async function retryVillageRecords(): Promise<void> {
  const base = apiBase()
  const s = current(base)
  persist(base, s)
  for (const id of Object.keys(s.pending)) {
    if (base !== apiBase()) break
    if (!await sendRecord(base, s, id)) break
  }
  emit(s)
}

/** 서버는 페이지 끝까지 읽는다. 미전송 최신 변경은 서버의 이전 사본보다 우선한다. */
export async function listVillageRecords<T = unknown>(kind: VillageRecordKind): Promise<VillageRecord<T>[]> {
  const base = apiBase()
  const s = current(base)
  try {
    let page = 1
    let received = 0
    while (true) {
      const result = await apiRequest<{ items: VillageRecord[]; page: number; per_page: number; total_count: number }>(`/api/v1/village/records?kind=${kind}&page=${page}&per_page=100`)
      if (!Array.isArray(result.items)) throw new Error('서버 마을 기록의 형식이 올바르지 않아요.')
      for (const record of result.items) if (!s.pending[record.record_id]) s.records[record.record_id] = record
      received += result.items.length
      if (!result.items.length || received >= result.total_count) break
      page++
      if (base !== apiBase()) return []
    }
    persist(base, s)
    emit(s, null)
  } catch (e) { emit(s, `서버 기록을 확인하지 못해 브라우저 보관본을 표시해요. ${(e as Error).message}`) }
  return Object.values(s.records).filter((r) => r.kind === kind) as VillageRecord<T>[]
}

export function useVillagePersistence(): VillagePersistence {
  useEffect(() => {
    void retryVillageRecords()
    const timer = setInterval(() => { void retryVillageRecords() }, 30_000)
    return () => clearInterval(timer)
  }, [])
  return useSyncExternalStore(subscribeVillageRecords, getVillagePersistence)
}
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void retryVillageRecords() })
  window.addEventListener(API_CHANGED_EVENT, () => { emit(current()); void retryVillageRecords() })
  window.addEventListener('storage', (event) => {
    if ((event as StorageEvent).key !== key(apiBase())) return
    const s = current()
    try { mergeDisk(apiBase(), s); emit(s) }
    catch { emit(s, '다른 탭의 마을 기록을 읽지 못했어요. 저장 설정을 확인하세요.') }
  })
}
