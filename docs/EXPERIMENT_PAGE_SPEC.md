# KoreanSim 실험 페이지 설계 문서

## 목적

기존 시뮬레이션 페이지와 별도로, 아래 검증 실험을 체계적으로
수행할 수 있는 실험 전용 페이지를 구축한다.

검증 목록:
1. 파라미터 민감도 (조건 변경 → 결과 차이)
2. 프롬프트 프레이밍 영향 (중립/긍정/부정)
3. 배경 정보 유무
4. 찬반 제시 방식
5. Thinking ON/OFF
6. 페르소나 정보량
7. 모델 간 일관성
8. 반복 실행 안정성
9. 이슈 유형별 LLM 편향
10. 한국 문화 맥락 이슈 vs 보편 이슈

---

## 라우팅

기존: `/` (메인 시뮬레이션 페이지)
추가: `/experiment` (실험 페이지)

헤더에 탭으로 전환 가능하게 구성.

---

## 페이지 레이아웃

```
┌─────────────────────────────────────────────────┐
│  [ 시뮬레이션 ]  [ 실험실 ]   ← 헤더 탭         │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌── 실험 설정 패널 ──────────────────────────┐ │
│  │ 모델      Thinking  페르소나   반복횟수     │ │
│  │ [선택▼]   [OFF●ON○]  [depth▼]  [1회▼]     │ │
│  │ 에이전트 수: [30]                           │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ┌── 정책 슬롯 ───────────────────────────────┐ │
│  │  [프리셋 불러오기 ▼]                        │ │
│  │                                             │ │
│  │  슬롯 A  [x]        슬롯 B  [x]            │ │
│  │  [textarea]         [textarea]              │ │
│  │                                             │ │
│  │  [+ 슬롯 추가]                              │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  [ ▶ 실험 실행 ]                                │
│                                                 │
│  ┌── 결과 비교 ───────────────────────────────┐ │
│  │  (실행 후 표시)                             │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## 실험 설정 패널

### 모델 선택

Provider와 모델을 선택한다.

```typescript
type ModelConfig =
  | { provider: "ollama"; model: string }
  | { provider: "openai"; model: string };
```

UI:
- Provider 드롭다운: `Ollama` / `OpenAI`
- Ollama 선택 시: 모델명 입력 또는 선택 (기본값: `qwen3.5:9b`)
  - 자주 쓰는 모델 버튼: `qwen3.5:9b` `gemma4:26b` `exaone3.5:7.8b`
  - 직접 입력 가능한 텍스트 필드
- OpenAI 선택 시: 모델 드롭다운 (`gpt-4o` / `gpt-4o-mini`)
  - API Key는 프런트엔드에서 입력/저장하지 않는 것을 기본 원칙으로 한다.
  - 백엔드는 서버 환경변수 `OPENAI_API_KEY`를 사용한다.
  - 로컬 실험 편의를 위해 사용자 입력 키를 허용하더라도 localStorage/sessionStorage에 저장하지 않고, 요청 로그에도 남기지 않는다.

### Thinking 토글

```
[OFF ●───○ ON]
```

- 기본값: OFF
- Ollama 모델에만 적용 (OpenAI는 비활성화)
- `think: true/false` 로 API 전달

### 페르소나 Depth

```
[최소 ○] [중간 ●] [풍부 ○]
```

- `minimal`: age, gender, region만 프롬프트에 포함
- `standard`: + job, education (기본값)
- `full`: NVIDIA 전체 텍스트 (persona + cultural_background + career_goals + hobbies)

백엔드에서 `persona_depth` 파라미터를 받아 프롬프트 구성 시 포함할 필드를 조절한다.

### 반복 횟수

드롭다운: `1회` / `3회` / `5회`

- 1회 이상 선택 시 동일 설정으로 N번 실행
- 결과에 평균과 표준편차 표시

### 검색 컨텍스트 주입

```
[OFF ●] [ON ○]
```

기본값은 OFF다. 프레이밍/배경 정보/찬반 제시 방식의 영향을 비교하는 실험에서는
검색 컨텍스트를 OFF로 유지한다. 검색 컨텍스트는 "현실 정보 주입 효과" 자체를
검증할 때만 ON으로 켠다.

ON 선택 시 추가 옵션:
- 검색 제공자: `Tavily` / `DuckDuckGo`
- Tavily 선택 시: API Key 입력 필드
- 검색 범위: `뉴스만` / `전체 웹`

**동작 방식:**
1. 정책 텍스트 → LLM이 검색 쿼리 2개 생성
2. 검색 실행 → 결과 수집
3. Tavily: `include_answer="basic"`으로 자동 요약
   DuckDuckGo: 별도 요약 LLM 호출
4. 요약문 (200~300토큰) → 전체 페르소나에 동일하게 주입

**프롬프트 주입 형식:**
```
[현재 사회적 논점]
찬성 측: ...
반대 측: ...
최근 동향: ...
```

- 검색은 시뮬레이션 시작 전 1회만 실행
- 페르소나별로 검색을 반복하지 않음
- 멀티 슬롯 비교에서는 모든 슬롯에 동일한 검색 요약문을 주입
- 결과 화면에 실제 주입된 검색 요약문을 표시
- OFF 시 기존 방식과 동일 (검색 없음)

### 에이전트 수

숫자 입력: 기본값 30, 범위 5~100

---

## 정책 슬롯

### 슬롯 구조

최대 3개 슬롯 (A / B / C). 기본 1개, `+ 슬롯 추가` 버튼으로 추가.

각 슬롯:
```
┌─ 슬롯 A ─────────────────────────── [×] ─┐
│ [프리셋 선택 ▼]                            │
│ ┌─────────────────────────────────────┐   │
│ │                                     │   │
│ │  (정책 텍스트 입력)                  │   │
│ │                                     │   │
│ └─────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

