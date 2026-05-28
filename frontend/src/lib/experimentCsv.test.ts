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
})
