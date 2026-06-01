import { useEffect, useMemo, useState } from "react"
import { useRef } from "react"
import {
  AggregateEvent,
  AgentSampledEvent,
  AgentRespondedEvent,
  AgeGroup,
  Gender,
  HealthStatus,
  LlmErrorEvent,
  LlmHeartbeatEvent,
  LlmPromptEvent,
  LlmStatusEvent,
  LlmTokenEvent,
  RegionGroup,
  SamplingPlanEvent,
  Stance,
  StanceCounts,
  StructuredPolicy,
  SummaryErrorEvent,
  SummaryHeartbeatEvent,
  SummaryPromptEvent,
  SummaryStatusEvent,
  SummaryTokenEvent,
  getHealth,
  listProjectCsvExports,
  loadProjectCsvExport,
  ProjectCsvExport,
  saveProjectCsvExport,
  simulate,
} from "./lib/api"
import {
  buildExperimentCsv,
  downloadCsv,
} from "./lib/experimentCsv"
import {
  PolicySlotId,
  addPolicySlot,
  buildSnapshotResults,
  computeStabilityReport,
  createInitialSlots,
  removePolicySlot,
  restoreSnapshotRuns,
  resolveVisibleSlotId,
  updateSlotPolicy,
} from "./lib/experiment"
import {
  ExperimentSnapshot,
  deleteExperimentSnapshot,
  listExperimentSnapshots,
  saveExperimentSnapshot,
} from "./lib/experimentStorage"
import { CurrentRun, saveCurrentRun, saveExperimentRunAsCurrentRun, useCurrentRunStore } from "./lib/currentRunStore"
import { ResultPage } from "./result/ResultPage"

type Phase = "idle" | "running" | "done" | "error" | "stopped"
type Page = "main" | "result"

const STANCE_LABELS: Record<Stance, string> = {
  support: "찬성",
  oppose: "반대",
  neutral: "중립",
}

const GENDER_LABELS: Record<Gender, string> = {
  male: "남성",
  female: "여성",
  unknown: "미상",
}

const AGE_LABELS: Record<AgeGroup, string> = {
  "20s": "20대 이하",
  "30s": "30대",
  "40s": "40대",
  "50s": "50대",
  "60s": "60대",
  "70_plus": "70대 이상",
}

const REGION_LABELS: Record<RegionGroup, string> = {
  capital: "수도권",
  yeongnam: "영남",
  honam: "호남",
  chungcheong: "충청",
  gangwon: "강원",
  jeju: "제주",
  other: "기타",
}

const EMPTY_COUNTS: StanceCounts = { support: 0, oppose: 0, neutral: 0 }
const DEFAULT_MODEL_PROVIDER = "openai" as const
const DEFAULT_MODEL_NAME = "gpt-5-mini"

