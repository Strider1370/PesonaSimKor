# 발굴 중심 재설계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 정책 시뮬레이션을 "발굴 도구"로 재설계 — 결정적 계층 분류기 + 슬림 에이전트 출력 + 2층 취합(결정적 코드 + gpt-5.5 발굴 요약기) + 발굴 히트맵 결과 페이지.

**Architecture:** 백엔드가 페르소나를 8축으로 결정적 분류해 응답에 태깅 → 코드가 축×범주 존재/개수 + featured_axis(결정적 공식)를 산출 → gpt-5.5가 near-dup 병합·발굴 정렬·축 rationale만 → 프론트가 태그로 아무 축 재집계(존재/novelty 히트맵). 숫자·축·태그는 코드 결정적, LLM은 텍스트 조직만.

**Tech Stack:** Python(FastAPI, pyarrow/pandas, pydantic), TypeScript(React, zustand), pytest, vitest. OpenAI(control=gpt-5.5, agent=gpt-5-mini).

**참고:** 스펙 `tasks/discovery-redesign/spec.md` (draft v3), 리뷰 `reviews.md`, 목업 `.superpowers/brainstorm/450-*/content/result-page-v9-responsive.html`.

---

## File Structure

**백엔드(신규):**
- `backend/app/services/strata_classifier.py` — 8축 결정적 분류기 + 매핑 로드
- `backend/app/data/occupation_map.json`, `household_map.json`, `housing_map.json`, `education_map.json`, `field_map.json` — 매핑표
- `backend/app/services/discovery_aggregate.py` — 4-a 결정적 취합(존재·개수·featured_axis)
- `backend/app/services/discovery_summarizer.py` — 4-b gpt-5.5 발굴 요약기

**백엔드(수정):** `persona_repository.py`(컬럼 이미 B가 로딩), `llm_client.py`(에이전트 스키마·프롬프트, 요약 삭제), `api/simulate.py`(분류 태깅·SSE 이벤트·요약 블록 교체), `models/schemas.py`(`control_model`).

**프론트(수정):** `lib/api.ts`(타입·이벤트), `App.tsx`(이벤트 switch 양경로·ResponseCard), `lib/currentRunStore.ts`, `lib/experiment.ts`, `lib/experimentCsv.ts`, `result/dashboardModel.ts`, `result/ResultPage.tsx`(+신규 컴포넌트 `DiscoveryHeatmap.tsx`, `VoiceCard.tsx`, `PersonaFieldsBadge`).

---

## Phase 0 — 결정적 분류기 (린치핀)

### Task 1: 직업 8계층 매핑 + 분류기 + 커버리지 게이트

**Files:**
- Create: `backend/app/data/occupation_map.json`, `backend/app/services/strata_classifier.py`
- Test: `backend/tests/test_strata_classifier.py`

> **전제(완료):** 직업 분류는 **검수 완료된 전수 룩업표**가 이미 있다 — `tasks/discovery-redesign/occupation_ksco_major_mapping_final_reviewed.csv`(2,120종, 0 other/0 invalid/100% 커버). Task 1은 *매핑을 만드는 게 아니라* 이 표를 **로드·룩업**한다. 접미어 추정·95% 게이트·감사 생성 전부 불필요(이미 끝남).

- [ ] **Step 1: 룩업 JSON으로 변환 + 데이터 디렉터리로 이동**

```bash
cd backend && python -c "
import csv, json
src='../tasks/discovery-redesign/occupation_ksco_major_mapping_final_reviewed.csv'
m={}
with open(src,encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        m[row['occupation']] = row['ksco_major_code']   # '1'..'9','A','unemployed'
import os; os.makedirs('app/data',exist_ok=True)
json.dump(m, open('app/data/occupation_ksco_map.json','w',encoding='utf-8'), ensure_ascii=False)
print('values',len(m),'codes',sorted(set(m.values())))
"
```
Expected: values=2120, codes=['1'..'9','A','unemployed'].

- [ ] **Step 2: 실패 테스트 작성**

