# Main Result Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a polished `/result` insight board that renders the latest completed policy simulation as a blind-spot discovery result page, using `tasks/main-redesign/spec.md` for structure and `DESIGN.md` for visual style.

**Architecture:** Keep `/` and `/experiment` intact, then add `/result` as a new route in the existing lightweight `App.tsx` path switch. Backend summary output gains `short_label`, `short_title`, and `agent_ids`; frontend stores the latest completed run in `sessionStorage` through a small persisted store and renders focused result components from that saved run.

**Tech Stack:** FastAPI + pytest backend, React 19 + Vite + TypeScript + Vitest frontend, plain CSS, existing SSE stream, optional `zustand` dependency for persisted current-run state.

---

## Design Direction

Use `DESIGN.md` as a style reference, not as a layout source. The `/result` layout must follow `tasks/main-redesign/spec.md`.

Concrete visual rules for implementation:

- Page canvas: white `#ffffff`.
- Primary text and primary CTA: near-black `#111111`.
- Secondary text: `#374151` and `#6b7280`.
- Cards: light gray `#f5f5f5` or white with `#e5e7eb` hairline border.
- Buttons: 40px height, 8px radius, Inter-style 14px / 600.
- Cards: 12px radius, 24px to 32px padding.
- Main content width: 1200px centered.
- Result UI should feel like a quiet SaaS dashboard, not a marketing landing page.
- Preserve spec semantic colors for data: support green, oppose red, neutral gray, warning yellow, reframe purple, accent blue.

Implementation CSS variables to add:

```css
:root {
  --result-canvas: #ffffff;
  --result-ink: #111111;
  --result-body: #374151;
  --result-muted: #6b7280;
  --result-hairline: #e5e7eb;
  --result-soft: #f8f9fa;
  --result-card: #f5f5f5;
  --result-primary: #111111;
  --result-on-primary: #ffffff;
  --support: #10b981;
  --oppose: #ef4444;
  --neutral: #9ca3af;
  --warn: #f59e0b;
  --reframe: #8b5cf6;
  --accent: #3b82f6;
}
```

Do not add large gradient/orb decoration. Do not create a landing-page hero. The first screen should be the actual result board.

---

## File Structure

Create or modify these files:

- Modify: `backend/app/services/llm_client.py`
  - Expand summary prompt schema.
  - Preserve new summary fields.
  - Add `normalize_summary(parsed, responses, refill_missing=None)`.
  - Add one-shot summary field refill payload/call for missing `short_label` and `short_title`.
  - Add new `failed_summary` field defaults.
- Modify: `backend/app/api/simulate.py`
  - Call `normalize_summary` before merging LLM summary into aggregate.
  - Keep existing SSE stream and heartbeat event structure.
- Modify: `backend/tests/test_llm_and_api.py`
  - Backend TDD tests for summary schema, parser, normalizer, and aggregate SSE payload.
- Modify: `frontend/package.json`
  - Add `zustand` only if the implementation chooses spec-exact persisted store. If dependency install is blocked, use the fallback local store described in Task 4.
- Modify: `frontend/src/lib/api.ts`
  - Add summary cluster fields to TypeScript types.
- Modify: `frontend/src/lib/api.test.ts`
  - Type-level and event parsing checks for new fields.
- Create: `frontend/src/lib/resultHelpers.ts`
  - Labels, counts, tick helpers, deterministic jitter, badge placement, short region.
- Create: `frontend/src/lib/resultHelpers.test.ts`
  - Unit tests for helpers.
- Create: `frontend/src/lib/currentRunStore.ts`
  - Persist latest completed run to `sessionStorage`.
  - Store `draftRequest` so `/result` header actions can refill `/` or `/experiment` forms without auto-running.
- Create: `frontend/src/lib/currentRunStore.test.ts`
  - Store serialization and restore tests.
- Create: `frontend/src/result/ResultPage.tsx`
  - `ResultPage`, `ResultHeader`, `Hero`, `OpinionMap`, `DemographicBars`, `BlindSpotGrid`, `ReframingList`.
- Create: `frontend/src/result/ResultPage.test.tsx`
  - Render-to-static-markup tests using `react-dom/server`.
- Create: `frontend/src/result/result.css`
  - Cal-inspired result page styles.
- Modify: `frontend/src/App.tsx`
  - Add `"result"` page state.
  - Persist current run when simulation completes.
  - Add "결과 보기 ->" button after completion.
  - Route `/result` to `ResultPage`.
  - Do not alter `/experiment` behavior except shared type compatibility.
- Modify: `frontend/src/App.css`
  - Import or leave global base untouched. Prefer importing `./result/result.css` from `ResultPage.tsx`.

---

## Task 1: Backend Summary Schema Contract

**Files:**
- Modify: `backend/tests/test_llm_and_api.py`
- Modify: `backend/app/services/llm_client.py`

- [ ] **Step 1: Write failing tests for summary prompt and parser**

Add these tests near the existing summary tests in `backend/tests/test_llm_and_api.py`:

```python
def test_summary_prompt_requests_result_page_short_fields_and_agent_ids():
    payload = build_summary_llm_payload(
        "정책",
        [
            {
                "agent_id": 9,
                "age_group": "50s",
                "gender": "female",
                "region_group": "capital",
                "stance": "oppose",
                "rationale": "생활비가 걱정됩니다.",
                "blind_spot": "야간근무자는 안내 시간을 맞추기 어렵습니다.",
                "affected_group": "야간근무 보호자",
            }
        ],
    )
    full_prompt = "\n".join(message["content"] for message in payload["messages"])

    assert "short_label" in full_prompt
    assert "short_title" in full_prompt
    assert "agent_ids" in full_prompt
    assert "응답자 9" in full_prompt
    assert "새 id를 만들거나 추측하지 마세요" in full_prompt
    assert "1명만 짚은 사각지대는 그대로 단일 cluster" in full_prompt


def test_summary_from_text_preserves_result_page_fields():
    raw_output = json.dumps(
        {
            "headline": "사각지대가 일부 확인됨",
            "concern_clusters": [
                {
                    "label": "생활비 부담을 우려함",
                    "short_label": "생활비 부담",
                    "count": 3,
                    "examples": ["부담됩니다."],
                }
            ],
            "support_clusters": [
                {
                    "label": "교육활동 보장을 지지함",
                    "short_label": "활동 보장",
                    "count": 2,
                    "examples": ["필요합니다."],
                }
            ],
            "blind_spot_clusters": [
                {
                    "affected_group": "야간근무 보호자",
                    "short_title": "야간근무 보호자",
                    "count": 1,
                    "blind_spot_examples": ["(응답자 9) 안내 시간을 맞추기 어렵습니다."],
                    "agent_ids": [9],
                }
            ],
        },
        ensure_ascii=False,
    )

    summary = summary_from_text(raw_output)

    assert summary["headline"] == "사각지대가 일부 확인됨"
    assert summary["concern_clusters"][0]["short_label"] == "생활비 부담"
    assert summary["support_clusters"][0]["short_label"] == "활동 보장"
    assert summary["blind_spot_clusters"][0]["short_title"] == "야간근무 보호자"
    assert summary["blind_spot_clusters"][0]["agent_ids"] == [9]
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
cd backend
python -m pytest tests/test_llm_and_api.py::test_summary_prompt_requests_result_page_short_fields_and_agent_ids tests/test_llm_and_api.py::test_summary_from_text_preserves_result_page_fields -q
```

Expected:

```text
FAILED ... short_label ...
FAILED ... KeyError: 'headline'
```

- [ ] **Step 3: Implement summary prompt expansion**

In `backend/app/services/llm_client.py`, replace `build_summary_llm_payload` response formatting with text that gives the summary LLM response rows with stable ids.

Implementation shape:

```python
def format_summary_response_row(response: dict) -> str:
    agent_id = response.get("agent_id", "")
    return "\n".join(
        [
            f"응답자 {agent_id} ({response.get('age_group', '')} {response.get('gender', '')} {response.get('region_group', '')}):",
            f"  입장: {response.get('stance', '')}",
            f"  이유: {response.get('rationale', '')}",
            f"  유보점: {response.get('caveat') or 'null'}",
            f"  사각지대: {response.get('blind_spot') or 'null'}",
            f"  피해 집단: {response.get('affected_group') or 'null'}",
            f"  반문: {response.get('reframing') or 'null'}",
        ]
    )
```

Then build the user prompt with:

```python
responses_text = "\n\n".join(format_summary_response_row(response) for response in responses)
```

The schema string must include:

