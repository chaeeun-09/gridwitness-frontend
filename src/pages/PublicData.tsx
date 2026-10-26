import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useNavigate } from 'react-router-dom'
import {
  CONTRACT_LABEL,
  DAYTYPE_LABEL,
  EXAMPLE_DATASET,
  getProfile,
  importUsageCsv,
  profileStats,
  templateCsv,
  type Contract,
  type DayType,
  type ImportResult,
  type UsageDataset,
} from '../lib/publicData'
import { IconDownload, IconUpload } from '../components/Icons'
import IssueList from '../components/IssueList'
import { Empty, Metric, Metrics, PageHeader, Section } from '../components/ui'
import { CHART } from '../lib/chart'
import { startScenario } from '../lib/village'

const DATA_SOURCES = [
  {
    name: 'Arduino + INA219 실측',
    what: '모형의 실시간 DC 부하 (전압·전류·LED 상태)',
    unit: '12V DC · 0.5초 간격',
    use: 'IoT 이상 탐지',
    train: '정상 운전 기록으로 예상 전류 기준 설정',
    verify: '주입 고장 시나리오(지락·전압강하·정전·단선)로 검증',
    limit: '축소 모형이므로 22.9kV 배전 성능 근거로 쓰지 않음',
  },
  {
    name: '공개 고장파형 (Xiong et al.)',
    what: '전력설비 교류 고장 이벤트 7채널 파형',
    unit: '50Hz · 4,096Hz · 1,312×7',
    use: '고장파형 4종 분류 (SIF·MIF·PF·TD)',
    train: '가능 — 라벨 4종, 236건, 클래스 불균형',
    verify: '고정 분할·macro-F1·클래스별 Recall',
    limit: '국내 60Hz·물리적 고장원인 근거 아님',
  },
  {
    name: '한전 전력사용량 공공데이터',
    what: '지역·시간대별 실제 전력 소비 패턴',
    unit: 'kWh · 1시간 단위',
    use: '수요 패턴 분석·비교, 마을 부하 시나리오',
    train: '사용 안 함 — 고장·이상 라벨 없음',
    verify: '패턴 비교 기준으로만 사용',
    limit: '고장 정보가 없어 이상 탐지 근거로 쓰지 않음',
  },
]

