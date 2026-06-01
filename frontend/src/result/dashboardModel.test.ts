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

  it("consolidates similar blind spots and adds reasons to affected groups", () => {
    const run = {
      policy: "policy",
      n_agents: 4,
      aggregate: {
        total: { support: 4, neutral: 0, oppose: 0 },
        blind_spot_clusters: [
          {
            affected_group: "주민등록상 부모 세대에 남은 독립 청년",
            representative_quote: "주민등록상 부모 가구에 묶여 실제 독립 청년이 배제될 수 있다.",
            count: 1,
            denominator: 3,
            agent_ids: [0],
          },
          {
            affected_group: "가구원 동의가 어려운 별거 청년",
            representative_quote: "가구원 동의 때문에 가족과 연락이 끊긴 청년은 신청이 막힐 수 있다.",
            count: 1,
            denominator: 3,
            agent_ids: [1],
          },
          {
            affected_group: "프리랜서 청년",
            representative_quote: "프리랜서 소득 변동을 행정자료가 제대로 반영하지 못한다.",
            count: 1,
            denominator: 3,
            agent_ids: [2],
          },
        ],
        affected_group_clusters: [
          { representative_quote: "주민등록상 부모 세대에 남은 독립 청년", count: 1, denominator: 3, agent_ids: [0] },
          { representative_quote: "가구원 동의가 어려운 별거 청년", count: 1, denominator: 3, agent_ids: [1] },
          { representative_quote: "프리랜서 청년", count: 1, denominator: 3, agent_ids: [2] },
        ],
      },
      responses: [],
    } as any

    const vm = buildDashboard(run)

    expect(vm.concerns).toHaveLength(2)
    expect(vm.concerns[0]).toMatchObject({
      label: "가구 기준·가족 동의",
      count: 2,
      denominator: 3,
      agentIds: [0, 1],
    })
    expect(vm.affectedGroups).toHaveLength(2)
    expect(vm.affectedGroups[0]).toMatchObject({
      label: "가구 기준·가족 동의 영향 집단",
      count: 2,
      denominator: 3,
      agentIds: [0, 1],
    })
    expect(vm.affectedGroups[0].reason).toContain("가구원 동의")
  })

  it("keeps representative personas focused on concern and complaint responses", () => {
    const run = {
      policy: "policy",
      n_agents: 4,
      aggregate: {
        total: { support: 4, neutral: 0, oppose: 0 },
        blind_spot_clusters: [{ representative_quote: "앱 가입이 어렵다", count: 1, agent_ids: [2] }],
        complaint_clusters: [{ representative_quote: "어디서 신청하나요?", count: 1, agent_ids: [1] }],
      },
      responses: [
        { agent_id: 0, stance: "support", rationale: "그냥 좋습니다." },
        { agent_id: 1, stance: "support", rationale: "조건은 좋다.", expected_complaint: "어디서 신청하나요?" },
        { agent_id: 2, stance: "support", rationale: "혜택은 있다.", blind_spot: "앱 가입이 어렵다" },
        { agent_id: 3, stance: "support", rationale: "찬성합니다." },
      ],
    } as any

    const vm = buildDashboard(run)

    expect(vm.personas.map((persona) => persona.agentId)).toEqual([2, 1])
    expect(vm.personas.map((persona) => persona.rationale)).not.toContain("그냥 좋습니다.")
    expect(vm.personas.map((persona) => persona.rationale)).not.toContain("찬성합니다.")
  })
})
