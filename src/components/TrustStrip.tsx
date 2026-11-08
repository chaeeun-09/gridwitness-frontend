import { REASON_SHORT } from '../lib/aiExplain'
import { VERDICT_LABEL, type IncidentCase } from '../types'

type Tone = 'ok' | 'warn' | 'err' | 'off'
type Tab = 'analysis' | 'diagnosis' | 'review' | 'source'

interface Item {
  title: string
  value: string
  sub: string
  tone: Tone
  tab: Tab
}

/** 사건 하나가 '믿고 쓸 수 있는 분석' 절차를 어디까지 거쳤는지 한 줄로 보여준다. 값은 모두 이 사건의 실제 기록에서 읽는다 */
export default function TrustStrip({ c, onGo }: { c: IncidentCase; onGo: (t: Tab) => void }) {
  const d = c.diagnosis
  const a = c.analysis
  const ai = a?.ai
  const reasons = ai?.reasonCodes ?? []
  const domainOut = reasons.some((r) => r === 'DOMAIN_MISMATCH' || r === 'DOMAIN_MODEL_MISSING' || r === 'OUT_OF_DISTRIBUTION')
  const last = c.reviews[c.reviews.length - 1]
  const items: Item[] = [
    {
      title: '① 입력 검사',
      value: d.status === 'ACCEPTED' ? '통과' : d.status === 'LIMITED' ? '제한 통과' : '거부',
      sub: `${d.issues.length ? `확인할 점 ${d.issues.length}건` : '문제 없음'}`,
      tone: d.status === 'ACCEPTED' ? 'ok' : d.status === 'LIMITED' ? 'warn' : 'err',
      tab: 'diagnosis',
    },
    {
      title: '② 분석 범위',
      value: !a ? '확인 전' : !ai ? '모델 미실행' : domainOut ? '범위 밖' : '범위 안',
      sub: ai?.modelCountry ? `${ai.modelCountry} 모델 · ${ai.versions.contract ?? ''}` : d.status === 'REJECTED' ? '거부된 입력' : '—',
      tone: !a || !ai ? 'off' : domainOut ? 'warn' : 'ok',
      tab: 'analysis',
    },
    {
      title: '③ AI 판단',
      value: !a ? '실행 전' : a.kind === 'COMPLETED' ? `${a.predictedLabel} 로 답함` : '보류',
      sub: a?.kind === 'WITHHELD' ? (reasons.map((r) => REASON_SHORT[r] ?? r).join(' · ') || a.reasons[0] || '') : a?.kind === 'COMPLETED' ? '판단 기준 3개 통과' : '—',
      tone: !a ? 'off' : a.kind === 'COMPLETED' ? 'ok' : 'warn',
      tab: 'analysis',
    },
    {
      title: '④ 근거',
      value: ai?.topFeatures.length ? `특징 ${ai.topFeatures.length}개` : '없음',
      sub: ai?.method === 'treeshap' ? 'TreeSHAP 기여도' : ai?.method ? '간이 계산' : '—',
      tone: ai?.topFeatures.length ? 'ok' : 'off',
      tab: 'analysis',
    },
    {
      title: '⑤ 기록',
      value: `SHA-256 ${c.source.sha256.slice(0, 8)}…`,
      sub: a ? `${a.modelVersion ?? '모델 없음'} · ${a.preprocessVersion ?? ''}` : '분석 전',
      tone: 'ok',
      tab: 'source',
    },
    {
      title: '⑥ 사람 검토',
      value: last ? VERDICT_LABEL[last.verdict] : '대기',
      sub: last ? `${last.reviewer} · ${c.reviews.length}건` : 'AI 결과는 확정이 아님',
      tone: last ? 'ok' : 'off',
      tab: 'review',
    },
  ]
  return (
    <div className="trust-strip no-print" aria-label="분석 신뢰 절차">
      {items.map((it) => (
        <button key={it.title} className={`trust-item ${it.tone}`} onClick={() => onGo(it.tab)} title={`${it.title}: ${it.value} — ${it.sub}`}>
          <span className="t-head">{it.title}</span>
          <span className="t-val">{it.value}</span>
          <span className="t-sub">{it.sub}</span>
        </button>
      ))}
    </div>
  )
}
