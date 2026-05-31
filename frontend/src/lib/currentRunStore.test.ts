import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCurrentRun, getCurrentRunSnapshot, saveCurrentRun, saveExperimentRunAsCurrentRun } from "./currentRunStore"

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

describe("currentRunStore", () => {
  it("saves and restores the latest completed run", () => {
    saveCurrentRun({
      policy: "정책",
      n_agents: 5,
      model_name: "qwen3.5:9b",
      model_provider: "ollama",
      aggregate: {
        total: { support: 1, oppose: 0, neutral: 0 },
        by_age: {},
        by_gender: {},
        by_region: {},
        concern_clusters: [],
        support_clusters: [],
        blind_spot_clusters: [],
        reframing_list: [],
      },
      sampledAgents: [],
      completedAt: "2026-05-30T00:00:00.000Z",
    })

    expect(getCurrentRunSnapshot()?.policy).toBe("정책")
    expect(sessionStorage.getItem("koreansim-current-run")).toContain("정책")
  })

  it("saves an experiment run as the result current run", () => {
    saveExperimentRunAsCurrentRun({
      policy: "실험 정책",
      nAgents: 30,
      modelName: "gpt-5-mini",
      modelProvider: "openai",
      aggregate: {
        total: { support: 3, oppose: 1, neutral: 0 },
        by_age: {},
        by_gender: {},
        by_region: {},
        concern_clusters: [],
        support_clusters: [],
        blind_spot_clusters: [],
        reframing_list: [],
      },
      sampledAgents: [
        { agent_id: 1, age: 45, gender: "female", region: "서울-은평구", job: "teacher", age_group: "40s", region_group: "capital" },
      ],
      completedAt: "2026-05-30T00:00:00.000Z",
    })

    const currentRun = getCurrentRunSnapshot()
    expect(currentRun?.policy).toBe("실험 정책")
    expect(currentRun?.n_agents).toBe(30)
    expect(currentRun?.model_provider).toBe("openai")
    expect(currentRun?.sampledAgents[0].agent_id).toBe(1)
  })
})
