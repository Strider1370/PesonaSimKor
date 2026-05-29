import { afterEach, describe, expect, it, vi } from "vitest"
import { getHealth, parseSseChunk } from "./api"
import type { SimulateRequest } from "./api"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("parseSseChunk", () => {
  it("allows experiment options in simulate request type", () => {
    const request: SimulateRequest = {
      policy: "policy",
      n_agents: 30,
      model_provider: "ollama",
      model_name: "qwen3:14b",
      thinking: true,
      persona_depth: "full",
    }

    expect(request.model_name).toBe("qwen3:14b")
  })

  it("allows blind spot response and aggregate fields in event types", () => {
    const response = {
      agent_id: 1,
      age_group: "40s",
      gender: "female",
      region_group: "capital",
      stance: "oppose",
      rationale: "부담이 큽니다.",
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
      concern_clusters: [],
      support_clusters: [],
      blind_spot_clusters: [
        {
          affected_group: "수도권 맞벌이 가구",
          count: 1,
          blind_spot_examples: ["월세 전환 때 보증금 흐름 불안"],
        },
      ],
      reframing_list: [{ text: "전제 반문", age_group: "40s", gender: "female", region_group: "capital" }],
    } satisfies import("./api").AggregateEvent

    expect(response.blind_spot).toBe("월세 전환 때 보증금 흐름 불안")
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
          ollama_host: "http://127.0.0.1:11434",
          ollama_model: "qwen3.5:9b",
          ollama_reachable: true,
          dataset_loaded: true,
          dataset_available: true,
          dataset_rows: 1000000,
        }),
      }),
    )

    const health = await getHealth()

    expect(health.ollama_reachable).toBe(true)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/healthz"), { cache: "no-store" })
  })
})
