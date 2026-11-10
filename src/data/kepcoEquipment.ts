// 한국전력공사_배전설비통계 개폐기 · 지지물 (기준 2026-07-15, 시도 17곳)
// 출처: 공공데이터포털 (이용허락범위 제한 없음 · 무료), 원본 CSV 값을 그대로 옮김.
//   개폐기 https://www.data.go.kr/data/15132158/fileData.do — 지역, 개폐기_가공(대), 개폐기_지중(대)
//   지지물 https://www.data.go.kr/data/15132170/fileData.do — 지역, 콘크리트주·강관주·목주·철주·철탑(기)
// 개폐기는 배전자동화 단말(FRTU)이 달리는 자리라서 "적용 규모"의 근거로 쓴다. 통계이므로 AI 학습·판정에는 쓰지 않는다.

export interface EquipmentRow {
  region: string
  switchOverhead: number
  switchUnderground: number
  /** 콘크리트주·강관주·목주·철주·철탑 합계 (기) */
  supports: number
}

export const KEPCO_EQUIPMENT_SOURCE = {
  switches: { name: '한국전력공사_배전설비통계 개폐기', url: 'https://www.data.go.kr/data/15132158/fileData.do' },
  supports: { name: '한국전력공사_배전설비통계 지지물', url: 'https://www.data.go.kr/data/15132170/fileData.do' },
  asOf: '2026-07-15',
  license: '이용허락범위 제한 없음',
}

// [가공 개폐기, 지중 개폐기, 콘크리트주, 강관주, 목주, 철주, 철탑]
const RAW: Record<string, number[]> = {
  서울: [9995, 15337, 159554, 20136, 22, 18, 1],
  부산: [4925, 6087, 123872, 20020, 13, 0, 0],
  대구: [5914, 3302, 185290, 9423, 23, 2, 5],
  인천: [4821, 6334, 182773, 9205, 2, 2, 61],
  광주: [2775, 3158, 98665, 7190, 2, 1, 0],
  대전: [1615, 4842, 70463, 7750, 6, 0, 1],
  울산: [2222, 2049, 111078, 5197, 2, 0, 0],
  세종: [616, 1028, 57192, 1848, 0, 0, 3],
  경기: [24695, 27415, 1470721, 21893, 13, 69, 31],
  강원: [7722, 3174, 717844, 32442, 7, 19, 95],
  충북: [6509, 2800, 637381, 10894, 5, 0, 37],
  충남: [9799, 4531, 1142956, 23440, 2, 2, 47],
  전북: [11389, 3211, 939109, 27465, 4, 7, 22],
  전남: [12883, 3203, 1418662, 56078, 0, 5, 530],
  경북: [14246, 1977, 1478405, 62948, 10, 5, 53],
  경남: [12343, 4177, 934568, 105160, 18, 13, 123],
  제주: [3329, 1633, 190677, 5684, 2, 0, 0],
}

export const KEPCO_EQUIPMENT: EquipmentRow[] = Object.entries(RAW).map(([region, [so, su, ...sp]]) => ({
  region,
  switchOverhead: so,
  switchUnderground: su,
  supports: sp.reduce((a, b) => a + b, 0),
}))

export const equipmentTotals = () =>
  KEPCO_EQUIPMENT.reduce(
    (t, r) => ({ switches: t.switches + r.switchOverhead + r.switchUnderground, overhead: t.overhead + r.switchOverhead, underground: t.underground + r.switchUnderground, supports: t.supports + r.supports }),
    { switches: 0, overhead: 0, underground: 0, supports: 0 },
  )

/** 정전통계의 지역본부 → 설비통계의 시도 (본부 하나가 여러 시도를 맡는 경우 합침) */
export const REGION_TO_SIDO: Record<string, string[]> = {
  서울본부: ['서울'],
  남서울본부: ['서울'],
  인천본부: ['인천'],
  경기북부본부: ['경기'],
  경기본부: ['경기'],
  강원본부: ['강원'],
  충북본부: ['충북'],
  대전세종충남본부: ['대전', '세종', '충남'],
  전북본부: ['전북'],
  광주전남본부: ['광주', '전남'],
  대구본부: ['대구'],
  경북본부: ['경북'],
  부산울산본부: ['부산', '울산'],
  경남본부: ['경남'],
  제주본부: ['제주'],
}
