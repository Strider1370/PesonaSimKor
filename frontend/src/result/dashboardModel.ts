import type {
  AgentRespondedEvent,
  DiscoveryAggregate,
  DiscoveryAggregateCell,
  DiscoverySummary,
  PersonaDepth,
  Stance,
  StanceCounts,
  StructuredPolicy,
  StructuredPolicyField,
} from "../lib/api"
import type { CurrentRun } from "../lib/currentRunStore"
import { tagLabel } from "./labels"

export type DashboardCluster = {
  label: string
  quote: string
  count: number
  denominator: number | null
  inferredBased: boolean
  agentIds: number[]
}

export type DashboardAffectedGroup = {
  label: string
  reason: string | null
  count: number
  denominator: number | null
  agentIds: number[]
}

export type DashboardPersona = {
  agentId: number
  stance: Stance
  meta: string
  headlineParts: string[]
  metaParts: Array<{ value: string; tooltip: string }>
  rationale: string
  blindSpot: string | null
  blindSpotReason: string | null
  affectedGroup: string | null
  grounding: "direct" | "inferred" | null
  expectedComplaint: string | null
  reframing: string | null
}

export type DashboardPolicyHeader = {
  name: string
  fields: Array<{ key: keyof StructuredPolicy; label: string; value: string; source: StructuredPolicyField["source"] }>
}

export type DashboardAxisRow = {
  axis: string
  category: string
  presence: boolean
  headcount: number
  population: number
  agentIds: number[]
  featured: boolean
}

export type DashboardHeatmapCell = DashboardAxisRow & {
  key: string
  secondaryAxis: string
  secondaryCategory: string
}

export type DashboardFeaturedAxis = {
  primary: string
  secondary: string | null
  rationale: string
}

export type DashboardStanceCategoryRow = {
  category: string
  support: number
  neutral: number
  oppose: number
  total: number
}

export type DashboardStanceAxis = {
  axis: string
  rows: DashboardStanceCategoryRow[]
}

export type DashboardModel = {
  policyHeader: DashboardPolicyHeader
  includedFields: string[]
  selectedOptional: string[]
  personaDepth?: PersonaDepth
  nAgents: number
  stance: StanceCounts
  featuredAxis: DashboardFeaturedAxis
  axisRows: DashboardAxisRow[]
  heatmap: DashboardHeatmapCell[]
  concerns: DashboardCluster[]
  complaints: DashboardCluster[]
  reframings: DashboardCluster[]
  affectedGroups: DashboardAffectedGroup[]
  personas: DashboardPersona[]
  stanceAxes: DashboardStanceAxis[]
}

const EMPTY_COUNTS: StanceCounts = { support: 0, neutral: 0, oppose: 0 }

const POLICY_FIELD_LABELS: Record<keyof StructuredPolicy, string> = {
  policy_name: "정책명",
  target: "대상",
  apply_method: "신청 방식",
  exclusions: "제외 조건",
  context: "맥락",
}

const AXIS_ORDER = [
  "age_band",
  "occupation_stratum",
  "household_stratum",
  "housing_stratum",
  "education_stratum",
  "field_stratum",
  "gender",
  "region_group",
]

export function buildDashboard(run: CurrentRun): DashboardModel {
  const aggregate = run.discoveryAggregate ?? emptyDiscoveryAggregate()
  const summary = run.discoverySummary ?? emptyDiscoverySummary()
  const responses = run.responses ?? []
  const featuredAxis = {
    primary: aggregate.featured_axis.primary,
    secondary: aggregate.featured_axis.secondary,
    rationale: summary.featured_axis_rationale,
  }

  return {
    policyHeader: buildPolicyHeader(run.policy, run.structuredPolicy),
    includedFields: run.structuredPolicy?.included_fields ?? [],
    selectedOptional: run.structuredPolicy?.relevant_optional_fields ?? [],
    personaDepth: run.persona_depth,
    nAgents: run.n_agents,
    stance: countsFromResponses(responses),
    featuredAxis,
    axisRows: AXIS_ORDER.flatMap((axis) => axisRows(aggregate, axis)),
    heatmap: featuredAxis.secondary ? heatmap2D(aggregate, featuredAxis.primary, featuredAxis.secondary) : [],
    concerns: blindSpotRows(summary),
    complaints: mergedRows(summary.merged_complaints),
    reframings: mergedRows(summary.merged_reframings),
    affectedGroups: affectedGroupRows(responses),
    personas: representativePersonaRows(responses, summary),
    stanceAxes: buildStanceAxes(responses, aggregate),
  }
}

