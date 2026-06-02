# 페르소나 프롬프트 입력 구성 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 정책 응답 LLM이 페르소나 데이터를 깊이별·정책관련성별로 받도록 입력 구성을 재설계하고, 어떤 항목이 들어갔는지 사용자에게 투명하게 표시한다.

**Architecture:** 백엔드는 구조화 필드(노이즈 2개 제거)·핵심 서사(고정)·조건부 서사(정책 보고 LLM이 선택)를 깊이별로 직렬화한다. 옵션 선택은 기존 `structure_policy` 호출에 출력 한 항목을 더해 1회로 끝내고, 불변 튜플로 N개 병렬 에이전트에 전달한다. 프론트는 신규 메타를 공유 타입으로 영속/결과 경로까지 흘려 메인·결과 페이지 양쪽에 표시한다.

**Tech Stack:** Python(FastAPI, pydantic, pyarrow/pandas), TypeScript(React, zustand), pytest, vitest.

**참고:** 스펙 `tasks/persona-prompt-input/spec.md` (draft v3), 리뷰 `tasks/persona-prompt-input/reviews.md`.

---

## File Structure

**백엔드**
- `backend/app/services/llm_client.py` — 상수 3종 신설, `build_agent_prompt` 재설계, `structure_policy` 확장, `compute_included_fields` 신설, 4개 호출부 스레딩
- `backend/app/services/persona_repository.py` — `REQUIRED_COLUMNS` 확장, `normalize_record` 재구성(structured_profile 10키, narrative_context 분류)
- `backend/app/api/simulate.py` — 옵션 추출·스레딩, `included_fields` 산출, `policy_structured` 페이로드 확장
- `backend/app/models/schemas.py` — full+대N 토큰 가드(model_validator)
- `backend/tests/test_llm_and_api.py` — 백엔드 테스트

**프론트엔드**
- `frontend/src/lib/api.ts` — `StructuredPolicyWithPromptFields` 공유 타입, `PersonaDepth`
- `frontend/src/lib/currentRunStore.ts` — `CurrentRun.persona_depth`, 신규 정책 타입
- `frontend/src/lib/experimentStorage.ts` — `ExperimentSnapshotResult.structuredPolicy`
- `frontend/src/lib/experiment.ts` — `buildSnapshotResults` 슬롯별 정책 보존
- `frontend/src/App.tsx` — `saveCurrentRun` depth 포함, `currentSnapshotInput` 슬롯별 정책 주입, `currentRunFromSnapshot` 결과 우선 읽기
- `frontend/src/result/PersonaFieldsBadge.tsx` (신규) — 투명성 표시 컴포넌트(양쪽 재사용)
- `frontend/src/result/dashboardModel.ts` / `ResultPage.tsx` — 헤더에 included_fields·depth 전달
- 대응 테스트: `currentRunStore.test.ts`, `experimentStorage.test.ts`, `api.test.ts`, 신규 컴포넌트 테스트

---

## Phase 0 — 상수 + 데이터 로딩

### Task 1: 페르소나 필드 상수 3종 신설

**Files:**
- Modify: `backend/app/services/llm_client.py` (상단, `STRUCTURED_POLICY_FIELDS` L141 근처)
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
# test_llm_and_api.py
from app.services.llm_client import (
    STRUCTURED_PROFILE_KEYS,
    CORE_NARRATIVE_KEYS,
    OPTIONAL_NARRATIVE_FIELDS,
)

def test_persona_field_constants_are_disjoint_and_exclude_noise():
    assert "military_status" not in STRUCTURED_PROFILE_KEYS
    assert "country" not in STRUCTURED_PROFILE_KEYS
    assert len(STRUCTURED_PROFILE_KEYS) == 10
    assert set(CORE_NARRATIVE_KEYS) == {
        "professional_persona", "family_persona", "persona", "career_goals_and_ambitions",
    }
    # 조건부엔 _list 변형 없음
    assert all(not k.endswith("_list") for k in OPTIONAL_NARRATIVE_FIELDS)
    # 세 집합 서로소
    assert set(STRUCTURED_PROFILE_KEYS).isdisjoint(CORE_NARRATIVE_KEYS)
    assert set(CORE_NARRATIVE_KEYS).isdisjoint(OPTIONAL_NARRATIVE_FIELDS)
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py::test_persona_field_constants_are_disjoint_and_exclude_noise -v`
Expected: FAIL (ImportError)

- [ ] **Step 3: 상수 구현**

```python
# llm_client.py, STRUCTURED_POLICY_FIELDS 아래
STRUCTURED_PROFILE_KEYS = (
    "age", "gender", "province", "district", "occupation",
    "family_type", "marital_status", "housing_type", "education_level", "bachelors_field",
)
CORE_NARRATIVE_KEYS = (
    "professional_persona", "family_persona", "persona", "career_goals_and_ambitions",
)
OPTIONAL_NARRATIVE_FIELDS = (
    "cultural_background", "skills_and_expertise", "arts_persona",
    "travel_persona", "culinary_persona", "sports_persona", "hobbies_and_interests",
)
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py::test_persona_field_constants_are_disjoint_and_exclude_noise -v`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/llm_client.py backend/tests/test_llm_and_api.py
git commit -m "feat(persona): add structured/core/optional persona field constants"
```

---

### Task 2: 데이터셋 신규 서사 컬럼 로딩 + 레코드 재구성

**Files:**
- Modify: `backend/app/services/persona_repository.py:36-53` (`REQUIRED_COLUMNS`), `:125-158` (`normalize_record`)
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
from app.services.persona_repository import normalize_record

def _raw_row():
    return {
        "age": 41, "sex": "여자", "province": "서울특별시", "district": "마포구",
        "occupation": "무직", "education_level": "4년제 대학교", "marital_status": "배우자있음",
        "military_status": "비현역", "family_type": "배우자·자녀와 거주", "housing_type": "자가",
        "bachelors_field": "사회과학", "country": "대한민국", "persona": "P", "cultural_background": "C",
        "career_goals_and_ambitions": "G", "hobbies_and_interests": "H",
        "professional_persona": "PP", "family_persona": "FP", "skills_and_expertise": "SE",
        "arts_persona": "AP", "travel_persona": "TP", "culinary_persona": "CP", "sports_persona": "SP",
    }

def test_normalize_record_structured_profile_excludes_noise():
    rec = normalize_record(0, _raw_row())
    sp = rec["structured_profile"]
    assert "military_status" not in sp and "country" not in sp
    assert set(sp.keys()) == {
        "age","gender","province","district","occupation",
        "family_type","marital_status","housing_type","education_level","bachelors_field",
    }

