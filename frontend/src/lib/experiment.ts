import type { ExperimentSnapshotResult, ExperimentSnapshotSlot } from "./experimentStorage"
import type {
  AggregateEvent,
  AgentRespondedEvent,
  AgentSampledEvent,
  LlmErrorEvent,
  LlmHeartbeatEvent,
  LlmPromptEvent,
  LlmStatusEvent,
  SamplingPlanEvent,
  SummaryErrorEvent,
  SummaryHeartbeatEvent,
  SummaryPromptEvent,
  SummaryStatusEvent,
} from "./api"

export type ExperimentPreset = {
  id: string
  topic_id: string
  topic: string
  quadrant: string
  framing: string
  context: string
  stance_format: string
  parameter_variant: string
  label: string
  real_opinion: {
    support: number
    oppose: number
    neutral?: number
    source: string
    year: number
    question: string
    url: string | null
    note: string
  } | null
  prompt: string
}

export type PolicySlotId = "A" | "B" | "C"

export type PolicySlot = {
  id: PolicySlotId
  policy: string
  presetId: string
}

export type PresetOption = {
  id: string
  label: string
}

export type PresetSelection = {
  topicId: string
  variant: string
  framing: string
  context: string
  stanceFormat: string
}

export type PresetOptions = {
  topics: PresetOption[]
  byTopic: Record<
    string,
    {
      variants: PresetOption[]
      framings: PresetOption[]
      contexts: PresetOption[]
      stanceFormats: PresetOption[]
    }
  >
}

type MinimalAggregate = {
  total: {
    support: number
    oppose: number
    neutral: number
  }
}

export type StabilityMetric = {
  mean: number
  stddev: number
  values: number[]
}

export type StabilityReport = {
  support: StabilityMetric
  oppose: StabilityMetric
  neutral: StabilityMetric
  runs: MinimalAggregate[]
}

export type RealOpinion = NonNullable<ExperimentPreset["real_opinion"]>

const SLOT_IDS: PolicySlotId[] = ["A", "B", "C"]

const FRAMING_LABELS: Record<string, string> = {
  neutral: "중립",
  positive: "찬성 유리",
  negative: "반대 유리",
}

const CONTEXT_LABELS: Record<string, string> = {
  no_context: "배경없음",
  with_context: "배경있음",
}

const STANCE_FORMAT_LABELS: Record<string, string> = {
  explicit: "명시적",
  open: "개방형",
  scale: "척도형",
}

const VARIANT_LABELS: Record<string, string> = {
  base: "기본",
  variant_a: "변형 A",
  variant_b: "변형 B",
  variant_c: "변형 C",
}

export function createInitialSlots(): PolicySlot[] {
  return [{ id: "A", policy: "", presetId: "" }]
}

export function addPolicySlot(slots: PolicySlot[]): PolicySlot[] {
  if (slots.length >= SLOT_IDS.length) return slots
  const nextId = SLOT_IDS.find((id) => !slots.some((slot) => slot.id === id))
  if (!nextId) return slots
  return [...slots, { id: nextId, policy: "", presetId: "" }]
}

export function removePolicySlot(slots: PolicySlot[], slotId: PolicySlotId): PolicySlot[] {
  if (slots.length <= 1) return createInitialSlots()
  return slots.filter((slot) => slot.id !== slotId)
}

export function updateSlotPolicy(slots: PolicySlot[], slotId: PolicySlotId, policy: string): PolicySlot[] {
  return slots.map((slot) => (slot.id === slotId ? { ...slot, policy, presetId: "" } : slot))
}

export function updateSlotFromPreset(
  slots: PolicySlot[],
  slotId: PolicySlotId,
  preset: ExperimentPreset,
): PolicySlot[] {
  return slots.map((slot) =>
    slot.id === slotId ? { ...slot, presetId: preset.id, policy: preset.prompt } : slot,
  )
}

export function getPresetOptions(presets: ExperimentPreset[]): PresetOptions {
  const topics = uniqueOptions(
    presets.map((preset) => ({ id: preset.topic_id, label: preset.topic })),
  )
  const byTopic = Object.fromEntries(
    topics.map((topic) => {
      const topicPresets = presets.filter((preset) => preset.topic_id === topic.id)
      return [
        topic.id,
        {
          variants: uniqueOptions(
            topicPresets.map((preset) => ({
              id: preset.parameter_variant,
              label: variantLabel(topicPresets, preset.parameter_variant),
            })),
          ),
          framings: uniqueOptions(
            topicPresets.map((preset) => ({
              id: preset.framing,
              label: FRAMING_LABELS[preset.framing] ?? preset.framing,
            })),
          ),
          contexts: uniqueOptions(
            topicPresets.map((preset) => ({
              id: preset.context,
              label: CONTEXT_LABELS[preset.context] ?? preset.context,
            })),
          ),
          stanceFormats: uniqueOptions(
            topicPresets.map((preset) => ({
              id: preset.stance_format,
              label: STANCE_FORMAT_LABELS[preset.stance_format] ?? preset.stance_format,
            })),
          ),
        },
      ]
    }),
  )

  return { topics, byTopic }
}

