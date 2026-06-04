# 발굴 중심 재설계 (분류기 + 에이전트 출력 + 취합 + 결과 페이지) — Spec

**Task ID:** `discovery-redesign`
**Owner:** Claude (planner/architect)
**상태:** draft v3 (리뷰 1 Claude + 리뷰 2 Codex 반영. control_model=gpt-5.5 확정)
**원자료:** `tasks/summary-pipeline-redesign/notes.md`, 결과 페이지 목업 `.superpowers/brainstorm/450-*/content/result-page-v9-responsive.html`
**선행 토대:** `tasks/persona-prompt-input` (스펙 B). **B가 주는 것 = 원본 구조화 필드 + `professional_persona` 등 서사 로딩.** ⚠ **분류기는 B가 아니라 이 스펙이 만든다**(B 스펙 §2/§10이 분류기를 "A 산출물"로 명시 → 본 스펙 in-scope).

---

## 1. 목적 (북극성)

> **"정책 설계자가 혼자 생각했을 때 놓치기 쉬운 집단과 우려를 발굴한다."** (`EXPERIMENT_PAGE_SPEC_V2.md`)
> 여론조사 아님. **초기 탐색·발굴 도구.** 성공 = "혼자 못 떠올렸던 집단·우려가 나왔는가."

현행 결함(진단 notes.md): 부정 신호 5필드 평면 → 요약기 5배열(중복3) 파편화, 빈도순 병합, 집단축 군집 불가, 약한 모델 과병합. → **top-down 재설계**(A가 보여줄 것 → 취합 → 에이전트 출력 역설계).

**핵심 원칙(리뷰 반영):** 발굴은 *비율(%)*이 아니라 **존재**다. "놓치기 쉬운 집단이 비자명 우려를 냈나(떴나/안 떴나)"가 본질. 소표본(N=5~30)에서 칸별 비율(2/2=100%)은 노이즈이자 여론조사 회귀 → **비율 인코딩 금지**.

---

## 2. 범위

### In
- **결정적 계층 분류기** (§3-0) — 직업 2,120종→8계층 + 무직 4분해(`professional_persona` 기반), 가구→6, 주거→6, 학력→7, 전공→11. **이 스펙의 산출물.**
- **응답 페이로드 확장** (§6) — 분류된 8축 태그를 응답 이벤트에 실어 프론트로 전달.
- **에이전트 출력 스키마 재설계** (§3-1).
- **취합 재설계** (§4) — 결정적 코드 층(태그·개수·존재·쏠림) + 강한 LLM 발굴 요약기(병합·정렬·강조 축).
- **기존 요약 파이프라인 제거/교체** (§7-removed).
- **결과 페이지 재설계** (§5) — 발굴 히트맵(존재/novelty 인코딩) 중심, 반응형.
- **모델 티어링** — control-plane 강 모델, 에이전트 싼 모델.

### Out
- **스펙 B** — 원본 필드 + `professional_persona` 로딩까지. 분류기는 여기서. (B 재설계 안 함)
- `compute_aggregate`의 **기존 stance 분포(연령·성별·지역)** — 보조 표시용으로 *병존* 유지(§4-a가 이를 대체하는 게 아니라 옆에 추가).
- 실험 멀티슬롯 저장 구조.
- N>100 취합 병렬화 — 후속(§9).

---

## 3. 분류기 + 에이전트 출력

### 3-0. 결정적 계층 분류기 (신규, 이 스펙 소유)

**위치:** 백엔드, `response_event_from_result`(simulate.py L56) 근처 — 이미 손에 든 persona 레코드(`structured_profile` + `narrative_context.professional_persona`)를 읽어 결정적으로 분류. LLM 미사용.

