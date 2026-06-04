import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { DiscoveryHeatmap } from "./DiscoveryHeatmap"
import type { DashboardAxisRow, DashboardHeatmapCell } from "./dashboardModel"

const rows: DashboardAxisRow[] = [
  {
    axis: "occupation_stratum",
    category: "unemployed_청년취준",
    presence: true,
    headcount: 2,
    population: 5,
    agentIds: [0, 3],
    featured: true,
  },
  {
    axis: "occupation_stratum",
    category: "3",
    presence: false,
    headcount: 0,
    population: 8,
    agentIds: [],
    featured: true,
  },
  {
    axis: "housing_stratum",
    category: "rent",
    presence: true,
    headcount: 1,
    population: 4,
    agentIds: [0],
    featured: false,
  },
]

const heatmap: DashboardHeatmapCell[] = [
  {
    key: "occupation_stratum|unemployed_청년취준__housing_stratum|rent",
    axis: "occupation_stratum",
    category: "unemployed_청년취준",
    secondaryAxis: "housing_stratum",
    secondaryCategory: "rent",
    presence: true,
    headcount: 1,
    population: 1,
    agentIds: [0],
    featured: true,
  },
]

describe("DiscoveryHeatmap", () => {
  it("renders presence and headcounts without percentages", () => {
    const html = renderToStaticMarkup(
      <DiscoveryHeatmap
        rows={rows}
        cells2d={heatmap}
        featuredAxis={{ primary: "occupation_stratum", secondary: "housing_stratum", rationale: "Occupation matters." }}
        nAgents={30}
      />,
    )

    expect(html).toContain("직업")
    expect(html).toContain("주거")
    expect(html).toContain("청년·취준")
    expect(html).toContain("2명")
    expect(html).toContain("모집단 5명")
    expect(html).toContain("heat-cell s3")
    expect(html).not.toContain("occupation_stratum")
    expect(html).not.toContain("unemployed_청년취준")
    expect(html).not.toContain("%")
  })

  it("shows all axis selector controls", () => {
    const html = renderToStaticMarkup(
      <DiscoveryHeatmap
        rows={rows}
        cells2d={[]}
        featuredAxis={{ primary: "occupation_stratum", secondary: null, rationale: "" }}
        nAgents={30}
      />,
    )

    ;["나이", "직업", "가구", "주거", "학력", "전공", "성별", "지역"].forEach((axis) => expect(html).toContain(axis))
    expect(html).not.toContain("age_band")
    expect(html).not.toContain("housing_stratum")
  })

  it("gates sparse 2D cells for small samples", () => {
    const html = renderToStaticMarkup(
      <DiscoveryHeatmap
        rows={rows}
        cells2d={heatmap}
        featuredAxis={{ primary: "occupation_stratum", secondary: "housing_stratum", rationale: "" }}
        nAgents={8}
      />,
    )

    expect(html).toContain("1D")
    expect(html).not.toContain("2D 조합")
    expect(html).not.toContain("occupation_stratum|unemployed_청년취준__housing_stratum|rent")
  })
})
