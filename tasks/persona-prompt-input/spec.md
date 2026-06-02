# 페르소나 프롬프트 입력 구성 — Spec

**Task ID:** `persona-prompt-input`
**Owner:** Claude (planner/architect)
**상태:** draft v3 (리뷰 1·2 Claude + 리뷰 3 Codex 반영)
**선행/후행 관계:** 이 스펙(B)은 결과페이지 재설계(A, 별도 태스크)의 **선행 조건**이다. A의 무직 분류기가 여기서 노출되는 `professional_persona`를 재사용한다.
**참고 데이터:** `data/Nemotron-Personas-Korea/data/train-*.parquet` (총 26컬럼, **전체 1,000,000행**, occupation 2,120종 — Codex 전수 검증치. ※ 초안의 "111만행·occupation 1,632종"은 9개 파일 중 1개(111,112행)만 표본한 오류였음)

---

## 1. 목적

LLM 에이전트가 정책에 응답할 때 **반쪽짜리 페르소나**로 답하는 문제를 해결한다.

현재 데이터셋엔 서사/묘사 필드가 13개(산문 11 + list 2) 있는데, 파이프라인은 그중 **4개만 로딩·프롬프트 주입**(`persona, cultural_background, career_goals_and_ambitions, hobbies_and_interests`)하고 9개를 버린다. 특히 정책 응답에 직결되는 `professional_persona`(경제활동 상태)·`family_persona`(가구·돌봄 맥락)가 빠져 있다.

이 작업은 단순 "추가"가 아니라 **재구성**이다: 현재 주입되는 4개 중 `cultural_background`·`hobbies_and_interests`는 조건부로 강등되고(§3-4), `professional_persona`·`family_persona`가 핵심으로 승격된다(§3-3).

또한 `persona_depth`(minimal/standard/full) 옵션이 3개로 노출되지만 **standard와 full이 코드상 완전히 동일**하다(`if depth == "minimal" else ...` 구조). 깊이 옵션이 실질적으로 2단계뿐이다.

이 스펙은:
1. 정책 반응 관련성에 근거해 페르소나 필드를 **깊이별로 의미 있게 배치**하고,
2. 조건부 필드(취향·skills)는 **정책을 본 LLM이 켤지 정하도록** 하고,
3. 어떤 항목이 모델에 들어갔는지 **사용자가 볼 수 있게** 한다.

---

## 2. 범위

### In

- `REQUIRED_COLUMNS` 확장: 현재 버려지는 서사 필드 로딩 (`professional_persona`, `family_persona`, `sports_persona`, `arts_persona`, `travel_persona`, `culinary_persona`, `skills_and_expertise`, `hobbies_and_interests_list`, `skills_and_expertise_list`)
- `normalize_record`의 `narrative_context` 재구성 (4개 → 분류된 다수)
- `build_agent_prompt`(llm_client.py)의 깊이 분기 재설계 — minimal/standard/full 3단계 실질화
- `structure_policy` 호출에 **옵션 필드 선택** 출력 추가 (호출 수 불변)
- 선택 결과를 `policy_structured` SSE 이벤트 페이로드에 포함
- 프론트엔드: "이번 실행에 포함된 페르소나 항목" 표시 컴포넌트 1개 — **메인/실행 페이지 + 결과 페이지 양쪽**에 재사용
- 프론트 **상태 경계 작업**(§7-2): 공유 타입 `StructuredPolicyWithPromptFields` 도입, `persona_depth`를 `CurrentRun`까지 보존(구버전 `"standard"` 폴백), 멀티슬롯 실험 스냅샷에 **슬롯별 `structuredPolicy`** 보존
- `country`, `military_status` 필드를 프롬프트에서 **영구 제외**

### Out