def test_normalize_record_narrative_context_has_core_and_optional():
    rec = normalize_record(0, _raw_row())
    nc = rec["narrative_context"]
    for k in ("professional_persona","family_persona","persona","career_goals_and_ambitions"):
        assert k in nc
    for k in ("arts_persona","skills_and_expertise","cultural_background","hobbies_and_interests"):
        assert k in nc
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k normalize_record -v`
Expected: FAIL (KeyError / 컬럼 미로딩 또는 키 불일치)

- [ ] **Step 3: 구현 — REQUIRED_COLUMNS 확장**

```python
# persona_repository.py, REQUIRED_COLUMNS 리스트에 누락 서사 추가 (기존 4개 외)
REQUIRED_COLUMNS = [
    "age", "sex", "province", "district", "occupation", "education_level",
    "marital_status", "military_status", "family_type", "housing_type",
    "bachelors_field", "country", "persona", "cultural_background",
    "career_goals_and_ambitions", "hobbies_and_interests",
    # 신규 로딩 (지금까지 버려지던 것)
    "professional_persona", "family_persona", "skills_and_expertise",
    "arts_persona", "travel_persona", "culinary_persona", "sports_persona",
]
# 주: `_list` 변형(skills_and_expertise_list, hobbies_and_interests_list)은 의도적으로 로딩 안 함
# (§3-4: prose 우선, _list는 중복). 실행자가 "누락"으로 오인해 재추가하지 말 것.
```

- [ ] **Step 4: 구현 — normalize_record 재구성**

```python
# normalize_record 내부. structured_profile에서 military_status·country 제거,
# narrative_context에 핵심 4 + 조건부 7 채움.
    return {
        "row_id": str(row_id),
        "age": int(row["age"]),
        "gender": normalize_gender(row["sex"]),
        "region": district,
        "job": str(row["occupation"]),
        "education": str(row["education_level"]),
        "background": str(row["persona"]),
        "structured_profile": {
            "age": int(row["age"]),
            "gender": normalize_gender(row["sex"]),
            "province": province,
            "district": district,
            "occupation": str(row["occupation"]),
            "family_type": str(row.get("family_type", "")),
            "marital_status": str(row.get("marital_status", "")),
            "housing_type": str(row.get("housing_type", "")),
            "education_level": str(row["education_level"]),
            "bachelors_field": str(row.get("bachelors_field", "")),
        },
        "narrative_context": {
            "persona": str(row["persona"]),
            "professional_persona": str(row.get("professional_persona", "")),
            "family_persona": str(row.get("family_persona", "")),
            "career_goals_and_ambitions": str(row.get("career_goals_and_ambitions", "")),
            "cultural_background": str(row.get("cultural_background", "")),
            "skills_and_expertise": str(row.get("skills_and_expertise", "")),
            "arts_persona": str(row.get("arts_persona", "")),
            "travel_persona": str(row.get("travel_persona", "")),
            "culinary_persona": str(row.get("culinary_persona", "")),
            "sports_persona": str(row.get("sports_persona", "")),
            "hobbies_and_interests": str(row.get("hobbies_and_interests", "")),
        },
        "age_group": age_group_for(int(row["age"])),
        "region_group": region_group_for(province),
    }
```

- [ ] **Step 5: 통과 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k normalize_record -v`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/persona_repository.py backend/tests/test_llm_and_api.py
git commit -m "feat(persona): load discarded narrative columns, drop noise from structured profile"
```

---

## Phase 1 — 프롬프트 빌더

### Task 3: `build_agent_prompt` 3분기 + optional_fields

**Files:**
- Modify: `backend/app/services/llm_client.py:261-298` (`build_agent_prompt`)
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
from app.services.llm_client import build_agent_prompt

_PERSONA = {
    "agent_id": 0, "age": 41, "gender": "female", "region": "마포구",
    "structured_profile": {
        "age": 41, "gender": "female", "province": "서울특별시", "district": "마포구",
        "occupation": "무직", "family_type": "배우자·자녀와 거주", "marital_status": "배우자있음",
        "housing_type": "자가", "education_level": "4년제 대학교", "bachelors_field": "사회과학",
    },
    "narrative_context": {
        "persona": "P", "professional_persona": "PP", "family_persona": "FP",
        "career_goals_and_ambitions": "G", "cultural_background": "C",
        "skills_and_expertise": "SE", "arts_persona": "AP", "travel_persona": "TP",
        "culinary_persona": "CP", "sports_persona": "SP", "hobbies_and_interests": "H",
    },
}

def test_prompt_minimal_has_structured_no_narrative_no_noise():
    p = build_agent_prompt(_PERSONA, "정책", "minimal")
    assert "occupation" in p and "마포구" in p
    assert "PP" not in p and "professional_persona" not in p   # 서사 0
    assert "military_status" not in p and "country" not in p

def test_prompt_standard_core_plus_selected_optional_only():
    p = build_agent_prompt(_PERSONA, "정책", "standard", optional_fields=("arts_persona",))
    assert "PP" in p and "FP" in p          # 핵심 서사
    assert "AP" in p                         # 선택된 옵션
    assert "TP" not in p and "SP" not in p   # 비선택 옵션 제외
    assert "CP" not in p

def test_prompt_full_includes_all_optional_ignoring_arg():
    p = build_agent_prompt(_PERSONA, "정책", "full", optional_fields=())
    for v in ("AP", "TP", "CP", "SP", "SE", "C", "H"):
        assert v in p
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k prompt_ -v`
Expected: FAIL

- [ ] **Step 3: 구현**

```python
def build_agent_prompt(
    persona: dict,
    policy: str,
    persona_depth: str = "standard",
    optional_fields: tuple[str, ...] | None = None,
) -> str:
    profile = persona.get("structured_profile") or {}
    structured = {k: profile.get(k) for k in STRUCTURED_PROFILE_KEYS}
    if persona_depth == "minimal":
        narrative_keys: tuple[str, ...] = ()
    else:
        if persona_depth == "full":
            chosen_optional = OPTIONAL_NARRATIVE_FIELDS
        else:  # standard
            allowed = set(optional_fields or ())
            chosen_optional = tuple(k for k in OPTIONAL_NARRATIVE_FIELDS if k in allowed)
        narrative_keys = CORE_NARRATIVE_KEYS + chosen_optional

    context = persona.get("narrative_context") or {}
    structured_text = "\n".join(
        f"{k}: {v}" for k, v in structured.items() if v not in ("", None)
    )
    narrative_text = "\n".join(
        f"{k}: {context.get(k)}" for k in narrative_keys if context.get(k) not in ("", None)
    )
    return f"""[Structured Profile]
{structured_text}

[Narrative Context]
{narrative_text}

[Policy]
{policy}

[Question]
위 정책 방향에 대해 당신은 찬성, 반대, 중립 중 어느 쪽에 가장 가깝습니까?
당신의 생활 맥락에서 실제로 떠올릴 만한 이유를 바탕으로 답하십시오."""
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k prompt_ -v`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/llm_client.py backend/tests/test_llm_and_api.py
git commit -m "feat(prompt): 3-tier build_agent_prompt with policy-selected optional narrative"
```

---

### Task 4: optional_fields를 호출부 3곳에 스레딩 (llm_client)

**Files:**
- Modify: `backend/app/services/llm_client.py:301-310` (`build_agent_messages`), `:314-327` (`build_agent_llm_payload`), `:460-484` (`stream_openai_agent_response`)
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
from app.services.llm_client import build_agent_messages, build_agent_llm_payload

def test_messages_thread_optional_fields():
    msgs = build_agent_messages(_PERSONA, "정책", "standard", optional_fields=("arts_persona",))
    assert "AP" in msgs[1]["content"] and "TP" not in msgs[1]["content"]

def test_payload_thread_optional_fields():
    payload = build_agent_llm_payload(_PERSONA, "정책", persona_depth="standard", optional_fields=("arts_persona",))
    assert "AP" in payload["messages"][1]["content"]
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k thread_optional -v`
Expected: FAIL (TypeError: unexpected keyword 'optional_fields')

