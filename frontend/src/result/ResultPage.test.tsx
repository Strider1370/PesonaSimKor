import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCurrentRun } from "../lib/currentRunStore"
import { ResultPage } from "./ResultPage"

const storage = vi.hoisted(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal("sessionStorage", {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  return storage
})

beforeEach(() => {
  storage.clear()
  sessionStorage.clear()
  clearCurrentRun()
})

const fixtureRun = {
  policy: "Youth rent support",
  n_agents: 3,
  model_name: "gpt-5-mini",
  model_provider: "openai",
  completedAt: "2026-06-01T00:00:00.000Z",
  sampledAgents: [],
  structuredPolicy: {
    policy_name: { value: "Youth rent support", source: "stated" },
  },
  responses: [
    {
      agent_id: 0,
      age: 27,
      gender: "female",
      province: "Gyeonggi",
      district: "Gyeonggi Paju",
      occupation: "job seeker",
      family_type: "shared household",
      occupation_stratum: "unemployed_청년취준",
      household_stratum: "shared",
      housing_stratum: "rent",
      age_group: "20s",
      region_group: "capital",
      stance: "oppose",
      rationale: "Shared-household applicants may be excluded.",
      blind_spot: "household rules are too narrow",
      blind_spot_reason: "family consent and paperwork are hard",
      affected_group: "shared-household youth",
      grounding: "inferred",
      expected_complaint: "Am I eligible?",
    },
    {
      agent_id: 1,
      age: 33,
      gender: "male",
      province: "Seoul",
      district: "Mapo",
      occupation: "office worker",
      family_type: "single",
      age_group: "30s",
      region_group: "capital",
      stance: "support",
      rationale: "It reduces rent pressure.",
    },
  ],
  discoveryAggregate: {
    axes: {
      occupation_stratum: {
        "unemployed_청년취준": { presence: true, blind_spot_headcount: 1, agent_ids: [0], category_population: 1 },
      },
      housing_stratum: {
        rent: { presence: true, blind_spot_headcount: 1, agent_ids: [0], category_population: 2 },
      },
    },
    featured_axis: { primary: "occupation_stratum", secondary: "housing_stratum" },
  },
  discoverySummary: {
    merged_blind_spots: [{ label: "household rules", text: "household rules are too narrow", agent_ids: [0], grounding: "inferred" }],
    merged_reframings: [{ label: "add shared-household handling", agent_ids: [0] }],
    merged_complaints: [{ label: "Am I eligible?", agent_ids: [0] }],
    featured_axis_rationale: "Occupation strata reveal the affected group.",
  },
} as any

describe("ResultPage", () => {
  it("renders empty state when no current run exists", () => {
    const html = renderToStaticMarkup(<ResultPage onDebug={() => {}} />)

    expect(html).toContain("먼저 실행")
  })

  it("renders discovery dashboard blocks and response labels", () => {
    const html = renderToStaticMarkup(<ResultPage run={fixtureRun} onDebug={() => {}} />)

    expect(html).toContain("Youth rent support")
    expect(html).toContain("응답 페르소나")
    expect(html).toContain("표본 구성, 여론 아님")
    expect(html).toContain("사각지대")
    expect(html).toContain("반문")
    expect(html).toContain("민원")
    expect(html).toContain("직업")
    expect(html).toContain("주거")
    expect(html).toContain("청년·취준")
    expect(html).not.toContain("occupation_stratum")
    expect(html).not.toContain("housing_stratum")
    expect(html).not.toContain("unemployed_청년취준")
    expect(html).toContain("사각지대 묶음")
    expect(html).toContain("household rules")
    expect(html).toContain("household rules are too narrow")
    expect(html).toContain("1명")
    expect(html).toContain("추정")
    expect(html).toContain("Am I eligible?")
    // 영향 집단은 별도 섹션 폐지 — 대표 카드 안에만 표시 (재발 방지)
    expect(html).not.toContain("영향 집단")
    expect(html).toContain("shared-household youth")
    expect(html).toContain("family consent and paperwork are hard")
    expect(html).toContain("대표 페르소나 반응")
    expect(html).toContain("응답 #0")
    expect(html).toContain("27세")
    expect(html).toContain("Gyeonggi Paju")
    expect(html).toContain("job seeker")
    expect(html).toContain('class="signal danger"')
    expect(html).toContain('class="signal warning"')
    expect(html).not.toContain("%")
    expect(html).not.toContain("LLM summary")
  })

  it("renders persona field badge from persisted discovery run", () => {
    const run = {
      ...fixtureRun,
      responses: [],
      persona_depth: "standard",
      structuredPolicy: {
        policy_name: { value: "culture", source: "stated" },
        included_fields: ["age", "arts_persona"],
        relevant_optional_fields: ["arts_persona"],
      },
    } as any

    const html = renderToStaticMarkup(<ResultPage run={run} onDebug={() => {}} />)
    expect(html).toContain("예술 취향")
  })
})