```python
# test_strata_classifier.py
from app.services.strata_classifier import classify_occupation, OCCUPATION_CODES

def test_occupation_codes_are_ksco_major():
    assert OCCUPATION_CODES == ("1","2","3","4","5","6","7","8","9","A","unemployed")

def test_known_occupations_map_to_csv_codes():
    assert classify_occupation("무직") == "unemployed"
    assert classify_occupation("경리 사무원") == "3"        # 사무
    assert classify_occupation("건물 청소원") == "9"        # 단순노무
    assert classify_occupation("건물 경비원") == "4"        # 서비스(검수 결과)

def test_unseen_value_falls_back_to_etc():
    assert classify_occupation("듣도보도못한직업ZZZ") == "etc"   # 표에 없는 새 값 방어
```

- [ ] **Step 3: 실패 확인** — `cd backend && pytest tests/test_strata_classifier.py -k occupation -v` → FAIL(ImportError)

- [ ] **Step 4: 분류기 구현 (룩업)**

```python
# strata_classifier.py
import json
from functools import lru_cache
from pathlib import Path

OCCUPATION_CODES = ("1","2","3","4","5","6","7","8","9","A","unemployed")

@lru_cache(maxsize=1)
def _occ_map() -> dict:
    return json.loads((Path(__file__).parent.parent/"data"/"occupation_ksco_map.json").read_text(encoding="utf-8"))

def classify_occupation(raw: str) -> str:
    return _occ_map().get(str(raw).strip(), "etc")   # 미수록 새 값만 etc
```

- [ ] **Step 5: 통과 확인** — `pytest tests/test_strata_classifier.py -k occupation -v` → PASS

- [ ] **Step 6: 전수 무결성 테스트 (CSV 자체 = 100% 커버, opt-in 불필요)**

```python
def test_every_csv_occupation_classifies_non_etc():
    from app.services.strata_classifier import _occ_map, classify_occupation, OCCUPATION_CODES
    m=_occ_map()
    assert len(m)==2120
    assert all(classify_occupation(k) in OCCUPATION_CODES for k in m)   # 0 etc, 0 invalid
```
(1M행 parquet 스캔 불필요 — 표가 dataset 전수 유니크값을 이미 포함.)

- [ ] **Step 7: 커밋**
```bash
git add backend/app/data/occupation_ksco_map.json backend/app/services/strata_classifier.py backend/tests/test_strata_classifier.py tasks/discovery-redesign/occupation_ksco_major_mapping_final_reviewed.csv tasks/discovery-redesign/occupation_ksco_major_mapping_final_reviewed_summary.md
git commit -m "feat(classifier): load reviewed KSCO-major occupation lookup (2120 values, 100% coverage)"
```

---

### Task 2: 무직 4분해 (결정적 우선순위 + 폴백)

**Files:** Modify `strata_classifier.py`; Test `test_strata_classifier.py`

- [ ] **Step 1: 실패 테스트**

```python
from app.services.strata_classifier import classify_unemployed, UNEMPLOYED_SUBSTRATA

def test_unemployed_substrata_enum():
    assert UNEMPLOYED_SUBSTRATA == ("노년은퇴","청년취준","전업돌봄","구직중","무직_기타")

def test_unemployed_by_explicit_phrase():
    assert classify_unemployed({"professional_persona":"퇴직 후 텃밭을 가꾸며"}, age=67, marital="배우자있음", family="배우자와 거주")=="노년은퇴"
    assert classify_unemployed({"professional_persona":"전업주부로 아이를 키우며"}, age=40, marital="배우자있음", family="배우자·자녀와 거주")=="전업돌봄"

def test_unemployed_skeleton_fallback_when_no_phrase():
    # 상태어 없음 → 뼈대 폴백
    assert classify_unemployed({"professional_persona":"매일 산책을 한다"}, age=70, marital="사별", family="혼자 거주")=="노년은퇴"
    assert classify_unemployed({"professional_persona":"게임을 좋아함"}, age=24, marital="미혼", family="부모와 동거")=="청년취준"
    assert classify_unemployed({"professional_persona":"가족을 챙긴다"}, age=45, marital="배우자있음", family="배우자·자녀와 거주")=="전업돌봄"
    assert classify_unemployed({"professional_persona":"별 내용 없음"}, age=50, marital="이혼", family="혼자 거주")=="구직중"

def test_unemployed_etc_when_missing():
    assert classify_unemployed({"professional_persona":""}, age=None, marital="", family="")=="무직_기타"
```

- [ ] **Step 2: 실패 확인** — `pytest -k unemployed -v` → FAIL

- [ ] **Step 3: 구현**