- [ ] **Step 3: 구현 — 세 함수 시그니처에 optional_fields 추가**

```python
def build_agent_messages(persona, policy, persona_depth="standard",
                          model_provider="openai", optional_fields=None):
    return [
        {"role": "system", "content": SYSTEM_PROMPT_OPENAI},
        {"role": "user", "content": build_agent_prompt(persona, policy, persona_depth, optional_fields)},
    ]

def build_agent_llm_payload(persona, policy, model_name=None, thinking=False,
                            persona_depth="standard", model_provider="openai", optional_fields=None):
    return {
        "agent_id": persona["agent_id"],
        "model": model_name or DEFAULT_OPENAI_MODEL,
        "format": "json",
        "messages": build_agent_messages(persona, policy, persona_depth, model_provider, optional_fields),
    }

def stream_openai_agent_response(persona, policy, model_name=DEFAULT_OPENAI_MODEL,
                                 persona_depth="standard", thinking=False, optional_fields=None):
    raw_output = ""
    try:
        from openai import OpenAI
        client = OpenAI(api_key=get_openai_api_key())
        stream = client.chat.completions.create(
            model=model_name,
            response_format={"type": "json_object"},
            messages=build_agent_messages(persona, policy, persona_depth, optional_fields=optional_fields),  # ← 변경
            **openai_reasoning_options(thinking),
            stream=True,
        )
        # ... 이하 기존 본문(L479-) 그대로 ...
```

> L475의 `build_agent_messages(persona, policy, persona_depth)` 한 줄만 `optional_fields=optional_fields` 추가로 교체. 이걸 빠뜨리면 단위 테스트는 통과해도 **실 스트리밍에서 옵션이 누락**되고 프리뷰≠실프롬프트가 된다(Task 8 Step 2가 이를 잡음).

- [ ] **Step 4: 통과 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k thread_optional -v`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/llm_client.py backend/tests/test_llm_and_api.py
git commit -m "feat(prompt): thread optional_fields through message/payload/stream builders"
```

---

## Phase 2 — structure_policy 옵션 선택

### Task 5: `structure_policy`에 옵션 필드 선택 + 교집합 필터 + 불변 반환

**Files:**
- Modify: `backend/app/services/llm_client.py:156-206` (`fallback_structured_policy`, `_structure_policy_raw` 프롬프트, `structure_policy`)
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
import app.services.llm_client as llm

def test_structure_policy_filters_optional_fields(monkeypatch):
    # LLM raw 출력을 모킹: 메뉴 안 1개 + 메뉴 밖 1개 + 환각 1개
    raw = (
        '{"policy_name":{"value":"문화바우처","source":"stated"},'
        '"target":{"value":null,"source":"inferred"},'
        '"apply_method":{"value":null,"source":"inferred"},'
        '"exclusions":{"value":null,"source":"inferred"},'
        '"context":{"value":null,"source":"inferred"},'
        '"relevant_optional_fields":["arts_persona","occupation","__hacked__"]}'
    )
    monkeypatch.setattr(llm, "_structure_policy_raw", lambda _t: raw)
    out = llm.structure_policy("정책")
    assert out["relevant_optional_fields"] == ("arts_persona",)   # 메뉴 밖·환각 제거
    assert isinstance(out["relevant_optional_fields"], tuple)      # 불변

def test_structure_policy_fallback_has_empty_optional(monkeypatch):
    monkeypatch.setattr(llm, "_structure_policy_raw", lambda _t: "NOT JSON")
    out = llm.structure_policy("정책")
    assert out["relevant_optional_fields"] == ()
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k structure_policy -v`
Expected: FAIL

- [ ] **Step 3: 구현 — 프롬프트 메뉴 주입**

```python
# _structure_policy_raw 의 system content 끝에 메뉴·지시 추가:
                    "Extract only neutral execution details from a Korean policy draft. "
                    "Do not evaluate risks or invent problems. Return JSON with fields "
                    "policy_name, target, apply_method, exclusions, context. Each field must be "
                    '{"value":"string or null","source":"stated or inferred"}. '
                    "Also return relevant_optional_fields: an array choosing ONLY from this exact "
                    f"menu of persona narrative fields that meaningfully affect responses to THIS "
                    f"policy: {list(OPTIONAL_NARRATIVE_FIELDS)}. "
                    "Return [] if none clearly apply. Do not invent field names."
```

- [ ] **Step 4: 구현 — 파싱 후 교집합 필터 + 폴백**

```python
def fallback_structured_policy(policy_text: str) -> dict:
    # ... 기존 5필드 ...
        "context": {"value": stripped or None, "source": "stated"},
        "relevant_optional_fields": (),     # 신규
    }

def structure_policy(policy_text: str) -> dict:
    try:
        parsed = parse_json_object(_structure_policy_raw(policy_text))
        structured = {}
        for field in STRUCTURED_POLICY_FIELDS:
            raw = parsed.get(field)
            if isinstance(raw, dict):
                structured[field] = _policy_field(raw.get("value"), raw.get("source"))
            else:
                structured[field] = _policy_field(raw, "inferred")
        # 옵션 필드: 메뉴 교집합 + 순서 고정 + 불변
        requested = parsed.get("relevant_optional_fields")
        chosen = ()
        if isinstance(requested, list):
            req = {str(x) for x in requested}
            chosen = tuple(k for k in OPTIONAL_NARRATIVE_FIELDS if k in req)
        structured["relevant_optional_fields"] = chosen
        if not structured["policy_name"]["value"]:
            structured["policy_name"] = fallback_structured_policy(policy_text)["policy_name"]
        return structured
    except Exception:
        return fallback_structured_policy(policy_text)
```

- [ ] **Step 5: 통과 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k structure_policy -v`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/llm_client.py backend/tests/test_llm_and_api.py
git commit -m "feat(structure_policy): LLM selects optional narrative fields from fixed menu"
```

---

### Task 6: `compute_included_fields` 헬퍼 (투명성 단일 출처)

**Files:**
- Modify: `backend/app/services/llm_client.py` (상수 아래)
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
from app.services.llm_client import compute_included_fields

def test_included_fields_minimal():
    assert compute_included_fields("minimal", ("arts_persona",)) == list(STRUCTURED_PROFILE_KEYS)

def test_included_fields_standard_adds_core_and_selected():
    out = compute_included_fields("standard", ("arts_persona",))
    assert out == list(STRUCTURED_PROFILE_KEYS) + list(CORE_NARRATIVE_KEYS) + ["arts_persona"]

def test_included_fields_full_adds_all_optional():
    out = compute_included_fields("full", ())
    assert out == list(STRUCTURED_PROFILE_KEYS) + list(CORE_NARRATIVE_KEYS) + list(OPTIONAL_NARRATIVE_FIELDS)
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k included_fields -v`
Expected: FAIL (ImportError)