- 결과 페이지 재설계 전체 (별도 태스크 A: 집단 위험 띠, 직업/가구 계층 분류, 무직 4분해)
- 무직 경제활동 상태 **분류기**(A의 산출물). B의 책임은 `professional_persona`를 **로딩**(`REQUIRED_COLUMNS`)해 백엔드 persona 레코드(`persona["narrative_context"]`)에 존재하게 하는 것까지다. A의 분류기는 **백엔드에서** 그 레코드를 직접 읽어 동작하므로(앞선 설계: `response_event_from_result` 근처), **B가 raw 값을 프론트엔드까지 노출할 필요는 없다.** (프론트 노출은 §10 드릴다운에서 별도.) → 리뷰 스코프 갭 해소.
- 페르소나별 실제 입력값 드릴다운 UI (항목 목록만, 값 표시는 향후 §10)
- persona_depth UI 노출/기본값 변경 정책 (기본 standard 유지)
- 옵션 필드 선택 결과 캐싱 (재현성 향상, 향후 §10)
- LLM 응답 스키마, 요약기, 집계 로직 (변경 없음)

---

## 3. 필드 분류 — 정책 반응 관련성 판정

이 시뮬레이터의 정책은 구조상 **대상 / 신청방식 / 제외조건 / 맥락** 중심이다(누가 받나·어떻게 신청하나·누가 빠지나·뭐가 부담인가). 이 렌즈로 각 필드가 "정책에 대한 응답을 바꾸는가"를 판정했다.

### 3-1. 영구 제외 (정보량 없음 = 노이즈)

| 필드 | 사유 |
|---|---|
| `country` | 100% "대한민국" (전수 1,000,000행) |
| `military_status` | 99.47% "비현역" (994,718/1,000,000). 사실상 상수 |

### 3-2. 구조화 필드 (10개) — 토큰 비용 무시 가능 → minimal부터 전부 포함

**최종 키 집합(정확히 이 10개):**
`age`, `gender`, `province`, `district`, `occupation`, `family_type`, `marital_status`, `housing_type`, `education_level`, `bachelors_field`

근거: 구조화 필드는 `key: value` 한 줄짜리라 10개 다 넣어도 토큰 증가가 무시할 수준. 깊이로 아낄 대상이 아니다. (`bachelors_field`는 관련성 낮지만 대학 미진학자는 빈 값이라 자동 생략됨 — 비용·노이즈 모두 없음.)

**⚠ 기존 코드와의 정합 (구현 시 필수):**

- 현재 `normalize_record`(persona_repository.py L136-149)의 `structured_profile`은 **12키**(`age, gender, province, district, marital_status, military_status, family_type, housing_type, education_level, bachelors_field, occupation, country`)다. 이 작업은 그 dict에서 `military_status`·`country`를 **제거하는 재작성**이다(단순 컬럼 추가가 아님). 결과가 위 10키가 되어야 한다.
- 데이터셋 원본 컬럼명은 `sex`(코드에서 `gender`로 정규화)이고 지역은 `province`+`district` 두 컬럼이다. 위 목록은 **정규화된 출력 키 이름** 기준이며, `province`·`district` **둘 다 유지**한다(지역 영향 판단에 시군구까지 필요).
- `build_agent_prompt`의 minimal 분기는 현재 `{age, gender, region}` **자체 dict**를 만들어 `structured_profile`을 읽지 않는다(§4-1 참조). minimal을 위 10키로 바꾸려면 minimal도 `structured_profile`(군필·국가 제거본)을 읽도록 변경해야 한다.

### 3-3. 핵심 서사 (4개) — 거의 모든 정책에서 작동 → standard부터 항상 포함(고정)

| 필드 | 판정 | 근거 |
|---|:---:|---|
| `professional_persona` | 높음 | 경제활동 상태·근로조건(교대·초과근무→소득변동). **현재 버려짐** |
| `family_persona` | 높음 | 돌봄 부담·신청 장벽 맥락(노부모 디지털 대리 등). **현재 버려짐** |
| `persona` | 중 | 종합 성향. 인물 정체성의 연결 조직 |
| `career_goals_and_ambitions` | 중 | 경제적 열망·불안. 청년·자산형성류 정책에 작동 |

