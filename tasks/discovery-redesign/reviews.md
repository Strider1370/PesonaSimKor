# 발굴 중심 재설계 — 리뷰

## 리뷰 1 — 스펙 리뷰어 (draft v1, 코드·데이터·목표 대조)

**판정: needs revision.** 블로커 3개. 의존 사슬 B→C→A가 "건전"이라 했으나 실제로 끊겨 있음.

### BLOCKER
- **B1. 8축 분류기가 존재하지 않고, B 스펙은 그걸 *A의 산출물*로 명시.** 내 스펙은 "B가 직업8·가구6·무직4 분류 태그를 공급"한다고 전제했으나 — `normalize_record`는 **원본 문자열만**(occupation 2,120종 그대로) 내보내고, B 스펙 §2 Out/§10이 *"분류기는 A의 산출물"*이라 명시. **의존 화살표가 거꾸로.** → **분류기를 이 스펙(C)의 In-scope로 끌어와 정의**해야 함(규칙·매핑표·실행 위치·폴백).
- **B2. 응답 페이로드가 8축 데이터를 안 실어 보냄.** `response_event_from_result`는 age/gender/region/occupation/family_type(원본)만 방출 — **housing/education/field 아예 없고**, 분류 strata도 없음. 프론트 "아무 축 재집계" 불가(4개 축 렌더 불가). → 새 페이로드(분류된 8축 태그 + 병합 항목 멤버십) 명시 필요.
- **B3. 목표 배신 — 작은 N의 칸별 "발굴률"은 빈도/여론조사 통계이자 노이즈.** N=2에서 2/2=100%가 가장 진한 칸으로 → **작은 칸을 최대 위험으로 오인**(소표본 인공물). 발굴 도구는 *비율*이 아니라 *존재(놓친 집단이 비자명 우려를 냈나)*를 봐야 함. 우리가 시각으로 다듬은 "색=발굴률"이 여기 걸림.

### MAJOR
- **M1.** near-dup 병합이 *표시되는* 항목 카운트를 바꿈(어떤 걸 합칠지는 LLM 결정) → "카운트는 결정적" 하드라인이 원자 수준에서만 참. featured-axis도 노이즈 통계 소비. → 병합 멤버십 감사 가능化 + featured-axis는 "제안(오버라이드 가능)"으로.
- **M2.** §2가 `compute_aggregate` "유지"라 했으나 §4-a는 8축 카운트·발굴률·쏠림 통계라는 **신규 모듈** — 현행은 3축 stance만. 과소 스코프. → §4-a를 신규 결정적 모듈로 명시.
- **M3.** 스키마 변경이 "3제거 2추가"보다 큼 — `build_summary_llm_payload`·`normalize_summary`·`refill_summary_short_fields` 삭제, `AgentRespondedEvent` 타입·`dashboardModel` 클러스터 수용 교체 필요. 안 지우면 simulate.py가 없는 필드 읽음. → 제거/교체 인벤토리 추가.
- **M4.** 2층 취합의 SSE 계약 미정의(스트리밍 여부, `discovery_aggregate`/`discovery_summary` 신규 이벤트, 폴백 시에도 4-a 방출).

### MINOR
- m1. `grounding`(direct/inferred) 에이전트 자가분류 규칙 블록 필요.
- m2. "발굴 정렬"의 반직관(집단 입장 대비)은 또 소표본 비율 의존 — 측정 가능 정의 또는 제거.
- m3. 2D 데모×데모는 N 임계 하드 게이트로.
- m4. 외국인가사 재실행 검증은 B1~B3 이후로 시퀀싱.

**한 줄:** 분류기 in-scope화(B1) + 8축 페이로드 정의(B2) + 소표본 발굴률→존재/novelty 인코딩(B3) 먼저 해소해야 플래닝 가능.

