import { BrowserRouter, useLocation } from 'react-router-dom'
import { Shell } from './AppShell'
import Landing from './pages/Landing'

/** 소개 화면(/)은 사이드바 없이, 나머지는 앱 셸 안에서 */
function Root() {
  const { pathname } = useLocation()
  return pathname === '/' ? <Landing /> : <Shell />
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Root />
    </BrowserRouter>
  )
}
