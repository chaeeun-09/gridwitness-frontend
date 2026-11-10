// 배치·GIS에서도 쓰는 수치. 3D 렌더러를 불러오지 않고 계산할 수 있게 분리한다.
export type HouseStyle = 'cottage' | 'twoStory' | 'wide'

export interface Spec {
  w: number
  d: number
  wallH: number
  roofH: number
  floors: 1 | 2
  wall: string
  trim: string
  roof: string
}

export const HOUSE_SPECS: Record<HouseStyle, Spec> = {
  cottage: { w: 3.2, d: 2.6, wallH: 1.9, roofH: 1.35, floors: 1, wall: '#f3e6cc', trim: '#ffffff', roof: '#b4472f' },
  twoStory: { w: 2.9, d: 2.5, wallH: 3.3, roofH: 1.3, floors: 2, wall: '#e9edf2', trim: '#ffffff', roof: '#4b5563' },
  wide: { w: 4.0, d: 2.7, wallH: 2.0, roofH: 1.2, floors: 1, wall: '#efe0c4', trim: '#fdfaf3', roof: '#8a4b2f' },
}

/** 지붕 위 인입선 지지대 꼭대기 (로컬 좌표) */
export function mastTop(style: HouseStyle): [number, number, number] {
  const s = HOUSE_SPECS[style]
  return [-s.w / 2 + 0.45, s.wallH + s.roofH + 0.55, 0]
}
