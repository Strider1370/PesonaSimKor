# Experiment Blind Spot V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `/experiment` blind-spot discovery upgrade from `docs/EXPERIMENT_PAGE_SPEC_V2.md`: persona-level hidden risks, affected groups, OpenAI reframing, aggregate blind-spot clusters, and matching UI.

**Architecture:** Keep the existing SSE pipeline and experiment runner intact. Extend the LLM prompt/parse layer to emit richer fields, carry those fields through `agent_responded` and aggregate events, then render them in the existing `App.tsx` experiment trace and aggregate panels. Use the summary LLM to convert raw blind spots into composite clusters keyed by affected group.

**Tech Stack:** FastAPI, Python, Ollama/OpenAI chat APIs, pytest, React 19, TypeScript, Vite, Vitest.

---

## Scope

Implement only the v2 blind-spot changes:
- Provider-specific agent system prompts.
- `build_agent_prompt` user prompt wording that asks for stance and hidden risks without limiting output to two keys.
- Parser support for `blind_spot`, `affected_group`, `reframing`, and `persona_link`.
- SSE event propagation and aggregate propagation for the new fields.
- Summary prompt/parsing for `blind_spot_clusters`.
- `/experiment` Level indicator, response-card details, `BlindSpotMap`, and `ReframingList`.

Explicitly exclude:
- Any `SimulateRequest` schema change.
- Search context injection.
- Prior service implementation.
- Persona sampler/repository changes.
- SSE heartbeat or stream structure rewrites.
- Experiment storage, CSV, route, slot, preset, or repeat-run rewrites.

## File Structure

- Modify `backend/app/services/llm_client.py`: prompts, `build_agent_messages`, `build_agent_llm_payload`, agent parsing, summary prompt/parsing defaults.
- Modify `backend/app/api/simulate.py`: pass `model_provider`, include new fields in `agent_responded`, merge summary fields defensively.
- Modify `backend/app/services/aggregation.py`: collect `blind_spot_raw`, `reframing_list`, and initialize `blind_spot_clusters`.
- Modify `backend/tests/test_llm_and_api.py`: tests for prompt content, parser behavior, summary defaults, and SSE event shape.
- Modify `frontend/src/lib/api.ts`: new event and aggregate types.
- Modify `frontend/src/App.tsx`: Level indicator, enriched response cards, `BlindSpotMap`, `ReframingList`, sampled-agent joins.
- Modify `frontend/src/App.css`: styles for the new experiment UI elements.
- Modify `frontend/src/lib/api.test.ts`: type-level coverage for new fields.

---

### Task 1: Agent Prompt And Parser

**Files:**
- Modify: `backend/app/services/llm_client.py`
- Modify: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: Add failing parser and prompt tests**

Append these tests to `backend/tests/test_llm_and_api.py`:

```python
def test_parse_agent_response_keeps_common_blind_spot_fields():
    parsed = parse_agent_response(
        '{"stance":"반대","rationale":"부담이 큽니다.",'
        '"blind_spot":"야간 근무자는 월세 납부일 변동에 취약합니다.",'
        '"affected_group":"수도권 외곽 야간 운전 노동자"}'
    )

    assert parsed == {
        "stance": "oppose",
        "rationale": "부담이 큽니다.",
        "blind_spot": "야간 근무자는 월세 납부일 변동에 취약합니다.",
        "affected_group": "수도권 외곽 야간 운전 노동자",
    }


def test_parse_agent_response_keeps_openai_only_fields_for_openai():
    parsed = parse_agent_response(
        '{"stance":"중립","rationale":"조건에 따라 다릅니다.",'
        '"blind_spot":"지원 신청 시간이 근무시간과 겹칩니다.",'
        '"affected_group":"교대근무 돌봄 노동자",'
        '"reframing":"지원 금액보다 신청 접근성이 먼저입니다.",'
        '"persona_link":{"direct":"교대근무, 자녀와 동거","inferred":"근무시간 때문에 행정 접근성이 낮음"}}',
        model_provider="openai",
    )

    assert parsed["stance"] == "neutral"
    assert parsed["reframing"] == "지원 금액보다 신청 접근성이 먼저입니다."
    assert parsed["persona_link"] == {
        "direct": "교대근무, 자녀와 동거",
        "inferred": "근무시간 때문에 행정 접근성이 낮음",
    }


def test_parse_agent_response_drops_openai_only_fields_for_ollama():
    parsed = parse_agent_response(
        '{"stance":"찬성","rationale":"도움이 됩니다.",'
        '"reframing":"정책 전제가 좁습니다.",'
        '"persona_link":{"direct":"직접","inferred":"추론"}}',
        model_provider="ollama",
    )

    assert parsed == {"stance": "support", "rationale": "도움이 됩니다."}


def test_agent_messages_use_provider_specific_system_prompt_and_user_prompt_not_two_keys():
    persona = {
        "agent_id": 1,
        "age": 42,
        "gender": "female",
        "region": "Gyeonggi",
        "job": "driver",
        "structured_profile": {"occupation": "driver", "housing_type": "apartment"},
        "narrative_context": {"persona": "자녀와 함께 사는 운전원"},
    }

    ollama_messages = build_agent_messages(persona, "전세 폐지", model_provider="ollama")
    openai_messages = build_agent_messages(persona, "전세 폐지", model_provider="openai")

    assert "blind_spot" in ollama_messages[0]["content"]
    assert "affected_group" in ollama_messages[0]["content"]
    assert "reframing" not in ollama_messages[0]["content"]
    assert "reframing" in openai_messages[0]["content"]
    assert "persona_link" in openai_messages[0]["content"]
    assert "어느 쪽에 가깝습니까" in ollama_messages[1]["content"]
    assert "예상치 못한 문제" in ollama_messages[1]["content"]
    assert "Return only JSON with keys stance and rationale" not in ollama_messages[1]["content"]
    assert "exactly two keys" not in ollama_messages[1]["content"]
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py::test_parse_agent_response_keeps_common_blind_spot_fields tests/test_llm_and_api.py::test_parse_agent_response_keeps_openai_only_fields_for_openai tests/test_llm_and_api.py::test_parse_agent_response_drops_openai_only_fields_for_ollama tests/test_llm_and_api.py::test_agent_messages_use_provider_specific_system_prompt_and_user_prompt_not_two_keys -q
```