- [ ] **Step 3: 구현**

```python
def compute_included_fields(persona_depth: str, optional_fields: tuple[str, ...]) -> list[str]:
    fields = list(STRUCTURED_PROFILE_KEYS)
    if persona_depth == "minimal":
        return fields
    fields += list(CORE_NARRATIVE_KEYS)
    if persona_depth == "full":
        fields += list(OPTIONAL_NARRATIVE_FIELDS)
    else:  # standard
        allowed = set(optional_fields or ())
        fields += [k for k in OPTIONAL_NARRATIVE_FIELDS if k in allowed]
    return fields
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k included_fields -v`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add backend/app/services/llm_client.py backend/tests/test_llm_and_api.py
git commit -m "feat(prompt): compute_included_fields single source for transparency"
```

---

## Phase 3 — SSE 배관 + 토큰 가드

### Task 7: full + 대N 토큰 가드 (스키마 검증)

**Files:**
- Modify: `backend/app/models/schemas.py:6-12`
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: 실패 테스트 작성**

```python
import pytest
from pydantic import ValidationError
from app.models.schemas import SimulateRequest

FULL_AGENT_LIMIT = 20

def test_full_mode_rejects_large_n():
    with pytest.raises(ValidationError):
        SimulateRequest(policy="p", n_agents=30, persona_depth="full")

def test_full_mode_allows_small_n():
    req = SimulateRequest(policy="p", n_agents=20, persona_depth="full")
    assert req.persona_depth == "full"

def test_standard_mode_allows_large_n():
    req = SimulateRequest(policy="p", n_agents=100, persona_depth="standard")
    assert req.n_agents == 100
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k full_mode -v`
Expected: FAIL (no validation error raised)

- [ ] **Step 3: 구현 — model_validator 추가**

```python
from pydantic import BaseModel, Field, field_validator, model_validator

FULL_AGENT_LIMIT = 20

class SimulateRequest(BaseModel):
    # ... 기존 필드 ...

    @model_validator(mode="after")
    def full_depth_limits_agents(self):
        if self.persona_depth == "full" and self.n_agents > FULL_AGENT_LIMIT:
            raise ValueError(
                f"persona_depth='full' supports at most {FULL_AGENT_LIMIT} agents (got {self.n_agents}). "
                "Use 'standard' for larger runs."
            )
        return self
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k full_mode -v`
Expected: PASS

- [ ] **Step 5: 프론트 가드 — full+대N을 422로 터지게 두지 않기 (ExperimentPage)**

백엔드가 `full`+`n_agents>20`을 거부하면 `simulate()`는 `Simulation request failed: 422`만 던진다(api.ts L301). UI(ExperimentPage)는 full을 허용(L698)하고 nAgents 기본 30(L417)이라 사용자가 그대로 실행하면 불친절한 실패. 실행 전 가드:

```tsx
// ExperimentPage: 실행 버튼 disabled 조건 + 안내 카피
const FULL_AGENT_LIMIT = 20
const fullModeBlocked = personaDepth === "full" && nAgents > FULL_AGENT_LIMIT
// 실행 버튼: disabled={isRunning || fullModeBlocked || ...}
// 안내: {fullModeBlocked && <p className="field-hint warn">풍부(full) 모드는 최대 {FULL_AGENT_LIMIT}명까지입니다. 인원을 줄이거나 중간(standard) 모드를 쓰세요.</p>}
```

> 선택적으로 nAgents 입력에 `max`를 personaDepth에 따라 동적으로(`full`이면 20) 줘도 됨. 핵심은 **백엔드 거부 전에 UI가 막고 이유를 설명**하는 것.

- [ ] **Step 6: 통과 확인 (프론트 타입체크)**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add backend/app/models/schemas.py backend/tests/test_llm_and_api.py frontend/src/App.tsx
git commit -m "feat(schema): cap n_agents for persona_depth=full; guard in UI"
```

---

### Task 8: simulate.py — 옵션 추출·스레딩·included_fields·페이로드

**Files:**
- Modify: `backend/app/api/simulate.py:119-135` (`stream_configured_agent_response_with_heartbeat`), `:147-185` (`stream_agent_sse_events`), `:188-211` (`stream_openai_agent_sse_events_parallel`), `:214-241` (`simulation_stream`)
- Test: `backend/tests/test_llm_and_api.py`

- [ ] **Step 1: 기존 SSE 테스트 스텁을 새 kwarg에 견디게 보정 (선행 — 안 하면 회귀 깨짐)**

`stream_configured_agent_response_with_heartbeat`가 `optional_fields`를 `stream_openai_agent_response`까지 forward하므로, 이를 대체(monkeypatch)하는 **모든** 테스트 스텁이 `optional_fields`를 받아야 한다. **먼저 전수 검색**으로 누락 없이 찾는다:

```bash
cd backend && grep -nE "def .*\(persona, policy" tests/test_llm_and_api.py
```

확인된 대체 스텁(최소 7곳): `patch_fast_simulation` 기본 람다 `:871`, `:931`, `:1028`, `legacy_agent_stream` `:1109`, `keyword_only_agent_stream` `:1140`, `:1260`, `:1289`. **각 스텁 시그니처 끝에 `**kwargs`(권장) 또는 `optional_fields=None` 추가** — `**kwargs`가 미래 인자 추가에도 안전:

```python
# 변경 전
def _fake_stream(persona, policy, model_name=DEFAULT_OPENAI_MODEL, persona_depth="standard", thinking=False):
    ...
# 변경 후 (권장: **kwargs로 모든 추가 인자 흡수)
def _fake_stream(persona, policy, model_name=DEFAULT_OPENAI_MODEL, persona_depth="standard", thinking=False, **kwargs):
    ...
```

> grep 결과가 위 7곳보다 많으면 **전부** 고친다. 하나라도 빠지면 `pytest -q`(Step 7)에서 `TypeError: unexpected keyword argument 'optional_fields'`로 깨진다.

- [ ] **Step 2: 실패 테스트 작성 (실 TestClient + SSE 파싱, 가상 픽스처 금지)**

