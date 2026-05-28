import type { ExperimentSnapshot } from "./experimentStorage"

const HEADERS = [
  "snapshot_id",
  "name",
  "created_at",
  "slot_id",
  "preset_id",
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
  "real_source",
  "real_year",
  "real_support",
  "sim_support",
  "support_diff",
  "real_oppose",
  "sim_oppose",
  "oppose_diff",
  "real_note",
]

export function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

export function buildExperimentCsv(snapshot: ExperimentSnapshot): string {
  const rows = snapshot.results.map((result) => [
    snapshot.id,
    snapshot.name,
    snapshot.createdAt,
    result.slotId,
    result.presetId,
    snapshot.settings.nAgents,
    snapshot.settings.repeatCount ?? 1,
    snapshot.settings.modelProvider ?? "",
    snapshot.settings.modelName ?? "",
    result.total?.support ?? "",
    result.total?.oppose ?? "",
    result.total?.neutral ?? "",
    result.stability?.supportMean ?? "",
    result.stability?.supportStddev ?? "",
    result.stability?.opposeMean ?? "",
    result.stability?.opposeStddev ?? "",
    result.stability?.neutralMean ?? "",
    result.stability?.neutralStddev ?? "",
    result.realOpinion?.source ?? "",
    result.realOpinion?.year ?? "",
    result.realOpinion?.supportActual ?? "",
    result.realOpinion?.supportSimulated ?? "",
    result.realOpinion?.supportDiff ?? "",
    result.realOpinion?.opposeActual ?? "",
    result.realOpinion?.opposeSimulated ?? "",
    result.realOpinion?.opposeDiff ?? "",
    result.realOpinion?.note ?? "",
  ])

  return [HEADERS, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")
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
