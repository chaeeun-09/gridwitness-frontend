// 이상 판정 규칙 하나: 스마트 마을(실측으로 학습·검증)과 가상 대단지(세대 계량기마다)가 같은 함수를 쓴다.
//   |측정 − 정상| > k × 흔들림 + 여유  → 이상
//   그 80%부터는 주의
// 마을: 정상·흔들림·k·여유 모두 우노 실측에서 정함 (gridwitness-ai scripts/eval_village.py)
// 대단지: 정상 = 실제 지역·월 가구 평균 패턴, 흔들림·여유는 세대별 실측이 없어 가정값 (complex.ts 에 표시)

export interface DeviationParams {
  /** 흔들림 (측정 단위) */
  sigma: number
  /** 몇 배 흔들림까지 정상으로 볼지 */
  k: number
  /** 흔들림과 별도로 더하는 허용 폭 (측정 단위) */
  tol: number
}

export interface Deviation {
  /** |측정−정상| ÷ (k·흔들림 + 여유). 1 을 넘으면 이상 */
  ratio: number
  level: 'NORMAL' | 'WARNING' | 'FAULT'
  /** 화면용 점수 0~1 (주의 0.3, 이상 0.6 에 맞춤) */
  score: number
}

export function deviation(measured: number, expected: number, p: DeviationParams): Deviation {
  const ratio = Math.abs(measured - expected) / (p.k * p.sigma + p.tol)
  const score = ratio < 0.8 ? (0.3 * ratio) / 0.8 : Math.min(1, 0.3 + (0.3 * (ratio - 0.8)) / 0.2)
  return { ratio, level: ratio > 1 ? 'FAULT' : ratio >= 0.8 ? 'WARNING' : 'NORMAL', score }
}
