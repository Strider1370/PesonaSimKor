import { describe, expect, it } from "vitest"

import { buildDashboard } from "./dashboardModel"

describe("buildDashboard", () => {
  it("builds dashboard blocks from currentRun", () => {
    const run = {
      n_agents: 3,
      aggregate: {
        total: { support: 1, neutral: 1, oppose: 1 },
        blind_spot_clusters: [
          {
            representative_quote: "가구 조건이 좁다",
            count: 1,
            denominator: 1,
            inferred_based: false,
            agent_ids: [0],
          },
        ],
        complaint_clusters: [{ representative_quote: "대상자인가요?", count: 1, agent_ids: [1] }],
      },
      responses: [{ agent_id: 0, stance: "oppose", blind_spot: "가구 조건이 좁다", age: 27 }],
      structuredPolicy: { policy_name: { value: "청년 월세", source: "stated" } },
    } as any

    const vm = buildDashboard(run)

    expect(vm.policyHeader.name).toBe("청년 월세")
    expect(vm.stance).toEqual({ support: 1, neutral: 1, oppose: 1 })
    expect(vm.concerns[0].quote).toBe("가구 조건이 좁다")
    expect(vm.concerns[0].denominator).toBe(1)
    expect(vm.complaints[0].quote).toBe("대상자인가요?")
    expect(vm.personas[0].agentId).toBe(0)
  })
})
