import type { AgentRespondedEvent, Stance, StanceCounts, StructuredPolicy, StructuredPolicyField } from "../lib/api"
import type { CurrentRun } from "../lib/currentRunStore"

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

type RawDashboardCluster = DashboardCluster & {
  affectedGroup: string
  searchText: string
}

export type DashboardPersona = {
  agentId: number
  stance: Stance
  meta: string
  headlineParts: string[]
  metaParts: string[]
  rationale: string
  blindSpot: string | null
  expectedComplaint: string | null
}

export type DashboardPolicyHeader = {
  name: string
  fields: Array<{ key: keyof StructuredPolicy; label: string; value: string; source: StructuredPolicyField["source"] }>
}

export type DashboardModel = {
  policyHeader: DashboardPolicyHeader
  nAgents: number
  stance: StanceCounts
  concerns: DashboardCluster[]
  complaints: DashboardCluster[]
  affectedGroups: DashboardAffectedGroup[]
  personas: DashboardPersona[]
}

const EMPTY_COUNTS: StanceCounts = { support: 0, neutral: 0, oppose: 0 }

const POLICY_FIELD_LABELS: Record<keyof StructuredPolicy, string> = {
  policy_name: "정책명",
  target: "대상",
  apply_method: "신청 방식",
  exclusions: "제외 조건",
  context: "맥락",
}

export function buildDashboard(run: CurrentRun): DashboardModel {
  const aggregate = run.aggregate as CurrentRun["aggregate"] & {
    complaint_clusters?: unknown[]
    affected_group_clusters?: unknown[]
    affected_groups?: unknown[]
  }
  const rawConcerns = clusterRows(aggregate.blind_spot_clusters)

  return {
    policyHeader: buildPolicyHeader(run.policy, run.structuredPolicy),
    nAgents: run.n_agents,
    stance: safeCounts(aggregate.total),
    concerns: consolidateClusters(rawConcerns),
    complaints: clusterRows(aggregate.complaint_clusters),
    affectedGroups: affectedGroupRows(aggregate.affected_group_clusters ?? aggregate.affected_groups, rawConcerns),
    personas: representativePersonaRows(run.responses ?? [], rawConcerns, clusterRows(aggregate.complaint_clusters)),
  }
}