```text
{
  "headline": "string or null",
  "concern_clusters": [{"label":"string","short_label":"string","count":1,"examples":["string"]}],
  "support_clusters": [{"label":"string","short_label":"string","count":1,"examples":["string"]}],
  "blind_spot_clusters": [{"affected_group":"string","short_title":"string","count":1,"blind_spot_examples":["string"],"agent_ids":[0]}]
}
```

The system prompt must include the spec rules:

```text
examples와 agent_ids에는 위 '응답자 N' 표기에서 N을 그대로 사용하세요. 새 id를 만들거나 추측하지 마세요.
1명만 짚은 사각지대는 그대로 단일 cluster로 두세요 (count=1).
비슷해 보이지만 affected_group이나 인과 경로가 다른 사각지대는 강제로 합치지 마세요.
```

- [ ] **Step 4: Preserve new fields in `summary_from_text`**

Update `summary_from_text` to return `headline` and explicitly preserve result-page cluster fields. Add these helpers near `summary_from_text`:

```python
def normalize_summary_cluster_item(item: Any) -> dict | None:
    if not isinstance(item, dict):
        return None
    return {
        "label": str(item.get("label") or "").strip(),
        "short_label": str(item.get("short_label") or "").strip(),
        "count": max(0, int(item.get("count") or 0)),
        "examples": item.get("examples") if isinstance(item.get("examples"), list) else [],
    }


def normalize_blind_spot_cluster_item(item: Any) -> dict | None:
    if not isinstance(item, dict):
        return None
    raw_agent_ids = item.get("agent_ids")
    agent_ids = [int(agent_id) for agent_id in raw_agent_ids if str(agent_id).isdigit()] if isinstance(raw_agent_ids, list) else []
    return {
        "affected_group": str(item.get("affected_group") or "").strip(),
        "short_title": str(item.get("short_title") or "").strip(),
        "count": max(0, int(item.get("count") or 0)),
        "blind_spot_examples": item.get("blind_spot_examples") if isinstance(item.get("blind_spot_examples"), list) else [],
        "agent_ids": agent_ids,
    }
```

Then update `summary_from_text` so the parsed lists are converted through those helpers:

```python
concern_clusters = [
    cluster
    for cluster in (normalize_summary_cluster_item(item) for item in concerns)
    if cluster is not None
] if isinstance(concerns, list) else []
support_clusters = [
    cluster
    for cluster in (normalize_summary_cluster_item(item) for item in support)
    if cluster is not None
] if isinstance(support, list) else []
blind_spot_clusters = [
    cluster
    for cluster in (normalize_blind_spot_cluster_item(item) for item in blind_spots)
    if cluster is not None
] if isinstance(blind_spots, list) else []
```

Also return `headline`:

```python
headline = parsed.get("headline")
if not isinstance(headline, str):
    headline = None
```

Return:

```python
return {
    "status": "completed" if has_clusters else "empty",
    "message": "요약이 생성되었습니다." if has_clusters else "요약 모델이 빈 cluster 배열을 반환했습니다.",
    "headline": headline,
    "concern_clusters": concern_clusters,
    "support_clusters": support_clusters,
    "blind_spot_clusters": blind_spot_clusters,
    "raw_output": raw_output,
}
```

- [ ] **Step 5: Run targeted tests**

Run:

```powershell
cd backend
python -m pytest tests/test_llm_and_api.py::test_summary_prompt_requests_result_page_short_fields_and_agent_ids tests/test_llm_and_api.py::test_summary_from_text_preserves_result_page_fields -q
```

Expected:

```text
2 passed
```

- [ ] **Step 6: Commit**

```powershell
git add backend/app/services/llm_client.py backend/tests/test_llm_and_api.py
git commit -m "feat: expand summary schema for result page"
```

---

## Task 2: Backend Summary Normalization

**Files:**
- Modify: `backend/tests/test_llm_and_api.py`
- Modify: `backend/app/services/llm_client.py`
- Modify: `backend/app/api/simulate.py`

- [ ] **Step 1: Write failing tests for normalizer**

Add imports:

```python
from app.services.llm_client import normalize_summary
```

Add tests:

```python
def test_normalize_summary_fills_missing_short_labels_and_titles():
    summary = {
        "status": "completed",
        "message": "ok",
        "concern_clusters": [{"label": "생활비 부담이 커진다는 우려", "count": 2, "examples": []}],
        "support_clusters": [{"label": "아이들 활동 보장을 지지", "count": 1, "examples": []}],
        "blind_spot_clusters": [
            {
                "affected_group": "야간근무 보호자",
                "count": 1,
                "blind_spot_examples": ["(응답자 7) 낮 시간 안내를 챙기기 어렵습니다."],
            }
        ],
    }
    responses = [{"agent_id": 7, "blind_spot": "낮 시간 안내를 챙기기 어렵습니다."}]

    normalized = normalize_summary(summary, responses)

    assert normalized["concern_clusters"][0]["short_label"] == "생활비 부담"
    assert normalized["support_clusters"][0]["short_label"] == "아이들 활동"
    assert normalized["blind_spot_clusters"][0]["short_title"] == "야간근무 보호자"
    assert normalized["blind_spot_clusters"][0]["agent_ids"] == [7]


def test_normalize_summary_removes_unknown_agent_ids_and_corrects_count():
    summary = {
        "status": "completed",
        "message": "ok",
        "concern_clusters": [],
        "support_clusters": [],
        "blind_spot_clusters": [
            {
                "affected_group": "맞벌이 가구",
                "short_title": "맞벌이 가구",
                "count": 1,
                "blind_spot_examples": ["(응답자 1) 일정 조정이 어렵습니다.", "(응답자 2) 돌봄 공백이 생깁니다."],
                "agent_ids": [1, 2, 999],
            }
        ],
    }
    responses = [{"agent_id": 1}, {"agent_id": 2}]

    normalized = normalize_summary(summary, responses)

    assert normalized["blind_spot_clusters"][0]["agent_ids"] == [1, 2]
    assert normalized["blind_spot_clusters"][0]["count"] == 2


def test_normalize_summary_uses_refill_callback_before_fallback():
    summary = {
        "status": "completed",
        "message": "ok",
        "concern_clusters": [{"label": "생활비 부담이 커진다는 우려", "count": 1, "examples": []}],
        "support_clusters": [],
        "blind_spot_clusters": [
            {
                "affected_group": "야간근무 보호자",
                "count": 1,
                "blind_spot_examples": ["(응답자 7) 낮 시간 안내를 챙기기 어렵습니다."],
            }
        ],
    }

    def refill_missing(missing_summary):
        assert missing_summary["concern_clusters"][0]["label"] == "생활비 부담이 커진다는 우려"
        return {
            "concern_clusters": [{"label": "생활비 부담이 커진다는 우려", "short_label": "생활비 부담"}],
            "blind_spot_clusters": [{"affected_group": "야간근무 보호자", "short_title": "야간 보호자"}],
        }

    normalized = normalize_summary(summary, [{"agent_id": 7}], refill_missing=refill_missing)

    assert normalized["concern_clusters"][0]["short_label"] == "생활비 부담"
    assert normalized["blind_spot_clusters"][0]["short_title"] == "야간 보호자"
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
cd backend
python -m pytest tests/test_llm_and_api.py::test_normalize_summary_fills_missing_short_labels_and_titles tests/test_llm_and_api.py::test_normalize_summary_removes_unknown_agent_ids_and_corrects_count -q
```

Expected:

```text
ImportError: cannot import name 'normalize_summary'
```

- [ ] **Step 3: Implement `normalize_summary`**

Add helpers in `backend/app/services/llm_client.py`:

```python
import re
```

```python
def compact_korean_label(value: str, limit: int) -> str:
    cleaned = " ".join(str(value).split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rstrip()


def extract_agent_ids_from_examples(examples: list) -> list[int]:
    ids: list[int] = []
    for example in examples:
        if not isinstance(example, str):
            continue
        for match in re.findall(r"응답자\s*(\d+)", example):
            ids.append(int(match))
    return sorted(set(ids))
```

Then add:

```python
def apply_refilled_summary_fields(summary: dict, refill: dict) -> None:
    for key, field in (("concern_clusters", "short_label"), ("support_clusters", "short_label")):
        refill_items = refill.get(key, [])
        if not isinstance(refill_items, list):
            continue
        by_label = {
            str(item.get("label") or ""): str(item.get(field) or "").strip()
            for item in refill_items
            if isinstance(item, dict)
        }
        for cluster in summary.get(key, []):
            if isinstance(cluster, dict) and not str(cluster.get(field) or "").strip():
                next_value = by_label.get(str(cluster.get("label") or ""))
                if next_value:
                    cluster[field] = next_value

    refill_blind_spots = refill.get("blind_spot_clusters", [])
    if isinstance(refill_blind_spots, list):
        by_group = {
            str(item.get("affected_group") or ""): str(item.get("short_title") or "").strip()
            for item in refill_blind_spots
            if isinstance(item, dict)
        }
        for cluster in summary.get("blind_spot_clusters", []):
            if isinstance(cluster, dict) and not str(cluster.get("short_title") or "").strip():
                next_value = by_group.get(str(cluster.get("affected_group") or ""))
                if next_value:
                    cluster["short_title"] = next_value


def normalize_summary(summary: dict, responses: list[dict], refill_missing=None) -> dict:
    actual_ids = {int(response["agent_id"]) for response in responses if "agent_id" in response}
    normalized = dict(summary)

    missing_for_refill = {
        "concern_clusters": [
            cluster
            for cluster in normalized.get("concern_clusters", [])
            if isinstance(cluster, dict) and not str(cluster.get("short_label") or "").strip()
        ],
        "support_clusters": [
            cluster
            for cluster in normalized.get("support_clusters", [])
            if isinstance(cluster, dict) and not str(cluster.get("short_label") or "").strip()
        ],
        "blind_spot_clusters": [
            cluster
            for cluster in normalized.get("blind_spot_clusters", [])
            if isinstance(cluster, dict) and not str(cluster.get("short_title") or "").strip()
        ],
    }
    if refill_missing and any(missing_for_refill.values()):
        refill = refill_missing(missing_for_refill)
        if isinstance(refill, dict):
            apply_refilled_summary_fields(normalized, refill)

    for key in ("concern_clusters", "support_clusters"):
        clusters = normalized.get(key, [])
        if not isinstance(clusters, list):
            clusters = []
        for cluster in clusters:
            if not isinstance(cluster, dict):
                continue
            label = cluster.get("label", "")
            if not isinstance(cluster.get("short_label"), str) or not cluster.get("short_label", "").strip():
                cluster["short_label"] = compact_korean_label(str(label), 10)
                cluster["excluded_from_map"] = True
            cluster["count"] = max(0, int(cluster.get("count") or 0))
        normalized[key] = clusters

    blind_spots = normalized.get("blind_spot_clusters", [])
    if not isinstance(blind_spots, list):
        blind_spots = []
    for cluster in blind_spots:
        if not isinstance(cluster, dict):
            continue
        affected_group = str(cluster.get("affected_group") or "").strip()
        if not isinstance(cluster.get("short_title"), str) or not cluster.get("short_title", "").strip():
            cluster["short_title"] = compact_korean_label(affected_group, 14)
            cluster["title_fallback"] = True

        raw_ids = cluster.get("agent_ids")
        if not isinstance(raw_ids, list):
            raw_ids = extract_agent_ids_from_examples(cluster.get("blind_spot_examples", []))
        clean_ids = sorted({int(agent_id) for agent_id in raw_ids if str(agent_id).isdigit() and int(agent_id) in actual_ids})
        cluster["agent_ids"] = clean_ids
        reported_count = max(0, int(cluster.get("count") or 0))
        cluster["count"] = max(reported_count, len(clean_ids))
    normalized["blind_spot_clusters"] = blind_spots
    return normalized
```

- [ ] **Step 4: Apply normalizer in SSE aggregate path**

In `backend/app/services/llm_client.py`, add a one-shot refill helper that can be called only when the summary omitted `short_label` or `short_title`:

```python
def build_summary_field_refill_payload(missing_summary: dict, model_name: str | None = None) -> dict:
    return {
        "model": model_name or ollama_model(),
        "format": "json",
        "messages": [
            {
                "role": "system",
                "content": (
                    "Fill only missing short display fields for Korean policy summary clusters. "
                    "Return only JSON. Do not add new clusters. Keep label and affected_group unchanged."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "missing": missing_summary,
                        "return_schema": {
                            "concern_clusters": [{"label": "string", "short_label": "string"}],
                            "support_clusters": [{"label": "string", "short_label": "string"}],
                            "blind_spot_clusters": [{"affected_group": "string", "short_title": "string"}],
                        },
                    },
                    ensure_ascii=False,
                ),
            },
        ],
        "options": summarize_options(),
        "think": False,
    }
```

Then add `refill_summary_short_fields(...)` with one non-streaming model call. For OpenAI, use `response_format={"type": "json_object"}` and parse with `parse_json_object`; for Ollama, call `client.chat(..., stream=False)`.

In `backend/app/api/simulate.py`, after summary final event is received and before aggregate fields are assigned, normalize the summary with one refill callback:

```python
summary = normalize_summary(
    summary,
    responses,
    refill_missing=lambda missing: refill_summary_short_fields(
        policy,
        missing,
        model_name=req.model_name,
        model_provider=req.model_provider,
        thinking=req.thinking,
    ),
)
```

Add the import:

```python
from app.services.llm_client import normalize_summary, refill_summary_short_fields
```

If `simulate.py` already imports multiple functions from `llm_client`, add both names to that import list. Do not emit additional SSE events for this refill call; it is a backend normalization step after summary completion and keeps the existing external SSE event/heartbeat names unchanged.

- [ ] **Step 5: Update `failed_summary` defaults**

In `backend/app/services/llm_client.py`, make `failed_summary` return:

```python
"headline": None,
"concern_clusters": [],
"support_clusters": [],
"blind_spot_clusters": [],
```

The empty arrays are enough because item-level defaults are only needed when items exist.

- [ ] **Step 6: Run targeted backend tests**

Run:

```powershell
cd backend
python -m pytest tests/test_llm_and_api.py::test_normalize_summary_fills_missing_short_labels_and_titles tests/test_llm_and_api.py::test_normalize_summary_removes_unknown_agent_ids_and_corrects_count tests/test_llm_and_api.py::test_normalize_summary_uses_refill_callback_before_fallback tests/test_llm_and_api.py::test_simulate_stream_includes_blind_spot_fields_in_response_and_aggregate -q
```

Expected:

```text
4 passed
```

- [ ] **Step 6b: Strengthen SSE aggregate assertion**

In existing `test_simulate_stream_includes_blind_spot_fields_in_response_and_aggregate`, make the mocked summary omit `short_title` and `agent_ids` but include `"(응답자 N)"` in `blind_spot_examples`. Add assertions that the SSE aggregate contains normalized fields:

```python
assert aggregate_payloads[-1]["blind_spot_clusters"][0]["short_title"]
assert aggregate_payloads[-1]["blind_spot_clusters"][0]["agent_ids"]
```

This prevents forgetting the `simulate.py` `normalize_summary(...)` call.

- [ ] **Step 7: Commit**

```powershell
git add backend/app/services/llm_client.py backend/app/api/simulate.py backend/tests/test_llm_and_api.py
git commit -m "feat: normalize result summary clusters"
```

---

## Task 3: Frontend API Types

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/api.test.ts`

- [ ] **Step 1: Write failing type test**

Update the aggregate in `frontend/src/lib/api.test.ts` so `concern_clusters`, `support_clusters`, and `blind_spot_clusters` include the new required fields:

```typescript
const aggregate = {
  total: { support: 0, oppose: 1, neutral: 0 },
  by_age: {},
  by_gender: {},
  by_region: {},
  concern_clusters: [
    { label: "생활비 부담", short_label: "생활비 부담", count: 1, examples: ["부담"] },
  ],
  support_clusters: [
    { label: "활동 보장", short_label: "활동 보장", count: 1, examples: ["필요"] },
  ],
  blind_spot_clusters: [
    {
      affected_group: "수도권 맞벌이 가구",
      short_title: "맞벌이 가구",
      count: 1,
      blind_spot_examples: ["월세 전환 때 보증금 흐름 불안"],
      agent_ids: [1],
    },
  ],
  reframing_list: [{ text: "전제 반문", age_group: "40s", gender: "female", region_group: "capital" }],
} satisfies import("./api").AggregateEvent
```

- [ ] **Step 2: Run TypeScript build and confirm failure**

Run:

```powershell
npm.cmd --prefix frontend run build
```

Expected:

```text
TypeScript error until api.ts includes short_label, short_title, agent_ids.
```

- [ ] **Step 3: Update API types**

In `frontend/src/lib/api.ts`, replace `Cluster` with:

```typescript
export type SupportCluster = {
  label: string
  short_label: string
  count: number
  examples: string[]
  excluded_from_map?: boolean
}

