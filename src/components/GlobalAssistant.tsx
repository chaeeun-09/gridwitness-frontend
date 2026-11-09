import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../api'
import { ASSISTANT_OPEN_EVENT, PANEL_OPEN_EVENT } from '../lib/panels'
import type { AnyCase, CaseSummary } from '../types'
import AssistantChat from './AssistantChat'
import { CaseBriefSide, VillageLiveSide } from './AssistantSide'
import { IconX } from './Icons'
import { Segmented } from './ui'
import VillageStatusChat from './VillageStatusChat'

type Mode = 'case' | 'village'
const FULL_KEY = 'gridwitness.assistant.full.v1'

/** 화면 어디서나 여는 AI 도우미.
 *  - 사건 화면에서는 그 사건의 현장 대응 AI (교류 고장파형 분석 기록)
 *  - 마을·FRTU·실시간 화면에서는 마을 상태 도우미 (모형 DC 계측, 조회 전용)
 *  - 그 밖의 화면에서는 검토가 남은 최근 사건부터 고르게 함
 *  두 데이터는 섞지 않고, 패널 위에 지금 무엇에 대해 묻는지 항상 보여준다. */
export default function GlobalAssistant() {
  const { pathname } = useLocation()
  const caseMatch = /^\/cases\/([^/]+)$/.exec(pathname)
  const routeCaseId = caseMatch && caseMatch[1] !== 'new' ? decodeURIComponent(caseMatch[1]) : null
  const villageRoute = /^\/(village|frtu|live)/.test(pathname)
  const defaultMode: Mode = villageRoute ? 'village' : 'case'

  const [open, setOpen] = useState(false)
  // 전체화면으로 크게 보기 (마지막 선택을 기억)
  const [full, setFullState] = useState(() => {
    try {
      return localStorage.getItem(FULL_KEY) === '1'
    } catch {
      return false
    }
  })
  const setFull = (on: boolean) => {
    setFullState(on)
    try {
      localStorage.setItem(FULL_KEY, on ? '1' : '0')
    } catch {
      // 저장 못 해도 화면에서는 동작
    }
  }
  const [mode, setMode] = useState<Mode>(defaultMode)
  const [list, setList] = useState<CaseSummary[] | null>(null)
  const [pickId, setPickId] = useState<string | null>(null)
  const [c, setC] = useState<AnyCase | null>(null)
  const [error, setError] = useState<string | null>(null)
  const caseId = routeCaseId ?? pickId

  // 화면이 바뀌면 그 화면에 맞는 대상으로
  const [lastPath, setLastPath] = useState(pathname)
  if (lastPath !== pathname) {
    setLastPath(pathname)
    setMode(defaultMode)
  }

  // 사건을 직접 골라야 하는 화면: 목록을 불러와 검토가 남은 최근 고장파형 사건을 기본으로
  useEffect(() => {
    if (!open || mode !== 'case' || routeCaseId || list) return
    api
      .listCases()
      .then((all) => {
        const wave = all.filter((x) => x.caseType === 'WAVEFORM')
        setList(wave)
        setPickId((p) => p ?? (wave.find((x) => x.stage !== 'REVIEWED') ?? wave[0])?.id ?? null)
      })
      .catch((e: Error) => setError(e.message))
  }, [open, mode, routeCaseId, list])

  useEffect(() => {
    if (!open || mode !== 'case' || !caseId) return
    let alive = true
    api
      .getCase(caseId)
      .then((x) => alive && (setC(x), setError(null)))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [open, mode, caseId])

  useEffect(() => {
    if (!open) return
    // Esc: 전체화면이면 먼저 작게, 아니면 닫기
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (full) setFull(false)
      else setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, full])

  // 화면의 다른 패널(FRTU 요약·제어판 등)이 열리면 AI 패널은 접는다
  useEffect(() => {
    const onPanel = () => setOpen(false)
    window.addEventListener(PANEL_OPEN_EVENT, onPanel)
    return () => window.removeEventListener(PANEL_OPEN_EVENT, onPanel)
  }, [])

  function openAssistant() {
    setOpen(true)
    // 화면에 떠 있던 카드 패널은 내려가게 알림
    window.dispatchEvent(new Event(ASSISTANT_OPEN_EVENT))
  }

  // 현장용 화면은 이미 대화 화면 전체라 버튼을 숨김
  if (pathname.startsWith('/field/')) return null

  const current = c && c.id === caseId ? c : null

  return (
    <>
      {!open && (
        <button type="button" className="ga-fab" onClick={openAssistant} aria-label="AI 도우미 열기">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
            <path d="M9 11.5h.01M12 11.5h.01M15 11.5h.01" strokeWidth="2.6" />
          </svg>
          <span>AI</span>
        </button>
      )}
      {open && (
        <section className={`ga-panel ${full ? 'full' : ''}`} role="dialog" aria-label="AI 도우미" aria-modal={full || undefined}>
          <header className="ga-head">
            <strong>AI 도우미</strong>
            <Segmented
              className="ga-mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'case', label: '사건 분석' },
                { value: 'village', label: '마을 상태' },
              ]}
            />
            <button type="button" className="btn btn-ghost btn-sm ga-size" onClick={() => setFull(!full)} aria-label={full ? '작은 창으로 보기' : '전체화면으로 보기'} title={full ? '작은 창으로 (Esc)' : '전체화면으로'}>
              {full ? (
                // 대각선 화살표가 안쪽으로: 작은 창
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /></svg>
              ) : (
                // 대각선 화살표가 바깥으로: 전체화면
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
              )}
              <span>{full ? '작은 창' : '전체화면'}</span>
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen(false)} aria-label="닫기"><IconX /></button>
          </header>

          <div className={full ? 'ga-full' : 'ga-plain'}>
          {full && (
            <aside className="ga-side" aria-label={mode === 'village' ? '마을 FRTU 실시간 계측' : '사건 분석 근거'}>
              {mode === 'village' ? (
                <VillageLiveSide />
              ) : current && current.caseType === 'WAVEFORM' ? (
                <CaseBriefSide c={current} />
              ) : (
                <div className="ga-empty muted">사건을 고르면 분석 근거가 여기에 보여요.</div>
              )}
            </aside>
          )}
          <div className="ga-chatcol">
          {mode === 'case' && (
            <div className="ga-target">
              {routeCaseId ? (
                <span className="small muted">지금 보고 있는 사건</span>
              ) : list && list.length > 0 ? (
                <select value={pickId ?? ''} onChange={(e) => setPickId(e.target.value)} aria-label="질문할 사건">
                  {list.map((x) => <option key={x.id} value={x.id}>{x.stage === 'REVIEWED' ? '' : '● '}{x.title} · {x.id}</option>)}
                </select>
              ) : null}
              {caseId && !routeCaseId && <Link to={`/cases/${caseId}`} className="small" onClick={() => setOpen(false)}>사건 열기 →</Link>}
            </div>
          )}

          <div className="ga-body">
            {mode === 'village' ? (
              <VillageStatusChat />
            ) : error ? (
              <div className="ga-empty">{error}</div>
            ) : list && list.length === 0 && !routeCaseId ? (
              <div className="ga-empty">질문할 고장파형 사건이 없어요. <Link to="/cases/new" onClick={() => setOpen(false)}>고장파형 등록 →</Link></div>
            ) : !current ? (
              <div className="ga-empty muted">사건을 불러오는 중…</div>
            ) : current.caseType !== 'WAVEFORM' ? (
              <div className="ga-empty">
                이 사건은 마을 모형의 직류 계측 기록이라 사건 분석 AI에 연결하지 않아요.
                <button type="button" className="btn btn-sm" onClick={() => setMode('village')}>마을 상태 도우미로</button>
              </div>
            ) : (
              <AssistantChat key={current.id} c={current} variant="popup" />
            )}
          </div>
          </div>
          </div>
        </section>
      )}
    </>
  )
}
