import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { AgentRespondedEvent, AgentSampledEvent, AggregateEvent, SimulateRequest, StructuredPolicy } from "./api"

export type CurrentRun = {
  policy: string
  n_agents: number
  model_name: string
  model_provider: "openai"
  aggregate: AggregateEvent
  sampledAgents: AgentSampledEvent[]
  responses: AgentRespondedEvent[]
  structuredPolicy?: StructuredPolicy
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
  aggregate,
  sampledAgents,
  responses = [],
  structuredPolicy,
  completedAt = new Date().toISOString(),
}: {
  policy: string
  nAgents: number
  modelName: string
  modelProvider?: "openai"
  aggregate: AggregateEvent
  sampledAgents: AgentSampledEvent[]
  responses?: AgentRespondedEvent[]
  structuredPolicy?: StructuredPolicy
  completedAt?: string
}) {
  saveCurrentRun({
    policy,
    n_agents: nAgents,
    model_name: modelName,
    model_provider: modelProvider,
    aggregate,
    sampledAgents,
    responses,
    structuredPolicy,
    completedAt,
  })
  useCurrentRunStore.getState().setDraftRequest({
    policy,
    n_agents: nAgents,
    model_name: modelName,
  })
}

export function clearCurrentRun() {
  useCurrentRunStore.getState().clearCurrentRun()
}

export function getCurrentRunSnapshot() {
  return useCurrentRunStore.getState().currentRun
}