export function resolvePresetSelection(
  presets: ExperimentPreset[],
  selection: PresetSelection,
): ExperimentPreset | undefined {
  return presets.find(
    (preset) =>
      preset.topic_id === selection.topicId &&
      preset.parameter_variant === selection.variant &&
      preset.framing === selection.framing &&
      preset.context === selection.context &&
      preset.stance_format === selection.stanceFormat,
  )
}

export function selectionFromPreset(preset: ExperimentPreset): PresetSelection {
  return {
    topicId: preset.topic_id,
    variant: preset.parameter_variant,
    framing: preset.framing,
    context: preset.context,
    stanceFormat: preset.stance_format,
  }
}

export function resolveVisibleSlotId(
  visibleSlotIds: PolicySlotId[],
  selectedSlotId: PolicySlotId | null,
): PolicySlotId | null {
  if (selectedSlotId && visibleSlotIds.includes(selectedSlotId)) return selectedSlotId
  return visibleSlotIds[0] ?? null
}

export function computeStabilityReport(runs: MinimalAggregate[]): StabilityReport {
  return {
    support: metric(runs, "support"),
    oppose: metric(runs, "oppose"),
    neutral: metric(runs, "neutral"),
    runs,
  }
}

export function compareWithRealOpinion(aggregate: MinimalAggregate | null, realOpinion: RealOpinion | null) {
  if (!aggregate || !realOpinion) return null
  const total = aggregate.total.support + aggregate.total.oppose + aggregate.total.neutral
  if (!total) return null
  const support = Math.round((aggregate.total.support / total) * 100)
  const oppose = Math.round((aggregate.total.oppose / total) * 100)
  const neutral = Math.round((aggregate.total.neutral / total) * 100)
  const actualNeutral = realOpinion.neutral ?? 0
  return {
    realOpinion,
    support: { simulated: support, actual: realOpinion.support, diff: support - realOpinion.support },
    oppose: { simulated: oppose, actual: realOpinion.oppose, diff: oppose - realOpinion.oppose },
    neutral: { simulated: neutral, actual: actualNeutral, diff: neutral - actualNeutral },
  }
}

type SnapshotRunInput = {
  aggregate?: MinimalAggregate | null
  aggregateRuns?: MinimalAggregate[]
  samplingPlan?: SamplingPlanEvent | null
  sampledAgents?: AgentSampledEvent[]
  llmPrompts?: LlmPromptEvent[]
  llmOutputs?: Record<number, string>
  llmStatuses?: Record<number, LlmStatusEvent["status"]>
  llmHeartbeats?: Record<number, LlmHeartbeatEvent>
  llmErrors?: Record<number, LlmErrorEvent>
  responses?: AgentRespondedEvent[]
  summaryPrompt?: SummaryPromptEvent | null
  summaryStatus?: SummaryStatusEvent | null
  summaryOutput?: string
  summaryHeartbeat?: SummaryHeartbeatEvent | null
  summaryError?: SummaryErrorEvent | null
}

export type RestoredSnapshotRun = {
  phase: "idle" | "done"
  sampled: number
  samplingPlan: SamplingPlanEvent | null
  sampledAgents: AgentSampledEvent[]
  llmPrompts: LlmPromptEvent[]
  llmOutputs: Record<number, string>
  llmStatuses: Record<number, LlmStatusEvent["status"]>
  llmHeartbeats: Record<number, LlmHeartbeatEvent>
  llmErrors: Record<number, LlmErrorEvent>
  responses: AgentRespondedEvent[]
  summaryPrompt: SummaryPromptEvent | null
  summaryStatus: SummaryStatusEvent | null
  summaryOutput: string
  summaryHeartbeat: SummaryHeartbeatEvent | null
  summaryError: SummaryErrorEvent | null
  aggregate: AggregateEvent | null
  aggregateRuns: AggregateEvent[]
  currentRunIndex: number
  error: string | null
}

