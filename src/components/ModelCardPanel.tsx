import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { loadModelCard, REASON_SHORT, UNKNOWN_KIND_KO, type ModelCard } from '../lib/aiExplain'
import { Badge, Metric, Metrics, Section, Skeleton } from './ui'

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`

/** '이 AI를 얼마나 믿어도 되나': 학습에 쓰지 않은 시험 세트의 실제 평가 결과 (gridwitness-ai metrics.json 그대로) */
export default function ModelCardPanel() {
  const [card, setCard] = useState<ModelCard | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadModelCard().then(setCard, (e) => setError(String(e)))
  }, [])

  if (error) return <p className="small muted">모델 평가 자료를 불러오지 못했습니다: {error}</p>
  if (!card) return <Skeleton h={180} />

  const s = card.test_selective
  const answered = s.n - s.abstained
  const correct = Math.round(s.selective_accuracy * answered)
  const abstainedRight = Math.round(s.accuracy_of_abstained * s.abstained)
  const u = card.unknown_events
  return (
    <Section
      title="중국 CN 모델 평가와 한계"
      description={`CN 모델이 학습에 쓰지 않은 시험 파형 ${s.n}건(${card.model.dataset.title.split(' (')[0]})의 실제 평가 결과입니다. RU 모델의 평가 수치는 이 카드에 포함되지 않습니다.`}
    >
      <Metrics cols={4}>
        <Metric label="답한 것의 정확도" value={pct(s.selective_accuracy)} foot={`답한 ${answered}건 중 ${correct}건 정답`} />
        <Metric label="모르면 보류" value={`${s.abstained}건`} unit={`/ ${s.n}`} foot={`보류 ${s.abstained}건 중 ${abstainedRight}건은 억지로 답했으면 맞았을 것`} />
        <Metric label="전부 답하게 했을 때" value={card.test_all.macro_f1.toFixed(3)} unit="macro-F1" foot={`정확도 ${pct(card.test_all.accuracy)}`} />
        <Metric label="더 엄격한 추정" value={card.group_cv_macro_f1.group_level.toFixed(3)} unit="macro-F1" foot="비슷한 파형을 묶어 나눈 교차검증 (같은 사고 파일이 학습·시험에 섞이는 효과 제거)" />
      </Metrics>

      <div className="grid-2" style={{ gap: 16, marginTop: 16 }}>
        <div>
          <strong className="small">AI가 보류한 시험 파형 {card.abstained_test_cases.length}건 (실제 파일)</strong>
          <ul className="small" style={{ margin: '6px 0 0 16px' }}>
            {card.abstained_test_cases.map((c) => (
              <li key={c.id}>
                <span className="mono">{c.id}</span> · 정답 {c.true_label} · {c.reasons.map((r) => REASON_SHORT[r] ?? r).join(', ')}{' '}
                <span className="muted">(1·2위 {c.reference_ranking.slice(0, 2).map((r) => `${r.label} ${r.score.toFixed(2)}`).join(' / ')})</span>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ marginTop: 6 }}>
            세 건 모두 1·2위 점수 차가 기준({card.thresholds.margin})보다 작아 두 유형을 가를 수 없었습니다. <Link to="/cases/new">고장파형 등록</Link>의 'AI가 보류한 실제 사례'에서 직접 올려 볼 수 있습니다.
          </p>
        </div>
        <div>
          <strong className="small">학습에 없던 실제 사건 {u.total}건 (고장이 아닌 사건 포함)</strong>
          <ul className="small" style={{ margin: '6px 0 0 16px' }}>
            <li>{u.excluded_too_short}건: 기록이 짧아 분석 구간을 채울 수 없어 제외 (값을 채워 넣지 않음)</li>
            {u.cases.map((c) => (
              <li key={c.case_id}>
                {UNKNOWN_KIND_KO[c.kind] ?? c.kind}:{' '}
                {c.status === 'ok' ? (
                  <>
                    <Badge tone="err">{c.answered_label} 로 확신 있게 오답</Badge> <span className="muted">실패 사례로 기록</span>
                  </>
                ) : (
                  <>
                    <Badge tone="ok">보류</Badge> <span className="muted">{c.reasons.map((r) => REASON_SHORT[r] ?? r).join(', ')}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ marginTop: 6 }}>학습 데이터에 정상·개폐 같은 고장이 아닌 사건이 없어서 생긴 한계입니다. 한전 데이터에 이런 사건이 포함되면 따로 학습할 수 있습니다.</p>
        </div>
      </div>

      <details className="fa-details" style={{ marginTop: 12 }}>
        <summary>함께 알아야 할 한계 · 출처</summary>
        <ul className="small">{card.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        <div className="xs muted" style={{ marginTop: 6 }}>
          데이터: <a href={card.model.dataset.source} target="_blank" rel="noreferrer">{card.model.dataset.title}</a> ({card.model.dataset.license}) · {card.data.n}건 · 학습 {card.split.train} / 검증 {card.split.val} / 시험 {card.split.test}
          <br />
          판단 기준: 1순위 점수 ≥ {card.thresholds.score} · 1·2위 차 ≥ {card.thresholds.margin} · 학습 범위 밖 특징 ≤ {Math.round(card.thresholds.ood_ratio * 100)}% (검증용 교차검증에서 정함, 시험 세트는 보지 않음)
          <br />
          <span className="mono">{Object.entries(card.model.versions).map(([k, v]) => `${k} ${v}`).join(' · ')}</span>
        </div>
      </details>
    </Section>
  )
}