```python
UNEMPLOYED_SUBSTRATA = ("노년은퇴","청년취준","전업돌봄","구직중","무직_기타")
_PHRASES = {"노년은퇴":("은퇴","퇴직","정년"), "전업돌봄":("주부","전업","육아","살림"),
            "청년취준":("취업","구직","일자리","이직","학생","학업")}

def classify_unemployed(narr: dict, age, marital, family) -> str:
    text = str(narr.get("professional_persona","")) + str(narr.get("persona",""))
    for sub, kws in _PHRASES.items():
        if any(k in text for k in kws): return sub
    if age is None: return "무직_기타"
    age = int(age)
    if age >= 60: return "노년은퇴"
    if age < 35 and ("미혼" in str(marital)) and ("부모" in str(family) or "혼자" in str(family)): return "청년취준"
    if 35 <= age < 60 and ("자녀" in str(family)): return "전업돌봄"
    return "구직중"
```
`classify_occupation`가 "unemployed"면 호출부에서 `classify_unemployed`로 세분(최종 stratum = 4분해 값).

- [ ] **Step 4: 통과** — `pytest -k unemployed -v` → PASS

- [ ] **Step 5: 폴백 비율 감사**
```bash
cd backend && python -c "
import pandas as pd, glob
from app.services.strata_classifier import classify_unemployed
cols=['age','marital_status','family_type','professional_persona','persona','occupation']
df=pd.read_parquet(sorted(glob.glob('../data/Nemotron-Personas-Korea/data/train-*.parquet')),columns=cols)
from app.services.strata_classifier import classify_occupation
u=df[df['occupation'].map(lambda x: classify_occupation(x)=='unemployed')]  # 무직+전직·구직중 등 982종
res=u.apply(lambda r: classify_unemployed({'professional_persona':r['professional_persona'],'persona':r['persona']}, r['age'], r['marital_status'], r['family_type']), axis=1)
print(res.value_counts().to_dict())
"
```
4분해 분포 확인 — `무직_기타`가 과도하면 폴백 규칙 점검.

- [ ] **Step 6: 커밋** — `git commit -m "feat(classifier): deterministic 4-way unemployed split with skeleton fallback"`

---

### Task 3: 가구·주거·학력·전공 매핑 + 통합 `classify_persona`

**Files:** `*_map.json`, `strata_classifier.py`; Test 동일

- [ ] **Step 1: 실패 테스트**
```python
from app.services.strata_classifier import classify_persona
# ⚠ 실제 레코드 형태(normalize_record): 필드는 structured_profile/narrative_context에 *중첩*됨 (리뷰 B2)
def test_classify_persona_reads_nested_record():
    rec = {
      "age":41, "gender":"female", "age_group":"40s", "region_group":"capital",
      "structured_profile":{"age":41,"gender":"female","province":"서울특별시","district":"마포구",
        "occupation":"회계 사무원","family_type":"배우자·자녀와 거주","marital_status":"배우자있음",
        "housing_type":"아파트","education_level":"4년제 대학교","bachelors_field":"경영·행정·법"},
      "narrative_context":{"professional_persona":"", "persona":""},
    }
    t = classify_persona(rec)
    assert set(t) == {"age_band","gender","region_group","occupation_stratum",
        "household_stratum","housing_stratum","education_stratum","field_stratum"}
    assert t["occupation_stratum"]=="3"          # 회계/경리 사무원 = KSCO 3 사무
    assert t["household_stratum"]=="부부+자녀"
```
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `household_map.json`(39→6), `housing_map.json`·`education_map.json`·`field_map.json`(직접 매핑).
  - **입력 계약(리뷰 B2):** `classify_persona(rec)`는 `rec["structured_profile"][...]`(occupation·family_type·marital_status·housing_type·education_level·bachelors_field)와 `rec["narrative_context"][...]`(professional_persona·persona)를 읽는다. `age_band`=`rec["age_group"]`, `region_group`=`rec["region_group"]`(이미 B가 산출). occupation=="unemployed" 시 §무직 4분해 호출(structured_profile의 marital_status/family_type + narrative 사용).
  - **출력 occupation_stratum 문자열 형식 고정(리뷰 m1):** 취업 = **KSCO 코드** `"1".."9"`,`"A"`(표시 라벨은 프론트 code→한글 맵), `unemployed`는 4분해 = `unemployed_노년은퇴`/`unemployed_청년취준`/`unemployed_전업돌봄`/`unemployed_구직중`/`unemployed_기타`, 표 밖 새 값 = `etc`. **이 문자열이 교차 계약**(event=api.ts=dashboardModel 동일). 다른 7축도 각 enum 문자열 고정.
