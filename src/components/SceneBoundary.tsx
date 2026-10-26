import { Component, type ReactNode } from 'react'

/** 3D 장면에서 오류가 나면 빈 화면 대신 안내와 다시 시도 버튼을 보여줌 */
export default class SceneBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="empty error" style={{ height: '100%', border: 0, borderRadius: 0, justifyContent: 'center' }} role="alert">
        <div className="empty-title">3D 장면을 불러오지 못했습니다</div>
        <p className="empty-desc">{this.state.error.message}</p>
        <button className="btn" onClick={() => location.reload()}>새로고침</button>
      </div>
    )
  }
}
