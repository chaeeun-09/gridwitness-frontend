import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { Empty, ErrorState, Metric, Metrics, NODE_TONE, PageHeader, Section, Segmented, Status, TableSkeleton } from '../components/ui'
import { fmtTime } from '../lib/actor'
import { DEFAULT_THRESHOLDS, DEVICE_INFO, resetThresholds, setThresholds, SOURCE_LABEL, STATUS_LABEL, TICK_MS, useVillage } from '../lib/village'
import { CASE_TYPE_LABEL, type ActivityItem, type CaseSummary, type CaseType } from '../types'

type Role = 'ADMIN' | 'ANALYST' | 'VIEWER'
const ROLE_LABEL: Record<Role, string> = { ADMIN: '관리자', ANALYST: '분석 담당', VIEWER: '열람 전용' }
const ROLE_NOTE: Record<Role, string> = {
  ADMIN: '기준 변경, 사용자·데이터 관리, 모든 검토',
  ANALYST: '파형 등록·분석, 사건 검토 기록',
  VIEWER: '화면 조회만 (등록·검토 불가)',
}
const USERS_KEY = 'gridwitness.admin.users.v1'
const DEFAULT_USERS: { name: string; part: string; role: Role }[] = [
  { name: '박채은', part: '팀장 · AI·IoT·DevOps', role: 'ADMIN' },
  { name: '배순우', part: '프론트엔드', role: 'ANALYST' },
  { name: '정종윤', part: '백엔드', role: 'ANALYST' },
  { name: '분석 담당자', part: '기본 작업자 이름', role: 'ANALYST' },
]

function loadUsers() {
  try {
    const raw = JSON.parse(localStorage.getItem(USERS_KEY) ?? 'null') as typeof DEFAULT_USERS | null
    if (Array.isArray(raw) && raw.length) return raw
  } catch {
    // 저장값을 못 읽으면 기본 목록
  }
  return DEFAULT_USERS
}

/** 슬라이더 + 숫자 + 설명이 한 줄인 설정 항목 */
function Setting({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div>
        <div className="strong">{label}</div>
        <div className="small muted">{hint}</div>
      </div>
      <div className="setting-ctl">{children}</div>
    </div>
  )
}