- [ ] **Step 4: 통과** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(classifier): household/housing/education/field maps + classify_persona 8-axis"`

---

## Phase 1 — 에이전트 출력 스키마

### Task 4: 새 스키마 + grounding 규칙 (parse_agent_response, SYSTEM_PROMPT)

**Files:** `llm_client.py`(L64 SYSTEM_PROMPT_OPENAI, **L272 parse_agent_response** — L218 아님); Test `test_llm_and_api.py`

- [ ] **Step 0: 기존 파스 테스트 마이그레이션(리뷰 M3)** — 제거 필드를 단언하는 기존 테스트를 삭제/수정: `test_parse_agent_response_keeps_caveat_and_stance_strength`(L277), `test_parse_agent_response_keeps_openai_only_fields_for_openai`(L228), `test_parse_agent_response_keeps_openai_fields_without_provider_branch`(L246), `test_response_event_includes_complaint_and_demographics`(L922, 데모 단언 갱신). 안 하면 Step 4 통과·Task 15 회귀 실패.

- [ ] **Step 1: 실패 테스트**
```python
from app.services.llm_client import parse_agent_response
def test_parse_new_schema_fields():
    raw='{"stance":"반대","rationale":"r","blind_spot":"b","blind_spot_reason":"내 직업상","affected_group":"고령층","grounding":"inferred","reframing":"왜 서울만","expected_complaint":"신청 어디서"}'
    r=parse_agent_response(raw)
    assert r["blind_spot_reason"]=="내 직업상" and r["grounding"]=="inferred"
    assert "stance_strength" not in r and "caveat" not in r and "persona_link" not in r
```
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `parse_agent_response`에서 제거 필드 파싱 삭제, `blind_spot_reason`·`grounding`(enum direct/inferred 검증) 추가. `SYSTEM_PROMPT_OPENAI` JSON 스키마 교체 + `GROUNDING_RULES` 블록 추가("직접 적힌 사실=direct, 맥락 추론=inferred").
- [ ] **Step 4: 통과** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(agent): slim discovery schema + grounding rule block"`

---

## Phase 2 — 분류 태깅을 응답 페이로드에

### Task 5: response_event에 8축 태그 + 새 필드

**Files:** `api/simulate.py`(**L57** response_event_from_result, 제거 필드 L70-77); Test `test_llm_and_api.py`
**의존(리뷰):** classify_persona는 persona 레코드의 `structured_profile`/`narrative_context`를 읽음 → 이 호출부에서 **원본 persona 레코드**(이벤트 dict 아님)를 넘겨야 함. 또한 스펙 B가 `professional_persona` 등을 `REQUIRED_COLUMNS`/`narrative_context`에 로딩했는지 **선행 확인**(미병합 시 분류기 입력 결측 → B 먼저).

- [ ] **Step 1: 실패 테스트** (SSE에서 agent_responded가 8축 태그 + blind_spot_reason/grounding 보유, 제거 필드 없음 — 기존 TestClient SSE 패턴 사용)
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `response_event_from_result`에서 `stance_strength·caveat·persona_link` 제거, `blind_spot_reason·grounding` 추가, `classify_persona(persona)`로 8축 태그 머지.
- [ ] **Step 4: 통과** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(simulate): tag agent_responded with 8-axis strata + new schema"`

---

## Phase 3 — 취합 4-a (결정적)

### Task 6: discovery_aggregate 모듈 (존재·개수·featured_axis 공식)

**Files:** Create `discovery_aggregate.py`; Test `test_discovery_aggregate.py`