export type ConcernCluster = SupportCluster
```

Update `BlindSpotCluster`:

```typescript
export type BlindSpotCluster = {
  affected_group: string
  short_title: string
  count: number
  blind_spot_examples: string[]
  agent_ids: number[]
  title_fallback?: boolean
}
```

Update `AggregateEvent`:

```typescript
headline?: string | null
concern_clusters: ConcernCluster[]
support_clusters: SupportCluster[]
blind_spot_clusters: BlindSpotCluster[]
```

Keep `blind_spot_raw` optional.

If any local code still imports `Cluster`, keep a compatibility alias:

```typescript
export type Cluster = SupportCluster
```

- [ ] **Step 4: Run targeted test**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/lib/api.test.ts
npm.cmd --prefix frontend run build
```

Expected:

```text
PASS src/lib/api.test.ts
✓ built
```

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat: add result summary types"
```

---

## Task 4: Result Helpers

**Files:**
- Create: `frontend/src/lib/resultHelpers.ts`
- Create: `frontend/src/lib/resultHelpers.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `frontend/src/lib/resultHelpers.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import {
  ageGroupShort,
  genderShort,
  niceTickMax,
  placeOpinionBadges,
  regionGroupLabel,
  regionShort,
  seededJitter,
} from "./resultHelpers"

describe("resultHelpers", () => {
  it("formats demographic labels", () => {
    expect(ageGroupShort("20s")).toBe("20대")
    expect(ageGroupShort("70_plus")).toBe("70대+")
    expect(genderShort("female")).toBe("여")
    expect(regionGroupLabel("capital")).toBe("수도권")
  })

  it("shortens district names from sampled region", () => {
    expect(regionShort("서울-은평구", "capital")).toBe("은평구")
    expect(regionShort("경기-성남시 분당구", "capital")).toBe("성남시")
    expect(regionShort("형식없음", "honam")).toBe("호남")
  })

  it("calculates nice y axis maximum", () => {
    expect(niceTickMax(5)).toBe(5)
    expect(niceTickMax(6)).toBe(10)
    expect(niceTickMax(21)).toBe(30)
    expect(niceTickMax(101)).toBe(150)
  })

  it("returns deterministic jitter", () => {
    expect(seededJitter("생활비 부담")).toBe(seededJitter("생활비 부담"))
    expect(seededJitter("생활비 부담")).toBeGreaterThanOrEqual(-1)
    expect(seededJitter("생활비 부담")).toBeLessThanOrEqual(1)
  })

  it("places same-side opinion badges without exact overlap", () => {
    const badges = placeOpinionBadges(
      [
        { label: "a", short_label: "a", count: 3, examples: [] },
        { label: "b", short_label: "b", count: 3, examples: [] },
        { label: "c", short_label: "c", count: 3, examples: [] },
      ],
      "support",
      10,
    )

    expect(new Set(badges.map((badge) => `${badge.x.toFixed(1)}-${badge.y.toFixed(1)}`)).size).toBe(3)
    expect(badges.every((badge) => badge.x < 50)).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/lib/resultHelpers.test.ts
```

Expected:

```text
Failed to resolve import "./resultHelpers"
```

- [ ] **Step 3: Implement helpers**

Create `frontend/src/lib/resultHelpers.ts` with:

```typescript
import type { AgeGroup, Gender, RegionGroup, SupportCluster } from "./api"

export function ageGroupShort(ageGroup: AgeGroup | string): string {
  const labels: Record<string, string> = {
    "20s": "20대",
    "30s": "30대",
    "40s": "40대",
    "50s": "50대",
    "60s": "60대",
    "70_plus": "70대+",
  }
  return labels[ageGroup] ?? String(ageGroup)
}

export function genderShort(gender: Gender | string): string {
  const labels: Record<string, string> = { male: "남", female: "여", unknown: "미상" }
  return labels[gender] ?? String(gender)
}

export function regionGroupLabel(regionGroup: RegionGroup | string): string {
  const labels: Record<string, string> = {
    capital: "수도권",
    yeongnam: "영남",
    honam: "호남",
    chungcheong: "충청",
    gangwon: "강원",
    jeju: "제주",
    other: "기타",
  }
  return labels[regionGroup] ?? String(regionGroup)
}

export function regionShort(region: string, regionGroup: RegionGroup | string): string {
  const dash = region.indexOf("-")
  if (dash < 0) return regionGroupLabel(regionGroup)
  const tail = region.slice(dash + 1).trim()
  const space = tail.indexOf(" ")
  return space < 0 ? tail : tail.slice(0, space)
}

export function niceTickMax(n: number): number {
  if (n <= 5) return 5
  if (n <= 10) return 10
  if (n <= 20) return 20
  if (n <= 30) return 30
  if (n <= 50) return 50
  if (n <= 100) return 100
  return Math.ceil(n / 50) * 50
}

export function seededJitter(value: string): number {
  let hash = 2166136261
  for (const char of value) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return ((Math.abs(hash) % 2001) - 1000) / 1000
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export type PlacedOpinionBadge = SupportCluster & {
  side: "support" | "concern"
  x: number
  y: number
  sizeClass: "sz-1" | "sz-2" | "sz-3" | "sz-5"
}

function sizeClass(count: number): PlacedOpinionBadge["sizeClass"] {
  if (count <= 1) return "sz-1"
  if (count === 2) return "sz-2"
  if (count <= 4) return "sz-3"
  return "sz-5"
}

export function placeOpinionBadges(
  clusters: SupportCluster[],
  side: "support" | "concern",
  yMax: number,
): PlacedOpinionBadge[] {
  const placed: PlacedOpinionBadge[] = []
  const center = side === "support" ? 25 : 75
  for (const cluster of clusters.filter((item) => !item.excluded_from_map)) {
    const y = (1 - Math.min(cluster.count, yMax) / yMax) * 88 + 8
    let radius = 18
    let jitter = seededJitter(cluster.label || cluster.short_label)
    let x = center + radius * jitter
    while (
      placed.some((badge) => Math.abs(badge.y - y) <= 3 && Math.abs(badge.x - x) < 22) &&
      radius <= 28
    ) {
      radius += 4
      jitter = jitter === 0 ? 0.5 : -jitter * 1.2
      x = center + radius * jitter
    }
    x = side === "support" ? clamp(x, 5, 45) : clamp(x, 55, 95)
    placed.push({ ...cluster, side, x, y, sizeClass: sizeClass(cluster.count) })
  }
  return placed
}
```

- [ ] **Step 4: Run helper tests**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/lib/resultHelpers.test.ts
```

Expected:

```text
PASS src/lib/resultHelpers.test.ts
```

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/lib/resultHelpers.ts frontend/src/lib/resultHelpers.test.ts
git commit -m "feat: add result page helpers"
```

---

## Task 5: Current Run Store and Route Wiring

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/lib/currentRunStore.ts`
- Create: `frontend/src/lib/currentRunStore.test.ts`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Install `zustand`**

Run:

```powershell
npm.cmd --prefix frontend install zustand
```

Expected:

```text
added ... zustand
```

`zustand + persist` is required by `tasks/main-redesign/spec.md`; do not replace it with a custom store unless the spec is explicitly changed.

- [ ] **Step 2: Write failing store tests**

Create `frontend/src/lib/currentRunStore.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest"
import { clearCurrentRun, getCurrentRunSnapshot, saveCurrentRun } from "./currentRunStore"

beforeEach(() => {
  sessionStorage.clear()
  clearCurrentRun()
})

describe("currentRunStore", () => {
  it("saves and restores the latest completed run", () => {
    saveCurrentRun({
      policy: "정책",
      n_agents: 5,
      model_name: "qwen3.5:9b",
      model_provider: "ollama",
      aggregate: {
        total: { support: 1, oppose: 0, neutral: 0 },
        by_age: {},
        by_gender: {},
        by_region: {},
        concern_clusters: [],
        support_clusters: [],
        blind_spot_clusters: [],
        reframing_list: [],
      },
      sampledAgents: [],
      completedAt: "2026-05-30T00:00:00.000Z",
    })

    expect(getCurrentRunSnapshot()?.policy).toBe("정책")
    expect(sessionStorage.getItem("koreansim-current-run")).toContain("정책")
  })
})
```

- [ ] **Step 3: Run test and confirm failure**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/lib/currentRunStore.test.ts
```

Expected:

```text
Failed to resolve import "./currentRunStore"
```

- [ ] **Step 4: Implement store**

Create `frontend/src/lib/currentRunStore.ts`.

Preferred zustand implementation:

```typescript
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"
import type { AgentSampledEvent, AggregateEvent, SimulateRequest } from "./api"

export type CurrentRun = {
  policy: string
  n_agents: number
  model_name: string
  model_provider: "ollama" | "openai"
  aggregate: AggregateEvent
  sampledAgents: AgentSampledEvent[]
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

export function clearCurrentRun() {
  useCurrentRunStore.getState().clearCurrentRun()
}

export function getCurrentRunSnapshot() {
  return useCurrentRunStore.getState().currentRun
}
```

