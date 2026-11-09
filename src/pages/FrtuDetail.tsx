import { Link } from 'react-router-dom'
import { CsvAnalysis, LiveWave } from '../components/AiPanel'
import AssistantChat from '../components/AssistantChat'
import EventCausePanel from '../components/EventCausePanel'
import { IconChevron } from '../components/Icons'
import { Badge, NODE_TONE, Status } from '../components/ui'
import { DEVICE_INFO, IOT_CHANNELS, STATUS_LABEL, THRESHOLDS, useVillage } from '../lib/village'
import { useVillageEvents } from '../lib/villageEvents'

function Bar({ value, tone }: { value: number; tone: 'ok' | 'warn' | 'err' }) {
  return <div className="meter"><i className={tone} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} /></div>
}

/** FRTU 상세: 파형 추이 · AI 판단 근거 · CSV 고장파형 분석 · 대화 도우미 */
export default function FrtuDetail() {
  const snap = useVillage()
  const events = useVillageEvents()
  const last = events[0]
  const v = last?.verdict
  const alarm = ['WARNING', 'FAULT', 'OUTAGE'].includes(snap.status)
  const scoreTone = snap.score >= THRESHOLDS.fault ? 'err' : snap.score >= THRESHOLDS.warn ? 'warn' : 'ok'
  const ratio = snap.expected > 0 ? snap.i / snap.expected : 0
  const suspects = snap.diagnosis?.candidates.map((id) => snap.leds[id].name).join(', ')
  const on = IOT_CHANNELS.filter((c) => snap.leds[c.id].channelOn)
  // 화면에 보이는 값만으로 만든 근거 문장 (지어내지 않음)
  const reasons = !snap.connected
    ? ['실측 장치와 연결이 끊겨 판단할 계측값이 없어요.']
    : [
        `지금 켜 둔 LED는 ${on.length}개(${on.map((c) => c.name).join(', ') || '없음'})예요.`,
        `측정 전류 ${(snap.i * 1000).toFixed(1)} mA, 이 조합의 정상 전류 ${(snap.expected * 1000).toFixed(1)} mA로 ${Math.round(ratio * 100)}%예요.`,
        `전압은 ${snap.v.toFixed(2)} V예요${snap.v < THRESHOLDS.vMin ? ` (기준 ${THRESHOLDS.vMin} V 아래)` : ''}.`,
        `이상 점수 ${snap.score.toFixed(2)}로 ${snap.score >= THRESHOLDS.fault ? '이상' : snap.score >= THRESHOLDS.warn ? '주의' : '정상'} 범위예요 (주의 ${THRESHOLDS.warn} · 이상 ${THRESHOLDS.fault}).`,
        ...(snap.diagnosis ? [`${snap.diagnosis.kind === 'LOW' ? '켠 LED 중 전류가 안 흐르는 것이 있어요' : '예상보다 전류가 많아요'}${suspects ? ` · 의심: ${suspects}` : ''}.`] : []),
      ]

  return (
    <div className="dash frtu">
      <div className="crumb-row">
        <Link to="/village?ai=1" className="dash-back-icon" aria-label="마을로"><IconChevron /></Link>
        <span className="muted">마을 시뮬레이션</span><span className="muted">›</span><span>마을 인입 FRTU</span>
      </div>
      <div className="dash-head">
        <div>
          <h1>마을 인입 FRTU</h1>
          <p>배전자동화 단말장치 · {DEVICE_INFO[snap.source].sensor} · 0.5초 간격 계측</p>
        </div>
        <Status tone={NODE_TONE[snap.status]} live={alarm}><strong>{STATUS_LABEL[snap.status]}</strong></Status>
      </div>

      <div className="dash-cols">
        <div className="stack" style={{ gap: 20 }}>
          <section className="dash-card">
            <div className="dash-card-head"><h2>파형 추이</h2><span className="small muted">최근 1분</span></div>
            <LiveWave snap={snap} />
          </section>

          <section className="dash-card">
            <div className="dash-card-head"><h2>AI 판단</h2><span className="small muted">{last ? `사건 #${last.e.ev} 기준` : '사건 대기 중'}</span></div>
            <div className="judge-row">
              <div className="judge">
                <span>현재 상태</span>
                <Badge tone={NODE_TONE[snap.status]}>{STATUS_LABEL[snap.status]}</Badge>
              </div>
              <div className="judge">
                <span>이상 점수</span>
                <strong>{snap.score.toFixed(2)}</strong>
              </div>
              <div className="judge">
                <span>의심 위치</span>
                <strong>{suspects || '없음'}</strong>
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

        <div className="stack" style={{ gap: 20 }}>
          <section className="dash-card">
            <div className="dash-card-head"><h2>정보</h2></div>
            <div className="info-box">
              <span>현재 전류</span>
              <strong>{(snap.i * 1000).toFixed(1)} mA</strong>
              <Bar value={ratio / 1.5} tone={Math.abs(ratio - 1) > 0.3 ? 'err' : 'ok'} />
              <small>예상 {(snap.expected * 1000).toFixed(1)} mA 대비 {Math.round(ratio * 100)}%</small>
            </div>
            <div className="info-box">
              <span>이상 점수</span>
              <strong>{Math.round(snap.score * 100)}%</strong>
              <Bar value={snap.score} tone={scoreTone} />
              <small>주의 {THRESHOLDS.warn} · 이상 {THRESHOLDS.fault} 기준</small>
            </div>
            <dl className="kv info-kv">
              <div><dt>전압</dt><dd>{snap.v.toFixed(2)} V</dd></div>
              <div><dt>전력</dt><dd>{snap.p.toFixed(2)} W</dd></div>
              <div><dt>켜진 LED</dt><dd>{IOT_CHANNELS.filter((c) => snap.leds[c.id].lit).length} / 5</dd></div>
              <div><dt>마을 전원</dt><dd>{snap.relay ? '켜짐' : '차단'}</dd></div>
              <div><dt>장치</dt><dd>{snap.connected ? DEVICE_INFO[snap.source].deviceId : '연결 끊김'}</dd></div>
              <div><dt>기록된 사건</dt><dd>{events.length}건</dd></div>
            </dl>
          </section>

          <section className="dash-card">
            <div className="dash-card-head"><h2>AI 도우미</h2><span className="small muted">글 또는 음성</span></div>
            <AssistantChat />
          </section>
        </div>
      </div>
    </div>
  )
}
