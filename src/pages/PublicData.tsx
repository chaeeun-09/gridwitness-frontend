import { useEffect, useMemo, useState } from 'react'
import { useMedia } from '../lib/useMedia'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useNavigate } from 'react-router-dom'
import {
  CONTRACT_LABEL,
  DAYTYPE_LABEL,
  getProfile,
  importUsageCsv,
  loadKepcoDataset,
  profileStats,
  templateCsv,
  type Contract,
  type DayType,
  type ImportResult,
  type UsageDataset,
} from '../lib/publicData'
import { IconDownload, IconUpload } from '../components/Icons'
import IssueList from '../components/IssueList'
import KepcoReal from '../components/KepcoReal'
import OutageInsight from '../components/OutageInsight'
import { Empty, ErrorState, Metric, Metrics, PageHeader, Section, Skeleton } from '../components/ui'
import { CHART } from '../lib/chart'
import { startScenario } from '../lib/village'

const DATA_SOURCES = [
  {
    name: 'Arduino + INA219 실측',
    what: '모형의 DC 부하 (전압·전류·채널 상태)',
    unit: 'USB 5V DC · 0.5초 간격',
    use: '마을 이상 탐지 (예상 전류와 비교)',
    train: '정상 운전 기록으로 예상 전류 기준 설정',
    verify: '실물에서 LED를 빼거나 끄는 시험으로 확인 예정',
    limit: '축소 모형이라 실제 배전 성능 근거로 쓰지 않음',
  },
  {
    name: '공개 고장파형 (중국 Xiong · 러시아 OscGrid)',
    what: '전력설비 교류 고장 이벤트 파형',
    unit: '중국 4,096Hz 7채널 · 러시아 1,600Hz 5채널',
    use: '고장파형 분류 (나라별 모델, 다른 나라 파형은 판단 보류)',
    train: '사용 — 중국 236건(4종), 러시아 3,195건(4종)',
    verify: '시험 세트 macro-F1, 묶음 단위 5-fold, 판단 보류율',
    limit: '한국 파형 아님 (한국 자료는 KDN 요청 필요)',
  },
  {
    name: '한전 지역본부 시간별 전력사용량 (15151157)',
    what: '15개 지역본부의 실제 시간별 전력 소비',
    unit: 'MWh · 1시간 · 2022~2024',
    use: '이 화면의 패턴 비교, 도시·대단지 시뮬레이션 부하, AI 부하 이상 탐지',
    train: '사용 — 2022~2023 학습, 2024 시험 (기상청 관측 날씨 함께)',
    verify: '2024 예측 오차(MAPE), 판정된 사례 목록',
    limit: '계약종별 구분 없음 · 사고 정답 라벨 없음 (판정은 사람 확인 필요)',
  },
]

