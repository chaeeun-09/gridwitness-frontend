import { useSyncExternalStore } from 'react'

// 분석 서버(FastAPI) 연결 설정.

// 실제 서버 주소.
// - Vite 개발 서버(vite.config.ts)와 Vercel(vercel.json)은 같은 출처의 /gw-api 를 이 주소로 프록시한다
// - GitHub Pages 는 정적 호스팅이라 프록시가 없다 (/gw-api → 404). 대신 서버 CORS 가 https://jyx-07.github.io 를
//   허용하므로(gridwitness-api app/main.py) 서버 주소로 바로 요청한다
export const UPSTREAM_API = 'https://gridwitness-api.https.gsmsv.site'
const PROXY_API = '/gw-api'
/** 프록시가 없는 정적 호스팅(GitHub Pages)에서 열렸는지 */
const STATIC_HOST = typeof location !== 'undefined' && location.hostname.endsWith('github.io')
export const DEFAULT_API = STATIC_HOST ? UPSTREAM_API : PROXY_API

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
  // 프록시가 있는 곳: 직접 주소는 CORS 에 막히므로 프록시 경로로 / 정적 호스팅: 프록시 경로는 없으므로 직접 주소로
  if (STATIC_HOST) return url === PROXY_API ? UPSTREAM_API : url
  return url === UPSTREAM_API ? PROXY_API : url
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
