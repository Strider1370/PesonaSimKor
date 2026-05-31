import "./result.css"
import type { AgentSampledEvent, AggregateEvent, BlindSpotCluster, ReframingItem, StanceCounts } from "../lib/api"
import { getCurrentRunSnapshot, useCurrentRunStore } from "../lib/currentRunStore"
import { ageGroupShort, genderShort, niceTickMax, placeOpinionBadges, regionGroupLabel, regionShort } from "../lib/resultHelpers"

type ResultPageProps = {
  onDebug: () => void
  onExperiment: () => void
  onRerun: () => void
}

export function ResultPage({ onDebug, onExperiment, onRerun }: ResultPageProps) {
  const currentRun = useCurrentRunStore((state) => state.currentRun) ?? getCurrentRunSnapshot()

  if (!currentRun) {
    return (
      <main className="result-shell">
        <section className="result-empty">
          <h1>/에서 먼저 실행하세요</h1>
          <button type="button" onClick={onDebug}>
            디버그로 이동
          </button>
        </section>
      </main>
    )
  }

  return (
    <main className="result-shell">
      <ResultHeader policy={currentRun.policy} onDebug={onDebug} onExperiment={onExperiment} onRerun={onRerun} />
      <Hero aggregate={currentRun.aggregate} nAgents={currentRun.n_agents} modelName={currentRun.model_name} />
      <section className="result-grid">
        <OpinionMap aggregate={currentRun.aggregate} nAgents={currentRun.n_agents} />
        <DemographicBars aggregate={currentRun.aggregate} />
      </section>
      <BlindSpotGrid clusters={currentRun.aggregate.blind_spot_clusters} sampledAgents={currentRun.sampledAgents} />
      <ReframingList items={currentRun.aggregate.reframing_list} />
    </main>
  )
}

function ResultHeader({
  policy,
  onDebug,
  onExperiment,
  onRerun,
}: {
  policy: string
  onDebug: () => void
  onExperiment: () => void
  onRerun: () => void
}) {
  return (
    <header className="result-header">
      <div className="result-header-left">
        <strong>KoreanSim</strong>
        <span className="result-policy-chip" title={policy}>
          {policy}
        </span>
      </div>
      <div className="result-header-actions">
        <button type="button" className="result-secondary-button" onClick={onExperiment}>
          실험으로 보내기 -&gt;
        </button>
        <button type="button" className="result-secondary-button" onClick={onDebug}>
          디버그
        </button>
        <button type="button" className="result-primary-button" onClick={onRerun}>
          재실행
        </button>
      </div>
    </header>
  )
}

function Hero({ aggregate, nAgents, modelName }: { aggregate: AggregateEvent; nAgents: number; modelName: string }) {
  const total = safeCounts(aggregate.total)
  const totalCount = Math.max(1, total.support + total.oppose + total.neutral)
  const segments = [
    { key: "support", label: "찬성", value: total.support, className: "support" },
    { key: "oppose", label: "반대", value: total.oppose, className: "oppose" },
    { key: "neutral", label: "중립", value: total.neutral, className: "neutral" },
  ]

  return (
    <section className="result-hero">
      <div className="result-hero-stats">
        {segments.map((segment) => (
          <div key={segment.key} className={`result-stat ${segment.className}`}>
            <strong>{segment.value}</strong>
            <span>{segment.label}</span>
          </div>
        ))}
        <div className="result-stat-divider" />
        <div className="result-stat blind">
          <strong>{aggregate.blind_spot_clusters.length}</strong>
          <span>사각지대</span>
        </div>
        <div className="result-stat reframe">
          <strong>{aggregate.reframing_list.length}</strong>
          <span>반문</span>
        </div>
        <div className="result-stat push accent">
          <strong>{nAgents}</strong>
          <span>표본수</span>
        </div>
        <div className="result-model-pill" title={modelName}>
          {modelName}
        </div>
      </div>
      <div className="result-stacked-bar" aria-label="찬반중립 비율">
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`result-segment ${segment.className}`}
            style={{ width: `${(segment.value / totalCount) * 100}%` }}
          />
        ))}
      </div>
    </section>
  )
}

function safeCounts(value: StanceCounts): StanceCounts {
  return {
    support: Number(value.support) || 0,
    oppose: Number(value.oppose) || 0,
    neutral: Number(value.neutral) || 0,
  }
}

