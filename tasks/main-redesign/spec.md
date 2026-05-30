# Main Result Page — Spec

**Task ID:** `main-redesign`
**Owner:** Claude (planner/architect)
**상태:** draft v1.1 (HIGH 항목 5개 패치 반영)
**참고 목업:** `docs/mockups/main-result.html`
**참고 데이터:** `전세_1.csv` (N=5), `전세_2.csv` (N=30)

---

## 1. 목적

정책 입력 → 페르소나 응답 → **인사이트 보드**(여론조사형 X, 사각지대 발굴형 O)를 한 화면에 보여주는 결과 페이지를 만든다.

기존 `/`는 디버그·개발용으로 유지하고, 정책 담당자(최종 사용자)는 **`/result`** 에서 정제된 결과만 본다.

핵심 명제(EXPERIMENT_PAGE_SPEC_V2 그대로):
> 정책 담당자가 혼자 생각했을 때 못 떠올렸던 집단과 우려를 발굴한다.

이번 스펙은 그 명제를 **시각화 형태로 고정**하고, 그 시각화가 실데이터로 채워지도록 백엔드·LLM·프론트의 갭을 메운다.

---

## 2. 범위

### In

- 새 라우트 `/result` 추가
- LLM 요약 프롬프트(`build_summary_llm_payload`) 스키마 확장 (`short_label`, `short_title`, `agent_ids`)
- 사각지대 cluster 규칙 변경 (단건 = 단일 cluster + agent_id, 강제 묶음 금지)
- 백엔드 파싱(`summary_from_text`) 보강
- 프론트엔드 컴포넌트 7개 (`ResultPage`, `ResultHeader`, `Hero`, `OpinionMap`, `DemographicBars`, `BlindSpotGrid`, `ReframingList`)
- 지역 라벨 헬퍼 (시·구 추출)
- 그래프 뱃지 충돌 방지 알고리즘 (프론트)
- 빈 상태 처리

### Out

- `/experiment` 라우트 (변경 없음)
- 기존 `/` 라우트의 디버그 패널 (그대로 유지)
- 멀티슬롯, 프리셋, 실험 저장 (이미 `/experiment`에 존재, 건드리지 않음)
- N-적응형 레이아웃 (단일 디자인. 향후 작업)
- `/result?runId=` 영구 링크 (저장 인프라 필요. 향후 작업)
- LLM 자연어 한 줄 헤드라인 (스키마에 자리만 정의, 렌더링은 향후)
- 다국어, 인증, 다크/라이트 토글

---

## 3. 라우트

### `/` (변경 없음)

- 정책 입력 폼 + 시뮬레이션 실행 + 기존 디버그 패널 (LLM 입력 로그, 실시간 출력, 샘플링 계획 등)
- 시뮬레이션 완료 시 헤더에 **"결과 보기 →"** 버튼 추가 (가벼운 변경)
- 버튼 클릭 시 `/result`로 이동 (zustand/context store 통해 결과 전달)

### `/result` (신규)

- 가장 최근 완료된 시뮬레이션 결과를 store에서 읽어 렌더
- 라우트 진입 시 사이드 이펙트 없음 (재실행 없음)
- store에 결과 없을 때 빈 상태("`/`에서 먼저 실행하세요")
- 헤더의 **재실행** 버튼은 store에 보관된 정책·N으로 `/` 라우트의 입력 폼을 채우기만 함 (자동 실행 X, 사용자가 직접 "시뮬레이션 실행" 버튼 눌러야 함). "디버그" 버튼도 동일하게 폼만 채움.

#### 결과 영속성 (F5 / 북마크 대응)

- store는 zustand + `persist` 미들웨어 사용. `sessionStorage`에 currentRun 직렬화.
- 새로고침 시 store 복원 → `/result` 정상 렌더.
- `sessionStorage` 한계(브라우저 탭 닫으면 사라짐, ~5MB)를 받아들임. 영구 링크는 향후 작업 (§12).
- 직렬화 대상: `policy`, `n_agents`, `model_name`, `model_provider`, `aggregate`, `sampledAgents`, `completedAt`.
- SSE 스트리밍 중간 상태(`responses` 누적, LLM 로그)는 직렬화 안 함.

#### currentRun 형태

