# 요약 파이프라인 재설계 — 방향 메모 (브레인스토밍 전 단계)

**상태:** 방향만 합의. 정식 브레인스토밍·스펙 전. (스펙 B `persona-prompt-input`의 *후속* 성격)

## 합의된 순서 (이게 핵심)

검증기 LLM을 새로 만들기 *전에*, 앞단부터 다시 정한다:

1. **에이전트 프롬프트 출력 스키마 재정의** — 각 페르소나 응답이 *무엇을* 내놓을지(현재: stance, rationale, caveat, blind_spot, expected_complaint, affected_group, reframing). 이 칸 구성 자체를 재검토.
2. **취합(요약) 스키마 재정의** — 취합 LLM이 *무엇을 묶을지*. 현재 concern/complaint/blind_spot/affected_group을 **각각 따로** 뽑는 구조가 단일 주제 파편화의 원인(아래 증거 B).
3. **취합 모델 고성능 승격** — control-plane(실행당 1회·고레버리지) 원칙의 확장. 스펙 B에서 합의한 "필드 선택=강한 모델"과 같은 논리.

> 추측으로 검증기부터 짓지 않는다. 모델 승격 + 스키마 정리 후 남는 결함만 별도로 다룬다.

## 근거 — `exports/외국인가사_30.json` 실측 (gpt-5-mini 취합, N=30, 27찬성/3반대)