**8축 분류:**
| 축 | 입력 | 출력 계층 |
|---|---|---|
| 연령 | age | 6 (B의 age_group) |
| 성별 | sex→gender | 3 |
| 지역 | province | 7 (B의 region_group) |
| **직업** | occupation(2,120종) → **검수된 KSCO 대분류 룩업표** + professional_persona | **KSCO 대분류 11종**(`1`관리자·`2`전문가·`3`사무·`4`서비스·`5`판매·`6`농림어업·`7`기능원·`8`장치기계조작조립·`9`단순노무·`A`군인·`unemployed`) + `unemployed`는 **무직 4분해**(노년은퇴/청년취준/전업돌봄/구직중) |
| **가구** | family_type(39종) | 6 (1인/부부/부부+자녀/한부모/부모동거/3세대+·기타) |
| **주거** | housing_type | 6 (원본 6종 그대로) |
| **학력** | education_level | 7 (원본) |
| **전공** | bachelors_field | 11 (원본, 해당없음 포함) |

**분류기 계약 (리뷰 B1 — plan에 미루지 않고 스펙에서 형태·기준 고정):**

- **직업 산출물 = 검수 완료된 전수 룩업표** `tasks/discovery-redesign/occupation_ksco_major_mapping_final_reviewed.csv`(2,120종 전부, `occupation → ksco_major_code` + label/rationale). **이미 완료** — 0 other·0 needs_review·0 invalid·100% 커버(요약: `..._summary.md`). 구현은 이 표를 `backend/app/data/`로 들여 `{occupation: code}` 룩업으로 로드. **접미어·키워드 추정/95% 게이트 불필요**(전수 검수표라 커버리지=100%).
- **직업 enum(고정):** KSCO 대분류 코드 `1·2·3·4·5·6·7·8·9·A` + `unemployed`. (self_employed 없음 — KSCO는 고용형태가 아닌 직무 분류라 자영업도 직무 코드로 들어감.)
- **⚠ 라벨링 caveat(중요):** 이 표는 **통계청 공식 KSCO 세세분류 crosswalk가 아니라, CivicsimKR 프로젝트용 대분류 normalization 후보표**다. UI·문서에서 "프로젝트 대분류"로 표기, "공식 KSCO 매핑"이라 주장 금지.
- **새 dataset 값(표에 없는 occupation):** 룩업 미스 → `etc` 폴백(현 dataset은 100% 커버라 발생 안 함; 방어용).
- 가구(39종→6), 주거(6)·학력(7)·전공(11)은 직접 매핑표(`household_map.json` 등, 소수 범주).
- 가구/주거/학력/전공 매핑표 *값*은 plan에서 실데이터 대조로 채움(직업은 위 CSV로 이미 완료). 형태·enum은 스펙 고정.

**무직 4분해 — 결정적 우선순위 (리뷰 B2):** **`ksco_major_code=="unemployed"`**(전수 ≈39만/982종 — 무직 + "전직…, 현재 구직중" 포함, 약 26%만 명시 상태어 보유 → **폴백이 대다수를 담당**하므로 폴백 *명시 정의*):
1. **명시 상태 구절** (`professional_persona` 키워드): 은퇴/퇴직/정년→`노년은퇴` · 주부/전업/육아/살림→`전업돌봄` · 취업/구직/일자리/이직→`청년취준` · 학생/학업→`청년취준`.
2. **위 무매칭 시 결정적 뼈대 폴백:**
   - age ≥ 60 → `노년은퇴`
   - age < 35 & 미혼 & (부모동거 or 1인) → `청년취준`
   - 근로연령(35~59) & 배우자·자녀 동거 → `전업돌봄`
   - 그 외 → `구직중`(=실직·비활동 잔여; 데이터가 "실직"을 거의 안 쓰므로 잔여 버킷)
3. **`무직_기타`** — age 등 핵심 필드 결측으로 위 분기 불가 시.
- **`classification_source` 출력(리뷰 M2 — 39%·~74% 폴백이라 필수):** 각 무직 분류에 `explicit`(명시 구절 매칭) / `fallback`(뼈대 규칙) 태그를 함께 산출.
  - **featured-axis 처리:** **`fallback` 단독 하위버킷은 featured-axis 점수에서 제외/다운웨이트**(증거 없는 합성 버킷이 축을 좌우하지 못하게). 히트맵엔 표시하되 **"추정"** 마크.
  - 또는 fallback 무직을 축 선정 시 단일 `unemployed`(미세분)로 접고, 세분은 드릴다운 표시용으로만.