Expected: tests fail because `parse_agent_response` does not accept `model_provider`, new fields are discarded, and prompt text still limits output to `stance`/`rationale`.

- [ ] **Step 3: Implement provider prompts and parser**

In `backend/app/services/llm_client.py`, add these constants after the model defaults:

```python
SYSTEM_PROMPT_OLLAMA = """당신은 주어진 인물 정보에 충실한 한국 시민입니다.
해당 인물의 배경, 직업, 생활환경을 바탕으로 정책에 대한 입장을 밝혀주세요.
반드시 아래 JSON 형식으로만 답하세요. 다른 텍스트는 절대 포함하지 마세요.
반드시 한국어로만 답하세요.

{
  "stance": "찬성" 또는 "반대" 또는 "중립",
  "rationale": "입장 이유 (2문장, 이 인물의 관점에서)",
  "blind_spot": "이 정책이 당신 같은 처지의 사람에게 예상치 못한 문제를 일으킬 수 있다면? 정책 전문가도 이미 아는 일반적인 우려(재원 부족, 형평성 등)가 아니라, 당신의 구체적인 직업·생활·경제 상황에서만 보이는 문제를 쓰세요. (1~2문장)",
  "affected_group": "당신과 비슷한 처지의 사람들 중 이 정책으로 가장 타격받을 집단 (한 줄)"
}"""

SYSTEM_PROMPT_OPENAI = """당신은 주어진 인물 정보에 충실한 한국 시민입니다.
해당 인물의 배경, 직업, 생활환경을 바탕으로 정책에 대한 입장을 밝혀주세요.
반드시 아래 JSON 형식으로만 답하세요. 다른 텍스트는 절대 포함하지 마세요.
반드시 한국어로만 답하세요.

{
  "stance": "찬성" 또는 "반대" 또는 "중립",
  "rationale": "입장 이유 (2문장, 이 인물의 관점에서)",
  "blind_spot": "당신의 구체적인 삶의 맥락에서만 보이는 예상치 못한 문제 (1~2문장)",
  "affected_group": "가장 타격받을 집단 (한 줄)",
  "reframing": "이 정책의 전제나 방향 자체에 동의하지 않는 부분이 있다면 반문하세요. 없으면 null.",
  "persona_link": {
    "direct": "페르소나 텍스트에서 직접 언급된 근거만 쓰세요. 예: '아파트 거주, 자녀와 동거'",
    "inferred": "텍스트에 없지만 맥락에서 합리적으로 추론한 것. 예: '운전원 소득 -> 주거비 민감'. 스테레오타입은 피하세요."
  }
}"""
```

Replace `parse_agent_response` with:

```python
def parse_agent_response(text: str, model_provider: str = "ollama") -> dict:
    try:
        parsed = parse_json_object(text)
    except Exception:
        return dict(AGENT_FALLBACK)

    parsed = {str(key).strip(): value for key, value in parsed.items()}
    stance = normalize_stance(parsed.get("stance"))
    rationale = parsed.get("rationale") or parsed.get("reason") or parsed.get("explanation") or ""
    if not isinstance(rationale, str) or not rationale.strip():
        rationale = AGENT_FALLBACK["rationale"]

    result = {"stance": stance, "rationale": rationale.strip()}

    for field in ("blind_spot", "affected_group"):
        val = parsed.get(field)
        if isinstance(val, str) and val.strip():
            result[field] = val.strip()

    if model_provider == "openai":
        reframing = parsed.get("reframing")
        if isinstance(reframing, str) and reframing.strip() and reframing.strip().lower() != "null":
            result["reframing"] = reframing.strip()

        persona_link = parsed.get("persona_link")
        if isinstance(persona_link, dict):
            direct = persona_link.get("direct", "")
            inferred = persona_link.get("inferred", "")
            if isinstance(direct, str) and isinstance(inferred, str):
                direct = direct.strip()
                inferred = inferred.strip()
                if direct or inferred:
                    result["persona_link"] = {"direct": direct, "inferred": inferred}

    return result
```