```python
import json
from fastapi.testclient import TestClient
from app.main import app   # 기존 SSE 테스트가 import하는 동일 경로 사용

def _collect_sse(body: str):
    events = []
    for block in body.split("\n\n"):
        etype, data = None, []
        for line in block.splitlines():
            if line.startswith("event:"): etype = line[6:].strip()
            elif line.startswith("data:"): data.append(line[5:].strip())
        if etype and data:
            events.append({"type": etype, "data": json.loads("\n".join(data))})
    return events

def test_policy_structured_event_emits_included_fields(monkeypatch):
    monkeypatch.setattr(
        "app.api.simulate.structure_policy",
        lambda _p: {
            "policy_name": {"value": "문화", "source": "stated"},
            "target": {"value": None, "source": "inferred"},
            "apply_method": {"value": None, "source": "inferred"},
            "exclusions": {"value": None, "source": "inferred"},
            "context": {"value": None, "source": "inferred"},
            "relevant_optional_fields": ("arts_persona",),
        },
    )
    patch_fast_simulation(monkeypatch)   # 기존 헬퍼: 에이전트/요약 스트림을 가벼운 스텁으로 대체

    # 실제 스트림 경로까지 optional_fields가 도달하는지 캡처 (프리뷰만 맞고 실스트림이 틀린 false-green 방지)
    seen: list = []
    def capturing_stream(persona, policy, model_name=DEFAULT_OPENAI_MODEL,
                         persona_depth="standard", thinking=False, optional_fields=None):
        seen.append(optional_fields)
        yield {"type": "final", "response": {"stance": "neutral", "rationale": "r"}}
    monkeypatch.setattr("app.api.simulate.stream_openai_agent_response", capturing_stream)

    with TestClient(app) as client:
        resp = client.post("/api/simulate", json={"policy": "문화 정책", "n_agents": 5, "persona_depth": "standard"})
        events = _collect_sse(resp.text)
    ps = next(e for e in events if e["type"] == "policy_structured")
    assert "arts_persona" in ps["data"]["included_fields"]
    assert ps["data"]["relevant_optional_fields"] == ["arts_persona"]
    # 프리뷰(llm_prompt)와 실제 포함 일치
    prompt = next(e for e in events if e["type"] == "llm_prompt")
    assert "arts_persona" in prompt["data"]["messages"][1]["content"]
    # 실제 스트림에 불변 튜플로 도달
    assert seen and all(of == ("arts_persona",) for of in seen)
```

> `capturing_stream`은 `patch_fast_simulation`이 세팅한 에이전트 스텁을 덮어쓴다(순서 주의 — capturing을 뒤에 setattr). `stream_openai_agent_response`는 `app.api.simulate`가 `stream_configured_agent_response_with_heartbeat`→`stream_with_heartbeat`로 호출하는 그 함수이므로, `app.services.llm_client`가 아니라 호출 경로상 바인딩된 이름으로 패치한다(실제 바인딩 확인: `stream_with_heartbeat(stream_openai_agent_response, ...)`는 llm_client의 심볼을 직접 참조하므로 `app.services.llm_client.stream_openai_agent_response`로 패치해야 할 수 있음 — 구현 시 어느 쪽이 실제로 호출되는지 확인 후 정확한 타깃 선택).

> `patch_fast_simulation`은 기존 `test_llm_and_api.py`에 이미 있는 헬퍼(L871 근처)를 그대로 사용한다. `app.main`/`/api/simulate` 경로도 기존 SSE 테스트와 동일.

- [ ] **Step 3: 실패 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k policy_structured_event -v`
Expected: FAIL (KeyError: 'included_fields')

- [ ] **Step 4: 구현 — simulation_stream 옵션 추출 + 페이로드**

```python
# simulation_stream (L219 근처)
from app.services.llm_client import compute_included_fields  # 상단 import에 추가

        structured_policy = structure_policy(policy)
        optional_fields = tuple(structured_policy.get("relevant_optional_fields") or ())
        included_fields = compute_included_fields(req.persona_depth, optional_fields)
        policy_event = {
            **structured_policy,
            "relevant_optional_fields": list(optional_fields),
            "included_fields": included_fields,
            "persona_depth": req.persona_depth,
        }
        yield sse_event("policy_structured", policy_event)
        personas, sampling_plan = sample_personas_with_plan(n_agents)
        yield sse_event("sampling_plan", sampling_plan)
        prepared_agents = []
        for persona in personas:
            yield sse_event("agent_sampled", sampled_event_from_persona(persona))
            yield sse_event(
                "llm_prompt",
                build_agent_llm_payload(
                    persona, policy, model_name=req.model_name, thinking=req.thinking,
                    persona_depth=req.persona_depth, optional_fields=optional_fields,
                ),
            )
            prepared_agents.append(persona)

        async for event_name, event_data in stream_openai_agent_sse_events_parallel(
            req, policy, prepared_agents, optional_fields
        ):
            ...
```

- [ ] **Step 5: 구현 — 병렬 스트리머 3계층에 불변 optional_fields 전달**

```python
async def stream_openai_agent_sse_events_parallel(req, policy, prepared_agents, optional_fields):
    # run_one 내부 호출에 optional_fields 전달
    async def run_one(persona):
        async with semaphore:
            async for event in stream_agent_sse_events(req, policy, persona, optional_fields):
                await send.send(event)
    ...

async def stream_agent_sse_events(req, policy, persona, optional_fields):
    # ...
    async for llm_event in stream_configured_agent_response_with_heartbeat(
        persona, policy, req.model_name, req.thinking, req.persona_depth, optional_fields
    ):
        ...

async def stream_configured_agent_response_with_heartbeat(
    persona, policy, model_name, thinking, persona_depth, optional_fields
):
    async for event in stream_with_heartbeat(
        stream_openai_agent_response, persona, policy, model_name,
        persona_depth=persona_depth, thinking=thinking, optional_fields=optional_fields,
    ):
        yield event
```

> `optional_fields`는 §5-2 #7대로 `tuple`(불변)로만 전달한다. 어느 계층도 `.append`/in-place 필터 금지.

- [ ] **Step 6: 통과 확인**

Run: `cd backend && pytest tests/test_llm_and_api.py -k "policy_structured_event or thread_optional" -v`
Expected: PASS

- [ ] **Step 7: 전체 백엔드 회귀**

Run: `cd backend && pytest -q`
Expected: PASS (기존 테스트 포함 — Step 1 스텁 보정 덕분에 깨지지 않음)

- [ ] **Step 8: 커밋**

```bash
git add backend/app/api/simulate.py backend/tests/test_llm_and_api.py
git commit -m "feat(simulate): thread optional fields, emit included_fields on policy_structured"
```

---

## Phase 4 — 프론트 타입 / 상태 경계

### Task 9: 공유 타입 `StructuredPolicyWithPromptFields` + `PersonaDepth`

**Files:**
- Modify: `frontend/src/lib/api.ts:50-63` (`StructuredPolicy` 근처), `:199-216` (`SimulateEvent`의 policy_structured)
- Test: `frontend/src/lib/api.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
import { describe, it, expectTypeOf } from "vitest"
import type { StructuredPolicyWithPromptFields, PersonaDepth } from "./api"