> **검토 포인트(사용자 확인 요망):** `cultural_background`를 핵심(항상)에 둘지 조건부(LLM 선택)에 둘지. 본 스펙은 관련성 "중–낮음·정책 의존적"으로 보아 **조건부**(3-4)에 배치했다. 다문화·종교·지역문화 정책에서만 유효하다는 판단.

### 3-4. 조건부 서사 (옵션 메뉴) — 정책 도메인이 맞을 때만 → LLM이 선택(standard), 무조건 포함(full)

| 필드 | 평소 | 도메인 매칭 시 |
|---|:---:|---|
| `cultural_background` | 낮음 | 다문화·종교·지역문화 정책 |
| `skills_and_expertise` (+`_list`) | 낮음 | 디지털·기술·자격 정책 |
| `arts_persona` | 노이즈 | 문화·예술 바우처 |
| `travel_persona` | 노이즈 | 교통·관광·이동권 |
| `culinary_persona` | 노이즈 | 식품·외식·농식품 |
| `sports_persona` | 노이즈 | 생활체육·건강 |
| `hobbies_and_interests` (+`_list`) | 낮음 | 여가·문화 일반 |

근거: 이 필드들은 **평소엔 0이지만 정책 도메인이 맞으면 핵심으로 급상승**한다(문화바우처 정책이면 `arts_persona`가 `occupation`만큼 중요). 고정 깊이로는 잘 못 다루므로 LLM 선택(§5)으로 처리.

> **⚠ 동작 회귀 주의:** `cultural_background`와 `hobbies_and_interests`는 **현재 이미 로딩·주입**되고 있다(REQUIRED_COLUMNS L52/L154, narrative_context 4키). 둘을 조건부로 강등하면 **기존 standard 실행에서 이 둘이 기본 출력에서 빠진다.** 이는 의도된 *재구성*이지 순수 추가가 아니다. 정책 도메인이 안 맞으면 standard 프롬프트는 지금보다 *짧아진다*(의도대로).

> **세부 결정(구현 시):** `skills_and_expertise` vs `skills_and_expertise_list`, `hobbies_and_interests` vs `hobbies_and_interests_list` — list 변형은 산문의 압축형(쉼표 구분). 프롬프트엔 **산문 버전 우선**, list는 중복이라 기본 미사용. 토큰 제약 시 list로 교체 가능.

---

## 4. depth 3단계 재설계

**중첩 구조:** `full ⊇ standard ⊇ minimal`. 깊이를 올리면 정보가 추가만 된다.

| 묶음 | minimal | standard (기본) | full |
|---|:---:|:---:|:---:|
| 구조화 10개 (§3-2) | ✅ | ✅ | ✅ |
| 핵심 서사 (§3-3) | ❌ | ✅ | ✅ |
| 조건부 서사 (§3-4) | ❌ | LLM 선택분만 | **전부(LLM 선택 무시)** |
| `country`, `military_status` | ❌ 전 깊이 제외 | ❌ | ❌ |

세 깊이의 의미:
- **minimal** — 완전한 인적사항, 서사 0. 빠르고 싸고, 동일 인물 골격 보장.
- **standard (기본)** — minimal + 정책 반응을 좌우하는 핵심 서사 + 정책 관련 옵션 서사(LLM 선택). "평소엔 안 넣다가 정책 보고 켜는" 동작이 여기 산다.
- **full** — standard + 조건부 서사 전부. LLM 선택을 건너뛰는 상한선("최대 충실도").

### 4-1. `build_agent_prompt` 변경 (시그니처 + 호출부 스레딩)

**시그니처 변경:**
```python
build_agent_prompt(persona, policy, persona_depth="standard", optional_fields: list[str] | None = None)
```
`optional_fields`는 §5의 LLM 선택 결과(정규 narrative 키 목록). `None`/`[]`이면 옵션 서사 0개.