- [ ] **Step 5: Wire `/result` route and save completed runs**

In `frontend/src/App.tsx`:

1. Update page type:

```typescript
type Page = "simulate" | "experiment" | "result"
```

2. Import store helpers and result page:

```typescript
import { ResultPage } from "./result/ResultPage"
import { saveCurrentRun, useCurrentRunStore } from "./lib/currentRunStore"
```

3. Add defaults for current main simulation model and capture actual run inputs at function start:

```typescript
const DEFAULT_MODEL_PROVIDER = "ollama" as const
const DEFAULT_MODEL_NAME = "qwen3.5:9b"
```

At the start of `runSimulation`, after `const trimmed = policy.trim()`, capture stable local values:

```typescript
const requestedAgents = nAgents
const modelProvider = DEFAULT_MODEL_PROVIDER
const modelName = health?.ollama_model || DEFAULT_MODEL_NAME
const sampledForRun: AgentSampledEvent[] = []
```

Then use `requestedAgents` in the simulate request:

```typescript
for await (const event of simulate({ policy: trimmed, n_agents: requestedAgents }, controller.signal)) {
```

4. While streaming, keep a local sampled-agent list and persist the latest run when the aggregate event arrives:

```typescript
} else if (event.type === "agent_sampled") {
  sampledForRun.push(event.data)
  setSampled((prev) => [...prev, event.data])
} else if (event.type === "aggregate") {
  setAggregate(event.data)
  saveCurrentRun({
    policy: trimmed,
    n_agents: requestedAgents,
    model_name: modelName,
    model_provider: modelProvider,
    aggregate: event.data,
    sampledAgents: sampledForRun.slice(),
    completedAt: new Date().toISOString(),
  })
}
```

Also save the draft request whenever a current run is saved:

```typescript
useCurrentRunStore.getState().setDraftRequest({
  policy: trimmed,
  n_agents: requestedAgents,
  model_provider: modelProvider,
  model_name: modelName,
})
```

Do not read `sampled` React state inside the aggregate handler; it can be stale because `setSampled` is asynchronous.

5. Update navigation:

```typescript
function navigatePage(nextPage: Page) {
  const nextPath = nextPage === "experiment" ? "/experiment" : nextPage === "result" ? "/result" : "/"
  window.history.pushState(null, "", nextPath)
  setPage(nextPage)
}
```

6. Update `pageFromLocation`:

```typescript
function pageFromLocation(): Page {
  if (window.location.pathname === "/experiment") return "experiment"
  if (window.location.pathname === "/result") return "result"
  return "simulate"
}
```

7. Render result page:

```tsx
{page === "result" ? (
  <ResultPage
    onDebug={() => navigatePage("simulate")}
    onExperiment={() => navigatePage("experiment")}
    onRerun={() => navigatePage("simulate")}
  />
) : page === "experiment" ? (
  <ExperimentPage health={health} />
) : (
  <>
    {/* existing simulate page */}
  </>
)}
```

8. Add "결과 보기 ->" inside the existing simulate page `.button-group`, immediately after the "초기화" button:

```tsx
<button type="button" className="secondary-button" disabled={phase !== "done" || !aggregate} onClick={() => navigatePage("result")}>
  결과 보기 -&gt;
</button>
```

9. Refill `/` form from stored draft request when returning from `/result`:

```typescript
const draftRequest = useCurrentRunStore((state) => state.draftRequest)

useEffect(() => {
  if (page !== "simulate" || !draftRequest) return
  setPolicy(draftRequest.policy)
  setNAgents(draftRequest.n_agents)
}, [page, draftRequest])
```

- [ ] **Step 6: Run store test and app compile**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/lib/currentRunStore.test.ts
npm.cmd --prefix frontend run build
```

Expected:

```text
PASS src/lib/currentRunStore.test.ts
✓ built
```

- [ ] **Step 7: Commit**

```powershell
git add frontend/package.json frontend/package-lock.json frontend/src/lib/currentRunStore.ts frontend/src/lib/currentRunStore.test.ts frontend/src/App.tsx
git commit -m "feat: persist latest simulation result"
```

---

## Task 6: Result Page Shell, Header, and Hero

**Files:**
- Create: `frontend/src/result/ResultPage.tsx`
- Create: `frontend/src/result/ResultPage.test.tsx`
- Create: `frontend/src/result/result.css`

- [ ] **Step 1: Write failing render tests**

Create `frontend/src/result/ResultPage.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it } from "vitest"
import { clearCurrentRun, saveCurrentRun } from "../lib/currentRunStore"
import { ResultPage } from "./ResultPage"

beforeEach(() => {
  sessionStorage.clear()
  clearCurrentRun()
})

describe("ResultPage", () => {
  it("renders empty state when no current run exists", () => {
    const html = renderToStaticMarkup(<ResultPage onDebug={() => {}} onExperiment={() => {}} onRerun={() => {}} />)

    expect(html).toContain("/에서 먼저 실행하세요")
  })

  it("renders header and hero stats from current run", () => {
    saveCurrentRun({
      policy: "학교 교육활동 중 발생하는 소리는 생활소음에서 제외한다.",
      n_agents: 5,
      model_name: "qwen3.5:9b",
      model_provider: "ollama",
      completedAt: "2026-05-30T00:00:00.000Z",
      sampledAgents: [],
      aggregate: {
        total: { support: 3, oppose: 1, neutral: 1 },
        by_age: {},
        by_gender: {},
        by_region: {},
        concern_clusters: [],
        support_clusters: [],
        blind_spot_clusters: [{ affected_group: "야간근무 보호자", short_title: "야간근무 보호자", count: 1, blind_spot_examples: ["어렵다"], agent_ids: [] }],
        reframing_list: [{ text: "전제 반문", age_group: "40s", gender: "female", region_group: "capital" }],
      },
    })

    const html = renderToStaticMarkup(<ResultPage onDebug={() => {}} onExperiment={() => {}} onRerun={() => {}} />)

    expect(html).toContain("KoreanSim")
    expect(html).toContain("찬성")
    expect(html).toContain("3")
    expect(html).toContain("사각지대")
    expect(html).toContain("qwen3.5:9b")
  })
})
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/result/ResultPage.test.tsx
```

Expected:

```text
Failed to resolve import "./ResultPage"
```

- [ ] **Step 3: Implement `ResultPage`, `ResultHeader`, and `Hero`**

Create `frontend/src/result/ResultPage.tsx` with these exported and internal components:

```tsx
import "./result.css"
import { useMemo } from "react"
import type { AggregateEvent, StanceCounts } from "../lib/api"
import { useCurrentRunStore } from "../lib/currentRunStore"

type ResultPageProps = {
  onDebug: () => void
  onExperiment: () => void
  onRerun: () => void
}

export function ResultPage({ onDebug, onExperiment, onRerun }: ResultPageProps) {
  const currentRun = useCurrentRunStore((state) => state.currentRun)

  if (!currentRun) {
    return (
      <main className="result-shell">
        <section className="result-empty">
          <h1>/에서 먼저 실행하세요</h1>
          <button type="button" onClick={onDebug}>디버그로 이동</button>
        </section>
      </main>
    )
  }

  return (
    <main className="result-shell">
      <ResultHeader policy={currentRun.policy} onDebug={onDebug} onExperiment={onExperiment} onRerun={onRerun} />
      <Hero aggregate={currentRun.aggregate} nAgents={currentRun.n_agents} modelName={currentRun.model_name} />
    </main>
  )
}

function ResultHeader({
  policy,
  onDebug,
  onExperiment,
  onRerun,
}: {
  policy: string
  onDebug: () => void
  onExperiment: () => void
  onRerun: () => void
}) {
  return (
    <header className="result-header">
      <div className="result-header-left">
        <strong>KoreanSim</strong>
        <span className="result-policy-chip" title={policy}>{policy}</span>
      </div>
      <div className="result-header-actions">
        <button type="button" className="result-secondary-button" onClick={onExperiment}>실험으로 보내기 -&gt;</button>
        <button type="button" className="result-secondary-button" onClick={onDebug}>디버그</button>
        <button type="button" className="result-primary-button" onClick={onRerun}>재실행</button>
      </div>
    </header>
  )
}