Replace the trailing instruction in `build_agent_prompt` with:

```python
return f"""[Structured Profile]
{structured_text}

[Narrative Context]
{narrative_text}

[Prior]
{prior_text}

[Policy]
{policy}

위 정책에 대해 당신의 입장은 찬성, 반대, 중립 중 어느 쪽에 가깝습니까?
그리고 이 정책이 당신 같은 처지의 사람에게 예상치 못한 문제를 일으킬 수 있다면 무엇인지,
당신의 구체적인 직업과 생활 상황에서만 보이는 부분을 말씀해주세요.

반드시 시스템 메시지에서 요구한 JSON 구조와 일치하는 JSON만 반환하세요.
일반적인 정책 분석이 아니라 이 시민의 생활 맥락에서 답하세요."""
```

Replace `build_agent_messages` with:

```python
def build_agent_messages(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    persona_depth: str = "standard",
    model_provider: str = "ollama",
) -> list[dict[str, str]]:
    system = SYSTEM_PROMPT_OPENAI if model_provider == "openai" else SYSTEM_PROMPT_OLLAMA
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": build_agent_prompt(persona, policy, prior, persona_depth)},
    ]
```

Update `build_agent_llm_payload` signature and message call:

```python
def build_agent_llm_payload(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str | None = None,
    thinking: bool = False,
    persona_depth: str = "standard",
    model_provider: str = "ollama",
) -> dict:
    return {
        "agent_id": persona["agent_id"],
        "model": model_name or ollama_model(),
        "format": "json",
        "messages": build_agent_messages(persona, policy, prior, persona_depth, model_provider),
        "options": agent_options(),
        "think": thinking,
    }
```

- [ ] **Step 4: Update existing call sites in `llm_client.py`**

In `get_agent_response`, `stream_agent_response`, and `stream_openai_agent_response`, add `model_provider` parameters and pass them into `build_agent_messages` and `parse_agent_response`.

Use this signature for Ollama streaming:

```python
def stream_agent_response(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str | None = None,
    thinking: bool = False,
    persona_depth: str = "standard",
    model_provider: str = "ollama",
):
```

Use this final parse:

```python
yield {"type": "final", "response": parse_agent_response(raw_output or thinking_output, model_provider=model_provider)}
```

Use this signature for OpenAI streaming:

```python
def stream_openai_agent_response(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str = "gpt-4o-mini",
    persona_depth: str = "standard",
    thinking: bool = False,
    model_provider: str = "openai",
):
```

Use this OpenAI message call:

```python
messages=build_agent_messages(persona, policy, prior, persona_depth, model_provider),
```

Use this final parse:

```python
yield {"type": "final", "response": parse_agent_response(raw_output, model_provider=model_provider)}
```

- [ ] **Step 5: Verify Task 1 tests pass**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py::test_parse_agent_response_keeps_common_blind_spot_fields tests/test_llm_and_api.py::test_parse_agent_response_keeps_openai_only_fields_for_openai tests/test_llm_and_api.py::test_parse_agent_response_drops_openai_only_fields_for_ollama tests/test_llm_and_api.py::test_agent_messages_use_provider_specific_system_prompt_and_user_prompt_not_two_keys -q
```

Expected: all four tests pass.

- [ ] **Step 6: Run existing LLM tests**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py -q
```

Expected: existing tests pass. If signature-related monkeypatch lambdas fail, update test lambdas to accept the new trailing `model_provider="ollama"` parameter.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/llm_client.py backend/tests/test_llm_and_api.py
git commit -m "feat: add blind spot agent prompts"
```

---

### Task 2: Aggregate And Summary Blind-Spot Data

**Files:**
- Modify: `backend/app/services/aggregation.py`
- Modify: `backend/app/services/llm_client.py`
- Modify: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: Add failing aggregate and summary tests**

Add these imports to `backend/tests/test_llm_and_api.py`:

```python
from app.services.aggregation import compute_aggregate
from app.services.llm_client import failed_summary, summary_from_text
```

If `compute_aggregate` or other imported names are already imported elsewhere in the file, merge the imports instead of duplicating them.

Append these tests:

```python
def test_compute_aggregate_collects_blind_spots_and_reframing():
    aggregate = compute_aggregate(
        [
            {
                "stance": "oppose",
                "age_group": "40s",
                "gender": "female",
                "region_group": "capital",
                "blind_spot": "월세 전환 시 현금 흐름이 압박됩니다.",
                "affected_group": "수도권 외곽 맞벌이 가구",
                "reframing": "전세 폐지보다 금융 안정성이 먼저입니다.",
            },
            {
                "stance": "support",
                "age_group": "70_plus",
                "gender": "male",
                "region_group": "honam",
                "blind_spot": "온라인 신청만 있으면 접근이 어렵습니다.",
                "affected_group": "고령 1인 가구",
            },
        ]
    )

    assert aggregate["blind_spot_raw"] == [
        {
            "blind_spot": "월세 전환 시 현금 흐름이 압박됩니다.",
            "affected_group": "수도권 외곽 맞벌이 가구",
        },
        {
            "blind_spot": "온라인 신청만 있으면 접근이 어렵습니다.",
            "affected_group": "고령 1인 가구",
        },
    ]
    assert aggregate["reframing_list"] == [
        {
            "text": "전세 폐지보다 금융 안정성이 먼저입니다.",
            "age_group": "40s",
            "gender": "female",
            "region_group": "capital",
        }
    ]
    assert aggregate["blind_spot_clusters"] == []