function OpinionMap({ aggregate, nAgents }: { aggregate: AggregateEvent; nAgents: number }) {
  const clusters = [...aggregate.support_clusters, ...aggregate.concern_clusters]
  const maxClusterCount = Math.max(0, ...clusters.map((cluster) => cluster.count))
  const yMax = niceTickMax(Math.max(nAgents, maxClusterCount))
  const supportBadges = placeOpinionBadges(aggregate.support_clusters, "support", yMax)
  const concernBadges = placeOpinionBadges(aggregate.concern_clusters, "concern", yMax)
  const ticks = buildOpinionTicks(yMax)
  const gridTicks = ticks.filter((tick) => tick !== 0 && tick !== yMax && tick % Math.max(1, Math.round(yMax / 3)) === 0)

  return (
    <section className="result-panel opinion-map map-panel">
      <h2>
        의견 지형도 <span className="hint">- 찬반 × 언급 수</span>
      </h2>
      <div className="map-wrap">
        <div className="y-axis" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} className="y-tick" style={{ top: `${tickToTop(tick, yMax)}%` }}>
              {tick}
            </span>
          ))}
        </div>
        <div className="plot-area">
          <span className="center-vline" />
          {gridTicks.map((tick) => (
            <span key={tick} className="y-grid" style={{ top: `${tickToTop(tick, yMax)}%` }} />
          ))}
          {aggregate.support_clusters.length === 0 && <span className="opinion-empty left">이번 실행에선 찬성 cluster 없음</span>}
          {aggregate.concern_clusters.length === 0 && <span className="opinion-empty right">이번 실행에선 반대 cluster 없음</span>}
          {[...supportBadges, ...concernBadges].map((badge) => (
            <span
              key={`${badge.side}-${badge.label}`}
              className={`badge ${badge.side === "concern" ? "oppose" : "support"} ${badge.sizeClass}`}
              style={{ left: `${badge.x}%`, top: `${badge.y}%` }}
              title={`${badge.label} · ${badge.count}명`}
            >
              <span className="lab">{badge.short_label}</span>
              <span className="cnt">{badge.count}</span>
            </span>
          ))}
          <span className="x-label" style={{ left: "25%" }}>찬성 측</span>
          <span className="x-label" style={{ left: "75%" }}>반대 측</span>
        </div>
      </div>
      <div className="legend">
        <span className="key"><span className="swatch s" />찬성 cluster</span>
        <span className="key"><span className="swatch o" />반대 cluster</span>
        <span className="legend-note">y축 = 언급한 응답 수 / 뱃지 크기도 비례</span>
      </div>
      <div className="toggles">
        <button type="button">▾ 응답 {nAgents}개 모두 보기</button>
      </div>
    </section>
  )
}

type DemographicRow = { key: string; label: string; counts: StanceCounts }

function DemographicBars({ aggregate }: { aggregate: AggregateEvent }) {
  const ageRows = orderedRows(aggregate.by_age, ["20s", "30s", "40s", "50s", "60s", "70_plus"], ageGroupShort)
  const genderRows = orderedRows(aggregate.by_gender, ["male", "female"], genderShort)
  const regionRows = Object.entries(aggregate.by_region)
    .map(([key, counts]) => ({ key, label: regionGroupLabel(key), counts }))
    .filter((row) => rowTotal(row.counts) > 0)
    .sort((a, b) => rowTotal(b.counts) - rowTotal(a.counts))
  const maxSide = Math.max(1, ...[...ageRows, ...genderRows, ...regionRows].flatMap((row) => [row.counts.support, row.counts.oppose]))

  return (
    <section className="result-panel demographic-bars">
      <h2>
        인구 분포별 찬반 <span className="hint">- 좌(찬성) · 우(반대)</span>
      </h2>
      <DBarSection title="연령" rows={ageRows} maxSide={maxSide} />
      <DBarSection title="성별" rows={genderRows} maxSide={maxSide} />
      <DBarSection title="지역" rows={regionRows} maxSide={maxSide} />
      <div className="legend dbar-legend">
        <span className="key"><span className="swatch s" />찬성</span>
        <span className="key"><span className="swatch o" />반대</span>
        <span className="legend-note">막대 길이 = 응답자 수 (max={maxSide})</span>
      </div>
    </section>
  )
}

function orderedRows(
  data: Record<string, StanceCounts>,
  order: string[],
  labeler: (key: string) => string,
): DemographicRow[] {
  return order
    .map((key) => ({ key, label: labeler(key), counts: data[key] ?? { support: 0, oppose: 0, neutral: 0 } }))
    .filter((row) => rowTotal(row.counts) > 0)
}

function rowTotal(counts: StanceCounts) {
  return counts.support + counts.oppose + counts.neutral
}