```typescript
type CurrentRun = {
  policy: string
  n_agents: number
  model_name: string
  model_provider: "ollama" | "openai"
  aggregate: AggregateEvent
  sampledAgents: SampledAgent[]
  completedAt: string  // ISO timestamp
}
```

### `/experiment`

변경 없음.

---

## 4. LLM 출력 스키마 변경

### 4-1. 에이전트 응답 (`SYSTEM_PROMPT_OLLAMA` / `_OPENAI`)

**변경 없음.** 기존 필드(stance, stance_strength, rationale, caveat, blind_spot, affected_group, reframing, persona_link)가 이번 스펙에 충분.

### 4-2. 요약 LLM (`build_summary_llm_payload`)

return schema를 다음과 같이 확장:

```json
{
  "headline": "한 줄 자연어 요약 (선택, 스키마 자리만 정의)",
  "support_clusters": [
    {
      "label": "긴 라벨, 풀텍스트 (~20-40자)",
      "short_label": "그래프 뱃지용, ≤10자, 부호(↑↓) 허용",
      "count": 5,
      "examples": ["..."]
    }
  ],
  "concern_clusters": [ { 동일 형식 } ],
  "blind_spot_clusters": [
    {
      "affected_group": "풀텍스트 (~30-50자)",
      "short_title": "카드 제목용, ≤14자, 명사구",
      "count": 1,
      "blind_spot_examples": ["..."],
      "agent_ids": [9]
    }
  ]
}
```

**필수 필드(신규):**

- `short_label` (support/concern cluster)
- `short_title` (blind_spot cluster)
- `agent_ids` (blind_spot cluster, 정수 배열)

#### 요약 LLM 입력 포맷 (agent_id 추적용)

요약기가 `agent_ids`를 채우려면 입력에 agent_id 표식이 있어야 함. `build_summary_llm_payload`가 응답 목록을 LLM에 넘길 때 다음 형식 강제:

```text
응답자 0 (20대 남 수도권):
  입장: 찬성
  이유: ...
  사각지대: ...
  피해 집단: ...

응답자 1 (50대 여 수도권):
  입장: 반대
  ...
```

프롬프트에 명시:
> "examples와 agent_ids에는 위 '응답자 N' 표기에서 N을 그대로 사용하세요. 새 id를 만들거나 추측하지 마세요."

기존 examples가 이미 "(응답자 0)" 형태로 들어가는 것을 확인함(N=30 데이터 line 3830 등). 이 관행을 명문화.

**프롬프트 지시문에 추가할 내용:**

```
사각지대(blind_spot) 클러스터링 규칙:
- 두 응답 이상이 같은 affected_group을 짚고, 인과 경로(어떤 정책 효과 → 어떤 집단 → 어떤 문제)가 비슷할 때만 묶으세요.
- 1명만 짚은 사각지대는 그대로 단일 cluster로 두세요 (count=1).
- 비슷해 보이지만 affected_group이나 인과 경로가 다른 사각지대는 강제로 합치지 마세요.
- agent_ids에는 그 cluster에 속한 모든 응답자의 agent_id를 넣으세요.

short_label / short_title 규칙:
- short_label (6~10자): 의견 방향을 부호로 표시. 예: "월별 부담↑", "현금흐름↑", "공동체 붕괴"
- short_title (8~14자): 피해 집단을 짧은 명사구로. 예: "보육교사 통근↑", "1인 소유주 자가 관리"
- 그래프 뱃지·카드 제목에 한 줄로 들어가야 하므로 명확하고 짧게.
- label / affected_group은 hover 풀텍스트용이므로 자세히 적어도 됨.
```

### 4-3. 백엔드 파싱 (`summary_from_text`) + 정규화 레이어 (`normalize_summary`)

LLM 출력의 약속 준수를 신뢰할 수 없으므로 **2단계 처리**:

#### 1단계: `summary_from_text` (기존 파서, 변경 최소)

- JSON 파싱만 수행. 필드 누락은 허용 (None/빈 배열).

#### 2단계: `normalize_summary(parsed, responses)` (신규)