현재 `if persona_depth == "minimal": ... else: ...` 2분기를 3분기로:
- `minimal`: `structured_profile`(군필·국가 제거본) 10키만 직렬화, `narrative_context = {}`. (※ 현재 minimal은 `{age,gender,region}` 자체 dict라 이 부분이 동작 변경.)
- `standard`: 구조화 10개 + 핵심 서사 4개(고정) + `optional_fields`에 든 조건부 필드만
- `full`: 구조화 10개 + 핵심 서사 4개 + 조건부 서사 **전부**(`optional_fields` 무시)

빈 값(`""`/`None`) 필드는 기존대로 직렬화에서 생략.

**호출부 스레딩 (필수 — `optional_fields`를 4개 지점에 전달):**
1. `build_agent_messages`(llm_client.py L301)
2. `build_agent_llm_payload`(L314)
3. `stream_openai_agent_response`(L460/475)
4. `stream_configured_agent_response_with_heartbeat`(simulate.py L119)

이들은 현재 `build_agent_prompt(persona, policy, persona_depth)`를 위치 인자로 호출하므로, `optional_fields`를 받아 그대로 넘기도록 전부 수정한다.

### 4-2. 토큰 비용 의도

서사 필드는 산문 단락이라 토큰의 대부분을 차지한다(구조화 10개는 무시 가능). 따라서:
- **standard(기본)** = 핵심 서사 4개 + 정책 관련 옵션만 → 토큰 절제. 일반 대규모 실행의 기본.
- **full** = 조건부 서사 전부(최대 10+블록/에이전트) → `N`이 크면 비용·지연 급증. **소규모 N 정밀 검증용**으로 의도. 서사 필드별 길이 캡은 도입하지 않되(향후 §10), 이 의도를 문서·UI 카피에 명시.

---

## 5. 정책 인지형 옵션 필드 선택 (LLM)

### 5-1. 메커니즘 + 결과 배관

기존 실행 첫머리의 `structure_policy(policy)` 호출(정책을 target/exclusions 등으로 구조화)에 **출력 한 항목을 추가**한다. **새 LLM 호출을 늘리지 않는다.**

```json
{
  "policy_name": { ... },
  "target": { ... },
  ...,
  "relevant_optional_fields": ["arts_persona", "skills_and_expertise"]
}
```

**⚠ 프롬프트까지의 배관 (필수 — 현재 없음).** `structured_policy = structure_policy(policy)`는 simulate.py L219에서 계산돼 **SSE로만** 나가고, 에이전트 스트리밍(L228 `build_agent_llm_payload`, L238 `stream_openai_agent_sse_events_parallel`)엔 전달되지 않는다. 선택 결과가 프롬프트에 닿으려면 다음 경로로 `optional_fields`를 스레딩해야 한다:

```
structure_policy(policy) → fields = structured_policy["relevant_optional_fields"]
  → stream_openai_agent_sse_events_parallel(req, policy, prepared_agents, fields)   # simulate.py L238
    → stream_agent_sse_events(req, policy, persona, fields)                          # def L147 (호출 L198)
      → stream_configured_agent_response_with_heartbeat(..., optional_fields=fields) # L119
        → stream_openai_agent_response(..., optional_fields=fields)                  # llm_client L460
          → build_agent_messages(..., optional_fields=fields)                        # L301
            → build_agent_prompt(..., optional_fields=fields)                        # L261
```
L228의 `build_agent_llm_payload`(프롬프트 *프리뷰* 이벤트)에도 같은 `fields`를 넘겨 프리뷰와 실제 프롬프트가 일치하게 한다. `req`만으로는 부족하다 — `req`엔 정책 텍스트는 있어도 LLM이 고른 필드 목록은 없다.

### 5-2. 안전장치 (설계의 관건)

