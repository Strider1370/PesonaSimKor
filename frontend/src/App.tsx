import { useEffect, useMemo, useState } from "react"
import { useRef } from "react"
import presetsData from "./data/presets.json"

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
  SummaryErrorEvent,
  SummaryHeartbeatEvent,
  SummaryPromptEvent,
  SummaryStatusEvent,
  SummaryTokenEvent,
  getHealth,
  simulate,
} from "./lib/api"
import {
  buildExperimentCsv,
  downloadCsv,
} from "./lib/experimentCsv"
import {
  ExperimentPreset,
  PresetSelection,
  PolicySlotId,
  addPolicySlot,
  buildSnapshotResults,
  compareWithRealOpinion,
  computeStabilityReport,
  createInitialSlots,
  getPresetOptions,
  removePolicySlot,
  restoreSnapshotRuns,
  resolveVisibleSlotId,
  resolvePresetSelection,
  selectionFromPreset,
  updateSlotFromPreset,
  updateSlotPolicy,
} from "./lib/experiment"
import {
  ExperimentSnapshot,
  deleteExperimentSnapshot,
  listExperimentSnapshots,
  saveExperimentSnapshot,
} from "./lib/experimentStorage"

type Phase = "idle" | "running" | "done" | "error" | "stopped"
type Page = "simulate" | "experiment"

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
const PRESETS = presetsData as ExperimentPreset[]
const PRESET_OPTIONS = getPresetOptions(PRESETS)
const OLLAMA_MODEL_OPTIONS = ["qwen3.5:9b", "qwen3:14b", "gemma3:12b"]

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
    setSummaryPrompt(null)
    setSummaryStatus(null)
    setSummaryOutput("")
    setSummaryHeartbeat(null)
    setSummaryError(null)
    setSummaryActivityAt(null)
    setAggregate(null)
    setError(null)

    try {
      for await (const event of simulate({ policy: trimmed, n_agents: nAgents }, controller.signal)) {
        const activityAt = Date.now()
        if (event.type === "sampling_plan") {
          setSamplingPlan(event.data)
        } else if (event.type === "agent_sampled") {
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
    const nextPath = nextPage === "experiment" ? "/experiment" : "/"
    window.history.pushState(null, "", nextPath)
    setPage(nextPage)
  }

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>KoreanSim</h1>
            <p>
              {page === "experiment"
                ? "프리셋 정책 프롬프트를 비교 실행해 LLM 반응 차이를 확인합니다."
                : "로컬 페르소나 데이터와 LLM으로 정책 반응을 시뮬레이션합니다."}
            </p>
          </div>
          <div className="topbar-status">
            <OllamaStatusBadge health={health} error={healthError} />
            <div className={`status-pill ${phase}`}>{phaseLabel(phase, progress)}</div>
          </div>
        </header>

        <PageTabs page={page} onNavigate={navigatePage} />

        {page === "experiment" ? (
          <ExperimentPage health={health} />
        ) : (
          <>
        <section className="control-panel">
          <label className="field">
            <span>정책 입력</span>
            <textarea
              value={policy}
              onChange={(event) => setPolicy(event.target.value)}
              disabled={phase === "running"}
              rows={5}
              placeholder="예: 65세 이상 노인에게 월 30만원의 교통비를 지원합니다."
            />
          </label>

          <div className="run-row">
            <label className="number-field">
              <span>인원</span>
              <input
                type="number"
                min={5}
                max={100}
                value={nAgents}
                disabled={phase === "running"}
                onChange={(event) => setNAgents(clamp(Number(event.target.value), 5, 100))}
              />
            </label>
            <div className="button-group">
              <button disabled={phase === "running" || !policy.trim()} onClick={runSimulation}>
                {phase === "running" ? "실행 중" : "시뮬레이션 실행"}
              </button>
              <button type="button" className="secondary-button danger" disabled={phase !== "running"} onClick={stopSimulation}>
                작동 중지
              </button>
              <button type="button" className="secondary-button" disabled={phase === "running"} onClick={resetSimulation}>
                초기화
              </button>
            </div>
          </div>

          {error && <div className="error-box">{error}</div>}
        </section>

        <section className="progress-panel">
          <div className="progress-meta">
            <span>
              {sampled.length}명 샘플링 · {llmPrompts.length}건 입력 생성 · {responses.length}명 응답 완료
            </span>
            <span>{progress}%</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </section>

        <section className="content-grid">
          <section className="panel result-panel">
            <h2>샘플링 계획</h2>
            {samplingPlan ? <SamplingPlanView plan={samplingPlan} /> : <p className="empty">샘플링 계획 대기 중입니다.</p>}
          </section>

          <section className="panel">
            <h2>샘플링된 인원</h2>
            <div className="sample-list">
              {sampled.length === 0 && <p className="empty">아직 샘플링된 인원이 없습니다.</p>}
              {sampled.map((agent) => (
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
              {responses.length === 0 && <p className="empty">아직 응답이 없습니다.</p>}
              {responses.slice().reverse().map((response) => (
                <ResponseCard key={response.agent_id} response={response} sampledAgent={sampledById.get(response.agent_id)} />
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>LLM 입력 로그</h2>
            <div className="prompt-list">
              {llmPrompts.length === 0 && <p className="empty">아직 모델 입력이 생성되지 않았습니다.</p>}
              {llmPrompts.map((prompt) => (
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
                const status = llmStatuses[agentId] ?? "started"
                return (
                  <article key={agentId} className="token-item">
                    <div>
                      <span>#{agentId}</span>
                      <span className={`llm-state ${status}`}>{llmStatusLabel(status)}</span>
                      <span className={llmActivityClass(status, llmActivityAt[agentId], now)}>
                        {llmActivityLabel(status, llmActivityAt[agentId], now)}
                      </span>
                      {llmHeartbeats[agentId] && <span className="llm-heartbeat">{llmHeartbeatLabel(llmHeartbeats[agentId])}</span>}
                    </div>
                    {llmErrors[agentId] && <p className="llm-error">{llmErrors[agentId].message}</p>}
                    <pre>{llmOutputs[agentId] || "LLM 출력 대기 중..."}</pre>
                  </article>
                )
              })}
            </div>
          </section>

          <section className="panel result-panel">
            <h2>전체 결과</h2>
            <SummaryTrace
              prompt={summaryPrompt}
              status={summaryStatus}
              output={summaryOutput}
              heartbeat={summaryHeartbeat}
              error={summaryError}
              activityAt={summaryActivityAt}
              now={now}
            />
            {aggregate ? <AggregateView aggregate={aggregate} /> : <p className="empty">집계 대기 중입니다.</p>}
          </section>
        </section>
          </>
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

function PageTabs({ page, onNavigate }: { page: Page; onNavigate: (page: Page) => void }) {
  return (
    <nav className="page-tabs" aria-label="페이지 전환">
      <button type="button" className={page === "simulate" ? "active" : ""} onClick={() => onNavigate("simulate")}>
        시뮬레이션
      </button>
      <button type="button" className={page === "experiment" ? "active" : ""} onClick={() => onNavigate("experiment")}>
        실험실
      </button>
    </nav>
  )
}

function ExperimentLevels({ modelProvider }: { modelProvider: "ollama" | "openai" }) {
  const activeLevels = getActiveLevels(modelProvider, false)
  const levels = [
    { id: 1, label: "다양성", note: "페르소나마다 다른 이유로 다른 반응" },
    { id: 2, label: "Prior 대응", note: "Prior 데이터 미수집 - 갤럽 여론만 파이프라인 구분 예정" },
    { id: 3, label: "반문", note: "OpenAI 모델 선택 시 정책 전제에 대한 반문 생성" },
    { id: 4, label: "대안", note: "미구현 - 장기 목표" },
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
      <div className="level-notes">
        {levels.map((level) => (
          <p key={level.id}>{level.note}</p>
        ))}
      </div>
    </section>
  )
}

function ExperimentPromptGuide({ modelProvider }: { modelProvider: "ollama" | "openai" }) {
  const outputFields =
    modelProvider === "openai"
      ? "stance, stance_strength, rationale, caveat, blind_spot, affected_group, reframing, persona_link"
      : "stance, stance_strength, rationale, caveat, blind_spot, affected_group"

  return (
    <section className="prompt-guide" aria-label="입력 프롬프트 기준">
      <div className="section-head">
        <div>
          <h2>입력 프롬프트 기준</h2>
          <p>실험 응답은 아래 기준으로 stance와 blind_spot을 분리해서 생성합니다.</p>
        </div>
        <span>{modelProvider === "openai" ? "OpenAI schema" : "Ollama schema"}</span>
      </div>
      <div className="prompt-guide-grid">
        <article>
          <h3>stance</h3>
          <ul>
            <li>최종 선택 방향을 기준으로 찬성, 반대, 중립을 고릅니다.</li>
            <li>우려나 보완 요구만으로 중립을 선택하지 않습니다.</li>
            <li>조건부 동의나 조건부 반대는 caveat에 분리합니다.</li>
          </ul>
        </article>
        <article>
          <h3>blind_spot</h3>
          <ul>
            <li>직접성, 특수성, 비중복성을 모두 만족할 때만 작성합니다.</li>
            <li>일반 찬반 쟁점이나 페르소나를 억지로 연결한 이야기는 제외합니다.</li>
            <li>세 조건 중 하나라도 부족하면 blind_spot과 affected_group은 null입니다.</li>
          </ul>
        </article>
        <article>
          <h3>출력 필드</h3>
          <p>{outputFields}</p>
        </article>
      </div>
    </section>
  )
}

function currentPresetSelection(
  slots: ReturnType<typeof createInitialSlots>,
  selections: Partial<Record<PolicySlotId, PresetSelection>>,
  slotId: PolicySlotId,
): PresetSelection | null {
  const explicitSelection = selections[slotId]
  if (explicitSelection) return explicitSelection

  const presetId = slots.find((slot) => slot.id === slotId)?.presetId
  const preset = PRESETS.find((item) => item.id === presetId)
  return preset ? selectionFromPreset(preset) : null
}

function ExperimentPage({ health }: { health: HealthStatus | null }) {
  const [slots, setSlots] = useState(createInitialSlots)
  const [presetSelections, setPresetSelections] = useState<Partial<Record<PolicySlotId, PresetSelection>>>({})
  const [nAgents, setNAgents] = useState(30)
  const [repeatCount, setRepeatCount] = useState<1 | 3 | 5>(1)
  const [modelProvider, setModelProvider] = useState<"ollama" | "openai">("ollama")
  const [ollamaModelName, setOllamaModelName] = useState("qwen3.5:9b")
  const [openAiModelName, setOpenAiModelName] = useState("gpt-5-mini")
  const [customOllamaModel, setCustomOllamaModel] = useState("")
  const [thinking, setThinking] = useState(false)
  const [personaDepth, setPersonaDepth] = useState<"minimal" | "standard" | "full">("standard")
  const [runs, setRuns] = useState<Partial<Record<PolicySlotId, ExperimentRunState>>>({})
  const [selectedTraceSlot, setSelectedTraceSlot] = useState<PolicySlotId | null>(null)
  const [savedSnapshots, setSavedSnapshots] = useState<ExperimentSnapshot[]>(() => listExperimentSnapshots())
  const [snapshotName, setSnapshotName] = useState("")
  const controllersRef = useRef<Partial<Record<PolicySlotId, AbortController>>>({})
  const activeSlots = slots.filter((slot) => slot.policy.trim())
  const isRunning = Object.values(runs).some((run) => run?.phase === "running")
  const effectiveModelName =
    modelProvider === "ollama" ? customOllamaModel.trim() || ollamaModelName : openAiModelName

  function setRun(slotId: PolicySlotId, updater: (prev: ExperimentRunState) => ExperimentRunState) {
    setRuns((prev) => ({
      ...prev,
      [slotId]: updater(prev[slotId] ?? emptyExperimentRun()),
    }))
  }

  async function runSlot(slotId: PolicySlotId, policy: string) {
    const topicId = slots.find((slot) => slot.id === slotId)?.topicId
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
            model_provider: modelProvider,
            model_name: effectiveModelName,
            thinking,
            persona_depth: personaDepth,
            topic_id: topicId ?? null,
          },
          controller.signal,
        )) {
          if (event.type === "sampling_plan") {
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

  function applyPresetSelection(slotId: PolicySlotId, nextSelection: PresetSelection) {
    const preset = resolvePresetSelection(PRESETS, nextSelection)
    setPresetSelections((prev) => ({ ...prev, [slotId]: nextSelection }))
    if (preset) {
      setSlots(updateSlotFromPreset(slots, slotId, preset))
    }
  }

  function applyPresetTopic(slotId: PolicySlotId, topicId: string) {
    const topicOptions = PRESET_OPTIONS.byTopic[topicId]
    if (!topicOptions) return
    applyPresetSelection(slotId, {
      topicId,
      variant: topicOptions.variants[0]?.id ?? "base",
      framing: topicOptions.framings[0]?.id ?? "neutral",
      context: topicOptions.contexts[0]?.id ?? "no_context",
      stanceFormat: topicOptions.stanceFormats[0]?.id ?? "explicit",
    })
  }

  function updatePresetToggle(slotId: PolicySlotId, patch: Partial<Omit<PresetSelection, "topicId">>) {
    const current = currentPresetSelection(slots, presetSelections, slotId)
    if (!current) return
    applyPresetSelection(slotId, { ...current, ...patch })
  }

  function refreshSavedSnapshots() {
    setSavedSnapshots(listExperimentSnapshots())
  }

  function currentSnapshotInput() {
    const snapshotSlots = slots
      .filter((slot) => slot.policy.trim())
      .map((slot) => ({ id: slot.id, presetId: slot.presetId, policy: slot.policy }))
    return {
      name: snapshotName.trim() || `Experiment ${new Date().toLocaleString()}`,
      settings: {
        nAgents,
        repeatCount,
        modelProvider,
        modelName: effectiveModelName,
        thinking,
        personaDepth,
      },
      slots: snapshotSlots,
      results: buildSnapshotResults(snapshotSlots, runs),
    }
  }

  function saveCurrentExperiment() {
    saveExperimentSnapshot(currentSnapshotInput())
    setSnapshotName("")
    refreshSavedSnapshots()
  }

  function loadSnapshot(snapshot: ExperimentSnapshot) {
    setSlots(snapshot.slots)
    setPresetSelections(
      Object.fromEntries(
        snapshot.slots.flatMap((slot) => {
          const preset = PRESETS.find((item) => item.id === slot.presetId)
          return preset ? [[slot.id, selectionFromPreset(preset)]] : []
        }),
      ),
    )
    setNAgents(snapshot.settings.nAgents)
    setRepeatCount((snapshot.settings.repeatCount === 3 || snapshot.settings.repeatCount === 5 ? snapshot.settings.repeatCount : 1) as 1 | 3 | 5)
    if (snapshot.settings.modelProvider) setModelProvider(snapshot.settings.modelProvider)
    if (snapshot.settings.modelName) {
      if (snapshot.settings.modelProvider === "openai") {
        setOpenAiModelName(snapshot.settings.modelName)
      } else if (OLLAMA_MODEL_OPTIONS.includes(snapshot.settings.modelName)) {
        setOllamaModelName(snapshot.settings.modelName)
        setCustomOllamaModel("")
      } else {
        setCustomOllamaModel(snapshot.settings.modelName)
      }
    }
    setThinking(Boolean(snapshot.settings.thinking))
    if (snapshot.settings.personaDepth) setPersonaDepth(snapshot.settings.personaDepth)
    setRuns(restoreSnapshotRuns(snapshot.results))
    setSelectedTraceSlot(snapshot.slots[0]?.id ?? null)
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

  return (
    <div className="experiment-layout">
      <ExperimentLevels modelProvider={modelProvider} />
      <ExperimentPromptGuide modelProvider={modelProvider} />
      <section className="control-panel experiment-settings">
        <div className="settings-grid">
          <label className="field compact-field">
            <span>제공자</span>
            <select
              value={modelProvider}
              disabled={isRunning}
              onChange={(event) => setModelProvider(event.target.value as "ollama" | "openai")}
            >
              <option value="ollama">Ollama</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>
          <label className="field compact-field">
            <span>모델</span>
            <select
              disabled={isRunning}
              value={modelProvider === "ollama" ? ollamaModelName : openAiModelName}
              onChange={(event) =>
                modelProvider === "ollama" ? setOllamaModelName(event.target.value) : setOpenAiModelName(event.target.value)
              }
            >
              {modelProvider === "ollama" ? (
                <>
                  {OLLAMA_MODEL_OPTIONS.map((model) => (
                    <option value={model} key={model}>
                      {model}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  <option value="gpt-5-mini">gpt-5-mini</option>
                  <option value="gpt-5">gpt-5</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                </>
              )}
            </select>
          </label>
          {modelProvider === "ollama" && (
            <label className="field compact-field">
              <span>사용자 모델</span>
              <input
                value={customOllamaModel}
                disabled={isRunning}
                onChange={(event) => setCustomOllamaModel(event.target.value)}
                placeholder={health?.ollama_model ?? "예: llama3.1:8b"}
              />
            </label>
          )}
          <label className="field compact-field">
            <span>Thinking</span>
            <select
              disabled={isRunning}
              value={thinking ? "on" : "off"}
              onChange={(event) => setThinking(event.target.value === "on")}
            >
              <option value="off">OFF</option>
              <option value="on">ON</option>
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
            <p>프리셋을 선택하면 슬롯의 정책 프롬프트가 자동으로 채워집니다.</p>
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
                <span>주제</span>
                <select
                  value={presetSelections[slot.id]?.topicId ?? ""}
                  disabled={isRunning}
                  onChange={(event) => applyPresetTopic(slot.id, event.target.value)}
                >
                  <option value="">직접 입력</option>
                  {PRESET_OPTIONS.topics.map((topic) => (
                    <option value={topic.id} key={topic.id}>
                      {topic.label}
                    </option>
                  ))}
                </select>
              </label>
              <SlotPresetToggles
                disabled={isRunning}
                selection={presetSelections[slot.id]}
                onChange={(patch) => updatePresetToggle(slot.id, patch)}
              />
              <label className="field">
                <span>프롬프트</span>
                <textarea
                  value={slot.policy}
                  rows={9}
                  disabled={isRunning}
                  onChange={(event) => setSlots(updateSlotPolicy(slots, slot.id, event.target.value))}
                  placeholder="프리셋을 선택하거나 정책 프롬프트를 직접 입력하세요."
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
        selectedTraceSlot={selectedTraceSlot}
        onSelectTraceSlot={setSelectedTraceSlot}
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
            CSV 내보내기
          </button>
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

function PresetTogglePicker({
  disabled,
  selection,
  topicOptions,
  onChange,
}: {
  disabled: boolean
  selection: PresetSelection
  topicOptions: (typeof PRESET_OPTIONS.byTopic)[string]
  onChange: (patch: Partial<Omit<PresetSelection, "topicId">>) => void
}) {
  if (!topicOptions) return null
  return (
    <div className="preset-toggle-panel">
      <ToggleGroup
        label="정책 변형"
        value={selection.variant}
        options={topicOptions.variants}
        disabled={disabled}
        onChange={(variant) => onChange({ variant })}
      />
      <ToggleGroup
        label="프레이밍"
        value={selection.framing}
        options={topicOptions.framings}
        disabled={disabled}
        onChange={(framing) => onChange({ framing })}
      />
      <ToggleGroup
        label="배경"
        value={selection.context}
        options={topicOptions.contexts}
        disabled={disabled}
        onChange={(context) => onChange({ context })}
      />
      <ToggleGroup
        label="응답 방식"
        value={selection.stanceFormat}
        options={topicOptions.stanceFormats}
        disabled={disabled}
        onChange={(stanceFormat) => onChange({ stanceFormat })}
      />
    </div>
  )
}

function SlotPresetToggles({
  disabled,
  selection,
  onChange,
}: {
  disabled: boolean
  selection: PresetSelection | undefined
  onChange: (patch: Partial<Omit<PresetSelection, "topicId">>) => void
}) {
  if (!selection) return null
  return (
    <PresetTogglePicker
      disabled={disabled}
      selection={selection}
      topicOptions={PRESET_OPTIONS.byTopic[selection.topicId]}
      onChange={onChange}
    />
  )
}

function ToggleGroup({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: { id: string; label: string }[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="toggle-group">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            type="button"
            key={option.id}
            className={option.id === value ? "active" : ""}
            disabled={disabled}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function ExperimentResults({
  slots,
  runs,
  nAgents,
  selectedTraceSlot,
  onSelectTraceSlot,
}: {
  slots: ReturnType<typeof createInitialSlots>
  runs: Partial<Record<PolicySlotId, ExperimentRunState>>
  nAgents: number
  selectedTraceSlot: PolicySlotId | null
  onSelectTraceSlot: (slotId: PolicySlotId) => void
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
          const preset = PRESETS.find((item) => item.id === slot.presetId)
          return (
            <article className="slot-result" key={slot.id}>
              <h3>슬롯 {slot.id}</h3>
              {run?.error && <div className="error-box">{run.error}</div>}
              {!run?.aggregate && <p className="empty">집계 대기 중입니다.</p>}
              {run && <StabilityResult aggregates={run.aggregateRuns} />}
              {preset && <RealOpinionBadge aggregate={run?.aggregate ?? null} preset={preset} />}
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
          <ExperimentTrace run={activeRun} nAgents={nAgents} />
        </section>
      )}
    </section>
  )
}

function ResponseCard({
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

function ExperimentTrace({ run, nAgents }: { run: ExperimentRunState; nAgents: number }) {
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
          <span>{phaseLabel(run.phase, progress)}</span>
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

function RealOpinionBadge({ aggregate, preset }: { aggregate: AggregateEvent | null; preset: ExperimentPreset }) {
  const comparison = compareWithRealOpinion(aggregate, preset.real_opinion)
  if (!comparison) return null
  return (
    <div className="real-opinion-badge">
      <h3>실제 여론 비교</h3>
      <p>
        {comparison.realOpinion.source} · {comparison.realOpinion.year}
      </p>
      <table>
        <thead>
          <tr>
            <th>구분</th>
            <th>시뮬레이션</th>
            <th>참고값</th>
            <th>차이</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>찬성</td>
            <td>{comparison.support.simulated}%</td>
            <td>{comparison.support.actual}%</td>
            <td>{formatDiff(comparison.support.diff)}%p</td>
          </tr>
          <tr>
            <td>반대</td>
            <td>{comparison.oppose.simulated}%</td>
            <td>{comparison.oppose.actual}%</td>
            <td>{formatDiff(comparison.oppose.diff)}%p</td>
          </tr>
        </tbody>
      </table>
      <p>{comparison.realOpinion.note}</p>
    </div>
  )
}

function formatDiff(value: number) {
  return value > 0 ? `+${value}` : String(value)
}

function safeCsvFilename(value: string) {
  return value.trim().replace(/[^\w가-힣]+/g, "_") || "experiment"
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
  return window.location.pathname === "/experiment" ? "experiment" : "simulate"
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

function OllamaStatusBadge({ health, error }: { health: HealthStatus | null; error: string | null }) {
  if (error) {
    return (
      <div className="ollama-badge offline" title={error}>
        <span>Ollama</span>
        <strong>백엔드 확인 실패</strong>
      </div>
    )
  }

  if (!health) {
    return (
      <div className="ollama-badge checking">
        <span>Ollama</span>
        <strong>확인 중</strong>
      </div>
    )
  }

  return (
    <div className={`ollama-badge ${health.ollama_reachable ? "online" : "offline"}`} title={`${health.ollama_host} / ${health.ollama_model}`}>
      <span>Ollama</span>
      <strong>{health.ollama_reachable ? "연결됨" : "꺼짐"}</strong>
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

function getActiveLevels(modelProvider: string, hasPrior: boolean): number[] {
  const levels = [1]
  if (hasPrior) levels.push(2)
  if (modelProvider === "openai") levels.push(3)
  return levels
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
    return `Ollama 첫 출력 대기 ${heartbeat.elapsed_seconds}초`
  }
  return `Ollama 처리 중 ${heartbeat.elapsed_seconds}초, 토큰 ${heartbeat.tokens_seen}개`
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
