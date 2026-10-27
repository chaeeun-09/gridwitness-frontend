import { useState } from 'react'
import { Link } from 'react-router-dom'
import Channels from '../components/Channels'
import { PageHeader, Section } from '../components/ui'
import { type ChannelId, useVillage } from '../lib/village'

export default function VillageLoads() {
  const snap = useVillage()
  const [selected, setSelected] = useState<ChannelId | null>(null)
  return (
    <>
      <PageHeader crumbs={[{ label: '스마트 마을', to: '/village' }, { label: '부하' }]} title="부하" description="LED 5개가 병렬로 연결되어 릴레이 하나로 함께 켜지고 꺼집니다." />
      <Section title="LED 상태" actions={<Link to="/settings" className="small">회로 구성 →</Link>}>
        <Channels snap={snap} selected={selected} onSelect={setSelected} />
        <p className="hint">INA219가 1개라 LED별 전류는 측정하지 않습니다. 전체 전류로 켜진 개수를 추정합니다.</p>
      </Section>
    </>
  )
}
