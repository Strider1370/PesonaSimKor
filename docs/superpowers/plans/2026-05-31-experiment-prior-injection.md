# Experiment Prior Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject real 한국갤럽 survey distributions (matched to each persona's gender, age, and province) into agent prompts as `prior`, for preset topics — PoC with 원전 (`2_1`).

**Architecture:** A precomputed JSON file per topic holds the survey cross-tab. `get_prior(topic_id, persona_axes)` loads it, maps the persona's province to a Gallup 권역, and returns a dict with national + per-axis marginals. That dict flows through the existing `build_agent_prompt` → `prior_text` path unchanged. `topic_id` is threaded from the frontend preset through `SimulateRequest`.

**Tech Stack:** Python 3 / FastAPI / pytest (backend); React / TypeScript / Vitest (frontend); Node ESM script for preset generation.

**Spec:** `docs/superpowers/specs/2026-05-31-experiment-prior-injection-design.md`

---

## File Structure

- `backend/app/data/priors/2_1.json` (new) — static survey distribution for 원전.
- `backend/app/services/prior_service.py` (rewrite) — load file, map province→권역, build prior dict.
- `backend/tests/test_prior_service.py` (new) — unit tests for `get_prior`.
- `backend/app/models/schemas.py` (modify) — add `topic_id` to `SimulateRequest`.
- `backend/app/api/simulate.py` (modify) — pass `topic_id` + `province` to `get_prior`.
- `backend/tests/test_llm_and_api.py` (modify) — assert wiring.
- `frontend/src/lib/experiment.ts` (modify) — add `topicId` to `PolicySlot`; set/clear it.
- `frontend/src/lib/experiment.test.ts` (modify) — cover `topicId`.
- `frontend/src/lib/api.ts` (modify) — add `topic_id` to `SimulateRequest`.
- `frontend/src/App.tsx` (modify) — thread `topicId` into `simulate(...)`.
- `scripts/generate-experiment-presets.mjs` (modify) — correct `2_1` `realOpinion`; regenerate `frontend/src/data/presets.json`.

Run commands assume repo root `C:\Users\Jond Doe\Desktop\Project\civicsimKR`. Backend commands run from `backend/`; frontend from `frontend/`.

---

## Task 1: Prior data file + `get_prior`

**Files:**
- Create: `backend/app/data/priors/2_1.json`
- Rewrite: `backend/app/services/prior_service.py`
- Test: `backend/tests/test_prior_service.py`

- [ ] **Step 1: Create the prior data file**

Create `backend/app/data/priors/2_1.json` with exactly this content:

```json
{
  "topic_id": "2_1",
  "topic": "신규 원전 건설",
  "source": "한국갤럽 데일리 오피니언 제648호 (2026.1.13~15, n=1000)",
  "question": "신규 원전을 건설해야 한다 / 건설하지 말아야 한다",
  "national": { "support": 54, "oppose": 25, "undecided": 21 },
  "by_gender": {
    "male": { "support": 70, "oppose": 20, "undecided": 10 },
    "female": { "support": 38, "oppose": 29, "undecided": 32 }
  },
  "by_age_group": {
    "20s": { "support": 50, "oppose": 19, "undecided": 31 },
    "30s": { "support": 51, "oppose": 28, "undecided": 20 },
    "40s": { "support": 48, "oppose": 36, "undecided": 16 },
    "50s": { "support": 52, "oppose": 31, "undecided": 17 },
    "60s": { "support": 69, "oppose": 16, "undecided": 14 },
    "70_plus": { "support": 51, "oppose": 16, "undecided": 33 }
  },
  "by_region": {
    "seoul": { "support": 60, "oppose": 20, "undecided": 20 },
    "incheon_gyeonggi": { "support": 55, "oppose": 25, "undecided": 20 },
    "daejeon_sejong_chungcheong": { "support": 50, "oppose": 26, "undecided": 24 },
    "gwangju_jeolla": { "support": 42, "oppose": 28, "undecided": 29 },
    "daegu_gyeongbuk": { "support": 59, "oppose": 15, "undecided": 26 },
    "busan_ulsan_gyeongnam": { "support": 49, "oppose": 35, "undecided": 16 }
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `backend/tests/test_prior_service.py`:

```python
from app.services.prior_service import get_prior


