# 페르소나 프롬프트 입력 구성 — 리뷰

## 리뷰 1 — 스펙 리뷰어 (spec draft v1, 코드베이스 대조)

**판정:** 플래닝 전 수정 필요. 데이터 전제·A/B 분리는 타당. 문제는 통합 경로가 "쉽다"고 단정됐으나 미명세.

### 확인된 전제 (이상 없음)
- country 100% 상수, military_status 99.47% 단일값, professional/family_persona 100% non-empty, occupation 1632종, 26컬럼 — 전부 사실.
- `thinking`·`persona_depth`는 `SimulateRequest`에 존재하고 request→prompt로 흐름.
- standard==full(minimal만 분기) 사실.

### BLOCKER
1. **구조화 "10개" vs 기존 12키 불일치.** 현재 `structured_profile`(normalize_record L136-149)는 이미 12키(marital_status·family_type·housing_type·military_status·country 포함). 스펙은 "10개"라 하고 province/district 양쪽 처리도 미정. 데이터 컬럼명은 `sex`(→gender 정규화)·`region`이라 raw/정규화 이름 혼용. → 최종 키 집합을 정확히 열거하고, `country`/`military_status` 제외가 `normalize_record` dict **재작성**임을 명시.
2. **`build_agent_prompt` 시그니처 미변경.** minimal 분기는 `{age,gender,region}` 자체 dict라 structured_profile을 안 읽음(=10개로 바꾸려면 동작 변경). 옵션 필드 주입 경로가 함수 인자에 없음. → `build_agent_prompt(persona, policy, persona_depth, optional_fields=None)` 시그니처 명시 + 4개 호출부(build_agent_messages L301, build_agent_llm_payload L314, stream_openai_agent_response L460/475, simulate.py stream_configured...) 스레딩.

### MAJOR
3. **`relevant_optional_fields`가 프롬프트까지 도달하는 배관 없음.** structured_policy 결과(simulate.py L219)는 SSE로만 나가고 agent 스트리밍(L228/238)엔 안 들어감. → 6계층 파라미터 스레딩 필요(structured_policy→parallel→agent_sse→configured→openai_agent→messages→prompt). "출력 한 항목 추가"는 과소표현.
4. **structure_policy 시스템 프롬프트가 새 필드를 요청 안 함 + enum 검증 부재.** 프롬프트(L178-183)는 5개 필드만 요청, 파서(L195-200)도 STRUCTURED_POLICY_FIELDS 5개만 순회 → relevant_optional_fields 무시됨. 고정 메뉴가 프롬프트에 없음. → (a)메뉴 문자열 프롬프트 주입, (b)allowlist 상수(프롬프트·빌더 공유 단일 출처), (c)교집합 필터, (d)폴백 `[]` 명시.
5. **enum 토큰 모호 + hobbies 회귀.** skills/hobbies의 prose vs _list 토큰 미정. `hobbies_and_interests`는 **현재 이미 standard/full에 주입 중** → 조건부로 강등 시 기존 standard 출력에서 빠지는 **동작 회귀**인데 스펙이 안 짚음. → enum=정규 키(_list 제외), list는 내부 치환, hobbies 강등 명시.

### MINOR
7. **full 토큰 폭증 미대응.** full=서사 산문 10+블록×N. §5-5는 비결정성만 다루고 토큰 예산/길이캡 없음. → 필드별 char 캡 또는 "full은 소규모 N용" 명시.
8. **필드명 프롬프트 인젝션 방어 위치 불명.** 정책 텍스트가 사용자 입력이라 필드명 주입 시도 가능 → enum 교집합 필터가 실제 방어임을 명시적으로 연결.
9. **§3-3 핵심 4개 = 재구성이지 순수 추가 아님.** cultural_background·hobbies는 현재 로딩·주입 중인데 조건부로 강등됨. "버려지는 필드 로딩"이란 서술이 오해 소지.
10. **§6-3 택1 미결 → 투명성이 거짓말할 위험.** 빈 family_persona는 L286에서 생략되는데 클라 계산 "항상" 목록은 표시 → 백엔드가 실제 최종 포함 목록을 내리는 쪽 권장.

### SCOPE
- A/B 분리 타당. 단 **갭:** B는 professional_persona를 *프롬프트에만* 주입하고 *값을 프론트/결과페이지에 노출하지 않음*(§10 향후). 그럼 A의 분류기가 B 출력에서 값을 못 받음. → B가 raw 값도 응답에 실어야 하는지 명확화 필요.

**한 줄:** 결정은 옳으나 핵심 통합 3경로가 미명세. Blocker 1-2, Major 3-5 먼저 해소.

---

