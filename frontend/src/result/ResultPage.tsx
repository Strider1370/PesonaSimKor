import "./result.css"
import type { AgentSampledEvent, AggregateEvent, BlindSpotCluster, ReframingItem, StanceCounts } from "../lib/api"
import { getCurrentRunSnapshot, useCurrentRunStore } from "../lib/currentRunStore"
import { ageGroupShort, genderShort, regionGroupLabel, regionShort } from "../lib/resultHelpers"

type ResultPageProps = {
  onDebug: () => void
}

export function ResultPage({ onDebug }: ResultPageProps) {
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
      <ResultHeader policy={currentRun.policy} />
      <Hero aggregate={currentRun.aggregate} nAgents={currentRun.n_agents} modelName={currentRun.model_name} />
      <section className="result-grid">
        <OpinionMap aggregate={currentRun.aggregate} />
        <DemographicBars aggregate={currentRun.aggregate} />
      </section>
      <BlindSpotGrid clusters={currentRun.aggregate.blind_spot_clusters} sampledAgents={currentRun.sampledAgents} />
      <ReframingList items={currentRun.aggregate.reframing_list} />
    </main>
  )
}

function ResultHeader({ policy }: { policy: string }) {
  const policyDescription = extractPolicyDescription(policy)
  return (
    <header className="result-header">
      <div className="result-header-left">
        <strong>KoreanSim</strong>
        <span className="result-policy-chip" title={policyDescription}>
          {policyDescription}
        </span>
      </div>
    </header>
  )
}

function extractPolicyDescription(policy: string) {
  const match = policy.match(/\[정책 설명\]\s*([\s\S]*?)(?=\n\s*\[[^\]]+\]|$)/)
  return normalizeInlineText(match?.[1] || policy)
}

function normalizeInlineText(text: string) {
  return text.replace(/\s+/g, " ").trim()
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

function OpinionMap({ aggregate }: { aggregate: AggregateEvent }) {
  return (
    <section className="result-panel opinion-map">
      <h2>
        찬반 클러스터 <span className="hint">- 응답 수</span>
      </h2>
      <div className="opinion-columns">
        <OpinionClusterColumn title="찬성 클러스터" tone="support" clusters={aggregate.support_clusters} />
        <OpinionClusterColumn title="반대 클러스터" tone="oppose" clusters={aggregate.concern_clusters} />
      </div>
    </section>
  )
}

function OpinionClusterColumn({
  title,
  tone,
  clusters,
}: {
  title: string
  tone: "support" | "oppose"
  clusters: AggregateEvent["support_clusters"]
}) {
  return (
    <div className={`opinion-column ${tone}`}>
      <h3>{title}</h3>
      {clusters.length === 0 ? (
        <p className="opinion-empty">이번 실행에선 클러스터 없음</p>
      ) : (
        <div className="opinion-cluster-list">
          {clusters.map((cluster, index) => {
            const examples = cluster.examples
              .map(normalizeInlineText)
              .filter((example) => example && example !== cluster.label && example !== cluster.short_label)
              .slice(0, 2)
            const title = [cluster.label, ...examples].filter(Boolean).join(" / ")
            return (
              <div key={`${cluster.label}-${index}`} className="opinion-cluster-row" title={title}>
                <span className="opinion-cluster-copy">
                  <span className="opinion-cluster-title">{cluster.short_label || cluster.label}</span>
                  {cluster.label && cluster.label !== cluster.short_label && (
                    <span className="opinion-cluster-detail">{cluster.label}</span>
                  )}
                  {examples.map((example, exampleIndex) => (
                    <span key={`${cluster.label}-example-${exampleIndex}`} className="opinion-cluster-example">
                      {example}
                    </span>
                  ))}
                </span>
                <strong>{cluster.count}명</strong>
              </div>
            )
          })}
        </div>
      )}
    </div>
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