- [ ] **Step 1: 실패 테스트**
```python
from app.services.discovery_aggregate import compute_discovery_aggregate
def _resp(aid, occ, blind):
    return {"agent_id":aid,"occupation_stratum":occ,"age_band":"60s","gender":"female",
            "region_group":"capital","household_stratum":"1인","housing_stratum":"아파트",
            "education_stratum":"고등학교","field_stratum":"해당없음",
            "blind_spot": blind, "stance":"찬성"}
def test_presence_headcount_no_rate():
    agg=compute_discovery_aggregate([_resp(0,"unemployed_노년은퇴","b1"),_resp(1,"3",None)])
    cell=agg["axes"]["occupation_stratum"]["unemployed_노년은퇴"]
    assert cell["presence"] is True and cell["blind_spot_headcount"]==1 and cell["agent_ids"]==[0]
    assert "rate" not in cell and "ratio" not in cell
def test_featured_axis_is_deterministic():
    rs=[_resp(0,"unemployed_노년은퇴","b"),_resp(1,"unemployed_노년은퇴","b2"),_resp(2,"3",None)]
    a1=compute_discovery_aggregate(rs); a2=compute_discovery_aggregate(rs)
    assert a1["featured_axis"]["primary"]==a2["featured_axis"]["primary"]  # 재현
```
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — 8축 순회, `(축,범주)`별 presence/headcount/agent_ids/category_population 집계. `score(axis)=Σ presence×headcount×(1/sqrt(pop))`, `featured_axis=argmax`. 비율 미산출.
- [ ] **Step 4: 통과** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(aggregate): deterministic discovery aggregate + featured_axis formula"`

---

## Phase 4 — 취합 4-b (gpt-5.5 발굴 요약기) + 배선

### Task 7: control_model 설정

**Files:** `models/schemas.py`, `llm_client.py`(`structure_policy` L191/`_structure_policy_raw` L168), `api/simulate.py`(structure_policy 호출 L219); Test `test_llm_and_api.py`
- [ ] **Step 1~4 (TDD):** `SimulateRequest.control_model: str = "gpt-5.5"` 추가, blank 검증. 테스트로 기본값·주입 확인.
- [ ] **Step 5 (리뷰 m4 — 스펙 §4 "정책 구조화=control_model" 구현):** `structure_policy(policy_text)` → `structure_policy(policy_text, model=...)`로 시그니처 확장(`_structure_policy_raw`가 `DEFAULT_OPENAI_MODEL` 하드코딩 L173 대신 인자 사용), simulate.py 호출에서 `req.control_model` 전달. 테스트로 모델 주입 확인.
- [ ] **Step 6: 커밋** — `git commit -m "feat(schema): control_model config (gpt-5.5) wired into structure_policy + summarizer"`

### Task 8: 발굴 요약기 + 폴백

**Files:** Create `discovery_summarizer.py`; Test `test_discovery_summarizer.py`
- [ ] **Step 1: 실패 테스트** — `summarize_discovery(aggregate, responses, model)` 모킹: LLM 출력(병합 항목 + rationale) 파싱; **실패 시 폴백**(원본 신호 + featured_axis=aggregate 값). 병합 항목 카운트=agent_ids 수 검증.
- [ ] **Step 2: 실패 확인** → FAIL
- [ ] **Step 3: 구현** — `control_model`로 호출, near-dup 병합·발굴 정렬·featured_axis rationale 산출. 메뉴 밖 축 필터. try/except 폴백.
- [ ] **Step 4: 통과** → PASS
- [ ] **Step 5: 커밋** — `git commit -m "feat(summarizer): gpt-5.5 discovery summarizer with deterministic fallback"`

### Task 9: simulate.py 배선 — SSE 이벤트 교체 + 구 요약 삭제

**Files:** `api/simulate.py`(**요약 블록 L264-331**; import L13-22; helper `stream_configured_summary_clusters_with_heartbeat` L140), `llm_client.py`(요약 함수 삭제 §7); Test `test_llm_and_api.py`
- [ ] **Step 1: 기존 요약 테스트 전수 grep 후 마이그레이션(리뷰 — 일부만 나열 시 pytest -q 실패)**

