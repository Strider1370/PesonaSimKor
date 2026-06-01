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
          responses: [{ agent_id: 0, stance: "neutral", expected_complaint: "대상자?" } as any],
        },
      ],
    }

    const header = buildExperimentCsv(snapshot).split("\n")[0]

    expect(header).not.toMatch(/real_source|real_year|preset_id/)
    expect(header).toMatch(/expected_complaint/)
  })

  it("exports visible experiment detail rows", () => {
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
              stance_strength: "기울어짐",
              rationale: "rationale",
              caveat: "caveat",
              blind_spot: "blind spot",
              affected_group: "affected group",
              expected_complaint: "complaint",
              reframing: "reframing",
              persona_link: { direct: "direct", inferred: "inferred" },
            },
          ],
          summaryPrompt: {
            model: "gpt-5-mini",
            format: "json",
            messages: [{ role: "user", content: "summary prompt" }],
            options: {},
          },
          summaryStatus: { status: "completed", message: "summary ok", raw_output: "{}" },
          summaryOutput: "summary raw",
          aggregate: {
            total: { support: 0, oppose: 1, neutral: 0 },
            by_age: { "40s": { support: 0, oppose: 1, neutral: 0 } },
            by_gender: {},
            by_region: {},
            concern_clusters: [{ label: "concern", short_label: "concern", count: 1, examples: ["example"] }],
            support_clusters: [],
            blind_spot_clusters: [
              {
                affected_group: "affected group",
                short_title: "affected group",
                count: 1,
                denominator: 1,
                representative_quote: "blind spot",
                inferred_based: false,
                blind_spot_examples: ["blind spot"],
                agent_ids: [1],
              },
            ],
            reframing_list: [{ text: "reframing", age_group: "40s", gender: "female", region_group: "capital" }],
            blind_spot_raw: [{ blind_spot: "blind spot", affected_group: "affected group" }],
          },
        },
      ],
    }

    const csv = buildExperimentCsv(snapshot)

    expect(csv).toContain("row_type")
    expect(csv).toContain("sampled_agent")
    expect(csv).toContain("agent_response")
    expect(csv).toContain("stance_strength")
    expect(csv).toContain("caveat")
    expect(csv).toContain("blind spot")
    expect(csv).toContain("affected group")
    expect(csv).toContain("complaint")
    expect(csv).toContain("representative_quote")
    expect(csv).toContain("persona_link_direct")
    expect(csv).toContain("llm_prompt")
    expect(csv).toContain("summary_status")
    expect(csv).toContain("blind_spot_cluster")
    expect(csv).toContain("reframing")
  })

  it("does not duplicate aggregate run rows for a single run export", () => {
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
          aggregate: {
            total: { support: 1, oppose: 0, neutral: 0 },
            by_age: {},
            by_gender: {},
            by_region: {},
            concern_clusters: [],
            support_clusters: [],
            blind_spot_clusters: [],
            reframing_list: [],
            blind_spot_raw: [],
          },
          aggregateRuns: [
            {
              total: { support: 1, oppose: 0, neutral: 0 },
              by_age: {},
              by_gender: {},
              by_region: {},
              concern_clusters: [],
              support_clusters: [],
              blind_spot_clusters: [],
              reframing_list: [],
              blind_spot_raw: [],
            },
          ],
        },
      ],
    }

    const csv = buildExperimentCsv(snapshot)

    expect(csv).toContain("aggregate_total")
    expect(csv).not.toContain("aggregate_run_total")
  })
})
