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
      responses: [
        {
          agent_id: 0,
          stance: "oppose",
          blind_spot: "가구 조건이 좁다",
          age: 27,
          province: "경기",
          district: "파주시",
          occupation: "무직",
          family_type: "3세대 동거",
        },
      ],
      structuredPolicy: { policy_name: { value: "청년 월세", source: "stated" } },
    } as any

    const vm = buildDashboard(run)

    expect(vm.policyHeader.name).toBe("청년 월세")
    expect(vm.stance).toEqual({ support: 1, neutral: 1, oppose: 1 })
    expect(vm.concerns[0].quote).toBe("가구 조건이 좁다")
    expect(vm.concerns[0].denominator).toBe(1)
    expect(vm.complaints[0].quote).toBe("대상자인가요?")
    expect(vm.personas[0].agentId).toBe(0)
    expect(vm.personas[0].headlineParts).toEqual(["응답자 #0", "27세", "경기 파주시"])
    expect(vm.personas[0].metaParts).toEqual(["무직", "3세대 동거"])
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

  it("uses district only when it already includes province", () => {
    const run = {
      policy: "policy",
      n_agents: 1,
      aggregate: {
        total: { support: 1, neutral: 0, oppose: 0 },
        blind_spot_clusters: [{ representative_quote: "우려", count: 1, agent_ids: [0] }],
      },
      responses: [
        {
          agent_id: 0,
          stance: "support",
          blind_spot: "우려",
          age: 62,
          province: "충청남",
          district: "충청남-논산시",
        },
      ],
    } as any

    const vm = buildDashboard(run)

    expect(vm.personas[0].headlineParts).toEqual(["응답자 #0", "62세", "충청남-논산시"])
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

  it("includes at least one representative for every stance present", () => {
    const run = {
      policy: "policy",
      n_agents: 3,
      aggregate: {
        total: { support: 2, neutral: 0, oppose: 1 },
        blind_spot_clusters: [{ representative_quote: "앱 가입이 어렵다", count: 1, agent_ids: [0] }],
        complaint_clusters: [{ representative_quote: "어디서 신청하나요?", count: 1, agent_ids: [1] }],
      },
      responses: [
        { agent_id: 0, stance: "support", rationale: "조건은 좋다.", blind_spot: "앱 가입이 어렵다" },
        { agent_id: 1, stance: "support", rationale: "혜택은 좋다.", expected_complaint: "어디서 신청하나요?" },
        { agent_id: 2, stance: "oppose", rationale: "나는 적용되는 교통수단이 없다." },
      ],
    } as any

    const vm = buildDashboard(run)

    expect(vm.personas.map((persona) => persona.agentId)).toEqual([0, 1, 2])
    expect(vm.personas.find((persona) => persona.stance === "oppose")?.rationale).toBe("나는 적용되는 교통수단이 없다.")
  })

  it("prioritizes different clusters and stances over repeated similar representatives", () => {
    const run = {
      policy: "policy",
      n_agents: 7,
      aggregate: {
        total: { support: 5, neutral: 1, oppose: 1 },
        blind_spot_clusters: [
          { representative_quote: "app signup is hard", count: 3, agent_ids: [0, 1, 2] },
          { representative_quote: "rural bus trips are excluded", count: 1, agent_ids: [3] },
        ],
        complaint_clusters: [{ representative_quote: "where do I get the refund?", count: 1, agent_ids: [4] }],
      },
      responses: [
        { agent_id: 0, stance: "support", rationale: "I support it but app signup is hard.", blind_spot: "app signup is hard" },
        { agent_id: 1, stance: "support", rationale: "App registration and signup are difficult.", blind_spot: "app signup is difficult" },
        { agent_id: 2, stance: "support", rationale: "The app signup process is hard to follow.", blind_spot: "app signup is hard to follow" },
        { agent_id: 3, stance: "support", rationale: "Rural buses are not covered.", blind_spot: "rural bus trips are excluded" },
        { agent_id: 4, stance: "support", rationale: "I need refund instructions.", expected_complaint: "where do I get the refund?" },
        { agent_id: 5, stance: "oppose", rationale: "I mostly use transport that is excluded." },
        { agent_id: 6, stance: "neutral", rationale: "I need to compare the signup burden and refund amount." },
      ],
    } as any

    const vm = buildDashboard(run)

    expect(vm.personas.map((persona) => persona.agentId)).toEqual([0, 3, 4, 5, 6])
    expect(vm.personas.map((persona) => persona.agentId)).not.toContain(1)
    expect(vm.personas.map((persona) => persona.agentId)).not.toContain(2)
  })

  it("keeps minority stance representatives when signal responses exceed the display limit", () => {
    const run = {
      policy: "policy",
      n_agents: 8,
      aggregate: {
        total: { support: 7, neutral: 0, oppose: 1 },
        blind_spot_clusters: [
          { representative_quote: "우려 0", count: 1, agent_ids: [0] },
          { representative_quote: "우려 1", count: 1, agent_ids: [1] },
          { representative_quote: "우려 2", count: 1, agent_ids: [2] },
          { representative_quote: "우려 3", count: 1, agent_ids: [3] },
          { representative_quote: "우려 4", count: 1, agent_ids: [4] },
          { representative_quote: "우려 5", count: 1, agent_ids: [5] },
          { representative_quote: "우려 6", count: 1, agent_ids: [6] },
        ],
        complaint_clusters: [],
      },
      responses: [
        ...Array.from({ length: 7 }, (_, agent_id) => ({ agent_id, stance: "support", rationale: `찬성 ${agent_id}`, blind_spot: `우려 ${agent_id}` })),
        { agent_id: 7, stance: "oppose", rationale: "소수 반대 의견" },
      ],
    } as any

    const vm = buildDashboard(run)

    expect(vm.personas).toHaveLength(6)
    expect(vm.personas.map((persona) => persona.agentId)).toContain(7)
    expect(vm.personas.find((persona) => persona.stance === "oppose")?.rationale).toBe("소수 반대 의견")
  })
})
