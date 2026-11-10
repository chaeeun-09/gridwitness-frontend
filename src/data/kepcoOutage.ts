// 한국전력공사_배전 정전통계종합 정보 (2016~2025년, 한전 지역본부 15곳)
// 출처: 공공데이터포털 https://www.data.go.kr/data/3068741/fileData.do · 이용허락범위 제한 없음 · 무료
// 원본 파일 4개(기준 20181231·20221231·20231231·20241231)와 최신본(20251231)의 값을 그대로 옮김.
// 컬럼: 연도, 지역, 일시정전 발생 건수, 순시·순간정전 발생 건수.
// 통계 자료이므로 고장파형 AI의 학습·판정에는 쓰지 않고, 문제 크기·맥락 표시에만 쓴다.

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

export const OUTAGE_YEARS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]

/** 지역본부별 [일시정전 2016~2025], [순시·순간정전 2016~2025] */
const RAW: Record<string, [number[], number[]]> = {
  서울본부: [[21, 9, 18, 26, 25, 42, 34, 33, 38, 33], [106, 109, 107, 91, 86, 85, 83, 76, 80, 98]],
  남서울본부: [[36, 24, 41, 34, 33, 29, 55, 46, 36, 36], [222, 231, 198, 168, 117, 143, 107, 106, 95, 152]],
  인천본부: [[33, 25, 30, 52, 43, 48, 59, 51, 72, 43], [252, 217, 233, 252, 153, 164, 163, 145, 150, 168]],
  경기북부본부: [[32, 50, 29, 67, 62, 55, 76, 88, 77, 44], [188, 185, 172, 147, 110, 116, 156, 132, 173, 200]],
  경기본부: [[60, 69, 72, 80, 85, 113, 116, 153, 179, 130], [454, 414, 448, 403, 353, 370, 358, 352, 354, 428]],
  강원본부: [[28, 41, 37, 45, 57, 45, 74, 87, 124, 75], [114, 189, 75, 70, 183, 216, 65, 115, 121, 153]],
  충북본부: [[31, 32, 31, 21, 41, 41, 35, 36, 53, 51], [131, 118, 138, 130, 151, 211, 113, 131, 140, 165]],
  대전세종충남본부: [[37, 29, 37, 39, 40, 57, 90, 80, 113, 69], [331, 301, 300, 239, 268, 328, 244, 238, 276, 351]],
  전북본부: [[29, 25, 31, 36, 39, 48, 42, 59, 51, 51], [167, 147, 160, 140, 162, 181, 161, 198, 190, 286]],
  광주전남본부: [[45, 61, 45, 74, 68, 72, 95, 158, 110, 107], [309, 284, 327, 330, 297, 410, 258, 343, 313, 342]],
  대구본부: [[39, 40, 29, 39, 36, 46, 76, 61, 46, 50], [275, 202, 201, 199, 202, 176, 175, 196, 169, 247]],
  경북본부: [[16, 18, 20, 30, 36, 33, 40, 44, 42, 40], [84, 66, 90, 68, 63, 100, 101, 141, 105, 194]],
  부산울산본부: [[64, 47, 48, 49, 41, 57, 78, 71, 81, 56], [551, 402, 427, 442, 309, 289, 323, 326, 266, 331]],
  경남본부: [[33, 27, 24, 32, 27, 26, 35, 49, 35, 26], [225, 180, 178, 189, 182, 276, 172, 191, 168, 164]],
  제주본부: [[16, 12, 14, 17, 16, 23, 28, 29, 34, 31], [109, 148, 113, 83, 44, 160, 91, 81, 83, 106]],
}

export const KEPCO_OUTAGE_ALL: OutageRow[] = Object.entries(RAW).flatMap(([region, [s, m]]) =>
  OUTAGE_YEARS.map((year, k) => ({ year, region, sustained: s[k], momentary: m[k] })),
)
export const KEPCO_OUTAGE_2025: OutageRow[] = KEPCO_OUTAGE_ALL.filter((r) => r.year === 2025)
export const OUTAGE_REGIONS = Object.keys(RAW)

export const outageTotals = (rows: OutageRow[] = KEPCO_OUTAGE_2025) => ({
  sustained: rows.reduce((n, r) => n + r.sustained, 0),
  momentary: rows.reduce((n, r) => n + r.momentary, 0),
})

/** 연도별 전국 합계와 고른 지역 값 (추이 그래프용) */
export const outageTrend = (region: string) =>
  OUTAGE_YEARS.map((year) => {
    const ys = KEPCO_OUTAGE_ALL.filter((r) => r.year === year)
    const mine = ys.find((r) => r.region === region)!
    return { year, nationSustained: outageTotals(ys).sustained, regionSustained: mine.sustained, regionMomentary: mine.momentary }
  })

/** 사용자가 고른 지역 (대시보드·공공데이터 화면 공통, 브라우저에 기억) */
const REGION_KEY = 'gridwitness.region.v1'
export const DEFAULT_REGION = '광주전남본부'
export function loadRegion(): string {
  try {
    const r = localStorage.getItem(REGION_KEY)
    return r && OUTAGE_REGIONS.includes(r) ? r : DEFAULT_REGION
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
