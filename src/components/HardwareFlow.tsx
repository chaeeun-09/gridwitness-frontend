import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { buildIotCase } from '../api/iotCase'
import { Steps } from '../components/Badges'
import IssueList from '../components/IssueList'
import Sparkline from '../components/Sparkline'
import { Badge, DIAG_LABEL, DIAG_TONE, Metric, Metrics, NODE_TONE, Section, Status } from '../components/ui'
import { getActor } from '../lib/actor'
import { DEVICE_INFO, IOT_MODEL, LED_A, linkEventToCase, setRelay, STATUS_LABEL, useVillage, type VillageEvent } from '../lib/village'
import type { IotPoint } from '../types'

// 실제 하드웨어 분석 흐름:
//   시나리오 실행(릴레이 차단) → LED 소등 → INA219 측정값 변화 → 이상 사건 등록 → 입력 적합성 검사 → DC 데이터라 AI 고장파형 분석 보류
// 모형에는 릴레이가 하나뿐이라 웹에서 실행할 수 있는 실물 시나리오는 "마을 전체 전원 차단 → 복구"다.

const STEPS = ['장치 연결', '시나리오 실행', 'LED 소등', 'INA219 변화', '사건 등록', '적합성 검사', 'AI 분석 판단']
const BASELINE_SAMPLES = 4
const HOLD_MS = 6000
const RECOVER_SAMPLES = 4
const SETTLE_MS = 1500

type Phase = 'idle' | 'baseline' | 'cutting' | 'holding' | 'restoring' | 'recovering' | 'done' | 'failed'
interface Run {
  phase: Phase
  startedAt: number
  cutAt: number
  holdAt: number
  restoreAt: number
  recoverAt: number
  error: string | null
}
const L = { textAlign: 'left' } as const
const IDLE: Run = { phase: 'idle', startedAt: 0, cutAt: 0, holdAt: 0, restoreAt: 0, recoverAt: 0, error: null }

const PHASE_TEXT: Record<Phase, string> = {
  idle: '대기 중',
  baseline: '차단 전 기준값 측정 중…',
  cutting: '릴레이 차단 명령 전송, 장치 응답 대기 중…',
  holding: '전원 차단 상태 측정 중…',
  restoring: '릴레이 복구 명령 전송, 장치 응답 대기 중…',
  recovering: '복구 후 측정 중…',
  done: '시나리오 완료',
  failed: '시나리오 중단',
}
const RUNNING: Phase[] = ['baseline', 'cutting', 'holding', 'restoring', 'recovering']

interface Avg {
  v: number
  i: number
  p: number
  leds: number
}
const avg = (pts: IotPoint[]): Avg => {
  const n = Math.max(1, pts.length)
  const v = pts.reduce((s, x) => s + x.v, 0) / n
  const i = pts.reduce((s, x) => s + x.i, 0) / n
  return { v, i, p: v * i, leds: Math.max(0, Math.min(5, Math.round(i / LED_A))) }
}

interface Result {
  window: IotPoint[]
  before: Avg
  during: Avg
  after: Avg
  cutAt: number
  restoreAt: number
}

