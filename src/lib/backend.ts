import { useSyncExternalStore } from 'react'

// 분석 서버 연결 설정. 기본은 Mock(브라우저 안에서만 동작)이고, 설정에서 백엔드로 바꾸면 FastAPI 서버를 호출한다.

export const DEFAULT_API = 'https://gridwitness-api.https.gsmsv.site'
export type ApiMode = 'MOCK' | 'BACKEND'

const MODE_KEY = 'gridwitness.api.mode'
const URL_KEY = 'gridwitness.api.url'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function apiMode(): ApiMode {
  const env = import.meta.env.VITE_API_MODE as string | undefined
  const v = read(MODE_KEY) ?? env
  return v === 'BACKEND' ? 'BACKEND' : 'MOCK'
}

export function apiBase(): string {
  const raw = read(URL_KEY) ?? (import.meta.env.VITE_API_BASE as string | undefined) ?? DEFAULT_API
  return raw.replace(/\/+$/, '')
}

/** 모드를 바꾸면 화면의 데이터가 통째로 달라지므로 새로고침해서 적용 */
export function setApiMode(mode: ApiMode) {
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // 저장 불가 환경은 무시
  }
  location.reload()
}

export function setApiBase(url: string) {
  try {
    localStorage.setItem(URL_KEY, url.trim())
  } catch {
    // 저장 불가 환경은 무시
  }
}

// ── 서버 상태 ───────────────────────────────────────────
export interface Health {
  state: 'idle' | 'checking' | 'ok' | 'down'
  detail: string
  checkedAt: number | null
}

let health: Health = { state: 'idle', detail: '', checkedAt: null }
const listeners = new Set<() => void>()
const set = (h: Health) => {
  health = h
  listeners.forEach((l) => l())
}

export async function checkHealth(): Promise<Health> {
  set({ ...health, state: 'checking' })
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 8000)
    const res = await fetch(`${apiBase()}/health`, { signal: ctl.signal })
    clearTimeout(t)
    const body = (await res.json()) as { status?: string; database?: string }
    const ok = res.ok && body.status === 'ok'
    set({ state: ok ? 'ok' : 'down', detail: ok ? `서버 정상 · 데이터베이스 ${body.database ?? '?'}` : `응답 이상 (${res.status})`, checkedAt: Date.now() })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    set({ state: 'down', detail: aborted ? '8초 안에 응답이 없습니다' : '연결할 수 없습니다 (주소·네트워크·CORS 확인)', checkedAt: Date.now() })
  }
  return health
}

export function useBackendHealth(): Health {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => health,
  )
}

// 백엔드 모드로 시작했으면 한 번 확인
if (apiMode() === 'BACKEND') void checkHealth()