export function axisRows(aggregate: DiscoveryAggregate, axisKey: string): DashboardAxisRow[] {
  const categories = aggregate.axes[axisKey] ?? {}
  return Object.entries(categories)
    .map(([category, cell]) => axisRow(axisKey, category, cell, aggregate.featured_axis.primary === axisKey))
    .sort((left, right) => {
      if (left.presence !== right.presence) return left.presence ? -1 : 1
      if (left.headcount !== right.headcount) return right.headcount - left.headcount
      if (left.population !== right.population) return right.population - left.population
      return left.category.localeCompare(right.category)
    })
}

export function heatmap2D(aggregate: DiscoveryAggregate, primaryAxis: string, secondaryAxis: string): DashboardHeatmapCell[] {
  const primaryByAgent = axisMembership(aggregate, primaryAxis)
  const secondaryByAgent = axisMembership(aggregate, secondaryAxis)
  const agentIds = orderedUnique([...primaryByAgent.keys(), ...secondaryByAgent.keys()])
  const grouped = new Map<string, { primaryCategory: string; secondaryCategory: string; agentIds: number[] }>()

  agentIds.forEach((agentId) => {
    const primaryCategory = primaryByAgent.get(agentId)
    const secondaryCategory = secondaryByAgent.get(agentId)
    if (!primaryCategory || !secondaryCategory) return
    const key = `${primaryAxis}|${primaryCategory}__${secondaryAxis}|${secondaryCategory}`
    const existing = grouped.get(key)
    if (existing) {
      existing.agentIds.push(agentId)
    } else {
      grouped.set(key, { primaryCategory, secondaryCategory, agentIds: [agentId] })
    }
  })

  return Array.from(grouped.entries())
    .map(([key, value]) => ({
      key,
      axis: primaryAxis,
      category: value.primaryCategory,
      secondaryAxis,
      secondaryCategory: value.secondaryCategory,
      presence: value.agentIds.length > 0,
      headcount: value.agentIds.length,
      population: value.agentIds.length,
      agentIds: value.agentIds.sort((a, b) => a - b),
      featured: true,
    }))
    .sort((left, right) => right.headcount - left.headcount || left.key.localeCompare(right.key))
}

export function filterPersonasByAgentIds(personas: DashboardPersona[], agentIds: number[] | null): DashboardPersona[] {
  if (!agentIds || agentIds.length === 0) return personas
  const allowed = new Set(agentIds)
  return personas.filter((persona) => allowed.has(persona.agentId))
}

function axisRow(axis: string, category: string, cell: DiscoveryAggregateCell, featured: boolean): DashboardAxisRow {
  return {
    axis,
    category,
    presence: cell.presence,
    headcount: cell.blind_spot_headcount,
    population: cell.category_population,
    agentIds: [...cell.agent_ids].sort((a, b) => a - b),
    featured,
  }
}

function axisMembership(aggregate: DiscoveryAggregate, axis: string): Map<number, string> {
  const output = new Map<number, string>()
  Object.entries(aggregate.axes[axis] ?? {}).forEach(([category, cell]) => {
    cell.agent_ids.forEach((agentId) => output.set(agentId, category))
  })
  return output
}

function blindSpotRows(summary: DiscoverySummary): DashboardCluster[] {
  return summary.merged_blind_spots.map((item) => ({
    label: item.label,
    quote: item.text,
    count: item.agent_ids.length,
    denominator: null,
    inferredBased: item.grounding === "inferred",
    agentIds: sortedIds(item.agent_ids),
  }))
}