### 모델 성능 탓 (고성능 승격으로 해소 기대)
- **과병합:** `blind_spot #2`가 "지방 일자리 축소"에 #6(순천 비공식 상호부조 문화 약화 — 결이 다름)을 끼워넣음.
- **대표인용 불일치:** 같은 클러스터 representative_quote로 #6(순천 상호부조)을 뽑아 제목과 안 맞음. `affected_group #1`도 동일 패턴.
- **잘린 short_title:** "구미 등 지방 공단 지역의"(#6), "만성질환을 가진 60대 이"(#7), "서울 외 지역의 맞벌이·중"(#8) — 모델이 제목 생성 실패 → normalize_summary 강제 절단 폴백.

### 모델과 무관 (스키마/프롬프트 구조 문제 — 승격해도 잔존)
- **단일 주제 파편화·중복:** "서울 한정→지방 배제"가 concern(19)+complaint(19)+blind_spot #2·#6·#8+affected_group #1+reframing 5개에 분산 → 1개 신호가 ~8개 문제처럼 보임. 다른 신호(돌봄 연속성·행정 부담) 묻힘.
- **framing 불균형:** 27:3 찬성인데 부정 섹션(우려5·사각8·불리6·반문10) vs 찬성 클러스터 3. 산출물이 "문제 투성이"로 읽힘.
- → 교차 중복은 결정적 규칙(중복 agent_id 통합)으로, 균형은 프롬프트로 처리.

### 검증기 설계 시 필수 교훈
- 무서워 보이는 표현이 *원문에 근거*한 경우 많음 — 검증기는 반드시 원본 N개 응답에 대조해야 과삭제 안 함.
  - 예: `affected_group #5`의 "한국인 요양보호사" = 원문 #8 그대로. `blind_spot #1` 끝 "정책 설명에서 잘 보이지 않습니다" = 원문 #8 그대로. (둘 다 무죄)

## 현재 파이프라인 전수 탐색 (llm_client.py / aggregation.py)

### ① 에이전트 응답 — LLM이 내놓는 데이터
- **프롬프트:** `SYSTEM_PROMPT_OPENAI`(규칙 5블록) + `build_agent_prompt`(페르소나+정책+질문 1개). 질문은 "찬반/이유"만 묻지만 시스템 프롬프트가 **9필드 JSON**을 강제.
- **출력 스키마(parse_agent_response):** `stance`(찬성/반대/중립), `stance_strength`, `rationale`(1~2개 이유), `caveat`(유보 1개/null), `expected_complaint`(민원 1문장/null), `blind_spot`(3조건 충족시만/null), `affected_group`(blind_spot 있을때만), `reframing`(정책 전제 반문/null), `persona_link{direct,inferred}`.
- **이미 과생산 억제 장치 있음:** STANCE_RULES(우려 있다고 중립 금지), CITIZEN_VOICE(전문가식 목록 금지, 1~2개만), BLIND_SPOT 3조건(직접성·특수성·비중복성), caveat 1개만.
- **그러나** 1인당 부정성 신호 필드가 **최대 5개**(caveat/complaint/blind_spot/affected_group/reframing) → 파편화의 씨앗.

### ② 취합(요약) — build_summary_llm_payload
- **요약기 입력(format_summary_response_row):** 응답당 `Response #N (age_group gender region_group)` + stance/rationale/caveat/expected_complaint/blind_spot/affected_group/reframing.
  - **맹점:** 요약기는 `occupation`·`family_type`·서사를 **못 봄**. 거친 demographics(연령·성별·권역)만 봄 → **집단/계층(직업) 군집 불가**(결과페이지 A가 원하는 축을 요약 단계에서 못 만듦).
- **요청 스키마 — 5개 배열 + headline:**
  - `concern_clusters`/`support_clusters` {label, short_label, count, examples} — **전용 필드 없음**, rationale/caveat에서 요약기가 *구성*(해석적 → 오버리치 취약)
  - `blind_spot_clusters` {affected_group, short_title, count, blind_spot_examples, agent_ids}
  - `complaint_clusters` {short_title, count, complaint_examples, agent_ids}
  - `affected_group_clusters` {affected_group, short_title, count, examples, agent_ids}
  - `headline` — **생성은 하나 결과페이지에서 미사용**(외국인가사 export에서 null).
- **구조적 결함의 출처 확인:** blind_spot/complaint/affected_group 3배열이 **같은 부정 신호의 중복 뷰** → "서울 한정"이 4곳에 동시 등장(B 파편화 = 스키마 탓, 모델 IQ 아님).
- **프롬프트가 병합을 지시:** *"Merge ... Prefer 4 to 7 ... when many one-person items repeat the same root cause."* → gpt-5-mini가 이걸 **잘못 수행**(순천 상호부조를 지방배제에 병합) = 모델 성능 의존(A).
- **anti-overreach 지시 이미 있음:** *"Do not infer, invent, generalize..."* → 그럼에도 대표인용 불일치 발생 = 모델이 지시 못 따름(강한 모델 가설 지지).

### ③ 정리(집계) — compute_aggregate + normalize_summary
- **compute_aggregate(결정적/코드):** total·by_age·by_gender·by_region(stance 분포), blind_spot_raw·reframing_list passthrough, cluster 배열은 빈 채로 시작해 요약결과로 채움.
- **normalize_summary(결정적 후처리):**
  - short_label/short_title 누락 → LLM 재시도 1회 → 실패시 `compact_korean_label` **절단**(= 깨진 제목 "만성질환을 가진 60대 이"의 출처).
  - `reconcile_agent_id_clusters`(agent_ids 검증), `append_missing_blind_spot_clusters`, `attach_representative_quotes`(응답에서 대표인용 **코드가 선택**), `attach_inferred_based`.
  - **대표인용 불일치의 메커니즘:** rep quote는 클러스터의 agent 중에서 코드가 뽑음 → 과병합으로 #6이 잘못 포함되면 #6 인용이 대표가 됨(=상위 오류는 요약기 병합, 하위 증상은 코드 선택).
- **denominator 불일치:** blind_spot/affected=14(blind_spot 보유자), complaint=30(전체) → 섹션마다 분모 달라 혼란.

## 재설계 결정 포인트 (정리 결과 도출)
1. **에이전트 출력 구성** — 부정 신호 5필드가 맞나? blind_spot/affected_group/complaint를 "우려 신호" 하나로 통합할지, reframing 유지할지.
2. **요약 입력 보강** — 계층(직업·가구형태) 정보를 요약기에 넣어야 A의 집단축 군집이 가능.
3. **요약 스키마 단순화** — 5배열(중복 3) → "통합 우려 + 지지" 소수 축으로? headline 미사용 정리.
4. **denominator/framing** — 분모 통일, 부정4:지지1 불균형 보정.
5. **모델 티어링** — 강한 모델로 A(군집·대표인용·제목) 해소 기대, B(스키마)는 재설계 필요.

## 다음에 할 일
- 위 ①②③ 정식 브레인스토밍 → 스펙화
- 필요하면 고성능 취합으로 이 정책 재실행 후 diff (검증기 필요 여부 판명)