- 입력: 파싱된 요약 + 원본 agent_response 리스트
- 검증 및 보정:
  1. **short_label 누락** → 누락된 cluster만 모아 요약 LLM에 **재시도 1회** ("이 cluster들의 short_label만 다시 채워주세요" 프롬프트)
  2. 재시도 후에도 누락 → 해당 cluster를 **OpinionMap 그래프에서 제외**하고 cluster 리스트에만 보존. 프론트에 신호 보내는 플래그 `excluded_from_map: true` 부착.
  3. **short_title 누락** → 동일 재시도 → 폴백 시 사각지대 카드 제목을 `affected_group` 풀텍스트의 첫 14자로(경고 메타데이터 부착) — 카드는 보임, 그래프엔 영향 없음.
  4. **agent_ids 누락 / 일관성 깨짐**: cluster의 `blind_spot_examples` 텍스트에서 "(응답자 N)" 정규식으로 추출 시도. 그래도 실패면 빈 배열 + 프론트는 "정보 없음" 메타.
  5. **agent_ids ⊂ 실제 agent_id 집합 검증**: cluster.agent_ids 중 실제 responses에 없는 id는 제거 + 경고 로그.
  6. **count vs len(unique agent_ids) 불일치**: `count = max(reported_count, len(unique_agent_ids))`로 보정.
- 출력: 보정된 요약 객체.

#### 한 줄: LLM 약속 위반을 백엔드가 흡수하고, 깨진 cluster는 그래프에서 빼되 리스트는 유지

기존 `failed_summary` 반환에 신규 필드 기본값 추가 (`short_label`/`short_title` 빈 문자열, `agent_ids: []`).

### 4-4. `failed_summary` 기본값

`failed_summary` 반환에 새 필드 기본값 추가 (`short_label`/`short_title` 빈 문자열, `agent_ids: []`).

---

## 5. 백엔드 데이터 흐름

`compute_aggregate` 자체엔 구조 변경 없음. 단, 다음을 확인:

- `support_clusters`, `concern_clusters`, `blind_spot_clusters` 모두 LLM 요약 결과를 그대로 통과해 신규 필드(`short_label`, `short_title`, `agent_ids`)가 보존되어야 함.
- `blind_spot_raw`는 기존대로 유지 (디버그·검증용).
- `reframing_list`는 기존대로 유지.

`sampled_agent` 이벤트는 SSE 스트림에 이미 흘러나옴. 프론트는 이를 store에 누적하고 `/result`에서 `blind_spot_cluster.agent_ids`와 조인.

---

## 6. 프론트엔드 타입 (`frontend/src/lib/api.ts`)

```typescript
export type SupportCluster = {
  label: string
  short_label: string         // 신규
  count: number
  examples: string[]
}

export type ConcernCluster = SupportCluster

export type BlindSpotCluster = {
  affected_group: string
  short_title: string         // 신규
  count: number
  blind_spot_examples: string[]
  agent_ids: number[]         // 신규
}

export type ReframingItem = {
  text: string
  age_group: AgeGroup
  gender: Gender
  region_group: RegionGroup
}

export type AggregateEvent = {
  total: StanceCounts
  by_age: Record<AgeGroup, StanceCounts>
  by_gender: Record<Gender, StanceCounts>
  by_region: Record<RegionGroup, StanceCounts>
  support_clusters: SupportCluster[]
  concern_clusters: ConcernCluster[]
  blind_spot_clusters: BlindSpotCluster[]
  reframing_list: ReframingItem[]
}
```

---

## 7. 프론트엔드 컴포넌트 명세

> 컬러 변수는 목업 CSS와 동일 (`--support` 녹, `--oppose` 적, `--warn` 황, `--reframe` 보, `--accent` 청).
> 좌우 배치 규약: **찬성=좌, 반대=우** (모든 시각화 통일).

### 7-1. `ResultPage` (`/result`)

- store에서 `currentRun` 객체 (정책, N, model, aggregate, sampledAgents, completedAt)를 읽음
- 자식 컴포넌트에 분배
- store에 currentRun 없으면 EmptyState 렌더

### 7-2. `ResultHeader`

- 좌: KoreanSim 브랜드 + 정책 chip (`title` 속성에 풀텍스트)
- 우: [실험으로 보내기 →] [디버그 ▾] [재실행]
  - "실험으로 보내기" → `/experiment`로 정책과 N 미리 채워서 이동
  - "디버그" → `/`로 같은 정책·N 채워서 이동
  - "재실행" → store에 보관된 정책·N으로 `/`에서 즉시 재실행

