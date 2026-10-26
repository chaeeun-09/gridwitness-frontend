import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { fmtTime, getActor } from '../lib/actor'
import { linkEventToCase, STATUS_LABEL, type VillageEvent } from '../lib/village'
import { IconShield } from './Icons'
import { Dot, Empty, NODE_TONE } from './ui'

/** IoT 이상 이벤트 목록. 사건으로 등록하면 DC 계측 기록 그대로 IoT 사건이 됨 (고장파형으로 바꾸지 않음). */
export default function EventList({ events, limit = 6 }: { events: VillageEvent[]; limit?: number }) {
  const nav = useNavigate()
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function register(e: VillageEvent) {
    setBusy(e.id)
    setError(null)
    try {
      const c = await api.registerIotEvent({ event: e, actor: getActor() })
      linkEventToCase(e.id, c.id)
      nav(`/history/${c.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (events.length === 0) {
    return <Empty compact icon={<IconShield />} title="감지된 이상이 없습니다" description="이상 점수가 주의 기준(0.3)을 넘으면 여기에 기록됩니다." />
  }
  return (
    <>
      {error && <div className="alert alert-err">{error}</div>}
      <ul className="list">
        {events.slice(0, limit).map((e) => (
          <li key={e.id} className="list-item">
            <Dot tone={e.clearedAt ? 'off' : NODE_TONE[e.status]} live={!e.clearedAt} />
            <div className="list-main">
              <span className="list-title">
                마을 전력 {STATUS_LABEL[e.status]}
              </span>
              <span className="list-sub num">
                {fmtTime(e.at)} · 최대 점수 {e.maxScore.toFixed(2)} · {e.clearedAt ? '복구됨' : '진행 중'}
              </span>
            </div>
            {e.caseId ? (
              <Link to={`/history/${e.caseId}`} className="mono small">{e.caseId}</Link>
            ) : (
              <button className="btn btn-sm" disabled={busy === e.id} onClick={() => register(e)}>
                {busy === e.id ? '등록 중…' : '사건 등록'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