## 리뷰 2 — 스펙 리뷰어 재검토 (draft v2, 수정본 대조)

**판정: Ready for planning.** 모든 Blocker·Major 해소 확인.

- Blocker 1·2, Major 4·5, Minor 7·8·9·10, 스코프 갭 → **전부 해소.**
- Major 3(배관) → **실질 해소.** 단 §5-1 다이어그램의 `stream_agent_sse_events` 라인 표기가 호출부(L198)를 가리켜, def(L147)와 헷갈릴 소지 → **수정 완료**(def L147 / 호출 L198 병기).
- Minor 10 → 백엔드 `included_fields` 단일 출처로 해소(깊이/정책 단위, 페르소나별 빈값 편차는 §10).

### 새로 발견 (전부 비차단, plan.md로 이월)
- **N1.** §3-1 "영구 제외" vs §7-1 "로딩 무해" 혼동 소지 → **수정 완료**(제외는 프롬프트 레벨 기준이라 한 줄 명시).
- **N2. (plan 이월)** `included_fields` **생성 지점·생성자 미지정.** `policy_structured`는 simulate.py L220(페르소나 로직 *전*)에서 방출되나 `req.persona_depth`로 계산 가능. plan에서 생성 위치 확정 필요.
- **N3. (plan 이월)** `included_fields`를 결정적으로 구성하려면 §3-2(구조화 10)·§3-3(핵심 4) 집합도 `OPTIONAL_NARRATIVE_FIELDS`처럼 **상수화**해야 함. plan에서 상수 3종(STRUCTURED_10 / CORE_NARRATIVE_4 / OPTIONAL_NARRATIVE) 명명.
- **N4. (cosmetic)** §2 In의 REQUIRED_COLUMNS 목록이 `hobbies_and_interests_list` 등을 "현재 버려지는"으로 묶었으나 prose `hobbies`는 이미 로딩 중 — §3-4 콜아웃이 바로잡으므로 내부 중복일 뿐.

---

## 리뷰 3 — Codex (교차 모델, draft v2 대조)

**판정: needs revision.** Claude 리뷰어가 놓친 **프론트엔드 영속화/상태 경계** 결함을 다수 발견. 전부 스펙에 반영 완료(draft v3).

### BLOCKER
- **B1. 멀티슬롯 스냅샷 메타 오류.** 실험 스냅샷은 top-level `structuredPolicy` 하나(첫 슬롯, App.tsx L578)만 저장 → A/B/C에서 슬롯 B 결과가 슬롯 A의 `included_fields`를 표시. `buildSnapshotResults`(experiment.ts L293)·`currentRunFromSnapshot`(App.tsx L1246) 슬롯별 미보존. → **반영:** §7-2 (3) 슬롯별 `structuredPolicy` 보존.

### MAJOR
- **M2. `persona_depth` 결과 상태 미보존.** `CurrentRun`(currentRunStore L5)에 없음 → §6-1 깊이 표기 불가. → **반영:** §7-2 (2) CurrentRun/save*/snapshot/테스트에 추가, 구버전 `"standard"` 폴백.
- **M3. 타입 경계 오류.** 신규 필드를 `PolicyStructuredEvent`에만 둠. 영속·결과는 `StructuredPolicy` 사용(api.ts L57, currentRunStore L13, dashboardModel L37, 5필드만 순회 L54). → **반영:** §7-2 (1) 공유 타입 `StructuredPolicyWithPromptFields`.
- **M4. 병렬 스트리밍 불변성.** anyio task group(simulate.py L188·L203) 공유 목록을 제자리 변형 시 동시성 위험. → **반영:** §5-2 #7 `tuple`/`frozenset` 정규화 1회.
- **M5. full 토큰 가드 미흡.** 백엔드 n_agents≤100(schemas.py L6), build_agent_prompt 무절단(L285). → **반영:** §5-3 토큰 가드(거부/경고 또는 길이 캡, 코드 강제).

### MINOR
- **m6. 데이터 수치 오류.** 전수 1,000,000행(초안 "111만"), occupation 2,120종(초안 1,632 — Claude가 9개 중 1개 파일만 표본한 오류). country 100%·military 994,718/1,000,000·professional_persona 100% non-empty는 정확. → **반영:** §7 헤더·§3-1·§9-2 수정.
- **m7. 테스트 통합 리스크 누락.** included_fields 방출·프롬프트 프리뷰 일치·병렬 불변 fanout·결과페이지 영속 렌더·멀티슬롯 메타·구버전 sessionStorage. → **반영:** §9-1/9-3 확장.

**draft v3 상태:** Codex 지적 전 항목 반영 완료. 재검토 권장(특히 프론트 상태경계 구현 디테일은 plan에서).