### draft v2 반영 (사용자 결정: B3 = 1번 존재/novelty)
- **B1 해소** → §3-0 결정적 분류기 신규(직업8+무직4·가구6·주거6·학력7·전공11), 위치·매핑·폴백 명시. §10 의존사슬 정정(분류기=C 소유).
- **B2 해소** → §6 페이로드: `agent_responded`에 8축 분류 태그 추가(housing/education/field 포함), 신규 `discovery_aggregate`/`discovery_summary` 이벤트.
- **B3 해소** → §5-2 **존재/novelty 인코딩**(비율 금지, 개수만 표기, 소수계층 강조는 존재+novelty). §4-a 비율 미산출, 강조축 통계도 비율 아님.
- **M1** → §4-a 하드라인 정교화(원자 개수 결정적, 병합 크기는 LLM 상속·감사화), featured-axis 자문·오버라이드.
- **M2** → §4-a를 신규 결정적 모듈로 명시, 기존 stance 분포 병존.
- **M3** → §7 제거/교체 인벤토리(요약 파이프라인 삭제, 타입·dashboardModel 교체).
- **M4** → §6 SSE 계약(`discovery_aggregate`/`discovery_summary`, 폴백 시 aggregate 방출).
- **m1** grounding 규칙블록 / **m2** 반직관 개수 기반 정의 / **m3** 2D N 하드게이트 / **m4** 검증 시퀀싱 — 반영.

**draft v2 상태:** 리뷰 1 전 항목 반영. 재검토 권장.

---

## 리뷰 2 — Codex (draft v2 교차 검토)

**판정: needs revision → draft v3 반영 완료.** + control_model=gpt-5.5 확정(웹검색: 2026-04 출시 플래그십).

### BLOCKER (반영)
- **B1. 분류기 과소명세** — occupation 2,120종→8계층 매핑 산출물 형태·정밀도·감사 미정의(plan에 미룸=핵심 산출물 은폐). → **반영:** §3-0에 `occupation_map.json` 스키마·8 enum 고정·정규화·**커버리지 95%/기타≤5% 테스트 게이트**·전수 감사표 요건.
- **B2. 무직 4분해 신뢰 부족** — professional_persona 상태어 커버리지 **~26%뿐**(전수 무직 ≈37만). 폴백 미정의. → **반영:** §3-0에 결정적 우선순위(명시구절>뼈대 폴백[age·혼인·가구]>무직_기타) + 폴백 경유 비율 감사.
- **B3. presence/novelty 점수 코어 미정의 + 순서 의존** — "distinct 항목 수"는 LLM 병합 후라 결정적 불가, featured-axis가 LLM에 흔들림. → **반영:** §4-a 정확 산출(presence·headcount·agent_ids·category_population, 비율·distinct 미사용) + **featured_axis를 코드가 결정적 공식**(`Σ presence×headcount×1/√pop`)으로 선택, **LLM은 rationale만**.

### MAJOR (반영)
- **M1. 프론트/내보내기 소비자 누락** — CSV·실험복원·stability·debug·App 이벤트 switch 양경로. → §7 전면 인벤토리.
- **M2. 스키마 "국소" 거짓** — response_event·TS타입·ResponseCard·CSV. → §7 포함.
- **M3. 폴링/비율 사고 잔존** — 실험 비교 stance %·compareWithRealOpinion·stance 미니바. → §5 "표본 구성, 여론 아님" 라벨 + 발굴 표면 % 금지 + 비교 % 디버그 격리.

### MINOR (반영)
- **m1.** discovery_aggregate가 전문 중복 → ID/태그/카운트만(전문은 agent_responded). §6 반영.
- **m2.** 테스트 마이그레이션(요약 헬퍼 테스트 삭제→분류기/4-a/4-b 테스트). §7·§8 반영.

**draft v3 상태:** 리뷰 2 전 항목 반영 + gpt-5.5 확정. 재검토 권장.

---

## 리뷰 3 — 플랜 리뷰어 (plan.md v1 대조) → plan v2 반영 완료

**판정: needs revision → 반영 완료.**

### BLOCKER (반영)
- **B1. 95% 커버리지 게이트 비현실** — top-120 occupation = 질량 78%(대부분 아님), 12접미어론 95% 불가. → Task1: ~40~60 KSCO 접미어+상위120 exact-map으로 **먼저 측정 후 게이트 설정**, 미달 시 측정 천장으로 + 스펙 §3-0 하향 갱신(보강반복에 묻지 않기).
- **B2. 분류기가 중첩 dict를 평면 키로 읽음** — 실제는 `structured_profile`/`narrative_context` 중첩. → Task3 픽스처·`classify_persona` 입력 계약을 중첩 기준으로 수정, Task5는 원본 persona 레코드 전달.
- **B3. Task9가 `test_simulate_stream_event_order_with_summary_stream`(L1116)·`patch_fast_simulation` 깨뜨림(삭제목록 누락)** → Task9 Step1에 명시 마이그레이션 추가.