1. **재량 범위 제한** — LLM은 §3-4 **조건부 필드만** 토글한다. 구조화·핵심 서사는 항상 켜지며 LLM이 끌 수 없다. → 백본은 결정적으로 유지, LLM이 실수로 핵심 맥락을 떼낼 수 없음.
2. **고정 메뉴(열거형) + 단일 출처 allowlist** — `OPTIONAL_NARRATIVE_FIELDS` 상수(정규 narrative 키 목록, §3-4)를 **한 곳에 정의**하고 두 군데서 공유한다:
   - (a) `structure_policy`의 **시스템 프롬프트에 메뉴로 주입** — 현재 프롬프트(llm_client.py L178-183)는 5개 필드만 요청하므로, "다음 목록에서 이 정책 응답에 의미 있는 항목만 골라 `relevant_optional_fields` 배열로 반환하라" + 메뉴 + "목록 밖 값·자유생성 금지"를 추가한다.
   - (b) `structure_policy` **파싱 후 교집합 필터** — 반환값을 `OPTIONAL_NARRATIVE_FIELDS`와 교집합내어 메뉴 밖 토큰을 버린다. 현재 파서(L195-200)는 `STRUCTURED_POLICY_FIELDS` 5개만 순회하므로 이 키를 별도로 추출·검증하는 로직을 추가해야 한다.
   - 이 필터가 **필드명 프롬프트 인젝션의 실제 방어선**이다(정책 텍스트는 사용자 입력이므로). 필터된 토큰은 절대 `build_agent_prompt`에 닿지 않는다.
3. **enum 토큰 = 정규 narrative 키** — 메뉴 값은 `cultural_background, skills_and_expertise, arts_persona, travel_persona, culinary_persona, sports_persona, hobbies_and_interests` (※ `_list` 변형은 메뉴에 **넣지 않음**; prose↔list 치환은 프롬프트 빌더 내부 사정).
4. **정책당 1회 결정** — 옵션 필드의 관련성은 *정책*의 속성이지 개인의 속성이 아니다. 페르소나마다 다시 묻지 않고, 한 번 정한 목록을 그 실행 전체 에이전트에 동일 적용. (비용·일관성)
5. **폴백** — `structure_policy` 실패/필드 누락/빈 배열 → `relevant_optional_fields = []`(= 핵심 서사만). `fallback_structured_policy`(L156-165)도 이 키를 `[]`로 명시 반환해 프론트 타입·소비자가 안 깨지게 한다.
6. **재현성 경계** — 비결정성은 *옵션 on/off* 한 번에만 갇힌다. 백본·에이전트 응답엔 영향 없음. (정책 해시 기반 캐싱은 향후 §10)
7. **불변 데이터로 전달 (동시성 안전)** — 옵션 목록은 §5-1 경로로 **N개 병렬 에이전트 태스크**(anyio task group, simulate.py L188·L203)가 공유 읽기 한다. 어느 계층도 이 목록을 **제자리(in-place) 필터/append 하면 안 됨** — 동시 태스크가 변형된 상태를 볼 수 있다. → `structure_policy` 직후 **한 번** `tuple[str, ...]`(또는 `frozenset`)로 정규화하고, 모든 계층에 그 불변값을 그대로 전달. 필터링은 정규화 시점 1회만.

### 5-3. full 모드에서의 동작 + 토큰 가드

full은 `relevant_optional_fields`를 **무시**하고 조건부 서사를 전부 포함한다(§4 표). LLM 선택은 standard에서만 의미를 가진다.

**토큰 가드(필수 — §4-2의 "의도"를 실제 강제로):** 백엔드 `SimulateRequest`는 `n_agents`를 최대 100까지 허용하고(schemas.py L6), `build_agent_prompt`는 선택된 서사 필드를 **무절단** 직렬화한다(llm_client.py L285). full + 큰 N이면 프롬프트가 폭증하므로, 다음 중 하나를 *구현 규칙으로 확정*한다(plan에서 임계값 선택):
- (택1·권장) `persona_depth="full"` & `n_agents > THRESHOLD`(예: 20) → **요청 거부 또는 경고**(스키마 검증 단계).
- (보완) 서사 필드별 **문자 수 캡**(예: 각 600자) — full뿐 아니라 비정상 장문 페르소나 방어.
- "의도"만 문서화하고 가드 없음 = **금지**(리뷰 지적). 반드시 하나는 코드로 강제.

---

## 6. 투명성 — "이번 실행에 포함된 페르소나 항목"

### 6-1. 무엇을 (항목 목록 방식)

