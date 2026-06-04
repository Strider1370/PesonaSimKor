import { useState } from "react"
import type { DashboardAxisRow, DashboardFeaturedAxis, DashboardHeatmapCell } from "./dashboardModel"
import { axisLabel, categoryLabel } from "./labels"

const AXES = [
  "age_band",
  "occupation_stratum",
  "household_stratum",
  "housing_stratum",
  "education_stratum",
  "field_stratum",
  "gender",
  "region_group",
]

const TWO_D_MIN_AGENTS = 10

export function DiscoveryHeatmap({
  rows,
  cells2d,
  featuredAxis,
  nAgents,
}: {
  rows: DashboardAxisRow[]
  cells2d: DashboardHeatmapCell[]
  featuredAxis: DashboardFeaturedAxis
  nAgents: number
}) {
  const primaryRows = rows.filter((row) => row.axis === featuredAxis.primary)
  const canShow2d = Boolean(featuredAxis.secondary) && nAgents >= TWO_D_MIN_AGENTS && cells2d.length > 0
  const [show2d, setShow2d] = useState(false)

  return (
    <section className="discovery-heatmap panel-block">
      <div className="heatmap-toolbar">
        <span className="hint-label">축</span>
        <div className="axis-tabs" aria-label="discovery axes">
          {AXES.map((axis) => (
            <button type="button" key={axis} className={axis === featuredAxis.primary ? "active" : ""}>
              {axisLabel(axis)}
            </button>
          ))}
        </div>
        {canShow2d ? (
          <button type="button" className="mode-chip" onClick={() => setShow2d((value) => !value)}>
            {show2d ? "2D 끄기" : "2D 보기"}
          </button>
        ) : (
          <span className="mode-chip">1D</span>
        )}
      </div>

      <div className="heatmap-summary">
        <strong>{axisLabel(featuredAxis.primary)}</strong>
        {featuredAxis.secondary && <span>× {axisLabel(featuredAxis.secondary)}</span>}
        {featuredAxis.rationale && <p>{featuredAxis.rationale}</p>}
      </div>

      {primaryRows.length === 0 ? (
        <p className="dashboard-empty">표시할 발견 범주가 없습니다.</p>
      ) : (
        <div className="heat-strip">
          {primaryRows.map((row) => (
            <HeatCell key={`${row.axis}-${row.category}`} row={row} />
          ))}
        </div>
      )}

      {show2d && canShow2d && (
        <div className="heatmap-2d">
          <h3>
            {axisLabel(featuredAxis.primary)} × {axisLabel(featuredAxis.secondary ?? "")}
          </h3>
          <HeatMatrix cells={cells2d} />
        </div>
      )}
    </section>
  )
}

function HeatMatrix({ cells }: { cells: DashboardHeatmapCell[] }) {
  const rowCats = [...new Set(cells.map((cell) => cell.category))]
  const colCats = [...new Set(cells.map((cell) => cell.secondaryCategory))]
  const byKey = new Map(cells.map((cell) => [`${cell.category}__${cell.secondaryCategory}`, cell]))

  return (
    <table className="heat-matrix">
      <thead>
        <tr>
          <th aria-hidden />
          {colCats.map((col) => (
            <th key={col} scope="col">
              {categoryLabel(col)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rowCats.map((row) => (
          <tr key={row}>
            <th scope="row">{categoryLabel(row)}</th>
            {colCats.map((col) => {
              const cell = byKey.get(`${row}__${col}`)
              const headcount = cell?.headcount ?? 0
              return (
                <td
                  key={col}
                  className={`matrix-cell ${strengthClass(headcount)} ${cell && isMarginal(cell) ? "marginal" : ""}`}
                  title={cell ? `${categoryLabel(row)} × ${categoryLabel(col)} · ${headcount}명 / 모집단 ${cell.population}명` : ""}
                >
                  {headcount > 0 ? headcount : "·"}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function HeatCell({ row }: { row: DashboardAxisRow }) {
  return (
    <article className={`heat-cell ${strengthClass(row.headcount)} ${isMarginal(row) ? "marginal" : ""}`}>
      <span>{categoryLabel(row.category)}</span>
      <strong>{row.headcount > 0 ? `${row.headcount}명` : "·"}</strong>
      <small>모집단 {row.population}명</small>
      {isMarginal(row) && <em>소수</em>}
    </article>
  )
}

function strengthClass(headcount: number) {
  if (headcount >= 4) return "s4"
  if (headcount >= 2) return "s3"
  if (headcount === 1) return "s2"
  return "s0"
}

function isMarginal(row: Pick<DashboardAxisRow, "population" | "headcount">) {
  return row.population < 3 || row.headcount < 2
}
