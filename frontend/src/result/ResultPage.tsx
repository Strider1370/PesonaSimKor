import { useMemo, useState } from "react"
import "./result.css"
import type { Stance } from "../lib/api"
import type { CurrentRun } from "../lib/currentRunStore"
import { getCurrentRunSnapshot, useCurrentRunStore } from "../lib/currentRunStore"
import { buildDashboard, DashboardAffectedGroup, DashboardCluster, filterPersonasByAgentIds } from "./dashboardModel"

type ResultPageProps = {
  run?: CurrentRun
  onDebug: () => void
}

const STANCE_LABELS: Record<Stance, string> = {
  support: "찬성",
  neutral: "중립",
  oppose: "반대",
}

export function ResultPage({ run, onDebug }: ResultPageProps) {
  const storedRun = useCurrentRunStore((state) => state.currentRun) ?? getCurrentRunSnapshot()
  const currentRun = run ?? storedRun
  const [selectedAgentIds, setSelectedAgentIds] = useState<number[] | null>(null)

  const vm = useMemo(() => (currentRun ? buildDashboard(currentRun) : null), [currentRun])
  const filteredPersonas = useMemo(
    () => (vm ? filterPersonasByAgentIds(vm.personas, selectedAgentIds) : []),
    [vm, selectedAgentIds],
  )

  if (!currentRun || !vm) {
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
    <main className="result-shell data-dashboard">
      <header className="dashboard-header">
        <div>
          <h1>{vm.policyHeader.name}</h1>
          <span className="persona-count">페르소나 {vm.nAgents}명</span>
        </div>
        {vm.policyHeader.fields.length > 0 && (
          <dl className="policy-fields">
            {vm.policyHeader.fields.map((field) => (
              <div key={field.key} data-source={field.source}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      <section className="dashboard-card stance-card">
        <div className="section-title">
          <h2>입장 분포</h2>
          <p>모델이 답한 입장 그대로</p>
        </div>
        <div className="stance-bar" aria-label="입장 분포">
          {(["support", "neutral", "oppose"] as Stance[]).map((stance) => (
            <span key={stance} className={`stance-segment ${stance}`} style={{ width: `${stanceWidth(vm.stance[stance], vm.nAgents)}%` }} />
          ))}
        </div>
        <div className="stance-counts">
          {(["support", "neutral", "oppose"] as Stance[]).map((stance) => (
            <span key={stance} className={stance}>
              {STANCE_LABELS[stance]} <strong>{vm.stance[stance]}</strong>
            </span>
          ))}
        </div>
      </section>

      <ClusterSection
        title="반복된 우려"
        description="비슷한 사각지대 의견끼리 묶었습니다. 클릭하면 해당 원문만 표시됩니다."
        clusters={vm.concerns}
        onSelect={setSelectedAgentIds}
      />

      <ClusterSection
        title="예상 민원"
        description="시행 후 나올 문의를 별도 패널로 표시합니다."
        clusters={vm.complaints}
        panel
        onSelect={setSelectedAgentIds}
      />

      <section className="dashboard-card">
        <div className="section-title">
          <h2>불리하다고 지목된 집단</h2>
          <p>비슷한 집단을 묶고, 지목된 이유를 함께 표시합니다.</p>
        </div>
        {vm.affectedGroups.length === 0 ? (
          <p className="dashboard-empty">지목된 집단 없음</p>
        ) : (
          <div className="affected-list">
            {vm.affectedGroups.map((group) => (
              <button
                type="button"
                key={`${group.label}-${group.agentIds.join("-")}`}
                className="affected-row"
                onClick={() => setSelectedAgentIds(group.agentIds)}
              >
                <span className="affected-copy">
                  <b>{group.label}</b>
                  {group.reason && <small>집단이 불리하다고 지목된 이유: {group.reason}</small>}
                </span>
                <strong>{affectedCountLabel(group)}</strong>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="raw-response-section">
        <div className="raw-response-head">
          <h2>대표 응답</h2>
          {selectedAgentIds && (
            <button type="button" className="secondary-filter-button" onClick={() => setSelectedAgentIds(null)}>
              전체 보기
            </button>
          )}
        </div>
        {filteredPersonas.length === 0 ? (
          <p className="dashboard-empty">우려나 민원이 연결된 대표 응답 없음</p>
        ) : (
          <div className="raw-response-grid">
            {filteredPersonas.map((persona) => (
              <article key={persona.agentId} className="raw-response-card">
                <div>
                  <span>{persona.meta || `#${persona.agentId}`}</span>
                  <strong className={`stance-pill ${persona.stance}`}>{STANCE_LABELS[persona.stance]}</strong>
                </div>
                {persona.blindSpot && (
                  <p>
                    <b>우려</b>
                    {persona.blindSpot}
                  </p>
                )}
                {persona.expectedComplaint && (
                  <p>
                    <b>예상 민원</b>
                    {persona.expectedComplaint}
                  </p>
                )}
                {!persona.blindSpot && !persona.expectedComplaint && persona.rationale && (
                  <p>
                    <b>입장 근거</b>
                    {persona.rationale}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

function ClusterSection({
  title,
  description,
  clusters,
  panel = false,
  onSelect,
}: {
  title: string
  description: string
  clusters: DashboardCluster[]
  panel?: boolean
  onSelect: (agentIds: number[]) => void
}) {
  return (
    <section className={panel ? "complaint-section" : "dashboard-card"}>
      <div className="section-title">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {clusters.length === 0 ? (
        <p className="dashboard-empty">해당 응답 없음</p>
      ) : (
        <div className={panel ? "complaint-list" : "cluster-list"}>
          {clusters.map((cluster) => (
            <button
              type="button"
              key={`${cluster.quote}-${cluster.agentIds.join("-")}`}
              className={panel ? "complaint-panel" : "cluster-row"}
              onClick={() => onSelect(cluster.agentIds)}
            >
              <span className="cluster-copy">
                <b>{cluster.label}</b>
                {cluster.label !== cluster.quote && <small>{cluster.quote}</small>}
                {cluster.inferredBased && <em>추론 기반</em>}
              </span>
              <strong>{countLabel(cluster)}</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function countLabel(cluster: DashboardCluster) {
  if (cluster.denominator == null) return `${cluster.count}명`
  return `${cluster.denominator}명 중 ${cluster.count}명`
}

function affectedCountLabel(group: DashboardAffectedGroup) {
  if (group.denominator == null) return `${group.count}명 지목`
  return `${group.denominator}명 중 ${group.count}명 지목`
}

function stanceWidth(value: number, nAgents: number) {
  if (nAgents <= 0) return 0
  return Math.max(0, Math.min(100, (value / nAgents) * 100))
}