describe("prompt-field types", () => {
  it("carries optional prompt metadata", () => {
    const v: StructuredPolicyWithPromptFields = {
      policy_name: { value: "x", source: "stated" },
      relevant_optional_fields: ["arts_persona"],
      included_fields: ["age", "occupation"],
      persona_depth: "standard",
    }
    expectTypeOf(v.persona_depth).toEqualTypeOf<PersonaDepth | undefined>()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/api.test.ts`
Expected: FAIL (타입 미존재)

- [ ] **Step 3: 구현**

```typescript
// api.ts
export type PersonaDepth = "minimal" | "standard" | "full"

export type StructuredPolicyWithPromptFields = StructuredPolicy & {
  relevant_optional_fields?: string[]
  included_fields?: string[]
  persona_depth?: PersonaDepth
}

// PolicyStructuredEvent 교체
export type PolicyStructuredEvent = StructuredPolicyWithPromptFields
```

그리고 **기존 중복 union을 `PersonaDepth`로 교체**(DRY):
- `api.ts:218` `SimulateRequest.persona_depth?: "minimal" | "standard" | "full"` → `persona_depth?: PersonaDepth`
- `experimentStorage.ts:23` `ExperimentSnapshotSettings.personaDepth?: "minimal" | "standard" | "full"` → `personaDepth?: PersonaDepth` (api에서 import)

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/api.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api.test.ts
git commit -m "feat(types): shared StructuredPolicyWithPromptFields carrying prompt metadata"
```

---

### Task 10: `CurrentRun`에 persona_depth 보존

**Files:**
- Modify: `frontend/src/lib/currentRunStore.ts:5-15` (`CurrentRun`), `:46-83` (`saveExperimentRunAsCurrentRun`)
- Modify: `frontend/src/App.tsx:256-266` (`saveCurrentRun` 호출), `~:670` (`openExperimentResult` → `saveExperimentRunAsCurrentRun` 호출)
- Test: `frontend/src/lib/currentRunStore.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
it("preserves persona_depth and defaults legacy runs to standard", () => {
  saveCurrentRun({
    policy: "p", n_agents: 5, model_name: "gpt-5-mini", model_provider: "openai",
    aggregate: {} as any, sampledAgents: [], responses: [],
    structuredPolicy: { policy_name: { value: "청년 월세", source: "stated" } },
    persona_depth: "full", completedAt: "t",
  })
  expect(getCurrentRunSnapshot()?.persona_depth).toBe("full")
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/currentRunStore.test.ts`
Expected: FAIL (타입에 persona_depth 없음)

- [ ] **Step 3: 구현 — 타입 + saveExperimentRunAsCurrentRun**

```typescript
// currentRunStore.ts
import type { AgentRespondedEvent, AgentSampledEvent, AggregateEvent, PersonaDepth,
              SimulateRequest, StructuredPolicyWithPromptFields } from "./api"

export type CurrentRun = {
  policy: string
  n_agents: number
  model_name: string
  model_provider: "openai"
  aggregate: AggregateEvent
  sampledAgents: AgentSampledEvent[]
  responses: AgentRespondedEvent[]
  structuredPolicy?: StructuredPolicyWithPromptFields
  persona_depth?: PersonaDepth          // 신규
  completedAt: string
}

// saveExperimentRunAsCurrentRun 인자·본문에 personaDepth 추가
export function saveExperimentRunAsCurrentRun({
  policy, nAgents, modelName, modelProvider = "openai", aggregate, sampledAgents,
  responses = [], structuredPolicy, personaDepth = "standard",
  completedAt = new Date().toISOString(),
}: { /* ...기존... */ personaDepth?: PersonaDepth }) {
  saveCurrentRun({
    policy, n_agents: nAgents, model_name: modelName, model_provider: modelProvider,
    aggregate, sampledAgents, responses, structuredPolicy,
    persona_depth: personaDepth, completedAt,
  })
  useCurrentRunStore.getState().setDraftRequest({
    policy, n_agents: nAgents, model_name: modelName, persona_depth: personaDepth,
  })
}
```

- [ ] **Step 4: 구현 — top-level saveCurrentRun 호출에 persona_depth (스코프 주의)**

⚠ **`personaDepth` 변수는 `ExperimentPage`(L420) 안에만 있고 top-level App(L256 `saveCurrentRun`)에는 없다.** top-level "/" 경로엔 깊이 셀렉터 자체가 없어 항상 백엔드 기본 `standard`로 돈다. 따라서 여기선 리터럴 `"standard"`를 저장:

```typescript
// App.tsx L256 saveCurrentRun({...})에 추가 — personaDepth 변수 참조 금지(미정의)
            structuredPolicy: structuredPolicyForRun,
            persona_depth: "standard",              // top-level 경로는 깊이 선택 없음 → 기본값
            completedAt: new Date().toISOString(),
```

> top-level 경로가 `persona_depth`를 요청에 싣지 않는지 확인(`buildSimulateBody`는 넘기지만 이 경로가 값을 안 주면 백엔드 default standard). 실제 깊이를 운반하는 경로는 ExperimentPage의 `saveExperimentRunAsCurrentRun`(Step 3) + `openExperimentResult`(Step 5)다. 인접한 draft request(App.tsx ~L267)도 이 경로가 유지된다면 동일하게 건드릴 필요 없음(깊이 미사용).

- [ ] **Step 5: 구현 — `openExperimentResult` 경로의 깊이 손실 막기 (M2)**

`saveExperimentRunAsCurrentRun`는 `openExperimentResult`(App.tsx ~L670)에서도 호출되는데 여기엔 `personaDepth` 인자가 없어 default `"standard"`로 떨어진다 → minimal/full로 돌린 슬롯이 결과페이지에서 standard로 오표기. 실제 깊이를 넘긴다:

```typescript
// App.tsx openExperimentResult 내 saveExperimentRunAsCurrentRun({...}) 호출에 추가.
// 라이브 실험은 단일 personaDepth 설정으로 모든 슬롯을 돌리므로 컴포넌트 상태 personaDepth를 사용;
// 복원된 스냅샷 결과를 여는 경로라면 snapshot.settings.personaDepth ?? "standard"를 사용.
      personaDepth: personaDepth,   // 또는 복원 경로면 snapshot.settings.personaDepth ?? "standard"
```

> 주: 슬롯별로 깊이가 달라질 수 있는 미래 설계라면 `ExperimentRunState`(App.tsx L355)에 `persona_depth`를 저장해 슬롯별로 넘기는 게 정석. 현재는 실행당 단일 깊이라 컴포넌트 상태로 충분.

- [ ] **Step 6: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/currentRunStore.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/lib/currentRunStore.ts frontend/src/App.tsx frontend/src/lib/currentRunStore.test.ts
git commit -m "feat(state): preserve persona_depth into CurrentRun (incl. experiment-result path)"
```

---

### Task 11: 멀티슬롯 스냅샷 — 슬롯별 structuredPolicy 보존

**Files:**
- Modify: `frontend/src/lib/experimentStorage.ts:31-78` (`ExperimentSnapshotResult`)
- Modify: `frontend/src/lib/experiment.ts:253-269` (`SnapshotRunInput`), `:293-320` (`buildSnapshotResults`)
- Modify: `frontend/src/App.tsx:574-589` (`currentSnapshotInput`), `:1238-1248` (`currentRunFromSnapshot`)
- Test: `frontend/src/lib/experimentStorage.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
it("preserves per-slot structuredPolicy so slot B is not mislabeled with slot A", () => {
  const results = buildSnapshotResults(
    [{ id: "A", presetId: "a", policy: "정책A" }, { id: "B", presetId: "b", policy: "정책B" }],
    {
      A: { aggregate: { total: { support: 1, oppose: 0, neutral: 0 } },
           structuredPolicy: { policy_name: { value: "A", source: "stated" },
                               relevant_optional_fields: ["arts_persona"] } },
      B: { aggregate: { total: { support: 0, oppose: 1, neutral: 0 } },
           structuredPolicy: { policy_name: { value: "B", source: "stated" },
                               relevant_optional_fields: ["skills_and_expertise"] } },
    } as any,
  )
  const b = results.find((r) => r.slotId === "B")!
  expect(b.structuredPolicy?.relevant_optional_fields).toEqual(["skills_and_expertise"])
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/experimentStorage.test.ts`
Expected: FAIL (result.structuredPolicy 없음)

- [ ] **Step 3: 구현 — 타입에 structuredPolicy 추가**

```typescript
// experimentStorage.ts ExperimentSnapshotResult 에 추가
  aggregateRuns?: AggregateEvent[]
  structuredPolicy?: StructuredPolicyWithPromptFields    // 신규 (슬롯별)
}

// experiment.ts SnapshotRunInput 에 추가
type SnapshotRunInput = {
  aggregate?: MinimalAggregate | null
  structuredPolicy?: StructuredPolicyWithPromptFields    // 신규
  // ...기존...
}
```

- [ ] **Step 4: 구현 — buildSnapshotResults가 슬롯별 정책 저장**

```typescript
// experiment.ts buildSnapshotResults 결과 객체에 추가
      {
        slotId: slot.id,
        presetId: slot.presetId,
        total: run.aggregate.total,
        structuredPolicy: run.structuredPolicy,           // 신규
        // ...기존...
      }
```

- [ ] **Step 5: 구현 — currentSnapshotInput가 슬롯별 정책을 runs에 주입 + currentRunFromSnapshot 우선 읽기**

```typescript
// App.tsx currentSnapshotInput: runs 빌드 시 각 슬롯 run.structuredPolicy를 SnapshotRunInput에 포함
//   (buildSnapshotResults에 넘기는 runs 맵의 각 항목에 structuredPolicy: runs[slot.id]?.structuredPolicy)
// top-level structuredPolicy는 하위호환 위해 유지(첫 슬롯).

// App.tsx currentRunFromSnapshot (L1246) 교체:
    structuredPolicy: result.structuredPolicy ?? snapshot.structuredPolicy,   // 결과 우선
    persona_depth: snapshot.settings.personaDepth ?? "standard",              // 신규
```

- [ ] **Step 6: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/experimentStorage.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/lib/experimentStorage.ts frontend/src/lib/experiment.ts frontend/src/App.tsx frontend/src/lib/experimentStorage.test.ts
git commit -m "fix(experiment): persist per-slot structuredPolicy so result metadata matches slot"
```

---

## Phase 5 — 투명성 UI

### Task 12: `PersonaFieldsBadge` 컴포넌트 (양쪽 재사용)

**Files:**
- Create: `frontend/src/result/PersonaFieldsBadge.tsx`
- Create: `frontend/src/result/PersonaFieldsBadge.test.tsx`

- [ ] **Step 1: 실패 테스트 작성 (기존 `renderToStaticMarkup` 스타일 — testing-library 의존성 없음)**

> 이 repo의 컴포넌트 테스트는 `ResultPage.test.tsx:1`처럼 `react-dom/server`의 `renderToStaticMarkup`로 HTML 문자열을 검사한다. `@testing-library/react`·`jest-dom`은 **package.json에 없으므로** 사용 금지.

```tsx
import { renderToStaticMarkup } from "react-dom/server"
import { describe, it, expect } from "vitest"
import { PersonaFieldsBadge } from "./PersonaFieldsBadge"

describe("PersonaFieldsBadge", () => {
  it("shows depth, always-on, and policy-selected groups", () => {
    const html = renderToStaticMarkup(
      <PersonaFieldsBadge depth="standard"
        includedFields={["age", "occupation", "professional_persona", "arts_persona"]}
        selectedOptional={["arts_persona"]} />
    )
    expect(html).toContain("standard")
    expect(html).toContain("직업")        // occupation 라벨
    expect(html).toContain("예술 취향")    // arts_persona 라벨
  })

  it("renders fallback for empty (legacy) data", () => {
    const html = renderToStaticMarkup(
      <PersonaFieldsBadge depth={undefined} includedFields={[]} selectedOptional={[]} />
    )
    expect(html).toContain("항목 정보 없음")
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/result/PersonaFieldsBadge.test.tsx`
Expected: FAIL (컴포넌트 없음)

- [ ] **Step 3: 구현 (라벨 맵 포함)**

```tsx
import type { PersonaDepth } from "../lib/api"

const FIELD_LABELS: Record<string, string> = {
  age: "나이", gender: "성별", province: "시도", district: "시군구", occupation: "직업",
  family_type: "가구형태", marital_status: "혼인", housing_type: "주거", education_level: "학력",
  bachelors_field: "전공", professional_persona: "직업서사", family_persona: "가족서사",
  persona: "종합서사", career_goals_and_ambitions: "진로", cultural_background: "문화배경",
  skills_and_expertise: "기술전문성", arts_persona: "예술 취향", travel_persona: "여행 취향",
  culinary_persona: "미식 취향", sports_persona: "스포츠 취향", hobbies_and_interests: "취미",
}

export function PersonaFieldsBadge({
  depth, includedFields, selectedOptional,
}: { depth?: PersonaDepth; includedFields: string[]; selectedOptional: string[] }) {
  if (!depth && includedFields.length === 0) {
    return <p className="persona-fields-badge empty">항목 정보 없음</p>
  }
  const optional = new Set(selectedOptional)
  const always = includedFields.filter((f) => !optional.has(f))
  const label = (f: string) => FIELD_LABELS[f] ?? f
  return (
    <div className="persona-fields-badge">
      <span className="depth">{depth ?? "standard"}</span>
      <span className="always">항상: {always.map(label).join("·") || "없음"}</span>
      {selectedOptional.length > 0 && (
        <span className="selected">정책 선택: {selectedOptional.map(label).join(", ")}</span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/result/PersonaFieldsBadge.test.tsx`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/result/PersonaFieldsBadge.tsx frontend/src/result/PersonaFieldsBadge.test.tsx
git commit -m "feat(ui): PersonaFieldsBadge transparency component"
```

---

### Task 13: 결과페이지·메인페이지에 배지 장착

**Files:**
- Modify: `frontend/src/result/dashboardModel.ts:37-50` (`DashboardPolicyHeader`/`DashboardModel`), `buildDashboard`
- Modify: `frontend/src/result/ResultPage.tsx:44-66` (헤더)
- Modify: `frontend/src/App.tsx` (ExperimentPage 라이브 실행 패널 — 아래 Step 5 위치 명시)
- Test: `frontend/src/result/ResultPage.test.tsx`

- [ ] **Step 1: 실패 테스트 작성 (결과페이지 영속 렌더, renderToStaticMarkup 스타일)**

```tsx
// ResultPage.test.tsx의 기존 renderToStaticMarkup 패턴 사용 (testing-library 금지)
import { renderToStaticMarkup } from "react-dom/server"
import { it, expect } from "vitest"
import { ResultPage } from "./ResultPage"

it("renders persona field badge from persisted run", () => {
  const run = {
    policy: "문화 정책", n_agents: 5, model_name: "gpt-5-mini", model_provider: "openai",
    aggregate: { total: { support: 5, oppose: 0, neutral: 0 }, by_age: {}, by_gender: {},
      by_region: {}, concern_clusters: [], support_clusters: [], blind_spot_clusters: [],
      complaint_clusters: [], affected_group_clusters: [], reframing_list: [] },
    sampledAgents: [], responses: [],
    persona_depth: "standard",
    structuredPolicy: { policy_name: { value: "문화", source: "stated" },
      included_fields: ["age", "arts_persona"], relevant_optional_fields: ["arts_persona"] },
    completedAt: "t",
  } as any
  const html = renderToStaticMarkup(<ResultPage run={run} onDebug={() => {}} />)
  expect(html).toContain("예술 취향")
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/result/ResultPage.test.tsx`
Expected: FAIL

- [ ] **Step 3: 구현 — dashboardModel이 included_fields/depth/selected 전달**

```typescript
// DashboardModel/DashboardPolicyHeader에 필드 추가
export type DashboardModel = {
  policyHeader: DashboardPolicyHeader
  includedFields: string[]            // 신규
  selectedOptional: string[]          // 신규
  personaDepth?: PersonaDepth         // 신규
  // ...기존...
}

// buildDashboard(run)에서
  return {
    policyHeader: buildPolicyHeader(run.policy, run.structuredPolicy),
    includedFields: run.structuredPolicy?.included_fields ?? [],
    selectedOptional: run.structuredPolicy?.relevant_optional_fields ?? [],
    personaDepth: run.persona_depth,
    // ...기존...
  }
```

- [ ] **Step 4: 구현 — ResultPage 헤더에 배지**

```tsx
// ResultPage.tsx header 내 (정책명 아래)
import { PersonaFieldsBadge } from "./PersonaFieldsBadge"
// ...
        <PersonaFieldsBadge depth={vm.personaDepth} includedFields={vm.includedFields}
                            selectedOptional={vm.selectedOptional} />
```

- [ ] **Step 5: 구현 — 라이브 실행 UI(ExperimentPage)에 배지**

라이브 시뮬레이션 UI는 **`ExperimentPage`**(App.tsx L415~) 안에 있고, 슬롯별 run 상태(`runs[slotId]`)에 `structuredPolicy`가 저장된다(L468 근처). top-level App(L108)의 `structuredPolicy`는 구형 "/" 경로라 라이브 배지 대상이 아니다.

```tsx
// ExperimentPage 내: 현재 트레이스로 선택된 슬롯(selectedTraceSlot ?? 첫 활성 슬롯)의 run을 골라 배지 렌더.
import { PersonaFieldsBadge } from "../result/PersonaFieldsBadge"
// 슬롯 결과/트레이스 패널 헤더에:
{(() => {
  const sp = runs[selectedTraceSlot ?? activeSlotId]?.structuredPolicy
  return sp ? (
    <PersonaFieldsBadge
      depth={personaDepth}
      includedFields={sp.included_fields ?? []}
      selectedOptional={sp.relevant_optional_fields ?? []}
    />
  ) : null
})()}
```

> 슬롯 선택: 트레이스 패널이 보고 있는 슬롯 기준(`selectedTraceSlot`). 없으면 실행된 첫 슬롯. 슬롯마다 정책이 다르므로 **반드시 해당 슬롯의 `runs[slot].structuredPolicy`**를 써야 다른 슬롯 메타와 안 섞인다(Task 11과 동일 원칙).

- [ ] **Step 6: 통과 확인**

Run: `cd frontend && npx vitest run src/result/ResultPage.test.tsx && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/result/dashboardModel.ts frontend/src/result/ResultPage.tsx frontend/src/App.tsx frontend/src/result/ResultPage.test.tsx
git commit -m "feat(ui): show persona field transparency on result and main pages"
```

---

## Phase 6 — 통합 / 회귀

### Task 14: 전체 회귀 + 수동 통합 확인

**Files:** (없음 — 검증만)

- [ ] **Step 1: 백엔드 전체 테스트**

Run: `cd backend && pytest -q`
Expected: PASS

- [ ] **Step 2: 프론트 전체 테스트 + 타입체크**

Run: `cd frontend && npx vitest run && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 구조/순환 점검 (CLAUDE.md 검증 규칙)**

Run: `cd frontend && npx depcruise src --config .dependency-cruiser.* 2>/dev/null || echo "depcruise 설정 없으면 생략"`
Run: `cd frontend && npx knip 2>/dev/null || echo "knip 없으면 생략"`
Expected: 신규 컴포넌트가 미사용으로 잡히지 않음

- [ ] **Step 4: 수동 통합 (실 백엔드)**

문화바우처류 정책 실행 → `policy_structured.relevant_optional_fields`에 `arts_persona` 포함, 배지에 "정책 선택: 예술 취향" 표시 확인.
디지털 전환류 정책 → `skills_and_expertise` 선택 확인.
일반 복지 정책 → 옵션 0~소수.
A/B/C 실험 저장 후 복원 → 슬롯 B 결과 배지가 슬롯 B 메타 표시(슬롯 A 아님).

- [ ] **Step 5: status.md 생성/갱신 후 커밋**

`tasks/persona-prompt-input/status.md`는 아직 없으므로 **새로 생성**한다(Codex 소유 진행상태 파일). 최소 내용:

```markdown
# persona-prompt-input — 진행 상태

- [x] Task 1~14 구현 완료 (백엔드 prompt/structure_policy/simulate, 프론트 상태경계/투명성)
- 백엔드 `pytest -q`: PASS
- 프론트 `vitest run` + `tsc --noEmit`: PASS
- 수동 통합(문화/디지털/일반 정책, 멀티슬롯 복원): 확인
```

```bash
git add tasks/persona-prompt-input/status.md
git commit -m "docs: mark persona-prompt-input implementation complete"
```

---

## Self-Review 메모 (작성자 점검 완료)

- **스펙 커버리지:** §3-1 노이즈 제외(T2), §3-2 구조화10(T2), §3-3 핵심서사(T3), §3-4 조건부+LLM선택(T3·T5), §4 깊이3단(T3), §5 배관·불변·토큰가드(T7·T8), §6 투명성(T12·T13), §7-1 백엔드 타입(T5·T6·T8), §7-2 프론트 상태경계(T9·T10·T11), §8 폴백(T9·T10·T11), §9 테스트(전 태스크) — 매핑 확인.
- **이월 항목(reviews N2·N3):** `included_fields` 생성지점=simulate.py L219(T8), 상수 3종 명명=T1 → 해소.
- **타입 일관성:** `optional_fields`는 백엔드 전 계층 `tuple[str,...]`, 프론트 신규 필드는 `StructuredPolicyWithPromptFields`로 통일.
- **남은 판단:** §3-3 `cultural_background` 조건부 배치(스펙 검토 플래그) — 본 플랜은 조건부로 구현(T1 OPTIONAL에 포함). 실행 중 재논의 가능.
