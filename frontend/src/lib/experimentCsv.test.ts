import { describe, expect, it } from "vitest"

import { buildExperimentCsv, csvEscape } from "./experimentCsv"
import type { ExperimentSnapshot } from "./experimentStorage"

describe("experiment CSV", () => {
  it("escapes commas, quotes, and newlines", () => {
    expect(csvEscape('a,b "c"\nd')).toBe('"a,b ""c""\nd"')
  })

  it("builds CSV rows from a snapshot", () => {
    const snapshot: ExperimentSnapshot = {
      id: "snapshot-1",
      createdAt: "2026-05-28T10:00:00.000Z",
      name: "test",
      settings: { nAgents: 30, repeatCount: 3, modelProvider: "openai", modelName: "gpt-5-mini" },
      slots: [{ id: "A", presetId: "", policy: "policy A" }],
      results: [
        {
          slotId: "A",
          presetId: "",
          total: { support: 6, oppose: 3, neutral: 1 },
          stability: {
            supportMean: 60,
            supportStddev: 4.1,
            opposeMean: 30,
            opposeStddev: 2.2,
            neutralMean: 10,
            neutralStddev: 1,
          },
        },
      ],
    }

    const csv = buildExperimentCsv(snapshot)

    expect(csv).toContain("snapshot_id,name,created_at")
    expect(csv).toContain("snapshot-1,test,2026-05-28T10:00:00.000Z")
    expect(csv).toContain("A,30,3,openai,gpt-5-mini")
    expect(csv).toContain("6,3,1")
    expect(csv).not.toContain("Gallup,2022,69,60,-9")
  })

  it("csv header drops prior/preset and adds expected_complaint", () => {
    const snapshot: ExperimentSnapshot = {
      id: "snapshot-1",
      createdAt: "2026-06-01T00:00:00.000Z",
      name: "pivot",
      settings: { nAgents: 1, repeatCount: 1, modelProvider: "openai", modelName: "gpt-5-mini" },
      slots: [{ id: "A", presetId: "", policy: "policy A" }],
      results: [
        {
          slotId: "A",
          presetId: "",
          total: { support: 0, oppose: 0, neutral: 1 },
          responses: [{ agent_id: 0, stance: "neutral", expected_complaint: "where apply" } as any],
        },
      ],
    }

    const header = buildExperimentCsv(snapshot).split("\n")[0]

    expect(header).not.toMatch(/real_source|real_year|preset_id/)
    expect(header).toMatch(/expected_complaint/)
  })

  it("exports discovery detail rows without legacy summary or response fields", () => {
    const snapshot: ExperimentSnapshot = {
      id: "snapshot-1",
      createdAt: "2026-05-28T10:00:00.000Z",
      name: "detail",
      settings: { nAgents: 1, repeatCount: 1, modelProvider: "openai", modelName: "gpt-5-mini" },
      slots: [{ id: "A", presetId: "preset-a", policy: "policy A" }],
      results: [
        {
          slotId: "A",
          presetId: "preset-a",
          total: { support: 0, oppose: 1, neutral: 0 },
          sampledAgents: [
            {
              agent_id: 7,
              age: 42,
              gender: "female",
              region: "Seoul",
              job: "driver",
              age_group: "40s",
              region_group: "capital",
            },
          ],
          llmPrompts: [
            {
              agent_id: 7,
              model: "gpt-5-mini",
              format: "json",
              messages: [{ role: "system", content: "system prompt" }],
              options: {},
            },
          ],
          llmOutputs: { 7: "raw output" },
          llmStatuses: { 7: "completed" },
          responses: [
            {
              agent_id: 7,
              age_group: "40s",
              gender: "female",
              region_group: "capital",
              stance: "oppose",
              rationale: "rationale",
              blind_spot: "blind spot",
              blind_spot_reason: "late-night shift",
              affected_group: "affected group",
              grounding: "direct",
              expected_complaint: "complaint",
              reframing: "reframing",
              occupation_stratum: "3",
              household_stratum: "single",
              housing_stratum: "rent",
              education_stratum: "college",
              field_stratum: "health",
              classification_source: "explicit",
            },
          ],
          discoveryAggregate: {
            axes: {
              occupation_stratum: {
                "3": { presence: true, blind_spot_headcount: 1, agent_ids: [7], category_population: 2 },
              },
            },
            featured_axis: { primary: "occupation_stratum", secondary: null },
          },
          discoverySummary: {
            merged_blind_spots: [{ label: "blind spot", text: "blind spot", agent_ids: [7], grounding: "direct" }],
            merged_reframings: [{ label: "reframing", agent_ids: [7] }],
            merged_complaints: [{ label: "complaint", agent_ids: [7] }],
            featured_axis_rationale: "Occupation groups expose access barriers.",
          },
        },
      ],
    }

    const csv = buildExperimentCsv(snapshot)

    expect(csv).toContain("row_type")
    expect(csv).toContain("sampled_agent")
    expect(csv).toContain("agent_response")
    expect(csv).not.toContain("stance_strength")
    expect(csv).not.toContain("caveat")
    expect(csv).not.toContain("persona_link_direct")
    expect(csv).not.toContain("summary_status")
    expect(csv).not.toContain("aggregate_total")
    expect(csv).toContain("blind spot")
    expect(csv).toContain("late-night shift")
    expect(csv).toContain("occupation_stratum")
    expect(csv).toContain("discovery_axis_cell")
    expect(csv).toContain("discovery_merged_blind_spot")
    expect(csv).toContain("reframing")
  })

  it("does not duplicate discovery aggregate run rows for a single run export", () => {
    const snapshot: ExperimentSnapshot = {
      id: "snapshot-1",
      createdAt: "2026-05-28T10:00:00.000Z",
      name: "single-run",
      settings: { nAgents: 1, repeatCount: 1, modelProvider: "openai", modelName: "gpt-5-mini" },
      slots: [{ id: "A", presetId: "preset-a", policy: "policy A" }],
      results: [
        {
          slotId: "A",
          presetId: "preset-a",
          total: { support: 1, oppose: 0, neutral: 0 },
          discoveryAggregate: {
            axes: {},
            featured_axis: { primary: "occupation_stratum", secondary: null },
          },
          discoveryAggregateRuns: [
            {
              axes: {},
              featured_axis: { primary: "occupation_stratum", secondary: null },
            },
          ],
        },
      ],
    }

    const csv = buildExperimentCsv(snapshot)

    expect(csv).toContain("discovery_aggregate")
    expect(csv).not.toContain("discovery_aggregate_run")
  })
})
