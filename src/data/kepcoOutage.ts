// 한국전력공사_배전 정전통계종합 정보 (기준 2025-12-31, 등록 2026-09-08)
// 출처: 공공데이터포털 https://www.data.go.kr/data/3068741/fileData.do · 이용허락범위 제한 없음 · 무료
// 원본 15행을 그대로 옮김 (연도, 지역=한전 지역본부, 일시정전 발생 건수, 순시·순간정전 발생 건수).
// 통계 자료이므로 고장파형 AI의 학습·판정에는 쓰지 않고, 사업화 근거·맥락 표시에만 쓴다.

export interface OutageRow {
  year: number
  region: string
  /** 일시정전 발생 건수 */
  sustained: number
  /** 순시·순간정전 발생 건수 */
  momentary: number
}

export const KEPCO_OUTAGE_SOURCE = {
  name: '한국전력공사_배전 정전통계종합 정보',
  provider: '한국전력공사 (공공데이터포털)',
  url: 'https://www.data.go.kr/data/3068741/fileData.do',
  asOf: '2025-12-31',
  license: '이용허락범위 제한 없음',
}

export const KEPCO_OUTAGE_2025: OutageRow[] = [
  { year: 2025, region: '서울본부', sustained: 33, momentary: 98 },
  { year: 2025, region: '남서울본부', sustained: 36, momentary: 152 },
  { year: 2025, region: '인천본부', sustained: 43, momentary: 168 },
  { year: 2025, region: '경기북부본부', sustained: 44, momentary: 200 },
  { year: 2025, region: '경기본부', sustained: 130, momentary: 428 },
  { year: 2025, region: '강원본부', sustained: 75, momentary: 153 },
  { year: 2025, region: '충북본부', sustained: 51, momentary: 165 },
  { year: 2025, region: '대전세종충남본부', sustained: 69, momentary: 351 },
  { year: 2025, region: '전북본부', sustained: 51, momentary: 286 },
  { year: 2025, region: '광주전남본부', sustained: 107, momentary: 342 },
  { year: 2025, region: '대구본부', sustained: 50, momentary: 247 },
  { year: 2025, region: '경북본부', sustained: 40, momentary: 194 },
  { year: 2025, region: '부산울산본부', sustained: 56, momentary: 331 },
  { year: 2025, region: '경남본부', sustained: 26, momentary: 164 },
  { year: 2025, region: '제주본부', sustained: 31, momentary: 106 },
]

export const outageTotals = (rows: OutageRow[] = KEPCO_OUTAGE_2025) => ({
  sustained: rows.reduce((n, r) => n + r.sustained, 0),
  momentary: rows.reduce((n, r) => n + r.momentary, 0),
})

/** 사용자가 고른 지역 (대시보드·사업화 화면 공통, 브라우저에 기억) */
const REGION_KEY = 'gridwitness.region.v1'
export const DEFAULT_REGION = '광주전남본부'
export function loadRegion(): string {
  try {
    const r = localStorage.getItem(REGION_KEY)
    return r && KEPCO_OUTAGE_2025.some((x) => x.region === r) ? r : DEFAULT_REGION
  } catch {
    return DEFAULT_REGION
  }
}
export function saveRegion(r: string) {
  try {
    localStorage.setItem(REGION_KEY, r)
  } catch {
    // 저장 못 해도 화면에서는 동작
  }
}