def axes(gender="male", age_group="60s", province="서울"):
    return {"gender": gender, "age_group": age_group, "province": province}


def test_get_prior_matches_each_axis():
    prior = get_prior("2_1", axes(gender="male", age_group="60s", province="서울"))
    assert prior is not None
    assert prior["topic"] == "신규 원전 건설"
    assert prior["national"] == {"support": 54, "oppose": 25, "undecided": 21}
    assert prior["by_gender"] == {"support": 70, "oppose": 20, "undecided": 10}
    assert prior["by_age"] == {"support": 69, "oppose": 16, "undecided": 14}
    assert prior["by_region"] == {"support": 60, "oppose": 20, "undecided": 20}


def test_get_prior_province_maps_to_region_bucket():
    # 경기 belongs to the incheon_gyeonggi 권역
    prior = get_prior("2_1", axes(province="경기"))
    assert prior["by_region"] == {"support": 55, "oppose": 25, "undecided": 20}
    # 경상남 belongs to busan_ulsan_gyeongnam
    prior = get_prior("2_1", axes(province="경상남"))
    assert prior["by_region"] == {"support": 49, "oppose": 35, "undecided": 16}


def test_get_prior_suppressed_region_falls_back_to_national():
    prior = get_prior("2_1", axes(province="강원"))
    assert prior["by_region"] == prior["national"]
    prior = get_prior("2_1", axes(province="제주"))
    assert prior["by_region"] == prior["national"]


def test_get_prior_unknown_province_falls_back_to_national():
    prior = get_prior("2_1", axes(province="해외"))
    assert prior["by_region"] == prior["national"]


def test_get_prior_returns_none_for_unknown_or_missing_topic():
    assert get_prior(None, axes()) is None
    assert get_prior("", axes()) is None
    assert get_prior("9_9", axes()) is None
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `backend/`): `python -m pytest tests/test_prior_service.py -v`
Expected: FAIL — current `get_prior(policy_text, persona_axes)` returns `None`, so `prior["topic"]` raises `TypeError: 'NoneType' object is not subscriptable`.

- [ ] **Step 4: Rewrite `prior_service.py`**

Replace the entire contents of `backend/app/services/prior_service.py` with:

```python
import json
from functools import lru_cache
from pathlib import Path

# Persona province (Nemotron `province` values) -> Gallup 권역 key used in priors/*.json
PROVINCE_TO_REGION = {
    "서울": "seoul",
    "인천": "incheon_gyeonggi",
    "경기": "incheon_gyeonggi",
    "대전": "daejeon_sejong_chungcheong",
    "세종": "daejeon_sejong_chungcheong",
    "충청남": "daejeon_sejong_chungcheong",
    "충청북": "daejeon_sejong_chungcheong",
    "광주": "gwangju_jeolla",
    "전라남": "gwangju_jeolla",
    "전북": "gwangju_jeolla",
    "대구": "daegu_gyeongbuk",
    "경상북": "daegu_gyeongbuk",
    "부산": "busan_ulsan_gyeongnam",
    "울산": "busan_ulsan_gyeongnam",
    "경상남": "busan_ulsan_gyeongnam",
    "강원": "gangwon",  # suppressed (n<50) in source -> not present in by_region -> national
    "제주": "jeju",     # suppressed (n<50) in source -> not present in by_region -> national
}


def priors_dir() -> Path:
    # this file: backend/app/services/prior_service.py ; parents[1] == backend/app
    return Path(__file__).resolve().parents[1] / "data" / "priors"


@lru_cache(maxsize=32)
def _load_topic(topic_id: str) -> dict | None:
    path = priors_dir() / f"{topic_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def get_prior(topic_id: str | None, persona_axes: dict[str, str]) -> dict | None:
    if not topic_id:
        return None
    data = _load_topic(topic_id)
    if data is None:
        return None

    national = data["national"]
    gender = persona_axes.get("gender")
    age_group = persona_axes.get("age_group")
    province = persona_axes.get("province")
    region_key = PROVINCE_TO_REGION.get(province)

    return {
        "topic": data["topic"],
        "source": data["source"],
        "question": data["question"],
        "national": national,
        "by_gender": data["by_gender"].get(gender, national),
        "by_age": data["by_age_group"].get(age_group, national),
        "by_region": data["by_region"].get(region_key, national),
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `backend/`): `python -m pytest tests/test_prior_service.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/app/data/priors/2_1.json backend/app/services/prior_service.py backend/tests/test_prior_service.py
git commit -m "feat(prior): implement get_prior with 원전 survey data and province mapping"
```

---

## Task 2: Add `topic_id` to `SimulateRequest`

**Files:**
- Modify: `backend/app/models/schemas.py:6-12`
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_llm_and_api.py` (near other schema/import tests):