export default function Admin() {
  const snap = useVillage()
  const [cases, setCases] = useState<CaseSummary[] | null>(null)
  const [activity, setActivity] = useState<ActivityItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'ALL' | CaseType>('ALL')
  const [users, setUsers] = useState(loadUsers)
  const [saved, setSaved] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const th = snap.thresholds

  const load = useCallback(() => {
    setError(null)
    Promise.all([api.listCases(), api.listActivity()])
      .then(([c, a]) => {
        setCases(c)
        setActivity(a)
      })
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const flash = (msg: string) => {
    setSaved(msg)
    setTimeout(() => setSaved(null), 2200)
  }

  function changeRole(name: string, role: Role) {
    const next = users.map((u) => (u.name === name ? { ...u, role } : u))
    setUsers(next)
    try {
      localStorage.setItem(USERS_KEY, JSON.stringify(next))
    } catch {
      // 저장 불가 환경은 무시
    }
    flash(`${name} 권한을 '${ROLE_LABEL[role]}'(으)로 바꿨습니다.`)
  }

  async function exportAll() {
    const all = await api.exportCases()
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), note: '이 브라우저에 보관된 사건 (서버 기록 중 목록에 있는 것)', cases: all }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `gridwitness-cases-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    flash(`사건 ${all.length}건을 내보냈습니다.`)
  }

  const pending = cases?.filter((c) => c.stage !== 'REVIEWED').length ?? 0
  const openEvents = snap.events.filter((e) => !e.clearedAt).length
  const lastBy = useMemo(() => {
    const m = new Map<string, string>()
    activity?.forEach((a) => !m.has(a.actor) && m.set(a.actor, a.at))
    return m
  }, [activity])
  const filtered = activity?.filter((a) => filter === 'ALL' || a.caseType === filter)
  const shown = more ? filtered : filtered?.slice(0, 12)
  const thInvalid = th.warn >= th.fault
  const changed = th.warn !== DEFAULT_THRESHOLDS.warn || th.fault !== DEFAULT_THRESHOLDS.fault || th.vMin !== DEFAULT_THRESHOLDS.vMin

  return (
    <>
      <PageHeader title="관리자" description="이상 탐지 기준, 사용자 권한, 활동 기록, 데이터를 관리합니다. 시연 버전이라 로그인과 권한 검사는 연결되어 있지 않습니다." actions={saved && <span className="small" style={{ color: 'var(--ok)' }} role="status">{saved}</span>} />

      <Metrics>
        <Metric label="장치" value={<Status tone={snap.connected ? 'ok' : 'err'} live={snap.connected}><span style={{ fontSize: 20, fontWeight: 600 }}>{snap.connected ? '연결됨' : '끊김'}</span></Status>} foot={`${SOURCE_LABEL[snap.source]} · ${DEVICE_INFO[snap.source].deviceId}`} />
        <Metric label="마을 상태" value={<Status tone={NODE_TONE[snap.status]}><span style={{ fontSize: 20, fontWeight: 600 }}>{STATUS_LABEL[snap.status]}</span></Status>} foot={`수신 ${snap.packets.toLocaleString()}회 · ${1000 / TICK_MS} Hz`} />
        <Metric label="진행 중 이상" value={openEvents} unit="건" foot={`누적 ${snap.events.length}건`} />
        <Metric label="검토 대기 사건" value={cases ? pending : '–'} unit="건" foot={cases ? `전체 ${cases.length}건` : ' '} />
      </Metrics>

      <div className="split section">
        <Section title="이상 탐지 기준" description="바꾸면 바로 실시간 판정과 새 사건에 적용됩니다. 이 브라우저에 저장됩니다." actions={changed && <button className="btn btn-sm" onClick={() => { resetThresholds(); flash('기본값으로 되돌렸습니다.') }}>기본값</button>}>
          <div className="stack" style={{ gap: 0 }}>
            <Setting label="주의 기준 (이상 점수)" hint="이 점수 이상이면 '주의'로 표시">
              <input type="range" min={0.05} max={0.95} step={0.05} value={th.warn} onChange={(e) => setThresholds({ warn: Number(e.target.value) })} aria-label="주의 기준" />
              <b className="num">{th.warn.toFixed(2)}</b>
            </Setting>
            <Setting label="이상 기준 (이상 점수)" hint="이 점수 이상이면 '이상'으로 표시하고 이벤트 기록">
              <input type="range" min={0.1} max={1} step={0.05} value={th.fault} onChange={(e) => setThresholds({ fault: Number(e.target.value) })} aria-label="이상 기준" />
              <b className="num">{th.fault.toFixed(2)}</b>
            </Setting>
            <Setting label="전압 하한 (V)" hint="릴레이가 닫혀 있는데 이 전압 아래면 점수 상승">
              <input type="range" min={4} max={5} step={0.05} value={th.vMin} onChange={(e) => setThresholds({ vMin: Number(e.target.value) })} aria-label="전압 하한" />
              <b className="num">{th.vMin.toFixed(2)}</b>
            </Setting>
          </div>
          {thInvalid && <div className="alert alert-err" role="alert">주의 기준({th.warn.toFixed(2)})이 이상 기준({th.fault.toFixed(2)})보다 작아야 합니다. 이 상태로는 저장되지 않습니다.</div>}
          <p className="hint">현재 이상 점수 <b className="num">{snap.score.toFixed(2)}</b> → {STATUS_LABEL[snap.status]} · 기준을 너무 낮추면 정상 변동도 이상으로 기록됩니다.</p>
        </Section>

        <Section title="사용자와 권한" description="실제 로그인은 연결되어 있지 않습니다.">
          <div className="table-wrap">
            <table>
              <thead><tr><th>이름</th><th>역할</th><th>최근 활동</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.name}>
                    <td><span className="strong">{u.name}</span><div className="xs muted">{u.part}</div></td>
                    <td>
                      <select value={u.role} onChange={(e) => changeRole(u.name, e.target.value as Role)} aria-label={`${u.name} 역할`} title={ROLE_NOTE[u.role]}>
                        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </td>
                    <td className="small muted num">{lastBy.get(u.name) ? fmtTime(lastBy.get(u.name)!) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="dl-rows" style={{ marginTop: 14 }}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <div key={r}><dt>{ROLE_LABEL[r]}</dt><dd className="small">{ROLE_NOTE[r]}</dd></div>
            ))}
          </dl>
        </Section>
      </div>

      <Section
        title="활동 기록"
        description="모든 사건의 등록·진단·분석·검토 이력을 최신순으로 봅니다."
        actions={
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'ALL', label: '전체' }, { value: 'IOT', label: 'IoT' }, { value: 'WAVEFORM', label: '고장파형' }]} />
        }
      >
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !shown ? (
          <TableSkeleton rows={5} />
        ) : shown.length === 0 ? (
          <Empty compact title="기록이 없습니다" description="사건을 등록하거나 검토하면 여기에 쌓입니다." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>시각</th><th>작업자</th><th>작업</th><th>사건</th></tr></thead>
              <tbody>
                {shown.map((a, k) => (
                  <tr key={`${a.caseId}-${a.at}-${k}`}>
                    <td className="small muted num" style={{ whiteSpace: 'nowrap' }}>{fmtTime(a.at)}</td>
                    <td>{a.actor}</td>
                    <td>
                      <span className="strong">{a.action}</span>
                      {a.detail && <div className="xs muted">{a.detail}</div>}
                    </td>
                    <td>
                      <Link to={`/${a.caseType === 'IOT' ? 'history' : 'cases'}/${a.caseId}`}>{a.caseTitle}</Link>
                      <div className="xs muted">{CASE_TYPE_LABEL[a.caseType]} · <span className="mono">{a.caseId}</span></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered && filtered.length > 12 && (
              <div style={{ textAlign: 'center', paddingTop: 12 }}>
                <button className="btn btn-sm" onClick={() => setMore(!more)}>{more ? '접기' : `더 보기 (${filtered.length - 12}건)`}</button>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="데이터 관리" description="등록·진단·분석·검토 기록은 서버에 남고, 원본 파형은 등록한 브라우저에 보관됩니다.">
        <div className="cluster">
          <button className="btn" onClick={exportAll} disabled={!cases?.length}>사건 전체 내보내기 (JSON)</button>
          <Link to="/settings" className="btn btn-ghost">목록 비우기 (설정)</Link>
        </div>
      </Section>
    </>
  )
}