### 7-3. `Hero`

입력:
- `aggregate.total`
- `aggregate.blind_spot_clusters.length`
- `aggregate.reframing_list.length`
- `n_agents`, `model_name`

표시(좌→우, 한 줄):

| stat | 색 | 값 |
|---|---|---|
| 찬성 N | `--support` | total.support |
| 반대 N | `--oppose` | total.oppose |
| 중립 N | `--neutral` | total.neutral |
| (divider) | | |
| 사각지대 N | `--warn` | blind_spot_clusters.length |
| 반문 N | `--reframe` | reframing_list.length |
| (push to right) | | |
| 표본수 N | `--accent` | n_agents |
| 모델 X | `--accent` | model_name |

하단:
- stacked bar: 찬(녹) 좌, 반(적) 우, 중립(회색) 끝. 각 segment width = count / total × 100%

### 7-4. `OpinionMap` (의견 지형도)

입력: `aggregate.support_clusters` + `aggregate.concern_clusters`

좌표계:
- 컨테이너: `.plot-area` (y축 44px 제외한 영역)
- **y_max 계산**: `y_max = niceTickMax(max(n_agents, maxClusterCount))`
  - `n_agents`(표본수)와 cluster의 가장 큰 count 중 큰 쪽 기준
  - 이유: cluster count는 표본수를 넘을 수 있음(한 응답자가 여러 cluster에 카운트). y_max를 N으로만 잡으면 막대가 그래프 위로 튀어나감
  - 반대로 모든 cluster count가 작으면 y축이 너무 비어 보임 — 이때도 N이 기준이 되어 "30명 중 5명"이라는 절대 감각 유지
- y축 표시: 위 y_max를 4~6개 nice tick으로 분할 (예: y_max=30 → 0, 5, 10, 15, 20, 25, 30; y_max=10 → 0, 2, 4, 6, 8, 10)
- y축 상단에 `/${n_agents}명` 마이크로카피 ("표본 30명 기준" 같이)
- y 매핑: `y_pct = (1 - count / y_max) × 88 + 8` (top 8%, bottom 96%)
- x 매핑:
  - support cluster → 좌측 절반 (x ∈ [10%, 45%])
  - concern cluster → 우측 절반 (x ∈ [55%, 90%])

**중복 카운트 안내:**
- `sum(support.count + concern.count) > n_agents` 인 경우 흔함 (한 응답자가 여러 cluster에 등장)
- 그래프 하단 legend에 작은 안내: "*한 응답자가 여러 cluster에 카운트될 수 있음*" 마이크로카피 한 줄
- HERO의 찬성/반대 카운트는 stance 기준(응답자 1명 = 1표)이므로 cluster 카운트 합과 무관 — 사용자가 헷갈리지 않도록 위 안내가 필요

뱃지 표시:
- 텍스트 = `short_label`
- 카운트 배지 = `count`
- 크기 단계: count 1→sz-1, 2→sz-2, 3-4→sz-3, ≥5→sz-5 (목업의 CSS 유지)
- 색: stance 색 (support=녹, concern=적)
- `title` 속성 = `label`(풀텍스트) + " · " + count + "명"

**충돌 방지 알고리즘 (프론트):**

```
function placeBadge(cluster, sameSideBadges):
  c = side_center (좌측=25%, 우측=75%)
  r = 18  // ±18% jitter range
  jitter = (hash(cluster.label) % 2001 - 1000) / 1000  // -1 ~ +1
  x = c + r * jitter

  // 충돌 체크: 같은 y±3% 범위 안에 다른 뱃지가 |x_diff| < 22% 안에 있으면
  while collidesWith(sameSideBadges, x, y, threshold=22):
    r += 4
    if r > 28: break  // 가장자리로 push, 더 이상 못 옮김
    jitter *= 1.2 or flip sign
    x = c + r * jitter

  return x
```

x 라벨:
- "찬성 측" (좌측, left: 25%), "반대 측" (우측, left: 75%)

빈 상태:
- support_clusters=[]: 좌측 절반에 옅은 안내 "이번 실행에선 찬성 cluster 없음"
- concern_clusters=[]: 우측 동일 처리 (드문 경우)