각 실행에 **어떤 종류의 페르소나 정보가 모델에 들어갔는지** 항목(필드) 목록으로 보여준다. (페르소나별 실제 값 표시는 향후 §10.)

표시 그룹 구분:
- **항상 포함** — 구조화 10개 + (standard/full이면) 핵심 서사 4개
- **정책 선택** — `relevant_optional_fields`로 LLM이 켠 조건부 필드 (standard일 때만 의미)
- **깊이 표기** — 현재 실행의 `persona_depth` (minimal/standard/full)

예시 표시:
> 이번 실행 포함 항목 (standard)
> · 항상: 나이·성별·지역·직업·가구형태·혼인·주거·학력 / 직업서사·가족서사·종합서사·진로
> · 정책 선택: 예술취향, 기술전문성

### 6-2. 어디에 (양쪽 + 컴포넌트 재사용)

- **메인/실행 페이지** — 정책 구조화 직후 "이번 실행은 이 항목들로 돕니다" (실행 전 셋업 투명성)
- **결과 페이지** — 결과 헤더 근처 "이 결과의 근거 항목" (결과 신뢰성·출처)
- 동일한 작은 컴포넌트를 양쪽에서 재사용한다.

### 6-3. 데이터 배관

`structure_policy` 결과는 이미 `policy_structured` SSE 이벤트로 프론트에 흐른다. 여기에 다음을 얹는다:
- `relevant_optional_fields: string[]` — LLM이 켠 옵션 필드(필터 통과분)
- `included_fields: string[]` — 이번 실행에서 **실제로 프롬프트에 포함될** 최종 항목 목록(깊이 적용 + 옵션 합산)

**투명성은 "의도"가 아니라 "실제"를 보여줘야 한다.** 클라이언트가 `persona_depth`+§3 목록으로 "항상 포함"을 재구성하면, 특정 페르소나에서 빈 값이라 생략된 필드(예: 빈 `family_persona`는 L286에서 직렬화 생략)를 "포함"으로 **거짓 표시**할 수 있다. 그래서 백엔드가 **깊이 기준 최종 포함 필드 집합**을 단일 출처로 내려보낸다. (단, 페르소나별 빈 값 편차까지 반영하는 건 과하므로 "이 깊이에서 포함하기로 한 필드" 수준 = 정책·깊이 단위로 충분. 페르소나별 실제 값 유무는 §10 드릴다운에서.)

---

## 7. 타입/스키마 변경

### 7-1. 백엔드

- `persona_repository.REQUIRED_COLUMNS`: §2 In의 서사 필드 추가. `military_status`·`country`는 **REQUIRED_COLUMNS에 남겨둬도 무방** — 제외는 `structured_profile`/프롬프트 레벨에서만 일어난다(로딩 자체는 무해). 즉 §3-1 "영구 제외"는 *프롬프트 주입* 기준이지 *컬럼 로딩* 기준이 아니다.
- `normalize_record`의 `structured_profile`: `military_status`·`country` **제거**(→ §3-2의 10키). `narrative_context`: 4키 → §3-3 핵심 + §3-4 조건부 필드 포함하도록 **재구성**(구조화/핵심서사/조건부서사 분류 명확히).
- `structure_policy` 반환 스키마: `relevant_optional_fields: list[str]` 추가 + `OPTIONAL_NARRATIVE_FIELDS` 교집합 필터(§5-2). `fallback_structured_policy`도 `[]` 반환.
- `OPTIONAL_NARRATIVE_FIELDS` 상수 신설(프롬프트 메뉴 + 필터 + 프롬프트 빌더 공유 단일 출처).
- `policy_structured` SSE 페이로드에 `relevant_optional_fields` + `included_fields`(§6-3) 추가.

### 7-2. 프론트엔드 — 상태 경계 (Codex 리뷰 반영, 단순 타입 추가 아님)

