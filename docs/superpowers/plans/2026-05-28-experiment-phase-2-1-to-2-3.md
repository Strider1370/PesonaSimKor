# Experiment Phase 2-1 To 2-3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement experiment Phase 2-1 through Phase 2-3: backend model/Thinking/persona-depth controls, repeated-run stability reporting, and real-opinion comparison badges.

**Architecture:** Keep `/experiment` as a frontend orchestration page over the existing streaming `/api/simulate` endpoint. Extend the backend request schema and LLM client so each simulation run can choose provider/model, Ollama thinking mode, and persona depth. Add frontend aggregation utilities for repeated runs and opinion comparison, then render those results without changing the main `/` page behavior.

**Tech Stack:** FastAPI, Pydantic, Ollama Python client, OpenAI Python SDK, React 19, TypeScript, Vite, Vitest, Pytest.

---

## Current Context

Phase 1 already exists:
- `frontend/src/App.tsx` has `/experiment`, A/B/C slots, topic-first preset picker, parallel slot execution, result comparison, and slot-level trace tabs.
- `frontend/src/lib/experiment.ts` has slot utilities and preset selection utilities.
- `frontend/src/data/presets.json` has 126 presets for 사형제 유지, 원자력 발전 확대, 전세 제도 폐지.
- `scripts/generate-experiment-presets.mjs` regenerates the preset JSON.
- Backend `/api/simulate` currently accepts only `policy` and `n_agents`.

Important real-opinion decision:
- Do not add a Gallup value for 전세 제도 폐지. A close Gallup 폐지/개편 찬반 item was not found.
- For 전세, use the 땅집고TV/조선일보 online community result only as a weak reference for improvement-oriented variants:
  - `support`: 64
  - `oppose`: 36
  - `source`: `땅집고TV 유튜브 커뮤니티 설문`
  - `year`: 2023
  - `question`: `전세제도 개선 필요 여부`
  - `url`: `https://realty.chosun.com/site/data/html_dir/2023/05/22/2023052200431.html`
  - `note`: `전세 제도 폐지 찬반이 아니라 전세 제도 개선 필요 여부를 물은 비대표 온라인 설문. 참고값으로만 사용.`
- Apply this only to `4_1` variants `variant_a` and `variant_b`. Leave `4_1` `base` as `real_opinion: null`.

## File Structure

- Modify `backend/app/models/schemas.py`: Extend `SimulateRequest` with provider/model/thinking/persona depth.
- Modify `backend/app/services/llm_client.py`: Add config-aware message/payload/streaming functions for Ollama and OpenAI.
- Modify `backend/app/api/simulate.py`: Pass request config into prompt/payload/stream functions.
- Modify `backend/requirements.txt`: Add `openai>=1.0.0`.
- Modify `backend/tests/test_llm_and_api.py`: Add backend tests for request schema, persona depth, thinking/model pass-through, and OpenAI env behavior.
- Modify `frontend/src/lib/api.ts`: Extend `SimulateRequest`.
- Modify `frontend/src/lib/experiment.ts`: Add stability and real-opinion comparison utilities.
- Modify `frontend/src/lib/experiment.test.ts`: Add frontend utility tests.
- Modify `frontend/src/App.tsx`: Wire experiment settings into requests, add repeated runs, stability display, and real-opinion badges.
- Modify `frontend/src/App.css`: Style stability and real-opinion displays.
- Modify `scripts/generate-experiment-presets.mjs`: Add weak reference opinion for 전세 improvement variants.
- Regenerate `frontend/src/data/presets.json`.

---

### Task 1: Backend Request Schema

**Files:**
- Modify: `backend/app/models/schemas.py`
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: Write failing schema tests**

Append tests to `backend/tests/test_llm_and_api.py`:

