export type Stance = "support" | "oppose" | "neutral"
export type Grounding = "direct" | "inferred"
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
  province?: string
  district?: string
  family_type?: string
}

export type AgentRespondedEvent = {
  agent_id: number
  name?: string
  age?: number
  age_group: AgeGroup
  gender: Gender
  province?: string
  district?: string
  occupation?: string
  family_type?: string
  region_group: RegionGroup
  stance: Stance
  rationale: string
  blind_spot?: string
  blind_spot_reason?: string
  expected_complaint?: string
  affected_group?: string
  grounding?: Grounding
  reframing?: string
  age_band?: string
  occupation_stratum?: string
  household_stratum?: string
  housing_stratum?: string
  education_stratum?: string
  field_stratum?: string
  classification_source?: "explicit" | "fallback"
}

export type StructuredPolicySource = "stated" | "inferred"

export type StructuredPolicyField = {
  value: string | null
  source: StructuredPolicySource
}

export type StructuredPolicy = {
  policy_name?: StructuredPolicyField
  target?: StructuredPolicyField
  apply_method?: StructuredPolicyField
  exclusions?: StructuredPolicyField
  context?: StructuredPolicyField
}

export type PersonaDepth = "minimal" | "standard" | "full"

export type StructuredPolicyWithPromptFields = StructuredPolicy & {
  relevant_optional_fields?: string[]
  included_fields?: string[]
  persona_depth?: PersonaDepth
}

export type PolicyStructuredEvent = StructuredPolicyWithPromptFields

export type LlmPromptEvent = {
  agent_id: number
  model: string
  format: "json"
  messages: { role: "system" | "user" | "assistant"; content: string }[]
  options?: Record<string, unknown>
  think?: boolean
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

export type SupportCluster = {
  label: string
  short_label: string
  count: number
  examples: string[]
  excluded_from_map?: boolean
}

export type ConcernCluster = SupportCluster
export type Cluster = SupportCluster

export type BlindSpotCluster = {
  affected_group: string
  short_title: string
  count: number
  denominator?: number
  representative_quote?: string
  inferred_based?: boolean
  blind_spot_examples: string[]
  agent_ids: number[]
  title_fallback?: boolean
}

export type ComplaintCluster = {
  representative_quote: string
  count: number
  denominator?: number
  inferred_based?: boolean
  agent_ids: number[]
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
  headline?: string | null
  total: StanceCounts
  by_age: Record<string, StanceCounts>
  by_gender: Record<string, StanceCounts>
  by_region: Record<string, StanceCounts>
  concern_clusters: ConcernCluster[]
  support_clusters: SupportCluster[]
  blind_spot_raw?: BlindSpotRawItem[]
  blind_spot_clusters: BlindSpotCluster[]
  complaint_clusters?: ComplaintCluster[]
  affected_group_clusters?: ComplaintCluster[]
  reframing_list: ReframingItem[]
}

export type DiscoveryAggregateCell = {
  presence: boolean
  blind_spot_headcount: number
  agent_ids: number[]
  category_population: number
}

export type DiscoveryFeaturedAxis = {
  primary: string
  secondary: string | null
}

export type DiscoveryAggregate = {
  axes: Record<string, Record<string, DiscoveryAggregateCell>>
  featured_axis: DiscoveryFeaturedAxis
}

export type DiscoveryMergedBlindSpot = {
  label: string
  text: string
  agent_ids: number[]
  grounding: Grounding
}

export type DiscoveryMergedItem = {
  label: string
  short_label?: string
  agent_ids: number[]
}

export type DiscoverySummary = {
  merged_blind_spots: DiscoveryMergedBlindSpot[]
  merged_reframings: DiscoveryMergedItem[]
  merged_complaints: DiscoveryMergedItem[]
  featured_axis_rationale: string
  featured_axis?: DiscoveryFeaturedAxis
  raw_output?: string
  error?: string | null
}

export type DiscoverySummaryPromptEvent = {
  model: string
  messages: { role: string; content: string }[]
}

export type DiscoverySummaryStatusEvent = {
  status: "started" | "completed" | "failed"
}

export type SimulateEvent =
  | { type: "policy_structured"; data: PolicyStructuredEvent }
  | { type: "sampling_plan"; data: SamplingPlanEvent }
  | { type: "agent_sampled"; data: AgentSampledEvent }
  | { type: "llm_prompt"; data: LlmPromptEvent }
  | { type: "llm_status"; data: LlmStatusEvent }
  | { type: "llm_heartbeat"; data: LlmHeartbeatEvent }
  | { type: "llm_error"; data: LlmErrorEvent }
  | { type: "llm_token"; data: LlmTokenEvent }
  | { type: "agent_responded"; data: AgentRespondedEvent }
  | { type: "discovery_aggregate"; data: DiscoveryAggregate }
  | { type: "discovery_summary_prompt"; data: DiscoverySummaryPromptEvent }
  | { type: "discovery_summary_status"; data: DiscoverySummaryStatusEvent }
  | { type: "discovery_summary"; data: DiscoverySummary }
  | { type: "error"; data: { message: string; code: string } }
  | { type: "done"; data: Record<string, never> }

export type SimulateRequest = {
  policy: string
  n_agents: number
  model_provider?: "openai"
  model_name?: string
  control_model?: string
  persona_depth?: PersonaDepth
}

export type HealthStatus = {
  status: string
  dataset_loaded: boolean
  dataset_available: boolean
  dataset_rows: number | null
}

export type ProjectCsvExport = {
  filename: string
  path: string
  bytes: number
  modified_at?: number
  has_snapshot?: boolean
}

export type ProjectCsvExportList = {
  items: ProjectCsvExport[]
}

export type SavedProjectCsvExport = {
  filename: string
  path: string
  bytes: number
}

export type LoadedProjectCsvExport = {
  filename: string
  content: string
  snapshot: unknown | null
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
    body: JSON.stringify(buildSimulateBody(request)),
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

export function buildSimulateBody(request: SimulateRequest): SimulateRequest {
  const { policy, n_agents, model_provider, model_name, control_model, persona_depth } = request
  return { policy, n_agents, model_provider, model_name, control_model, persona_depth }
}

export async function getHealth(): Promise<HealthStatus> {
  const response = await fetch(`${API_BASE_URL}/healthz`, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`)
  }
  return response.json()
}

export async function saveProjectCsvExport(filename: string, content: string, snapshot?: unknown): Promise<SavedProjectCsvExport> {
  const response = await fetch(`${API_BASE_URL}/api/exports/csv`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content, snapshot }),
  })
  if (!response.ok) {
    throw new Error(`CSV export save failed: ${response.status}`)
  }
  return response.json()
}

export async function listProjectCsvExports(): Promise<ProjectCsvExportList> {
  const response = await fetch(`${API_BASE_URL}/api/exports/csv`, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`CSV export list failed: ${response.status}`)
  }
  return response.json()
}

export async function loadProjectCsvExport(filename: string): Promise<LoadedProjectCsvExport> {
  const response = await fetch(`${API_BASE_URL}/api/exports/csv/${encodeURIComponent(filename)}`, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(`CSV export load failed: ${response.status}`)
  }
  return response.json()
}
