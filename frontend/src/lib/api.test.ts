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