export default function HardwareFlow() {
  const snap = useVillage()
  const nav = useNavigate()
  const [run, setRun] = useState<Run>(IDLE)
  const [result, setResult] = useState<Result | null>(null)
  const [caseId, setCaseId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = run.phase

  const real = snap.source === 'SERIAL'
  const live = snap.connected && snap.status !== 'NO_DATA'
  const running = RUNNING.includes(run.phase)
  const canStart = live && snap.relay && snap.relayPending === null && !running

  function fail(message: string) {
    if (phaseRef.current === 'cutting' || phaseRef.current === 'holding' || phaseRef.current === 'restoring') setRelay(true)
    setRun((r) => ({ ...r, phase: 'failed', error: message }))
  }

  function start() {
    setResult(null)
    setCaseId(null)
    setError(null)
    setRun({ ...IDLE, phase: 'baseline', startedAt: Date.now() })
  }

  // 화면을 벗어나도 전원이 꺼진 채로 남지 않게 함
  useEffect(() => {
    return () => {
      const p = phaseRef.current
      if (p === 'cutting' || p === 'holding' || p === 'restoring') setRelay(true)
    }
  }, [])

  // 계측이 들어올 때마다 시나리오를 한 단계씩 진행
  useEffect(() => {
    if (!RUNNING.includes(run.phase)) return
    const now = Date.now()
    if (!snap.connected || snap.status === 'NO_DATA') {
      fail('장치 수신이 끊겨 시나리오를 중단했습니다.')
      return
    }
    const since = (t: number) => now - t
    if (run.phase === 'baseline') {
      if (snap.history.filter((h) => h.t >= run.startedAt).length >= BASELINE_SAMPLES) {
        setRelay(false)
        setRun({ ...run, phase: 'cutting', cutAt: now })
      }
    } else if (run.phase === 'cutting') {
      if (!snap.relay && snap.relayPending === null) setRun({ ...run, phase: 'holding', holdAt: now })
      else if (since(run.cutAt) > 5000) fail('릴레이 차단 명령을 장치가 확인하지 않았습니다.')
    } else if (run.phase === 'holding') {
      if (since(run.holdAt) >= HOLD_MS) {
        setRelay(true)
        setRun({ ...run, phase: 'restoring', restoreAt: now })
      }
    } else if (run.phase === 'restoring') {
      if (snap.relay && snap.relayPending === null) setRun({ ...run, phase: 'recovering', recoverAt: now })
      else if (since(run.restoreAt) > 5000) fail('릴레이 복구 명령을 장치가 확인하지 않았습니다.')
    } else if (run.phase === 'recovering') {
      const after = snap.history.filter((h) => h.t >= run.recoverAt + SETTLE_MS)
      if (after.length >= RECOVER_SAMPLES) {
        const window: IotPoint[] = snap.history.filter((h) => h.t >= run.startedAt).map(({ p: _p, ...h }) => h)
        setResult({
          window,
          before: avg(window.filter((h) => h.t < run.cutAt).slice(-BASELINE_SAMPLES)),
          during: avg(window.filter((h) => h.t >= run.holdAt + SETTLE_MS && h.t < run.restoreAt)),
          after: avg(window.filter((h) => h.t >= run.recoverAt + SETTLE_MS)),
          cutAt: run.cutAt,
          restoreAt: run.restoreAt,
        })
        setRun({ ...run, phase: 'done' })
      }
    }
    // 계측 패킷이 갱신될 때만 진행
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.packets, run.phase])

  const event = useMemo<VillageEvent | null>(() => {
    if (!result) return null
    const { before, during, after } = result
    const where = real ? '실측 INA219' : '시뮬레이터'
    return {
      id: Date.now() % 1_000_000_000,
      source: snap.source,
      label: `전원 차단 시험 (${where})`,
      at: new Date(result.cutAt).toISOString(),
      injected: null,
      injectedAt: new Date(result.cutAt).toISOString(),
      status: 'OUTAGE',
      maxScore: Math.min(1, Math.max(0, (before.i - during.i) / (LED_A * 2))),
      relayOn: false,
      expected: before.i,
      window: result.window,
      clearedAt: new Date(result.restoreAt).toISOString(),
      caseId: null,
      notes: [
        '시험 시나리오입니다. 웹에서 릴레이(D2)로 마을 전체 전원을 의도적으로 차단했다가 복구했습니다.',
        `차단 전 ${before.v.toFixed(2)} V · ${before.i.toFixed(3)} A(LED 약 ${before.leds}개) → 차단 중 ${during.v.toFixed(2)} V · ${during.i.toFixed(3)} A(LED 약 ${during.leds}개) → 복구 후 ${after.v.toFixed(2)} V · ${after.i.toFixed(3)} A(LED 약 ${after.leds}개)`,
      ],
    }
  }, [result, real, snap.source])

  // 등록 전에 미리 보는 입력 적합성 검사 (사건 등록 때와 같은 규칙)
  const diagnosis = useMemo(() => (event ? buildIotCase(event, getActor(), 'PREVIEW').diagnosis : null), [event])

  async function register() {
    if (!event) return
    setBusy(true)
    setError(null)
    try {
      const c = await api.registerIotEvent({ event, actor: getActor() })
      linkEventToCase(event.id, c.id)
      setCaseId(c.id)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const done = !live ? 0 : caseId ? 7 : result ? 4 : running ? 2 : 1
  const dropped = result ? result.before.leds - result.during.leds : 0
  const info = DEVICE_INFO[snap.source]

  return (
    <>
      <div className="section">
        <h2 className="page-title" style={{ fontSize: 18 }}>하드웨어 분석 흐름</h2>
        <p className="page-desc">모형에서 전원 차단 시나리오를 실행하고, LED와 INA219 측정값 변화를 사건으로 남긴 뒤, 입력 적합성 검사와 AI 분석 판단까지 순서대로 확인합니다.</p>
      </div>

      <Steps steps={STEPS} done={done} />

      <Section
        title="① 장치 연결"
        description="실측 장치를 연결하면 실제 LED가 꺼지고 INA219가 잰 값으로 분석합니다."
        actions={<Status tone={live ? 'ok' : 'err'} live={live}>{live ? '수신 중' : snap.connected ? '데이터 없음' : '끊김'}</Status>}
      >
        {!real && (
          <div className="alert alert-warn" style={{ marginBottom: 16 }}>
            <span>
              지금은 <strong>시뮬레이터</strong> 값입니다. 실제 LED는 꺼지지 않고 사건 기록에도 시뮬레이터로 남습니다. Chrome·Edge에서 <Link to="/settings">설정 → 데이터 출처</Link>의 <strong>실측 장치</strong>로 Arduino를 연결하세요.
            </span>
          </div>
        )}
        <dl className="dl-rows">
          <div><dt>데이터 출처</dt><dd>{real ? '실측 장치' : '시뮬레이터'} · {info.deviceId}</dd></div>
          <div><dt>센서</dt><dd>{info.sensor} · 마을 전체의 전압·전류만 측정</dd></div>
          <div><dt>릴레이</dt><dd>{snap.relay ? '닫힘 — 전원 공급 중' : '열림 — 마을 전체 차단'}</dd></div>
        </dl>
        <Metrics cols={4}>
          <Metric label="전압" value={snap.v.toFixed(2)} unit="V" />
          <Metric label="전류" value={snap.i.toFixed(3)} unit="A" />
          <Metric label="전력" value={snap.p.toFixed(2)} unit="W" />
          <Metric label="켜진 LED (추정)" value={snap.estLit} unit="/ 5" foot="전체 전류 ÷ LED 1개 정격" />
        </Metrics>
      </Section>

      <Section
        title="② 시나리오 실행: 전원 차단 → 복구"
        description={`릴레이 하나로 마을 전체 전원을 ${HOLD_MS / 1000}초간 차단했다가 자동으로 복구합니다. LED별 고장은 모형에서 만들 수 없어 시뮬레이터에서만 실행됩니다.`}
        actions={
          <button className="btn btn-primary" onClick={start} disabled={!canStart}>
            {running ? '실행 중…' : result ? '다시 실행' : '시나리오 실행'}
          </button>
        }
      >
        {!snap.relay && !running && live && (
          <div className="alert alert-warn"><span>릴레이가 열려 있습니다. 먼저 스마트 마을에서 <Link to="/village">전력 복구</Link>를 누르세요.</span></div>
        )}
        <div className="row gap" style={{ marginTop: 4 }}>
          <Status tone={run.phase === 'failed' ? 'err' : run.phase === 'done' ? 'ok' : running ? 'accent' : 'off'} live={running}>
            {PHASE_TEXT[run.phase]}
          </Status>
          {running && <span className="small muted">화면을 벗어나면 전원을 자동으로 복구합니다.</span>}
        </div>
        {run.error && <div className="alert alert-err" style={{ marginTop: 12 }}>{run.error}</div>}
      </Section>

      {result && event && diagnosis && (
        <>
          <Section title="③ LED 소등과 INA219 측정값 변화" description="차단 전 · 차단 중 · 복구 후의 평균값입니다.">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>구간</th><th>전압</th><th>전류</th><th>전력</th><th>켜진 LED (추정)</th></tr>
                </thead>
                <tbody>
                  {([['차단 전', result.before], ['차단 중', result.during], ['복구 후', result.after]] as const).map(([name, a]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num" style={L}>{a.v.toFixed(2)} V</td>
                      <td className="num" style={L}>{a.i.toFixed(3)} A</td>
                      <td className="num" style={L}>{a.p.toFixed(2)} W</td>
                      <td className="num" style={L}>{a.leds} / 5</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid-2" style={{ marginTop: 20 }}>
              <div>
                <div className="small muted" style={{ marginBottom: 4 }}>전류 (A)</div>
                <Sparkline values={result.window.map((p) => p.i)} minSpan={0.1} height={56} />
              </div>
              <div>
                <div className="small muted" style={{ marginBottom: 4 }}>전압 (V)</div>
                <Sparkline values={result.window.map((p) => p.v)} minSpan={0.5} height={56} />
              </div>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
              {dropped > 0 ? `전류가 LED ${dropped}개 분량 줄었습니다.` : '전류 변화가 작습니다. 릴레이와 배선을 확인하세요.'} INA219가 1개라 어느 LED가 꺼졌는지는 구분하지 않습니다.
              {real && result.during.i > 0.03 ? ' 차단했는데도 전류가 흐릅니다. 릴레이 접점 고착이나 우회 배선을 확인하세요.' : ''}
            </p>
          </Section>

          <Section
            title="④ 이상 사건 등록"
            description="계측 기록을 DC 그대로 IoT 사건으로 저장합니다. 교류 파형으로 바꾸지 않습니다."
            actions={
              caseId ? (
                <button className="btn btn-primary" onClick={() => nav(`/cases/${caseId}`)}>사건 열기 · {caseId}</button>
              ) : (
                <button className="btn btn-primary" onClick={register} disabled={busy}>{busy ? '등록 중…' : '이상 사건 등록'}</button>
              )
            }
          >
            <dl className="dl-rows">
              <div><dt>제목</dt><dd>{event.label}</dd></div>
              <div><dt>판정</dt><dd><Status tone={NODE_TONE[event.status]}>{STATUS_LABEL[event.status]}</Status> <span className="muted">· 시험용으로 의도해서 만든 차단입니다</span></dd></div>
              <div><dt>기록 구간</dt><dd className="num">{result.window.length}개 샘플</dd></div>
            </dl>
            {error && <div className="alert alert-err" style={{ marginTop: 12 }}>{error}</div>}
          </Section>

          <Section
            title="⑤ GridWitness 입력 적합성 검사"
            description="등록할 계측 기록이 분석에 쓸 수 있는 상태인지 확인합니다."
            actions={<Badge tone={DIAG_TONE[diagnosis.status]}>{DIAG_LABEL[diagnosis.status]}</Badge>}
          >
            <IssueList issues={diagnosis.issues} />
            {diagnosis.issues.length === 0 && <p className="muted" style={{ margin: 0 }}>발견된 문제가 없습니다.</p>}
          </Section>

          <Section
            title="⑥ AI 고장파형 분석 판단"
            description="이 기록은 5V DC 계측이라 교류 고장파형 모델의 입력 조건과 맞지 않습니다."
            actions={<Badge tone="warn">분석 보류</Badge>}
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>항목</th><th>이 기록 (IoT)</th><th>고장파형 모델 입력</th></tr>
                </thead>
                <tbody>
                  <tr><td>전기 종류</td><td>DC 5V</td><td>AC 계통 50 Hz</td></tr>
                  <tr><td>채널</td><td>전압·전류 2개 (마을 전체)</td><td>Ia Ib Ic In Va Vb Vc 7채널</td></tr>
                  <tr><td>측정 주기</td><td>0.5초마다 1회</td><td>4096 Hz</td></tr>
                  <tr><td>길이</td><td className="num" style={L}>{result.window.length}개 샘플</td><td>1312개 샘플</td></tr>
                </tbody>
              </table>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>
              그래서 고장파형 4종 분류(SIF·MIF·PF·TD)는 실행하지 않고 보류합니다. 이 기록은 별개 모델인 <strong>{IOT_MODEL}</strong>로 판단하고, 사람이 검토합니다.
            </p>
          </Section>
        </>
      )}
    </>
  )
}
