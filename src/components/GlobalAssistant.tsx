import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../api'
import type { AnyCase, CaseSummary } from '../types'
import AssistantChat from './AssistantChat'
import { IconX } from './Icons'
import { Segmented } from './ui'
import VillageStatusChat from './VillageStatusChat'

type Mode = 'case' | 'village'

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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // 현장용 화면은 이미 대화 화면 전체라 버튼을 숨김
  if (pathname.startsWith('/field/')) return null

  const current = c && c.id === caseId ? c : null

  return (
    <>
      {!open && (
        <button type="button" className="ga-fab" onClick={() => setOpen(true)} aria-label="AI 도우미 열기">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
            <path d="M9 11.5h.01M12 11.5h.01M15 11.5h.01" strokeWidth="2.6" />
          </svg>
          <span>AI</span>
        </button>
      )}
      {open && (
        <section className="ga-panel" role="dialog" aria-label="AI 도우미">
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
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen(false)} aria-label="닫기"><IconX /></button>
          </header>

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
        </section>
      )}
    </>
  )
}
