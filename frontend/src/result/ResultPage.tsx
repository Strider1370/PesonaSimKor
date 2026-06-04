import { useMemo, useState } from "react"
import "./result.css"
import "./resultDark.css"
import type { CurrentRun } from "../lib/currentRunStore"
import { getCurrentRunSnapshot, useCurrentRunStore } from "../lib/currentRunStore"
import { buildDashboard, filterPersonasByAgentIds, type DashboardAxisRow, type DashboardStanceAxis } from "./dashboardModel"
import { VoiceCard, type VoiceCardMode } from "./VoiceCard"
import { axisLabel, categoryLabel, stanceLabel } from "./labels"

type ResultPageProps = {
  run?: CurrentRun
  onDebug: () => void
  onOpenMain?: () => void
  darkMode?: boolean
}

type ResultTab = "blindspots" | "complaints" | "reframings" | "distribution"

const TABS: Array<{ id: ResultTab; label: string; tone: "danger" | "orange" | "purple" }> = [
  { id: "blindspots", label: "설계 미비 항목", tone: "danger" },
  { id: "complaints", label: "예상 민원 유형", tone: "orange" },
  { id: "reframings", label: "정책 전제 반문", tone: "purple" },
  { id: "distribution", label: "반응 분포", tone: "purple" },
]