### 7-5. `DemographicBars` (인구 분포 양방향 막대)

입력: `aggregate.by_age`, `by_gender`, `by_region`

세로 스택 3개 섹션(연령 / 성별 / 지역).

행 한 줄 구조:
```
[카테고리 라벨] [찬성 수] [-- 좌 막대 -- | 중심 | -- 우 막대 --] [반대 수]
                  녹                녹              적           적
```

`maxSide` 계산:
```typescript
const allRows = [...byAge, ...byGender, ...byRegion]
const maxSide = Math.max(
  ...allRows.flatMap(r => [r.support, r.oppose])
)
// fallback to 1 if all zero
```

막대 width%: `count / maxSide × 100%`

정렬:
- 연령: 20s → 30s → 40s → 50s → 60s → 70_plus (chronological)
- 성별: male → female
- 지역: total_in_region 내림차순 (응답자 많은 지역부터)
- 응답자 0인 카테고리: 행 숨김 (예: 강원·제주에 sampled 없음)

색:
- 좌측 숫자·막대 = `--support`
- 우측 숫자·막대 = `--oppose`
- 0인 칸: 숫자 회색·흐리게, 막대 없음

라벨 약어:
- 연령: 20대, 30대, ..., 70대+
- 성별: 남성, 여성
- 지역: 수도권, 영남, 호남, 충청, 강원, 제주

### 7-6. `BlindSpotGrid` (사각지대)

입력: `aggregate.blind_spot_clusters` + `sampledAgents` (store)

조인:
- 각 cluster의 `agent_ids[0]`을 대표 페르소나로 사용
- 해당 agent 정보 lookup: `sampledAgents.find(a => a.agent_id === agent_ids[0])`
- 표시될 페르소나 메타: `${age_group_short} ${gender_short} · ${region_short}`
- count ≥ 2면 메타 끝에 "외 N명" 추가 (예: "50대 여 · 은평구 외 3명")

지역 짧은 라벨 (D=c 정책):
- `sampled_agent.region` 형식이 `"<광역>-<시군구>"`라 가정
- 첫 `-` 뒤 문자열에서 첫 공백 전까지 추출
- 예: "서울-은평구" → "은평구"
- 예: "경기-성남시 분당구" → "성남시"
- 추출 실패 시 region_group 라벨 폴백 (수도권/호남/...)

```typescript
function shortRegion(region: string, region_group: RegionGroup): string {
  const dash = region.indexOf('-')
  if (dash < 0) return regionGroupLabel(region_group)
  const tail = region.slice(dash + 1).trim()
  const space = tail.indexOf(' ')
  return space < 0 ? tail : tail.slice(0, space)
}
```

카드 구조:
- 제목: `short_title`
- 인용: `blind_spot_examples[0]` (2~3줄 ellipsis, hover 시 풀텍스트)
- 페르소나 메타 (카드 하단, `.reframe-meta` 스타일과 동일)

카드 배치:
- 3열 grid
- 상위 6장 노출 + "▾ N건 더 보기" 토글
- 정렬: LLM 반환 순서 그대로 (요약기가 우선순위 의식하도록 프롬프트에 명시하는 것은 별도 작업)

빈 상태:
- 0건이면 패널을 안내 메시지로 대체:
  > "이번 실행에서는 뚜렷한 사각지대가 발견되지 않았습니다. 표본수를 늘리거나 정책 문장을 구체화해보세요."

### 7-7. `ReframingList` (정책 전제 반문)

입력: `aggregate.reframing_list`

카드 구조:
- 인용 텍스트 (2줄 ellipsis, hover 시 풀텍스트)
- 페르소나 메타: `${age_group_short} ${gender_short} · ${region_group_short}`
  - 여기선 region_group만 (반문은 sampled_agent 조인 없이 reframing_list 자체에 들어있는 정보로 충분)

배치:
- 2열 grid
- 상위 6건 노출 + "▾ N건 더 보기" 토글

빈 상태:
- 0건이면 섹션 전체 숨김 (Ollama 모델은 reframing을 안 뽑는 게 정상)

---

## 8. 헬퍼 / 유틸

### 8-1. `regionShort(region, region_group)` — 7-6 참조

### 8-2. `ageGroupShort(age_group)`