```python
from pydantic import ValidationError

from app.models.schemas import SimulateRequest


def test_simulate_request_accepts_experiment_options():
    req = SimulateRequest(
        policy="원자력 발전 확대",
        n_agents=12,
        model_provider="ollama",
        model_name="gemma4:26b",
        thinking=True,
        persona_depth="full",
    )

    assert req.model_provider == "ollama"
    assert req.model_name == "gemma4:26b"
    assert req.thinking is True
    assert req.persona_depth == "full"


def test_simulate_request_rejects_invalid_provider_and_depth():
    try:
        SimulateRequest(policy="정책", model_provider="bad", persona_depth="huge")
    except ValidationError as exc:
        errors = str(exc)
        assert "model_provider" in errors
        assert "persona_depth" in errors
    else:
        raise AssertionError("Expected validation error")
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py::test_simulate_request_accepts_experiment_options tests/test_llm_and_api.py::test_simulate_request_rejects_invalid_provider_and_depth -q
```

Expected: fail because `model_provider`, `model_name`, `thinking`, and `persona_depth` do not exist or are not validated.

- [ ] **Step 3: Implement schema fields**

Edit `backend/app/models/schemas.py`:

```python
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class SimulateRequest(BaseModel):
    policy: str = Field(min_length=1)
    n_agents: int = Field(default=30, ge=5, le=100)
    model_provider: Literal["ollama", "openai"] = "ollama"
    model_name: str = "qwen3.5:9b"
    thinking: bool = False
    persona_depth: Literal["minimal", "standard", "full"] = "standard"

    @field_validator("policy")
    @classmethod
    def policy_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("policy must not be blank")
        return stripped

    @field_validator("model_name")
    @classmethod
    def model_name_must_not_be_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("model_name must not be blank")
        return stripped
```

- [ ] **Step 4: Verify schema tests pass**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py::test_simulate_request_accepts_experiment_options tests/test_llm_and_api.py::test_simulate_request_rejects_invalid_provider_and_depth -q
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/schemas.py backend/tests/test_llm_and_api.py
git commit -m "feat: extend simulate request for experiment options"
```

---

### Task 2: Persona Depth And Ollama Config

**Files:**
- Modify: `backend/app/services/llm_client.py`
- Modify: `backend/app/api/simulate.py`
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: Write failing persona depth and payload tests**

Append to `backend/tests/test_llm_and_api.py`:

```python
from app.services.llm_client import build_agent_llm_payload, build_agent_prompt


def test_build_agent_prompt_minimal_depth_excludes_job_and_narrative():
    persona = {
        "agent_id": 1,
        "age": 35,
        "gender": "female",
        "region": "서울",
        "job": "교사",
        "education": "대졸",
        "structured_profile": {
            "age": 35,
            "gender": "female",
            "district": "서울",
            "education_level": "대졸",
            "occupation": "교사",
        },
        "narrative_context": {"persona": "자녀가 있는 직장인"},
    }

    prompt = build_agent_prompt(persona, "정책", persona_depth="minimal")

    assert "age: 35" in prompt
    assert "gender: female" in prompt
    assert "region: 서울" in prompt
    assert "교사" not in prompt
    assert "자녀가 있는 직장인" not in prompt


