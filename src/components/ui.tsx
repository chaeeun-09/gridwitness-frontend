import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { NodeStatus } from '../lib/village'
import type { CaseStage, DiagnosisStatus } from '../types'
import { IconAlert, IconChevron, IconInbox } from './Icons'

// 화면 공통 구성요소. 스타일 규칙은 index.css의 디자인 토큰을 따름.

export type Tone = 'ok' | 'warn' | 'err' | 'off' | 'accent' | 'neutral'

export function PageHeader({
  title,
  description,
  actions,
  crumbs,
  meta,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  crumbs?: { label: string; to?: string }[]
  meta?: ReactNode
}) {
  return (
    <header className="page-head">
      <div style={{ minWidth: 0 }}>
        {crumbs && (
          <nav className="crumbs" aria-label="위치">
            {crumbs.map((c, k) => (
              <span key={k} className="row gap" style={{ gap: 6 }}>
                {k > 0 && <IconChevron />}
                {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
        {meta && <div className="page-meta">{meta}</div>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  )
}

export function Section({
  title,
  description,
  actions,
  children,
  style,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  style?: CSSProperties
}) {
  return (
    <section className="section" style={style}>
      {(title || actions) && (
        <div className="section-head">
          <div>
            {title && <h2 className="section-title">{title}</h2>}
            {description && <p className="section-desc">{description}</p>}
          </div>
          {actions && <div className="section-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function Metrics({ children, cols = 4 }: { children: ReactNode; cols?: number }) {
  return (
    <div className="metrics" style={{ '--cols': cols } as CSSProperties}>
      {children}
    </div>
  )
}

export function Metric({ label, value, unit, foot, small, children }: { label: ReactNode; value: ReactNode; unit?: string; foot?: ReactNode; small?: boolean; children?: ReactNode }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${small ? 'sm' : ''}`}>
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
      {foot && <div className="metric-foot">{foot}</div>}
      {children}
    </div>
  )
}

export function Dot({ tone, live }: { tone: Tone; live?: boolean }) {
  return <span className={`dot ${tone} ${live ? 'live' : ''}`} aria-hidden />
}

export function Status({ tone, children, live }: { tone: Tone; children: ReactNode; live?: boolean }) {
  return (
    <span className={`status ${tone}`}>
      <Dot tone={tone} live={live} />
      {children}
    </span>
  )
}

export function Badge({ tone = 'neutral', children, outline }: { tone?: Tone; children: ReactNode; outline?: boolean }) {
  return <span className={`badge ${tone} ${outline ? 'outline' : ''}`}>{children}</span>
}

// ── 도메인 상태 → 색 ───────────────────────────────────
export const NODE_TONE: Record<NodeStatus, Tone> = { NORMAL: 'ok', OFF: 'off', WARNING: 'warn', FAULT: 'err', OUTAGE: 'err', NO_DATA: 'off' }
export const DIAG_TONE: Record<DiagnosisStatus, Tone> = { ACCEPTED: 'ok', LIMITED: 'warn', REJECTED: 'err' }
export const DIAG_LABEL: Record<DiagnosisStatus, string> = { ACCEPTED: '정상', LIMITED: '제한', REJECTED: '거부' }
export const STAGE_INFO: Record<CaseStage, [string, Tone]> = {
  REGISTERED: ['등록됨', 'neutral'],
  DIAGNOSED: ['진단 완료', 'neutral'],
  ANALYZED: ['검토 대기', 'accent'],
  WITHHELD: ['추가 확인 필요', 'warn'],
  REVIEWED: ['검토 완료', 'ok'],
}

// ── 빈 화면·오류·로딩 ───────────────────────────────────
export function Empty({ icon, title, description, action, compact }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'compact' : ''}`}>
      <div className="empty-icon">{icon ?? <IconInbox />}</div>
      <div className="empty-title">{title}</div>
      {description && <p className="empty-desc">{description}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty error" role="alert">
      <div className="empty-icon"><IconAlert /></div>
      <div className="empty-title">불러오지 못했습니다</div>
      <p className="empty-desc">{message}</p>
      {onRetry && <button className="btn" onClick={onRetry}>다시 시도</button>}
    </div>
  )
}

export function Skeleton({ w = '100%', h = 14, style }: { w?: number | string; h?: number; style?: CSSProperties }) {
  return <div className="skeleton" style={{ width: w, height: h, ...style }} />
}

/** 표 형태 화면의 로딩 자리 */
export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, k) => (
        <div key={k} className="row" style={{ gap: 24, padding: '14px 0', borderBottom: '1px solid var(--line)' }}>
          <Skeleton w={120} />
          <Skeleton w={`${30 + ((k * 17) % 30)}%`} />
          <span className="spacer" />
          <Skeleton w={64} />
        </div>
      ))}
    </div>
  )
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="불러오는 중">
      <Skeleton w={220} h={26} />
      <Skeleton w={360} h={14} style={{ marginTop: 12 }} />
      <div style={{ marginTop: 36 }}>
        <TableSkeleton rows={4} />
      </div>
    </div>
  )
}

export function Switch({ on, pending, disabled, onToggle, label }: { on: boolean; pending?: boolean; disabled?: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`switch ${on ? 'on' : ''} ${pending ? 'pending' : ''}`}
      disabled={disabled || pending}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <span />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange, className = '' }: { value: T; options: { value: T; label: ReactNode; disabled?: boolean }[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={`seg ${className}`} role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} disabled={o.disabled} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