export default function App() {
  const [page, setPage] = useState<Page>(() => pageFromLocation())
  const [policy, setPolicy] = useState("")
  const [nAgents, setNAgents] = useState(30)
  const [phase, setPhase] = useState<Phase>("idle")
  const [samplingPlan, setSamplingPlan] = useState<SamplingPlanEvent | null>(null)
  const [sampled, setSampled] = useState<AgentSampledEvent[]>([])
  const [llmPrompts, setLlmPrompts] = useState<LlmPromptEvent[]>([])
  const [llmOutputs, setLlmOutputs] = useState<Record<number, string>>({})
  const [llmStatuses, setLlmStatuses] = useState<Record<number, LlmStatusEvent["status"]>>({})
  const [llmHeartbeats, setLlmHeartbeats] = useState<Record<number, LlmHeartbeatEvent>>({})
  const [llmErrors, setLlmErrors] = useState<Record<number, LlmErrorEvent>>({})
  const [llmActivityAt, setLlmActivityAt] = useState<Record<number, number>>({})
  const [responses, setResponses] = useState<AgentRespondedEvent[]>([])
  const [structuredPolicy, setStructuredPolicy] = useState<StructuredPolicy | undefined>(undefined)
  const [summaryPrompt, setSummaryPrompt] = useState<SummaryPromptEvent | null>(null)
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatusEvent | null>(null)
  const [summaryOutput, setSummaryOutput] = useState("")
  const [summaryHeartbeat, setSummaryHeartbeat] = useState<SummaryHeartbeatEvent | null>(null)
  const [summaryError, setSummaryError] = useState<SummaryErrorEvent | null>(null)
  const [summaryActivityAt, setSummaryActivityAt] = useState<number | null>(null)
  const [aggregate, setAggregate] = useState<AggregateEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [health, setHealth] = useState<HealthStatus | null>(null)
  const [healthError, setHealthError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const abortControllerRef = useRef<AbortController | null>(null)
  const draftRequest = useCurrentRunStore((state) => state.draftRequest)

  const progress = useMemo(() => Math.round((responses.length / nAgents) * 100), [responses.length, nAgents])
  const sampledById = useMemo(() => new Map(sampled.map((agent) => [agent.agent_id, agent])), [sampled])
  const llmAgentIds = useMemo(() => {
    const ids = new Set<number>()
    llmPrompts.forEach((prompt) => ids.add(prompt.agent_id))
    Object.keys(llmOutputs).forEach((agentId) => ids.add(Number(agentId)))
    Object.keys(llmStatuses).forEach((agentId) => ids.add(Number(agentId)))
    Object.keys(llmHeartbeats).forEach((agentId) => ids.add(Number(agentId)))
    Object.keys(llmErrors).forEach((agentId) => ids.add(Number(agentId)))
    return Array.from(ids).sort((a, b) => a - b)
  }, [llmPrompts, llmOutputs, llmStatuses, llmHeartbeats, llmErrors])

  useEffect(() => {
    function handlePopState() {
      setPage(pageFromLocation())
    }

    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [])

  useEffect(() => {
    if (phase !== "running") return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    if (page !== "main" || !draftRequest) return
    setPolicy(draftRequest.policy)
    setNAgents(draftRequest.n_agents)
  }, [page, draftRequest])

  useEffect(() => {
    let cancelled = false

    async function refreshHealth() {
      try {
        const nextHealth = await getHealth()
        if (cancelled) return
        setHealth(nextHealth)
        setHealthError(null)
      } catch (err) {
        if (cancelled) return
        setHealth(null)
        setHealthError(err instanceof Error ? err.message : "Health check failed")
      }
    }

    refreshHealth()
    const timer = window.setInterval(refreshHealth, 5000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  async function runSimulation() {
    const trimmed = policy.trim()
    if (!trimmed || phase === "running") return
    const requestedAgents = nAgents
    const modelProvider = DEFAULT_MODEL_PROVIDER
    const modelName = DEFAULT_MODEL_NAME
    const sampledForRun: AgentSampledEvent[] = []
    const responsesForRun: AgentRespondedEvent[] = []
    let structuredPolicyForRun: StructuredPolicy | undefined

    const controller = new AbortController()
    abortControllerRef.current = controller
    setPhase("running")
    setSamplingPlan(null)
    setSampled([])
    setLlmPrompts([])
    setLlmOutputs({})
    setLlmStatuses({})
    setLlmHeartbeats({})
    setLlmErrors({})
    setLlmActivityAt({})
    setResponses([])
    setStructuredPolicy(undefined)
    setSummaryPrompt(null)
    setSummaryStatus(null)
    setSummaryOutput("")
    setSummaryHeartbeat(null)
    setSummaryError(null)
    setSummaryActivityAt(null)
    setAggregate(null)
    setError(null)

    try {
      for await (const event of simulate({ policy: trimmed, n_agents: requestedAgents }, controller.signal)) {
        const activityAt = Date.now()
        if (event.type === "policy_structured") {
          structuredPolicyForRun = event.data
          setStructuredPolicy(event.data)
        } else if (event.type === "sampling_plan") {
          setSamplingPlan(event.data)
        } else if (event.type === "agent_sampled") {
          sampledForRun.push(event.data)
          setSampled((prev) => [...prev, event.data])
        } else if (event.type === "llm_prompt") {
          setLlmPrompts((prev) => [...prev, event.data])
        } else if (event.type === "llm_status") {
          setLlmStatuses((prev) => ({ ...prev, [event.data.agent_id]: event.data.status }))
          setLlmActivityAt((prev) => ({ ...prev, [event.data.agent_id]: activityAt }))
          setLlmOutputs((prev) => ({ ...prev, [event.data.agent_id]: prev[event.data.agent_id] ?? "" }))
        } else if (event.type === "llm_heartbeat") {
          setLlmHeartbeats((prev) => ({ ...prev, [event.data.agent_id]: event.data }))
          setLlmOutputs((prev) => ({ ...prev, [event.data.agent_id]: prev[event.data.agent_id] ?? "" }))
        } else if (event.type === "llm_error") {
          setLlmErrors((prev) => ({ ...prev, [event.data.agent_id]: event.data }))
          setLlmOutputs((prev) => ({ ...prev, [event.data.agent_id]: prev[event.data.agent_id] ?? "" }))
        } else if (event.type === "llm_token") {
          appendLlmToken(event.data, setLlmOutputs)
          setLlmActivityAt((prev) => ({ ...prev, [event.data.agent_id]: activityAt }))
        } else if (event.type === "agent_responded") {
          responsesForRun.push(event.data)
          setResponses((prev) => [...prev, event.data])
        } else if (event.type === "summary_prompt") {
          setSummaryPrompt(event.data)
        } else if (event.type === "summary_status") {
          setSummaryStatus(event.data)
          setSummaryActivityAt(activityAt)
        } else if (event.type === "summary_token") {
          appendSummaryToken(event.data, setSummaryOutput)
          setSummaryActivityAt(activityAt)
        } else if (event.type === "summary_heartbeat") {
          setSummaryHeartbeat(event.data)
        } else if (event.type === "summary_error") {
          setSummaryError(event.data)
          setSummaryActivityAt(activityAt)
        } else if (event.type === "aggregate") {
          setAggregate(event.data)
          saveCurrentRun({
            policy: trimmed,
            n_agents: requestedAgents,
            model_name: modelName,
            model_provider: modelProvider,
            aggregate: event.data,
            sampledAgents: sampledForRun.slice(),
            responses: responsesForRun.slice(),
            structuredPolicy: structuredPolicyForRun,
            completedAt: new Date().toISOString(),
          })
          useCurrentRunStore.getState().setDraftRequest({
            policy: trimmed,
            n_agents: requestedAgents,
            model_name: modelName,
          })
        } else if (event.type === "error") {
          setError(event.data.message)
          setPhase("error")
        } else if (event.type === "done") {
          setPhase("done")
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setPhase("stopped")
        return
      }
      setError(err instanceof Error ? err.message : "시뮬레이션 요청에 실패했습니다.")
      setPhase("error")
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }

  function stopSimulation() {
    if (phase !== "running") return
    abortControllerRef.current?.abort()
    setPhase("stopped")
  }

  function resetSimulation() {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setPhase("idle")
    setSamplingPlan(null)
    setSampled([])
    setLlmPrompts([])
    setLlmOutputs({})
    setLlmStatuses({})
    setLlmHeartbeats({})
    setLlmErrors({})
    setLlmActivityAt({})
    setResponses([])
    setStructuredPolicy(undefined)
    setSummaryPrompt(null)
    setSummaryStatus(null)
    setSummaryOutput("")
    setSummaryHeartbeat(null)
    setSummaryError(null)
    setSummaryActivityAt(null)
    setAggregate(null)
    setError(null)
  }

  function navigatePage(nextPage: Page) {
    const nextPath = nextPage === "result" ? "/result" : "/"
    window.history.pushState(null, "", nextPath)
    setPage(nextPage)
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <Topbar
          page={page}
          phase={phase}
          progress={progress}
          health={health}
          healthError={healthError}
          onOpenResult={() => navigatePage("result")}
          onOpenMain={() => navigatePage("main")}
        />

        {page === "result" ? (
          <ResultPage
            onDebug={() => navigatePage("main")}
          />
        ) : (
          <ExperimentPage onOpenResult={() => navigatePage("result")} />
        )}
      </section>
    </main>
  )
}

type ExperimentRunState = {
  phase: Phase
  sampled: number
  samplingPlan: SamplingPlanEvent | null
  sampledAgents: AgentSampledEvent[]
  llmPrompts: LlmPromptEvent[]
  llmOutputs: Record<number, string>
  llmStatuses: Record<number, LlmStatusEvent["status"]>
  llmHeartbeats: Record<number, LlmHeartbeatEvent>
  llmErrors: Record<number, LlmErrorEvent>
  responses: AgentRespondedEvent[]
  structuredPolicy?: StructuredPolicy
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

export function Topbar({
  page,
  phase,
  progress,
  health,
  healthError,
  onOpenResult,
  onOpenMain,
}: {
  page: Page
  phase: Phase
  progress: number
  health: HealthStatus | null
  healthError: string | null
  onOpenResult: () => void
  onOpenMain: () => void
}) {
  return (
    <header className="topbar">
      <div>
        <h1>KoreanSim</h1>
        <p>정책 초안을 입력해 실행 과정에서 놓치기 쉬운 집단과 예상 민원을 확인합니다.</p>
      </div>
      <div className="topbar-status">
        {page === "main" ? (
          <button type="button" className="secondary-button topbar-result-button" onClick={onOpenResult}>
            결과
          </button>
        ) : (
          <button type="button" className="secondary-button topbar-result-button" onClick={onOpenMain}>
            메인
          </button>
        )}
      </div>
    </header>
  )
}

export function ExperimentLevels() {
  const activeLevels = getActiveLevels()
  const levels = [
    { id: 1, label: "다양성" },
    { id: 2, label: "민원" },
    { id: 3, label: "반문" },
    { id: 4, label: "대안" },
  ]

  return (
    <section className="level-panel" aria-label="검증 Level">
      <div className="level-tabs">
        {levels.map((level) => {
          const active = activeLevels.includes(level.id)
          return (
            <div key={level.id} className={`level-tab ${active ? "active" : ""}`}>
              <strong>
                L{level.id}: {level.label}
              </strong>
              <span>{active ? "ON" : "OFF"}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ExperimentPage({ onOpenResult }: { onOpenResult: () => void }) {
  const [slots, setSlots] = useState(createInitialSlots)
  const [nAgents, setNAgents] = useState(30)
  const [repeatCount, setRepeatCount] = useState<1 | 3 | 5>(1)
  const [openAiModelName, setOpenAiModelName] = useState("gpt-5-mini")
  const [personaDepth, setPersonaDepth] = useState<"minimal" | "standard" | "full">("standard")
  const [runs, setRuns] = useState<Partial<Record<PolicySlotId, ExperimentRunState>>>({})
  const [selectedTraceSlot, setSelectedTraceSlot] = useState<PolicySlotId | null>(null)
  const [savedSnapshots, setSavedSnapshots] = useState<ExperimentSnapshot[]>(() => listExperimentSnapshots())
  const [snapshotName, setSnapshotName] = useState("")
  const [projectCsvExports, setProjectCsvExports] = useState<ProjectCsvExport[]>([])
  const [projectCsvStatus, setProjectCsvStatus] = useState<string | null>(null)
  const [projectCsvError, setProjectCsvError] = useState<string | null>(null)
  const controllersRef = useRef<Partial<Record<PolicySlotId, AbortController>>>({})
  const activeSlots = slots.filter((slot) => slot.policy.trim())
  const isRunning = Object.values(runs).some((run) => run?.phase === "running")
  const effectiveModelName = openAiModelName

  useEffect(() => {
    refreshProjectCsvExports()
  }, [])

  function setRun(slotId: PolicySlotId, updater: (prev: ExperimentRunState) => ExperimentRunState) {
    setRuns((prev) => ({
      ...prev,
      [slotId]: updater(prev[slotId] ?? emptyExperimentRun()),
    }))
  }

  async function runSlot(slotId: PolicySlotId, policy: string) {
    const controller = new AbortController()
    controllersRef.current[slotId] = controller
    setRun(slotId, () => ({ ...emptyExperimentRun(), phase: "running", aggregateRuns: [], currentRunIndex: 0 }))

    try {
      for (let runIndex = 0; runIndex < repeatCount; runIndex += 1) {
        setRun(slotId, (prev) => ({
          ...emptyExperimentRun(),
          aggregateRuns: prev.aggregateRuns,
          currentRunIndex: runIndex,
          phase: "running",
        }))

        for await (const event of simulate(
          {
            policy,
            n_agents: nAgents,
            model_name: effectiveModelName,
            persona_depth: personaDepth,
          },
          controller.signal,
        )) {
          if (event.type === "policy_structured") {
            setRun(slotId, (prev) => ({ ...prev, structuredPolicy: event.data }))
          } else if (event.type === "sampling_plan") {
            setRun(slotId, (prev) => ({ ...prev, samplingPlan: event.data }))
          } else if (event.type === "agent_sampled") {
            setRun(slotId, (prev) => ({
              ...prev,
              sampled: prev.sampled + 1,
              sampledAgents: [...prev.sampledAgents, event.data],
            }))
          } else if (event.type === "llm_prompt") {
            setRun(slotId, (prev) => ({ ...prev, llmPrompts: [...prev.llmPrompts, event.data] }))
          } else if (event.type === "llm_status") {
            setRun(slotId, (prev) => ({
              ...prev,
              llmStatuses: { ...prev.llmStatuses, [event.data.agent_id]: event.data.status },
              llmOutputs: { ...prev.llmOutputs, [event.data.agent_id]: prev.llmOutputs[event.data.agent_id] ?? "" },
            }))
          } else if (event.type === "llm_heartbeat") {
            setRun(slotId, (prev) => ({
              ...prev,
              llmHeartbeats: { ...prev.llmHeartbeats, [event.data.agent_id]: event.data },
              llmOutputs: { ...prev.llmOutputs, [event.data.agent_id]: prev.llmOutputs[event.data.agent_id] ?? "" },
            }))
          } else if (event.type === "llm_error") {
            setRun(slotId, (prev) => ({
              ...prev,
              llmErrors: { ...prev.llmErrors, [event.data.agent_id]: event.data },
              llmOutputs: { ...prev.llmOutputs, [event.data.agent_id]: prev.llmOutputs[event.data.agent_id] ?? "" },
            }))
          } else if (event.type === "llm_token") {
            setRun(slotId, (prev) => ({
              ...prev,
              llmOutputs: {
                ...prev.llmOutputs,
                [event.data.agent_id]: `${prev.llmOutputs[event.data.agent_id] ?? ""}${event.data.content}`,
              },
            }))
          } else if (event.type === "agent_responded") {
            setRun(slotId, (prev) => ({ ...prev, responses: [...prev.responses, event.data] }))
          } else if (event.type === "summary_prompt") {
            setRun(slotId, (prev) => ({ ...prev, summaryPrompt: event.data }))
          } else if (event.type === "summary_status") {
            setRun(slotId, (prev) => ({ ...prev, summaryStatus: event.data }))
          } else if (event.type === "summary_token") {
            setRun(slotId, (prev) => ({ ...prev, summaryOutput: `${prev.summaryOutput}${event.data.content}` }))
          } else if (event.type === "summary_heartbeat") {
            setRun(slotId, (prev) => ({ ...prev, summaryHeartbeat: event.data }))
          } else if (event.type === "summary_error") {
            setRun(slotId, (prev) => ({ ...prev, summaryError: event.data }))
          } else if (event.type === "aggregate") {
            setRun(slotId, (prev) => ({
              ...prev,
              aggregate: event.data,
              aggregateRuns: [...prev.aggregateRuns, event.data],
            }))
          } else if (event.type === "error") {
            setRun(slotId, (prev) => ({ ...prev, phase: "error", error: event.data.message }))
          } else if (event.type === "done") {
            setRun(slotId, (prev) => ({ ...prev, phase: runIndex === repeatCount - 1 ? "done" : "running" }))
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setRun(slotId, (prev) => ({ ...prev, phase: "stopped" }))
      } else {
        setRun(slotId, (prev) => ({
          ...prev,
          phase: "error",
          error: err instanceof Error ? err.message : "실험 실행에 실패했습니다.",
        }))
      }
    } finally {
      delete controllersRef.current[slotId]
    }
  }

  async function runExperiment() {
    if (isRunning || activeSlots.length === 0) return
    setRuns(
      Object.fromEntries(activeSlots.map((slot) => [slot.id, { ...emptyExperimentRun(), phase: "idle" }])) as Partial<
        Record<PolicySlotId, ExperimentRunState>
      >,
    )
    setSelectedTraceSlot(activeSlots[0]?.id ?? null)
    await Promise.all(activeSlots.map((slot) => runSlot(slot.id, slot.policy.trim())))
  }

  function stopExperiment() {
    Object.values(controllersRef.current).forEach((controller) => controller?.abort())
  }

  function refreshSavedSnapshots() {
    setSavedSnapshots(listExperimentSnapshots())
  }

  async function refreshProjectCsvExports() {
    try {
      const exported = await listProjectCsvExports()
      setProjectCsvExports(exported.items)
      setProjectCsvError(null)
    } catch (err) {
      setProjectCsvError(err instanceof Error ? err.message : "프로젝트 CSV 목록을 불러오지 못했습니다.")
    }
  }

  function currentSnapshotInput() {
    const snapshotSlots = slots
      .filter((slot) => slot.policy.trim())
      .map((slot) => ({ id: slot.id, presetId: slot.presetId, policy: slot.policy }))
    const structuredPolicy = snapshotSlots
      .map((slot) => runs[slot.id]?.structuredPolicy)
      .find((item): item is StructuredPolicy => Boolean(item))
    return {
      name: snapshotName.trim() || `Experiment ${new Date().toLocaleString()}`,
      settings: {
        nAgents,
        repeatCount,
        modelProvider: DEFAULT_MODEL_PROVIDER,
        modelName: effectiveModelName,
        personaDepth,
      },
      slots: snapshotSlots,
      results: buildSnapshotResults(snapshotSlots, runs),
      structuredPolicy,
    }
  }

  function saveCurrentExperiment() {
    saveExperimentSnapshot(currentSnapshotInput())
    setSnapshotName("")
    refreshSavedSnapshots()
  }

  function loadSnapshot(snapshot: ExperimentSnapshot) {
    setSlots(snapshot.slots)
    setNAgents(snapshot.settings.nAgents)
    setRepeatCount((snapshot.settings.repeatCount === 3 || snapshot.settings.repeatCount === 5 ? snapshot.settings.repeatCount : 1) as 1 | 3 | 5)
    if (snapshot.settings.modelName) {
      setOpenAiModelName(snapshot.settings.modelName)
    }
    if (snapshot.settings.personaDepth) setPersonaDepth(snapshot.settings.personaDepth)
    setRuns(restoreSnapshotRuns(snapshot.results))
    setSelectedTraceSlot(snapshot.slots[0]?.id ?? null)
    const currentRun = currentRunFromSnapshot(snapshot)
    if (currentRun) {
      saveCurrentRun(currentRun)
    }
  }

  function deleteSnapshot(id: string) {
    deleteExperimentSnapshot(id)
    refreshSavedSnapshots()
  }

  function exportCurrentExperiment() {
    const snapshot = {
      ...currentSnapshotInput(),
      id: "current",
      createdAt: new Date().toISOString(),
    }
    downloadCsv(`${safeCsvFilename(snapshot.name)}.csv`, buildExperimentCsv(snapshot))
  }

  async function saveCurrentExperimentCsvToProject() {
    const snapshot = {
      ...currentSnapshotInput(),
      id: "current",
      createdAt: new Date().toISOString(),
    }
    const filename = `${safeCsvFilename(snapshot.name)}.csv`
    try {
      const saved = await saveProjectCsvExport(filename, buildExperimentCsv(snapshot), snapshot)
      setProjectCsvStatus(`저장됨: ${saved.path}`)
      setProjectCsvError(null)
      await refreshProjectCsvExports()
    } catch (err) {
      setProjectCsvStatus(null)
      setProjectCsvError(err instanceof Error ? err.message : "프로젝트 폴더에 CSV를 저장하지 못했습니다.")
    }
  }

  async function loadProjectCsv(filename: string) {
    try {
      const loaded = await loadProjectCsvExport(filename)
      if (!isExperimentSnapshot(loaded.snapshot)) {
        setProjectCsvStatus(null)
        setProjectCsvError(`${filename}에는 복원 가능한 실험 상태 정보가 없습니다.`)
        return
      }
      loadSnapshot(loaded.snapshot)
      setProjectCsvStatus(`불러옴: exports/${loaded.filename}`)
      setProjectCsvError(null)
    } catch (err) {
      setProjectCsvStatus(null)
      setProjectCsvError(err instanceof Error ? err.message : "프로젝트 CSV를 불러오지 못했습니다.")
    }
  }

  function openExperimentResult(slotId: PolicySlotId, run: ExperimentRunState) {
    const slot = slots.find((item) => item.id === slotId)
    if (!slot?.policy.trim() || !run.aggregate) return
    saveExperimentRunAsCurrentRun({
      policy: slot.policy.trim(),
      nAgents,
      modelName: effectiveModelName,
      modelProvider: DEFAULT_MODEL_PROVIDER,
      aggregate: run.aggregate,
      sampledAgents: run.sampledAgents,
      responses: run.responses,
      structuredPolicy: run.structuredPolicy,
    })
    onOpenResult()
  }

  return (
    <div className="experiment-layout">
      <ExperimentLevels />
      <section className="control-panel experiment-settings">
        <div className="settings-grid">
          <label className="field compact-field">
            <span>모델</span>
            <select
              disabled={isRunning}
              value={openAiModelName}
              onChange={(event) => setOpenAiModelName(event.target.value)}
            >
              <option value="gpt-5-mini">gpt-5-mini</option>
              <option value="gpt-5">gpt-5</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
            </select>
          </label>
          <label className="field compact-field">
            <span>페르소나</span>
            <select
              disabled={isRunning}
              value={personaDepth}
              onChange={(event) => setPersonaDepth(event.target.value as "minimal" | "standard" | "full")}
            >
              <option value="minimal">최소</option>
              <option value="standard">중간</option>
              <option value="full">풍부</option>
            </select>
          </label>
          <label className="field compact-field">
            <span>반복</span>
            <select
              disabled={isRunning}
              value={repeatCount}
              onChange={(event) => setRepeatCount(Number(event.target.value) as 1 | 3 | 5)}
            >
              <option value="1">1회</option>
              <option value="3">3회</option>
              <option value="5">5회</option>
            </select>
          </label>
          <label className="field compact-field">
            <span>에이전트 수</span>
            <input
              type="number"
              min={5}
              max={100}
              value={nAgents}
              disabled={isRunning}
              onChange={(event) => setNAgents(clamp(Number(event.target.value), 5, 100))}
            />
          </label>
        </div>
        <p className="settings-note">OpenAI는 백엔드의 OPENAI_API_KEY 환경 변수로만 실행됩니다. 현재 요청 모델: {effectiveModelName}</p>
      </section>

      <section className="control-panel policy-slots">
        <div className="section-head">
          <div>
            <h2>정책 슬롯</h2>
            <p>실제 집행형 정책안을 자유 텍스트로 입력합니다.</p>
          </div>
          <button type="button" className="secondary-button" disabled={slots.length >= 3 || isRunning} onClick={() => setSlots(addPolicySlot(slots))}>
            슬롯 추가
          </button>
        </div>

        <div className="slot-grid">
          {slots.map((slot) => (
            <article className="slot-card" key={slot.id}>
              <div className="slot-head">
                <strong>슬롯 {slot.id}</strong>
                <button
                  type="button"
                  className="icon-button"
                  disabled={slots.length <= 1 || isRunning}
                  title="슬롯 삭제"
                  onClick={() => setSlots(removePolicySlot(slots, slot.id))}
                >
                  ×
                </button>
              </div>
              <label className="field">
                <span>정책안</span>
                <textarea
                  value={slot.policy}
                  rows={9}
                  disabled={isRunning}
                  onChange={(event) => setSlots(updateSlotPolicy(slots, slot.id, event.target.value))}
                  placeholder="예: 청년 월세 한시 지원. 대상, 신청 방식, 제외 조건을 가능한 만큼 적어주세요."
                />
              </label>
            </article>
          ))}
        </div>

        <div className="run-row">
          <span className="experiment-count">{activeSlots.length}개 슬롯 실행 대상</span>
          <div className="button-group">
            <button type="button" disabled={isRunning || activeSlots.length === 0} onClick={runExperiment}>
              {isRunning ? "실험 실행 중" : "실험 실행"}
            </button>
            <button type="button" className="secondary-button danger" disabled={!isRunning} onClick={stopExperiment}>
              작동 중지
            </button>
          </div>
        </div>
      </section>

      <ExperimentResults
        slots={slots}
        runs={runs}
        nAgents={nAgents}
        modelName={effectiveModelName}
        modelProvider={DEFAULT_MODEL_PROVIDER}
        selectedTraceSlot={selectedTraceSlot}
        onSelectTraceSlot={setSelectedTraceSlot}
        onOpenResult={openExperimentResult}
      />

      <section className="control-panel experiment-archive">
        <div className="section-head">
          <div>
            <h2>저장 및 내보내기</h2>
            <p>현재 실험을 브라우저에 저장하거나 CSV로 내보냅니다.</p>
          </div>
        </div>
        <div className="archive-actions">
          <input
            value={snapshotName}
            onChange={(event) => setSnapshotName(event.target.value)}
            placeholder="저장 이름"
          />
          <button type="button" className="secondary-button" disabled={isRunning || activeSlots.length === 0} onClick={saveCurrentExperiment}>
            저장
          </button>
          <button type="button" className="secondary-button" disabled={isRunning || activeSlots.length === 0} onClick={exportCurrentExperiment}>
            CSV 다운로드
          </button>
          <button type="button" className="secondary-button" disabled={isRunning || activeSlots.length === 0} onClick={saveCurrentExperimentCsvToProject}>
            프로젝트 폴더에 CSV 저장
          </button>
        </div>
        {(projectCsvStatus || projectCsvError) && (
          <p className={projectCsvError ? "error-box compact" : "settings-note"}>{projectCsvError ?? projectCsvStatus}</p>
        )}
        <div className="saved-snapshot-list">
          <div className="section-head compact-head">
            <div>
              <h3>프로젝트 CSV</h3>
              <p>저장 위치: exports/*.csv</p>
            </div>
            <button type="button" className="secondary-button" disabled={isRunning} onClick={refreshProjectCsvExports}>
              새로고침
            </button>
          </div>
          {projectCsvExports.length === 0 && <p className="empty compact">프로젝트 폴더에 저장된 CSV가 없습니다.</p>}
          {projectCsvExports.map((item) => (
            <article key={item.filename} className="saved-snapshot-item">
              <div>
                <strong>{item.filename}</strong>
                <span>
                  {item.path} · {item.bytes.toLocaleString()} bytes{item.has_snapshot ? "" : " · 상태 정보 없음"}
                </span>
              </div>
              <div>
                <button type="button" className="secondary-button" disabled={isRunning || !item.has_snapshot} onClick={() => loadProjectCsv(item.filename)}>
                  불러오기
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="saved-snapshot-list">
          {savedSnapshots.length === 0 && <p className="empty compact">저장된 실험이 없습니다.</p>}
          {savedSnapshots.map((snapshot) => (
            <article key={snapshot.id} className="saved-snapshot-item">
              <div>
                <strong>{snapshot.name}</strong>
                <span>
                  {new Date(snapshot.createdAt).toLocaleString()} · 슬롯 {snapshot.slots.length}개
                </span>
              </div>
              <div>
                <button type="button" className="secondary-button" disabled={isRunning} onClick={() => loadSnapshot(snapshot)}>
                  불러오기
                </button>
                <button type="button" className="secondary-button danger" disabled={isRunning} onClick={() => deleteSnapshot(snapshot.id)}>
                  삭제
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function ExperimentResults({
  slots,
  runs,
  nAgents,
  modelName,
  modelProvider,
  selectedTraceSlot,
  onSelectTraceSlot,
  onOpenResult,
}: {
  slots: ReturnType<typeof createInitialSlots>
  runs: Partial<Record<PolicySlotId, ExperimentRunState>>
  nAgents: number
  modelName: string
  modelProvider: "openai"
  selectedTraceSlot: PolicySlotId | null
  onSelectTraceSlot: (slotId: PolicySlotId) => void
  onOpenResult: (slotId: PolicySlotId, run: ExperimentRunState) => void
}) {
  const visibleSlots = slots.filter((slot) => runs[slot.id] || slot.policy.trim())
  const visibleSlotIds = visibleSlots.map((slot) => slot.id)
  const activeTraceSlot = resolveVisibleSlotId(visibleSlotIds, selectedTraceSlot)
  const activeRun = activeTraceSlot ? runs[activeTraceSlot] : null

  return (
    <section className="panel result-panel">
      <h2>결과 비교</h2>
      {visibleSlots.length === 0 ? (
        <p className="empty">실험 실행 후 슬롯별 결과가 표시됩니다.</p>
      ) : (
        <div className="comparison-table-wrap">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>지표</th>
                {visibleSlots.map((slot) => (
                  <th key={slot.id}>슬롯 {slot.id}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>상태</td>
                {visibleSlots.map((slot) => {
                  const run = runs[slot.id]
                  const progress = run ? Math.round((run.responses.length / nAgents) * 100) : 0
                  const runLabel = run && run.aggregateRuns.length > 0 ? ` · ${run.aggregateRuns.length}회 완료` : ""
                  return <td key={slot.id}>{run ? `${phaseLabel(run.phase, progress)}${runLabel}` : "대기"}</td>
                })}
              </tr>
              {(["support", "oppose", "neutral"] as Stance[]).map((stance) => (
                <tr key={stance}>
                  <td>{STANCE_LABELS[stance]}</td>
                  {visibleSlots.map((slot) => {
                    const counts = safeCounts(runs[slot.id]?.aggregate?.total)
                    const total = counts.support + counts.oppose + counts.neutral
                    return (
                      <td key={slot.id}>
                        {counts[stance]}명 {total ? `(${Math.round((counts[stance] / total) * 100)}%)` : ""}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr>
                <td>응답 수</td>
                {visibleSlots.map((slot) => (
                  <td key={slot.id}>{runs[slot.id]?.responses.length ?? 0}명</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <div className="experiment-result-grid">
        {visibleSlots.map((slot) => {
          const run = runs[slot.id]
          return (
            <article className="slot-result" key={slot.id}>
              <h3>슬롯 {slot.id}</h3>
              {run?.error && <div className="error-box">{run.error}</div>}
              {!run?.aggregate && <p className="empty">집계 대기 중입니다.</p>}
              {run && <StabilityResult aggregates={run.aggregateRuns} />}
            </article>
          )
        })}
      </div>
      {activeTraceSlot && activeRun && (
        <section className="slot-trace">
          <div className="slot-trace-tabs">
            {visibleSlots.map((slot) => (
              <button
                type="button"
                key={slot.id}
                className={slot.id === activeTraceSlot ? "active" : ""}
                onClick={() => onSelectTraceSlot(slot.id)}
              >
                슬롯 {slot.id} 상세
              </button>
            ))}
          </div>
          <ExperimentTrace
            run={activeRun}
            nAgents={nAgents}
            modelName={modelName}
            modelProvider={modelProvider}
            onOpenResult={() => onOpenResult(activeTraceSlot, activeRun)}
          />
        </section>
      )}
    </section>
  )
}

export function ResponseCard({
  response,
  sampledAgent,
}: {
  response: AgentRespondedEvent
  sampledAgent?: AgentSampledEvent
}) {
  return (
    <article className={`response-item ${response.stance}`}>
      <div className="response-head">
        <strong>{STANCE_LABELS[response.stance]}</strong>
        <span>
          {sampledAgent ? `${sampledAgent.age}세` : AGE_LABELS[response.age_group]} · {GENDER_LABELS[response.gender]} ·{" "}
          {REGION_LABELS[response.region_group]}
          {sampledAgent?.job ? ` · ${sampledAgent.job}` : ""}
        </span>
      </div>
      {(response.stance_strength || response.caveat) && (
        <div className="response-meta">
          {response.stance_strength && <span>강도 {response.stance_strength}</span>}
          {response.caveat && <span>조건/유의점 {response.caveat}</span>}
        </div>
      )}
      <p>{response.rationale}</p>
      {(response.blind_spot || response.affected_group) && (
        <div className="response-insights">
          {response.blind_spot && (
            <p>
              <strong>사각지대</strong>
              <span>{response.blind_spot}</span>
            </p>
          )}
          {response.affected_group && (
            <p>
              <strong>타격 집단</strong>
              <span>{response.affected_group}</span>
            </p>
          )}
        </div>
      )}
      {response.persona_link && (
        <details className="persona-link">
          <summary>맥락 추적</summary>
          {response.persona_link.direct && (
            <p>
              <strong>직접 근거</strong>
              <span>{response.persona_link.direct}</span>
            </p>
          )}
          {response.persona_link.inferred && (
            <p>
              <strong>추론</strong>
              <span>{response.persona_link.inferred}</span>
            </p>
          )}
        </details>
      )}
    </article>
  )
}

function ExperimentTrace({
  run,
  nAgents,
  modelName,
  modelProvider,
  onOpenResult,
}: {
  run: ExperimentRunState
  nAgents: number
  modelName: string
  modelProvider: "openai"
  onOpenResult: () => void
}) {
  const progress = Math.round((run.responses.length / nAgents) * 100)
  const sampledById = new Map(run.sampledAgents.map((agent) => [agent.agent_id, agent]))
  const llmAgentIds = Array.from(
    new Set([
      ...run.llmPrompts.map((prompt) => prompt.agent_id),
      ...Object.keys(run.llmOutputs).map(Number),
      ...Object.keys(run.llmStatuses).map(Number),
      ...Object.keys(run.llmHeartbeats).map(Number),
      ...Object.keys(run.llmErrors).map(Number),
    ]),
  ).sort((a, b) => a - b)

  return (
    <div className="slot-trace-content">
      <section className="progress-panel trace-progress">
        <div className="progress-meta">
          <span>
            {run.sampledAgents.length}명 샘플링 · {run.llmPrompts.length}건 입력 생성 · {run.responses.length}명 응답 완료
            {run.aggregateRuns.length > 1 ? ` · ${run.currentRunIndex + 1}번째 실행` : ""}
          </span>
          <span>
            {modelProvider} · {modelName} · {phaseLabel(run.phase, progress)}
          </span>
          <button type="button" className="secondary-button" disabled={!run.aggregate || run.phase === "running"} onClick={onOpenResult}>
            결과 보기 -&gt;
          </button>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className="content-grid trace-grid">
        <section className="panel result-panel">
          <h2>샘플링 계획</h2>
          {run.samplingPlan ? <SamplingPlanView plan={run.samplingPlan} /> : <p className="empty">샘플링 계획 대기 중입니다.</p>}
        </section>

        <section className="panel">
          <h2>샘플링된 인원</h2>
          <div className="sample-list">
            {run.sampledAgents.length === 0 && <p className="empty">아직 샘플링된 인원이 없습니다.</p>}
            {run.sampledAgents.map((agent) => (
              <article key={agent.agent_id} className="sample-item">
                <div>
                  <strong>#{agent.agent_id}</strong>
                  <span>
                    {agent.age}세 · {GENDER_LABELS[agent.gender]} · {REGION_LABELS[agent.region_group]}
                  </span>
                </div>
                <p>
                  {agent.region} · {agent.job}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>실시간 응답</h2>
          <div className="live-list">
            {run.responses.length === 0 && <p className="empty">아직 응답이 없습니다.</p>}
            {run.responses.slice().reverse().map((response) => (
              <ResponseCard key={response.agent_id} response={response} sampledAgent={sampledById.get(response.agent_id)} />
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>LLM 입력 로그</h2>
          <div className="prompt-list">
            {run.llmPrompts.length === 0 && <p className="empty">아직 모델 입력이 생성되지 않았습니다.</p>}
            {run.llmPrompts.map((prompt) => (
              <details key={prompt.agent_id} className="prompt-item">
                <summary>
                  #{prompt.agent_id} · {prompt.model} · {prompt.messages.length} messages
                </summary>
                <pre>{JSON.stringify(prompt, null, 2)}</pre>
              </details>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>LLM 실시간 출력</h2>
          <div className="token-list">
            {llmAgentIds.length === 0 && <p className="empty">아직 모델 출력이 없습니다.</p>}
            {llmAgentIds.map((agentId) => {
              const status = run.llmStatuses[agentId] ?? "started"
              return (
                <article key={agentId} className="token-item">
                  <div>
                    <span>#{agentId}</span>
                    <span className={`llm-state ${status}`}>{llmStatusLabel(status)}</span>
                    {run.llmHeartbeats[agentId] && <span className="llm-heartbeat">{llmHeartbeatLabel(run.llmHeartbeats[agentId])}</span>}
                  </div>
                  {run.llmErrors[agentId] && <p className="llm-error">{run.llmErrors[agentId].message}</p>}
                  <pre>{run.llmOutputs[agentId] || "LLM 출력 대기 중..."}</pre>
                </article>
              )
            })}
          </div>
        </section>

        <section className="panel result-panel">
          <h2>전체 결과</h2>
          <SummaryTrace
            prompt={run.summaryPrompt}
            status={run.summaryStatus}
            output={run.summaryOutput}
            heartbeat={run.summaryHeartbeat}
            error={run.summaryError}
            activityAt={null}
            now={Date.now()}
          />
          {run.aggregate ? <AggregateView aggregate={run.aggregate} /> : <p className="empty">집계 대기 중입니다.</p>}
        </section>
      </section>
    </div>
  )
}

function StabilityResult({ aggregates }: { aggregates: AggregateEvent[] }) {
  if (aggregates.length <= 1) return null
  const report = computeStabilityReport(aggregates)
  return (
    <div className="stability-card">
      <h3>반복 실행 안정성</h3>
      <table>
        <thead>
          <tr>
            <th>구분</th>
            <th>평균</th>
            <th>표준편차</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>찬성</td>
            <td>{report.support.mean.toFixed(1)}%</td>
            <td>{report.support.stddev.toFixed(1)}%</td>
          </tr>
          <tr>
            <td>반대</td>
            <td>{report.oppose.mean.toFixed(1)}%</td>
            <td>{report.oppose.stddev.toFixed(1)}%</td>
          </tr>
          <tr>
            <td>중립</td>
            <td>{report.neutral.mean.toFixed(1)}%</td>
            <td>{report.neutral.stddev.toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function safeCsvFilename(value: string) {
  return value.trim().replace(/[^\w가-힣]+/g, "_") || "experiment"
}

function isExperimentSnapshot(value: unknown): value is ExperimentSnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<ExperimentSnapshot>
  return (
    typeof snapshot.id === "string" &&
    typeof snapshot.createdAt === "string" &&
    typeof snapshot.name === "string" &&
    !!snapshot.settings &&
    Array.isArray(snapshot.slots) &&
    Array.isArray(snapshot.results)
  )
}

export function currentRunFromSnapshot(snapshot: ExperimentSnapshot): CurrentRun | null {
  const result = snapshot.results.find((item) => item.aggregate)
  if (!result?.aggregate) return null
  const slot = snapshot.slots.find((item) => item.id === result.slotId)
  if (!slot?.policy.trim()) return null

  return {
    policy: slot.policy.trim(),
    n_agents: snapshot.settings.nAgents,
    model_name: snapshot.settings.modelName ?? DEFAULT_MODEL_NAME,
    model_provider: snapshot.settings.modelProvider === "openai" ? "openai" : DEFAULT_MODEL_PROVIDER,
    aggregate: result.aggregate,
    sampledAgents: result.sampledAgents ?? [],
    responses: result.responses ?? [],
    structuredPolicy: snapshot.structuredPolicy,
    completedAt: snapshot.createdAt,
  }
}

function emptyExperimentRun(): ExperimentRunState {
  return {
    phase: "idle",
    sampled: 0,
    samplingPlan: null,
    sampledAgents: [],
    llmPrompts: [],
    llmOutputs: {},
    llmStatuses: {},
    llmHeartbeats: {},
    llmErrors: {},
    responses: [],
    structuredPolicy: undefined,
    summaryPrompt: null,
    summaryStatus: null,
    summaryOutput: "",
    summaryHeartbeat: null,
    summaryError: null,
    aggregate: null,
    aggregateRuns: [],
    currentRunIndex: 0,
    error: null,
  }
}

function pageFromLocation(): Page {
  const page = pageFromPathname(window.location.pathname)
  if (window.location.pathname === "/experiment") {
    window.history.replaceState(null, "", "/")
  }
  return page
}

export function pageFromPathname(pathname: string): Page {
  if (pathname === "/result") return "result"
  return "main"
}

function AggregateView({ aggregate }: { aggregate: AggregateEvent }) {
  const total = safeCounts(aggregate.total)
  const totalN = total.support + total.oppose + total.neutral

  return (
    <div className="aggregate">
      <div className="stance-summary">
        {(Object.keys(STANCE_LABELS) as Stance[]).map((stance) => (
          <div key={stance} className={`summary-box ${stance}`}>
            <span>{STANCE_LABELS[stance]}</span>
            <strong>{total[stance]}</strong>
            <small>{totalN ? Math.round((total[stance] / totalN) * 100) : 0}%</small>
          </div>
        ))}
      </div>
      <Breakdown title="연령대별" data={safeBreakdown(aggregate.by_age)} labelMap={AGE_LABELS} />
      <Breakdown title="성별" data={safeBreakdown(aggregate.by_gender)} labelMap={GENDER_LABELS} />
      <Breakdown title="지역별" data={safeBreakdown(aggregate.by_region)} labelMap={REGION_LABELS} />
      <ClusterList title="주요 우려사항" clusters={safeClusters(aggregate.concern_clusters)} />
      <ClusterList title="주요 지지 이유" clusters={safeClusters(aggregate.support_clusters)} />
      <BlindSpotMap clusters={safeBlindSpotClusters(aggregate.blind_spot_clusters)} />
      <ReframingList items={safeReframingList(aggregate.reframing_list)} />
    </div>
  )
}

function SamplingPlanView({ plan }: { plan: SamplingPlanEvent }) {
  const visibleCells = plan.cells.filter((cell) => (cell.quota ?? 0) > 0 || cell.sampled > 0)
  const isRandom = plan.mode === "uniform_random"
  return (
    <div className="sampling-plan">
      <div className="plan-meta">
        <span>{isRandom ? "균등 랜덤" : "층화 샘플링"}</span>
        <span>요청 인원 {plan.n_agents}명</span>
        <span>모집단 {plan.total_records.toLocaleString()}명</span>
        <span>축 {plan.axes.join(" / ")}</span>
      </div>
      <div className="plan-table-wrap">
        <table>
          <thead>
            <tr>
              <th>연령</th>
              <th>지역</th>
              <th>성별</th>
              <th>분포</th>
              <th>Quota</th>
              <th>실제</th>
              <th>부족</th>
            </tr>
          </thead>
          <tbody>
            {visibleCells.map((cell) => (
              <tr key={`${cell.age_group}-${cell.region_group}-${cell.gender}`}>
                <td>{AGE_LABELS[cell.age_group]}</td>
                <td>{REGION_LABELS[cell.region_group]}</td>
                <td>{GENDER_LABELS[cell.gender]}</td>
                <td>{(cell.proportion * 100).toFixed(2)}%</td>
                <td>{cell.quota ?? "-"}</td>
                <td>{cell.sampled}</td>
                <td>{cell.shortfall ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SummaryTrace({
  prompt,
  status,
  output,
  heartbeat,
  error,
  activityAt,
  now,
}: {
  prompt: SummaryPromptEvent | null
  status: SummaryStatusEvent | null
  output: string
  heartbeat: SummaryHeartbeatEvent | null
  error: SummaryErrorEvent | null
  activityAt: number | null
  now: number
}) {
  return (
    <div className="summary-trace">
      <div>
        <strong>취합 요약 상태</strong>
        <span className={`summary-state ${status?.status ?? "waiting"}`}>{summaryStatusLabel(status?.status)}</span>
      </div>
      <p>{status?.message ?? "개별 응답이 끝나면 취합 요약을 요청합니다."}</p>
      <article className="token-item summary-output">
        <div>
          <span>취합 요약 LLM</span>
          <span className={summaryActivityClass(status?.status, activityAt, now)}>{summaryActivityLabel(status?.status, activityAt, now)}</span>
          {heartbeat && <span className="llm-heartbeat">{summaryHeartbeatLabel(heartbeat)}</span>}
        </div>
        {error && <p className="llm-error">{error.message}</p>}
        <pre>{output || status?.raw_output || "요약 모델 출력 대기 중..."}</pre>
      </article>
      {status?.raw_output && output && status.raw_output !== output && (
        <details className="prompt-item">
          <summary>요약 최종 파싱 대상</summary>
          <pre>{status.raw_output}</pre>
        </details>
      )}
      {prompt && (
        <details className="prompt-item">
          <summary>요약 모델 입력</summary>
          <pre>{JSON.stringify(prompt, null, 2)}</pre>
        </details>
      )}
    </div>
  )
}

function Breakdown({ title, data, labelMap }: { title: string; data: Record<string, StanceCounts>; labelMap: Record<string, string> }) {
  return (
    <div className="table-block">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>구분</th>
            <th>찬성</th>
            <th>반대</th>
            <th>중립</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data).map(([group, counts]) => (
            <tr key={group}>
              <td>{labelMap[group] ?? group}</td>
              <td>{counts.support}</td>
              <td>{counts.oppose}</td>
              <td>{counts.neutral}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ClusterList({ title, clusters }: { title: string; clusters: { label: string; count: number; examples: string[] }[] }) {
  return (
    <div className="cluster-block">
      <h3>{title}</h3>
      {clusters.length === 0 ? (
        <p className="empty compact">요약 없음</p>
      ) : (
        clusters.map((cluster, index) => (
          <article key={`${cluster.label}-${index}`} className="cluster-item">
            <div>
              <strong>{cluster.label}</strong>
              <span>{cluster.count}명</span>
            </div>
            <p>{cluster.examples.join(" · ")}</p>
          </article>
        ))
      )}
    </div>
  )
}

function BlindSpotMap({ clusters }: { clusters: { affected_group: string; count: number; blind_spot_examples: string[] }[] }) {
  if (clusters.length === 0) return null
  return (
    <div className="blind-spot-map">
      <h3>정책 사각지대</h3>
      <p>예상치 못한 피해 집단</p>
      <div className="blind-spot-list">
        {clusters.map((cluster, index) => (
          <article key={`${cluster.affected_group}-${index}`} className="blind-spot-item">
            <div>
              <strong>
                {index + 1}. {cluster.affected_group}
              </strong>
              <span>{cluster.count}명</span>
            </div>
            {cluster.blind_spot_examples.map((example, exampleIndex) => (
              <p key={`${cluster.affected_group}-${exampleIndex}`}>"{example}"</p>
            ))}
          </article>
        ))}
      </div>
    </div>
  )
}

function ReframingList({ items }: { items: { text: string; age_group: string; gender: string; region_group: string }[] }) {
  if (items.length === 0) return null
  return (
    <div className="reframing-list">
      <h3>정책 전제에 대한 반문 (L3)</h3>
      {items.map((item, index) => (
        <article key={`${item.text}-${index}`} className="reframing-item">
          <p>"{item.text}"</p>
          <span>
            {(AGE_LABELS[item.age_group as AgeGroup] ?? item.age_group) || "연령 미상"} ·{" "}
            {(GENDER_LABELS[item.gender as Gender] ?? item.gender) || "성별 미상"} ·{" "}
            {(REGION_LABELS[item.region_group as RegionGroup] ?? item.region_group) || "지역 미상"}
          </span>
        </article>
      ))}
    </div>
  )
}

function safeCounts(value: unknown): StanceCounts {
  if (!value || typeof value !== "object") return EMPTY_COUNTS
  const counts = value as Partial<Record<Stance, unknown>>
  return {
    support: Number(counts.support) || 0,
    oppose: Number(counts.oppose) || 0,
    neutral: Number(counts.neutral) || 0,
  }
}

function safeBreakdown(value: unknown): Record<string, StanceCounts> {
  if (!value || typeof value !== "object") return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, counts]) => [key, safeCounts(counts)]),
  )
}

function safeClusters(value: unknown): { label: string; count: number; examples: string[] }[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((cluster) => cluster && typeof cluster === "object")
    .map((cluster) => {
      const item = cluster as { label?: unknown; count?: unknown; examples?: unknown }
      return {
        label: typeof item.label === "string" && item.label.trim() ? item.label : "기타",
        count: Number(item.count) || 0,
        examples: Array.isArray(item.examples) ? item.examples.map(String) : [],
      }
    })
}

function getActiveLevels(): number[] {
  return [1, 2, 3]
}

function safeBlindSpotClusters(value: unknown): { affected_group: string; count: number; blind_spot_examples: string[] }[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((cluster) => cluster && typeof cluster === "object")
    .map((cluster) => {
      const item = cluster as { affected_group?: unknown; count?: unknown; blind_spot_examples?: unknown }
      return {
        affected_group: typeof item.affected_group === "string" && item.affected_group.trim() ? item.affected_group : "기타",
        count: Number(item.count) || 0,
        blind_spot_examples: Array.isArray(item.blind_spot_examples) ? item.blind_spot_examples.map(String) : [],
      }
    })
}

function safeReframingList(value: unknown): { text: string; age_group: string; gender: string; region_group: string }[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === "object")
    .flatMap((value) => {
      const reframing = value as { text?: unknown; age_group?: unknown; gender?: unknown; region_group?: unknown }
      if (typeof reframing.text !== "string" || !reframing.text.trim()) return []
      return [
        {
          text: reframing.text.trim(),
          age_group: typeof reframing.age_group === "string" ? reframing.age_group : "",
          gender: typeof reframing.gender === "string" ? reframing.gender : "",
          region_group: typeof reframing.region_group === "string" ? reframing.region_group : "",
        },
      ]
    })
}

function phaseLabel(phase: Phase, progress: number) {
  if (phase === "running") return `실행 중 ${progress}%`
  if (phase === "done") return "완료"
  if (phase === "error") return "오류"
  if (phase === "stopped") return "중지됨"
  return "대기"
}

function summaryStatusLabel(status: SummaryStatusEvent["status"] | undefined) {
  if (status === "started") return "생성 중"
  if (status === "completed") return "완료"
  if (status === "empty") return "빈 결과"
  if (status === "failed") return "실패"
  return "대기"
}

function summaryActivityLabel(status: SummaryStatusEvent["status"] | undefined, lastActivityAt: number | null, now: number) {
  if (!lastActivityAt) return "아직 출력 없음"
  const elapsedSeconds = Math.max(0, Math.floor((now - lastActivityAt) / 1000))
  if (status === "completed") return `${elapsedSeconds}초 전 완료`
  if (status === "failed") return `${elapsedSeconds}초 전 실패`
  if (status === "empty") return `${elapsedSeconds}초 전 빈 결과`
  if (elapsedSeconds >= 20) return `${elapsedSeconds}초째 새 출력 없음`
  return `${elapsedSeconds}초 전 출력`
}

function summaryActivityClass(status: SummaryStatusEvent["status"] | undefined, lastActivityAt: number | null, now: number) {
  if (status !== "started" || !lastActivityAt) return "llm-activity"
  const elapsedSeconds = Math.max(0, Math.floor((now - lastActivityAt) / 1000))
  return elapsedSeconds >= 20 ? "llm-activity stale" : "llm-activity"
}

function summaryHeartbeatLabel(heartbeat: SummaryHeartbeatEvent) {
  if (heartbeat.tokens_seen === 0) {
    return `요약 첫 출력 대기 ${heartbeat.elapsed_seconds}초`
  }
  return `요약 처리 중 ${heartbeat.elapsed_seconds}초, 토큰 ${heartbeat.tokens_seen}개`
}

function clamp(value: number, min: number, max: number) {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}

function llmStatusLabel(status: LlmStatusEvent["status"]) {
  if (status === "completed") return "완료"
  if (status === "failed") return "실패"
  return "생성 중"
}

function llmActivityLabel(status: LlmStatusEvent["status"], lastActivityAt: number | undefined, now: number) {
  if (!lastActivityAt) return "아직 출력 없음"
  const elapsedSeconds = Math.max(0, Math.floor((now - lastActivityAt) / 1000))
  if (status === "completed") return `${elapsedSeconds}초 전 완료`
  if (status === "failed") return `${elapsedSeconds}초 전 실패`
  if (elapsedSeconds >= 20) return `${elapsedSeconds}초째 새 출력 없음`
  return `${elapsedSeconds}초 전 출력`
}

function llmActivityClass(status: LlmStatusEvent["status"], lastActivityAt: number | undefined, now: number) {
  if (status !== "started" || !lastActivityAt) return "llm-activity"
  const elapsedSeconds = Math.max(0, Math.floor((now - lastActivityAt) / 1000))
  return elapsedSeconds >= 20 ? "llm-activity stale" : "llm-activity"
}

function llmHeartbeatLabel(heartbeat: LlmHeartbeatEvent) {
  if (heartbeat.tokens_seen === 0) {
    return `첫 출력 대기 ${heartbeat.elapsed_seconds}초`
  }
  return `처리 중 ${heartbeat.elapsed_seconds}초, 토큰 ${heartbeat.tokens_seen}개`
}

function appendLlmToken(
  token: LlmTokenEvent,
  setOutputs: React.Dispatch<React.SetStateAction<Record<number, string>>>,
) {
  setOutputs((prev) => ({
    ...prev,
    [token.agent_id]: `${prev[token.agent_id] ?? ""}${token.content}`,
  }))
}

function appendSummaryToken(
  token: SummaryTokenEvent,
  setOutput: React.Dispatch<React.SetStateAction<string>>,
) {
  setOutput((prev) => `${prev}${token.content}`)
}
