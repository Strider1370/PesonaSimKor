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
      settings: { nAgents: 30, repeatCount: 3, modelProvider: "ollama", modelName: "qwen3.5:9b" },
      slots: [{ id: "A", presetId: "preset-a", policy: "policy A" }],
      results: [
        {
          slotId: "A",
          presetId: "preset-a",
          total: { support: 6, oppose: 3, neutral: 1 },
          stability: {
            supportMean: 60,
            supportStddev: 4.1,
            opposeMean: 30,
            opposeStddev: 2.2,
            neutralMean: 10,
            neutralStddev: 1,
          },
          realOpinion: {
            source: "Gallup",
            year: 2022,
            supportActual: 69,
            supportSimulated: 60,
            supportDiff: -9,
            opposeActual: 23,
            opposeSimulated: 30,
            opposeDiff: 7,
            note: "reference",
          },
        },
      ],
    }

    const csv = buildExperimentCsv(snapshot)

    expect(csv).toContain("snapshot_id,name,created_at")
    expect(csv).toContain("snapshot-1,test,2026-05-28T10:00:00.000Z")
    expect(csv).toContain("A,preset-a,30,3,ollama,qwen3.5:9b")
    expect(csv).toContain("6,3,1")
    expect(csv).toContain("Gallup,2022,69,60,-9")
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
              rationale: "rationale",
              blind_spot: "blind spot",
              affected_group: "affected group",
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
            concern_clusters: [{ label: "concern", count: 1, examples: ["example"] }],
            support_clusters: [],
            blind_spot_clusters: [{ affected_group: "affected group", count: 1, blind_spot_examples: ["blind spot"] }],
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
    expect(csv).toContain("blind spot")
    expect(csv).toContain("affected group")
    expect(csv).toContain("persona_link_direct")
    expect(csv).toContain("llm_prompt")
    expect(csv).toContain("summary_status")
    expect(csv).toContain("blind_spot_cluster")
    expect(csv).toContain("reframing")
  })
})