function Hero({ aggregate, nAgents, modelName }: { aggregate: AggregateEvent; nAgents: number; modelName: string }) {
  const total = safeCounts(aggregate.total)
  const totalCount = Math.max(1, total.support + total.oppose + total.neutral)
  const segments = [
    { key: "support", label: "찬성", value: total.support, className: "support" },
    { key: "oppose", label: "반대", value: total.oppose, className: "oppose" },
    { key: "neutral", label: "중립", value: total.neutral, className: "neutral" },
  ]

  return (
    <section className="result-hero">
      <div className="result-hero-stats">
        {segments.map((segment) => (
          <div key={segment.key} className={`result-stat ${segment.className}`}>
            <strong>{segment.value}</strong>
            <span>{segment.label}</span>
          </div>
        ))}
        <div className="result-stat-divider" />
        <div className="result-stat blind"><strong>{aggregate.blind_spot_clusters.length}</strong><span>사각지대</span></div>
        <div className="result-stat reframe"><strong>{aggregate.reframing_list.length}</strong><span>반문</span></div>
        <div className="result-stat push accent"><strong>{nAgents}</strong><span>표본수</span></div>
        <div className="result-model-pill" title={modelName}>{modelName}</div>
      </div>
      <div className="result-stacked-bar" aria-label="찬반중립 비율">
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`result-segment ${segment.className}`}
            style={{ width: `${(segment.value / totalCount) * 100}%` }}
          />
        ))}
      </div>
    </section>
  )
}

function safeCounts(value: StanceCounts): StanceCounts {
  return {
    support: Number(value.support) || 0,
    oppose: Number(value.oppose) || 0,
    neutral: Number(value.neutral) || 0,
  }
}
```

- [ ] **Step 4: Add shell CSS**

Create `frontend/src/result/result.css` with:

```css
:root {
  --result-canvas: #ffffff;
  --result-ink: #111111;
  --result-body: #374151;
  --result-muted: #6b7280;
  --result-hairline: #e5e7eb;
  --result-soft: #f8f9fa;
  --result-card: #f5f5f5;
  --result-primary: #111111;
  --result-on-primary: #ffffff;
  --support: #10b981;
  --oppose: #ef4444;
  --neutral: #9ca3af;
  --warn: #f59e0b;
  --reframe: #8b5cf6;
  --accent: #3b82f6;
}