```
20s → "20대"
30s → "30대"
40s → "40대"
50s → "50대"
60s → "60대"
70_plus → "70대+"
```

### 8-3. `genderShort(gender)`

```
male → "남"
female → "여"
```

### 8-4. `regionGroupLabel(region_group)`

```
capital → "수도권"
yeongnam → "영남"
honam → "호남"
chungcheong → "충청"
gangwon → "강원"
jeju → "제주"
```

### 8-5. `niceTickMax(n)` — y축 nice number

```
n ≤ 5 → 5
n ≤ 10 → 10
n ≤ 20 → 20
n ≤ 30 → 30
n ≤ 50 → 50
n ≤ 100 → 100
otherwise: ceil(n / 50) * 50
```

### 8-6. `seededJitter(str)` — 그래프 충돌 방지

deterministic, hash of string → [-1, 1]. 같은 cluster는 항상 같은 위치.

---

## 9. 빈 상태 / 에러 매트릭스

| 상황 | 처리 |
|---|---|
| store에 currentRun 없음 | `/result` 빈 상태: "`/`에서 먼저 실행하세요" + 링크 |
| support_clusters=[] | OpinionMap 좌측에 옅은 "찬성 cluster 없음" 라벨 |
| concern_clusters=[] | OpinionMap 우측 동일 처리 |
| blind_spot_clusters=[] | BlindSpotGrid 전체를 안내 메시지로 대체 |
| reframing_list=[] | ReframingList 섹션 전체 숨김 |
| 일부 응답 실패 (failed_agents > 0) | Hero 표본수 옆에 "(성공 N / 요청 M)" 작게 표시 |
| sampled_agent 조인 실패 (agent_ids에 없는 id) | 페르소나 메타 "정보 없음"으로 폴백 |
| LLM 요약 자체 실패 | 클러스터 패널들은 비어 있음, "요약 생성 실패" 안내 |

---

## 10. 검증

### 10-1. 픽스처

- `backend/tests/fixtures/result_n5.json` — 전세_1.csv 변환본 (필드명 정렬)
- `backend/tests/fixtures/result_n30.json` — 전세_2.csv 변환본
- 두 픽스처는 새 필드(`short_label`, `short_title`, `agent_ids`)가 채워진 형태로 준비

### 10-2. 백엔드 테스트

- `parse_agent_response` 변경 없음 검증
- `summary_from_text` 가 `short_label`/`short_title`/`agent_ids` 파싱
- short_label/short_title 누락 시 폴백 동작
- 단건 사각지대가 cluster로 강제 묶이지 않음 (모의 LLM 응답 사용)
- `failed_summary`에 신규 필드 기본값 포함

### 10-3. 프론트엔드 테스트

- 헬퍼 유닛 테스트: `regionShort`, `ageGroupShort`, `niceTickMax`, `seededJitter`(determinism)
- `ResultPage` 빈 store 렌더
- `OpinionMap` 뱃지 충돌 회피 시뮬레이션 (같은 stance에 10개 cluster 투입)
- `DemographicBars`에 빈 카테고리 입력 → 행 숨김

### 10-4. 시각 회귀

- Playwright 스크린샷 2장 (N=5, N=30 픽스처)
- `docs/mockups/main-result.html`의 N=30 버전과 시각적으로 일치하는지 확인

---

## 11. 산출물 / 후속

- `tasks/main-redesign/spec.md` (이 문서, Claude)
- `tasks/main-redesign/plan.md` (구현 단계, Claude가 작성)
- `tasks/main-redesign/status.md` (Codex 진행 상태)
- `tasks/main-redesign/reviews.md` (크로스 리뷰)

구현은 plan.md 기반으로 `/codex:rescue` 또는 `/superpowers:subagent-driven-development`로 위임.

---

## 12. 미해결 / 향후

- N-적응형 레이아웃 (현재 단일)
- LLM 자연어 한 줄 헤드라인 렌더링
- `/result?runId=` 영구 링크
- 사각지대 카드 다양성 부스트 (같은 region 연속 3장 방지)
- 그래프에 반문 표시 통합 (현재는 카운트만 Hero에, 본문은 별도 섹션)
- 응답 30개 카드 그리드 (현재 토글로 숨김. 별도 컴포넌트 명세 필요)
