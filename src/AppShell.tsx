import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { IconAnalysis, IconDashboard, IconShieldCheck, IconDatabase, IconLive, IconLogo, IconMenu, IconBolt, IconSettings, IconVillage } from './components/Icons'
import { Dot, PageSkeleton } from './components/ui'
import { useActor } from './lib/actor'
import { useBackendHealth } from './lib/backend'
import { connectSerial, DEVICE_INFO, useVillage } from './lib/village'
import CaseDetail from './pages/CaseDetail'
import CaseList from './pages/CaseList'
import Dashboard from './pages/Dashboard'
import Admin from './pages/Admin'
import LiveData from './pages/LiveData'
import NewCase from './pages/NewCase'
import PublicData from './pages/PublicData'
import Settings from './pages/Settings'
import VillageLoads from './pages/VillageLoads'

const Village = lazy(() => import('./pages/Village'))
const City = lazy(() => import('./pages/City'))

const NAV: { label: string; items: { to: string; label: string; icon: ReactNode; end?: boolean }[] }[] = [
  {
    label: '모니터링',
    items: [
      { to: '/dashboard', label: '대시보드', icon: <IconDashboard /> },
      { to: '/village', label: '마을 시뮬레이션', icon: <IconVillage /> },
      { to: '/live', label: '실시간 분석', icon: <IconLive /> },
      { to: '/city', label: '도시 시뮬레이션', icon: <IconBolt /> },
    ],
  },
  {
    label: '분석',
    items: [
      { to: '/cases', label: '사건 기록', icon: <IconAnalysis /> },
      { to: '/public-data', label: '공공데이터 분석', icon: <IconDatabase /> },
    ],
  },
  {
    label: '관리',
    items: [
      { to: '/admin', label: '관리자', icon: <IconShieldCheck /> },
      { to: '/settings', label: '설정', icon: <IconSettings /> },
    ],
  },
]

/** 예전 주소(/history/:id)로 들어와도 사건 화면으로 보냄 */
function HistoryRedirect() {
  const { id = '' } = useParams()
  return <Navigate to={`/cases/${id}`} replace />
}

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
  const health = useBackendHealth()
  return (
    <>
    <Link to="/settings" className="device-status" title="분석 서버 설정">
      <Dot tone={health.state === 'ok' ? 'ok' : health.state === 'down' ? 'err' : 'warn'} />
      <strong>분석 서버</strong>
      <span>{health.state === 'ok' ? '서버 정상' : health.state === 'down' ? '연결 안 됨' : '확인 중'}</span>
    </Link>
    <Link to="/settings" className="device-status" title="데이터 출처 설정">
      <Dot tone={live ? 'ok' : snap.connected ? 'warn' : 'err'} live={live} />
      <strong>{snap.source === 'MOCK' ? '시뮬레이터' : '실측 장치'}</strong>
      <span>
        {snap.connected ? DEVICE_INFO[snap.source].deviceId : '연결 끊김'}
        {ago !== null && snap.connected && ` · ${ago}초 전`}
      </span>
    </Link>
    </>
  )
}

/** 실측 장치 연결이 끊겼을 때 어느 화면에서든 한 번에 다시 연결하는 배너 */
function ReconnectBanner() {
  const snap = useVillage()
  const [busy, setBusy] = useState(false)
  if (snap.source !== 'SERIAL' || snap.connected || !snap.reconnecting) return null
  async function connect() {
    setBusy(true)
    try {
      await connectSerial()
    } catch {
      // 포트 선택 창을 닫은 경우 등은 그대로 둠
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="alert alert-warn reconnect-banner no-print" role="status">
      <span>
        <strong>실측 장치 연결이 끊겼습니다.</strong>{' '}
        {snap.needsGrant ? '이 브라우저는 이전에 허용한 포트를 기억하지 못해 새로고침하면 한 번 다시 허용해야 합니다.' : 'USB를 꽂으면 자동으로 다시 연결합니다.'}{' '}
        <button className="btn btn-sm btn-primary" onClick={connect} disabled={busy}>{busy ? '포트 선택 중…' : '다시 연결'}</button>
      </span>
    </div>
  )
}

/** 대시보드 위에 떠 있는 메뉴 (누르면 펼쳐짐) */
function FloatingMenu({ actor }: { actor: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="float-menu no-print">
      <button className="float-menu-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="brand-mark"><IconLogo /></span>
        <span>GridWitness</span>
        <IconMenu />
      </button>
      {open && (
        <div className="float-menu-pop" onClick={() => setOpen(false)}>
          {NAV.map((g) => (
            <div key={g.label} className="float-group">
              <div className="float-label">{g.label}</div>
              {g.items.map((n) => (
                <NavLink key={n.to} to={n.to} className="float-link">{n.icon}<span>{n.label}</span></NavLink>
              ))}
            </div>
          ))}
          <div className="float-foot">
            <DeviceStatus />
            <div className="side-user">{actor}</div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 앱 화면 틀(사이드바 + 페이지). 소개 화면의 노트북에도 같은 것을 씀 */
export function Shell({ extraRoutes }: { extraRoutes?: ReactNode } = {}) {
  const [actor] = useActor()
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setNavOpen(false), [location.pathname])
  const wide = location.pathname === '/city'
  // 대시보드(마을 시뮬)는 사이드바 없이 화면 전체를 쓰고, 메뉴는 왼쪽 위 떠 있는 버튼으로
  const immersive = location.pathname === '/village'

  return (
    <div className={`app ${navOpen ? 'nav-open' : ''} ${immersive ? 'immersive' : ''}`}>
      {immersive && <FloatingMenu actor={actor} />}
      <aside className="sidebar no-print" aria-label="주 메뉴">
        <Link to="/" className="brand" title="소개 화면">
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
        <ReconnectBanner />
        <main key={location.pathname} className={`page ${wide ? 'wide' : ''}`}>
          <Suspense fallback={<PageSkeleton />}>
            <Routes location={location}>
              {extraRoutes}
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/village" element={<Village />} />
              <Route path="/village/loads" element={<VillageLoads />} />
              <Route path="/live" element={<LiveData />} />
              <Route path="/city" element={<City />} />
              <Route path="/cases" element={<CaseList />} />
              <Route path="/cases/new" element={<NewCase />} />
              <Route path="/cases/:id" element={<CaseDetail />} />
              <Route path="/public-data" element={<PublicData />} />
              <Route path="/history" element={<Navigate to="/cases" replace />} />
              <Route path="/history/:id" element={<HistoryRedirect />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
}