def test_summary_from_text_parses_blind_spot_clusters_and_completed_status():
    summary = summary_from_text(
        '{"concern_clusters":[],"support_clusters":[],'
        '"blind_spot_clusters":[{"affected_group":"수도권 외곽 맞벌이 가구","count":2,'
        '"blind_spot_examples":["현금 흐름 압박"]}]}'
    )

    assert summary["status"] == "completed"
    assert summary["blind_spot_clusters"] == [
        {
            "affected_group": "수도권 외곽 맞벌이 가구",
            "count": 2,
            "blind_spot_examples": ["현금 흐름 압박"],
        }
    ]


def test_failed_summary_includes_blind_spot_clusters_default():
    summary = failed_summary("no output")

    assert summary["blind_spot_clusters"] == []


def test_summary_prompt_requests_blind_spot_clusters_schema():
    payload = build_summary_llm_payload(
        "전세 폐지",
        [
            {
                "stance": "oppose",
                "rationale": "부담됩니다.",
                "blind_spot": "월세 전환 시 현금 흐름 압박",
                "affected_group": "수도권 외곽 맞벌이 가구",
            }
        ],
    )
    full_prompt = "\n".join(message["content"] for message in payload["messages"])

    assert "blind_spot_clusters" in full_prompt
    assert "affected_group" in full_prompt
    assert "blind_spot_examples" in full_prompt
    assert "exactly three arrays" in full_prompt
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py::test_compute_aggregate_collects_blind_spots_and_reframing tests/test_llm_and_api.py::test_summary_from_text_parses_blind_spot_clusters_and_completed_status tests/test_llm_and_api.py::test_failed_summary_includes_blind_spot_clusters_default tests/test_llm_and_api.py::test_summary_prompt_requests_blind_spot_clusters_schema -q
```

Expected: tests fail because aggregate and summary outputs do not include `blind_spot_clusters` yet.

- [ ] **Step 3: Extend `compute_aggregate`**

In `backend/app/services/aggregation.py`, replace the return block with a `result` object and append the new fields:

```python
    result = {
        "total": total,
        "by_age": by_age,
        "by_gender": by_gender,
        "by_region": by_region,
        "concern_clusters": [],
        "support_clusters": [],
    }

    result["blind_spot_raw"] = [
        {
            "blind_spot": response["blind_spot"],
            "affected_group": response.get("affected_group", ""),
        }
        for response in responses
        if response.get("blind_spot")
    ]
    result["reframing_list"] = [
        {
            "text": response["reframing"],
            "age_group": response.get("age_group", ""),
            "gender": response.get("gender", ""),
            "region_group": response.get("region_group", ""),
        }
        for response in responses
        if response.get("reframing")
    ]
    result["blind_spot_clusters"] = []
    return result
```

- [ ] **Step 4: Extend summary prompt and parsing**

In `backend/app/services/llm_client.py`, update `build_summary_llm_payload` system content to request exactly three arrays:

```python
"Summarize Korean policy reaction rationales. "
"Return only a valid JSON object with exactly three arrays: concern_clusters, support_clusters, and blind_spot_clusters. "
"concern_clusters and support_clusters items must have label, count, and examples. "
"blind_spot_clusters must group blind_spot items by affected group and concrete hidden policy risk; each item must have affected_group, count, and blind_spot_examples. "
"Do not use markdown. "
"In thinking mode, use at most 3 short reasoning bullets, then stop thinking and produce the final JSON. "
"Do not restart, re-check, say wait, say actually, or run another final review."
```

Update the return schema string:

```python
f"Policy: {policy}\nResponses: {payload}\n\n"
'Return schema: {"concern_clusters":[{"label":"string","count":1,"examples":["string"]}],'
'"support_clusters":[{"label":"string","count":1,"examples":["string"]}],'
'"blind_spot_clusters":[{"affected_group":"string","count":1,"blind_spot_examples":["string"]}]}'
```

Replace `summary_from_text` with:

```python
def summary_from_text(raw_output: str) -> dict:
    parsed = parse_json_object(raw_output)
    concerns = parsed.get("concern_clusters", [])
    support = parsed.get("support_clusters", [])
    blind_spots = parsed.get("blind_spot_clusters", [])
    concern_clusters = concerns if isinstance(concerns, list) else []
    support_clusters = support if isinstance(support, list) else []
    blind_spot_clusters = blind_spots if isinstance(blind_spots, list) else []
    has_clusters = bool(concern_clusters or support_clusters or blind_spot_clusters)
    return {
        "status": "completed" if has_clusters else "empty",
        "message": "요약이 생성되었습니다." if has_clusters else "요약 모델이 빈 cluster 배열을 반환했습니다.",
        "concern_clusters": concern_clusters,
        "support_clusters": support_clusters,
        "blind_spot_clusters": blind_spot_clusters,
        "raw_output": raw_output,
    }
