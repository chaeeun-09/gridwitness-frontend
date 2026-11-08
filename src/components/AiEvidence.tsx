import { featureLabel, METHOD_LABEL, REASON_SHORT } from '../lib/aiExplain'
import type { AiDetail } from '../types'

const f2 = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d))

/** 기준과 비교한 한 줄: 값이 기준을 통과했는지 */
function Gate({ label, value, limit, pass, note }: { label: string; value: string; limit: string; pass: boolean; note: string }) {
  return (
    <li className="ai-gate">
      <span className={`ai-gate-dot ${pass ? 'ok' : 'bad'}`} aria-hidden />
      <span className="ai-gate-label">{label}</span>
      <span className="num">{value}</span>
      <span className="muted small">기준 {limit} · {note}</span>
    </li>
  )
}

/** AI가 이렇게 판단한(또는 보류한) 이유: 판단 기준 통과 여부 + 점수를 움직인 특징 */
export default function AiEvidence({ ai, compact }: { ai: AiDetail; compact?: boolean }) {
  const th = ai.thresholds
  const answered = ai.status === 'ok'
  const feats = ai.topFeatures.slice(0, compact ? 3 : 6)
  const maxAbs = Math.max(...feats.map((f) => Math.abs(f.contribution)), 1e-9)
  const hasGates = ai.topScore != null && th.score != null
  return (
    <div className="fa-card">
      <div className="fa-card-head">
        <strong>{answered ? 'AI가 이렇게 판단한 이유' : 'AI가 보류한 이유'}</strong>
        <span className="small muted">서버 AI 원문</span>
      </div>

      {hasGates && (
        <>
          <div className="small muted" style={{ marginBottom: 6 }}>판단 기준 (셋 다 통과해야 답함)</div>
          <ul className="ai-gates">
            <Gate label="1순위 점수" value={f2(ai.topScore)} limit={`≥ ${f2(th.score)}`} pass={(ai.topScore ?? 0) >= th.score} note="충분히 뚜렷한가" />
            {th.margin != null && <Gate label="1·2위 점수 차" value={f2(ai.margin)} limit={`≥ ${f2(th.margin)}`} pass={(ai.margin ?? 0) >= th.margin} note="두 유형을 가를 수 있는가" />}
            {th.ood_ratio != null && <Gate label="학습 범위 밖 특징" value={`${Math.round((ai.oodRatio ?? 0) * 100)}%`} limit={`≤ ${Math.round(th.ood_ratio * 100)}%`} pass={(ai.oodRatio ?? 0) <= th.ood_ratio} note="배운 적 있는 파형인가" />}
          </ul>
          {!answered && ai.reasonCodes.length > 0 && (
            <p className="small" style={{ margin: '8px 0 0' }}>
              <strong>보류 사유:</strong> {ai.reasonCodes.map((c) => REASON_SHORT[c] ?? c).join(' · ')}
            </p>
          )}
        </>
      )}

      {feats.length > 0 && (
        <>
          <div className="small muted" style={{ margin: '14px 0 6px' }}>
            {answered ? `${ai.topLabel ?? '판단한 유형'} 점수를 움직인 파형 특징` : '1순위 후보 점수를 움직인 파형 특징 (답이 아님, 참고용)'}
          </div>
          <ul className="ai-feats">
            {feats.map((f) => (
              <li key={f.name}>
                <span className="ai-feat-name" title={f.name}>{featureLabel(f.name)}</span>
                <span className="ai-feat-bar">
                  <i className={f.contribution >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(f.contribution) / maxAbs) * 50}%` }} />
                </span>
                <span className="num small">{f.contribution >= 0 ? '+' : '−'}{Math.abs(f.contribution).toFixed(3)}</span>
              </li>
            ))}
          </ul>
          {!compact && <p className="hint">{METHOD_LABEL[ai.method] ?? ai.method}. 막대 오른쪽(+)은 점수를 올림, 왼쪽(−)은 내림.</p>}
        </>
      )}
    </div>
  )
}