export default function PublicData() {
  const narrow = useMedia('(max-width: 600px)')
  const nav = useNavigate()
  const [kepco, setKepco] = useState<UsageDataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [csv, setCsv] = useState<UsageDataset | null>(null)
  const ds = csv ?? kepco
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [region, setRegion] = useState('서울본부')
  const [compare, setCompare] = useState('경기본부')
  useEffect(() => {
    loadKepcoDataset().then(setKepco, (e) => setLoadError(String(e)))
  }, [])
  const [contract, setContract] = useState<Contract>('RESIDENTIAL')
  const [month, setMonth] = useState(8)
  const [dayType, setDayType] = useState<DayType>('WEEKDAY')

  const profile = useMemo(() => (ds ? getProfile(ds, region, contract, month, dayType) : null), [ds, region, contract, month, dayType])
  const compareProfile = useMemo(() => (ds ? getProfile(ds, compare, contract, month, dayType) : null), [ds, compare, contract, month, dayType])
  const stats = profile ? profileStats(profile) : null

  const lineData = Array.from({ length: 24 }, (_, h) => ({
    h: `${h}시`,
    a: profile && Number.isFinite(profile[h]) ? profile[h] : null,
    b: compareProfile && Number.isFinite(compareProfile[h]) ? compareProfile[h] : null,
  }))
  const barData = (ds?.regions ?? [])
    .map((r) => {
      if (!ds) return { region: r, total: 0 }
      const p = getProfile(ds, r, contract, month, dayType)
      return { region: r, total: p ? p.filter(Number.isFinite).reduce((s, v) => s + v, 0) : 0 }
    })
    .sort((x, y) => y.total - x.total)

  async function onFile(f: File | undefined) {
    if (!f) return
    const res = importUsageCsv(await f.text(), f.name)
    setImportResult(res)
    if (res.dataset) {
      setCsv(res.dataset)
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
    if (!profile || !ds) return
    startScenario(`${region}${ds.hasContract ? ` ${CONTRACT_LABEL[contract]}` : ''} ${month}월 ${DAYTYPE_LABEL[dayType]}`, profile.map((v) => (Number.isFinite(v) ? v : 0)))
    nav('/village')
  }

  const axis = { tick: CHART.tick, axisLine: CHART.axisLine, tickLine: CHART.tickLine }
  const [hover, setHover] = useState<string | null>(null)
  /** 막대 클릭: 그 지역을 선택 / Shift+클릭: 비교 지역 */
  const pickRegion = (d: unknown, _i: number, e: { shiftKey?: boolean } | undefined) => {
    const r = (d as { region?: string; payload?: { region?: string } })?.region ?? (d as { payload?: { region?: string } })?.payload?.region
    if (!r) return
    if (e?.shiftKey) setCompare(r)
    else setRegion(r)
  }
  const resetToKepco = () => {
    setCsv(null)
    setImportResult(null)
    setRegion('서울본부')
    setCompare('경기본부')
  }
  if (loadError && !csv) return <ErrorState message={`한전 데이터를 불러오지 못했습니다: ${loadError}`} onRetry={() => location.reload()} />
  if (!ds) return <Skeleton h={400} />
  const unit = ds.unit

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

      {ds.kind === 'kepco' ? (
        <div className="alert alert-ok" style={{ marginTop: 0 }}>
          <span>
            <strong>한전 실제 데이터</strong>: <a href={ds.source?.url} target="_blank" rel="noreferrer">{ds.source?.dataset}</a> ({ds.source?.range[0].slice(0, 10)} ~ {ds.source?.range[1].slice(0, 10)})의 월·평일/주말별 시간 평균입니다. 지역본부 전체 고객 합계라 계약종별(주택·일반·산업)은 나뉘지 않습니다.
          </span>
        </div>
      ) : (
        <div className="alert alert-ok" style={{ marginTop: 0, alignItems: 'center' }}>
          <span style={{ flex: 1 }}><strong>{ds.fileName}</strong> 데이터를 보고 있습니다.</span>
          <button className="btn btn-sm" onClick={resetToKepco}>한전 데이터로</button>
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
          <select value={contract} onChange={(e) => setContract(e.target.value as Contract)} disabled={!ds.hasContract} title={ds.hasContract ? '' : '한전 시간별 자료에는 계약종별 구분이 없습니다'}>
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
            <Metric label="일 사용량" value={Math.round(stats.total).toLocaleString()} unit={unit} foot={region} />
            <Metric label="피크 시간" value={`${stats.peakHour}시`} foot={`${Math.round(stats.peak).toLocaleString()} ${unit}`} />
            <Metric label="부하율" value={(stats.loadFactor * 100).toFixed(0)} unit="%" foot="평균 ÷ 피크" />
            <Metric label="패턴" value={stats.pattern} small foot={`최저 ${stats.minHour}시 · 피크/최저 ${(stats.peak / stats.min).toFixed(2)}배`} />
          </Metrics>

          <div className="grid-2 section">
            <Section
              title="시간대별 사용량"
              actions={<button className="btn btn-sm" onClick={playOnVillage}>스마트 마을에서 재생</button>}
            >
              <div className="legend" style={{ marginBottom: 8 }}>
                <span><i style={{ background: CHART.accent }} />{region}</span>
                <span style={{ color: CHART.secondary }}><i className="dash" />{compare}</span>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={lineData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis dataKey="h" interval={3} {...axis} />
                  <YAxis {...axis} width={48} />
                  <Tooltip />
                  <Line name={region} dataKey="a" stroke={CHART.accent} strokeWidth={2.25} dot={false} connectNulls={false} isAnimationActive={false} />
                  <Line name={compare} dataKey="b" stroke={CHART.secondary} strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              {stats.missingHours > 0 && <p className="hint">빈 시간 {stats.missingHours}개는 보간하지 않고 비워 두었습니다.</p>}
            </Section>
            <Section title={`지역별 일 사용량${ds.hasContract ? ` · ${CONTRACT_LABEL[contract]}` : ''}`} description="막대를 누르면 그 지역이 선택되고, Shift+클릭은 비교 지역이 됩니다.">
              <div className="legend" style={{ marginBottom: 8 }}>
                <span><i style={{ background: CHART.accent }} />선택 지역</span>
                <span><i style={{ background: '#7b808b' }} />비교 지역</span>
              </div>
              <div className="bar-chart">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} onMouseLeave={() => setHover(null)}>
                    <CartesianGrid stroke={CHART.grid} vertical={false} />
                    <XAxis dataKey="region" interval={0} {...axis} tick={{ ...CHART.tick, fontSize: 10.5 }} tickFormatter={(r: string) => r.replace(/본부$/, '')} angle={narrow ? -90 : -40} textAnchor="end" height={narrow ? 70 : 56} />
                    <YAxis {...axis} width={48} />
                    <Tooltip cursor={{ fill: 'rgba(49,87,224,0.07)' }} formatter={(v) => [`${Math.round(Number(v)).toLocaleString()} ${unit}`, '일 사용량']} />
                    <Bar dataKey="total" name="일 사용량" radius={[4, 4, 0, 0]} isAnimationActive={false} cursor="pointer" onClick={pickRegion} onMouseEnter={(d: unknown) => setHover((d as { region?: string })?.region ?? null)}>
                      {barData.map((d) => (
                        <Cell key={d.region} fill={d.region === region ? CHART.accent : d.region === compare ? '#7b808b' : d.region === hover ? '#9fb2ee' : '#e0e2e8'} style={{ transition: 'fill 120ms' }} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Section>
          </div>
        </>
      )}

      <KepcoReal />

      <OutageInsight />

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