```

Replace `failed_summary` with:

```python
def failed_summary(message: str, raw_output: str = "") -> dict:
    return {
        "status": "failed",
        "message": message,
        "concern_clusters": [],
        "support_clusters": [],
        "blind_spot_clusters": [],
        "raw_output": raw_output,
    }
```

- [ ] **Step 5: Verify Task 2 tests pass**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py::test_compute_aggregate_collects_blind_spots_and_reframing tests/test_llm_and_api.py::test_summary_from_text_parses_blind_spot_clusters_and_completed_status tests/test_llm_and_api.py::test_failed_summary_includes_blind_spot_clusters_default tests/test_llm_and_api.py::test_summary_prompt_requests_blind_spot_clusters_schema -q
```

Expected: all four tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/aggregation.py backend/app/services/llm_client.py backend/tests/test_llm_and_api.py
git commit -m "feat: aggregate blind spot clusters"
```

---

### Task 3: SSE Event Propagation

**Files:**
- Modify: `backend/app/api/simulate.py`
- Modify: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: Add failing SSE propagation test**

Append this test to `backend/tests/test_llm_and_api.py`:

```python
def test_simulate_stream_includes_blind_spot_fields_in_response_and_aggregate(monkeypatch):
    from app.api import simulate as simulate_api

    def agent_stream(
        persona,
        policy,
        prior=None,
        model_name=None,
        thinking=False,
        persona_depth="standard",
        model_provider="ollama",
    ):
        yield {"type": "token", "content": "raw"}
        yield {
            "type": "final",
            "response": {
                "stance": "oppose",
                "rationale": "부담됩니다.",
                "blind_spot": "월세 전환 시 현금 흐름 압박",
                "affected_group": "수도권 외곽 맞벌이 가구",
                "reframing": "전세 폐지보다 금융 안정성이 먼저입니다.",
                "persona_link": {"direct": "자녀와 동거", "inferred": "주거비 민감"},
            },
        }

    def summary_stream(policy, responses, model_name=None):
        yield {
            "type": "final",
            "summary": {
                "status": "completed",
                "message": "ok",
                "concern_clusters": [],
                "support_clusters": [],
                "blind_spot_clusters": [
                    {
                        "affected_group": "수도권 외곽 맞벌이 가구",
                        "count": 5,
                        "blind_spot_examples": ["월세 전환 시 현금 흐름 압박"],
                    }
                ],
                "raw_output": "{}",
            },
        }

    patch_fast_simulation(monkeypatch, simulate_api, agent_stream=agent_stream, summary=summary_stream())

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "policy", "n_agents": 5})

    agent_payloads = []
    aggregate_payloads = []
    prompt_payloads = []
    current_event = None
    for line in response.text.splitlines():
        if line.startswith("event: "):
            current_event = line.removeprefix("event: ")
        elif line.startswith("data: "):
            payload = json.loads(line.removeprefix("data: "))
            if current_event == "agent_responded":
                agent_payloads.append(payload)
            elif current_event == "aggregate":
                aggregate_payloads.append(payload)
            elif current_event == "llm_prompt":
                prompt_payloads.append(payload)

    assert agent_payloads[0]["blind_spot"] == "월세 전환 시 현금 흐름 압박"
    assert agent_payloads[0]["affected_group"] == "수도권 외곽 맞벌이 가구"
    assert agent_payloads[0]["reframing"] == "전세 폐지보다 금융 안정성이 먼저입니다."
    assert agent_payloads[0]["persona_link"] == {"direct": "자녀와 동거", "inferred": "주거비 민감"}
    assert aggregate_payloads[-1]["blind_spot_clusters"] == [
        {
            "affected_group": "수도권 외곽 맞벌이 가구",
            "count": 5,
            "blind_spot_examples": ["월세 전환 시 현금 흐름 압박"],
        }
    ]
    assert "blind_spot" in prompt_payloads[0]["messages"][0]["content"]
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py::test_simulate_stream_includes_blind_spot_fields_in_response_and_aggregate -q
```

Expected: fail because `agent_responded` and aggregate events do not include the new fields yet.

- [ ] **Step 3: Pass provider into payload and stream calls**

In `backend/app/api/simulate.py`, update the `build_agent_llm_payload` call:

```python
build_agent_llm_payload(
    persona,
    policy,
    prior,
    model_name=req.model_name,
    thinking=req.thinking,
    persona_depth=req.persona_depth,
    model_provider=req.model_provider,
)
```

In `stream_configured_agent_response_with_heartbeat`, pass `provider` to the OpenAI stream:

```python
stream_openai_agent_response,
persona,
policy,
prior,
model_name,
persona_depth,
thinking,
provider,
```

Pass `provider` to the Ollama stream:

```python
stream_agent_response,
persona,
policy,
prior,
model_name,
thinking,
persona_depth,
provider,
```

- [ ] **Step 4: Extend response and summary merge**

In `simulation_stream`, extend `response_event`:

```python
response_event = {
    "agent_id": persona["agent_id"],
    "age_group": persona["age_group"],
    "gender": persona["gender"],
    "region_group": persona["region_group"],
    "stance": result.get("stance", "neutral"),
    "rationale": result.get("rationale", ""),
    "blind_spot": result.get("blind_spot"),
    "affected_group": result.get("affected_group"),
    "reframing": result.get("reframing"),
    "persona_link": result.get("persona_link"),
}
```

Extend the initial summary dict:

```python
summary = {
    "status": "failed",
    "message": "Summary generation failed.",
    "concern_clusters": [],
    "support_clusters": [],
    "blind_spot_clusters": [],
    "raw_output": "",
}
```

Merge with `.get`:

```python
aggregate["concern_clusters"] = summary.get("concern_clusters", [])
aggregate["support_clusters"] = summary.get("support_clusters", [])
aggregate["blind_spot_clusters"] = summary.get("blind_spot_clusters", [])
```

- [ ] **Step 5: Update test helper signatures**

In `patch_fast_simulation`, update the default `agent_stream` lambda to accept the new trailing provider parameter:

```python
lambda persona, policy, prior=None, model_name=None, thinking=False, persona_depth="standard", model_provider="ollama": iter(
    [{"type": "token", "content": "raw"}, {"type": "final", "response": {"stance": "support", "rationale": "ok"}}]
)
```

Update any other test-local agent stream functions in `backend/tests/test_llm_and_api.py` that have the old signature by adding `model_provider="ollama"` as the final parameter.

- [ ] **Step 6: Verify Task 3 test passes**

Run:

```bash
cd backend && python -m pytest tests/test_llm_and_api.py::test_simulate_stream_includes_blind_spot_fields_in_response_and_aggregate -q
```

Expected: test passes.

- [ ] **Step 7: Run backend tests**

Run:

```bash
cd backend && python -m pytest -q
```

Expected: all backend tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/simulate.py backend/tests/test_llm_and_api.py
git commit -m "feat: stream blind spot response fields"
```