§6 투명성 표시는 결과 페이지에서도 떠야 하는데, 신규 필드를 `PolicyStructuredEvent`(SSE 이벤트)에만 얹으면 **영속/결과 상태 경계를 넘지 못한다.** 영속·결과 경로는 `StructuredPolicy`를 쓰기 때문(api.ts L57, currentRunStore L13, dashboardModel L37). 따라서:

**(1) 타입 경계 — 공유 타입으로 승격**
```typescript
// 신규 필드를 SSE 이벤트가 아니라 "구조화 정책"에 둬야 결과 경로까지 흐른다
export type StructuredPolicyWithPromptFields = StructuredPolicy & {
  relevant_optional_fields?: string[]
  included_fields?: string[]
  persona_depth?: PersonaDepth          // 결과 표시에 필요(아래 2)
}
```
- `PolicyStructuredEvent`, `CurrentRun.structuredPolicy`, `ExperimentSnapshot`의 정책 타입, `DashboardPolicyHeader`(dashboardModel L37)를 이 타입으로 교체.
- `dashboardModel`의 정책 필드 순회는 현재 **5개 고정**(L54)이라 신규 필드를 못 읽음 → 별도 경로로 `included_fields`/`persona_depth`를 헤더 컴포넌트에 전달.

**(2) `persona_depth`를 결과 상태까지 보존 (Major)**
- `CurrentRun`(currentRunStore L5)에 **`persona_depth` 없음** → §6-1 "깊이 표기"가 결과페이지에서 불가.
- `persona_depth`를 `CurrentRun`에 추가하고, `saveCurrentRun`(App.tsx L256)·`saveExperimentRunAsCurrentRun`(currentRunStore L67, CurrentRun+draftRequest 양쪽)·`currentRunFromSnapshot`·스냅샷 변환·테스트에 반영.
- **구버전 저장분(sessionStorage)은 `persona_depth` 없음 → `"standard"`로 디폴트.**

**(3) 멀티슬롯 실험 스냅샷 메타 정합 (Blocker)**
- 실험 스냅샷은 **top-level `structuredPolicy` 하나**만 저장하고 첫 슬롯 것을 선택한다(App.tsx L578). `buildSnapshotResults`는 슬롯별 `structuredPolicy`를 보존하지 않고(experiment.ts L293), `currentRunFromSnapshot`은 항상 `snapshot.structuredPolicy`를 쓴다(App.tsx L1246).
- → A/B/C 실험에서 **슬롯 B 결과가 슬롯 A의 `included_fields`/`relevant_optional_fields`를 표시**하는 버그.
- **수정:** `structuredPolicy`를 각 `ExperimentSnapshotResult`로 내려 슬롯별 보존(`run.structuredPolicy` 저장), `currentRunFromSnapshot`은 `result.structuredPolicy`를 우선 읽기.

`PersonaDepth` = `"minimal" | "standard" | "full"`. 신규 필드는 구버전 호환 위해 모두 optional — 없으면 빈 목록/`"standard"` 처리(§9-3).

---

## 8. 빈 상태 / 폴백 매트릭스

| 상황 | 처리 |
|---|---|
| `structure_policy` 실패 | `relevant_optional_fields = []` → 옵션 서사 0개(standard=핵심 서사만) |
| LLM이 메뉴 밖 필드명 반환 | 정규화에서 제거, 경고 로그 |
| 옵션 필드가 특정 페르소나에서 빈 값 | 기존대로 직렬화 생략 (정상) |
| `persona_depth = minimal` | 옵션 선택 자체 무시(서사 0). 투명성 표시엔 "서사 없음" |
| `persona_depth = full` | `relevant_optional_fields` 무시, 조건부 전부 포함 |
| `full` + 큰 N → 토큰 폭증 | §5-3 토큰 가드로 거부/경고 또는 필드 길이 캡(코드 강제) |
| 구버전 저장 run(`persona_depth` 없음) | `"standard"`로 디폴트(§7-2 (2)) |
| 멀티슬롯 실험 스냅샷 | 슬롯별 `structuredPolicy` 보존, 결과는 `result.structuredPolicy` 우선(§7-2 (3)) |
| 구버전 스냅샷(슬롯별 정책 없음) | top-level `structuredPolicy` 폴백 — 단일 슬롯이면 정확, 멀티슬롯이면 메타 부정확 가능(경고) |