.result-shell {
  min-height: 100vh;
  background: var(--result-canvas, #ffffff);
  color: var(--result-ink, #111111);
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

.result-header {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-bottom: 1px solid var(--result-hairline, #e5e7eb);
}

.result-header-left,
.result-header-actions,
.result-hero-stats {
  display: flex;
  align-items: center;
  gap: 12px;
}

.result-policy-chip {
  max-width: 560px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--result-soft, #f8f9fa);
  color: var(--result-body, #374151);
  font-size: 13px;
}

.result-primary-button,
.result-secondary-button,
.result-empty button {
  min-height: 40px;
  border-radius: 8px;
  padding: 0 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.result-primary-button,
.result-empty button {
  border: 1px solid var(--result-primary, #111111);
  background: var(--result-primary, #111111);
  color: var(--result-on-primary, #ffffff);
}

.result-secondary-button {
  border: 1px solid var(--result-hairline, #e5e7eb);
  background: #ffffff;
  color: var(--result-ink, #111111);
}

.result-hero {
  margin-top: 24px;
  padding: 28px 32px;
  border: 1px solid var(--result-hairline, #e5e7eb);
  border-radius: 12px;
  background: var(--result-card, #f5f5f5);
}

.result-stat {
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.result-stat strong {
  font-size: 30px;
  line-height: 1;
}

.result-stat span,
.result-model-pill {
  color: var(--result-muted, #6b7280);
  font-size: 13px;
}

.result-model-pill {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border: 1px solid var(--result-hairline, #e5e7eb);
  border-radius: 999px;
  background: #ffffff;
  padding: 6px 10px;
}

.result-stat.support strong { color: var(--support, #10b981); }
.result-stat.oppose strong { color: var(--oppose, #ef4444); }
.result-stat.neutral strong { color: var(--neutral, #9ca3af); }
.result-stat.blind strong { color: var(--warn, #f59e0b); }
.result-stat.reframe strong { color: var(--reframe, #8b5cf6); }
.result-stat.accent strong { color: var(--accent, #3b82f6); }
.result-stat.push { margin-left: auto; }

.result-stat-divider {
  width: 1px;
  height: 32px;
  background: var(--result-hairline, #e5e7eb);
}

.result-stacked-bar {
  margin-top: 18px;
  display: flex;
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: #e5e7eb;
}

.result-segment.support { background: var(--support, #10b981); }
.result-segment.oppose { background: var(--oppose, #ef4444); }
.result-segment.neutral { background: var(--neutral, #9ca3af); }

.result-empty {
  min-height: 70vh;
  display: grid;
  place-content: center;
  gap: 16px;
  text-align: center;
}
```

- [ ] **Step 5: Run result page tests**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/result/ResultPage.test.tsx
```

Expected:

```text
PASS src/result/ResultPage.test.tsx
```

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/result/ResultPage.tsx frontend/src/result/ResultPage.test.tsx frontend/src/result/result.css
git commit -m "feat: add result page shell"
```

---

## Task 7: Opinion Map and Demographic Bars

**Files:**
- Modify: `frontend/src/result/ResultPage.tsx`
- Modify: `frontend/src/result/ResultPage.test.tsx`
- Modify: `frontend/src/result/result.css`

- [ ] **Step 1: Add failing render tests**

Extend `ResultPage.test.tsx` saved run aggregate:

```typescript
support_clusters: [{ label: "아이들 활동 보장", short_label: "활동 보장", count: 3, examples: ["필요"] }],
concern_clusters: [{ label: "주민 생활권 침해", short_label: "생활권 침해", count: 2, examples: ["불편"] }],
by_age: { "20s": { support: 2, oppose: 0, neutral: 0 }, "50s": { support: 1, oppose: 1, neutral: 0 } },
by_gender: { female: { support: 2, oppose: 1, neutral: 0 } },
by_region: { capital: { support: 2, oppose: 1, neutral: 0 } },
```

Add expectations:

```typescript
expect(html).toContain("의견 지형도")
expect(html).toContain("활동 보장")
expect(html).toContain("생활권 침해")
expect(html).toContain("인구 분포")
expect(html).toContain("20대")
expect(html).toContain("수도권")
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/result/ResultPage.test.tsx
```

Expected:

```text
AssertionError: expected ... to contain '의견 지형도'
```

- [ ] **Step 3: Implement `OpinionMap`**

In `ResultPage.tsx`, import helpers:

```typescript
import { ageGroupShort, genderShort, niceTickMax, placeOpinionBadges, regionGroupLabel } from "../lib/resultHelpers"
```

Add after `Hero`:

```tsx
<section className="result-grid">
  <OpinionMap aggregate={currentRun.aggregate} nAgents={currentRun.n_agents} />
  <DemographicBars aggregate={currentRun.aggregate} />
</section>
```

Add:

```tsx
function OpinionMap({ aggregate, nAgents }: { aggregate: AggregateEvent; nAgents: number }) {
  const clusters = [...aggregate.support_clusters, ...aggregate.concern_clusters]
  const maxClusterCount = Math.max(0, ...clusters.map((cluster) => cluster.count))
  const yMax = niceTickMax(Math.max(nAgents, maxClusterCount))
  const supportBadges = placeOpinionBadges(aggregate.support_clusters, "support", yMax)
  const concernBadges = placeOpinionBadges(aggregate.concern_clusters, "concern", yMax)
  const duplicateCount = clusters.reduce((sum, cluster) => sum + cluster.count, 0) > nAgents

  return (
    <section className="result-panel opinion-map">
      <h2>의견 지형도 <span>/{nAgents}명 기준</span></h2>
      <div className="opinion-plot">
        <span className="opinion-side-label support">찬성 측</span>
        <span className="opinion-side-label concern">반대 측</span>
        {aggregate.support_clusters.length === 0 && <span className="opinion-empty left">이번 실행에선 찬성 cluster 없음</span>}
        {aggregate.concern_clusters.length === 0 && <span className="opinion-empty right">이번 실행에선 반대 cluster 없음</span>}
        {[...supportBadges, ...concernBadges].map((badge) => (
          <span
            key={`${badge.side}-${badge.label}`}
            className={`opinion-badge ${badge.side} ${badge.sizeClass}`}
            style={{ left: `${badge.x}%`, top: `${badge.y}%` }}
            title={`${badge.label} · ${badge.count}명`}
          >
            {badge.short_label}<strong>{badge.count}</strong>
          </span>
        ))}
      </div>
      <p className="result-note">
        {duplicateCount ? "한 응답자가 여러 cluster에 카운트될 수 있음" : "cluster count는 stance count와 별도로 집계됨"}
      </p>
    </section>
  )
}
```

- [ ] **Step 4: Implement `DemographicBars`**

Add:

```tsx
type DemographicRow = { key: string; label: string; counts: StanceCounts }

function DemographicBars({ aggregate }: { aggregate: AggregateEvent }) {
  const ageRows = orderedRows(aggregate.by_age, ["20s", "30s", "40s", "50s", "60s", "70_plus"], ageGroupShort)
  const genderRows = orderedRows(aggregate.by_gender, ["male", "female"], (value) => (value === "male" ? "남성" : "여성"))
  const regionRows = Object.entries(aggregate.by_region)
    .map(([key, counts]) => ({ key, label: regionGroupLabel(key), counts }))
    .filter((row) => rowTotal(row.counts) > 0)
    .sort((a, b) => rowTotal(b.counts) - rowTotal(a.counts))
  const maxSide = Math.max(1, ...[...ageRows, ...genderRows, ...regionRows].flatMap((row) => [row.counts.support, row.counts.oppose]))

  return (
    <section className="result-panel demographic-bars">
      <h2>인구 분포</h2>
      <DBarSection title="연령" rows={ageRows} maxSide={maxSide} />
      <DBarSection title="성별" rows={genderRows} maxSide={maxSide} />
      <DBarSection title="지역" rows={regionRows} maxSide={maxSide} />
    </section>
  )
}

function orderedRows(
  data: Record<string, StanceCounts>,
  order: string[],
  labeler: (key: string) => string,
): DemographicRow[] {
  return order
    .map((key) => ({ key, label: labeler(key), counts: data[key] ?? { support: 0, oppose: 0, neutral: 0 } }))
    .filter((row) => rowTotal(row.counts) > 0)
}

function rowTotal(counts: StanceCounts) {
  return counts.support + counts.oppose + counts.neutral
}

function DBarSection({ title, rows, maxSide }: { title: string; rows: DemographicRow[]; maxSide: number }) {
  if (rows.length === 0) return null
  return (
    <div className="dbar-section">
      <h3>{title}</h3>
      {rows.map((row) => (
        <div key={row.key} className="dbar-row">
          <span className="dbar-label">{row.label}</span>
          <span className={row.counts.support ? "dbar-num support" : "dbar-num zero"}>{row.counts.support}</span>
          <span className="dbar-track">
            <span className="dbar-half left"><span className="dbar-fill support" style={{ width: `${(row.counts.support / maxSide) * 100}%` }} /></span>
            <span className="dbar-center" />
            <span className="dbar-half right"><span className="dbar-fill oppose" style={{ width: `${(row.counts.oppose / maxSide) * 100}%` }} /></span>
          </span>
          <span className={row.counts.oppose ? "dbar-num oppose" : "dbar-num zero"}>{row.counts.oppose}</span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Add CSS for map and bars**

Append to `result.css`:

```css
.result-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
  gap: 24px;
  margin-top: 24px;
}

.result-panel {
  border: 1px solid var(--result-hairline, #e5e7eb);
  border-radius: 12px;
  background: #ffffff;
  padding: 24px;
}

.result-panel h2 {
  margin: 0 0 18px;
  font-size: 18px;
  line-height: 1.3;
}

.result-panel h2 span,
.result-note {
  color: var(--result-muted, #6b7280);
  font-size: 13px;
  font-weight: 400;
}

.opinion-plot {
  position: relative;
  height: 360px;
  border-radius: 12px;
  background:
    linear-gradient(to right, transparent 49.9%, var(--result-hairline, #e5e7eb) 50%, transparent 50.1%),
    var(--result-soft, #f8f9fa);
  overflow: hidden;
}

.opinion-side-label,
.opinion-empty,
.opinion-badge {
  position: absolute;
}

.opinion-side-label {
  bottom: 12px;
  color: var(--result-muted, #6b7280);
  font-size: 12px;
}

.opinion-side-label.support { left: 25%; transform: translateX(-50%); }
.opinion-side-label.concern { left: 75%; transform: translateX(-50%); }
.opinion-empty { top: 50%; color: var(--result-muted, #6b7280); font-size: 13px; }
.opinion-empty.left { left: 16%; }
.opinion-empty.right { right: 16%; }

.opinion-badge {
  transform: translate(-50%, -50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  padding: 6px 10px;
  border: 1px solid currentColor;
  background: #ffffff;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.opinion-badge.support { color: var(--support, #10b981); }
.opinion-badge.concern { color: var(--oppose, #ef4444); }
.opinion-badge strong {
  display: inline-grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  border-radius: 999px;
  background: currentColor;
  color: #ffffff;
  font-size: 12px;
}
.opinion-badge.sz-1 { font-size: 12px; }
.opinion-badge.sz-2 { font-size: 13px; }
.opinion-badge.sz-3 { font-size: 14px; }
.opinion-badge.sz-5 { font-size: 15px; padding: 8px 12px; }

.dbar-section + .dbar-section { margin-top: 20px; }
.dbar-section h3 { margin: 0 0 10px; color: var(--result-muted, #6b7280); font-size: 13px; }
.dbar-row {
  display: grid;
  grid-template-columns: 64px 28px minmax(120px, 1fr) 28px;
  align-items: center;
  gap: 8px;
  min-height: 28px;
}
.dbar-label { font-size: 13px; color: var(--result-body, #374151); }
.dbar-num { font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; }
.dbar-num.support { color: var(--support, #10b981); text-align: right; }
.dbar-num.oppose { color: var(--oppose, #ef4444); }
.dbar-num.zero { color: var(--result-muted, #6b7280); opacity: 0.5; }
.dbar-track { display: grid; grid-template-columns: 1fr 1px 1fr; align-items: center; height: 16px; }
.dbar-center { height: 16px; background: var(--result-hairline, #e5e7eb); }
.dbar-half { display: flex; align-items: center; height: 100%; }
.dbar-half.left { justify-content: flex-end; }
.dbar-fill { height: 10px; border-radius: 3px; }
.dbar-fill.support { background: var(--support, #10b981); }
.dbar-fill.oppose { background: var(--oppose, #ef4444); }
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/result/ResultPage.test.tsx src/lib/resultHelpers.test.ts
```

Expected:

```text
PASS src/result/ResultPage.test.tsx
PASS src/lib/resultHelpers.test.ts
```

- [ ] **Step 7: Commit**

```powershell
git add frontend/src/result/ResultPage.tsx frontend/src/result/ResultPage.test.tsx frontend/src/result/result.css
git commit -m "feat: add result visual summaries"
```

---

## Task 8: Blind Spot Grid and Reframing List

**Files:**
- Modify: `frontend/src/result/ResultPage.tsx`
- Modify: `frontend/src/result/ResultPage.test.tsx`
- Modify: `frontend/src/result/result.css`

- [ ] **Step 1: Add failing tests**

Extend test fixture with:

```typescript
sampledAgents: [
  { agent_id: 7, age: 52, gender: "female", region: "서울-은평구", job: "간호조무사", age_group: "50s", region_group: "capital" },
],
blind_spot_clusters: [
  {
    affected_group: "야간근무 보호자",
    short_title: "야간근무 보호자",
    count: 1,
    blind_spot_examples: ["낮 시간 안내를 챙기기 어렵습니다."],
    agent_ids: [7],
  },
],
reframing_list: [{ text: "소음만 볼 게 아니라 아이들 활동권도 봐야 합니다.", age_group: "50s", gender: "female", region_group: "capital" }],
```

Add expectations:

```typescript
expect(html).toContain("사각지대")
expect(html).toContain("야간근무 보호자")
expect(html).toContain("50대 여 · 은평구")
expect(html).toContain("정책 전제 반문")
expect(html).toContain("아이들 활동권")
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/result/ResultPage.test.tsx
```

Expected:

```text
AssertionError: expected ... to contain '50대 여 · 은평구'
```

- [ ] **Step 3: Implement `BlindSpotGrid` and `ReframingList`**

In `ResultPage.tsx`, render below `.result-grid`:

```tsx
<BlindSpotGrid clusters={currentRun.aggregate.blind_spot_clusters} sampledAgents={currentRun.sampledAgents} />
<ReframingList items={currentRun.aggregate.reframing_list} />
```

Add:

```tsx
import type { AgentSampledEvent, BlindSpotCluster, ReframingItem } from "../lib/api"
import { ageGroupShort, genderShort, regionGroupLabel, regionShort } from "../lib/resultHelpers"
```

Then implement:

```tsx
function BlindSpotGrid({ clusters, sampledAgents }: { clusters: BlindSpotCluster[]; sampledAgents: AgentSampledEvent[] }) {
  const sampledById = useMemo(() => new Map(sampledAgents.map((agent) => [agent.agent_id, agent])), [sampledAgents])
  if (clusters.length === 0) {
    return (
      <section className="result-panel result-wide-panel">
        <h2>사각지대</h2>
        <p className="result-empty-copy">이번 실행에서는 뚜렷한 사각지대가 발견되지 않았습니다. 표본수를 늘리거나 정책 문장을 구체화해보세요.</p>
      </section>
    )
  }

  return (
    <section className="result-panel result-wide-panel">
      <h2>사각지대</h2>
      <div className="blind-grid">
        {clusters.slice(0, 6).map((cluster, index) => {
          const representative = sampledById.get(cluster.agent_ids[0])
          const meta = representative
            ? `${ageGroupShort(representative.age_group)} ${genderShort(representative.gender)} · ${regionShort(representative.region, representative.region_group)}${cluster.count >= 2 ? ` 외 ${cluster.count - 1}명` : ""}`
            : "정보 없음"
          return (
            <article key={`${cluster.short_title}-${index}`} className="blind-card">
              <h3>{cluster.short_title}</h3>
              <p title={cluster.blind_spot_examples[0]}>{cluster.blind_spot_examples[0]}</p>
              <span>{meta}</span>
            </article>
          )
        })}
      </div>
      {clusters.length > 6 && <button type="button" className="result-more-button">▾ {clusters.length - 6}건 더 보기</button>}
    </section>
  )
}

function ReframingList({ items }: { items: ReframingItem[] }) {
  if (items.length === 0) return null
  return (
    <section className="result-panel result-wide-panel">
      <h2>정책 전제 반문</h2>
      <div className="reframe-grid">
        {items.slice(0, 6).map((item, index) => (
          <article key={`${item.text}-${index}`} className="reframe-card">
            <p title={item.text}>{item.text}</p>
            <span>{ageGroupShort(item.age_group)} {genderShort(item.gender)} · {regionGroupLabel(item.region_group)}</span>
          </article>
        ))}
      </div>
      {items.length > 6 && <button type="button" className="result-more-button">▾ {items.length - 6}건 더 보기</button>}
    </section>
  )
}
```

- [ ] **Step 4: Add CSS**

Append to `result.css`:

```css
.result-wide-panel {
  margin-top: 24px;
}

.blind-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.reframe-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.blind-card,
.reframe-card {
  min-height: 150px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-radius: 12px;
  background: var(--result-card, #f5f5f5);
  padding: 20px;
}

.blind-card h3 {
  margin: 0;
  font-size: 16px;
  line-height: 1.35;
}

.blind-card p,
.reframe-card p {
  margin: 0;
  color: var(--result-body, #374151);
  font-size: 14px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.reframe-card p {
  -webkit-line-clamp: 2;
}

.blind-card span,
.reframe-card span,
.result-empty-copy {
  margin-top: auto;
  color: var(--result-muted, #6b7280);
  font-size: 13px;
}

.result-more-button {
  margin-top: 16px;
  min-height: 40px;
  border: 1px solid var(--result-hairline, #e5e7eb);
  border-radius: 8px;
  background: #ffffff;
  color: var(--result-ink, #111111);
  font-weight: 600;
  padding: 0 14px;
}
```

- [ ] **Step 5: Run tests**

Run:

```powershell
npm.cmd --prefix frontend test -- --run src/result/ResultPage.test.tsx
```

Expected:

```text
PASS src/result/ResultPage.test.tsx
```

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/result/ResultPage.tsx frontend/src/result/ResultPage.test.tsx frontend/src/result/result.css
git commit -m "feat: add blind spot result sections"
```

---

## Task 9: Responsive Polish and Visual Verification

**Files:**
- Modify: `frontend/src/result/result.css`
- Modify: `frontend/src/result/ResultPage.test.tsx`

- [ ] **Step 1: Add responsive CSS**

Append:

```css
@media (max-width: 900px) {
  .result-shell {
    padding: 16px;
  }

  .result-header {
    height: auto;
    align-items: flex-start;
    flex-direction: column;
    padding-bottom: 16px;
  }

  .result-header-left,
  .result-header-actions,
  .result-hero-stats {
    flex-wrap: wrap;
  }

  .result-policy-chip {
    max-width: min(100%, 68vw);
  }

  .result-stat.push {
    margin-left: 0;
  }

  .result-grid {
    grid-template-columns: 1fr;
  }

  .blind-grid,
  .reframe-grid {
    grid-template-columns: 1fr;
  }

  .opinion-plot {
    height: 320px;
  }
}
```

- [ ] **Step 2: Run frontend test and build**

Run:

```powershell
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
```

Expected:

```text
PASS ...
✓ built
```

- [ ] **Step 3: Start dev server for visual check**

Run:

```powershell
npm.cmd --prefix . run dev
```

Expected:

```text
backend ... Uvicorn running on http://127.0.0.1:8000
frontend ... Local: http://127.0.0.1:5173/
```

- [ ] **Step 4: Browser verification**

Open:

```text
http://127.0.0.1:5173/result
```

Verify:

- Empty state renders if no current run exists.
- After a run completes on `/`, clicking "결과 보기 ->" navigates to `/result`.
- Header, hero, opinion map, demographic bars, blind spot grid, and reframing list are visible.
- Desktop width has two-column map/bars and three-column blind spot cards.
- Mobile width stacks sections without text overlap.
- Console has no React errors.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/result/result.css frontend/src/result/ResultPage.test.tsx
git commit -m "style: polish result page responsiveness"
```

---

## Task 10: Full Verification

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run backend focused tests**

```powershell
cd backend
python -m pytest tests/test_llm_and_api.py -q
```

Expected:

```text
passed
```

- [ ] **Step 2: Run all tests**

```powershell
npm.cmd test
```

Expected:

```text
backend ... passed
frontend ... passed
```

- [ ] **Step 3: Run production build**

```powershell
npm.cmd run build
```

Expected:

```text
✓ built
```

- [ ] **Step 4: Review changed files**

Run:

```powershell
git status --short
git diff --stat
```

Expected tracked changes are limited to:

```text
backend/app/services/llm_client.py
backend/app/api/simulate.py
backend/tests/test_llm_and_api.py
frontend/package.json
frontend/package-lock.json
frontend/src/lib/api.ts
frontend/src/lib/api.test.ts
frontend/src/lib/resultHelpers.ts
frontend/src/lib/resultHelpers.test.ts
frontend/src/lib/currentRunStore.ts
frontend/src/lib/currentRunStore.test.ts
frontend/src/result/ResultPage.tsx
frontend/src/result/ResultPage.test.tsx
frontend/src/result/result.css
frontend/src/App.tsx
tasks/main-redesign/status.md
```

- [ ] **Step 5: Final commit**

If all previous task commits were made, only commit remaining verification/status docs:

```powershell
git add tasks/main-redesign/status.md
git commit -m "docs: record result page implementation status"
```

If implementation was batched into fewer commits, use:

```powershell
git add backend/app/services/llm_client.py backend/app/api/simulate.py backend/tests/test_llm_and_api.py frontend/package.json frontend/package-lock.json frontend/src/lib/api.ts frontend/src/lib/api.test.ts frontend/src/lib/resultHelpers.ts frontend/src/lib/resultHelpers.test.ts frontend/src/lib/currentRunStore.ts frontend/src/lib/currentRunStore.test.ts frontend/src/result/ResultPage.tsx frontend/src/result/ResultPage.test.tsx frontend/src/result/result.css frontend/src/App.tsx
git commit -m "feat: add main result insight board"
```

---

## Self-Review Checklist

- Spec coverage:
  - `/result` route: Task 5 and Task 6.
  - Current run persistence: Task 5.
  - Summary schema fields: Task 1.
  - Summary normalization: Task 2.
  - Frontend types: Task 3.
  - Result components: Tasks 6, 7, 8.
  - Region/demographic helpers: Task 4.
  - Empty states: Tasks 6, 7, 8.
  - Visual verification: Task 9.
- Design coverage:
  - White canvas, black CTA, gray cards, hairline borders: Tasks 6 through 9.
  - Cal.com style used as dashboard restraint, not a marketing landing page: Tasks 6 through 9.
- Known implementation decision:
  - The normalizer attempts one non-streaming refill call for missing short display fields, then falls back deterministically and marks fallback metadata. This preserves the external SSE event names and heartbeat structure.
- Final required commands:
  - `cd backend && python -m pytest tests/test_llm_and_api.py -q`
  - `npm.cmd test`
  - `npm.cmd run build`
