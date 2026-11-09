import { useSearchParams } from 'react-router-dom'
import { CsvAnalysis, FaultLocationBox, FrtuStrip, LiveWave } from '../components/AiPanel'
import VillageStatusChat from '../components/VillageStatusChat'
import { LiveAnalysis } from './LiveData'
import EventCausePanel from '../components/EventCausePanel'
import { Badge, NODE_TONE, Status } from '../components/ui'
import { FI_LABEL, frtuViews, isFrtuId, type FrtuId } from '../lib/frtu'
import { DEVICE_INFO, IOT_CHANNELS, STATUS_LABEL, THRESHOLDS, useVillage } from '../lib/village'
import { useVillageEvents } from '../lib/villageEvents'

type Tab = 'overview' | 'live'
const TABS: [Tab, string][] = [
  ['overview', 'FRTU 요약'],
  ['live', '실시간 분석'],
]

function Bar({ value, tone }: { value: number; tone: 'ok' | 'warn' | 'err' }) {
  return <div className="meter"><i className={tone} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} /></div>
}

/** FRTU 상세: FRTU 3대(인입·주택 분기·가로등 분기) 중 하나를 골라 파형 추이 · 고장표시 · 고장 구간 · 대화 도우미 */
export default function FrtuDetail() {
  const [params, setParams] = useSearchParams()
  const id: FrtuId = isFrtuId(params.get('id')) ? (params.get('id') as FrtuId) : 'inlet'
  const tab: Tab = params.get('tab') === 'live' ? 'live' : 'overview'
  const setQuery = (next: { id?: FrtuId; tab?: Tab }) => {
    const q: Record<string, string> = {}
    const nid = next.id ?? id
    const ntab = next.tab ?? tab
    if (nid !== 'inlet') q.id = nid
    if (ntab !== 'overview') q.tab = ntab
    setParams(q, { replace: true })
  }
  const pick = (next: FrtuId) => setQuery({ id: next })
  const snap = useVillage()
  const events = useVillageEvents()
  const f = frtuViews(snap)[id]
  const last = events[0]
  const v = last?.verdict
  const alarm = f.fi !== 'NONE' || ['WARNING', 'FAULT', 'OUTAGE'].includes(f.status)
  const scoreTone = f.score >= THRESHOLDS.fault ? 'err' : f.score >= THRESHOLDS.warn ? 'warn' : 'ok'
  const ratio = f.expected > 0 ? f.i / f.expected : 0
  const suspects = id === 'inlet' ? snap.diagnosis?.candidates.map((c) => snap.leds[c].name).join(', ') : undefined
  const mine = IOT_CHANNELS.filter((c) => f.def.channels.includes(c.id))
  const on = mine.filter((c) => snap.leds[c.id].channelOn)
  // 화면에 보이는 값만으로 만든 근거 문장 (지어내지 않음)
  const reasons = !f.available
    ? [f.unavailableReason ?? '계측값이 없어요.']
    : [
        `이 FRTU가 맡은 LED 중 켜 둔 것은 ${on.length}개(${on.map((c) => c.name).join(', ') || '없음'})예요.`,
        `측정 전류 ${(f.i * 1000).toFixed(1)} mA, 정상 전류 ${(f.expected * 1000).toFixed(1)} mA로 ${Math.round(ratio * 100)}%예요.`,
        `전압은 ${f.v.toFixed(2)} V예요${f.v < THRESHOLDS.vMin ? ` (기준 ${THRESHOLDS.vMin} V 아래)` : ''}.`,
        `이상 점수 ${f.score.toFixed(2)} → 고장표시: ${FI_LABEL[f.fi]} (주의 ${THRESHOLDS.warn} · 이상 ${THRESHOLDS.fault}).`,
        ...(suspects ? [`조합표 판정 · 의심: ${suspects}.`] : []),
      ]

  return (
    <div className="dash frtu">
      <div className="dash-head">
        <div>
          <h1>{f.def.name}</h1>
          <p>{f.def.role} FRTU · {f.def.sensor} · 0.5초 간격 계측</p>
        </div>
        <Status tone={f.fi !== 'NONE' ? 'err' : NODE_TONE[f.status]} live={alarm}><strong>{STATUS_LABEL[f.status]}</strong></Status>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setQuery({ tab: k })}>{label}</button>
        ))}
      </div>

      {tab === 'live' ? (
        <div className="tab-panel"><LiveAnalysis /></div>
      ) : (
      <>
      <section className="dash-card frtu-overview">
        <FrtuStrip snap={snap} value={id} onPick={pick} />
        <FaultLocationBox snap={snap} />
        <p className="xs muted">
          마을 모형의 INA219 두 개를 분기 FRTU로, 그 합을 인입 FRTU로 보여줘요. 분기가 병렬 두 갈래라 &lsquo;어느 분기인지&rsquo;까지만 좁힐 수 있고, 직류 계측이라 교류 고장파형 분석과는 섞지 않아요.
        </p>
      </section>

      <div className="dash-cols">
        <div className="stack" style={{ gap: 14 }}>
          <section className="dash-card">
            <div className="dash-card-head"><h2>파형 추이</h2><span className="small muted">최근 1분</span></div>
            <LiveWave snap={snap} frtu={id} />
          </section>

          <section className="dash-card">
            <div className="dash-card-head"><h2>AI 판단</h2><span className="small muted">{last ? `사건 #${last.e.ev} 기준` : '사건 대기 중'}</span></div>
            <div className="judge-row">
              <div className="judge">
                <span>현재 상태</span>
                <Badge tone={NODE_TONE[f.status]}>{STATUS_LABEL[f.status]}</Badge>
              </div>
              <div className="judge">
                <span>고장표시</span>
                <strong>{FI_LABEL[f.fi]}</strong>
              </div>
              <div className="judge">
                <span>이상 점수</span>
                <strong>{f.score.toFixed(2)}</strong>
              </div>
              <div className="judge">
                <span>마지막 사건 판정</span>
                <strong>{!v ? '—' : v.kind === 'ANSWERED' ? v.labelKo : v.kind === 'WITHHELD' ? '보류' : v.kind === 'NO_MODEL' ? '모델 학습 전' : '입력 거부'}</strong>
              </div>
            </div>
            {v && (v.kind === 'ANSWERED' || v.kind === 'WITHHELD') && (
              <div className="evidence">
                <div className="small muted" style={{ marginBottom: 8 }}>판단 근거 (기여도 큰 순)</div>
                {v.evidence.map((e) => (
                  <div key={e.name} className="evidence-row">
                    <span>{e.label}</span>
                    <div className="meter"><i className={e.contribution >= 0 ? 'ok' : 'err'} style={{ width: `${Math.min(100, Math.abs(e.contribution) * 300)}%` }} /></div>
                    <span className="num small">{e.value.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
            <h3 className="ai-h">판단 근거</h3>
            <ul className="reasons">
              {reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
            <div style={{ marginTop: 16 }}><EventCausePanel /></div>
          </section>

          <section className="dash-card">
            <div className="dash-card-head"><h2>CSV 고장파형 분석</h2><span className="small muted">교류 7채널 파형을 넣으면 AI가 분석</span></div>
            <CsvAnalysis />
          </section>
        </div>

        <div className="stack" style={{ gap: 14 }}>
          <section className="dash-card">
            <div className="dash-card-head"><h2>정보</h2></div>
            <div className="info-box">
              <span>측정 전류</span>
              <strong>{(f.i * 1000).toFixed(1)} mA</strong>
              <Bar value={ratio / 1.5} tone={Math.abs(ratio - 1) > 0.3 ? 'err' : 'ok'} />
              <small>예상 {(f.expected * 1000).toFixed(1)} mA 대비 {Math.round(ratio * 100)}%</small>
            </div>
            <div className="info-box">
              <span>이상 점수</span>
              <strong>{Math.round(f.score * 100)}%</strong>
              <Bar value={f.score} tone={scoreTone} />
              <small>주의 {THRESHOLDS.warn} · 이상 {THRESHOLDS.fault} 기준</small>
            </div>
            <dl className="kv info-kv">
              <div><dt>전압</dt><dd>{f.v.toFixed(2)} V</dd></div>
              <div><dt>전력</dt><dd>{(f.v * f.i).toFixed(2)} W</dd></div>
              <div><dt>맡은 LED</dt><dd>{mine.filter((c) => snap.leds[c.id].lit).length} / {mine.length} 켜짐</dd></div>
              <div><dt>마을 전원</dt><dd>{snap.relay ? '켜짐' : '차단'}</dd></div>
              <div><dt>값 출처</dt><dd>{f.def.measured ? '실측' : '두 분기의 합 (계산값)'}</dd></div>
              <div><dt>장치</dt><dd>{snap.connected ? DEVICE_INFO[snap.source].deviceId : '연결 끊김'}</dd></div>
            </dl>
          </section>

          <section className="dash-card">
            <div className="dash-card-head"><h2>상태 도우미</h2><span className="small muted">글 또는 음성 · 조회 전용</span></div>
            <VillageStatusChat />
          </section>
        </div>
      </div>
      </>
      )}
    </div>
  )
}
