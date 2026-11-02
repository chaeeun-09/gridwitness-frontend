import type { SubStatus } from '../../lib/city'

// 도시 3D 장면과 페이지가 함께 쓰는 값 (장면 파일은 무거워서 지연 로딩하므로 따로 둔다)

export type CitySelection = { kind: 'feeder' | 'sub'; id: number } | null

/** 0 = 낮, 1 = 밤 (해가 6시에 뜨고 18시에 짐, 앞뒤 1시간은 서서히) */
export function nightness(time: number): number {
  const sun = Math.sin(((time - 6) / 12) * Math.PI)
  return Math.min(1, Math.max(0, 0.5 - sun * 1.6))
}

export const SUB_COLOR: Record<SubStatus, string> = { OK: '#2ecf8a', HIGH: '#f2b01e', OVERLOAD: '#f0771f', FAULT: '#e5484d', OUT: '#6b7280' }