---

### Task 4: Frontend Types And Pure UI Helpers

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/api.test.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add failing type coverage test**

Append to `frontend/src/lib/api.test.ts`:

```ts
it("allows blind spot response and aggregate fields in event types", () => {
  const response = {
    agent_id: 1,
    age_group: "40s",
    gender: "female",
    region_group: "capital",
    stance: "oppose",
    rationale: "부담됩니다.",
    blind_spot: "월세 전환 시 현금 흐름 압박",
    affected_group: "수도권 외곽 맞벌이 가구",
    reframing: "전세 폐지보다 금융 안정성이 먼저입니다.",
    persona_link: { direct: "자녀와 동거", inferred: "주거비 민감" },
  } satisfies import("./api").AgentRespondedEvent

  const aggregate = {
    total: { support: 0, oppose: 1, neutral: 0 },
    by_age: {},
    by_gender: {},
    by_region: {},
    concern_clusters: [],
    support_clusters: [],
    blind_spot_clusters: [
      {
        affected_group: "수도권 외곽 맞벌이 가구",
        count: 1,
        blind_spot_examples: ["월세 전환 시 현금 흐름 압박"],
      },
    ],
    reframing_list: [{ text: "전제 반문", age_group: "40s", gender: "female", region_group: "capital" }],
  } satisfies import("./api").AggregateEvent

  expect(response.blind_spot).toBe("월세 전환 시 현금 흐름 압박")
  expect(aggregate.blind_spot_clusters[0].count).toBe(1)
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm --prefix frontend test -- api.test.ts
```

Expected: TypeScript compile fails because the event types do not include the new fields.

- [ ] **Step 3: Extend API types**

In `frontend/src/lib/api.ts`, extend `AgentRespondedEvent`:

```ts
export type AgentRespondedEvent = {
  agent_id: number
  age_group: AgeGroup
  gender: Gender
  region_group: RegionGroup
  stance: Stance
  rationale: string
  blind_spot?: string
  affected_group?: string
  reframing?: string
  persona_link?: {
    direct: string
    inferred: string
  }
}
```

Add new aggregate types after `Cluster`:

```ts
export type BlindSpotCluster = {
  affected_group: string
  count: number
  blind_spot_examples: string[]
}

export type ReframingItem = {
  text: string
  age_group: string
  gender: string
  region_group: string
}
```

Extend `AggregateEvent`:

```ts
export type AggregateEvent = {
  total: StanceCounts
  by_age: Record<string, StanceCounts>
  by_gender: Record<string, StanceCounts>
  by_region: Record<string, StanceCounts>
  concern_clusters: Cluster[]
  support_clusters: Cluster[]
  blind_spot_clusters: BlindSpotCluster[]
  reframing_list: ReframingItem[]
}
```

- [ ] **Step 4: Add pure helper functions in `App.tsx`**

Near `safeClusters`, add:

```tsx
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
```

- [ ] **Step 5: Verify type tests pass**

Run:

```bash
npm --prefix frontend test -- api.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts frontend/src/App.tsx
git commit -m "feat: add blind spot frontend types"
```

---