```python
def test_simulate_request_accepts_topic_id():
    from app.models.schemas import SimulateRequest

    req = SimulateRequest(policy="p", topic_id="2_1")
    assert req.topic_id == "2_1"

    req_default = SimulateRequest(policy="p")
    assert req_default.topic_id is None
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `backend/`): `python -m pytest tests/test_llm_and_api.py::test_simulate_request_accepts_topic_id -v`
Expected: FAIL — `SimulateRequest` has no `topic_id` (Pydantic ignores unknown kwargs, so `req.topic_id` raises `AttributeError`).

- [ ] **Step 3: Add the field**

In `backend/app/models/schemas.py`, inside `class SimulateRequest`, add the field after `persona_depth` (line ~12):

```python
    topic_id: str | None = None
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `backend/`): `python -m pytest tests/test_llm_and_api.py::test_simulate_request_accepts_topic_id -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/schemas.py backend/tests/test_llm_and_api.py
git commit -m "feat(prior): add topic_id to SimulateRequest"
```

---

## Task 3: Wire `topic_id` + `province` into `get_prior` in `simulate.py`

**Files:**
- Modify: `backend/app/api/simulate.py:263-270` and `:292-299`
- Modify: `backend/tests/test_llm_and_api.py:878-893` (`sample_personas` helper) + new test

**Important:** the existing `sample_personas` test helper (line 878) does NOT include
`structured_profile`. To avoid breaking every test that uses `patch_fast_simulation`,
the production code reads province **defensively** (`.get`), and the helper is updated
to carry a province so the new test can assert it.

- [ ] **Step 1: Add `structured_profile` to the `sample_personas` helper**

In `backend/tests/test_llm_and_api.py`, inside the `sample_personas` persona dict
(lines 880-890), add a `structured_profile` key (e.g. after `region_group`):

```python
            "age_group": "20s",
            "region_group": "capital",
            "structured_profile": {"province": "서울"},
```

- [ ] **Step 2: Write the failing test**

Add to `backend/tests/test_llm_and_api.py` (it reuses the existing `patch_fast_simulation`
helper and `TestClient`/`app` already imported in this file):

```python
def test_simulate_stream_passes_topic_id_and_province_to_get_prior(monkeypatch):
    from app.api import simulate as simulate_api

    captured = []

    def fake_get_prior(topic_id, persona_axes):
        captured.append((topic_id, persona_axes))
        return None

    patch_fast_simulation(monkeypatch, simulate_api)
    monkeypatch.setattr(simulate_api, "get_prior", fake_get_prior)

    client = TestClient(app)
    response = client.post("/api/simulate", json={"policy": "원전 정책", "n_agents": 5, "topic_id": "2_1"})

    assert response.status_code == 200
    assert captured, "get_prior was not called"
    topic_id, axes = captured[0]
    assert topic_id == "2_1"
    assert axes["province"] == "서울"
    assert axes["gender"] in {"male", "female"}
    assert axes["age_group"] == "20s"
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `backend/`): `python -m pytest tests/test_llm_and_api.py::test_simulate_stream_passes_topic_id_and_province_to_get_prior -v`
Expected: FAIL — current code calls `get_prior(policy, {...})` with no `province` key, so `axes["province"]` raises `KeyError` and/or `topic_id` is the policy string.

- [ ] **Step 4: Update both `get_prior` calls**

In `backend/app/api/simulate.py`, the openai branch (around line 263) and the ollama
branch (around line 292) each have an identical `get_prior(policy, {...})` block.
Replace BOTH with (note defensive `.get` for `structured_profile`):

```python
                prior = get_prior(
                    req.topic_id,
                    {
                        "age_group": persona["age_group"],
                        "gender": persona["gender"],
                        "province": persona.get("structured_profile", {}).get("province"),
                    },
                )
