import { IOT_MODEL, SCORE_FAULT, SCORE_WARN } from './village'
import { MODEL_SCOPE } from './waveform'

// 목적별로 분리한 AI 모델 2종 (데이터를 섞어 학습하지 않음)
export const AI_MODELS = [
  {
    name: 'IoT 이상 탐지',
    version: IOT_MODEL,
    input: '마을 전체 전압·전류 + 릴레이 상태 (5V DC, 0.5초)',
    output: `이상 점수 0~1 · 주의 ≥ ${SCORE_WARN} · 이상 ≥ ${SCORE_FAULT}`,
    data: 'Arduino + INA219(1개) 모형 계측',
  },
  {
    name: '고장파형 분류',
    version: 'rf-baseline-MOCK-0.0',
    input: `7채널 교류 파형 ${MODEL_SCOPE.rows}×${MODEL_SCOPE.cols} · ${MODEL_SCOPE.samplingRateHz}Hz`,
    output: '이벤트 유형 4종 (SIF·MIF·PF·TD) 또는 판단 보류',
    data: '공개 고장파형 데이터 (Xiong et al.)',
  },
]