def test_build_agent_llm_payload_uses_requested_model_thinking_and_depth():
    persona = {
        "agent_id": 1,
        "age": 35,
        "gender": "female",
        "region": "서울",
        "job": "교사",
        "age_group": "30s",
        "region_group": "capital",
    }

    payload = build_agent_llm_payload(
        persona,
        "정책",
        model_name="gemma4:26b",
        thinking=True,
        persona_depth="minimal",
    )

    assert payload["model"] == "gemma4:26b"
    assert payload["think"] is True
    assert "occupation" not in payload["messages"][1]["content"]
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py::test_build_agent_prompt_minimal_depth_excludes_job_and_narrative tests/test_llm_and_api.py::test_build_agent_llm_payload_uses_requested_model_thinking_and_depth -q
```

Expected: fail because functions do not accept these arguments yet.

- [ ] **Step 3: Implement persona depth in `llm_client.py`**

Change signatures and helper logic:

```python
def build_agent_prompt(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    persona_depth: str = "standard",
) -> str:
    prior_text = json.dumps(prior, ensure_ascii=False) if prior else "none"

    if persona_depth == "minimal":
        structured_profile = {
            "age": persona.get("age"),
            "gender": persona.get("gender"),
            "region": persona.get("region"),
        }
        narrative_context = {}
    elif persona_depth == "full":
        structured_profile = persona.get(
            "structured_profile",
            {
                "age": persona.get("age"),
                "gender": persona.get("gender"),
                "district": persona.get("region"),
                "education_level": persona.get("education"),
                "occupation": persona.get("job"),
            },
        )
        narrative_context = persona.get("narrative_context", {"persona": persona.get("background", "")})
    else:
        structured_profile = {
            "age": persona.get("age"),
            "gender": persona.get("gender"),
            "region": persona.get("region"),
            "education_level": persona.get("education"),
            "occupation": persona.get("job"),
        }
        narrative_context = {}

    structured_text = "\n".join(f"{key}: {value}" for key, value in structured_profile.items() if value not in ("", None))
    narrative_text = "\n".join(f"{key}: {value}" for key, value in narrative_context.items() if value not in ("", None))
    return f"""[Structured Profile]
{structured_text}

[Narrative Context]
{narrative_text}

[Prior]
{prior_text}

[Policy]
{policy}

Return only JSON with keys stance and rationale. stance must be support, oppose, or neutral.
Answer from this citizen's lived perspective. Reflect their age, family situation, housing, occupation, and local context.
Do not give a generic policy analysis."""
```

Change `build_agent_messages`:

```python
def build_agent_messages(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    persona_depth: str = "standard",
) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You simulate one Korean citizen's policy reaction. "
                "Return only a valid JSON object with exactly two keys: stance and rationale. "
                "Do not use markdown, code fences, or thinking text. "
                "stance must be one of support, oppose, neutral. "
                "rationale must be one natural Korean sentence from that citizen's lived perspective."
            ),
        },
        {"role": "user", "content": build_agent_prompt(persona, policy, prior, persona_depth)},
    ]
```

Change `build_agent_llm_payload`:

```python
def build_agent_llm_payload(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str | None = None,
    thinking: bool = False,
    persona_depth: str = "standard",
) -> dict:
    return {
        "agent_id": persona["agent_id"],
        "model": model_name or ollama_model(),
        "format": "json",
        "messages": build_agent_messages(persona, policy, prior, persona_depth),
        "options": agent_options(),
        "think": thinking,
    }
```

Change `stream_agent_response`:

```python
def stream_agent_response(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str | None = None,
    thinking: bool = False,
    persona_depth: str = "standard",
):
    raw_output = ""
    try:
        client = ollama.Client(host=ollama_host(), timeout=60)
        stream = client.chat(
            model=model_name or ollama_model(),
            format="json",
            messages=build_agent_messages(persona, policy, prior, persona_depth),
            options=agent_options(),
            think=thinking,
            stream=True,
        )
        ...
```

Keep the existing body after the `client.chat(...)` call unchanged.

- [ ] **Step 4: Pass config through `simulate.py`**

Change helper signatures:

```python
async def stream_agent_response_with_heartbeat(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str | None = None,
    thinking: bool = False,
    persona_depth: str = "standard",
):
    async for event in stream_with_heartbeat(stream_agent_response, persona, policy, prior, model_name, thinking, persona_depth):
        yield event
```

Change `simulation_stream` signature:

```python
async def simulation_stream(req: SimulateRequest):
    policy = req.policy
    n_agents = req.n_agents
