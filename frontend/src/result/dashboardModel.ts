import type { AgentRespondedEvent, Stance, StanceCounts, StructuredPolicy, StructuredPolicyField } from "../lib/api"
import type { CurrentRun } from "../lib/currentRunStore"

export type DashboardCluster = {
  quote: string
  count: number
  denominator: number | null
  inferredBased: boolean
  agentIds: number[]
}

export type DashboardAffectedGroup = {
  label: string
  count: number
  denominator: number | null
  agentIds: number[]
}

export type DashboardPersona = {
  agentId: number
  stance: Stance
  meta: string
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

  return {
    policyHeader: buildPolicyHeader(run.policy, run.structuredPolicy),
    nAgents: run.n_agents,
    stance: safeCounts(aggregate.total),
    concerns: clusterRows(aggregate.blind_spot_clusters),
    complaints: clusterRows(aggregate.complaint_clusters),
    affectedGroups: affectedGroupRows(aggregate.affected_group_clusters ?? aggregate.affected_groups),
    personas: personaRows(run.responses ?? []),
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

function clusterRows(value: unknown): DashboardCluster[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((cluster) => {
    if (!cluster || typeof cluster !== "object") return []
    const item = cluster as {
      representative_quote?: unknown
      blind_spot_examples?: unknown
      count?: unknown
      denominator?: unknown
      inferred_based?: unknown
      agent_ids?: unknown
    }
    const quote = textValue(item.representative_quote) || firstString(item.blind_spot_examples)
    if (!quote) return []
    return [
      {
        quote,
        count: Number(item.count) || 0,
        denominator: item.denominator == null ? null : Number(item.denominator) || 0,
        inferredBased: item.inferred_based === true,
        agentIds: numberArray(item.agent_ids),
      },
    ]
  })
}

function affectedGroupRows(value: unknown): DashboardAffectedGroup[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((group) => {
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
    return [
      {
        label,
        count: Number(item.count) || 0,
        denominator: item.denominator == null ? null : Number(item.denominator) || 0,
        agentIds: numberArray(item.agent_ids),
      },
    ]
  })
}

function personaRows(responses: AgentRespondedEvent[]): DashboardPersona[] {
  return responses.map((response) => ({
    agentId: response.agent_id,
    stance: response.stance,
    meta: personaMeta(response),
    rationale: response.rationale ?? "",
    blindSpot: textValue(response.blind_spot),
    expectedComplaint: textValue(response.expected_complaint),
  }))
}

function personaMeta(response: AgentRespondedEvent): string {
  return [
    response.age ? `${response.age}세` : "",
    [response.province, response.district].filter(Boolean).join(" "),
    response.occupation,
    response.family_type,
  ]
    .filter(Boolean)
    .join(" · ")
}

function firstPolicyLine(policy: string): string {
  return policy.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "제목 없음"
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

function firstString(value: unknown): string | null {
  return Array.isArray(value) ? textValue(value.find((item) => typeof item === "string")) : null
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.map(Number).filter((item) => Number.isInteger(item))
}
