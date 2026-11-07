import { useSyncExternalStore } from 'react'

// 분석 서버(FastAPI) 연결 설정.

// 실제 서버 주소. 서버 CORS가 localhost:5173만 허용하므로 브라우저는 같은 출처의 /gw-api로
// 요청하고, Vite 개발 서버(vite.config.ts)와 Vercel(vercel.json)이 이 주소로 프록시한다.
export const UPSTREAM_API = 'https://gridwitness-api.https.gsmsv.site'
export const DEFAULT_API = '/gw-api'

const URL_KEY = 'gridwitness.api.url'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function apiBase(): string {
  const raw = read(URL_KEY) ?? (import.meta.env.VITE_API_BASE as string | undefined) ?? DEFAULT_API
  const url = raw.trim().replace(/\/+$/, '')
  // 예전에 저장된 직접 주소는 CORS에 막히므로 프록시 경로로 돌린다
  return url === UPSTREAM_API ? DEFAULT_API : url
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

// 시작할 때 한 번 확인
void checkHealth()