### 프리셋 선택 드롭다운

`EXPERIMENT_PROMPTS_SPEC.md`에서 생성된 JSON 파일을 import해서 사용한다.

드롭다운 구조:
```
── 사분면 1: 보편 × 편향 강함 ──
  사형제 유지 / 중립 / 배경없음 / 명시적
  사형제 유지 / 긍정 / 배경없음 / 명시적
  사형제 유지 / 부정 / 배경없음 / 명시적
  ...
── 사분면 2: 보편 × 편향 약함 ──
  원자력 확대 / 중립 / 배경없음 / 명시적
  ...
── 사분면 3: 한국 특수 × 편향 강함 ──
  ...
── 사분면 4: 한국 특수 × 편향 약함 ──
  ...
── 파라미터 변형 ──
  노인 교통비 / 65세 / 30만원 (기본)
  노인 교통비 / 70세 / 30만원
  노인 교통비 / 65세 / 10만원
  노인 교통비 / 65세 / 30만원 / 소득하위50%
  ...
```

프리셋 선택 시 textarea에 자동으로 프롬프트 채워짐.

---

## 실험 실행 버튼

```
[ ▶ 실험 실행 ]
```

- 슬롯 A만 있으면 단일 시뮬레이션
- 슬롯 B/C 있으면 병렬 실행 (Promise.all)
- 반복 횟수 > 1이면 순차 실행 후 집계

---

## 응답 매핑 규칙

모든 실험 결과는 최종적으로 기존 집계 형식인 `찬성 / 반대 / 중립`으로 정규화한다.
프롬프트의 `stance_format`에 따라 아래 규칙을 적용한다.

### explicit

LLM이 `찬성`, `반대`, `중립/유보` 중 하나를 명시적으로 선택하도록 한다.
응답 파싱 결과를 그대로 `support`, `oppose`, `neutral`에 매핑한다.

### open

개방형 질문의 원문 응답을 보존한 뒤, 별도 분류 단계에서 `찬성 / 반대 / 중립`으로
매핑한다. 명시적 찬성 표현은 `support`, 명시적 반대 표현은 `oppose`로 분류한다.
양쪽 장단점만 언급하고 결론이 없거나 조건부 입장이 애매하면 `neutral`로 둔다.

### scale

1~5점 척도를 사용하고 아래처럼 매핑한다.

```text
1점, 2점 → 찬성
3점     → 중립
4점, 5점 → 반대
```

`open`과 `scale` 실험에서도 원문 응답과 원점수는 저장해서, 결과 비교 화면에서
필요하면 분류 근거를 확인할 수 있게 한다.