export function filterPersonasByAgentIds(personas: DashboardPersona[], agentIds: number[] | null): DashboardPersona[] {
  if (!agentIds || agentIds.length === 0) return personas
  const allowed = new Set(agentIds)
  return personas.filter((persona) => allowed.has(persona.agentId))
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

function safeCounts(value: unknown): StanceCounts {
  if (!value || typeof value !== "object") return EMPTY_COUNTS
  const counts = value as Partial<Record<Stance, unknown>>
  return {
    support: Number(counts.support) || 0,
    neutral: Number(counts.neutral) || 0,
    oppose: Number(counts.oppose) || 0,
  }
}

function clusterRows(value: unknown): RawDashboardCluster[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((cluster) => {
    if (!cluster || typeof cluster !== "object") return []
    const item = cluster as {
      representative_quote?: unknown
      blind_spot_examples?: unknown
      complaint_examples?: unknown
      affected_group?: unknown
      short_title?: unknown
      count?: unknown
      denominator?: unknown
      inferred_based?: unknown
      agent_ids?: unknown
    }
    const examples = strings(item.blind_spot_examples).concat(strings(item.complaint_examples))
    const quote = textValue(item.representative_quote) || examples[0]
    if (!quote) return []
    const affectedGroup = textValue(item.affected_group) || ""
    const label = textValue(item.short_title) || quote
    return [
      {
        label,
        quote,
        count: Number(item.count) || 0,
        denominator: item.denominator == null ? null : Number(item.denominator) || 0,
        inferredBased: item.inferred_based === true,
        agentIds: numberArray(item.agent_ids),
        affectedGroup,
        searchText: [quote, affectedGroup, textValue(item.short_title), ...examples].filter(Boolean).join(" "),
      },
    ]
  })
}

function affectedGroupRows(value: unknown, concernRows: RawDashboardCluster[]): DashboardAffectedGroup[] {
  if (!Array.isArray(value)) return []
  const rows = value.flatMap((group) => {
    if (!group || typeof group !== "object") return []
    const item = group as {
      representative_quote?: unknown
      affected_group?: unknown
      group?: unknown
      label?: unknown
      count?: unknown
      denominator?: unknown
      agent_ids?: unknown
    }
    const label = textValue(item.representative_quote) || textValue(item.affected_group) || textValue(item.group) || textValue(item.label)
    if (!label) return []
    const agentIds = numberArray(item.agent_ids)
    const relatedConcerns = relatedRows(concernRows, agentIds)
    return [
      {
        label,
        reason: joinedReasons(relatedConcerns.map((row) => row.quote)),
        count: Number(item.count) || 0,
        denominator: item.denominator == null ? null : Number(item.denominator) || 0,
        agentIds,
      },
    ]
  })
  return consolidateAffectedGroups(rows, concernRows)
}

function consolidateClusters(rows: RawDashboardCluster[]): DashboardCluster[] {
  const grouped = groupRows(rows, (row) => row.searchText)
  return grouped.map(({ theme, rows: groupRows }) => ({
    label: theme?.label ?? groupRows[0].label,
    quote: joinedReasons(groupRows.map((row) => row.quote)) ?? groupRows[0].quote,
    count: mergedCount(groupRows),
    denominator: mergedDenominator(groupRows),
    inferredBased: groupRows.some((row) => row.inferredBased),
    agentIds: mergedAgentIds(groupRows),
  }))
}

function consolidateAffectedGroups(rows: DashboardAffectedGroup[], concernRows: RawDashboardCluster[]): DashboardAffectedGroup[] {
  const grouped = groupRows(rows, (row) => {
    const related = relatedRows(concernRows, row.agentIds)
    return [row.label, row.reason, ...related.map((item) => item.searchText)].filter(Boolean).join(" ")
  })
  return grouped.map(({ theme, rows: groupRows }) => {
    const agentIds = mergedAgentIds(groupRows)
    const related = relatedRows(concernRows, agentIds)
    return {
      label: theme ? `${theme.label} 영향 집단` : groupRows[0].label,
      reason: joinedReasons(related.map((row) => row.quote)) ?? joinedReasons(groupRows.map((row) => row.reason)),
      count: agentIds.length || sumCounts(groupRows),
      denominator: mergedDenominator(groupRows),
      agentIds,
    }
  })
}

function groupRows<T extends { count: number; agentIds: number[] }>(rows: T[], textForRow: (row: T) => string): Array<{ theme: DisplayTheme | null; rows: T[] }> {
  const groups = new Map<string, { theme: DisplayTheme | null; rows: T[] }>()
  rows.forEach((row, index) => {
    const theme = classifyTheme(textForRow(row))
    const key = theme?.id ?? `raw-${index}`
    const existing = groups.get(key)
    if (existing) {
      existing.rows.push(row)
    } else {
      groups.set(key, { theme, rows: [row] })
    }
  })
  return Array.from(groups.values()).sort((a, b) => mergedCount(b.rows) - mergedCount(a.rows))
}

type DisplayTheme = { id: string; label: string }

function classifyTheme(text: string): DisplayTheme | null {
  const compact = text.toLowerCase()
  if (containsAny(compact, ["초과근무", "특수근무", "교대", "야간", "프리랜서", "일용직", "플랫폼", "비공식", "화물차", "소득 변동", "수입이", "유지심사", "기여금"])) {
    return { id: "income", label: "불규칙 소득·유지심사" }
  }
  if (containsAny(compact, ["모바일", "앱", "비대면", "디지털", "스마트폰", "오프라인", "창구"])) {
    return { id: "digital", label: "모바일·비대면 절차" }
  }
  if (containsAny(compact, ["가구", "가족", "부모", "동거", "주민등록", "세대", "배우자", "별거", "독립", "동의"])) {
    return { id: "household", label: "가구 기준·가족 동의" }
  }
  if (containsAny(compact, ["농촌", "지방", "지역", "지점", "은행"])) {
    return { id: "local", label: "지역·현장 접근성" }
  }
  return null
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword))
}