function mergedRows(items: Array<{ label: string; short_label?: string; text?: string; agent_ids: number[] }>): DashboardCluster[] {
  return items.map((item) => ({
    label: item.short_label ?? item.label,
    quote: item.text ?? item.label,
    count: item.agent_ids.length,
    denominator: null,
    inferredBased: false,
    agentIds: sortedIds(item.agent_ids),
  }))
}

function affectedGroupRows(responses: AgentRespondedEvent[]): DashboardAffectedGroup[] {
  const groups = new Map<string, { reasons: string[]; agentIds: number[] }>()
  responses.forEach((response) => {
    const label = textValue(response.affected_group)
    if (!label) return
    const existing = groups.get(label) ?? { reasons: [], agentIds: [] }
    existing.agentIds.push(response.agent_id)
    const reason = textValue(response.blind_spot_reason) || textValue(response.blind_spot)
    if (reason) existing.reasons.push(reason)
    groups.set(label, existing)
  })
  return Array.from(groups.entries())
    .map(([label, value]) => {
      const agentIds = sortedIds(value.agentIds)
      return {
        label,
        reason: unique(value.reasons).slice(0, 2).join(" / ") || null,
        count: agentIds.length,
        denominator: null,
        agentIds,
      }
    })
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
}

function representativePersonaRows(responses: AgentRespondedEvent[], summary: DiscoverySummary): DashboardPersona[] {
  const signalIds = orderedUnique([
    ...summary.merged_blind_spots.flatMap((item) => item.agent_ids),
    ...summary.merged_complaints.flatMap((item) => item.agent_ids),
    ...responses.filter((response) => response.blind_spot || response.expected_complaint).map((response) => response.agent_id),
  ])
  const selected = new Set<number>()
  const output: AgentRespondedEvent[] = []
  const add = (response: AgentRespondedEvent | undefined) => {
    if (!response || selected.has(response.agent_id)) return
    selected.add(response.agent_id)
    output.push(response)
  }
  // 1순위: blind_spot / complaint 신호가 있는 페르소나
  signalIds.forEach((agentId) => add(responses.find((response) => response.agent_id === agentId)))
  // 2순위: 스탠스별 대표 1명 (신호 없어도 찬성·반대·중립 각 1명은 보장)
  ;(["oppose", "neutral", "support"] as Stance[]).forEach((stance) => {
    if (output.some((response) => response.stance === stance)) return
    add(responses.find((response) => response.stance === stance))
  })
  // 신호 없는 나머지는 포함하지 않음
  return output.map(personaRow)
}

function personaRow(response: AgentRespondedEvent): DashboardPersona {
  const genderLabel = response.gender === "male" ? "남" : response.gender === "female" ? "여" : null
  const headlineParts = [
    response.name ?? `응답 #${response.agent_id}`,
    response.age ? `${response.age}세 · ${genderLabel ?? ""}`.replace(/ · $/, "") : "",
    personaRegion(response),
  ].filter((item): item is string => Boolean(item))
  const metaParts = [
    response.occupation ? { value: response.occupation, tooltip: "직업" } : undefined,
    response.occupation_stratum ? { value: tagLabel(response.occupation_stratum), tooltip: "직업 계층" } : undefined,
    response.household_stratum ? { value: tagLabel(response.household_stratum), tooltip: "가구 유형" } : undefined,
    response.housing_stratum ? { value: tagLabel(response.housing_stratum), tooltip: "주거 유형" } : undefined,
    response.education_stratum ? { value: tagLabel(response.education_stratum), tooltip: "학력" } : undefined,
    response.field_stratum ? { value: tagLabel(response.field_stratum), tooltip: "전공" } : undefined,
  ].filter((item): item is { value: string; tooltip: string } => Boolean(item))
  return {
    agentId: response.agent_id,
    stance: response.stance,
    meta: headlineParts.concat(metaParts.map((p) => p.value)).join(" · "),
    headlineParts,
    metaParts,
    rationale: response.rationale ?? "",
    blindSpot: textValue(response.blind_spot),
    blindSpotReason: textValue(response.blind_spot_reason),
    affectedGroup: textValue(response.affected_group),
    grounding: response.grounding ?? null,
    expectedComplaint: textValue(response.expected_complaint),
    reframing: textValue(response.reframing),
  }
}