- **감사:** 4분해별 카운트 + `explicit:fallback` 비율 + 모호 예시를 plan에서 1회 출력·검토.

### 3-1. 에이전트 출력 스키마 (per 페르소나)

```json
{
  "stance": "찬성" | "반대" | "중립",
  "rationale": "왜 그 입장인지 1~2개 (경량, 자명 근거)",
  "blind_spot": "직접성·특수성·비중복성 충족 사각지대 1개. 없으면 null",
  "blind_spot_reason": "왜 '내'가 이걸 보는가 — 맥락적 특성 근거. blind_spot 있을 때만",
  "affected_group": "직접 피해 집단(보는 사람≠피해자 가능). blind_spot 있을 때만",
  "grounding": "direct" | "inferred" | null,
  "reframing": "정책 전제 반문 1개, 맥락 기반. 없으면 null",
  "expected_complaint": "시행 후 제기할 문의/불만 1문장. 없으면 null"
}
```
**제거:** `stance_strength`·`caveat`·`persona_link`.
**`grounding` 규칙 블록(신규, m1):** 에이전트가 자가분류하므로 `BLIND_SPOT_RULES`처럼 시스템 프롬프트에 판정 기준 명시 — "페르소나 텍스트에 직접 적힌 사실 기반=direct, 맥락 추론=inferred."

---

## 4. 취합 — 2층

모든 응답 수집 후 1회. 현행 단일 요약기 호출 대체.

### 4-a. 결정적 층 (코드, **신규 모듈** — `compute_aggregate` 확장 아님)
1. 각 신호(blind_spot/reframing/complaint)에 응답자의 **8축 분류 태그**(§3-0) 부착.
2. **정확한 결정적 산출(리뷰 B3 — 공식 고정):** 각 `(축, 범주)`마다:
   - `presence`(bool) — 그 범주가 사각지대를 1건이라도 냈는가
   - `blind_spot_headcount`(int) — 사각지대를 낸 **고유 agent 수**
   - `agent_ids`(int[]) — 멤버
   - `category_population`(int) — 그 범주에 샘플된 인원
   - ※ **비율(k/N) 계산 안 함. "병합된 distinct 항목 수"는 여기서 안 씀**(그건 LLM 병합 이후라 결정적 불가 — B3 순서 의존 해소).
3. **강조 축 = 코드가 결정적으로 선택** (자문 아님, 리뷰 B3/M1). 각 축의 **발굴 집중 점수**:
   `score(axis) = Σ_category [ presence × headcount × marginality_weight(category) ]`
   - `marginality_weight = min(W_MAX, sqrt(REF_POP / max(category_population, MIN_POP)))` — 가중 **상한(W_MAX)** + 하한 인구 `MIN_POP(≥3)`로 클램프.
   - **소표본 게이트(리뷰):** `category_population < MIN_POP`이면서 `headcount < 2`인 범주는 **featured-axis 점수에서 제외**(1인 단발 칸이 단독으로 축을 고르지 못하게). 단 **히트맵엔 그대로 표시**(발굴 존재는 보여주되 축 선정만 보수적).
   - **비율 미사용.** `featured_axis = argmax_axis score`. W_MAX·REF_POP·MIN_POP는 plan에서 실측 튜닝, 형태·게이트는 스펙 고정.

> **하드라인(M1):** featured-axis·개수·태그·존재는 **전부 코드 결정적·재현 가능.** LLM은 *숫자/축 선택에 관여하지 않음*. 단 §4-b near-dup 병합은 **드릴다운 표시 텍스트**만 재조직 — 병합으로 합쳐 보이는 "N명"은 결정적 `agent_ids` 합집합으로 표시(LLM이 수를 만들지 않음), 병합 멤버십은 감사 가능.

