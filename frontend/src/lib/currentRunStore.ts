import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type {
  AgentRespondedEvent,
  AgentSampledEvent,
  AggregateEvent,
  DiscoveryAggregate,
  DiscoverySummary,
  PersonaDepth,
  SimulateRequest,
  StructuredPolicyWithPromptFields,
} from "./api"

export type CurrentRun = {
  policy: string
  n_agents: number
  model_name: string
  model_provider: "openai"
  discoveryAggregate?: DiscoveryAggregate | null
  discoverySummary?: DiscoverySummary | null
  aggregate?: AggregateEvent | null
  sampledAgents: AgentSampledEvent[]
  responses: AgentRespondedEvent[]
  structuredPolicy?: StructuredPolicyWithPromptFields
  persona_depth?: PersonaDepth
  completedAt: string
}

type CurrentRunState = {
  currentRun: CurrentRun | null
  draftRequest: SimulateRequest | null
  setCurrentRun: (run: CurrentRun) => void
  setDraftRequest: (request: SimulateRequest) => void
  clearCurrentRun: () => void
}

export const useCurrentRunStore = create<CurrentRunState>()(
  persist(
    (set) => ({
      currentRun: null,
      draftRequest: null,
      setCurrentRun: (run) => set({ currentRun: run }),
      setDraftRequest: (request) => set({ draftRequest: request }),
      clearCurrentRun: () => set({ currentRun: null }),
    }),
    {
      name: "koreansim-current-run",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ currentRun: state.currentRun, draftRequest: state.draftRequest }),
    },
  ),
)

export function saveCurrentRun(run: CurrentRun) {
  useCurrentRunStore.getState().setCurrentRun(run)
}

export function saveExperimentRunAsCurrentRun({
  policy,
  nAgents,
  modelName,
  modelProvider = "openai",
  discoveryAggregate,
  discoverySummary,
  aggregate,
  sampledAgents,
  responses = [],
  structuredPolicy,
  personaDepth = "standard",
  completedAt = new Date().toISOString(),
}: {
  policy: string
  nAgents: number
  modelName: string
  modelProvider?: "openai"
  discoveryAggregate?: DiscoveryAggregate | null
  discoverySummary?: DiscoverySummary | null
  aggregate?: AggregateEvent | null
  sampledAgents: AgentSampledEvent[]
  responses?: AgentRespondedEvent[]
  structuredPolicy?: StructuredPolicyWithPromptFields
  personaDepth?: PersonaDepth
  completedAt?: string
}) {
  saveCurrentRun({
    policy,
    n_agents: nAgents,
    model_name: modelName,
    model_provider: modelProvider,
    discoveryAggregate,
    discoverySummary,
    aggregate,
    sampledAgents,
    responses,
    structuredPolicy,
    persona_depth: personaDepth,
    completedAt,
  })
  useCurrentRunStore.getState().setDraftRequest({
    policy,
    n_agents: nAgents,
    model_name: modelName,
    persona_depth: personaDepth,
  })
}

export function clearCurrentRun() {
  useCurrentRunStore.getState().clearCurrentRun()
}

export function getCurrentRunSnapshot() {
  return useCurrentRunStore.getState().currentRun
}
