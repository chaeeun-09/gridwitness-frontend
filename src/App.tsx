import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { IconAnalysis, IconDashboard, IconDatabase, IconHistory, IconLive, IconLogo, IconMenu, IconSettings, IconVillage } from './components/Icons'
import { Dot, PageSkeleton } from './components/ui'
import { useActor } from './lib/actor'
import { DEVICE_INFO, useVillage } from './lib/village'
import CaseDetail from './pages/CaseDetail'
import CaseList from './pages/CaseList'
import Dashboard from './pages/Dashboard'
import LiveData from './pages/LiveData'
import NewCase from './pages/NewCase'
import PublicData from './pages/PublicData'
import Settings from './pages/Settings'

const Village = lazy(() => import('./pages/Village'))

const NAV: { label: string; items: { to: string; label: string; icon: ReactNode; end?: boolean }[] }[] = [
  {
    label: '모니터링',
    items: [
      { to: '/', label: '개요', icon: <IconDashboard />, end: true },
      { to: '/village', label: '스마트 마을', icon: <IconVillage /> },
      { to: '/live', label: '실시간 분석', icon: <IconLive /> },
    ],
  },
  {
    label: '분석',
    items: [
      { to: '/cases', label: '고장파형 분석', icon: <IconAnalysis /> },
      { to: '/public-data', label: '공공데이터 분석', icon: <IconDatabase /> },
    ],
  },
  {
    label: '관리',
    items: [
      { to: '/history', label: '사건·검토 이력', icon: <IconHistory /> },
      { to: '/settings', label: '설정', icon: <IconSettings /> },
    ],
  },
]

/** 사이드바 하단: 데이터 출처와 연결 상태를 한 곳에서만 보여줌 */
function DeviceStatus() {
  const snap = useVillage()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const ago = snap.lastPacketAt ? Math.max(0, Math.round((now - snap.lastPacketAt) / 1000)) : null
  const live = snap.connected && ago !== null && ago < 3
  return (
    <Link to="/settings" className="device-status" title="데이터 출처 설정">
      <Dot tone={live ? 'ok' : snap.connected ? 'warn' : 'err'} live={live} />
      <strong>{snap.source === 'MOCK' ? 'Mock 시뮬레이터' : '실측 장치'}</strong>
      <span>
        {snap.connected ? DEVICE_INFO[snap.source].deviceId : '연결 끊김'}
        {ago !== null && snap.connected && ` · ${ago}초 전`}
      </span>
    </Link>
  )
}

function Shell() {
  const [actor] = useActor()
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setNavOpen(false), [location.pathname])
  const wide = location.pathname === '/village'

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''}`}>
      <aside className="sidebar no-print" aria-label="주 메뉴">
        <Link to="/" className="brand">
          <span className="brand-mark"><IconLogo /></span>
          <span className="brand-name">GridWitness</span>
        </Link>
        <nav>
          {NAV.map((g) => (
            <div key={g.label} className="side-group">
              <div className="side-label">{g.label}</div>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className="side-link">
                  {n.icon}
                  <span>{n.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <DeviceStatus />
          <div className="side-user">{actor}</div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <div className="main">
        <div className="mobile-bar no-print">
          <button className="btn btn-ghost btn-icon" onClick={() => setNavOpen(true)} aria-label="메뉴 열기">
            <IconMenu />
          </button>
          <span className="brand-name">GridWitness</span>
        </div>
        <main key={location.pathname} className={`page ${wide ? 'wide' : ''}`}>
          <Suspense fallback={<PageSkeleton />}>
            <Routes location={location}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/village" element={<Village />} />
              <Route path="/live" element={<LiveData />} />
              <Route path="/cases" element={<CaseList mode="waveform" />} />
              <Route path="/cases/new" element={<NewCase />} />
              <Route path="/cases/:id" element={<CaseDetail />} />
              <Route path="/public-data" element={<PublicData />} />
              <Route path="/history" element={<CaseList mode="all" />} />
              <Route path="/history/:id" element={<CaseDetail />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Shell />
    </BrowserRouter>
  )
}