function relatedRows(rows: RawDashboardCluster[], agentIds: number[]): RawDashboardCluster[] {
  if (agentIds.length === 0) return []
  const allowed = new Set(agentIds)
  return rows.filter((row) => row.agentIds.some((agentId) => allowed.has(agentId)))
}

function joinedReasons(values: Array<string | null>): string | null {
  const unique = Array.from(new Set(values.flatMap((value) => (value ? [value] : []))))
  if (unique.length === 0) return null
  return unique.slice(0, 2).join(" / ")
}

function mergedCount(rows: Array<{ count: number; agentIds: number[] }>): number {
  const ids = mergedAgentIds(rows)
  return ids.length || sumCounts(rows)
}

function sumCounts(rows: Array<{ count: number }>): number {
  return rows.reduce((total, row) => total + row.count, 0)
}

function mergedDenominator(rows: Array<{ denominator: number | null }>): number | null {
  const values = rows.map((row) => row.denominator).filter((value): value is number => value != null)
  return values.length ? Math.max(...values) : null
}

function mergedAgentIds(rows: Array<{ agentIds: number[] }>): number[] {
  return Array.from(new Set(rows.flatMap((row) => row.agentIds))).sort((a, b) => a - b)
}

function personaRows(responses: AgentRespondedEvent[]): DashboardPersona[] {
  return responses.map((response) => ({
    agentId: response.agent_id,
    stance: response.stance,
    meta: personaMeta(response),
    headlineParts: personaHeadlineParts(response),
    metaParts: personaMetaParts(response),
    rationale: response.rationale ?? "",
    blindSpot: textValue(response.blind_spot),
    expectedComplaint: textValue(response.expected_complaint),
  }))
}

function representativePersonaRows(
  responses: AgentRespondedEvent[],
  concerns: RawDashboardCluster[],
  complaints: RawDashboardCluster[],
): DashboardPersona[] {
  const byId = new Map(responses.map((response) => [response.agent_id, response]))
  const signalRows = [...concerns, ...complaints]
  const clusterLeadIds = representativeClusterLeadIds(signalRows, byId)
  const signalIds = orderedAgentIds(signalRows)
  const fallbackIds = responses
    .filter((response) => response.blind_spot || response.expected_complaint)
    .map((response) => response.agent_id)
  const primaryIds = clusterLeadIds.length ? clusterLeadIds : fallbackIds
  const selectedIds = selectRepresentativeIds(primaryIds, responses, 6, signalIds.length ? signalIds : fallbackIds)
  return selectedIds.flatMap((agentId) => {
    const response = byId.get(agentId)
    return response ? [personaRows([response])[0]] : []
  })
}

function representativeClusterLeadIds(rows: Array<{ agentIds: number[] }>, byId: Map<number, AgentRespondedEvent>): number[] {
  return orderedUnique(
    rows.flatMap((row) => {
      const agentId = row.agentIds.find((id) => byId.has(id))
      return agentId == null ? [] : [agentId]
    }),
  )
}