### Task 5: Experiment Level Indicator And Response Cards

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Add Level indicator component**

In `frontend/src/App.tsx`, add this component near `PageTabs`:

```tsx
function ExperimentLevels({ modelProvider }: { modelProvider: "ollama" | "openai" }) {
  const activeLevels = getActiveLevels(modelProvider, false)
  const levels = [
    { id: 1, label: "다양성", note: "페르소나마다 다른 이유로 다른 반응" },
    { id: 2, label: "Prior저항", note: "Prior 데이터 미수집 - 갤럽 크롤링 파이프라인 구축 후 활성화" },
    { id: 3, label: "반문", note: "OpenAI 모델 선택 시 정책 전제에 대한 반문 활성" },
    { id: 4, label: "대안", note: "미구현 - 장기 목표" },
  ]

  return (
    <section className="level-panel" aria-label="검증 Level">
      <div className="level-tabs">
        {levels.map((level) => {
          const active = activeLevels.includes(level.id)
          return (
            <div key={level.id} className={`level-tab ${active ? "active" : ""}`}>
              <strong>L{level.id}: {level.label}</strong>
              <span>{active ? "●" : "○"}</span>
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
```

Render it in `ExperimentPage` immediately before the experiment settings panel:

```tsx
<ExperimentLevels modelProvider={modelProvider} />
```

- [ ] **Step 2: Add response card component**

Add this component near `ExperimentTrace`:

```tsx
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
```

- [ ] **Step 3: Use response card in root simulation response list**

In the root response list, before the `return`, compute:

```tsx
const sampledById = new Map(sampled.map((agent) => [agent.agent_id, agent]))
```

Replace the inline `responses.slice().reverse().map` article with:

```tsx
{responses.slice().reverse().map((response) => (
  <ResponseCard key={response.agent_id} response={response} sampledAgent={sampledById.get(response.agent_id)} />
))}
```

Although the Level indicator is `/experiment` only, the response event shape is shared, so the root card can safely display fields when present.

- [ ] **Step 4: Use response card in experiment trace**

Inside `ExperimentTrace`, compute:

```tsx
const sampledById = new Map(run.sampledAgents.map((agent) => [agent.agent_id, agent]))
```

Replace the inline response article in `ExperimentTrace` with:

```tsx
{run.responses.slice().reverse().map((response) => (
  <ResponseCard key={response.agent_id} response={response} sampledAgent={sampledById.get(response.agent_id)} />
))}
```

- [ ] **Step 5: Add CSS**

In `frontend/src/App.css`, add:

```css
.level-panel {
  border: 1px solid #d5dde5;
  border-radius: 8px;
  padding: 14px;
  background: #ffffff;
}

.level-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.level-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 150px;
  border: 1px solid #d5dde5;
  border-radius: 6px;
  padding: 8px 10px;
  background: #f8fafc;
  color: #52616f;
}

.level-tab.active {
  border-color: #2563eb;
  background: #eff6ff;
  color: #1d4ed8;
}

.level-notes {
  display: grid;
  gap: 4px;
  margin-top: 10px;
}

.level-notes p {
  margin-bottom: 0;
  color: #627d98;
  font-size: 13px;
}

.response-insights,
.persona-link {
  display: grid;
  gap: 6px;
  margin-top: 10px;
  border-top: 1px solid #e5eaf0;
  padding-top: 10px;
}

.response-insights p,
.persona-link p {
  display: grid;
  gap: 3px;
  margin-bottom: 0;
}

.response-insights strong,
.persona-link strong {
  color: #334e68;
  font-size: 13px;
}

.response-insights span,
.persona-link span {
  color: #52616f;
  line-height: 1.45;
}

.persona-link summary {
  cursor: pointer;
  color: #334e68;
  font-weight: 800;
}
```

- [ ] **Step 6: Verify frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css
git commit -m "feat: show experiment blind spot responses"
```

---

### Task 6: BlindSpotMap And ReframingList

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Add aggregate components**

In `frontend/src/App.tsx`, add these components near `ClusterList`:

```tsx
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
            {AGE_LABELS[item.age_group as AgeGroup] ?? item.age_group || "연령 미상"} ·{" "}
            {GENDER_LABELS[item.gender as Gender] ?? item.gender || "성별 미상"} ·{" "}
            {REGION_LABELS[item.region_group as RegionGroup] ?? item.region_group || "지역 미상"}
          </span>
        </article>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Render components in `AggregateView`**

In `AggregateView`, after the existing `ClusterList` calls, add:

```tsx
<BlindSpotMap clusters={safeBlindSpotClusters(aggregate.blind_spot_clusters)} />
<ReframingList items={safeReframingList(aggregate.reframing_list)} />
```

- [ ] **Step 3: Add CSS**

In `frontend/src/App.css`, add:

```css
.blind-spot-map,
.reframing-list {
  display: grid;
  gap: 10px;
  border: 1px solid #d5dde5;
  border-radius: 6px;
  padding: 12px;
  background: #f8fafc;
}

.blind-spot-map h3,
.reframing-list h3 {
  margin-bottom: 0;
  font-size: 16px;
}

.blind-spot-map > p {
  margin-bottom: 0;
  color: #52616f;
  font-weight: 700;
}

.blind-spot-list {
  display: grid;
  gap: 8px;
}

.blind-spot-item,
.reframing-item {
  border: 1px solid #e5eaf0;
  border-radius: 6px;
  padding: 10px 12px;
  background: #ffffff;
}

.blind-spot-item div {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}

.blind-spot-item span,
.reframing-item span {
  color: #627d98;
  font-size: 13px;
  font-weight: 700;
}

.blind-spot-item p,
.reframing-item p {
  margin-bottom: 4px;
  color: #52616f;
  line-height: 1.5;
}

.blind-spot-item p:last-child,
.reframing-item p:last-child {
  margin-bottom: 0;
}
```

- [ ] **Step 4: Verify frontend**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

Expected: tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css
git commit -m "feat: show blind spot aggregate maps"
```

---

### Task 7: End-To-End Verification

**Files:**
- No new files. Verification only unless a previous task revealed a defect.

- [ ] **Step 1: Run all automated tests**

Run:

```bash
npm test
```

Expected: backend pytest and frontend Vitest pass.

- [ ] **Step 2: Run frontend production build**

Run:

```bash
npm run build
```

Expected: TypeScript project build and Vite build pass.

- [ ] **Step 3: Start dev server**

Run:

```bash
npm run dev
```

Expected: backend starts on `http://127.0.0.1:8000` and frontend starts on `http://127.0.0.1:5173`.

- [ ] **Step 4: Manual smoke test with Ollama**

Open:

```text
http://127.0.0.1:5173/experiment
```

Verify:
- Level panel appears above experiment settings.
- Ollama provider shows L1 active and L3 inactive.
- Run a one-slot experiment.
- Response cards still show stance/rationale.
- If the model returns `blind_spot` and `affected_group`, response cards display them.
- Aggregate panel still shows stance totals and existing concern/support clusters.

- [ ] **Step 5: Manual smoke test with mocked or real OpenAI**

Use OpenAI only if `OPENAI_API_KEY` is configured.

Verify:
- Selecting OpenAI activates L3.
- Response cards can show `reframing` source data through aggregate `ReframingList`.
- `persona_link` appears as a collapsed `맥락 추적` details section when returned.

- [ ] **Step 6: Inspect SSE payloads**

In browser dev tools or by reading the LLM input log:
- `llm_prompt.messages[0].content` includes `blind_spot`.
- OpenAI prompt includes `reframing` and `persona_link`.
- `agent_responded` events include new fields when present.
- `aggregate` events include `blind_spot_clusters` and `reframing_list`.

- [ ] **Step 7: Commit verification fixes if needed**

If verification required code changes, run:

```bash
git status --short
git add backend/app frontend/src
git commit -m "fix: polish blind spot experiment flow"
```

Only commit if actual code changes were made during verification.

---

## New Session Prompt

Use this prompt in a fresh implementation session:

```text
We are in C:\Users\Jond Doe\Desktop\Project\civicsimKR.

Please implement docs/superpowers/plans/2026-05-29-experiment-blind-spot-v2.md task by task.

Scope:
- Implement the blind-spot discovery changes from docs/EXPERIMENT_PAGE_SPEC_V2.md.
- Do not change SimulateRequest.
- Do not implement search context injection.
- Do not modify persona_sampler.py, persona_repository.py, prior_service.py, experimentStorage.ts, experimentCsv.ts, or experiment.ts unless a type-only adjustment is required by compile errors.
- Keep the existing SSE stream and heartbeat structure.

Follow TDD:
- Write failing tests first.
- Run the targeted test to confirm it fails for the expected reason.
- Implement the minimal change.
- Run targeted tests, then broader tests.

Important files:
- backend/app/services/llm_client.py
- backend/app/api/simulate.py
- backend/app/services/aggregation.py
- backend/tests/test_llm_and_api.py
- frontend/src/lib/api.ts
- frontend/src/lib/api.test.ts
- frontend/src/App.tsx
- frontend/src/App.css

At the end, run:
- npm test
- npm run build

Then summarize changed files, verification output, and any remaining gaps.
```

---

## Self-Review

- Spec coverage: Covers every implementation section in `docs/EXPERIMENT_PAGE_SPEC_V2.md`: Level tabs, provider prompts, user prompt wording, parser fields, SSE event fields, aggregate raw lists, summary `blind_spot_clusters`, frontend types, response card display, `BlindSpotMap`, and `ReframingList`.
- Exclusions coverage: The plan explicitly excludes `SimulateRequest`, persona services, prior service, search context, SSE heartbeat rewrites, experiment storage, CSV, route, slot, preset, and repeat-run structure.
- Placeholder scan: No `TBD`, no open-ended implementation steps, no unnamed tests. Each task has exact files, code snippets, commands, expected failures, expected passes, and commit commands.
- Type consistency: Field names are consistent across backend, SSE, frontend types, and UI: `blind_spot`, `affected_group`, `reframing`, `persona_link`, `blind_spot_raw`, `reframing_list`, `blind_spot_clusters`, `blind_spot_examples`.
