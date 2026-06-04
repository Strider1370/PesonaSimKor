import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import { buildSimulateBody, getHealth, listProjectCsvExports, loadProjectCsvExport, parseSseChunk, saveProjectCsvExport } from "./api"
import type { PersonaDepth, SimulateRequest, StructuredPolicyWithPromptFields } from "./api"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("parseSseChunk", () => {
  it("carries optional prompt metadata", () => {
    const value: StructuredPolicyWithPromptFields = {
      policy_name: { value: "x", source: "stated" },
      relevant_optional_fields: ["arts_persona"],
      included_fields: ["age", "occupation"],
      persona_depth: "standard",
    }
    expectTypeOf(value.persona_depth).toEqualTypeOf<PersonaDepth | undefined>()
  })

  it("allows experiment options in simulate request type", () => {
    const request: SimulateRequest = {
      policy: "policy",
      n_agents: 30,
      model_name: "gpt-5-mini",
      persona_depth: "full",
    }

    expect(request.model_provider).toBeUndefined()
    expect(request.model_name).toBe("gpt-5-mini")
  })

  it("allows blind spot response and legacy aggregate fields in compatibility types", () => {
    const response = {
      agent_id: 1,
      age_group: "40s",
      gender: "female",
      region_group: "capital",
      stance: "oppose",
      rationale: "financial burden",
      blind_spot: "deposit conversion risk",
      affected_group: "renters",
      reframing: "stabilize financing first",
    } satisfies import("./api").AgentRespondedEvent

    const aggregate = {
      total: { support: 0, oppose: 1, neutral: 0 },
      by_age: {},
      by_gender: {},
      by_region: {},
      concern_clusters: [{ label: "burden", short_label: "burden", count: 1, examples: ["burden"] }],
      support_clusters: [],
      blind_spot_clusters: [
        {
          affected_group: "renters",
          short_title: "renters",
          count: 1,
          blind_spot_examples: ["deposit conversion risk"],
          agent_ids: [1],
        },
      ],
      reframing_list: [{ text: "finance first", age_group: "40s", gender: "female", region_group: "capital" }],
    } satisfies import("./api").AggregateEvent

    expect(response.blind_spot).toBe("deposit conversion risk")
    expect(aggregate.blind_spot_clusters[0].count).toBe(1)
  })

  it("allows discovery response tags and discovery event types", () => {
    const response = {
      agent_id: 1,
      age_group: "40s",
      gender: "female",
      region_group: "capital",
      stance: "oppose",
      rationale: "burden",
      blind_spot: "application access",
      blind_spot_reason: "night work schedule",
      affected_group: "shift workers",
      grounding: "direct",
      occupation_stratum: "3",
      household_stratum: "couple_children",
      housing_stratum: "apartment",
      education_stratum: "college",
      field_stratum: "admin",
    } satisfies import("./api").AgentRespondedEvent

    const aggregate = {
      axes: {
        occupation_stratum: {
          "3": { presence: true, blind_spot_headcount: 1, agent_ids: [1], category_population: 2 },
        },
      },
      featured_axis: { primary: "occupation_stratum", secondary: null },
    } satisfies import("./api").DiscoveryAggregate

    const summary = {
      merged_blind_spots: [{ label: "access", text: "application access", agent_ids: [1], grounding: "direct" }],
      merged_reframings: [{ label: "async", agent_ids: [1] }],
      merged_complaints: [{ label: "where apply", agent_ids: [1] }],
      featured_axis_rationale: "Occupation exposes access barriers.",
    } satisfies import("./api").DiscoverySummary

    const events: import("./api").SimulateEvent[] = [
      { type: "discovery_aggregate", data: aggregate },
      { type: "discovery_summary", data: summary },
    ]

    expect(response.grounding).toBe("direct")
    expect(events[0].type).toBe("discovery_aggregate")
  })

  it("parses events split across chunks", () => {
    let buffer = ""
    const first = parseSseChunk('event: agent_responded\ndata: {"agent_id":', buffer)
    buffer = first.buffer

    const second = parseSseChunk('0,"stance":"support"}\n\n', buffer)

    expect(first.events).toEqual([])
    expect(second.buffer).toBe("")
    expect(second.events).toEqual([{ type: "agent_responded", data: { agent_id: 0, stance: "support" } }])
  })

  it("fetches backend health status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          status: "ok",
          dataset_loaded: true,
          dataset_available: true,
          dataset_rows: 1000000,
        }),
      }),
    )

    const health = await getHealth()

    expect("ollama_reachable" in health).toBe(false)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/healthz"), { cache: "no-store" })
  })

  it("simulate payload omits topic_id and prior", () => {
    const body = buildSimulateBody({ policy: "youth rent support", n_agents: 5, model_name: "gpt-5-mini" })

    expect(body).not.toHaveProperty("topic_id")
    expect(body).not.toHaveProperty("prior")
  })

  it("saves csv exports to the project folder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ filename: "test.csv", path: "exports/test.csv", bytes: 12 }),
      }),
    )

    const result = await saveProjectCsvExport("test.csv", "a,b\n1,2", { name: "snapshot" })

    expect(result.path).toBe("exports/test.csv")
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/exports/csv"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ filename: "test.csv", content: "a,b\n1,2", snapshot: { name: "snapshot" } }),
      }),
    )
  })

  it("lists and loads project csv exports", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: [{ filename: "saved.csv", path: "exports/saved.csv", bytes: 3, has_snapshot: true }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ filename: "saved.csv", content: "csv", snapshot: { name: "saved" } }),
        }),
    )

    const listed = await listProjectCsvExports()
    const loaded = await loadProjectCsvExport("saved.csv")

    expect(listed.items[0].filename).toBe("saved.csv")
    expect(loaded.snapshot).toEqual({ name: "saved" })
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining("/api/exports/csv/saved.csv"), { cache: "no-store" })
  })
})