먼저 **전수 검색으로 누락 없이** 찾는다:
```bash
cd backend && rg -n "summary_|stream_openai_summary_clusters|build_summary_llm_payload|normalize_summary|summary_from_text|patch_fast_simulation" tests/test_llm_and_api.py
```
히트 **전부** 삭제/교체(Codex 확인분: build_summary_llm_payload ~L424/432/721, summary_from_text ~L502/532, normalize_summary ~L574/598/638/674/687, summary 스트림/모델 ~L988/1410/1430/1482, `patch_fast_simulation` monkeypatch ~L1050-1063, `test_simulate_stream_event_order_with_summary_stream` ~L1116). `patch_fast_simulation`는 discovery 경로 monkeypatch로 재작성. grep 결과가 위보다 많으면 전부 처리.
- [ ] **Step 2: 실패 테스트** — SSE 순서에 `discovery_aggregate`·`discovery_summary` 포함, 폴백 시에도 `discovery_aggregate` 방출.
- [ ] **Step 3: 실패 확인** → FAIL
- [ ] **Step 4: 구현(방출 순서 명시, 리뷰 m3)** — 요약 블록(L264-331)을 교체: ① `agg = compute_discovery_aggregate(responses)`(코드, featured_axis 포함) → **`discovery_aggregate` 방출** → ② `summary = summarize_discovery(agg, responses, req.control_model)`(gpt-5.5) → **`discovery_summary` 방출**. **요약기 실패해도 ①은 이미 방출됨**(폴백 보장). `aggregate` 이벤트는 stance 분포(보조)만 유지. import L13-22 + L140 helper + §7 함수 제거.
- [ ] **Step 5: 통과 + 회귀** — `pytest -q` → PASS
- [ ] **Step 6: 커밋** — `git commit -m "feat(simulate): discovery aggregate/summary SSE events; remove legacy summarizer"`

---

## Phase 5 — 프론트 타입/이벤트

### Task 10: api.ts 타입 + 이벤트 (**additive-only — 리뷰 B2**)
**Files:** `lib/api.ts`; Test `lib/api.test.ts`
- [ ] TDD: **추가만** — `AgentRespondedEvent`에 `blind_spot_reason/grounding` + 8축 태그 추가(제거 필드는 이때 **삭제 금지**), `SimulateEvent`에 `discovery_aggregate`/`discovery_summary` 추가(summary_* **유지**), 신규 `DiscoveryAggregate`/`DiscoverySummary` 타입 + **JSON 픽스처**(아래 형태). `tsc --noEmit` 그린.
- [ ] **summary_* 이벤트·제거 필드 타입은 Task 11에서 모든 소비자(App·store·CSV) 정리 후 삭제** — 순서 어기면 TS 즉시 깨짐.
- [ ] **DiscoveryAggregate/DiscoverySummary 형태 고정(리뷰 Task12/13 픽스처):**
```typescript
type DiscoveryAggregate = {
  axes: Record<string /*axisKey*/, Record<string /*categoryKey*/,
    { presence: boolean; blind_spot_headcount: number; agent_ids: number[]; category_population: number }>>
  featured_axis: { primary: string; secondary: string | null }
}
type DiscoverySummary = {
  merged_blind_spots: { label: string; text: string; agent_ids: number[]; grounding: "direct"|"inferred" }[]
  merged_reframings: { label: string; agent_ids: number[] }[]
  merged_complaints: { label: string; agent_ids: number[] }[]
  featured_axis_rationale: string
}
```
- [ ] 커밋.

### Task 11: 프론트 소비자 — App 이벤트/카드/스토어/CSV (파일별 분해)
각 항목 = 수정 → `tsc --noEmit` + 관련 테스트 통과 → 커밋.
- [ ] **11a App.tsx 이벤트 switch(메인 ~L242):** `summary_prompt/status/token/heartbeat/error` 핸들 제거, `discovery_aggregate`/`discovery_summary` 누적 상태 추가.
- [ ] **11b App.tsx 실험 경로(~L513):** 동일 이벤트 교체(실험 실행 경로).
- [ ] **11c ResponseCard(~L1024):** `stance_strength·caveat·persona_link` 표시 삭제, `blind_spot_reason·grounding`(배지)·affected_group 표시 추가.
- [ ] **11d currentRunStore.ts / experiment.ts:** 스냅샷에 discovery 산출 보존, 구 스키마 로드 시 레거시/빈 처리.
- [ ] **11e experimentCsv.ts:** 행에서 `stance_strength/caveat/persona_link/summary_*/aggregate_*` → 신규 필드(blind_spot_reason/grounding/8축 태그) + discovery 집계 행. 테스트 갱신.

