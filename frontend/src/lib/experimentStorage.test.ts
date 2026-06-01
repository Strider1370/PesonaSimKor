import { afterEach, describe, expect, it, vi } from "vitest"

import {
  deleteExperimentSnapshot,
  listExperimentSnapshots,
  loadExperimentSnapshot,
  saveExperimentSnapshot,
} from "./experimentStorage"

const storage = new Map<string, string>()

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
})

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe("experiment snapshot storage", () => {
  it("saves and lists snapshots newest first", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-28T10:00:00Z"))
    const first = saveExperimentSnapshot({
      name: "first",
      settings: { nAgents: 30, repeatCount: 1 },
      slots: [{ id: "A", presetId: "1_1_neutral_no_context_explicit_base", policy: "policy A" }],
      results: [],
    })

    vi.setSystemTime(new Date("2026-05-28T10:01:00Z"))
    const second = saveExperimentSnapshot({
      name: "second",
      settings: { nAgents: 30, repeatCount: 1 },
      slots: [{ id: "A", presetId: "2_1_neutral_no_context_explicit_base", policy: "policy B" }],
      results: [],
    })

    expect(listExperimentSnapshots().map((snapshot) => snapshot.id)).toEqual([second.id, first.id])
  })

  it("loads and deletes a snapshot", () => {
    const saved = saveExperimentSnapshot({
      name: "load me",
      settings: { nAgents: 10, repeatCount: 3 },
      slots: [{ id: "A", presetId: "", policy: "direct input" }],
      results: [],
    })

    expect(loadExperimentSnapshot(saved.id)?.name).toBe("load me")
    deleteExperimentSnapshot(saved.id)
    expect(loadExperimentSnapshot(saved.id)).toBeNull()
  })

  it("snapshot round-trips structuredPolicy and responses", () => {
    const saved = saveExperimentSnapshot({
      name: "pivot",
      settings: { nAgents: 1, repeatCount: 1 },
      slots: [{ id: "A", presetId: "", policy: "청년 월세" }],
      results: [
        {
          slotId: "A",
          presetId: "",
          total: { support: 0, oppose: 0, neutral: 1 },
          responses: [
            {
              agent_id: 0,
              age_group: "20s",
              gender: "female",
              region_group: "capital",
              stance: "neutral",
              rationale: "대상인지 궁금합니다.",
              expected_complaint: "대상자?",
            },
          ],
        },
      ],
      structuredPolicy: { policy_name: { value: "월세", source: "stated" } },
    })

    const loaded = loadExperimentSnapshot(saved.id)

    expect(loaded?.structuredPolicy?.policy_name?.value).toBe("월세")
    expect(loaded?.results[0].responses?.[0].expected_complaint).toBe("대상자?")
  })

  it("returns an empty list when localStorage contains invalid JSON", () => {
    localStorage.setItem("koreansim.experiment.snapshots.v1", "not json")

    expect(listExperimentSnapshots()).toEqual([])
  })
})
