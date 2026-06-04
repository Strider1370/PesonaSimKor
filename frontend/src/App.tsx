import { useEffect, useMemo, useState } from "react"
import { useRef } from "react"
import {
  AgentSampledEvent,
  AgentRespondedEvent,
  AgeGroup,
  DiscoveryAggregate,
  DiscoverySummary,
  DiscoverySummaryPromptEvent,
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
  PersonaDepth,
  StructuredPolicyWithPromptFields,
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
import { CurrentRun, getCurrentRunSnapshot, saveCurrentRun, saveExperimentRunAsCurrentRun, useCurrentRunStore } from "./lib/currentRunStore"
import { ResultPage } from "./result/ResultPage"
import { axisLabel, categoryLabel } from "./result/labels"

type Phase = "idle" | "running" | "done" | "error" | "stopped"
type Page = "home" | "input" | "result"

const FULL_AGENT_LIMIT = 20

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
const DEFAULT_MODEL_NAME = "gpt-5.4-mini"

export default function App() {
  const [page, setPage] = useState<Page>(() => pageFromLocation())
  const [darkMode, setDarkMode] = useState(false)
  const [experimentKey, setExperimentKey] = useState(0)
  const [pendingSnapshot, setPendingSnapshot] = useState<ExperimentSnapshot | null>(null)
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
  const [structuredPolicy, setStructuredPolicy] = useState<StructuredPolicyWithPromptFields | undefined>(undefined)
  const [discoveryAggregate, setDiscoveryAggregate] = useState<DiscoveryAggregate | null>(null)
  const [discoverySummary, setDiscoverySummary] = useState<DiscoverySummary | null>(null)
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
    if (page !== "input" || !draftRequest) return
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
    let structuredPolicyForRun: StructuredPolicyWithPromptFields | undefined

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
    setDiscoveryAggregate(null)
    setDiscoverySummary(null)
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
        } else if (event.type === "discovery_aggregate") {
          setDiscoveryAggregate(event.data)
          saveCurrentRun({
            policy: trimmed,
            n_agents: requestedAgents,
            model_name: modelName,
            model_provider: modelProvider,
            discoveryAggregate: event.data,
            sampledAgents: sampledForRun.slice(),
            responses: responsesForRun.slice(),
            structuredPolicy: structuredPolicyForRun,
            persona_depth: "standard",
            completedAt: new Date().toISOString(),
          })
          useCurrentRunStore.getState().setDraftRequest({
            policy: trimmed,
            n_agents: requestedAgents,
            model_name: modelName,
            persona_depth: "standard",
          })
        } else if (event.type === "discovery_summary") {
          setDiscoverySummary(event.data)
          const current = getCurrentRunSnapshot()
          if (current?.policy === trimmed) {
            saveCurrentRun({ ...current, discoverySummary: event.data })
          }
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
    setDiscoveryAggregate(null)
    setDiscoverySummary(null)
    setError(null)
  }

  function navigatePage(nextPage: Page, dark = false) {
    const nextPath = nextPage === "result" ? "/result" : nextPage === "input" ? "/input" : "/"
    window.history.pushState(null, "", nextPath)
    setDarkMode(dark)
    setPage(nextPage)
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        {page === "input" && (
          <Topbar
            page={page}
            health={health}
            healthError={healthError}
            onOpenHome={() => navigatePage("home")}
            onOpenInput={() => navigatePage("input")}
          />
        )}

        <section data-page="home" hidden={page !== "home"}>
          <CsvHomePage
            onOpenResult={(snapshot) => { setPendingSnapshot(snapshot); navigatePage("result", false) }}
            onOpenResultDark={() => navigatePage("result", true)}
            onOpenInput={() => navigatePage("input")}
            onOpenFreshInput={() => { setExperimentKey(k => k + 1); navigatePage("input") }}
          />
        </section>
        <section data-page="input" hidden={page !== "input"}>
          <ExperimentPage
            key={experimentKey}
            onOpenResult={() => navigatePage("result", false)}
            onOpenResultDark={() => navigatePage("result", true)}
            pendingSnapshot={pendingSnapshot}
            onSnapshotConsumed={() => setPendingSnapshot(null)}
          />
        </section>
        <section data-page="result" hidden={page !== "result"}>
          {page === "result" && (
            <ResultPage
              onDebug={() => navigatePage("input")}
              onOpenMain={() => navigatePage("input")}
              darkMode={darkMode}
            />
          )}
        </section>
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
  structuredPolicy?: StructuredPolicyWithPromptFields
  discoveryAggregate: DiscoveryAggregate | null
  discoveryAggregateRuns: DiscoveryAggregate[]
  discoverySummary: DiscoverySummary | null
  discoverySummaryPrompt?: DiscoverySummaryPromptEvent | null
  summaryStatus?: "started" | "completed" | "failed" | null
  currentRunIndex: number
  error: string | null
}

export function Topbar({
  page,
  health,
  healthError,
  onOpenHome,
  onOpenInput,
}: {
  page: Page
  health: HealthStatus | null
  healthError: string | null
  onOpenHome: () => void
  onOpenInput: () => void
}) {
  return (
    <header className="topbar">
      <div>
        <h1>AI 가상 국민을 활용한 정책 설계 검증 플랫폼</h1>
      </div>
      <div className="topbar-status">
        {page === "home" ? (
          <button type="button" className="secondary-button topbar-result-button" onClick={onOpenInput}>
            입력
          </button>
        ) : (
          <button type="button" className="secondary-button topbar-result-button" onClick={onOpenHome}>
            홈
          </button>
        )}
      </div>
    </header>
  )
}

function CsvHomePage({
  onOpenResult,
  onOpenInput,
  onOpenFreshInput,
}: {
  onOpenResult: (snapshot: ExperimentSnapshot) => void
  onOpenResultDark: () => void
  onOpenInput: () => void
  onOpenFreshInput: () => void
}) {
  const [exports, setExports] = useState<ProjectCsvExport[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState<string | null>(null)

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    try {
      const result = await listProjectCsvExports()
      setExports(result.items)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV 목록을 불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }

  async function openCsv(filename: string) {
    setLoadingFile(filename)
    setError(null)
    try {
      const loaded = await loadProjectCsvExport(filename)
      if (!isExperimentSnapshot(loaded.snapshot)) {
        setError(`${filename}에는 복원 가능한 실험 정보가 없습니다.`)
        return
      }
      const currentRun = currentRunFromSnapshot(loaded.snapshot)
      if (!currentRun) {
        setError(`${filename}에서 결과를 불러오지 못했습니다.`)
        return
      }
      saveCurrentRun(currentRun)
      onOpenResult(loaded.snapshot as ExperimentSnapshot)
    } catch (err) {
      setError(err instanceof Error ? err.message : "CSV를 불러오지 못했습니다.")
    } finally {
      setLoadingFile(null)
    }
  }

  return (
    <div className="csv-home">
      <div className="csv-home-hero">
        <h1>AI 가상 국민을 활용한<br />정책 설계 검증 플랫폼</h1>
      </div>

      <div className="csv-home-list-section">
        <div className="csv-home-list-header">
          <h2>시뮬레이션 결과 목록</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="secondary-button" onClick={refresh} disabled={loading}>
              목록 갱신
            </button>
            <button type="button" className="primary-button" onClick={onOpenFreshInput}>
              + 새 시뮬레이션
            </button>
          </div>
        </div>
        {error && <p className="error-box">{error}</p>}
        {!loading && exports.length === 0 && (
          <p className="csv-home-empty-msg">저장된 결과가 없습니다.</p>
        )}
        <div className="csv-list">
          {exports.map((item) => (
            <button
              key={item.filename}
              type="button"
              className="csv-item-btn"
              disabled={!item.has_snapshot || loadingFile === item.filename}
              onClick={() => openCsv(item.filename)}
            >
              {loadingFile === item.filename ? "불러오는 중…" : item.filename.replace(/\.csv$/i, "")}
            </button>
          ))}
        </div>
      </div>

      <p className="csv-home-footer-note">
        시뮬레이션 실행 과정 및 실시간 LLM 응답 로그는 입력 페이지에서 확인하실 수 있습니다.
      </p>
    </div>
  )
}

function ExperimentPage({ onOpenResult, onOpenResultDark, pendingSnapshot, onSnapshotConsumed }: {
  onOpenResult: () => void
  onOpenResultDark: () => void
  pendingSnapshot?: ExperimentSnapshot | null
  onSnapshotConsumed?: () => void
}) {
  const [slots, setSlots] = useState(createInitialSlots)
  const [nAgents, setNAgents] = useState(30)
  const [repeatCount, setRepeatCount] = useState<1 | 3 | 5>(1)
  const [openAiModelName, setOpenAiModelName] = useState(DEFAULT_MODEL_NAME)
  const [controlModel, setControlModel] = useState("gpt-5.5")
  const [personaDepth, setPersonaDepth] = useState<PersonaDepth>("standard")
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
  const fullModeBlocked = personaDepth === "full" && nAgents > FULL_AGENT_LIMIT
  const agentMax = personaDepth === "full" ? FULL_AGENT_LIMIT : 100

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
    setRun(slotId, () => ({ ...emptyExperimentRun(), phase: "running", discoveryAggregateRuns: [], currentRunIndex: 0 }))

    try {
      for (let runIndex = 0; runIndex < repeatCount; runIndex += 1) {
        setRun(slotId, (prev) => ({
          ...emptyExperimentRun(),
          discoveryAggregateRuns: prev.discoveryAggregateRuns,
          currentRunIndex: runIndex,
          phase: "running",
        }))

        for await (const event of simulate(
          {
            policy,
            n_agents: nAgents,
            model_name: effectiveModelName,
            control_model: controlModel,
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
          } else if (event.type === "discovery_aggregate") {
            setRun(slotId, (prev) => ({
              ...prev,
              discoveryAggregate: event.data,
              discoveryAggregateRuns: [...prev.discoveryAggregateRuns, event.data],
            }))
          } else if (event.type === "discovery_summary_prompt") {
            setRun(slotId, (prev) => ({ ...prev, discoverySummaryPrompt: event.data, summaryStatus: "started" }))
          } else if (event.type === "discovery_summary_status") {
            setRun(slotId, (prev) => ({ ...prev, summaryStatus: event.data.status }))
          } else if (event.type === "discovery_summary") {
            setRun(slotId, (prev) => ({ ...prev, discoverySummary: event.data }))
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
    if (isRunning || fullModeBlocked || activeSlots.length === 0) return
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
      .find((item): item is StructuredPolicyWithPromptFields => Boolean(item))
    return {
      name: snapshotName.trim() || `Experiment ${new Date().toLocaleString()}`,
      settings: {
        nAgents,
        repeatCount,
        modelProvider: DEFAULT_MODEL_PROVIDER,
        modelName: effectiveModelName,
        controlModel,
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
    if (snapshot.settings.controlModel) setControlModel(snapshot.settings.controlModel)
    if (snapshot.settings.personaDepth) setPersonaDepth(snapshot.settings.personaDepth)
    setRuns(restoreSnapshotRuns(snapshot.results))
    setSelectedTraceSlot(snapshot.slots[0]?.id ?? null)
    const currentRun = currentRunFromSnapshot(snapshot)
    if (currentRun) {
      saveCurrentRun(currentRun)
    }
  }

  useEffect(() => {
    if (!pendingSnapshot) return
    loadSnapshot(pendingSnapshot)
    onSnapshotConsumed?.()
  }, [pendingSnapshot])

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
    if (!slot?.policy.trim() || !run.discoveryAggregate) return
    saveExperimentRunAsCurrentRun({
      policy: slot.policy.trim(),
      nAgents,
      modelName: effectiveModelName,
      modelProvider: DEFAULT_MODEL_PROVIDER,
      discoveryAggregate: run.discoveryAggregate,
      discoverySummary: run.discoverySummary,
      sampledAgents: run.sampledAgents,
      responses: run.responses,
      structuredPolicy: run.structuredPolicy,
      personaDepth,
    })
  }

  return (
    <div className="pipeline-steps">

      {/* 실험 설정 */}
      <div className="step-block">
        <div className="step-sidebar">
          <span className="step-num">설정</span>
          <span className="step-name">실험 설정</span>
          <span className="step-hint">모델 및 샘플링 파라미터</span>
        </div>
        <div className="step-body">
          <div className="settings-grid">
            <label className="field compact-field">
              <span>모델</span>
              <select disabled={isRunning} value={openAiModelName} onChange={(e) => setOpenAiModelName(e.target.value)}>
                <option value="gpt-5.4-mini">gpt-5.4-mini</option>
                <option value="gpt-5-mini">gpt-5-mini</option>
                <option value="gpt-5">gpt-5</option>
                <option value="gpt-4o">gpt-4o</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
              </select>
            </label>
            <label className="field compact-field">
              <span>취합 모델</span>
              <select disabled={isRunning} value={controlModel} onChange={(e) => setControlModel(e.target.value)}>
                <option value="gpt-5.5">gpt-5.5</option>
                <option value="gpt-5.4">gpt-5.4</option>
                <option value="gpt-5">gpt-5</option>
                <option value="gpt-5-mini">gpt-5-mini</option>
              </select>
            </label>
            <label className="field compact-field">
              <span>페르소나</span>
              <select disabled={isRunning} value={personaDepth} onChange={(e) => setPersonaDepth(e.target.value as PersonaDepth)}>
                <option value="minimal">최소</option>
                <option value="standard">중간</option>
                <option value="full">풍부</option>
              </select>
            </label>
            <label className="field compact-field">
              <span>반복</span>
              <select disabled={isRunning} value={repeatCount} onChange={(e) => setRepeatCount(Number(e.target.value) as 1 | 3 | 5)}>
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
                max={agentMax}
                value={nAgents}
                disabled={isRunning}
                onChange={(e) => setNAgents(clamp(Number(e.target.value), 5, agentMax))}
              />
            </label>
          </div>
          <div className="persona-depth-guide">
            <div className="pdg-title">페르소나 Depth 안내</div>
            <div className={`pdg-item${personaDepth === "minimal" ? " pdg-active" : ""}`}>
              <span className="pdg-badge pdg-minimal">최소</span>
              <span className="pdg-desc">나이·성별·지역·직업만 포함. 속도 우선, 대량 실험에 적합.</span>
            </div>
            <div className={`pdg-item${personaDepth === "standard" ? " pdg-active" : ""}`}>
              <span className="pdg-badge pdg-standard">중간</span>
              <span className="pdg-desc">기본 인구통계 + 가구·주거·학력 계층 포함. 기본값 권장.</span>
            </div>
            <div className={`pdg-item${personaDepth === "full" ? " pdg-active" : ""}`}>
              <span className="pdg-badge pdg-full">풍부</span>
              <span className="pdg-desc">서사·맥락·목표까지 포함. 정성적 분석에 강하지만 최대 {FULL_AGENT_LIMIT}명 제한.</span>
            </div>
          </div>
          {fullModeBlocked && (
            <p className="field-hint warn" style={{ marginTop: 10 }}>
              풍부(full) 모드는 최대 {FULL_AGENT_LIMIT}명까지 실행할 수 있습니다.
            </p>
          )}
        </div>
      </div>

      {/* 정책 입력 */}
      <div className="step-block">
        <div className="step-sidebar">
          <span className="step-num">정책</span>
          <span className="step-name">정책 입력</span>
          <span className="step-hint">실행형 정책안을 자유 텍스트로 입력</span>
        </div>
        <div className="step-body">
          <label className="field">
            <textarea
              value={slots[0]?.policy ?? ""}
              rows={8}
              disabled={isRunning}
              onChange={(e) => setSlots(updateSlotPolicy(slots, slots[0].id, e.target.value))}
              placeholder="예: 청년 월세 한시 지원. 대상, 신청 방식, 제외 조건을 가능한 만큼 적어주세요."
            />
          </label>
          <div className="run-row">
            <div className="button-group">
              <button type="button" disabled={isRunning || fullModeBlocked || activeSlots.length === 0} onClick={runExperiment}>
                {isRunning ? "실험 실행 중" : "실험 실행"}
              </button>
              <button type="button" className="secondary-button danger" disabled={!isRunning} onClick={stopExperiment}>
                작동 중지
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 결과 비교 + 파이프라인 STEP들 */}
      <ExperimentResults
        slots={slots}
        runs={runs}
        nAgents={nAgents}
        personaDepth={personaDepth}
        modelName={effectiveModelName}
        controlModel={controlModel}
        repeatCount={repeatCount}
        modelProvider={DEFAULT_MODEL_PROVIDER}
        selectedTraceSlot={selectedTraceSlot}
        onSelectTraceSlot={setSelectedTraceSlot}
        onOpenResult={(slotId, run) => { openExperimentResult(slotId, run); onOpenResult() }}
        onOpenResultDark={(slotId, run) => { openExperimentResult(slotId, run); onOpenResultDark() }}
      />

      {/* 저장 및 내보내기 */}
      <div className="step-block">
        <div className="step-sidebar">
          <span className="step-num">저장</span>
          <span className="step-name">저장 및 내보내기</span>
          <span className="step-hint">CSV 내보내기 및 불러오기</span>
        </div>
        <div className="step-body">
          <div className="archive-actions">
            <input value={snapshotName} onChange={(e) => setSnapshotName(e.target.value)} placeholder="저장 이름" />
            <button type="button" className="secondary-button" disabled={isRunning || activeSlots.length === 0} onClick={saveCurrentExperiment}>저장</button>
            <button type="button" className="secondary-button" disabled={isRunning || activeSlots.length === 0} onClick={exportCurrentExperiment}>CSV 다운로드</button>
            <button type="button" className="secondary-button" disabled={isRunning || activeSlots.length === 0} onClick={saveCurrentExperimentCsvToProject}>프로젝트 폴더에 CSV 저장</button>
          </div>
          {(projectCsvStatus || projectCsvError) && (
            <p className={projectCsvError ? "error-box compact" : "settings-note"} style={{ marginTop: 10 }}>{projectCsvError ?? projectCsvStatus}</p>
          )}
          <div className="saved-snapshot-list" style={{ marginTop: 14 }}>
            <div className="section-head compact-head">
              <div><h3>프로젝트 CSV</h3><p>저장 위치: exports/*.csv</p></div>
              <button type="button" className="secondary-button" disabled={isRunning} onClick={refreshProjectCsvExports}>새로고침</button>
            </div>
            {projectCsvExports.length === 0 && <p className="empty compact">프로젝트 폴더에 저장된 CSV가 없습니다.</p>}
            {projectCsvExports.map((item) => (
              <article key={item.filename} className="saved-snapshot-item">
                <div>
                  <strong>{item.filename}</strong>
                  <span>{item.path} · {item.bytes.toLocaleString()} bytes{item.has_snapshot ? "" : " · 상태 정보 없음"}</span>
                </div>
                <div>
                  <button type="button" className="secondary-button" disabled={isRunning || !item.has_snapshot} onClick={() => loadProjectCsv(item.filename)}>불러오기</button>
                </div>
              </article>
            ))}
          </div>
          <div className="saved-snapshot-list" style={{ marginTop: 8 }}>
            {savedSnapshots.length === 0 && <p className="empty compact">저장된 실험이 없습니다.</p>}
            {savedSnapshots.map((snapshot) => (
              <article key={snapshot.id} className="saved-snapshot-item">
                <div>
                  <strong>{snapshot.name}</strong>
                  <span>{new Date(snapshot.createdAt).toLocaleString()} · 슬롯 {snapshot.slots.length}개</span>
                </div>
                <div>
                  <button type="button" className="secondary-button" disabled={isRunning} onClick={() => loadSnapshot(snapshot)}>불러오기</button>
                  <button type="button" className="secondary-button danger" disabled={isRunning} onClick={() => deleteSnapshot(snapshot.id)}>삭제</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>

    </div>
  )
}

function ExperimentResults({
  slots,
  runs,
  nAgents,
  personaDepth,
  modelName,
  controlModel,
  repeatCount,
  modelProvider,
  selectedTraceSlot,
  onSelectTraceSlot,
  onOpenResult,
  onOpenResultDark,
}: {
  slots: ReturnType<typeof createInitialSlots>
  runs: Partial<Record<PolicySlotId, ExperimentRunState>>
  nAgents: number
  personaDepth: PersonaDepth
  modelName: string
  controlModel: string
  repeatCount: number
  modelProvider: "openai"
  selectedTraceSlot: PolicySlotId | null
  onSelectTraceSlot: (slotId: PolicySlotId) => void
  onOpenResult: (slotId: PolicySlotId, run: ExperimentRunState) => void
  onOpenResultDark: (slotId: PolicySlotId, run: ExperimentRunState) => void
}) {
  const visibleSlots = slots.filter((slot) => runs[slot.id] || slot.policy.trim())
  const visibleSlotIds = visibleSlots.map((slot) => slot.id)
  const activeTraceSlot = resolveVisibleSlotId(visibleSlotIds, selectedTraceSlot)
  const activeRun = activeTraceSlot ? runs[activeTraceSlot] : null

  return (
    <>
      {activeTraceSlot && activeRun && (
        <ExperimentTrace
          run={activeRun}
          nAgents={nAgents}
          modelName={modelName}
          controlModel={controlModel}
          repeatCount={repeatCount}
          personaDepth={personaDepth}
          modelProvider={modelProvider}
          policy={slots.find(s => s.id === activeTraceSlot)?.policy}
          onOpenResult={() => onOpenResult(activeTraceSlot, activeRun)}
          onOpenResultDark={() => onOpenResultDark(activeTraceSlot, activeRun)}
        />
      )}
    </>
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
      {(response.grounding || response.classification_source) && (
        <div className="response-meta">
          {response.grounding && <span>근거 {response.grounding === "direct" ? "직접" : "추론"}</span>}
          {response.classification_source === "fallback" && <span>추정 분류</span>}
        </div>
      )}
      <p>{response.rationale}</p>
      {(response.blind_spot || response.blind_spot_reason || response.affected_group) && (
        <div className="response-insights">
          {response.blind_spot && (
            <p>
              <strong>사각지대</strong>
              <span>{response.blind_spot}</span>
            </p>
          )}
          {response.blind_spot_reason && (
            <p>
              <strong>발견 이유</strong>
              <span>{response.blind_spot_reason}</span>
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
    </article>
  )
}

function ExperimentTrace({
  run,
  nAgents,
  modelName,
  controlModel,
  repeatCount,
  personaDepth,
  modelProvider,
  policy,
  onOpenResult,
  onOpenResultDark,
}: {
  run: ExperimentRunState
  nAgents: number
  modelName: string
  controlModel?: string
  repeatCount?: number
  personaDepth?: PersonaDepth
  modelProvider: "openai"
  policy?: string
  onOpenResult: () => void
  onOpenResultDark: () => void
}) {
  const progress = Math.round((run.responses.length / nAgents) * 100)
  const sampledById = new Map(run.sampledAgents.map((a) => [a.agent_id, a]))
  const promptById  = new Map(run.llmPrompts.map((p) => [p.agent_id, p]))
  const responseById = new Map(run.responses.map((r) => [r.agent_id, r]))
  const allAgentIds = Array.from(new Set([
    ...run.sampledAgents.map((a) => a.agent_id),
    ...run.llmPrompts.map((p) => p.agent_id),
    ...run.responses.map((r) => r.agent_id),
  ])).sort((a, b) => a - b)

  const counts = run.responses.reduce(
    (acc, r) => { acc[r.stance]++; return acc },
    { support: 0, oppose: 0, neutral: 0 },
  )

  const PERSONA_DEPTH_LABELS: Record<string, string> = {
    minimal: "최소", standard: "표준", full: "풍부",
  }

  return (
    <>
      {/* STEP 01 · 정책 구조화 */}
      {run.structuredPolicy && (
        <div className="step-block">
          <div className="step-sidebar">
            <span className="step-num">STEP 01</span>
            <span className="step-name">정책 구조화</span>
            <span className="step-hint">LLM이 원문에서 추출한 필드</span>
          </div>
          <div className="step-body">
            <StructuredPolicyView policy={run.structuredPolicy} />
          </div>
        </div>
      )}

      {/* STEP 02 · 샘플링된 페르소나 */}
      <div className="step-block">
        <div className="step-sidebar">
          <span className="step-num">STEP 02</span>
          <span className="step-name">샘플링된 페르소나</span>
          {run.samplingPlan && (
            <span className="step-hint">
              모집단 {run.samplingPlan.total_records.toLocaleString()}명 중 {run.sampledAgents.length}명 추출
            </span>
          )}
        </div>
        <div className="step-body">
          {run.sampledAgents.length === 0
            ? <p className="empty">샘플링 대기 중입니다.</p>
            : <PersonaTable agents={run.sampledAgents} prompts={run.llmPrompts} />}
        </div>
      </div>

      {/* STEP 03 · 프롬프트 설계 원칙 */}
      <div className="step-block">
        <div className="step-sidebar">
          <span className="step-num">STEP 03</span>
          <span className="step-name">프롬프트 설계 원칙</span>
          <span className="step-hint">모든 페르소나에 공통 적용되는 시스템 지침</span>
        </div>
        <div className="step-body">
          <PromptPrinciples />
        </div>
      </div>

      {/* STEP 04 · 페르소나 생성 & LLM 응답 */}
      <div className="step-block">
        <div className="step-sidebar">
          <span className="step-num">STEP 04</span>
          <span className="step-name">페르소나 생성 & LLM 응답</span>
          <span className="step-hint">{allAgentIds.length}명 처리</span>
        </div>
        <div className="step-body">
          {allAgentIds.length === 0
            ? <p className="empty">아직 처리된 페르소나가 없습니다.</p>
            : (
              <div className="agent-card-list">
                {allAgentIds.map((agentId) => (
                  <AgentCard
                    key={agentId}
                    agentId={agentId}
                    agent={sampledById.get(agentId)}
                    prompt={promptById.get(agentId)}
                    output={run.llmOutputs[agentId]}
                    status={run.llmStatuses[agentId]}
                    error={run.llmErrors[agentId]}
                    response={responseById.get(agentId)}
                  />
                ))}
              </div>
            )}
        </div>
      </div>

      {/* STEP 05 · 1차 취합 */}
      <div className="step-block">
        <div className="step-sidebar">
          <span className="step-num">STEP 05</span>
          <span className="step-name">1차 취합</span>
          <span className="step-hint">축별 사각지대 집계 및 대표 축 선정</span>
        </div>
        <div className="step-body">
          {run.discoveryAggregate
            ? <DiscoveryAggregateView aggregate={run.discoveryAggregate} />
            : <p className="empty">집계 대기 중입니다.</p>}
        </div>
      </div>

      {/* STEP 06 · 2차 취합 */}
      <div className="step-block">
        <div className="step-sidebar">
          <span className="step-num">STEP 06</span>
          <span className="step-name">2차 취합</span>
          <span className="step-hint">{run.discoverySummaryPrompt?.model ?? "gpt-5.5"} 클러스터링</span>
        </div>
        <div className="step-body">
          {(run.discoverySummary || run.discoverySummaryPrompt)
            ? <SummaryView run={run} />
            : <p className="empty">아직 취합 단계 전입니다.</p>}
        </div>
      </div>

      {/* STEP 07 · 결과 */}
      <div className="step-block">
        <div className="step-sidebar">
          <span className="step-num">STEP 07</span>
          <span className="step-name">결과</span>
          <span className="step-hint">{phaseLabel(run.phase, progress)}</span>
        </div>
        <div className="step-body">
          {run.discoveryAggregate ? (
            <div className="result-stat-grid">
              <div className="result-stat-tile result-stat-support">
                <strong>{counts.support}</strong>
                <span>찬성</span>
                <small>{Math.round(counts.support / nAgents * 100)}%</small>
              </div>
              <div className="result-stat-tile result-stat-oppose">
                <strong>{counts.oppose}</strong>
                <span>반대</span>
                <small>{Math.round(counts.oppose / nAgents * 100)}%</small>
              </div>
              <div className="result-stat-tile result-stat-neutral">
                <strong>{counts.neutral}</strong>
                <span>중립</span>
                <small>{Math.round(counts.neutral / nAgents * 100)}%</small>
              </div>
              {run.discoverySummary && (<>
                <div className="result-stat-divider" />
                <div className="result-stat-tile">
                  <strong>{run.discoverySummary.merged_blind_spots.length}</strong>
                  <span>사각지대 유형</span>
                  <small>{Array.from(new Set(run.discoverySummary.merged_blind_spots.flatMap(b => b.agent_ids))).length}명 해당</small>
                </div>
                <div className="result-stat-tile">
                  <strong>{run.discoverySummary.merged_complaints.length}</strong>
                  <span>예상 민원 유형</span>
                  <small>{Array.from(new Set(run.discoverySummary.merged_complaints.flatMap(c => c.agent_ids))).length}명 해당</small>
                </div>
                <div className="result-stat-tile">
                  <strong>{run.discoverySummary.merged_reframings.length}</strong>
                  <span>정책 전제 반문</span>
                  <small>{Array.from(new Set(run.discoverySummary.merged_reframings.flatMap(r => r.agent_ids))).length}명 해당</small>
                </div>
                <div className="result-stat-tile result-stat-axis">
                  <strong>{axisLabel(run.discoveryAggregate.featured_axis.primary)}</strong>
                  <span>대표 분석 축</span>
                  {run.discoveryAggregate.featured_axis.secondary && (
                    <small>보조: {axisLabel(run.discoveryAggregate.featured_axis.secondary)}</small>
                  )}
                </div>
              </>)}
            </div>
          ) : (
            <p className="empty">집계 대기 중입니다.</p>
          )}
        </div>
      </div>

      {/* 결과 보기 버튼 — pipeline 밖으로 */}
      {run.discoveryAggregate && (
        <div className="pipeline-result-btns">
          <button type="button" disabled={run.phase === "running"} onClick={onOpenResult}>
            결과 페이지에서 전체 보기 →
          </button>
          <button type="button" className="secondary-button" disabled={run.phase === "running"} onClick={onOpenResultDark}>
            다크모드로 보기
          </button>
        </div>
      )}
    </>
  )
}

/* ── 서브 컴포넌트들 ─────────────────────────────────── */

const SP_LABELS: Record<string, string> = {
  policy_name: "정책명",
  target: "대상",
  apply_method: "신청 방식",
  exclusions: "제외 조건",
  context: "맥락",
}

const FIELD_LABEL_KO: Record<string, string> = {
  age: "나이",
  gender: "성별",
  province: "광역시도",
  district: "시군구",
  occupation: "직업",
  family_type: "가족 유형",
  marital_status: "혼인 상태",
  housing_type: "주거 유형",
  education_level: "학력",
  bachelors_field: "전공",
  professional_persona: "직업 서사",
  family_persona: "가족 서사",
  persona: "페르소나",
  career_goals_and_ambitions: "목표 및 포부",
  income_level: "소득 수준",
  age_group: "연령대",
  region_group: "권역",
  age_band: "연령 계층",
  occupation_stratum: "직업 계층",
  household_stratum: "가구 유형",
  housing_stratum: "주거 계층",
  education_stratum: "학력 계층",
  field_stratum: "전공 계층",
}

function StructuredPolicyView({ policy }: { policy: StructuredPolicyWithPromptFields }) {
  const entries = (Object.keys(SP_LABELS) as (keyof typeof SP_LABELS)[]).flatMap((key) => {
    const field = (policy as Record<string, { value?: string | null; source?: string } | undefined>)[key]
    if (!field?.value) return []
    return [{ key, label: SP_LABELS[key], value: field.value, source: field.source ?? "stated" }]
  })
  return (
    <div>
      <div className="sp-grid">
        {entries.map((e) => (
          <div key={e.key} className="sp-row">
            <span className="sp-label">{e.label}</span>
            <span className="sp-value">{e.value}</span>
            <span className={`sp-badge ${e.source}`}>{e.source === "stated" ? "명시" : "추론"}</span>
          </div>
        ))}
        {entries.length === 0 && <p className="empty">구조화 정보가 없습니다.</p>}
      </div>
      {(policy.included_fields?.length || policy.relevant_optional_fields?.length) && (
        <div className="sp-fields-section">
          <div className="sp-fields-label">페르소나 포함 필드</div>
          <div className="sp-field-pills">
            {[...(policy.included_fields ?? []), ...(policy.relevant_optional_fields ?? [])].map((f) => (
              <span key={f} className="sp-field-pill">{FIELD_LABEL_KO[f] ?? f}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PromptPrinciples() {
  return (
    <div className="prompt-principles">
      <div className="pp-section">
        <div className="pp-label">역할 설정</div>
        <div className="pp-content">정책 전문가가 아닌 한국 시민으로 고정 — 전문용어 금지, 체감 가능한 1~2개 이유만 허용</div>
      </div>
      <div className="pp-section">
        <div className="pp-label">stance 판정</div>
        <div className="pp-pills">
          <div className="pp-pill support"><code>support</code> — 정책 방향을 폭넓게 수용할 때만</div>
          <div className="pp-pill oppose"><code>oppose</code> — 정책 방향을 폭넓게 거부할 때만</div>
          <div className="pp-pill neutral"><code>neutral</code> — 둘 다 선택 불가일 때만 (엄격 제한)</div>
        </div>
      </div>
      <div className="pp-section">
        <div className="pp-label">rationale</div>
        <div className="pp-content">찬반 이유를 시민의 언어로 1~2문장 — 전문용어·추상어 금지, 체감 가능한 구체적 생활 맥락으로만 서술</div>
      </div>
      <div className="pp-section">
        <div className="pp-label">blind_spot — 3조건 모두 충족 시에만, 아니면 null 강제</div>
        <div className="pp-conditions">
          <div className="pp-condition">
            <span className="pp-condition-num">①</span>
            <div className="pp-condition-body">
              <strong>직접성</strong>
              <span>정책 변화 → 문제로 이어지는 구체적 인과 경로가 있어야 함</span>
            </div>
          </div>
          <div className="pp-condition">
            <span className="pp-condition-num">②</span>
            <div className="pp-condition-body">
              <strong>특수성</strong>
              <span>이 페르소나의 직업·생활·경제 조건 때문에만 보이는 문제여야 함</span>
            </div>
          </div>
          <div className="pp-condition">
            <span className="pp-condition-num">③</span>
            <div className="pp-condition-body">
              <strong>비중복성</strong>
              <span>rationale에서 이미 말한 내용을 다른 말로 반복하면 안 됨</span>
            </div>
          </div>
        </div>
      </div>
      <div className="pp-section">
        <div className="pp-label">blind_spot_reason</div>
        <div className="pp-content">blind_spot이 있을 때만 작성 — 왜 이 페르소나에게만 해당 사각지대가 보이는지, 생활·직업 조건과의 인과 연결을 1문장으로 설명</div>
      </div>
      <div className="pp-section">
        <div className="pp-label">expected_complaint</div>
        <div className="pp-content">실제 민원 창구에 물을 법한 내용만 — 해당 없으면 null 강제</div>
      </div>
      <div className="pp-section">
        <div className="pp-label">출력 형식 (JSON 강제)</div>
        <div className="pp-schema">
          <code>{"{ stance, rationale, blind_spot, blind_spot_reason,"}</code>
          <code>{"  affected_group, grounding, reframing, expected_complaint }"}</code>
        </div>
      </div>
    </div>
  )
}

function AgentCard({
  agentId, agent, prompt, output, status, error, response,
}: {
  agentId: number
  agent?: AgentSampledEvent
  prompt?: LlmPromptEvent
  output?: string
  status?: LlmStatusEvent["status"]
  error?: LlmErrorEvent
  response?: AgentRespondedEvent
}) {
  const stance = response?.stance ?? null
  const hasBlindSpot = Boolean(response?.blind_spot)

  return (
    <div className={`agent-card${stance ? ` ${stance}` : ""}`}>
      <div className="agent-card-head">
        <span className="agent-num">#{agentId}</span>
        {agent && (
          <span className="agent-persona-label">
            {agent.age}세 · {GENDER_LABELS[agent.gender]} · {agent.region} · {agent.job}
          </span>
        )}
        {agent?.family_type && <span className="agent-family-label">{agent.family_type}</span>}
        {status && (
          <span className={`llm-state${status === "completed" ? " completed" : status === "failed" ? " failed" : ""}`}>
            {status === "completed" ? "완료" : status === "failed" ? "실패" : "처리중"}
          </span>
        )}
      </div>
      <div className="agent-card-body">
        <div className="agent-prompts">
          {prompt && (
            <details className="agent-detail">
              <summary>▶ 유저 프롬프트</summary>
              <pre>{prompt.messages[1]?.content ?? ""}</pre>
            </details>
          )}
          {output && (
            <details className="agent-detail">
              <summary>▶ LLM 원본 출력</summary>
              <pre>{output}</pre>
            </details>
          )}
        </div>
        {error && <p className="llm-error">{error.message}</p>}
        {response ? (
          <div className="agent-response">
            <span className={`agent-stance-badge ${response.stance}`}>
              {response.stance === "support" ? "✅ 찬성" : response.stance === "oppose" ? "❌ 반대" : "➖ 중립"}
            </span>
            <div className="agent-fields">
              <div className="agent-field-row">
                <span className="agent-field-key">rationale</span>
                <span className="agent-field-val">{response.rationale}</span>
              </div>
              <div className="agent-field-row">
                <span className="agent-field-key">blind_spot</span>
                {hasBlindSpot ? (
                  <div>
                    <div className="agent-field-val">{response.blind_spot}</div>
                    <div className="blind-spot-checks">
                      <span className="bs-check">직접성 ✓</span>
                      <span className="bs-check">특수성 ✓</span>
                      <span className="bs-check">비중복성 ✓</span>
                    </div>
                    {response.affected_group && <div className="agent-field-sub">affected_group: {response.affected_group}</div>}
                    {response.grounding && <div className="agent-field-sub">grounding: {response.grounding}</div>}
                  </div>
                ) : (
                  <span className="agent-field-null">null <span style={{ fontSize: "11px", color: "#c4cdd6" }}>(3조건 미충족)</span></span>
                )}
              </div>
              <div className="agent-field-row">
                <span className="agent-field-key">expected_complaint</span>
                {response.expected_complaint
                  ? <span className="agent-field-val">{response.expected_complaint}</span>
                  : <span className="agent-field-null">null</span>}
              </div>
              {response.reframing && (
                <div className="agent-field-row">
                  <span className="agent-field-key">reframing</span>
                  <span className="agent-field-val">{response.reframing}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          !prompt && !output && <p className="empty" style={{ margin: 0 }}>응답 대기 중…</p>
        )}
      </div>
    </div>
  )
}

function DiscoveryAggregateView({ aggregate }: { aggregate: DiscoveryAggregate }) {
  return (
    <div className="discovery-view">
      <div className="featured-axis-row">
        <span className="fa-label">대표 축</span>
        <strong>{axisLabel(aggregate.featured_axis.primary)}</strong>
        {aggregate.featured_axis.secondary && (
          <>
            <span className="fa-sep">×</span>
            <strong>{axisLabel(aggregate.featured_axis.secondary)}</strong>
          </>
        )}
      </div>
      <div className="axis-rows">
        {Object.entries(aggregate.axes).map(([axis, categories]) => (
          <div key={axis} className="axis-row">
            <span className="axis-row-label">{axisLabel(axis)}</span>
            <div className="axis-cats">
              {Object.entries(categories).map(([cat, cell]) => (
                <span
                  key={cat}
                  className={`axis-cat${cell.presence ? " present" : ""}`}
                  title={`${cell.blind_spot_headcount}명 / ${cell.category_population}명`}
                >
                  {categoryLabel(cat)}{cell.presence ? " ●" : " ○"}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SummaryClusterList({ items, maxCount }: { items: { label: string; text?: string; count: number }[]; maxCount: number }) {
  return (
    <div className="sv-cluster-list">
      {items.map((item, i) => (
        <div key={i} className="sv-cluster-item">
          <div className="sv-cluster-top">
            <span className="sv-cluster-rank">{i + 1}</span>
            <span className="sv-cluster-label">{item.label}</span>
            <span className="sv-cluster-count">{item.count}명</span>
          </div>
          {item.text && item.text !== item.label && (
            <div className="sv-cluster-text">{item.text}</div>
          )}
          <div className="sv-bar-track">
            <div className="sv-bar-fill" style={{ width: `${Math.round((item.count / maxCount) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function SummaryView({ run }: { run: ExperimentRunState }) {
  const summary = run.discoverySummary

  const blindSpots = (summary?.merged_blind_spots ?? []).map(i => ({ label: i.label, text: i.text, count: i.agent_ids.length })).sort((a,b) => b.count - a.count)
  const complaints = (summary?.merged_complaints ?? []).map(i => ({ label: i.short_label ?? i.label, text: i.label, count: i.agent_ids.length })).sort((a,b) => b.count - a.count)
  const reframings = (summary?.merged_reframings ?? []).map(i => ({ label: i.label, text: i.text, count: i.agent_ids.length })).sort((a,b) => b.count - a.count)
  const allCounts = [...blindSpots, ...complaints, ...reframings].map(i => i.count)
  const maxCount = Math.max(1, ...allCounts)

  return (
    <div className="summary-view">
      <div className="summary-view-meta">
        {run.discoverySummaryPrompt && <span>모델 <strong>{run.discoverySummaryPrompt.model}</strong></span>}
        {run.summaryStatus === "started" && <span className="llm-state">취합 중…</span>}
        {run.summaryStatus === "completed" && <span className="llm-state completed">완료</span>}
        {run.summaryStatus === "failed" && <span className="llm-state failed">실패</span>}
      </div>
      <div className="summary-toggles">
        {run.discoverySummaryPrompt && (
          <details className="agent-detail">
            <summary>▶ 프롬프트 ({run.discoverySummaryPrompt.messages.length} messages)</summary>
            <pre>{JSON.stringify(run.discoverySummaryPrompt.messages, null, 2)}</pre>
          </details>
        )}
        {summary?.raw_output && (
          <details className="agent-detail">
            <summary>▶ 원본 출력</summary>
            <pre>{summary.raw_output}</pre>
          </details>
        )}
      </div>
      {summary && (
        <div className="sv-columns">
          {blindSpots.length > 0 && (
            <div className="sv-column sv-column-blind">
              <div className="sv-column-header">
                <span className="sv-column-icon">🔍</span>
                <span className="sv-column-title">사각지대</span>
                <span className="sv-column-total">{blindSpots.length}개 유형</span>
              </div>
              <SummaryClusterList items={blindSpots} maxCount={maxCount} />
            </div>
          )}
          {complaints.length > 0 && (
            <div className="sv-column sv-column-complaint">
              <div className="sv-column-header">
                <span className="sv-column-icon">📋</span>
                <span className="sv-column-title">예상 민원</span>
                <span className="sv-column-total">{complaints.length}개 유형</span>
              </div>
              <SummaryClusterList items={complaints} maxCount={maxCount} />
            </div>
          )}
          {reframings.length > 0 && (
            <div className="sv-column sv-column-reframe">
              <div className="sv-column-header">
                <span className="sv-column-icon">💬</span>
                <span className="sv-column-title">정책 전제 반문</span>
                <span className="sv-column-total">{reframings.length}개 유형</span>
              </div>
              <SummaryClusterList items={reframings} maxCount={maxCount} />
            </div>
          )}
        </div>
      )}
      {summary && (
        <div className="summary-clusters" style={{ display: "none" }}>
          {summary.error && <p className="llm-error">{summary.error}</p>}
        </div>
      )}
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
  const result = snapshot.results.find((item) => item.discoveryAggregate)
  if (!result?.discoveryAggregate) return null
  const slot = snapshot.slots.find((item) => item.id === result.slotId)
  if (!slot?.policy.trim()) return null

  return {
    policy: slot.policy.trim(),
    n_agents: snapshot.settings.nAgents,
    model_name: snapshot.settings.modelName ?? DEFAULT_MODEL_NAME,
    model_provider: snapshot.settings.modelProvider === "openai" ? "openai" : DEFAULT_MODEL_PROVIDER,
    discoveryAggregate: result.discoveryAggregate,
    discoverySummary: result.discoverySummary ?? null,
    sampledAgents: result.sampledAgents ?? [],
    responses: result.responses ?? [],
    structuredPolicy: result.structuredPolicy ?? snapshot.structuredPolicy,
    persona_depth: snapshot.settings.personaDepth ?? "standard",
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
    discoveryAggregate: null,
    discoveryAggregateRuns: [],
    discoverySummary: null,
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
  if (pathname === "/input") return "input"
  return "home"
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DiscoveryTrace({ aggregate, summary }: { aggregate: DiscoveryAggregate; summary: DiscoverySummary | null }) {
  const axisRows = Object.entries(aggregate.axes).flatMap(([axis, categories]) =>
    Object.entries(categories).map(([category, cell]) => ({ axis, category, cell })),
  )
  return (
    <div className="aggregate">
      <div className="plan-meta">
        <span>대표 축 {axisLabel(aggregate.featured_axis.primary)}</span>
        {aggregate.featured_axis.secondary && <span>보조 축 {axisLabel(aggregate.featured_axis.secondary)}</span>}
      </div>
      {summary?.featured_axis_rationale && <p>{summary.featured_axis_rationale}</p>}
      <div className="plan-table-wrap">
        <table>
          <thead>
            <tr>
              <th>축</th>
              <th>범주</th>
              <th>발견</th>
              <th>인원</th>
              <th>모집단</th>
            </tr>
          </thead>
          <tbody>
            {axisRows.map(({ axis, category, cell }) => (
              <tr key={`${axis}-${category}`}>
                <td>{axisLabel(axis)}</td>
                <td>{categoryLabel(category)}</td>
                <td>{cell.presence ? "있음" : "없음"}</td>
                <td>{cell.blind_spot_headcount}</td>
                <td>{cell.category_population}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {summary && (
        <div className="cluster-list">
          {summary.merged_blind_spots.map((item) => (
            <article key={`${item.label}-${item.agent_ids.join("-")}`}>
              <strong>{item.label}</strong>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function parseProfileField(content: string, field: string): string {
  const regex = new RegExp(`^${field}:\\s*(.+)$`, "m")
  const match = content.match(regex)
  return match ? match[1].trim() : ""
}

function parseNarrativeField(content: string, field: string): string {
  const regex = new RegExp(`${field}:\\s*(.+?)(?=\\n\\w|\\n\\[|$)`, "s")
  const match = content.match(regex)
  return match ? match[1].trim() : ""
}

function parseNameFromNarrative(content: string): string {
  const match = content.match(/([가-힣]{2,4})\s*씨/)
  return match ? match[1] : ""
}

function PersonaTable({ agents, prompts }: { agents: AgentSampledEvent[]; prompts: LlmPromptEvent[] }) {
  const promptMap = new Map(prompts.map((p) => [p.agent_id, p]))

  return (
    <div className="persona-table-wrap">
      <table className="persona-table">
        <thead>
          <tr>
            <th>#</th>
            <th>이름</th>
            <th>나이</th>
            <th>성별</th>
            <th>시/도</th>
            <th>지역구</th>
            <th>직업</th>
            <th>가족형태</th>
            <th>혼인 상태</th>
            <th>주거 유형</th>
            <th>학력</th>
            <th>전공</th>
            <th>직업 서사</th>
            <th>가족 서사</th>
            <th>페르소나</th>
            <th>목표 및 포부</th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => {
            const userContent = promptMap.get(agent.agent_id)?.messages[1]?.content ?? ""
            const profileStart = userContent.indexOf("[Structured Profile]")
            const narrativeStart = userContent.indexOf("[Narrative Context]")
            const profileBlock = profileStart >= 0 ? userContent.slice(profileStart, narrativeStart >= 0 ? narrativeStart : undefined) : ""
            const narrativeBlock = narrativeStart >= 0 ? userContent.slice(narrativeStart) : ""

            const name = parseNameFromNarrative(narrativeBlock)
            const maritalStatus = parseProfileField(profileBlock, "marital_status")
            const housingType = parseProfileField(profileBlock, "housing_type")
            const educationLevel = parseProfileField(profileBlock, "education_level")
            const bachelorsField = parseProfileField(profileBlock, "bachelors_field")
            const professional = parseNarrativeField(narrativeBlock, "professional_persona")
            const family = parseNarrativeField(narrativeBlock, "family_persona")
            const persona = parseNarrativeField(narrativeBlock, "persona")
            const goals = parseNarrativeField(narrativeBlock, "career_goals_and_ambitions")

            return (
              <tr key={agent.agent_id}>
                <td className="pt-id">#{agent.agent_id}</td>
                <td className="pt-name">{name || "—"}</td>
                <td className="pt-num">{agent.age}세</td>
                <td>{GENDER_LABELS[agent.gender]}</td>
                <td className="pt-region">{agent.province ?? "—"}</td>
                <td className="pt-region">{agent.district ?? agent.region}</td>
                <td className="pt-job">{agent.job}</td>
                <td className="pt-family">{agent.family_type ?? "—"}</td>
                <td className="pt-family">{maritalStatus || "—"}</td>
                <td className="pt-family">{housingType || "—"}</td>
                <td className="pt-family">{educationLevel || "—"}</td>
                <td className="pt-family">{bachelorsField || "—"}</td>
                <td className="pt-text"><div className="pt-text-inner">{professional || "—"}</div></td>
                <td className="pt-text"><div className="pt-text-inner">{family || "—"}</div></td>
                <td className="pt-text"><div className="pt-text-inner">{persona || "—"}</div></td>
                <td className="pt-text"><div className="pt-text-inner">{goals || "—"}</div></td>
              </tr>
            )
          })}
        </tbody>
      </table>
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

function phaseLabel(phase: Phase, progress: number) {
  if (phase === "running") return `실행 중 ${progress}%`
  if (phase === "done") return "완료"
  if (phase === "error") return "오류"
  if (phase === "stopped") return "중지됨"
  return "대기"
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