```

(A persona without `structured_profile` yields `province=None`, which `get_prior`
maps to the national region distribution — no crash.)

- [ ] **Step 5: Run tests to verify they pass**

Run (from `backend/`): `python -m pytest tests/test_llm_and_api.py -v`
Expected: PASS — new test passes AND all existing `patch_fast_simulation`-based
simulate-stream tests still pass (helper now supplies `structured_profile`; code is
defensive regardless).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/simulate.py backend/tests/test_llm_and_api.py
git commit -m "feat(prior): pass topic_id and province from simulate to get_prior"
```

---

## Task 4: Frontend — thread `topicId` from preset to request

**Files:**
- Modify: `frontend/src/lib/experiment.ts:42-46` (`PolicySlot`), `:131`, `:139-141`, `:148-150`
- Modify: `frontend/src/lib/api.ts:178-185` (`SimulateRequest`)
- Modify: `frontend/src/App.tsx:668-690` (`runSlot` + `simulate(...)` call)
- Test: `frontend/src/lib/experiment.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/lib/experiment.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  createInitialSlots,
  updateSlotFromPreset,
  updateSlotPolicy,
  type ExperimentPreset,
} from "./experiment"

describe("slot topicId", () => {
  const preset = {
    id: "2_1_neutral_no_context_explicit_base",
    topic_id: "2_1",
    topic: "원자력 발전 확대",
    prompt: "정책 본문",
  } as unknown as ExperimentPreset

  it("sets topicId when a preset is applied", () => {
    const slots = createInitialSlots()
    const next = updateSlotFromPreset(slots, slots[0].id, preset)
    expect(next[0].topicId).toBe("2_1")
  })

  it("clears topicId when policy is edited freely", () => {
    const slots = updateSlotFromPreset(createInitialSlots(), "A", preset)
    const next = updateSlotPolicy(slots, "A", "자유 입력")
    expect(next[0].topicId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `frontend/`): `npx vitest run src/lib/experiment.test.ts`
Expected: FAIL — `topicId` does not exist on `PolicySlot`.

- [ ] **Step 3: Add `topicId` to `PolicySlot` and set/clear it**

In `frontend/src/lib/experiment.ts`:

Change the `PolicySlot` type (line 42-46) to:

```ts
export type PolicySlot = {
  id: PolicySlotId
  policy: string
  presetId: string
  topicId?: string
}
```

In `updateSlotPolicy` (line 139-141), clear `topicId` alongside `presetId`:

```ts
export function updateSlotPolicy(slots: PolicySlot[], slotId: PolicySlotId, policy: string): PolicySlot[] {
  return slots.map((slot) => (slot.id === slotId ? { ...slot, policy, presetId: "", topicId: undefined } : slot))
}
```

In `updateSlotFromPreset` (line 148-150), set `topicId`:

```ts
  return slots.map((slot) =>
    slot.id === slotId ? { ...slot, presetId: preset.id, policy: preset.prompt, topicId: preset.topic_id } : slot,
  )
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `frontend/`): `npx vitest run src/lib/experiment.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `topic_id` to the API request type**

In `frontend/src/lib/api.ts`, extend `SimulateRequest` (line 178-185):

```ts
export type SimulateRequest = {
  policy: string
  n_agents: number
  model_provider?: "ollama" | "openai"
  model_name?: string
  thinking?: boolean
  persona_depth?: "minimal" | "standard" | "full"
  topic_id?: string | null
}
```

- [ ] **Step 6: Thread `topicId` through `runSlot`**

In `frontend/src/App.tsx`, change `runSlot` to read the slot's `topicId` and pass it. Update the signature and the `simulate(...)` request object (lines 668-690):

```tsx
  async function runSlot(slotId: PolicySlotId, policy: string) {
    const topicId = slots.find((slot) => slot.id === slotId)?.topicId
    const controller = new AbortController()
```

and add `topic_id: topicId ?? null,` to the request object passed to `simulate(...)`:

```tsx
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
```

(The other `simulate(...)` call site at line ~220 is the non-experiment quick path and intentionally sends no `topic_id`.)

- [ ] **Step 7: Run the full frontend test + typecheck**

Run (from `frontend/`): `npx vitest run` then `npx tsc --noEmit`
Expected: tests PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/experiment.ts frontend/src/lib/experiment.test.ts frontend/src/lib/api.ts frontend/src/App.tsx
git commit -m "feat(prior): send preset topic_id from experiment runs"
```

---

## Task 5: Correct `2_1` `real_opinion` and regenerate presets

**Files:**
- Modify: `scripts/generate-experiment-presets.mjs:104-113`
- Regenerate: `frontend/src/data/presets.json`

**Note:** The `2_1` topic has variants (비중 확대 / 신규 건설 / 수명 연장) that share one topic-level `realOpinion`. The Gallup 648호 figures are specifically for 신규 원전 건설; applying them to all `2_1` variants is an accepted approximation for this test PoC (matches the spec).

- [ ] **Step 1: Update the generator's `2_1` realOpinion**

In `scripts/generate-experiment-presets.mjs`, replace the `2_1` `realOpinion` block (lines ~104-113) with:

```js
    realOpinion: {
      support: 54,
      oppose: 25,
      neutral: 21,
      source: "한국갤럽 데일리 오피니언 제648호",
      year: 2026,
      question: "신규 원전 2기 건설 찬반",
      url: "https://www.gallup.co.kr/dir/GallupKoreaDaily/GallupKoreaDailyOpinion_648(20260116).pdf",
      note: "한국갤럽 648호(2026.1.13~15, n=1000) 교차집계표 기준.",
    },
```

- [ ] **Step 2: Regenerate presets.json**

Run (from repo root): `node scripts/generate-experiment-presets.mjs`
Expected: console prints `Wrote <N> presets to .../frontend/src/data/presets.json`.

- [ ] **Step 3: Verify the regenerated values**

Run (from repo root): `node -e "const p=require('./frontend/src/data/presets.json'); const r=p.find(x=>x.topic_id==='2_1').real_opinion; console.log(r.support, r.oppose, r.neutral, r.source)"`
Expected output: `54 25 21 한국갤럽 데일리 오피니언 제648호`

- [ ] **Step 4: Run frontend tests (presets are consumed by experiment UI)**

Run (from `frontend/`): `npx vitest run`
Expected: PASS (no test asserts the old 35/11 values; if any does, update it to 25/21).

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-experiment-presets.mjs frontend/src/data/presets.json
git commit -m "fix(presets): correct 2_1 real_opinion to 한국갤럽 648호 values"
```

---

## Final Verification

- [ ] **Backend:** from `backend/`, run `python -m pytest -v` — all pass.
- [ ] **Frontend:** from `frontend/`, run `npx vitest run` and `npx tsc --noEmit` — all pass, no type errors.
- [ ] **Manual smoke (optional):** start backend + frontend, apply the 원전 preset to a slot, run with `model_provider=ollama`, and confirm the `llm_prompt` event's `[Prior]` block contains the matched JSON (national + by_gender/by_age/by_region) for at least one persona.

---

## Self-Review Notes (author)

- **Spec coverage:** §2 data → Task 1 file; §3 mapping → Task 1 `PROVINCE_TO_REGION`; §4.2 `get_prior` → Task 1; §4.3 real_opinion → Task 5; §4.4 plumbing → Tasks 2–4; §6 fallbacks → Task 1 tests; §7 testing → Tasks 1,3,4. All covered.
- **No prompt-builder changes:** confirmed — `build_agent_prompt` already serializes `prior` to `prior_text`; prior dict shape is free-form JSON, so no builder edit needed.
- **Type consistency:** `get_prior(topic_id, persona_axes)` signature identical in Task 1 (def), Task 3 (call), and test fakes. Returned keys (`by_gender`/`by_age`/`by_region`) consistent across data file, service, and tests.