### MAJOR (반영)
- **M1.** parse_agent_response 앵커 L218→**L272**.
- **M2.** response_event L56→**L57**, 요약블록 L245-313→**L264-331** + import L13-22 + helper L140 명시.
- **M3.** Task4가 제거필드 단언 기존 테스트(L228·L246·L277·L922) 마이그레이션 누락 → Step0 추가.
- **M4.** 1M행 커버리지 테스트를 기본 suite에서 → `@pytest.mark.dataset` opt-in.

### MINOR (반영)
- **m1.** stratum 문자열 형식 고정(영문 enum + `unemployed_*` + `etc`) — 교차 계약.
- **m2.** Task11·14 파일/컴포넌트 단위 분해.
- **m3.** Task9 방출 순서 명시(discovery_aggregate 먼저 → 폴백 보장).
- **m4.** control_model을 structure_policy에도 연결(Task7 Step5).

**plan v2 상태:** 리뷰 3 전 항목 반영. Codex 교차 검토 예정.

---

## 산출물 통합 — 직업 KSCO 대분류 전수 매핑 (사용자 수동 작업)

`occupation_ksco_major_mapping_final_reviewed.csv`(2,120종, **0 other·0 needs_review·0 invalid·100% 커버**) + `_summary.md` 수령.

**영향 — 리뷰 B1(커버리지 게이트)/Codex 우려(etc 누수·접미어 한계) 근본 해소:**
- 직업 분류가 *추정 규칙*이 아니라 **검수된 전수 룩업표**가 됨 → 95% 게이트·접미어·감사생성 전부 불필요.
- **택소노미 변경:** 내 8계층(ad-hoc) → **KSCO 대분류 11종**(`1`관리자·`2`전문가·`3`사무·`4`서비스·`5`판매·`6`농림어업·`7`기능원·`8`조작조립·`9`단순노무·`A`군인·`unemployed`). self_employed 제거(KSCO는 직무 분류), 서비스/판매·관리자/전문가 표준 분리.
- **무직 버킷 확장:** `unemployed` = 39.16%/982종(무직 + "전직…,현재 구직중" 포함). 4분해는 이 버킷에 적용.
- **라벨링 caveat:** 프로젝트 대분류 normalization(공식 통계청 세세분류 crosswalk 아님) — UI/문서 표기 주의.

**반영:** 스펙 §3-0(enum·룩업표·caveat·무직 트리거 `code==unemployed`), plan Task 1(CSV→json 룩업으로 전면 단순화), Task 2 감사(broader unemployed), Task 3/6 stratum 계약(KSCO 코드).

---

## 리뷰 4 — Codex (plan v2 + KSCO 매핑 통합 후) → plan v3 반영 완료

**판정: needs revision → 반영 완료.** (직업 룩업표는 ready 확인; repo 컬럼 로딩·스키마 제거 반경도 OK 확인.)

### BLOCKER (반영)
- **B(stale enum).** Task 3 테스트가 아직 `=="office_admin"` 단언 → **`=="3"`(KSCO)로 수정.**
- **B(Task 10 트리 깨짐).** api.ts에서 summary_* 타입을 Task 11(소비자 제거) 전에 지우면 TS 즉시 깨짐 → **Task 10 additive-only**(신규 타입·이벤트 추가만, summary_* 삭제는 Task 11 후). + DiscoveryAggregate/Summary 타입 형태 명시.

### MAJOR (반영)
- **M(featured_axis 소표본).** `1/√pop`이 1인 칸을 100인·10건과 동점으로 → 소표본 과대 재발. → **W_MAX 캡 + MIN_POP(≥3) 게이트**(pop<3 & headcount<2 칸은 축 선정서 제외, 히트맵엔 표시). 스펙 §4-a + Task 6.
- **M(무직 폴백 지배).** 39%·~74% fallback이 합성 버킷으로 축 좌우. → **`classification_source`(explicit/fallback)** 출력, fallback 단독은 featured-axis 제외/다운웨이트(드릴다운엔 "추정" 표시). 스펙 §3-0.
- **M(Task 9 마이그레이션 누락).** 요약 테스트가 더 많음(L424/432/721/502/532/574…/1050-1063/1116). → **전수 `rg` 단계** 추가 후 전부 처리.
- **M(Task 12/13 thin).** → DiscoveryAggregate/Summary **고정 픽스처 + 정확 단언**(셀 개수·featured_axis·라벨, "%" 부재) 명시.

**plan v3 상태:** 리뷰 4 전 항목 반영.