const STANCE_AXIS_KEYS = ["age_band", "gender", "occupation_stratum", "region_group"]

const AXIS_CATEGORY_ORDER: Record<string, string[]> = {
  age_band: ["70_plus", "60s", "50s", "40s", "30s", "20s"],
  gender: ["male", "female"],
  occupation_stratum: [
    "1", "2", "3", "4", "5", "6", "7", "8", "9", "A",
    "unemployed_노년은퇴", "unemployed_전업돌봄", "unemployed_청년취준", "unemployed_구직중", "unemployed_기타", "unemployed", "etc",
  ],
  region_group: ["capital", "yeongnam", "honam", "chungcheong", "gangwon", "jeju", "other"],
}

const RESPONSE_AXIS_KEY: Record<string, keyof AgentRespondedEvent> = {
  age_band: "age_band",
  gender: "gender",
  occupation_stratum: "occupation_stratum",
  region_group: "region_group",
}

function buildStanceAxes(responses: AgentRespondedEvent[], _aggregate: DiscoveryAggregate): DashboardStanceAxis[] {
  return STANCE_AXIS_KEYS.flatMap((axis) => {
    const responseKey = RESPONSE_AXIS_KEY[axis]
    const order = AXIS_CATEGORY_ORDER[axis] ?? []

    // aggregate.axes의 agent_ids는 blind_spot 보유자만 포함하므로
    // responses에서 직접 집계
    const grouped = new Map<string, { support: number; neutral: number; oppose: number; total: number }>()
    responses.forEach((r) => {
      const category = r[responseKey] as string | undefined
      if (!category) return
      const existing = grouped.get(category) ?? { support: 0, neutral: 0, oppose: 0, total: 0 }
      existing[r.stance]++
      existing.total++
      grouped.set(category, existing)
    })

    const rows = Array.from(grouped.entries())
      .map(([category, counts]) => ({ category, ...counts }))
      .sort((a, b) => {
        const ai = order.indexOf(a.category)
        const bi = order.indexOf(b.category)
        if (ai === -1 && bi === -1) return b.total - a.total
        if (ai === -1) return 1
        if (bi === -1) return -1
        return ai - bi
      })

    return rows.length > 0 ? [{ axis, rows }] : []
  })
}

function buildPolicyHeader(policy: string, structuredPolicy?: StructuredPolicy): DashboardPolicyHeader {
  const name = textValue(structuredPolicy?.policy_name?.value) || firstPolicyLine(policy)
  const fields = (Object.keys(POLICY_FIELD_LABELS) as Array<keyof StructuredPolicy>).flatMap((key) => {
    const field = structuredPolicy?.[key]
    const value = textValue(field?.value)
    if (!field || !value) return []
    return [{ key, label: POLICY_FIELD_LABELS[key], value, source: field.source }]
  })
  return { name, fields }
}

function countsFromResponses(responses: AgentRespondedEvent[]): StanceCounts {
  return responses.reduce(
    (counts, response) => {
      counts[response.stance] += 1
      return counts
    },
    { ...EMPTY_COUNTS },
  )
}

function emptyDiscoveryAggregate(): DiscoveryAggregate {
  return {
    axes: {},
    featured_axis: { primary: "occupation_stratum", secondary: null },
  }
}

function emptyDiscoverySummary(): DiscoverySummary {
  return {
    merged_blind_spots: [],
    merged_reframings: [],
    merged_complaints: [],
    featured_axis_rationale: "",
  }
}

function personaRegion(response: AgentRespondedEvent): string {
  const province = textValue(response.province)
  const district = textValue(response.district)
  if (district && province && district.includes(province)) return district
  return [province, district].filter(Boolean).join(" ")
}

function firstPolicyLine(policy: string): string {
  return policy.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "제목 없음"
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function sortedIds(values: number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

function orderedUnique(values: number[]): number[] {
  const seen = new Set<number>()
  return values.flatMap((value) => {
    if (seen.has(value)) return []
    seen.add(value)
    return [value]
  })
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}
