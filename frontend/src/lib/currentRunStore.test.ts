import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCurrentRun, getCurrentRunSnapshot, saveCurrentRun, saveExperimentRunAsCurrentRun } from "./currentRunStore"
import type { DiscoverySummary } from "./api"

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

const aggregate = {
  total: { support: 1, oppose: 0, neutral: 0 },
  by_age: {},
  by_gender: {},
  by_region: {},
  concern_clusters: [],
  support_clusters: [],
  blind_spot_clusters: [],
  reframing_list: [],
}

const discoveryAggregate = {
  axes: {
    occupation_stratum: {
      "3": { presence: true, blind_spot_headcount: 1, agent_ids: [1], category_population: 4 },
    },
  },
  featured_axis: { primary: "occupation_stratum", secondary: null },
}

const discoverySummary: DiscoverySummary = {
  merged_blind_spots: [{ label: "access", text: "late-night access", agent_ids: [1], grounding: "direct" }],
  merged_reframings: [{ label: "offline", agent_ids: [1] }],
  merged_complaints: [{ label: "where apply", agent_ids: [1] }],
  featured_axis_rationale: "Occupation groups expose access barriers.",
}

beforeEach(() => {
  storage.clear()
  sessionStorage.clear()
  clearCurrentRun()
})

describe("currentRunStore", () => {
  it("saves and restores the latest completed run", () => {
    saveCurrentRun({
      policy: "policy",
      n_agents: 5,
      model_name: "gpt-5-mini",
      model_provider: "openai",
      discoveryAggregate,
      discoverySummary,
      sampledAgents: [],
      responses: [],
      completedAt: "2026-05-30T00:00:00.000Z",
    })

    expect(getCurrentRunSnapshot()?.policy).toBe("policy")
    expect(sessionStorage.getItem("koreansim-current-run")).toContain("policy")
  })

  it("saves an experiment run as the result current run", () => {
    saveExperimentRunAsCurrentRun({
      policy: "experiment policy",
      nAgents: 30,
      modelName: "gpt-5-mini",
      modelProvider: "openai",
      discoveryAggregate,
      discoverySummary,
      sampledAgents: [
        { agent_id: 1, age: 45, gender: "female", region: "Seoul", job: "teacher", age_group: "40s", region_group: "capital" },
      ],
      completedAt: "2026-05-30T00:00:00.000Z",
    })

    const currentRun = getCurrentRunSnapshot()
    expect(currentRun?.policy).toBe("experiment policy")
    expect(currentRun?.n_agents).toBe(30)
    expect(currentRun?.model_provider).toBe("openai")
    expect(currentRun?.discoveryAggregate?.featured_axis.primary).toBe("occupation_stratum")
    expect(currentRun?.sampledAgents[0].agent_id).toBe(1)
  })

  it("persists experiment responses and structured policy", () => {
    saveExperimentRunAsCurrentRun({
      policy: "youth rent",
      nAgents: 1,
      modelName: "gpt-5-mini",
      discoveryAggregate,
      discoverySummary,
      sampledAgents: [],
      responses: [{ agent_id: 0, stance: "neutral" }],
      structuredPolicy: { policy_name: { value: "youth rent", source: "stated" } },
    } as any)

    const currentRun = getCurrentRunSnapshot()
    expect(currentRun?.responses?.[0].agent_id).toBe(0)
    expect(currentRun?.structuredPolicy?.policy_name?.value).toBe("youth rent")
  })

  it("preserves persona_depth and defaults legacy runs to standard", () => {
    saveCurrentRun({
      policy: "p",
      n_agents: 5,
      model_name: "gpt-5-mini",
      model_provider: "openai",
      discoveryAggregate,
      sampledAgents: [],
      responses: [],
      structuredPolicy: { policy_name: { value: "youth rent", source: "stated" } },
      persona_depth: "full",
      completedAt: "t",
    })
    expect(getCurrentRunSnapshot()?.persona_depth).toBe("full")
  })
})