---

## 결과 비교 패널

### 단일 슬롯 / 단일 실행

기존 메인 페이지 결과와 동일한 형태.

### 멀티 슬롯 비교 (A vs B vs C)

```
┌────────────────────────────────────────────────────┐
│  전체 찬반 비교                                     │
│                                                    │
│           슬롯 A      슬롯 B      슬롯 C           │
│  찬성      65%        71%        58%               │
│  반대      24%        18%        31%               │
│  중립      11%        11%        11%               │
│                                                    │
│  [찬성 차이: A↔B +6%, A↔C -7%]                    │
├────────────────────────────────────────────────────┤
│  연령대별 비교                                      │
│                                                    │
│  20대     A: 찬성 71%    B: 찬성 78%    C: 찬성 65% │
│  30대     A: 찬성 65%    B: 찬성 70%    C: 찬성 60% │
│  ...                                               │
├────────────────────────────────────────────────────┤
│  우려사항 클러스터 비교                              │
│  슬롯 A: 재정우려(5) / 세대형평(3) / ...            │
│  슬롯 B: 소상공인(7) / 지역상권(4) / ...            │
└────────────────────────────────────────────────────┘
```

### 반복 실행 안정성 (반복 횟수 > 1)

```
┌────────────────────────────────────────────────────┐
│  반복 실행 결과 (3회)                               │
│                                                    │
│           1회차     2회차     3회차    평균   표준편차│
│  찬성      63%       65%       68%    65.3%   2.1% │
│  반대      27%       25%       23%    25.0%   2.0% │
│  중립      10%       10%        9%     9.7%   0.6% │
│                                                    │
│  안정성 평가: ████████░░ 높음 (표준편차 < 3%)       │
└────────────────────────────────────────────────────┘
```

### 실제 여론 비교 (프리셋 사용 시)

프리셋에 `real_opinion` 데이터가 있으면 함께 표시:

```
┌────────────────────────────────────────────────────┐
│  실제 여론 비교 (한국갤럽 2022)                     │
│                                                    │
│           시뮬레이션    실제 여론    차이            │
│  찬성      27%          69%        -42%  ⚠️        │
│  반대      73%          23%        +50%  ⚠️        │
│                                                    │
│  → LLM 편향 강함. Prior 보정 권장.                 │
└────────────────────────────────────────────────────┘
```

실제 여론은 기본적으로 "참고 기준"으로 표시한다. 여론조사 질문 문구, 조사 시점,
응답 선택지, 표본이 시뮬레이션 프롬프트와 다를 수 있으므로 절대적인 정답값으로
취급하지 않는다. 프리셋에는 가능한 한 아래 메타데이터를 포함한다.

```json
{
  "support": 69,
  "oppose": 23,
  "neutral": 8,
  "source": "한국갤럽",
  "year": 2022,
  "question": "사형제 유지에 대한 찬반",
  "url": "https://...",
  "note": "질문 문구가 시뮬레이션 프롬프트와 완전히 동일하지 않음"
}
```

---

## 백엔드 수정 사항

### 검색 서비스 (search_service.py 신규)

```python
from tavily import TavilyClient
from duckduckgo_search import DDGS

async def get_policy_context(
    policy: str,
    provider: str = "tavily",
    api_key: str | None = None,
    topic: str = "news"
) -> str | None:
    """
    정책 텍스트 → 검색 쿼리 생성 → 검색 → 요약문 반환
    반환값: 200~300토큰 내외 요약문 또는 None
    """

    # 1. 검색 쿼리 생성 (LLM)
    queries = await generate_search_queries(policy)
    # 예: ["원자력 발전 확대 찬반 여론", "신규 원전 건설 논란 한국"]

    if provider == "tavily":
        client = TavilyClient(api_key=api_key)
        result = client.search(
            query=queries[0],
            include_answer="basic",  # Tavily가 자동 요약
            topic=topic,             # "news" or "general"
            max_results=3
        )
        return result.get("answer")  # 요약문 바로 반환

    elif provider == "duckduckgo":
        with DDGS() as ddgs:
            results = [r["body"] for r in ddgs.text(queries[0], max_results=3)]
        # 별도 요약 LLM 호출 필요
        return await summarize_search_results(policy, results)
```