export function buildSnapshotResults(
  slots: ExperimentSnapshotSlot[],
  runs: Partial<Record<"A" | "B" | "C", SnapshotRunInput>>,
): ExperimentSnapshotResult[] {
  return slots.flatMap((slot) => {
    const run = runs[slot.id]
    if (!run?.aggregate) return []
    const aggregateRuns = run.aggregateRuns ?? []
    const stability = aggregateRuns.length > 1 ? stabilitySnapshot(aggregateRuns) : null
    return [
      {
        slotId: slot.id,
        presetId: slot.presetId,
        total: run.aggregate.total,
        runs: aggregateRuns.map((item) => item.total),
        stability,
        realOpinion: null,
        samplingPlan: run.samplingPlan ?? null,
        sampledAgents: run.sampledAgents ?? [],
        llmPrompts: run.llmPrompts ?? [],
        llmOutputs: run.llmOutputs ?? {},
        llmStatuses: run.llmStatuses ?? {},
        llmHeartbeats: run.llmHeartbeats ?? {},
        llmErrors: run.llmErrors ?? {},
        responses: run.responses ?? [],
        summaryPrompt: run.summaryPrompt ?? null,
        summaryStatus: run.summaryStatus ?? null,
        summaryOutput: run.summaryOutput ?? "",
        summaryHeartbeat: run.summaryHeartbeat ?? null,
        summaryError: run.summaryError ?? null,
        aggregate: run.aggregate as AggregateEvent,
        aggregateRuns: aggregateRuns as AggregateEvent[],
      },
    ]
  })
}

export function restoreSnapshotRuns(results: ExperimentSnapshotResult[]): Partial<Record<PolicySlotId, RestoredSnapshotRun>> {
  return Object.fromEntries(
    results.map((result) => {
      const aggregate = result.aggregate ?? aggregateFromTotal(result.total)
      const aggregateRuns = result.aggregateRuns ?? result.runs?.map(aggregateFromCounts) ?? []
      return [
        result.slotId,
        {
          phase: aggregate ? "done" : "idle",
          sampled: result.sampledAgents?.length ?? 0,
          samplingPlan: result.samplingPlan ?? null,
          sampledAgents: result.sampledAgents ?? [],
          llmPrompts: result.llmPrompts ?? [],
          llmOutputs: result.llmOutputs ?? {},
          llmStatuses: result.llmStatuses ?? {},
          llmHeartbeats: result.llmHeartbeats ?? {},
          llmErrors: result.llmErrors ?? {},
          responses: result.responses ?? [],
          summaryPrompt: result.summaryPrompt ?? null,
          summaryStatus: result.summaryStatus ?? null,
          summaryOutput: result.summaryOutput ?? "",
          summaryHeartbeat: result.summaryHeartbeat ?? null,
          summaryError: result.summaryError ?? null,
          aggregate,
          aggregateRuns,
          currentRunIndex: Math.max(0, aggregateRuns.length - 1),
          error: null,
        },
      ]
    }),
  )
}

function aggregateFromTotal(total: MinimalAggregate["total"] | null): AggregateEvent | null {
  return total ? aggregateFromCounts(total) : null
}

function aggregateFromCounts(total: MinimalAggregate["total"]): AggregateEvent {
  return {
    total,
    by_age: {},
    by_gender: {},
    by_region: {},
    concern_clusters: [],
    support_clusters: [],
    blind_spot_clusters: [],
    reframing_list: [],
  }
}

function stabilitySnapshot(runs: MinimalAggregate[]) {
  const report = computeStabilityReport(runs)
  return {
    supportMean: report.support.mean,
    supportStddev: report.support.stddev,
    opposeMean: report.oppose.mean,
    opposeStddev: report.oppose.stddev,
    neutralMean: report.neutral.mean,
    neutralStddev: report.neutral.stddev,
  }
}

function metric(runs: MinimalAggregate[], stance: "support" | "oppose" | "neutral"): StabilityMetric {
  const values = runs.map((run) => {
    const total = run.total.support + run.total.oppose + run.total.neutral
    return total ? (run.total[stance] / total) * 100 : 0
  })
  const meanValue = mean(values)
  return { mean: meanValue, stddev: stddev(values, meanValue), values }
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function stddev(values: number[], meanValue: number): number {
  if (values.length <= 1) return 0
  const variance = values.reduce((sum, value) => sum + (value - meanValue) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function uniqueOptions(options: PresetOption[]): PresetOption[] {
  const seen = new Set<string>()
  return options.filter((option) => {
    if (seen.has(option.id)) return false
    seen.add(option.id)
    return true
  })
}

function variantLabel(presets: ExperimentPreset[], variant: string): string {
  const label = presets.find((preset) => preset.parameter_variant === variant)?.label.split(" / ").at(-1)
  return label || VARIANT_LABELS[variant] || variant
}