export function ResultPage({ run, onDebug, onOpenMain, darkMode = false }: ResultPageProps) {
  const storedRun = useCurrentRunStore((state) => state.currentRun) ?? getCurrentRunSnapshot()
  const currentRun = run ?? storedRun
  const [selectedAgentIds, setSelectedAgentIds] = useState<number[] | null>(null)
  const [activeTab, setActiveTab] = useState<ResultTab>("blindspots")
  const [policyExpanded, setPolicyExpanded] = useState(false)

  const vm = useMemo(() => (currentRun ? buildDashboard(currentRun) : null), [currentRun])
  const filteredPersonas = useMemo(
    () => (vm ? filterPersonasByAgentIds(vm.personas, selectedAgentIds) : []),
    [vm, selectedAgentIds],
  )
  const blindspotPersonas = useMemo(
    () => filteredPersonas.filter((p) => p.blindSpot),
    [filteredPersonas],
  )
  const reframingPersonas = useMemo(
    () => filteredPersonas.filter((p) => p.reframing),
    [filteredPersonas],
  )

  if (!currentRun || !vm) {
    return (
      <main className="result-shell">
        <section className="result-empty panel">
          <h1>먼저 실행하세요</h1>
          <button type="button" onClick={onDebug}>
            입력으로 이동
          </button>
        </section>
      </main>
    )
  }

  const activeTone = TABS.find((tab) => tab.id === activeTab)?.tone ?? "danger"

  const completedDate = currentRun.completedAt
    ? new Date(currentRun.completedAt).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).replace(/\. /g, ".").replace(/\.$/, "")
    : ""

  return (
    <main className={`result-shell data-dashboard discovery-result${darkMode ? " dark" : ""}`}>
      <div className="result-topbar">
        <div className="result-topbar-left">
          <h1
            className={`result-topbar-title${policyExpanded ? " expanded" : ""}`}
            onClick={() => setPolicyExpanded((v) => !v)}
          >
            {vm.policyHeader.name}
          </h1>
          <p className="result-hint">{completedDate}</p>
          {policyExpanded && (
            <div className="policy-expand-content">
              <pre>{currentRun.policy}</pre>
            </div>
          )}
        </div>
        {onOpenMain && (
          <button type="button" className="secondary-button" onClick={onOpenMain}>
            입력
          </button>
        )}
      </div>

      <div className="summary-row">
        <MetricRow
          nAgents={vm.nAgents}
          blindSpotCount={vm.concerns.length}
          complaintCount={vm.complaints.length}
        />
        <DistributionRow
          stance={vm.stance}
          nAgents={vm.nAgents}
        />
      </div>

      <nav className="result-tabs" aria-label="result tabs">
        {TABS.map((tab) => (
          <button type="button" key={tab.id} className={`${tab.tone} ${activeTab === tab.id ? "active" : ""}`} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </nav>

      <section className="panel result-main-panel">
        {activeTab === "blindspots" && (
          <div className="result-tab-panel">
            <BlindspotPanel items={vm.concerns} onSelect={setSelectedAgentIds} />
            <VoiceGrid personas={blindspotPersonas} selected={Boolean(selectedAgentIds)} onClear={() => setSelectedAgentIds(null)} mode="blindspot" />
          </div>
        )}

        {activeTab === "complaints" && (
          <div className="result-tab-panel">
            <ComplaintPanel items={vm.complaints} onSelect={setSelectedAgentIds} />
            <VoiceGrid personas={filteredPersonas} selected={Boolean(selectedAgentIds)} onClear={() => setSelectedAgentIds(null)} mode="complaint" />
          </div>
        )}

        {activeTab === "reframings" && (
          <div className="result-tab-panel">
            <ReframingPanel items={vm.reframings} onSelect={setSelectedAgentIds} />
            <VoiceGrid personas={reframingPersonas} selected={Boolean(selectedAgentIds)} onClear={() => setSelectedAgentIds(null)} mode="reframing" />
          </div>
        )}

        {activeTab === "distribution" && (
          <div className="result-tab-panel">
            <DistributionTab vm={vm} />
          </div>
        )}
      </section>
    </main>
  )
}

function MetricRow({
  nAgents,
  blindSpotCount,
  complaintCount,
}: {
  nAgents: number
  blindSpotCount: number
  complaintCount: number
}) {
  return (
    <section className="metric-row">
      <div className="metric-tile">
        <div className="metric-label">페르소나 수</div>
        <div className="metric-val">{nAgents}명</div>
      </div>
      <div className="metric-tile">
        <div className="metric-label">설계 미비 항목</div>
        <div className="metric-val warning">{blindSpotCount}건</div>
      </div>
      <div className="metric-tile">
        <div className="metric-label">예상 민원 유형</div>
        <div className="metric-val info">{complaintCount}건</div>
      </div>
    </section>
  )
}

function DistributionRow({
  stance,
  nAgents,
}: {
  stance: ReturnType<typeof buildDashboard>["stance"]
  nAgents: number
}) {
  const total = nAgents || 1
  const supportPct = Math.round((stance.support / total) * 100)
  const neutralPct = Math.round((stance.neutral / total) * 100)
  const opposePct = 100 - supportPct - neutralPct

  return (
    <div className="distribution-row-single">
      <div className="dist-card">
        <div className="dist-card-label">전체 반응 분포</div>
        <div className="dist-bar-wrap">
          <div className="dist-seg support" style={{ flex: supportPct }}>{supportPct > 8 ? `${supportPct}%` : ""}</div>
          <div className="dist-seg neutral" style={{ flex: neutralPct }}>{neutralPct > 8 ? `${neutralPct}%` : ""}</div>
          <div className="dist-seg oppose" style={{ flex: opposePct }}>{opposePct > 8 ? `${opposePct}%` : ""}</div>
        </div>
        <div className="dist-legend">
          <span><span className="legend-dot support" />찬성</span>
          <span><span className="legend-dot neutral" />중립</span>
          <span><span className="legend-dot oppose" />반대</span>
        </div>
      </div>
    </div>
  )
}

function AffectedGroups({
  groups,
  onSelect,
}: {
  groups: ReturnType<typeof buildDashboard>["affectedGroups"]
  onSelect: (agentIds: number[]) => void
}) {
  return (
    <section className="panel-block affected-panel">
      <div className="section-title">
        <h2>영향 집단</h2>
      </div>
      {groups.length === 0 ? (
        <p className="dashboard-empty">지목된 집단 없음</p>
      ) : (
        <div className="affected-list">
          {groups.map((group) => (
            <button type="button" key={`${group.label}-${group.agentIds.join("-")}`} className="affected-row" onClick={() => onSelect(group.agentIds)}>
              <span>
                <b>{group.label}</b>
                {group.reason && <small>{group.reason}</small>}
              </span>
              <strong>{group.count}명</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function HouseholdStatus({ rows }: { rows: DashboardAxisRow[] }) {
  return (
    <section className="panel rail-household">
      <h2>가구 유형별 발견</h2>
      {rows.length === 0 ? (
        <p className="dashboard-empty">가구 데이터 없음</p>
      ) : (
        <div className="rail-bars">
          {rows.slice(0, 5).map((row) => (
            <div key={row.category} className="rail-bar-row">
              <span>{categoryLabel(row.category)}</span>
              <b>{row.headcount}명</b>
              <small>모집단 {row.population}명</small>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

const BS_INITIAL_LIMIT = 5

function DiscoveryPanel({
  items,
  chartTitle,
  tableColumnLabel,
  onSelect,
}: {
  items: ReturnType<typeof buildDashboard>["concerns"]
  chartTitle: string
  tableColumnLabel: string
  onSelect: (agentIds: number[]) => void
}) {
  const [expanded, setExpanded] = useState(false)

  if (items.length === 0) return <p className="dashboard-empty">표시할 항목이 없습니다.</p>
  const sorted = [...items].sort((a, b) => b.count - a.count)
  const visible = expanded ? sorted : sorted.slice(0, BS_INITIAL_LIMIT)
  const hidden = sorted.length - visible.length
  const maxCount = Math.max(...sorted.map((item) => item.count), 1)

  return (
    <div className="blindspot-panel">
      <div className="bs-card">
        <div className="bs-card-label">{chartTitle}</div>
        {visible.map((item) => {
          const barPct = Math.round((item.count / maxCount) * 100)
          const ratio = item.count / maxCount
          const barColor = ratio >= 0.75 ? "#1e3a8a" : ratio >= 0.5 ? "#2563eb" : ratio >= 0.25 ? "#60a5fa" : "#93c5fd"
          return (
            <div key={item.label} className="bs-bar-row">
              <span className="bs-bar-label">
                <span className="bs-item-badge">{item.label}</span>
              </span>
              <div className="bs-bar-track">
                <div className="bs-bar-fill" style={{ width: `${barPct}%`, background: barColor }}>
                  <span>{item.count}명</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="bs-card">
        <div className="bs-card-header">
          <div className="bs-card-label">항목별 상세</div>
          <span className="bs-card-hint">항목 클릭 시 관련 페르소나 반응이 표시됩니다</span>
        </div>
        <table className="bs-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{tableColumnLabel}</th>
              <th>상세 설명</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item, i) => (
              <tr key={item.label} onClick={() => onSelect(item.agentIds)} className="bs-table-row">
                <td className="bs-num">{i + 1}</td>
                <td className="bs-item-label">
                  <span className="bs-item-badge">{item.label}</span>
                </td>
                <td className="bs-desc">{item.quote !== item.label ? item.quote : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length > BS_INITIAL_LIMIT && (
        <button type="button" className="more-toggle" onClick={() => setExpanded(!expanded)}>
          {expanded ? "접기 ▴" : `${hidden}개 더 보기 ▾`}
        </button>
      )}
    </div>
  )
}

function BlindspotPanel({ items, onSelect }: { items: ReturnType<typeof buildDashboard>["concerns"]; onSelect: (agentIds: number[]) => void }) {
  return <DiscoveryPanel items={items} chartTitle="설계 미비 항목" tableColumnLabel="설계 미비 항목" onSelect={onSelect} />
}

function ComplaintPanel({ items, onSelect }: { items: ReturnType<typeof buildDashboard>["complaints"]; onSelect: (agentIds: number[]) => void }) {
  return <DiscoveryPanel items={items} chartTitle="예상 민원 유형" tableColumnLabel="민원 유형" onSelect={onSelect} />
}

function ReframingPanel({ items, onSelect }: { items: ReturnType<typeof buildDashboard>["reframings"]; onSelect: (agentIds: number[]) => void }) {
  return <DiscoveryPanel items={items} chartTitle="정책 전제 반문" tableColumnLabel="반문 유형" onSelect={onSelect} />
}

const VOICE_INITIAL_LIMIT = 4

function VoiceGrid({
  personas,
  selected,
  onClear,
  mode = "default",
}: {
  personas: ReturnType<typeof buildDashboard>["personas"]
  selected: boolean
  onClear: () => void
  mode?: VoiceCardMode
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded || selected ? personas : personas.slice(0, VOICE_INITIAL_LIMIT)
  const hidden = personas.length - visible.length

  return (
    <section className="voice-section">
      <div className="voice-section-head">
        <strong>대표 페르소나 반응</strong>
        {selected && (
          <button type="button" className="secondary-filter-button" onClick={onClear}>
            전체 보기
          </button>
        )}
      </div>
      {personas.length === 0 ? (
        <p className="dashboard-empty">표시할 대표 응답 없음</p>
      ) : (
        <>
          <div className="voice-grid">
            {visible.map((persona) => (
              <VoiceCard key={persona.agentId} persona={persona} mode={mode} />
            ))}
          </div>
          {hidden > 0 && (
            <button type="button" className="more-toggle" onClick={() => setExpanded(true)}>
              응답 {hidden}명 더 보기 ▾
            </button>
          )}
          {expanded && !selected && personas.length > VOICE_INITIAL_LIMIT && (
            <button type="button" className="more-toggle" onClick={() => setExpanded(false)}>
              접기 ▴
            </button>
          )}
        </>
      )}
    </section>
  )
}

function DistributionTab({ vm }: { vm: ReturnType<typeof buildDashboard> }) {
  const supportPersonas = vm.personas.filter((p) => p.stance === "support")
  const opposePersonas = vm.personas.filter((p) => p.stance === "oppose")
  const neutralPersonas = vm.personas.filter((p) => p.stance === "neutral")

  return (
    <div className="distribution-tab">
      <div>
        <div className="dist-section-title">반응 분포</div>
        <div className="div-axes-section">
          <div className="div-legend">
            <span className="div-legend-support">← 찬성</span>
            <span className="div-legend-oppose">반대 →</span>
          </div>
          {vm.stanceAxes.map((axis) => (
            <DivergingAxisChart key={axis.axis} axis={axis} />
          ))}
        </div>
      </div>

      <div>
        <div className="dist-section-title">페르소나 반응</div>
        <div className="stance-panels">
        <StancePanel stance="support" personas={supportPersonas} />
        <StancePanel stance="oppose" personas={opposePersonas} />
        <StancePanel stance="neutral" personas={neutralPersonas} />
        </div>
      </div>
    </div>
  )
}

function DivergingAxisChart({ axis }: { axis: DashboardStanceAxis }) {
  const scale = Math.max(...axis.rows.flatMap((r) => [r.support, r.oppose]), 1)

  return (
    <div className="div-axis-block">
      <div className="div-axis-title-row">
        <span className="div-axis-title">{axisLabel(axis.axis)}</span>
      </div>
      {axis.rows.map((row) => (
        <div key={row.category} className="div-chart-row">
          <span className="div-count support">{row.support || ""}</span>
          <div className="div-bar-left">
            {row.support > 0 && (
              <div className="div-bar-fill support" style={{ width: `${(row.support / scale) * 100}%` }} />
            )}
          </div>
          <div className="div-label">
            <span>{categoryLabel(row.category)}</span>
            {row.neutral > 0 && <span className="div-neutral">중립 {row.neutral}</span>}
          </div>
          <div className="div-bar-right">
            {row.oppose > 0 && (
              <div className="div-bar-fill oppose" style={{ width: `${(row.oppose / scale) * 100}%` }} />
            )}
          </div>
          <span className="div-count oppose">{row.oppose || ""}</span>
        </div>
      ))}
    </div>
  )
}

const STANCE_PANEL_LIMIT = 3

function StancePanel({
  stance,
  personas,
}: {
  stance: "support" | "oppose" | "neutral"
  personas: ReturnType<typeof buildDashboard>["personas"]
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? personas : personas.slice(0, STANCE_PANEL_LIMIT)
  const hidden = personas.length - visible.length

  return (
    <div className="stance-panel">
      <div className="stance-panel-head">
        <strong className={`stance-pill ${stance}`}>{stanceLabel(stance)}</strong>
        <span className="stance-panel-count">{personas.length}명</span>
      </div>
      <div className="stance-persona-list">
        {personas.length === 0 ? (
          <p className="dashboard-empty">해당 없음</p>
        ) : (
          <>
            {visible.map((persona) => (
              <VoiceCard key={persona.agentId} persona={persona} mode="default" />
            ))}
            {hidden > 0 && (
              <button type="button" className="more-toggle" onClick={() => setExpanded(true)}>
                {hidden}명 더 보기 ▾
              </button>
            )}
            {expanded && personas.length > STANCE_PANEL_LIMIT && (
              <button type="button" className="more-toggle" onClick={() => setExpanded(false)}>
                접기 ▴
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