### SimulateRequest 스키마 확장

```python
class SimulateRequest(BaseModel):
    policy: str
    n_agents: int = 30

    # 모델 설정
    model_provider: str = "ollama"
    model_name: str = "qwen3.5:9b"

    # 실험 설정
    thinking: bool = False
    persona_depth: str = "standard"   # "minimal" | "standard" | "full"

    # 검색 컨텍스트
    search_enabled: bool = False
    search_provider: str = "tavily"   # "tavily" | "duckduckgo"
    search_api_key: str | None = None
    search_topic: str = "news"        # "news" | "general"
```

### 페르소나 depth 처리

`llm_client.py`의 `build_agent_prompt`에서
`persona_depth`에 따라 포함할 필드 조절:

```python
def build_agent_prompt(persona, policy, prior=None, persona_depth="standard"):
    if persona_depth == "minimal":
        # age, gender, region만
    elif persona_depth == "standard":
        # + job, education (현행 방식)
    elif persona_depth == "full":
        # structured_profile + narrative_context 전체
```

### OpenAI 연동

```python
# requirements.txt에 추가
openai>=1.0.0

# llm_client.py에 추가
def get_agent_response_openai(persona, policy, prior, model):
    import os
    from openai import OpenAI
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is required for OpenAI simulations")
    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=model,
        response_format={"type": "json_object"},
        messages=build_agent_messages(persona, policy, prior),
    )
    return parse_agent_response(response.choices[0].message.content)
```

### thinking 파라미터 전달

```python
# simulate.py
response = client.chat(
    ...
    think=req.thinking,  # SimulateRequest에서 받은 값
)
```

---

## 프런트엔드 파일 구조

```
frontend/src/
├── App.tsx                    # 라우팅 (/ 와 /experiment)
├── pages/
│   ├── SimulatePage.tsx       # 기존 메인 페이지
│   └── ExperimentPage.tsx     # 실험 페이지 (신규)
├── components/
│   ├── ExperimentSettings.tsx # 실험 설정 패널
│   ├── PolicySlot.tsx         # 정책 슬롯 (프리셋 포함)
│   ├── ComparisonResult.tsx   # 멀티 슬롯 결과 비교
│   ├── StabilityResult.tsx    # 반복 실행 안정성
│   └── RealOpinionBadge.tsx   # 실제 여론 비교
├── data/
│   └── presets.json           # 프리셋 프롬프트 (코덱스가 생성)
└── lib/
    ├── api.ts                 # 기존 API 클라이언트 (확장)
    └── experiment.ts          # 실험 유틸 (병렬 실행, 집계)
```

---

## experiment.ts 핵심 로직

```typescript
// 멀티 슬롯 병렬 실행
export async function runExperiment(
  slots: string[],
  config: ExperimentConfig,
  onProgress: (slotIdx: number, event: SimEvent) => void
): Promise<SlotResult[]> {
  return Promise.all(
    slots.map((policy, idx) =>
      runSingleSimulation(policy, config, (event) => onProgress(idx, event))
    )
  );
}

// 반복 실행 집계
export function computeStability(results: AggregateResult[]): StabilityReport {
  const supportRates = results.map(r => r.total.support / totalN(r));
  return {
    mean: mean(supportRates),
    stddev: stddev(supportRates),
    runs: results,
  };
}
```

---

## 구현 우선순위

**Phase 1 (핵심 기능):**
- [ ] `/experiment` 라우트 추가
- [ ] 실험 설정 패널 (모델, Thinking, 페르소나 depth, 반복 횟수)
- [ ] 멀티 슬롯 입력 (A/B/C)
- [ ] 프리셋 JSON import 및 드롭다운
- [ ] 멀티 슬롯 병렬 실행 및 나란히 결과 표시

**Phase 2 (분석 기능):**
- [ ] 반복 실행 안정성 (평균/표준편차)
- [ ] 실제 여론 비교 배지
- [ ] OpenAI 연동
- [ ] 검색 컨텍스트 주입 (Tavily / DuckDuckGo)

**Phase 3 (편의 기능):**
- [ ] 실험 결과 저장/불러오기 (localStorage)
- [ ] CSV 내보내기
