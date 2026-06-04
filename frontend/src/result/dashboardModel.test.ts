import { describe, expect, it } from "vitest"

import { axisRows, buildDashboard, heatmap2D } from "./dashboardModel"
import type { CurrentRun } from "../lib/currentRunStore"

const run: CurrentRun = {
  policy: "Youth rent support",
  n_agents: 4,
  model_name: "gpt-5-mini",
  model_provider: "openai",
  completedAt: "2026-06-01T00:00:00.000Z",
  sampledAgents: [],
  structuredPolicy: {
    policy_name: { value: "Youth rent support", source: "stated" },
    included_fields: ["age", "occupation"],
    relevant_optional_fields: ["occupation"],
  },
  responses: [
    {
      agent_id: 0,
      age: 27,
      age_group: "20s",
      gender: "female",
      region_group: "capital",
      occupation_stratum: "unemployed_청년취준",
      household_stratum: "single",
      housing_stratum: "rent",
      education_stratum: "college",
      field_stratum: "etc",
      stance: "oppose",
      rationale: "Application timing is hard.",
      blind_spot: "offline access gap",
      blind_spot_reason: "job seekers may lack stable paperwork",
      affected_group: "job seekers",
      grounding: "inferred",
      expected_complaint: "Where do I apply?",
    },
    {
      agent_id: 1,
      age: 33,
      age_group: "30s",
      gender: "male",
      region_group: "capital",
      occupation_stratum: "3",
      household_stratum: "couple",
      housing_stratum: "rent",
      education_stratum: "college",
      field_stratum: "admin",
      stance: "support",
      rationale: "Rent pressure is lower.",
      blind_spot: "",
      affected_group: "",
    },
    {
      agent_id: 2,
      age: 62,
      age_group: "60s",
      gender: "female",
      region_group: "honam",
      occupation_stratum: "unemployed_노년은퇴",
      household_stratum: "single",
      housing_stratum: "owner",
      education_stratum: "high",
      field_stratum: "etc",
      stance: "neutral",
      rationale: "Older renters may not be targeted.",
      blind_spot: "senior renters excluded",
      blind_spot_reason: "age-targeted eligibility misses older renters",
      affected_group: "senior renters",
      grounding: "direct",
    },
  ],
  discoveryAggregate: {
    axes: {
      occupation_stratum: {
        "unemployed_청년취준": { presence: true, blind_spot_headcount: 1, agent_ids: [0], category_population: 1 },
        "3": { presence: false, blind_spot_headcount: 0, agent_ids: [], category_population: 1 },
        "unemployed_노년은퇴": { presence: true, blind_spot_headcount: 1, agent_ids: [2], category_population: 1 },
      },
      housing_stratum: {
        rent: { presence: true, blind_spot_headcount: 1, agent_ids: [0], category_population: 2 },
        owner: { presence: true, blind_spot_headcount: 1, agent_ids: [2], category_population: 1 },
      },
    },
    featured_axis: { primary: "occupation_stratum", secondary: "housing_stratum" },
  },
  discoverySummary: {
    merged_blind_spots: [
      { label: "offline access", text: "offline access gap", agent_ids: [0], grounding: "inferred" },
      { label: "senior renters", text: "senior renters excluded", agent_ids: [2], grounding: "direct" },
    ],
    merged_reframings: [{ label: "add offline intake", agent_ids: [0] }],
    merged_complaints: [{ label: "where apply", agent_ids: [0] }],
    featured_axis_rationale: "Occupation strata reveal who faces discovery gaps.",
  },
}

describe("buildDashboard", () => {
  it("builds discovery dashboard blocks from currentRun", () => {
    const vm = buildDashboard(run)

    expect(vm.policyHeader.name).toBe("Youth rent support")
    expect(vm.stance).toEqual({ support: 1, neutral: 1, oppose: 1 })
    expect(vm.featuredAxis).toEqual({
      primary: "occupation_stratum",
      secondary: "housing_stratum",
      rationale: "Occupation strata reveal who faces discovery gaps.",
    })
    expect(vm.concerns.map((item) => item.label)).toEqual(["offline access", "senior renters"])
    expect(vm.concerns[0]).toMatchObject({ quote: "offline access gap", count: 1, inferredBased: true, agentIds: [0] })
    expect(vm.complaints[0]).toMatchObject({ label: "where apply", count: 1, agentIds: [0] })
    expect(vm.affectedGroups.map((item) => item.label)).toEqual(["job seekers", "senior renters"])
    expect(vm.personas.map((persona) => persona.agentId)).toEqual([0, 2, 1])
    expect(vm.personas[0].blindSpotReason).toBe("job seekers may lack stable paperwork")
  })

  it("collects and sorts 8-axis discovery rows without rates", () => {
    const rows = axisRows(run.discoveryAggregate!, "occupation_stratum")

    expect(rows.map((row) => row.category)).toEqual(["unemployed_노년은퇴", "unemployed_청년취준", "3"])
    expect(rows[0]).toMatchObject({
      axis: "occupation_stratum",
      presence: true,
      headcount: 1,
      population: 1,
      agentIds: [2],
    })
    expect(rows[0]).not.toHaveProperty("rate")
  })

  it("builds explicit 2D heatmap keys for featured axes", () => {
    const cells = heatmap2D(run.discoveryAggregate!, "occupation_stratum", "housing_stratum")

    expect(cells.map((cell) => cell.key)).toContain("occupation_stratum|unemployed_청년취준__housing_stratum|rent")
    expect(cells.find((cell) => cell.key.includes("청년취준"))).toMatchObject({
      presence: true,
      headcount: 1,
      population: 1,
      agentIds: [0],
    })
  })
})