### 4-b. 발굴 요약기 (강한 LLM, 1회)
4-a 산출(태그된 신호 + 결정적 featured_axis)을 받아 — **숫자·축이 아니라 *텍스트 조직*만**:
- **near-dup 병합** — 거의 같은 신호 *텍스트* 의미 병합(축 무관). agent_ids 보존(수는 코드 소유).
- **발굴 정렬** — grounding(direct>inferred) → 특수성 → 반직관. **반직관 정의(m2):** "그 신호를 낸 응답자의 stance가 그 축 범주 다수 stance와 반대"(개수 기반 비교, 비율 아님).
- **featured_axis 설명(rationale)만 생성** — 축 *선택은 4-a 코드*가 이미 함(B3). LLM은 "왜 이 축이 발굴 가치 있나" 자연어 근거만 작성. (사용자는 8축 토글로 다른 축을 볼 수 있음 — 표시 차원)

산출 `discovery_summary`:
```json
{
  "merged_blind_spots":[{"label":"...","text":"...","agent_ids":[..],"grounding":"inferred"}],
  "merged_reframings":[...], "merged_complaints":[...],
  "featured_axis":{"primary":"housing_type","secondary":null,"rationale":"..."}
}
```
**폴백:** 요약기 실패 → 병합·정렬 없이 원본 신호 + featured_axis는 4-a 통계 1위 결정적 폴백. (4-a 산출은 항상 방출)

### 모델 티어링
| 단계 | 모델 | 호출 |
|---|---|---|
| 정책 구조화(B) | `control_model` | 1 |
| 에이전트 | `agent_model` | N |
| 발굴 요약기 | `control_model` | 1 |

- **`control_model` = `gpt-5.5`** (2026-04 출시 OpenAI 플래그십 추론 모델), `reasoning.effort` = **low 시작**(우리 작업은 깊은 다단계 아님) → 품질 부족 시 medium. plan에서 실측.
- **`agent_model` = `gpt-5-mini`** (현행 유지).
- provider = OpenAI.
- 강 모델 입력은 압축 신호 항목 → 토큰 미미. 비용은 O(N) 싼 호출 지배. (gpt-5.5는 적은 추론 토큰으로 강한 결과)
- **설정 위치:** `SimulateRequest`에 `control_model` 필드 추가(기본 `gpt-5.5`) 또는 env. `agent_model`은 기존 `model_name`.

---

## 5. 결과 페이지 (A) — 목업 v9

반응형 `max-width: min(1360px,94vw)`. ≤1080px 단일 칼럼.

### 5-1. 레이아웃 (와이드: 메인 + 우측 레일)
- **상단(전폭):** 정책명 + 입장 미니바(보조) → 스탯 타일 4(응답·사각지대·반문·민원).
  - **stance 라벨링(리뷰 M3):** 입장 분포는 **"모델 응답 구성(표본), 여론 아님"**으로 명시 라벨. **발굴 표면(히트맵·카드)엔 % 표시 금지.** 실험 비교 페이지의 stance % · `compareWithRealOpinion`(experiment.ts)은 **디버그/레거시 진단**으로 격리(결과 페이지 중심을 시뮬 여론율로 되돌리지 않음).
- **메인(좌):** 탭 `[사각지대 | 정책 반문 | 예상 민원]`. 사각지대 탭 = 히트맵 + 대표 페르소나 카드. 반문/민원 탭 = 병합 리스트.
- **우측 레일:** 강조 축 헤드라인 훅 · 입장 분포(보조) · 가구별 발굴 현황.

