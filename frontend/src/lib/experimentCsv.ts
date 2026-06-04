import type { DiscoveryAggregate } from "./api"
import type { ExperimentSnapshot, ExperimentSnapshotResult } from "./experimentStorage"

const HEADERS = [
  "snapshot_id",
  "name",
  "created_at",
  "slot_id",
  "n_agents",
  "repeat_count",
  "model_provider",
  "model_name",
  "support",
  "oppose",
  "neutral",
  "support_mean",
  "support_stddev",
  "oppose_mean",
  "oppose_stddev",
  "neutral_mean",
  "neutral_stddev",
  "row_type",
  "run_index",
  "agent_id",
  "age",
  "age_group",
  "gender",
  "province",
  "district",
  "region",
  "region_group",
  "job",
  "occupation",
  "family_type",
  "model",
  "status",
  "axis",
  "category",
  "label",
  "stance",
  "rationale",
  "blind_spot",
  "blind_spot_reason",
  "grounding",
  "affected_group",
  "expected_complaint",
  "reframing",
  "age_band",
  "occupation_stratum",
  "household_stratum",
  "housing_stratum",
  "education_stratum",
  "field_stratum",
  "classification_source",
  "presence",
  "blind_spot_headcount",
  "category_population",
  "agent_ids",
  "text",
  "message",
  "content",
  "raw_output",
  "policy",
  "json_payload",
] as const

type CsvRow = Partial<Record<(typeof HEADERS)[number], unknown>>

export function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

export function buildExperimentCsv(snapshot: ExperimentSnapshot): string {
  const rows = snapshot.results.flatMap((result) => buildResultRows(snapshot, result))
  return [HEADERS, ...rows.map((row) => HEADERS.map((header) => row[header]))]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n")
}

function buildResultRows(snapshot: ExperimentSnapshot, result: ExperimentSnapshotResult): CsvRow[] {
  const slot = snapshot.slots.find((item) => item.id === result.slotId)
  const rows: CsvRow[] = [baseRow(snapshot, result, "summary", { policy: slot?.policy ?? "" })]

  rows.push(baseRow(snapshot, result, "slot_config", { policy: slot?.policy ?? "" }))

  result.runs?.forEach((counts, index) => {
    rows.push(baseRow(snapshot, result, "run_total", { ...counts, run_index: index + 1 }))
  })

  if (result.samplingPlan) {
    rows.push(
      baseRow(snapshot, result, "sampling_plan", {
        category: result.samplingPlan.mode ?? "",
        json_payload: jsonString(result.samplingPlan),
      }),
    )
    result.samplingPlan.cells.forEach((cell) => {
      rows.push(
        baseRow(snapshot, result, "sampling_plan_cell", {
          age_group: cell.age_group,
          gender: cell.gender,
          region_group: cell.region_group,
          category: `${cell.age_group}/${cell.region_group}/${cell.gender}`,
          category_population: cell.available,
          blind_spot_headcount: cell.sampled,
          json_payload: jsonString(cell),
        }),
      )
    })
  }

  result.sampledAgents?.forEach((agent) => {
    rows.push(
      baseRow(snapshot, result, "sampled_agent", {
        agent_id: agent.agent_id,
        age: agent.age,
        age_group: agent.age_group,
        gender: agent.gender,
        province: agent.province,
        district: agent.district,
        region: agent.region,
        region_group: agent.region_group,
        job: agent.job,
        family_type: agent.family_type,
        json_payload: jsonString(agent),
      }),
    )
  })

  result.responses?.forEach((response) => {
    rows.push(
      baseRow(snapshot, result, "agent_response", {
        agent_id: response.agent_id,
        age: response.age,
        age_group: response.age_group,
        gender: response.gender,
        province: response.province,
        district: response.district,
        occupation: response.occupation,
        family_type: response.family_type,
        region_group: response.region_group,
        stance: response.stance,
        rationale: response.rationale,
        blind_spot: response.blind_spot,
        blind_spot_reason: response.blind_spot_reason,
        grounding: response.grounding,
        affected_group: response.affected_group,
        expected_complaint: response.expected_complaint,
        reframing: response.reframing,
        age_band: response.age_band,
        occupation_stratum: response.occupation_stratum,
        household_stratum: response.household_stratum,
        housing_stratum: response.housing_stratum,
        education_stratum: response.education_stratum,
        field_stratum: response.field_stratum,
        classification_source: response.classification_source,
        json_payload: jsonString(response),
      }),
    )
  })

  result.llmPrompts?.forEach((prompt) => {
    rows.push(
      baseRow(snapshot, result, "llm_prompt", {
        agent_id: prompt.agent_id,
        model: prompt.model,
        content: prompt.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
        json_payload: jsonString(prompt),
      }),
    )
  })

  Object.entries(result.llmOutputs ?? {}).forEach(([agentId, output]) => {
    rows.push(baseRow(snapshot, result, "llm_output", { agent_id: agentId, content: output }))
  })

  Object.entries(result.llmStatuses ?? {}).forEach(([agentId, status]) => {
    rows.push(baseRow(snapshot, result, "llm_status", { agent_id: agentId, status }))
  })

  Object.entries(result.llmHeartbeats ?? {}).forEach(([agentId, heartbeat]) => {
    rows.push(baseRow(snapshot, result, "llm_heartbeat", { agent_id: agentId, json_payload: jsonString(heartbeat) }))
  })

  Object.entries(result.llmErrors ?? {}).forEach(([agentId, error]) => {
    rows.push(baseRow(snapshot, result, "llm_error", { agent_id: agentId, message: error.message, json_payload: jsonString(error) }))
  })

  if (result.discoveryAggregate) {
    rows.push(...discoveryAggregateRows(snapshot, result, result.discoveryAggregate, "discovery_aggregate"))
  }

  const aggregateRuns = snapshot.settings.repeatCount === 1 ? [] : (result.discoveryAggregateRuns ?? [])
  aggregateRuns.forEach((aggregate, index) => {
    rows.push(...discoveryAggregateRows(snapshot, result, aggregate, "discovery_aggregate_run", index + 1))
  })

  if (result.discoverySummary) {
    rows.push(baseRow(snapshot, result, "discovery_summary", { text: result.discoverySummary.featured_axis_rationale, json_payload: jsonString(result.discoverySummary) }))
    result.discoverySummary.merged_blind_spots.forEach((item) => {
      rows.push(
        baseRow(snapshot, result, "discovery_merged_blind_spot", {
          label: item.label,
          text: item.text,
          grounding: item.grounding,
          agent_ids: item.agent_ids.join(" | "),
          json_payload: jsonString(item),
        }),
      )
    })
    result.discoverySummary.merged_reframings.forEach((item) => {
      rows.push(baseRow(snapshot, result, "discovery_merged_reframing", { label: item.label, agent_ids: item.agent_ids.join(" | "), json_payload: jsonString(item) }))
    })
    result.discoverySummary.merged_complaints.forEach((item) => {
      rows.push(baseRow(snapshot, result, "discovery_merged_complaint", { label: item.label, agent_ids: item.agent_ids.join(" | "), json_payload: jsonString(item) }))
    })
  }

  return rows
}