function DBarSection({ title, rows, maxSide }: { title: string; rows: DemographicRow[]; maxSide: number }) {
  if (rows.length === 0) return null
  return (
    <div className="dbar-section">
      <h3>{title}</h3>
      {rows.map((row) => (
        <div key={row.key} className="dbar-row">
          <span className="dbar-label">{row.label}</span>
          <span className={row.counts.support ? "dbar-num support" : "dbar-num zero"}>{row.counts.support}</span>
          <span className="dbar-track">
            <span className="dbar-half left">
              <span className="dbar-fill support" style={{ width: `${(row.counts.support / maxSide) * 100}%` }} />
            </span>
            <span className="dbar-center" />
            <span className="dbar-half right">
              <span className="dbar-fill oppose" style={{ width: `${(row.counts.oppose / maxSide) * 100}%` }} />
            </span>
          </span>
          <span className={row.counts.oppose ? "dbar-num oppose" : "dbar-num zero"}>{row.counts.oppose}</span>
        </div>
      ))}
    </div>
  )
}

function BlindSpotGrid({ clusters, sampledAgents }: { clusters: BlindSpotCluster[]; sampledAgents: AgentSampledEvent[] }) {
  const sampledById = new Map(sampledAgents.map((agent) => [agent.agent_id, agent]))
  const totalCount = clusters.reduce((sum, cluster) => sum + Math.max(1, cluster.count), 0)
  const countHint = clusters.every((cluster) => cluster.count <= 1) ? "각 1명이 발견" : "복수 응답 포함"
  if (clusters.length === 0) {
    return (
      <section className="result-panel result-wide-panel">
        <h2>사각지대</h2>
        <p className="result-empty-copy">이번 실행에서는 뚜렷한 사각지대가 발견되지 않았습니다. 표본수를 늘리거나 정책 문장을 구체화해보세요.</p>
      </section>
    )
  }

  return (
    <section className="result-panel result-wide-panel">
      <h2>🔍 사각지대 <span className="hint">- {totalCount}건 ({countHint})</span></h2>
      <div className="blind-grid">
        {clusters.slice(0, 6).map((cluster, index) => {
          const representative = sampledById.get(cluster.agent_ids[0])
          const meta = representative
            ? `${ageGroupShort(representative.age_group)} ${genderShort(representative.gender)} · ${regionShort(representative.region, representative.region_group)}${
                cluster.count >= 2 ? ` 외 ${cluster.count - 1}명` : ""
              }`
            : "정보 없음"
          return (
            <article key={`${cluster.short_title}-${index}`} className="blind-card">
              <div className="blind-head">
                <h3 className="blind-title">{cluster.short_title}</h3>
              </div>
              <p className="blind-ex" title={cluster.blind_spot_examples[0]}>"{cluster.blind_spot_examples[0]}"</p>
              <span className="reframe-meta">{meta}</span>
            </article>
          )
        })}
      </div>
      {clusters.length > 6 && <div className="toggles"><button type="button">▾ 사각지대 {clusters.length - 6}건 더 보기</button></div>}
    </section>
  )
}

function ReframingList({ items }: { items: ReframingItem[] }) {
  if (items.length === 0) return null
  const currentRun = getCurrentRunSnapshot()
  const nAgents = currentRun?.n_agents ?? items.length
  const pct = nAgents ? Math.round((items.length / nAgents) * 100) : 0
  return (
    <section className="result-panel result-wide-panel">
      <h2>💬 정책 전제에 대한 반문 <span className="hint">- {items.length}건 / {nAgents}명 ({pct}%가 정책 방향 자체를 다시 물음)</span></h2>
      <div className="reframe-grid">
        {items.slice(0, 6).map((item, index) => (
          <article key={`${item.text}-${index}`} className="reframe-card">
            <p className="reframe-text" title={item.text}>"{item.text}"</p>
            <span className="reframe-meta">
              {ageGroupShort(item.age_group)} {genderShort(item.gender)} · {regionGroupLabel(item.region_group)}
            </span>
          </article>
        ))}
      </div>
      {items.length > 6 && <div className="toggles"><button type="button">▾ 반문 {items.length - 6}건 더 보기</button></div>}
    </section>
  )
}

function buildOpinionTicks(yMax: number): number[] {
  const step = yMax <= 10 ? 2 : yMax <= 30 ? 5 : yMax <= 50 ? 10 : Math.ceil(yMax / 5 / 10) * 10
  const ticks: number[] = []
  for (let value = yMax; value >= 0; value -= step) {
    ticks.push(value)
  }
  if (ticks[ticks.length - 1] !== 0) ticks.push(0)
  return ticks
}

function tickToTop(tick: number, yMax: number): number {
  return (1 - tick / Math.max(1, yMax)) * 88 + 8
}
