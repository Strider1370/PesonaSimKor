import { afterEach, describe, expect, it, vi } from "vitest"
import { getHealth, listProjectCsvExports, loadProjectCsvExport, parseSseChunk, saveProjectCsvExport } from "./api"
import type { SimulateRequest } from "./api"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("parseSseChunk", () => {
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

  it("allows blind spot response and aggregate fields in event types", () => {
    const response = {
      agent_id: 1,
      age_group: "40s",
      gender: "female",
      region_group: "capital",
      stance: "oppose",
      stance_strength: "기울어짐",
      rationale: "부담이 큽니다.",
      caveat: "보완책은 별도로 필요합니다.",
      blind_spot: "월세 전환 때 보증금 흐름 불안",
      affected_group: "수도권 맞벌이 가구",
      reframing: "월세 지원보다 금융 안정성이 먼저입니다.",
      persona_link: { direct: "자녀 등교", inferred: "주거비 민감" },
    } satisfies import("./api").AgentRespondedEvent

    const aggregate = {
      total: { support: 0, oppose: 1, neutral: 0 },
      by_age: {},
      by_gender: {},
      by_region: {},
      concern_clusters: [
        { label: "생활비 부담", short_label: "생활비 부담", count: 1, examples: ["부담"] },
      ],
      support_clusters: [
        { label: "활동 보장", short_label: "활동 보장", count: 1, examples: ["필요"] },
      ],
      blind_spot_clusters: [
        {
          affected_group: "수도권 맞벌이 가구",
          short_title: "맞벌이 가구",
          count: 1,
          blind_spot_examples: ["월세 전환 때 보증금 흐름 불안"],
          agent_ids: [1],
        },
      ],
      reframing_list: [{ text: "전제 반문", age_group: "40s", gender: "female", region_group: "capital" }],
    } satisfies import("./api").AggregateEvent

    expect(response.blind_spot).toBe("월세 전환 때 보증금 흐름 불안")
    expect(response.stance_strength).toBe("기울어짐")
    expect(response.caveat).toBe("보완책은 별도로 필요합니다.")
    expect(aggregate.blind_spot_clusters[0].count).toBe(1)
  })

  it("parses events split across chunks", () => {
    let buffer = ""
    const first = parseSseChunk('event: agent_responded\ndata: {"agent_id":', buffer)
    buffer = first.buffer

    const second = parseSseChunk('0,"stance":"support"}\n\n', buffer)

    expect(first.events).toEqual([])
    expect(second.buffer).toBe("")
    expect(second.events).toEqual([
      { type: "agent_responded", data: { agent_id: 0, stance: "support" } },
    ])
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