export default function PublicData() {
  const nav = useNavigate()
  const [ds, setDs] = useState<UsageDataset>(EXAMPLE_DATASET)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [region, setRegion] = useState('서울')
  const [compare, setCompare] = useState('경기')
  const [contract, setContract] = useState<Contract>('RESIDENTIAL')
  const [month, setMonth] = useState(8)
  const [dayType, setDayType] = useState<DayType>('WEEKDAY')

  const profile = useMemo(() => getProfile(ds, region, contract, month, dayType), [ds, region, contract, month, dayType])
  const compareProfile = useMemo(() => getProfile(ds, compare, contract, month, dayType), [ds, compare, contract, month, dayType])
  const stats = profile ? profileStats(profile) : null

  const lineData = Array.from({ length: 24 }, (_, h) => ({
    h: `${h}시`,
    a: profile && Number.isFinite(profile[h]) ? profile[h] : null,
    b: compareProfile && Number.isFinite(compareProfile[h]) ? compareProfile[h] : null,
  }))
  const barData = ds.regions
    .map((r) => {
      const p = getProfile(ds, r, contract, month, dayType)
      return { region: r, total: p ? p.filter(Number.isFinite).reduce((s, v) => s + v, 0) : 0 }
    })
    .sort((x, y) => y.total - x.total)

  async function onFile(f: File | undefined) {
    if (!f) return
    const res = importUsageCsv(await f.text(), f.name)
    setImportResult(res)
    if (res.dataset) {
      setDs(res.dataset)
      setRegion(res.dataset.regions[0])
      setCompare(res.dataset.regions[1] ?? res.dataset.regions[0])
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob(['﻿' + templateCsv()], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'kepco_usage_template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function playOnVillage() {
    if (!profile) return
    startScenario(`${region} ${CONTRACT_LABEL[contract]} ${month}월 ${DAYTYPE_LABEL[dayType]}`, profile.map((v) => (Number.isFinite(v) ? v : 0)))
    nav('/village')
  }

  const axis = { tick: CHART.tick, axisLine: CHART.axisLine, tickLine: CHART.tickLine }
  const resetToExample = () => {
    setDs(EXAMPLE_DATASET)
    setImportResult(null)
    setRegion('서울')
    setCompare('경기')
  }

  return (
    <>
      <PageHeader
        title="공공데이터 분석"
        description="한전 지역·시간대별 전력사용량으로 수요 패턴을 비교하고, 그 패턴을 스마트 마을의 부하 시나리오로 재생합니다."
        actions={
          <>
            <button className="btn" onClick={downloadTemplate}><IconDownload />CSV 양식</button>
            <label className="btn btn-primary">
              <IconUpload />
              공공데이터 가져오기
              <input type="file" accept=".csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          </>
        }
      />

      {ds.isExample ? (
        <div className="alert alert-warn" style={{ marginTop: 0 }}>
          <span>
            <strong>예시 데이터를 보고 있습니다.</strong> 실제 한전 수치가 아닌 화면 확인용 값입니다. 공공데이터포털·한전 전력데이터 개방포털에서 받은 CSV를 가져오면 실제 값으로 바뀝니다.
          </span>
        </div>
      ) : (
        <div className="alert alert-ok" style={{ marginTop: 0, alignItems: 'center' }}>
          <span style={{ flex: 1 }}><strong>{ds.fileName}</strong> 데이터를 보고 있습니다.</span>
          <button className="btn btn-sm" onClick={resetToExample}>예시 데이터로</button>
        </div>
      )}

      {importResult && (
        <Section title={`가져온 데이터 점검 · ${importResult.rowCount.toLocaleString()}행`} style={{ marginTop: 24 }}>
          <IssueList issues={importResult.issues} />
        </Section>
      )}

      <div className="filters" style={{ margin: '28px 0' }}>
        <label className="field">지역<select value={region} onChange={(e) => setRegion(e.target.value)}>{ds.regions.map((r) => <option key={r}>{r}</option>)}</select></label>
        <label className="field">비교 지역<select value={compare} onChange={(e) => setCompare(e.target.value)}>{ds.regions.map((r) => <option key={r}>{r}</option>)}</select></label>
        <label className="field">계약종별
          <select value={contract} onChange={(e) => setContract(e.target.value as Contract)}>
            {Object.entries(CONTRACT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field">월<select value={month} onChange={(e) => setMonth(Number(e.target.value))}>{Array.from({ length: 12 }, (_, k) => <option key={k} value={k + 1}>{k + 1}월</option>)}</select></label>
        <label className="field">요일
          <select value={dayType} onChange={(e) => setDayType(e.target.value as DayType)}>
            {Object.entries(DAYTYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>

      {!stats ? (
        <Empty title="선택한 조건의 데이터가 없습니다" description="가져온 CSV에 이 지역·계약종별·월·요일 조합이 있는지 확인하세요." />
      ) : (
        <>
          <Metrics>
            <Metric label="일 사용량" value={stats.total.toLocaleString()} unit="kWh" foot={ds.isExample ? '예시 값' : region} />
            <Metric label="피크 시간" value={`${stats.peakHour}시`} foot={`${stats.peak.toLocaleString()} kWh`} />
            <Metric label="부하율" value={(stats.loadFactor * 100).toFixed(0)} unit="%" foot="평균 ÷ 피크" />
            <Metric label="패턴" value={stats.pattern} small foot={`최저 ${stats.minHour}시 · 피크/최저 ${(stats.peak / stats.min).toFixed(2)}배`} />
          </Metrics>

          <div className="grid-2 section">
            <Section
              title="시간대별 사용량"
              actions={<button className="btn btn-sm" onClick={playOnVillage}>스마트 마을에서 재생</button>}
            >
              <div className="legend" style={{ marginBottom: 8 }}>
                <span><i style={{ background: CHART.ink }} />{region}</span>
                <span style={{ color: CHART.secondary }}><i className="dash" />{compare}</span>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="h" interval={3} {...axis} />
                  <YAxis {...axis} width={48} />
                  <Tooltip />
                  <Line name={region} dataKey="a" stroke={CHART.ink} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line name={compare} dataKey="b" stroke={CHART.secondary} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              {stats.missingHours > 0 && <p className="hint">빈 시간 {stats.missingHours}개는 보간하지 않고 비워 두었습니다.</p>}
            </Section>
            <Section title={`지역별 일 사용량 · ${CONTRACT_LABEL[contract]}`}>
              <div className="legend" style={{ marginBottom: 8 }}>
                <span><i style={{ background: CHART.ink }} />선택</span>
                <span><i style={{ background: CHART.secondary }} />비교</span>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="region" interval={0} {...axis} tick={{ ...CHART.tick, fontSize: 10.5 }} />
                  <YAxis {...axis} width={48} />
                  <Tooltip cursor={{ fill: 'rgba(20,22,27,0.04)' }} />
                  <Bar dataKey="total" name="일 사용량" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {barData.map((d) => <Cell key={d.region} fill={d.region === region ? CHART.ink : d.region === compare ? CHART.secondary : '#e4e5ea'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Section>
          </div>
        </>
      )}

      <Section title="데이터별 용도" description="세 데이터는 단위·측정 주기·설비 규모·목적이 달라 하나의 모델에 함께 학습시키지 않습니다.">
        <div className="table-wrap">
          <table>
            <thead><tr><th>데이터</th><th>분석 대상</th><th>단위·주기</th><th>사용처</th><th>학습</th><th>검증</th><th>한계</th></tr></thead>
            <tbody>
              {DATA_SOURCES.map((d) => (
                <tr key={d.name}>
                  <td className="strong">{d.name}</td>
                  <td>{d.what}</td>
                  <td className="small muted">{d.unit}</td>
                  <td>{d.use}</td>
                  <td className="small">{d.train}</td>
                  <td className="small">{d.verify}</td>
                  <td className="small muted">{d.limit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  )
}