```

Change payload and streaming calls:

```python
yield sse_event(
    "llm_prompt",
    build_agent_llm_payload(
        persona,
        policy,
        prior,
        model_name=req.model_name,
        thinking=req.thinking,
        persona_depth=req.persona_depth,
    ),
)
...
async for llm_event in stream_agent_response_with_heartbeat(
    persona,
    policy,
    prior,
    req.model_name,
    req.thinking,
    req.persona_depth,
):
```

Change route:

```python
@router.post("/simulate")
async def simulate(req: SimulateRequest):
    return StreamingResponse(
        simulation_stream(req),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
```

- [ ] **Step 5: Verify tests pass**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py -q
```

Expected: all backend tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/llm_client.py backend/app/api/simulate.py backend/tests/test_llm_and_api.py
git commit -m "feat: apply experiment ollama options"
```

---

### Task 3: OpenAI Backend Provider

**Files:**
- Modify: `backend/app/services/llm_client.py`
- Modify: `backend/app/api/simulate.py`
- Modify: `backend/requirements.txt`
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: Write failing OpenAI tests**

Append to `backend/tests/test_llm_and_api.py`:

```python
from app.services.llm_client import get_openai_api_key


def test_get_openai_api_key_requires_env(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    try:
        get_openai_api_key()
    except RuntimeError as exc:
        assert "OPENAI_API_KEY" in str(exc)
    else:
        raise AssertionError("Expected RuntimeError")


def test_get_openai_api_key_reads_env(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")

    assert get_openai_api_key() == "sk-test"
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py::test_get_openai_api_key_requires_env tests/test_llm_and_api.py::test_get_openai_api_key_reads_env -q
```

Expected: fail because `get_openai_api_key` does not exist.

- [ ] **Step 3: Add dependency**

Add this line to `backend/requirements.txt`:

```text
openai>=1.0.0
```

- [ ] **Step 4: Implement OpenAI helpers**

In `backend/app/services/llm_client.py`, add:

```python
def get_openai_api_key() -> str:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for OpenAI simulations")
    return api_key


def stream_openai_agent_response(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str = "gpt-4o-mini",
    persona_depth: str = "standard",
):
    raw_output = ""
    try:
        from openai import OpenAI

        client = OpenAI(api_key=get_openai_api_key())
        stream = client.chat.completions.create(
            model=model_name,
            response_format={"type": "json_object"},
            messages=build_agent_messages(persona, policy, prior, persona_depth),
            stream=True,
        )
        for chunk in stream:
            content = chunk.choices[0].delta.content or ""
            if content:
                raw_output += content
                yield {"type": "token", "content": content}
        yield {"type": "final", "response": parse_agent_response(raw_output)}
    except Exception as exc:
        message = f"{type(exc).__name__}: {exc}"
        yield {"type": "error", "message": message}
        yield {
            "type": "final",
            "response": {
                "stance": "neutral",
                "rationale": f"LLM 호출 실패: {message}",
            },
        }
```

- [ ] **Step 5: Route provider in `simulate.py`**

Import `stream_openai_agent_response`.

Add provider-aware wrapper:

```python
async def stream_configured_agent_response_with_heartbeat(
    provider: str,
    persona: dict,
    policy: str,
    prior: dict | None,
    model_name: str,
    thinking: bool,
    persona_depth: str,
):
    source = stream_openai_agent_response if provider == "openai" else stream_agent_response
    if provider == "openai":
        async for event in stream_with_heartbeat(source, persona, policy, prior, model_name, persona_depth):
            yield event
    else:
        async for event in stream_with_heartbeat(source, persona, policy, prior, model_name, thinking, persona_depth):
            yield event
```

Use this wrapper in `simulation_stream`.

- [ ] **Step 6: Verify backend tests**

Run:

```bash
cd backend && python -m pytest -q
```

Expected: all backend tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/requirements.txt backend/app/services/llm_client.py backend/app/api/simulate.py backend/tests/test_llm_and_api.py
git commit -m "feat: add openai simulation provider"
```

---

### Task 4: Frontend API And Experiment Settings

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/lib/api.test.ts`

- [ ] **Step 1: Write failing API type-oriented test**

Append to `frontend/src/lib/api.test.ts`:

```ts
import type { SimulateRequest } from "./api"

it("allows experiment options in simulate request type", () => {
  const request: SimulateRequest = {
    policy: "정책",
    n_agents: 30,
    model_provider: "ollama",
    model_name: "gemma4:26b",
    thinking: true,
    persona_depth: "full",
  }

  expect(request.model_name).toBe("gemma4:26b")
})
```

- [ ] **Step 2: Run test/build to verify RED**

Run:

```bash
npm --prefix frontend run build
```

Expected: TypeScript fails because `SimulateRequest` does not include experiment fields.

- [ ] **Step 3: Extend frontend request type**

In `frontend/src/lib/api.ts`:

```ts
export type SimulateRequest = {
  policy: string
  n_agents: number
  model_provider?: "ollama" | "openai"
  model_name?: string
  thinking?: boolean
  persona_depth?: "minimal" | "standard" | "full"
}
```

- [ ] **Step 4: Wire settings state in `App.tsx`**

In `ExperimentPage`, add state:

```ts
const [modelProvider, setModelProvider] = useState<"ollama" | "openai">("ollama")
const [modelName, setModelName] = useState("qwen3.5:9b")
const [customOllamaModel, setCustomOllamaModel] = useState("")
const [thinking, setThinking] = useState(false)
const [personaDepth, setPersonaDepth] = useState<"minimal" | "standard" | "full">("standard")
```

Use:

```ts
const effectiveModelName = modelProvider === "ollama" ? customOllamaModel.trim() || modelName : modelName
```

Change simulate call:

```ts
simulate(
  {
    policy,
    n_agents: nAgents,
    model_provider: modelProvider,
    model_name: effectiveModelName,
    thinking: modelProvider === "ollama" ? thinking : false,
    persona_depth: personaDepth,
  },
  controller.signal,
)
```

Replace disabled settings UI with active controls:
- Provider select: `Ollama`, `OpenAI`
- Ollama buttons/select options: `qwen3.5:9b`, `gemma4:26b`, `exaone3.5:7.8b`
- Ollama custom model input
- OpenAI select: `gpt-4o`, `gpt-4o-mini`
- Thinking select/toggle enabled only when provider is `ollama`
- Persona select enabled

- [ ] **Step 5: Verify frontend**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts frontend/src/App.tsx
git commit -m "feat: wire experiment model settings"
```

---

### Task 5: Repeated Run Stability

**Files:**
- Modify: `frontend/src/lib/experiment.ts`
- Modify: `frontend/src/lib/experiment.test.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Write failing stability tests**

Append to `frontend/src/lib/experiment.test.ts`:

```ts
import { computeStabilityReport } from "./experiment"

it("computes mean and standard deviation for repeated runs", () => {
  const report = computeStabilityReport([
    { total: { support: 6, oppose: 3, neutral: 1 } },
    { total: { support: 7, oppose: 2, neutral: 1 } },
    { total: { support: 5, oppose: 4, neutral: 1 } },
  ])

  expect(report.support.mean).toBeCloseTo(60, 1)
  expect(report.support.stddev).toBeCloseTo(8.16, 1)
  expect(report.runs).toHaveLength(3)
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm --prefix frontend test -- experiment.test.ts
```

Expected: fail because `computeStabilityReport` does not exist.

- [ ] **Step 3: Implement stability utility**

In `frontend/src/lib/experiment.ts`:

```ts
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

export function computeStabilityReport(runs: MinimalAggregate[]): StabilityReport {
  return {
    support: metric(runs, "support"),
    oppose: metric(runs, "oppose"),
    neutral: metric(runs, "neutral"),
    runs,
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
```

- [ ] **Step 4: Wire repeat count in UI**

In `ExperimentPage`, replace disabled repeat select with active:

```ts
const [repeatCount, setRepeatCount] = useState<1 | 3 | 5>(1)
```

Run each slot sequentially for repeat count:

```ts
for (let index = 0; index < repeatCount; index += 1) {
  await runSingleSlotOnce(slotId, policy, index)
}
```

Store completed aggregates per slot:

```ts
aggregateRuns: AggregateEvent[]
currentRunIndex: number
```

When an `aggregate` event arrives:

```ts
setRun(slotId, (prev) => ({
  ...prev,
  aggregate: event.data,
  aggregateRuns: [...prev.aggregateRuns, event.data],
}))
```

Show stability report when `aggregateRuns.length > 1`.

- [ ] **Step 5: Add stability display**

Add component in `App.tsx`:

```tsx
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
          <tr><td>찬성</td><td>{report.support.mean.toFixed(1)}%</td><td>{report.support.stddev.toFixed(1)}%</td></tr>
          <tr><td>반대</td><td>{report.oppose.mean.toFixed(1)}%</td><td>{report.oppose.stddev.toFixed(1)}%</td></tr>
          <tr><td>중립</td><td>{report.neutral.mean.toFixed(1)}%</td><td>{report.neutral.stddev.toFixed(1)}%</td></tr>
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 6: Verify frontend**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

Expected: tests and build pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/experiment.ts frontend/src/lib/experiment.test.ts frontend/src/App.tsx frontend/src/App.css
git commit -m "feat: add experiment stability reporting"
```

---

### Task 6: Real Opinion Comparison Badges

**Files:**
- Modify: `frontend/src/lib/experiment.ts`
- Modify: `frontend/src/lib/experiment.test.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`
- Modify: `scripts/generate-experiment-presets.mjs`
- Modify: `frontend/src/data/presets.json`

- [ ] **Step 1: Write failing comparison tests**

Append to `frontend/src/lib/experiment.test.ts`:

```ts
import { compareWithRealOpinion } from "./experiment"

it("compares aggregate support and oppose rates with real opinion", () => {
  const comparison = compareWithRealOpinion(
    { total: { support: 3, oppose: 6, neutral: 1 } },
    {
      support: 64,
      oppose: 36,
      neutral: 0,
      source: "땅집고TV 유튜브 커뮤니티 설문",
      year: 2023,
      question: "전세제도 개선 필요 여부",
      url: "https://realty.chosun.com/site/data/html_dir/2023/05/22/2023052200431.html",
      note: "참고값",
    },
  )

  expect(comparison?.support.simulated).toBe(30)
  expect(comparison?.support.diff).toBe(-34)
  expect(comparison?.oppose.simulated).toBe(60)
  expect(comparison?.oppose.diff).toBe(24)
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm --prefix frontend test -- experiment.test.ts
```

Expected: fail because `compareWithRealOpinion` does not exist.

- [ ] **Step 3: Implement comparison utility**

In `frontend/src/lib/experiment.ts`:

```ts
export type RealOpinion = NonNullable<ExperimentPreset["real_opinion"]>

export function compareWithRealOpinion(
  aggregate: { total: { support: number; oppose: number; neutral: number } } | null,
  realOpinion: RealOpinion | null,
) {
  if (!aggregate || !realOpinion) return null
  const total = aggregate.total.support + aggregate.total.oppose + aggregate.total.neutral
  if (!total) return null
  const support = Math.round((aggregate.total.support / total) * 100)
  const oppose = Math.round((aggregate.total.oppose / total) * 100)
  const neutral = Math.round((aggregate.total.neutral / total) * 100)
  return {
    realOpinion,
    support: { simulated: support, actual: realOpinion.support, diff: support - realOpinion.support },
    oppose: { simulated: oppose, actual: realOpinion.oppose, diff: oppose - realOpinion.oppose },
    neutral: { simulated: neutral, actual: realOpinion.neutral ?? 0, diff: neutral - (realOpinion.neutral ?? 0) },
  }
}
```

- [ ] **Step 4: Add 전세 weak reference data**

In `scripts/generate-experiment-presets.mjs`, add:

```js
const jeonseImprovementReference = {
  support: 64,
  oppose: 36,
  neutral: 0,
  source: "땅집고TV 유튜브 커뮤니티 설문",
  year: 2023,
  question: "전세제도 개선 필요 여부",
  url: "https://realty.chosun.com/site/data/html_dir/2023/05/22/2023052200431.html",
  note: "전세 제도 폐지 찬반이 아니라 전세 제도 개선 필요 여부를 물은 비대표 온라인 설문. 참고값으로만 사용.",
}
```

For topic `4_1`, keep topic-level `realOpinion: null`, then add per-variant override support:

```js
realOpinion: variant.realOpinion ?? topic.realOpinion,
```

Set `realOpinion: jeonseImprovementReference` only on `variant_a` and `variant_b`.

Run:

```bash
node scripts/generate-experiment-presets.mjs
```

- [ ] **Step 5: Render badge in experiment results**

In `ExperimentResults`, find selected preset for each slot:

```ts
const preset = PRESETS.find((item) => item.id === slot.presetId)
```

Render:

```tsx
{preset && <RealOpinionBadge aggregate={run?.aggregate ?? null} preset={preset} />}
```

Add:

```tsx
function RealOpinionBadge({ aggregate, preset }: { aggregate: AggregateEvent | null; preset: ExperimentPreset }) {
  const comparison = compareWithRealOpinion(aggregate, preset.real_opinion)
  if (!comparison) return null
  return (
    <div className="real-opinion-badge">
      <h3>실제 여론 비교</h3>
      <p>{comparison.realOpinion.source} · {comparison.realOpinion.year}</p>
      <table>
        <tbody>
          <tr><td>찬성</td><td>{comparison.support.simulated}%</td><td>{comparison.support.actual}%</td><td>{formatDiff(comparison.support.diff)}%p</td></tr>
          <tr><td>반대</td><td>{comparison.oppose.simulated}%</td><td>{comparison.oppose.actual}%</td><td>{formatDiff(comparison.oppose.diff)}%p</td></tr>
        </tbody>
      </table>
      <p>{comparison.realOpinion.note}</p>
    </div>
  )
}

function formatDiff(value: number) {
  return value > 0 ? `+${value}` : String(value)
}
```

- [ ] **Step 6: Verify frontend**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

Expected: tests and build pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/experiment.ts frontend/src/lib/experiment.test.ts frontend/src/App.tsx frontend/src/App.css scripts/generate-experiment-presets.mjs frontend/src/data/presets.json
git commit -m "feat: compare experiment results with real opinion"
```

---

## Final Verification

- [ ] Run backend tests:

```bash
cd backend && python -m pytest -q
```

Expected: `34+ passed` with no failures.

- [ ] Run frontend tests:

```bash
npm --prefix frontend test
```

Expected: all Vitest tests pass.

- [ ] Run frontend build:

```bash
npm --prefix frontend run build
```

Expected: TypeScript and Vite build pass.

- [ ] Run full test suite:

```bash
npm test
```

Expected: backend and frontend tests pass.

- [ ] Start dev server:

```bash
npm run dev
```

Expected: `/experiment` loads and returns HTTP 200.

---

## New Session Prompt

Use this prompt in a fresh session:

```text
We are in C:\Users\Jond Doe\Desktop\Project\civicsimKR.

Please implement docs/superpowers/plans/2026-05-28-experiment-phase-2-1-to-2-3.md task by task.

Scope:
- Implement Phase 2-1: backend SimulateRequest options for model_provider, model_name, thinking, persona_depth; wire Ollama model/thinking/persona depth.
- Implement Phase 2-2: repeated run stability in /experiment with 1/3/5 runs, mean and standard deviation.
- Implement Phase 2-3: real-opinion comparison badges, including weak reference data for 전세 improvement variants only.

Do not implement search context injection yet.
Do not implement Tavily or DuckDuckGo yet.
Do not store OpenAI API keys in frontend state/localStorage. Use backend OPENAI_API_KEY only.

Follow TDD:
- Write failing tests before implementation.
- Verify the failing tests fail for the expected reason.
- Implement the minimal changes.
- Run tests and build after each task.

Important existing files:
- frontend/src/App.tsx
- frontend/src/lib/api.ts
- frontend/src/lib/experiment.ts
- frontend/src/lib/experiment.test.ts
- frontend/src/data/presets.json
- scripts/generate-experiment-presets.mjs
- backend/app/models/schemas.py
- backend/app/api/simulate.py
- backend/app/services/llm_client.py
- backend/tests/test_llm_and_api.py

At the end, run:
- npm test
- npm --prefix frontend run build

Then summarize changed files, verification output, and any remaining gaps.
```

---

## Self-Review

- Spec coverage: Covers Phase 2-1, Phase 2-2, and Phase 2-3. Search context injection is explicitly excluded. OpenAI backend provider is included because the user asked through Phase 2-3 and original Phase 2 item 3 is OpenAI.
- Placeholder scan: No TBD/TODO placeholders. Every task has files, tests, expected failure, implementation direction, verification, and commit step.
- Type consistency: Uses existing `SimulateRequest`, `ExperimentPreset`, `AggregateEvent`, `PolicySlotId`, and current frontend/backend file names.
