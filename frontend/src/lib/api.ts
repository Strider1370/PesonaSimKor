export type Stance = "support" | "oppose" | "neutral"
export type Gender = "male" | "female" | "unknown"
export type AgeGroup = "20s" | "30s" | "40s" | "50s" | "60s" | "70_plus"
export type RegionGroup =
  | "capital"
  | "yeongnam"
  | "honam"
  | "chungcheong"
  | "gangwon"
  | "jeju"
  | "other"

export type AgentSampledEvent = {
  agent_id: number
  age: number
  gender: Gender
  region: string
  job: string
  age_group: AgeGroup
  region_group: RegionGroup
}

export type AgentRespondedEvent = {
  agent_id: number
  age_group: AgeGroup
  gender: Gender
  region_group: RegionGroup
  stance: Stance
  stance_strength?: string
  rationale: string
  caveat?: string
  blind_spot?: string
  affected_group?: string
  reframing?: string
  persona_link?: {
    direct: string
    inferred: string
  }
}

export type LlmPromptEvent = {
  agent_id: number
  model: string
  format: "json"
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  options: Record<string, unknown>
  think?: boolean
}

export type SummaryPromptEvent = Omit<LlmPromptEvent, "agent_id">

export type SummaryStatusEvent = {
  status: "started" | "completed" | "empty" | "failed"
  message: string
  raw_output?: string
}

export type SummaryTokenEvent = {
  content: string
}

export type SummaryHeartbeatEvent = {
  elapsed_seconds: number
  seconds_since_last_token: number | null
  tokens_seen: number
}

export type SummaryErrorEvent = {
  message: string
}

export type LlmTokenEvent = {
  agent_id: number
  content: string
}

export type LlmStatusEvent = {
  agent_id: number
  status: "started" | "completed" | "failed"
}

export type LlmHeartbeatEvent = {
  agent_id: number
  elapsed_seconds: number
  seconds_since_last_token: number | null
  tokens_seen: number
}

export type LlmErrorEvent = {
  agent_id: number
  message: string
}

export type SamplingPlanCell = {
  age_group: AgeGroup
  region_group: RegionGroup
  gender: Gender
  available?: number
  quota?: number
  sampled: number
  shortfall?: number
  proportion: number
}

export type SamplingPlanEvent = {
  mode?: "uniform_random" | "stratified"
  n_agents: number
  axes: string[]
  total_records: number
  cells: SamplingPlanCell[]
}

export type StanceCounts = Record<Stance, number>

export type Cluster = {
  label: string
  count: number
  examples: string[]
}

export type BlindSpotCluster = {
  affected_group: string
  count: number
  blind_spot_examples: string[]
}

export type ReframingItem = {
  text: string
  age_group: string
  gender: string
  region_group: string
}

export type BlindSpotRawItem = {
  blind_spot: string
  affected_group: string
}

export type AggregateEvent = {
  total: StanceCounts
  by_age: Record<string, StanceCounts>
  by_gender: Record<string, StanceCounts>
  by_region: Record<string, StanceCounts>
  concern_clusters: Cluster[]
  support_clusters: Cluster[]
  blind_spot_raw?: BlindSpotRawItem[]
  blind_spot_clusters: BlindSpotCluster[]
  reframing_list: ReframingItem[]
}

export type SimulateEvent =
  | { type: "sampling_plan"; data: SamplingPlanEvent }
  | { type: "agent_sampled"; data: AgentSampledEvent }
  | { type: "llm_prompt"; data: LlmPromptEvent }
  | { type: "llm_status"; data: LlmStatusEvent }
  | { type: "llm_heartbeat"; data: LlmHeartbeatEvent }
  | { type: "llm_error"; data: LlmErrorEvent }
  | { type: "llm_token"; data: LlmTokenEvent }
  | { type: "agent_responded"; data: AgentRespondedEvent }
  | { type: "summary_prompt"; data: SummaryPromptEvent }
  | { type: "summary_status"; data: SummaryStatusEvent }
  | { type: "summary_token"; data: SummaryTokenEvent }
  | { type: "summary_heartbeat"; data: SummaryHeartbeatEvent }
  | { type: "summary_error"; data: SummaryErrorEvent }
  | { type: "aggregate"; data: AggregateEvent }
  | { type: "error"; data: { message: string; code: string } }
  | { type: "done"; data: Record<string, never> }

export type SimulateRequest = {
  policy: string
  n_agents: number
  model_provider?: "ollama" | "openai"
  model_name?: string
  thinking?: boolean
  persona_depth?: "minimal" | "standard" | "full"
  topic_id?: string | null
}

export type HealthStatus = {
  status: string
  ollama_host: string
  ollama_model: string
  ollama_reachable: boolean
  dataset_loaded: boolean
  dataset_available: boolean
  dataset_rows: number | null
}

type ParsedEvent = { type: string; data: unknown }

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || `${globalThis.location?.protocol ?? "http:"}//${globalThis.location?.hostname ?? "127.0.0.1"}:8000`

export function parseSseChunk(chunk: string, previousBuffer: string): { events: ParsedEvent[]; buffer: string } {
  const text = previousBuffer + chunk
  const parts = text.split(/\r?\n\r?\n/)
  const buffer = parts.pop() ?? ""
  const events = parts.flatMap(parseSseEventBlock)
  return { events, buffer }
}

function parseSseEventBlock(block: string): ParsedEvent[] {
  let eventType = "message"
  const dataLines: string[] = []

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim()
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  if (!dataLines.length) {
    return []
  }

  try {
    return [{ type: eventType, data: JSON.parse(dataLines.join("\n")) }]
  } catch {
    return [{ type: "error", data: { message: "Invalid stream payload.", code: "invalid_sse_json" } }]
  }
}

export async function* simulate(request: SimulateRequest, signal?: AbortSignal): AsyncGenerator<SimulateEvent> {
  const response = await fetch(`${API_BASE_URL}/api/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(`Simulation request failed: ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    const parsed = parseSseChunk(decoder.decode(value, { stream: true }), buffer)
    buffer = parsed.buffer
    for (const event of parsed.events) {
      yield event as SimulateEvent
    }
  }

  if (buffer.trim()) {
    const parsed = parseSseChunk("\n\n", buffer)
    for (const event of parsed.events) {
      yield event as SimulateEvent
    }
  }
}

export async function getHealth(): Promise<HealthStatus> {
  const response = await fetch(`${API_BASE_URL}/healthz`, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`)
  }
  return response.json()
}
