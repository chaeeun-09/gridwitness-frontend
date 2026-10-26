import type { DiagnosisIssue } from '../types'
import { Dot } from './ui'

const SEV: Record<DiagnosisIssue['severity'], [string, 'err' | 'warn' | 'off']> = {
  error: ['오류', 'err'],
  warning: ['경고', 'warn'],
  info: ['안내', 'off'],
}

/** 입력 검사·데이터 점검 결과 목록 */
export default function IssueList({ issues }: { issues: DiagnosisIssue[] }) {
  return (
    <ul className="issues">
      {issues.map((i, k) => {
        const [label, tone] = SEV[i.severity]
        return (
          <li key={k} className="issue">
            <span className={`issue-sev ${i.severity}`}>
              <Dot tone={tone} />
              {label}
            </span>
            <div>
              <div>
                {i.message}
                <span className="issue-code">{i.code}</span>
              </div>
              {i.fix && <div className="issue-fix">{i.fix}</div>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
