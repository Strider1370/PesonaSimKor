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
  SummaryErrorEvent,
  SummaryHeartbeatEvent,
  SummaryPromptEvent,
  SummaryStatusEvent,
  SummaryTokenEvent,
  getHealth,
  simulate,
} from "./lib/api"

type Phase = "idle" | "running" | "done" | "error" | "stopped"

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

export default function App() {
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

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>KoreanSim</h1>
            <p>로컬 페르소나 데이터와 LLM으로 정책 반응을 시뮬레이션합니다.</p>
          </div>
          <div className="topbar-status">
            <OllamaStatusBadge health={health} error={healthError} />
            <div className={`status-pill ${phase}`}>{phaseLabel(phase, progress)}</div>
          </div>
        </header>

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
                <article key={response.agent_id} className={`response-item ${response.stance}`}>
                  <div className="response-head">
                    <strong>{STANCE_LABELS[response.stance]}</strong>
                    <span>
                      {AGE_LABELS[response.age_group]} · {GENDER_LABELS[response.gender]} · {REGION_LABELS[response.region_group]}
                    </span>
                  </div>
                  <p>{response.rationale}</p>
                </article>
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
      </section>
    </main>
  )
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