---

## 9. 검증

### 9-1. 백엔드 테스트

- `normalize_record`가 신규 서사 필드를 `narrative_context`에 채움
- `build_agent_prompt(minimal)`: 서사 0, 구조화 10개, `country`/`military_status` 없음
- `build_agent_prompt(standard, optional=["arts_persona"])`: 핵심 서사 4개 + arts_persona 포함, 다른 조건부 미포함
- `build_agent_prompt(full)`: 조건부 서사 전부 포함(optional 인자와 무관)
- `structure_policy` 반환에 `relevant_optional_fields` 존재 + 메뉴 밖 값 필터링
- 폴백: 구조화 실패 시 옵션 0개
- **불변성:** 옵션 목록이 `tuple`/`frozenset`로 전달되고, 어느 계층도 제자리 변형하지 않음(§5-2 #7)
- **SSE 통합:** `policy_structured` 이벤트가 `included_fields`를 방출하고, 그 값이 실제 스트리밍된 `llm_prompt`(L228 프리뷰)의 포함 필드와 **일치**
- **토큰 가드:** `persona_depth="full"` & `n_agents > THRESHOLD` 시 거부/경고(§5-3)

### 9-2. 데이터 검증 (1회성, 스펙 근거 확인)

- **전 9개 parquet 전수**(1,000,000행) 기준: `country` 100% 단일값, `military_status` 994,718/1,000,000, occupation 2,120종 재확인 (※ 단일 파일 표본 금지 — 초안 오류 원인)
- `professional_persona` 100% non-empty 재확인

### 9-3. 프론트엔드 테스트

- 항목 목록 컴포넌트: depth별 "항상 포함" 목록 + 옵션 목록 렌더
- `policy_structured` 이벤트에 신규 필드 없을 때(구버전 호환) 빈 목록·`"standard"` 처리
- **결과페이지 영속 렌더:** 저장된 run을 결과페이지에서 읽어 `included_fields`/`persona_depth` 표시(타입 경계 §7-2 (1)(2))
- **구버전 sessionStorage:** `persona_depth` 없는 저장분이 `"standard"`로 폴백
- **멀티슬롯 스냅샷:** A/B/C 스냅샷에서 슬롯 B 결과가 슬롯 B의 메타를 표시(슬롯 A 것 아님, §7-2 (3))
- 기존 `currentRunStore.test.ts`(L76, `policy_name`만 검증)·이벤트 순서 테스트(`test_llm_and_api.py` L880)는 신규 필드를 안 봄 → 확장 필요

### 9-4. 통합 (수동/회귀)

- 문화바우처류 정책 → `arts_persona` 선택되는지
- 디지털 전환류 정책 → `skills_and_expertise` 선택되는지
- 일반 복지 정책 → 옵션 0~소수

---

## 10. 산출물 / 후속

- `tasks/persona-prompt-input/spec.md` (이 문서, Claude)
- `tasks/persona-prompt-input/plan.md` (구현 단계, Claude가 작성 예정)
- `tasks/persona-prompt-input/status.md` (Codex 진행 상태)
- `tasks/persona-prompt-input/reviews.md` (크로스 리뷰)

구현은 plan.md 기반으로 위임.

### 향후

- 옵션 필드 선택 결과를 **정책 해시로 캐싱** → 같은 정책 재실행 시 동일 선택 보장(재현성)
- 투명성 표시에서 **페르소나별 실제 입력값 드릴다운** (§6 항목 목록의 확장)
- `cultural_background` 핵심/조건부 배치 최종 확정 (§3-3 검토 포인트)
- 후행 태스크 A(결과페이지 재설계): 집단 위험 띠, 직업 8계층/가구 6계층 분류, 무직 4분해(노년·은퇴 / 청년·취준 / 전업 돌봄 / 구직 중) — `professional_persona` 기반 결정적 하이브리드 분류기