function selectRepresentativeIds(
  agentIds: number[],
  responses: AgentRespondedEvent[],
  limit: number,
  fillAgentIds: number[] = agentIds,
): number[] {
  const byId = new Map(responses.map((response) => [response.agent_id, response]))
  const output: number[] = []
  const required = new Set<number>()
  const add = (agentId: number, options: { force?: boolean; required?: boolean } = {}) => {
    if (output.includes(agentId) || !byId.has(agentId)) return false
    if (output.length >= limit) {
      if (!options.required) return false
      const removableIndex = lastRemovableIndex(output, required)
      if (removableIndex < 0) return false
      output.splice(removableIndex, 1)
    }
    if (!options.force && isTooSimilarToSelected(agentId, output, byId)) return false
    output.push(agentId)
    if (options.required) required.add(agentId)
    return true
  }

  orderedUnique(agentIds).forEach((agentId) => add(agentId, { force: true }))
  const represented = () =>
    new Set(responses.flatMap((response) => (output.includes(response.agent_id) && response.stance ? [response.stance] : [])))
  const present = new Set(responses.flatMap((response) => (response.stance ? [response.stance] : [])))
  ;(["oppose", "neutral", "support"] as Stance[]).forEach((stance) => {
    if (!present.has(stance) || represented().has(stance)) return
    const response = responses.find((item) => item.stance === stance)
    if (response) add(response.agent_id, { force: true, required: true })
  })
  orderedUnique(fillAgentIds).forEach((agentId) => add(agentId))
  return output
}

function lastRemovableIndex(output: number[], required: Set<number>): number {
  for (let index = output.length - 1; index >= 0; index -= 1) {
    if (!required.has(output[index])) return index
  }
  return -1
}

function isTooSimilarToSelected(agentId: number, selectedIds: number[], byId: Map<number, AgentRespondedEvent>): boolean {
  const response = byId.get(agentId)
  if (!response) return false
  return selectedIds.some((selectedId) => responseSimilarity(response, byId.get(selectedId)) >= 0.45)
}

function responseSimilarity(left: AgentRespondedEvent, right?: AgentRespondedEvent): number {
  if (!right) return 0
  const leftTokens = importantTokens(responseSelectionText(left))
  const rightTokens = importantTokens(responseSelectionText(right))
  if (Math.min(leftTokens.size, rightTokens.size) < 3) return 0
  let shared = 0
  leftTokens.forEach((token) => {
    if (rightTokens.has(token)) shared += 1
  })
  return shared / Math.min(leftTokens.size, rightTokens.size)
}

function responseSelectionText(response: AgentRespondedEvent): string {
  return [response.blind_spot, response.expected_complaint, response.rationale].filter(Boolean).join(" ")
}

function importantTokens(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return new Set(tokens.filter((token) => token.length >= 3 && !SIMILARITY_STOPWORDS.has(token)))
}

const SIMILARITY_STOPWORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "get",
  "how",
  "need",
  "not",
  "the",
  "this",
  "that",
  "with",
])

function orderedUnique(values: number[]): number[] {
  const seen = new Set<number>()
  return values.flatMap((value) => {
    if (seen.has(value)) return []
    seen.add(value)
    return [value]
  })
}

function orderedAgentIds(rows: Array<{ agentIds: number[] }>): number[] {
  return orderedUnique(rows.flatMap((row) => row.agentIds))
}

function personaMeta(response: AgentRespondedEvent): string {
  return personaHeadlineParts(response).concat(personaMetaParts(response)).join(" · ")
}

function personaHeadlineParts(response: AgentRespondedEvent): string[] {
  return [
    `응답자 #${response.agent_id}`,
    response.age ? `${response.age}세` : "",
    personaRegion(response),
  ].filter((item): item is string => typeof item === "string" && item.length > 0)
}

function personaRegion(response: AgentRespondedEvent): string {
  const province = textValue(response.province)
  const district = textValue(response.district)
  if (district && province && district.includes(province)) return district
  return [province, district].filter(Boolean).join(" ")
}

function personaMetaParts(response: AgentRespondedEvent): string[] {
  return [
    response.occupation,
    response.family_type,
  ]
    .filter((item): item is string => typeof item === "string" && item.length > 0)
}

function firstPolicyLine(policy: string): string {
  return policy.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "제목 없음"
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => (typeof item === "string" && item.trim() ? [item.trim()] : [])) : []
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map(Number).filter((item) => Number.isInteger(item))
}
