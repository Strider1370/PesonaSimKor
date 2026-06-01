import type { AggregateEvent, StanceCounts } from "./api"
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
  "category",
  "label",
  "stance",
  "stance_strength",
  "rationale",
  "caveat",
  "blind_spot",
  "affected_group",
  "expected_complaint",
  "reframing",
  "persona_link_direct",
  "persona_link_inferred",
  "count",
  "denominator",
  "representative_quote",
  "inferred_based",
  "agent_ids",
  "examples",
  "text",
  "message",
  "content",
  "raw_output",
  "policy",
  "json_payload",
]

type CsvRow = Partial<Record<(typeof HEADERS)[number], unknown>>
type PivotClusterRow = Record<string, unknown> & {
  agent_ids?: unknown[]
}

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
    rows.push(baseRow(snapshot, result, "run_total", countsRow(counts, { run_index: index + 1 })))
  })

  if (result.samplingPlan) {
    rows.push(
      baseRow(snapshot, result, "sampling_plan", {
        count: result.samplingPlan.n_agents,
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
          count: cell.sampled,
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
        stance_strength: response.stance_strength,
        rationale: response.rationale,
        caveat: response.caveat,
        blind_spot: response.blind_spot,
        affected_group: response.affected_group,
        expected_complaint: response.expected_complaint,
        reframing: response.reframing,
        persona_link_direct: response.persona_link?.direct,
        persona_link_inferred: response.persona_link?.inferred,
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

  if (result.summaryPrompt) {
    rows.push(
      baseRow(snapshot, result, "summary_prompt", {
        model: result.summaryPrompt.model,
        content: result.summaryPrompt.messages.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
        json_payload: jsonString(result.summaryPrompt),
      }),
    )
  }

  if (result.summaryStatus) {
    rows.push(
      baseRow(snapshot, result, "summary_status", {
        status: result.summaryStatus.status,
        message: result.summaryStatus.message,
        raw_output: result.summaryStatus.raw_output,
        json_payload: jsonString(result.summaryStatus),
      }),
    )
  }

  if (result.summaryOutput) {
    rows.push(baseRow(snapshot, result, "summary_output", { content: result.summaryOutput }))
  }

  if (result.summaryHeartbeat) {
    rows.push(baseRow(snapshot, result, "summary_heartbeat", { json_payload: jsonString(result.summaryHeartbeat) }))
  }

  if (result.summaryError) {
    rows.push(baseRow(snapshot, result, "summary_error", { message: result.summaryError.message, json_payload: jsonString(result.summaryError) }))
  }

  if (result.aggregate) {
    rows.push(...aggregateRows(snapshot, result, result.aggregate, "aggregate"))
  }

  const aggregateRuns = snapshot.settings.repeatCount === 1 ? [] : (result.aggregateRuns ?? [])
  aggregateRuns.forEach((aggregate, index) => {
    rows.push(...aggregateRows(snapshot, result, aggregate, "aggregate_run", index + 1))
  })

  return rows
}

function aggregateRows(
  snapshot: ExperimentSnapshot,
  result: ExperimentSnapshotResult,
  aggregate: AggregateEvent,
  prefix: string,
  runIndex?: number,
): CsvRow[] {
  const rows: CsvRow[] = [
    baseRow(snapshot, result, `${prefix}_total`, countsRow(aggregate.total, { run_index: runIndex, json_payload: jsonString(aggregate.total) })),
  ]

  rows.push(...breakdownRows(snapshot, result, `${prefix}_by_age`, aggregate.by_age, "age_group", runIndex))
  rows.push(...breakdownRows(snapshot, result, `${prefix}_by_gender`, aggregate.by_gender, "gender", runIndex))
  rows.push(...breakdownRows(snapshot, result, `${prefix}_by_region`, aggregate.by_region, "region_group", runIndex))

  aggregate.concern_clusters.forEach((cluster) => {
    rows.push(
      baseRow(snapshot, result, "concern_cluster", {
        run_index: runIndex,
        label: cluster.label,
        count: cluster.count,
        examples: cluster.examples.join(" | "),
        json_payload: jsonString(cluster),
      }),
    )
  })

  aggregate.support_clusters.forEach((cluster) => {
    rows.push(
      baseRow(snapshot, result, "support_cluster", {
        run_index: runIndex,
        label: cluster.label,
        count: cluster.count,
        examples: cluster.examples.join(" | "),
        json_payload: jsonString(cluster),
      }),
    )
  })

  aggregate.blind_spot_raw?.forEach((item) => {
    rows.push(
      baseRow(snapshot, result, "blind_spot_raw", {
        run_index: runIndex,
        blind_spot: item.blind_spot,
        affected_group: item.affected_group,
        json_payload: jsonString(item),
      }),
    )
  })

  aggregate.blind_spot_clusters.forEach((cluster) => {
    rows.push(
      baseRow(snapshot, result, "blind_spot_cluster", {
        run_index: runIndex,
        affected_group: cluster.affected_group,
        count: cluster.count,
        denominator: cluster.denominator,
        representative_quote: cluster.representative_quote,
        inferred_based: cluster.inferred_based,
        agent_ids: cluster.agent_ids.join(" | "),
        examples: cluster.blind_spot_examples.join(" | "),
        json_payload: jsonString(cluster),
      }),
    )
  })

  ;((aggregate as unknown as { complaint_clusters?: PivotClusterRow[] }).complaint_clusters ?? []).forEach((cluster) => {
    rows.push(
      baseRow(snapshot, result, "complaint_cluster", {
        run_index: runIndex,
        count: cluster.count,
        denominator: cluster.denominator,
        representative_quote: cluster.representative_quote,
        inferred_based: cluster.inferred_based,
        agent_ids: Array.isArray(cluster.agent_ids) ? cluster.agent_ids.join(" | ") : "",
        json_payload: jsonString(cluster),
      }),
    )
  })

  ;((aggregate as unknown as { affected_group_clusters?: PivotClusterRow[] }).affected_group_clusters ?? []).forEach((cluster) => {
    rows.push(
      baseRow(snapshot, result, "affected_group_cluster", {
        run_index: runIndex,
        affected_group: cluster.affected_group ?? cluster.representative_quote ?? cluster.label,
        count: cluster.count,
        denominator: cluster.denominator,
        representative_quote: cluster.representative_quote,
        inferred_based: cluster.inferred_based,
        agent_ids: Array.isArray(cluster.agent_ids) ? cluster.agent_ids.join(" | ") : "",
        json_payload: jsonString(cluster),
      }),
    )
  })

  aggregate.reframing_list.forEach((item) => {
    rows.push(
      baseRow(snapshot, result, "reframing", {
        run_index: runIndex,
        text: item.text,
        age_group: item.age_group,
        gender: item.gender,
        region_group: item.region_group,
        json_payload: jsonString(item),
      }),
    )
  })

  return rows
}

function breakdownRows(
  snapshot: ExperimentSnapshot,
  result: ExperimentSnapshotResult,
  rowType: string,
  breakdown: Record<string, StanceCounts>,
  categoryColumn: "age_group" | "gender" | "region_group",
  runIndex?: number,
): CsvRow[] {
  return Object.entries(breakdown).map(([label, counts]) =>
    baseRow(snapshot, result, rowType, countsRow(counts, { run_index: runIndex, [categoryColumn]: label, label })),
  )
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

function countsRow(counts: StanceCounts, extra: CsvRow = {}): CsvRow {
  return {
    support: counts.support,
    oppose: counts.oppose,
    neutral: counts.neutral,
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