### Task 12: dashboardModel 교체
**Files:** `result/dashboardModel.ts`; Test `dashboardModel.test.ts`
- [ ] TDD(리뷰 M4 — 구체 픽스처로): Task 10의 `DiscoveryAggregate`/`DiscoverySummary` 형태로 **고정 입력 픽스처** 작성 → view model 출력을 **정확 단언**(어느 축·범주 셀이 presence/headcount 얼마, featured_axis primary 값, 병합 항목 라벨·N명). 5배열 클러스터 ingestion 제거. 8축 재집계 헬퍼(`(aggregate, axisKey) → 정렬된 셀[]`)·2D 키 포맷(`"axisA|catA__axisB|catB"`) 명시. 커밋.

---

## Phase 6 — 결과 페이지 UI (목업 v9)

### Task 13: DiscoveryHeatmap 컴포넌트 (존재/novelty, 축 토글, 1D/2D N-게이트)
**Files:** Create `result/DiscoveryHeatmap.tsx`; Test `DiscoveryHeatmap.test.tsx`(renderToStaticMarkup)
- [ ] TDD(고정 셀 픽스처 → **정확 라벨·개수 단언**): props=축×범주 셀(presence·headcount·population) + featured_axis. **색=존재/강도(다양성 or 캡 개수), 비율 금지, 칸에 개수 표기**(테스트로 "2명" 포함·"%" 부재 단언). 8축 토글, 2D는 `n_agents>=THRESHOLD`에서만(미만 비활성). 소수계층 마크. 빈 상태. 커밋.

### Task 14: 결과 페이지 컴포넌트 (컴포넌트별 분해, 각 renderToStaticMarkup 테스트→구현→커밋)
- [ ] **14a VoiceCard.tsx:** props=페르소나 신호. 계층 태그 묶음 + stance pill + ⚑사각지대 본문 + blind_spot_reason + affected_group + grounding 배지. 테스트(HTML에 라벨 포함).
- [ ] **14b 반문/민원 병합 리스트 컴포넌트:** 항목 텍스트 + 건수(agent_ids) + 계층 태그 + "더 보기". 발굴 정렬(최다 1 + grounding·반직관).
- [ ] **14c ResultPage 레이아웃:** v9(메인+우측 레일, 반응형 `max-width:min(1360px,94vw)`, ≤1080px 단일칼럼). 상단 타일 + 강조 축 훅 + 입장 분포(**"모델 응답 구성(표본), 여론 아님" 라벨**, % 금지).
- [ ] **14d 탭 + 조립:** `[사각지대|반문|민원]` 탭. 사각지대=DiscoveryHeatmap(T13)+VoiceCard(14a), 반문/민원=14b. 레일=훅·입장·가구 현황. 영속 run 렌더 테스트.

---

## Phase 7 — 정리/회귀

### Task 15: 전체 회귀 + 폴링 잔존 격리 + 통합 실측
**Files:** 검증 위주
- [ ] **Step 1:** `cd backend && pytest -q` → PASS
- [ ] **Step 2:** `cd frontend && npx vitest run && npx tsc --noEmit` → PASS
- [ ] **Step 3:** 발굴 표면(히트맵·카드)에 % 없음 확인. 실험 비교 stance %·compareWithRealOpinion은 디버그/레거시로 라벨·격리(결과 페이지로 안 샘).
- [ ] **Step 4: 통합 실측** — 외국인가사 N=30을 `control_model=gpt-5.5`로 재실행 → 현행 export 대비 과병합·대표인용 불일치·제목 깨짐 해소 확인. 문화/디지털/일반 정책 featured_axis 분별.
- [ ] **Step 5:** `status.md` 생성 + 커밋.

---

## Self-Review 메모

- **스펙 커버리지:** §3-0 분류기(T1·T2·T3), §3-1 스키마(T4), §6 페이로드(T5), §4-a(T6), §4-b+control_model(T7·T8), SSE/삭제(T9), 프론트 타입/소비자(T10·T11·T12 + §7 인벤토리), §5 UI(T13·T14), 검증/폴링격리(T15) — 매핑 확인.
- **리뷰 블로커 반영:** B1=커버리지 게이트+감사(T1), B2=무직 폴백+감사(T2), B3=결정적 featured_axis 공식·비율금지(T6).
- **위험 지점:** T1 매핑표(실데이터 대조 필수), T2 폴백 비율, T9 SSE 배선·구 테스트 삭제, T11 CSV/실험 소비자 누락 주의.
- **타입 일관성:** 8축 태그 키 = classify_persona 출력 = response event = api.ts 타입 = dashboardModel 재집계에서 동일 문자열.
