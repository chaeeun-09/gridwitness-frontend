// AI(gw_ai) 근거를 사람이 읽을 말로 바꾸고, 모델 평가 카드(public/data/model_card.json)를 불러온다.
// 카드의 숫자는 gridwitness-ai 의 reports/fault_waveform/CN/metrics.json 을 scripts/export_model_card.py 로 옮긴 것이다 (여기서 만들지 않음).

const CH: Record<string, string> = {
  Ia: 'A상 전류',
  Ib: 'B상 전류',
  Ic: 'C상 전류',
  In: '중성선 전류',
  Va: 'A상 전압',
  Vb: 'B상 전압',
  Vc: 'C상 전압',
}
const PER: Record<string, string> = {
  rms: '실효값',
  peak: '최대값',
  crest: '파고율 (최대 ÷ 실효)',
  drms: '변화 속도',
  cyc_rms_max: '주기별 실효값 최대',
  cyc_rms_ratio: '주기별 크기 변동 (최대 ÷ 최소)',
  fund_ratio: '기본파 비중',
  harm_ratio: '고조파 비중',
  dc_ratio: '직류 성분 비중',
}
const DERIVED: Record<string, string> = {
  I_unbalance: '3상 전류 불평형',
  V_unbalance: '3상 전압 불평형',
  I_zero_seq_ratio: '영상 전류 비율 (지락 징후)',
  V_zero_seq_ratio: '영상 전압 비율',
  In_ratio: '중성선 전류 비율',
}

/** 특징 이름(예: In_cyc_rms_ratio) → '중성선 전류 · 주기별 크기 변동 (최대 ÷ 최소)' */
export function featureLabel(name: string): string {
  if (DERIVED[name]) return DERIVED[name]
  const k = name.indexOf('_')
  const ch = name.slice(0, k)
  const f = name.slice(k + 1)
  return CH[ch] && PER[f] ? `${CH[ch]} · ${PER[f]}` : name
}

export const METHOD_LABEL: Record<string, string> = {
  treeshap: 'TreeSHAP: 이 사건에서 1순위 유형의 점수를 실제로 올리고(+) 내린(−) 특징',
  importance_x_z: '간이 계산: 전체 중요도 × 평소와 다른 정도 (이 사건에 대한 정확한 기여는 아님)',
}

export const REASON_SHORT: Record<string, string> = {
  OUT_OF_DISTRIBUTION: '학습 범위 밖 특징이 많음',
  LOW_SCORE: '1순위 점수가 기준보다 낮음',
  AMBIGUOUS_TOP2: '1·2위 점수 차가 기준보다 작음',
  MODEL_ERROR: '분석 중 오류',
  MODEL_NOT_LOADED: '모델 없음',
  DOMAIN_MISMATCH: '다른 나라 파형',
  DOMAIN_MODEL_MISSING: '그 나라 모델 없음',
}

// ── 모델 평가 카드 ─────────────────────────────────
export interface ModelCard {
  model: { country: string; dataset: { title: string; source: string; license: string }; versions: Record<string, string>; contract: string }
  data: { n: number; class_counts: Record<string, number> }
  split: { seed: number; train: number; val: number; test: number; note: string }
  thresholds: { score: number; margin: number; ood_ratio: number }
  test_all: { macro_f1: number; accuracy: number; recall: Record<string, number> }
  test_selective: { n: number; abstained: number; coverage: number; selective_accuracy: number; accuracy_of_abstained: number; abstain_by_reason: Record<string, number> }
  group_cv_macro_f1: { file_level: number; group_level: number; note: string }
  unknown_events: {
    total: number
    excluded_too_short: number
    evaluated: number
    abstained_or_rejected: number
    confident_wrong: number
    cases: { case_id: string; kind: string; status: string; answered_label: string | null; reasons: string[]; top_score: number }[]
    note: string
  }
  limitations: string[]
  abstained_test_cases: { id: string; true_label: string; reasons: string[]; reference_ranking: { label: string; score: number }[]; top_score: number; margin: number; file: string }[]
  source: string
}

let card: Promise<ModelCard> | null = null
export function loadModelCard(): Promise<ModelCard> {
  card ??= fetch(`${import.meta.env.BASE_URL}data/model_card.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`model_card.json: HTTP ${r.status}`)
      return r.json() as Promise<ModelCard>
    })
    .catch((e) => {
      card = null
      throw e
    })
  return card
}

export const UNKNOWN_KIND_KO: Record<string, string> = { 'circuit switching': '회로 개폐', 'motor start': '전동기 기동', 'treeline contact': '수목 접촉' }