### 5-2. 히트맵 — **존재/novelty 인코딩 (비율 금지, B3)**
- **색 = 발굴 *존재/강도*** — 그 계층이 사각지대를 냈는지(켜짐) + 강도는 **서로 다른 사각지대 항목 수**(다양성) 또는 **개수(상한 캡)**. **k/N 비율로 정규화하지 않음.**
- **칸에 개수(headcount) 표기.** "2명" 식 절대 수만, "%" 없음.
- **소수 계층 강조:** 작은 인구 범주가 사각지대를 내면 시각적으로 도드라지게(테두리/마크) — "목소리 약한 집단 발굴". 단 이는 *비율 착시*가 아니라 존재+novelty 표시.
- **강조 축 = LLM 자문 기본**, 사용자 8축 토글 오버라이드.
- **1D 기본 / 2D 옵션:** 2D(데모×데모, 항목×데모)는 **N 하드 게이트**(예 N≥임계)로만 활성, 미만이면 비활성+안내(m3).
- 칸 클릭 → 페르소나 카드 필터.

### 5-3. 페르소나 카드(정성 "목소리")
계층 태그 묶음 + stance pill + ⚑사각지대 본문 + blind_spot_reason + affected_group + grounding 배지. 발굴 순 상위 N + 더 보기.

### 5-4. 오버플로
near-dup 병합으로 다수→소수 항목(+N명) 압축 → 상위 N + 더 보기.

### 5-5. 정렬
혼합: "최다 1건" 표기 + 나머지 발굴 가치순(grounding·반직관·특수성). 순수 빈도순 회귀 방지.

---

## 6. 데이터 흐름 + SSE 계약 (M4)

| 단계 | 시점 | 주체 | 산출 |
|---|---|---|---|
| 정책 구조화(B) | 1회 | 강 LLM | structured_policy |
| 에이전트 응답 | ×N | 저렴 LLM | §3-1 스키마 |
| 분류 부착 | 응답 시 | 코드(§3-0) | 응답 이벤트에 8축 분류 태그 |
| 결정적 취합(4-a) | 1회 | 코드 | `discovery_aggregate` 이벤트 |
| 발굴 요약기(4-b) | 1회 | 강 LLM | `discovery_summary` 이벤트 |
| 표시 | 프론트 | 코드 | 태그로 아무 축 재집계 |

### 페이로드 변경(B2)
- **`agent_responded` 이벤트:** §3-1 필드 + **분류된 8축 태그**(`age_band, gender, region_group, occupation_stratum, household_stratum, housing_stratum, education_stratum, field_stratum`). (현행은 housing/education/field·strata 누락 → 추가)
- **신규 `discovery_aggregate`:** 축×범주별 `{presence, blind_spot_headcount, agent_ids, category_population}` + **결정적 featured_axis**. **신호 *전문(텍스트)은 안 실음* — agent_id 참조만**(전문은 기존 `agent_responded`에 이미 있음, 중복 금지 — 리뷰 m1).
- **신규 `discovery_summary`:** 병합 항목(label·대표 text·멤버십 agent_ids·grounding) + featured_axis **rationale**.
- **폴백 시에도 `discovery_aggregate`는 방출**(요약기 없이 히트맵 표시 가능).

### 프론트 타입(M3)
- `AgentRespondedEvent`: `stance_strength/caveat/persona_link` **제거**, `blind_spot_reason/grounding` + 8축 분류 태그 **추가**.
- `dashboardModel`: 기존 5배열 클러스터 수용 **제거**, `discovery_aggregate`/`discovery_summary` 소비로 교체.

---

## 7. 소비자 인벤토리 — 제거/교체 (리뷰 M1·M2·m2 전면 확장)

스키마·이벤트 변경이 "국소"하다는 v1 주장은 거짓이었음. 전 소비자 열거:

**백엔드 — 삭제**
- `build_summary_llm_payload`, `build_summary_field_refill_payload`, `refill_summary_short_fields`, `normalize_summary` + 요약 전용 헬퍼(`reconcile_agent_id_clusters`·`attach_representative_quotes`·`attach_inferred_based`·`compute_inferred_based`·`compact_korean_label`), `format_summary_response_row`, `summary_from_text`.