---

## 리뷰 4 — 플랜 리뷰어 (plan.md draft v1 대조)

**판정: needs revision → 반영 완료(plan v2).** 코드 앵커는 정확. 결함은 테스트 실행가능성에 집중.

### BLOCKER (반영 완료)
- **B1. 기존 SSE 스텁 3곳이 새 `optional_fields` kwarg에 깨짐**(test_llm_and_api.py L871·L1109·L1140) → Task 8 `pytest -q` 게이트 불가. → **반영:** Task 8 Step 1에 스텁 보정 선행 단계 추가.
- **B2. `run_simulation`/`simulate_client` 픽스처 미존재**(가상). → **반영:** Task 8 Step 2를 실 `TestClient(app)` + SSE 파싱 헬퍼 + `patch_fast_simulation`로 재작성.

### MAJOR (반영 완료)
- **M2. `openExperimentResult`(App.tsx ~L670) 경로에서 깊이 손실** — `saveExperimentRunAsCurrentRun` 호출에 personaDepth 없어 standard로 오표기. → **반영:** Task 10 Step 5 신설(실제 깊이 전달).
- **M3. Task 4 `stream_openai_agent_response` 본문 변경이 플레이스홀더(`...`)** — 누락 시 단위테스트는 통과해도 실스트리밍서 옵션 누락. → **반영:** 구체 코드(`build_agent_messages(..., optional_fields=optional_fields)`)로 교체.

### 확인됨(이상 없음)
- monkeypatch 대상 `app.api.simulate.structure_policy` 바인딩 정확(simulate.py L18 import). 
- `build_agent_messages` 인자 순서(model_provider 뒤 optional_fields) 일관.
- `model_validator`(full+대N) 기존 테스트 안 깨짐(full+>20 생성 테스트 없음).

### MINOR (반영/수용)
- **m5.** `_list` 변형 의도적 제외 → Task 2에 주석 추가.
- **m3.** Task 11의 App.tsx 작업 일부는 이미 구현됨(`currentSnapshotInput`가 슬롯 정책 읽음, `ExperimentRunState.structuredPolicy` 존재). 실질 갭은 (a)result 타입에 structuredPolicy 추가 (b)buildSnapshotResults 보존 (c)currentRunFromSnapshot 우선읽기 — plan이 정확히 다룸. 과대서술만 정리.
- 데이터 1M행 재검증(§9-2)은 1회성 근거 확인이라 수동 유지.

**plan v2 상태:** Blocker 2 + Major 2 반영 완료. 실행 준비.

---

## 리뷰 5 — Codex (plan.md v2 교차 검토)

**판정: needs revision → 반영 완료(plan v3).** App.tsx의 **2갈래 구조**(top-level 단순 "/" 경로 vs ExperimentPage)를 plan이 정확히 안 짚은 게 핵심.

### BLOCKER (반영 완료)
- **B1. Task 10 Step 4 컴파일 불가** — `personaDepth`는 ExperimentPage(L420) 스코프, top-level `saveCurrentRun`(L256)에선 미정의. → **반영:** top-level은 깊이 셀렉터 없으니 `"standard"` 리터럴 저장으로 변경.
- **B2. Task 12·13 테스트가 이 repo서 실행 불가** — `@testing-library/react`·jest-dom 미설치(기존은 `renderToStaticMarkup`). → **반영:** 두 테스트를 renderToStaticMarkup 스타일로 재작성.

### MAJOR (반영 완료)
- **M3. Task 8 SSE 테스트 false-green 가능** — 프리뷰만 보고 실스트림 도달 미검증. → **반영:** capturing fake stream으로 `optional_fields == ("arts_persona",)` 단언 추가.
- **M4. Task 8 Step 1 스텁 목록 불완전** — L931·L1028·L1260·L1289 누락. → **반영:** grep 전수 검색 지시 + `**kwargs` 권장.
- **M5. Task 7 백엔드 cap이 프론트 422로 노출** — UI가 full 허용(L698)·nAgents 30(L417). → **반영:** Task 7 Step 5 프론트 가드(실행 disabled + 안내 카피).
- **M6. Task 13 메인 배지 위치 불명** — 라이브 UI는 ExperimentPage(슬롯별 structuredPolicy L468), top-level(L108) 아님. → **반영:** ExperimentPage 슬롯별 렌더로 구체화.

### MINOR (반영 완료)
- **m7.** `PersonaDepth`가 기존 union 미교체 → api.ts L218·experimentStorage.ts L23 교체 명시.
- **m8.** Task 14가 없는 status.md 커밋 → 생성 단계로 교체.

**plan v3 상태:** Codex 지적 전 항목 반영 완료.
