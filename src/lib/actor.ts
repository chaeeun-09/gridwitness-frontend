import { useEffect, useState } from 'react'

const KEY = 'gridwitness.actor'

export function getActor(): string {
  try {
    return localStorage.getItem(KEY) || '분석 담당자'
  } catch {
    return '분석 담당자'
  }
}

export function useActor() {
  const [actor, setActor] = useState(getActor)
  useEffect(() => {
    try {
      localStorage.setItem(KEY, actor)
    } catch {
      // 저장 불가 환경은 무시
    }
  }, [actor])
  return [actor, setActor] as const
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleString('ko-KR', { hour12: false })