**백엔드 — 교체/수정**
- `response_event_from_result`(simulate.py L56) — 제거 필드(`stance_strength·caveat·persona_link`) 빼고 `blind_spot_reason·grounding` + **8축 분류 태그** 추가(§3-0).
- `simulate.py` summary 스트리밍 블록(L245-313) → 4-a(코드)+4-b(강 LLM) 재작성, 신규 SSE 이벤트(§6).
- `parse_agent_response` + `SYSTEM_PROMPT_OPENAI`(필드 변경 + grounding 규칙).
- `compute_aggregate` — stance 분포(보조)만 유지, 신규 4-a 모듈 별도.

**프론트 — 교체/수정**
- `api.ts`: `AgentRespondedEvent`(필드 제거/추가 + 8축 태그), `SimulateEvent`(summary_* → `discovery_aggregate`/`discovery_summary`).
- `App.tsx`: 이벤트 switch **양 경로**(메인 L242 부근, 실험 L513 부근), **ResponseCard**(L1024 부근, 제거 필드 표시) 갱신.
- `dashboardModel.ts`: 5배열 클러스터 ingestion 제거 → discovery 이벤트 소비.
- `ResultPage.tsx`: §5 레이아웃 재작성.
- `currentRunStore.ts` · `experiment.ts`(스냅샷 복원) · **`experimentCsv.ts`**(stance_strength·caveat·persona_link·summary_*·aggregate_* 행 → 신규 필드/이벤트) · AggregateView/StabilityResult 뷰.

**테스트 마이그레이션(m2)** — `backend/tests/test_llm_and_api.py`의 `build_summary_llm_payload`·`normalize_summary`·`summary_from_text`·요약 스트림 monkeypatch 테스트 **삭제/교체** → 분류기·4-a 결정성·4-b 폴백 테스트로. 프론트 dashboardModel/CSV 테스트 갱신.

> **구버전 스냅샷 호환:** sessionStorage·실험 스냅샷에 구 스키마(5배열·제거 필드)가 남을 수 있음 → 로드 시 빈/레거시 처리(결과 페이지가 안 깨지게).

---

## 8. 검증 (시퀀싱: 분류기→페이로드→스키마 이후, m4)

**백엔드**
- 분류기: 같은 입력→같은 계층(결정적), 무직 4분해가 professional_persona 기반, 미매핑→"기타"
- 4-a: 같은 입력→같은 개수·존재·후보통계(재현). **비율 미산출 확인**
- 4-b 폴백: 실패 시 원본 + 통계 폴백 축, `discovery_aggregate` 방출
- 강조 축이 고정 8축 메뉴 내
- near-dup 병합 후 멤버십 agent_ids 보존·감사 가능

**프론트**
- 히트맵 색=존재/강도(비율 아님), 개수 표기, 축 토글 재집계
- 2D는 N 게이트 미만 시 비활성
- 8축 태그가 응답 페이로드로 도달(housing/education/field 포함)

**통합(실측, B1~B3·페이로드·스키마 이후)**
- 외국인가사 N=30 강한 모델 취합 재실행 → 과병합·대표인용 불일치·제목 깨짐 해소
- 문화/디지털/일반 정책 강조 축 분별

---

## 9. 산출물 / 후속

- `tasks/discovery-redesign/{spec.md, plan.md, status.md, reviews.md}`

**후속(지금 안 함):** N>100 취합 map-reduce(카운트/축 결정적 유지, 트리거=지연·품질) · 2D 자동노출 N 임계 튜닝 · near-dup 임계 · 별도 오버리치 검증기(강모델 취합+스키마 단순화로 불필요 가능, 재실행 측정 후 판단).

---

## 10. 의존 사슬 (정정)

```
B (원본 필드 + professional_persona 로딩)
  → C (이 스펙: §3-0 분류기 + §3-1 에이전트 출력 + §4 취합)
  → A (§5 결과 표시)
```
**분류기는 C 소유**(B 아님 — 리뷰 B1 정정). A의 히트맵은 C의 분류 태그를 소비. 순환 없음.
