import { useEffect, useState } from 'react'

/** 화면 조건(미디어 쿼리)에 맞는지 알려줌. 화면 크기가 바뀌면 다시 계산 */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}