function discoveryAggregateRows(
  snapshot: ExperimentSnapshot,
  result: ExperimentSnapshotResult,
  aggregate: DiscoveryAggregate,
  prefix: string,
  runIndex?: number,
): CsvRow[] {
  const rows: CsvRow[] = [
    baseRow(snapshot, result, prefix, {
      run_index: runIndex,
      axis: aggregate.featured_axis.primary,
      category: aggregate.featured_axis.secondary,
      json_payload: jsonString(aggregate.featured_axis),
    }),
  ]
  Object.entries(aggregate.axes).forEach(([axis, categories]) => {
    Object.entries(categories).forEach(([category, cell]) => {
      rows.push(
        baseRow(snapshot, result, "discovery_axis_cell", {
          run_index: runIndex,
          axis,
          category,
          presence: cell.presence,
          blind_spot_headcount: cell.blind_spot_headcount,
          category_population: cell.category_population,
          agent_ids: cell.agent_ids.join(" | "),
          json_payload: jsonString(cell),
        }),
      )
    })
  })
  return rows
}

function baseRow(snapshot: ExperimentSnapshot, result: ExperimentSnapshotResult, rowType: string, extra: CsvRow = {}): CsvRow {
  return {
    snapshot_id: snapshot.id,
    name: snapshot.name,
    created_at: snapshot.createdAt,
    slot_id: result.slotId,
    n_agents: snapshot.settings.nAgents,
    repeat_count: snapshot.settings.repeatCount ?? 1,
    model_provider: snapshot.settings.modelProvider ?? "openai",
    model_name: snapshot.settings.modelName ?? "",
    support: result.total?.support ?? "",
    oppose: result.total?.oppose ?? "",
    neutral: result.total?.neutral ?? "",
    support_mean: result.stability?.supportMean ?? "",
    support_stddev: result.stability?.supportStddev ?? "",
    oppose_mean: result.stability?.opposeMean ?? "",
    oppose_stddev: result.stability?.opposeStddev ?? "",
    neutral_mean: result.stability?.neutralMean ?? "",
    neutral_stddev: result.stability?.neutralStddev ?? "",
    row_type: rowType,
    ...extra,
  }
}

function jsonString(value: unknown): string {
  return JSON.stringify(value)
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
