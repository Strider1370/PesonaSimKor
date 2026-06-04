# KoreanSim 실험 페이지 변경 스펙 v2

기존 구현을 기반으로 **실제로 새로 추가/변경할 것만** 명시한다.
이미 구현된 것(페르소나 샘플링, SSE 스트리밍, heartbeat, 멀티슬롯, 프리셋, 실험 저장, CSV 내보내기 등)은 건드리지 않는다.

---

## 목적 변경

기존 목적:
> 검증 실험을 체계적으로 수행

변경 목적:
> **정책 설계자가 혼자 생각했을 때 놓치기 쉬운 집단과 우려를 발굴한다.**

이 기능은 여론조사 대체재가 아니라 정책 설계 초기 단계의 탐색 도구다. 목소리를 내기 어려운 집단의 잠재적 반응을 페르소나 기반으로 시뮬레이션한다.

핵심 명제:
> 페르소나의 배경에서 합리적으로 추론된 다양한 반응

성공 기준:
> 정책 담당자가 혼자 생각했을 때 못 떠올렸던 집단이나 우려가 나왔는가

---

## 1. 검증 Level 탭

`/experiment` 페이지 상단에 Level 탭을 추가한다. 루트 `/` 시뮬레이션 화면은 변경하지 않는다.

각 Level은 별도 페이지나 실행 모드가 아니라, **현재 설정에서 활성화된 기능 상태를 보여주는 안내 UI**다. 탭 선택은 설정이나 실행 결과에 영향을 주지 않는다.

```text
[L1: 다양성 ●] [L2: Prior저항 ○] [L3: 반문 ○] [L4: 대안 ○]
```

| Level | 설명 | 활성화 조건 |
| --- | --- | --- |
| L1 | 페르소나마다 다른 이유로 다른 반응 | 항상 활성 |
| L2 | Prior가 있어도 페르소나 맥락으로 다르게 반응 | Prior 수집 후 활성. 현재 비활성 |
| L3 | 정책 전제에 대한 반문 | OpenAI 모델 선택 시 활성 |
| L4 | 페르소나 맥락에서 대안 제시 | 미구현. 탭만 표시 |

안내 문구:
- L2: `Prior 데이터 미수집 - 갤럽 크롤링 파이프라인 구축 후 활성화`
- L4: `미구현 - 장기 목표`

```typescript
function getActiveLevels(modelProvider: string, hasPrior: boolean): number[] {
  const levels = [1]
  if (hasPrior) levels.push(2)
  if (modelProvider === "openai") levels.push(3)
  return levels
}
```

---

## 2. 백엔드 - llm_client.py

### 2-1. 시스템 프롬프트와 build_agent_prompt 수정

현재 영어 시스템 프롬프트를 모델별로 분리하고 한국어로 변경한다. `blind_spot`, `affected_group` 지침을 추가한다.

중요: 시스템 프롬프트만 바꾸면 충분하지 않다. `build_agent_prompt`가 만드는 user prompt 끝부분에도 기존 응답 스키마를 제한하는 문구가 남아 있으면 모델은 새 필드를 출력하지 않을 수 있다.

`build_agent_prompt` 함수 끝부분에 있는 아래 의미의 문구는 반드시 제거하거나 새 시스템 프롬프트의 JSON 구조와 일치하도록 수정한다.

```python
"Return only JSON with keys stance and rationale"
"exactly two keys"
```

user prompt 어디에도 필드 수를 `stance`/`rationale` 두 개로 제한하는 문구가 남아 있으면 안 된다. 특히 `exactly two keys`, `keys stance and rationale`, `only stance and rationale`처럼 필드 수나 필드명을 좁히는 표현은 모두 제거 대상이다.

`build_agent_prompt`의 마지막 지시는 새 응답 스키마와 충돌하지 않아야 한다. 동시에 모델이 새 JSON 필드의 의미를 실제로 답하도록, 정책 입장과 사각지대 질문을 자연어로 다시 제시해야 한다.

권장 교체 문구:

```python
"""위 정책에 대해 당신의 입장은 찬성, 반대, 중립 중 어느 쪽에 가깝습니까?
그리고 이 정책이 당신 같은 처지의 사람에게 예상치 못한 문제를 일으킬 수 있다면 무엇인지,
당신의 구체적인 직업과 생활 상황에서만 보이는 부분을 말씀해주세요.

반드시 시스템 메시지에서 요구한 JSON 구조와 일치하는 JSON만 반환하세요.
일반적인 정책 분석이 아니라 이 시민의 생활 맥락에서 답하세요."""
```

즉, 개별 필드 목록은 시스템 프롬프트의 모델별 JSON 예시가 책임진다. user prompt는 그 구조를 다시 축소하거나 덮어쓰지 않고, 모델이 `rationale`, `blind_spot`, `affected_group`에 들어갈 내용을 해당 페르소나 관점에서 생각하도록 유도한다.

Ollama용:

```python
SYSTEM_PROMPT_OLLAMA = """당신은 주어진 인물 정보에 충실한 한국 시민입니다.
해당 인물의 배경, 직업, 생활환경을 바탕으로 정책에 대한 입장을 밝혀주세요.
반드시 아래 JSON 형식으로만 답하세요. 다른 텍스트는 절대 포함하지 마세요.
반드시 한국어로만 답하세요.

{
  "stance": "찬성" 또는 "반대" 또는 "중립",
  "rationale": "입장 이유 (2문장, 이 인물의 관점에서)",
  "blind_spot": "이 정책이 당신 같은 처지의 사람에게 예상치 못한 문제를 일으킬 수 있다면? 정책 전문가도 이미 아는 일반적인 우려(재원 부족, 형평성 등)가 아니라, 당신의 구체적인 직업·생활·경제 상황에서만 보이는 문제를 쓰세요. (1~2문장)",
  "affected_group": "당신과 비슷한 처지의 사람들 중 이 정책으로 가장 타격받을 집단 (한 줄)"
}"""
```

OpenAI용:

```python
SYSTEM_PROMPT_OPENAI = """당신은 주어진 인물 정보에 충실한 한국 시민입니다.
해당 인물의 배경, 직업, 생활환경을 바탕으로 정책에 대한 입장을 밝혀주세요.
반드시 아래 JSON 형식으로만 답하세요. 다른 텍스트는 절대 포함하지 마세요.
반드시 한국어로만 답하세요.

{
  "stance": "찬성" 또는 "반대" 또는 "중립",
  "rationale": "입장 이유 (2문장, 이 인물의 관점에서)",
  "blind_spot": "당신의 구체적인 삶의 맥락에서만 보이는 예상치 못한 문제 (1~2문장)",
  "affected_group": "가장 타격받을 집단 (한 줄)",
  "reframing": "이 정책의 전제나 방향 자체에 동의하지 않는 부분이 있다면 반문하세요. 없으면 null.",
  "persona_link": {
    "direct": "페르소나 텍스트에서 직접 언급된 근거만 쓰세요. 예: '아파트 거주, 자녀와 동거'",
    "inferred": "텍스트에 없지만 맥락에서 합리적으로 추론한 것. 예: '운전원 소득 -> 주거비 민감'. 스테레오타입은 피하세요."
  }
}"""
```

`build_agent_messages`는 `model_provider`에 따라 시스템 프롬프트를 선택한다.

```python
def build_agent_messages(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    persona_depth: str = "standard",
    model_provider: str = "ollama",
) -> list[dict[str, str]]:
    system = SYSTEM_PROMPT_OPENAI if model_provider == "openai" else SYSTEM_PROMPT_OLLAMA
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": build_agent_prompt(persona, policy, prior, persona_depth)},
    ]
```

`build_agent_llm_payload`에도 `model_provider`를 추가하고 메시지 생성에 전달한다.

```python
def build_agent_llm_payload(
    persona: dict,
    policy: str,
    prior: dict | None = None,
    model_name: str | None = None,
    thinking: bool = False,
    persona_depth: str = "standard",
    model_provider: str = "ollama",
) -> dict:
    return {
        "agent_id": persona["agent_id"],
        "model": model_name or ollama_model(),
        "format": "json",
        "messages": build_agent_messages(persona, policy, prior, persona_depth, model_provider),
        "options": agent_options(),
        "think": thinking,
    }
```

### 2-2. parse_agent_response 확장

현재 `stance`, `rationale`만 파싱한다. 공통 필드와 OpenAI 전용 필드를 추가로 파싱한다.

```python
def parse_agent_response(text: str, model_provider: str = "ollama") -> dict:
    try:
        parsed = parse_json_object(text)
    except Exception:
        return dict(AGENT_FALLBACK)

    parsed = {str(key).strip(): value for key, value in parsed.items()}
    stance = normalize_stance(parsed.get("stance"))
    rationale = parsed.get("rationale") or parsed.get("reason") or parsed.get("explanation") or ""
    if not isinstance(rationale, str) or not rationale.strip():
        rationale = AGENT_FALLBACK["rationale"]

    result = {"stance": stance, "rationale": rationale.strip()}

    for field in ("blind_spot", "affected_group"):
        val = parsed.get(field)
        if isinstance(val, str) and val.strip():
            result[field] = val.strip()

    if model_provider == "openai":
        reframing = parsed.get("reframing")
        if isinstance(reframing, str) and reframing.strip() and reframing.strip().lower() != "null":
            result["reframing"] = reframing.strip()

        persona_link = parsed.get("persona_link")
        if isinstance(persona_link, dict):
            direct = persona_link.get("direct", "")
            inferred = persona_link.get("inferred", "")
            if isinstance(direct, str) and isinstance(inferred, str):
                direct = direct.strip()
                inferred = inferred.strip()
                if direct or inferred:
                    result["persona_link"] = {
                        "direct": direct,
                        "inferred": inferred,
                    }

    return result
```

---

## 3. 백엔드 - simulate.py

### 3-1. model_provider 전달

`stream_agent_response`와 `stream_openai_agent_response` 함수 시그니처에 `model_provider`를 추가하고, 최종 파싱 시 `parse_agent_response(..., model_provider=model_provider)`로 전달한다.

```python
def stream_agent_response(
    persona,
    policy,
    prior=None,
    model_name=None,
    thinking=False,
    persona_depth="standard",
    model_provider="ollama",
):
    ...
    result = parse_agent_response(final_text, model_provider=model_provider)
```

`stream_configured_agent_response_with_heartbeat`에서는 `req.model_provider`를 Ollama/OpenAI 스트림 함수 모두에 전달한다.

`llm_prompt` 이벤트 생성을 위한 `build_agent_llm_payload` 호출에도 `model_provider=req.model_provider`를 전달한다. 그래야 UI의 입력 로그에도 실제 provider별 시스템 프롬프트가 보인다.

### 3-2. agent_responded 이벤트 확장

`response_event`에 새 필드를 포함한다. 이 이벤트는 `responses`에 append된 뒤 `compute_aggregate(responses)`로 전달되므로, 집계에서도 같은 데이터를 사용할 수 있다.

```python
response_event = {
    "agent_id": persona["agent_id"],
    "age_group": persona["age_group"],
    "gender": persona["gender"],
    "region_group": persona["region_group"],
    "stance": result.get("stance", "neutral"),
    "rationale": result.get("rationale", ""),
    "blind_spot": result.get("blind_spot"),
    "affected_group": result.get("affected_group"),
    "reframing": result.get("reframing"),
    "persona_link": result.get("persona_link"),
}
```

---

## 4. 백엔드 - aggregation.py 및 summary 파싱

### 4-1. compute_aggregate 확장

기존 `total`, `by_age`, `by_gender`, `by_region`, `concern_clusters`, `support_clusters` 로직은 유지한다.

추가로 `blind_spot_raw`, `reframing_list`, `blind_spot_clusters`를 반환한다.

`blind_spot_raw`에는 `blind_spot`과 `affected_group`을 함께 넣는다. `affected_group_raw`는 별도로 만들지 않는다.

```python
def compute_aggregate(responses: list[dict]) -> dict:
    # 기존 total/by_age/by_gender/by_region 계산 유지
    result = {
        "total": total,
        "by_age": by_age,
        "by_gender": by_gender,
        "by_region": by_region,
        "concern_clusters": [],
        "support_clusters": [],
    }

    result["blind_spot_raw"] = [
        {
            "blind_spot": r["blind_spot"],
            "affected_group": r.get("affected_group", ""),
        }
        for r in responses
        if r.get("blind_spot")
    ]

    result["reframing_list"] = [
        {
            "text": r["reframing"],
            "age_group": r.get("age_group", ""),
            "gender": r.get("gender", ""),
            "region_group": r.get("region_group", ""),
        }
        for r in responses
        if r.get("reframing")
    ]

    result["blind_spot_clusters"] = []
    return result
```

### 4-2. 요약 LLM 프롬프트 확장

`build_summary_llm_payload`의 시스템 프롬프트와 return schema를 모두 바꾼다. 기존 `concern_clusters`, `support_clusters`에 더해 `blind_spot_clusters`를 요구한다.

`affected_group_clusters`는 만들지 않는다. 피해 집단 정보는 `blind_spot_clusters` 안에 포함한다.

```text
Return only a valid JSON object with exactly three arrays:
concern_clusters, support_clusters, blind_spot_clusters.

concern_clusters/support_clusters:
  Each item: { "label": "string", "count": N, "examples": ["string"] }

blind_spot_clusters:
  Group blind_spot items by affected group and concrete hidden policy risk.
  Each item:
  {
    "affected_group": "피해 집단명 (한 줄)",
    "count": N,
    "blind_spot_examples": ["사각지대 예시1", "사각지대 예시2"]
  }
```

user prompt의 return schema 예:

```python
'Return schema: {"concern_clusters":[{"label":"string","count":1,"examples":["string"]}],'
'"support_clusters":[{"label":"string","count":1,"examples":["string"]}],'
'"blind_spot_clusters":[{"affected_group":"string","count":1,"blind_spot_examples":["string"]}]}'
```

### 4-3. summary_from_text / failed_summary 기본값

`summary_from_text`는 세 배열을 모두 파싱한다.

```python
def summary_from_text(raw_output: str) -> dict:
    parsed = parse_json_object(raw_output)
    concerns = parsed.get("concern_clusters", [])
    support = parsed.get("support_clusters", [])
    blind_spots = parsed.get("blind_spot_clusters", [])

    concern_clusters = concerns if isinstance(concerns, list) else []
    support_clusters = support if isinstance(support, list) else []
    blind_spot_clusters = blind_spots if isinstance(blind_spots, list) else []

    has_clusters = bool(concern_clusters or support_clusters or blind_spot_clusters)
    return {
        "status": "completed" if has_clusters else "empty",
        "message": "요약이 생성되었습니다." if has_clusters else "요약 모델이 빈 cluster 배열을 반환했습니다.",
        "concern_clusters": concern_clusters,
        "support_clusters": support_clusters,
        "blind_spot_clusters": blind_spot_clusters,
        "raw_output": raw_output,
    }
```

`failed_summary`는 기존 시그니처를 유지하고 반환값에 `blind_spot_clusters`만 추가한다.

```python
def failed_summary(message: str, raw_output: str = "") -> dict:
    return {
        "status": "failed",
        "message": message,
        "concern_clusters": [],
        "support_clusters": [],
        "blind_spot_clusters": [],
        "raw_output": raw_output,
    }
```

`simulate.py`의 초기 summary 기본값도 같은 키를 포함해야 한다.

```python
summary = {
    "status": "failed",
    "message": "Summary generation failed.",
    "concern_clusters": [],
    "support_clusters": [],
    "blind_spot_clusters": [],
    "raw_output": "",
}
```

summary 결과를 aggregate에 병합할 때는 `KeyError` 방지를 위해 `.get`을 사용한다.

```python
aggregate["concern_clusters"] = summary.get("concern_clusters", [])
aggregate["support_clusters"] = summary.get("support_clusters", [])
aggregate["blind_spot_clusters"] = summary.get("blind_spot_clusters", [])
```

---

## 5. 프런트엔드 - lib/api.ts 타입 확장

`AgentRespondedEvent`에 새 필드를 추가한다.

```typescript
export type AgentRespondedEvent = {
  agent_id: number
  age_group: AgeGroup
  gender: Gender
  region_group: RegionGroup
  stance: Stance
  rationale: string
  blind_spot?: string
  affected_group?: string
  reframing?: string
  persona_link?: {
    direct: string
    inferred: string
  }
}
```

`AggregateEvent`에 새 필드를 추가한다.

```typescript
export type AggregateEvent = {
  total: StanceCounts
  by_age: Record<string, StanceCounts>
  by_gender: Record<string, StanceCounts>
  by_region: Record<string, StanceCounts>
  concern_clusters: Cluster[]
  support_clusters: Cluster[]
  blind_spot_clusters: BlindSpotCluster[]
  reframing_list: ReframingItem[]
}

export type BlindSpotCluster = {
  affected_group: string
  count: number
  blind_spot_examples: string[]
}

export type ReframingItem = {
  text: string
  age_group: string
  gender: string
  region_group: string
}
```

---

## 6. 프런트엔드 - App.tsx

### 6-1. Level 탭 추가

`ExperimentPage`의 설정 패널 근처에 Level 안내 UI를 추가한다.

현재 코드에서 `modelProvider` 상태는 `/experiment`에만 있으므로 Level 탭도 `/experiment`에만 표시한다.

```text
[L1: 다양성 ●] [L2: Prior저항 ○] [L3: 반문 ○] [L4: 대안 ○]

L2: Prior 데이터 미수집 - 갤럽 크롤링 파이프라인 구축 후 활성화
L4: 미구현 - 장기 목표
```

### 6-2. 에이전트 카드 확장

기존 응답 카드에 아래 필드를 추가한다.

- `blind_spot`: 있을 때만 표시
- `affected_group`: 있을 때만 표시
- `persona_link`: 있을 때만 접힘 UI로 표시. OpenAI 모델 결과에서만 예상된다.

카드 예시:

```text
[반대] 40대 · 여성 · 수도권 · 운전원
"전세를 폐지하면 매달 나가는 고정비가 늘어 워킹맘 가정의 현금 흐름이 압박받습니다."

사각지대: 월세 전환 시 현금 흐름 압박
타격 집단: 경기도 외곽 중산층 이하 맞벌이 워킹맘

맥락 추적 [펼치기]
  직접 근거: 아파트 거주, 자녀와 동거
  추론: 운전원 소득 -> 주거비 민감 예상
```

직업(`job`)과 나이(`age`)는 `agent_responded` 이벤트에 없다. 프런트에서 `agent_id`를 키로 `agent_sampled` 이벤트 데이터와 조인해서 표시한다.

권장 구현:

```typescript
const sampledById = new Map(sampled.map((agent) => [agent.agent_id, agent]))
const sampledAgent = sampledById.get(response.agent_id)
```

실험 상세 화면(`ExperimentTrace`)에서도 같은 방식으로 `run.sampledAgents`와 `run.responses`를 조인한다.

### 6-3. BlindSpotMap 추가

집계 결과 패널에 `BlindSpotMap`을 추가한다. 입력은 `aggregate.blind_spot_clusters`다.

`blind_spot_clusters`가 비어 있으면 컴포넌트를 표시하지 않는다.

```text
정책 사각지대

예상치 못한 피해 집단:

1. 경기도 외곽 중산층 이하 맞벌이 워킹맘 12명
   "월세 전환 시 현금 흐름 압박"
   "운전원 소득으로 교육비까지 감당 어려움"

2. 전세금 운용으로 생활하는 소규모 집주인 7명
   "보증금 수익 구조 붕괴"

3. 보증금이 유일한 목돈인 저소득 1인 가구 5명
   "월세 전환 시 비상금 소멸"
```

### 6-4. ReframingList 추가

`aggregate.reframing_list`가 있을 때만 표시한다. OpenAI 모델 결과에서만 나타나는 것이 정상이다.

```text
정책 전제에 대한 반문 (L3)

"교통비보다 의료비가 더 급한 문제입니다"
74세 · 남성 · 호남

"지원 대상을 소득 기준으로 나눠야 합니다"
45세 · 남성 · 충청
```

---

## 7. 구현 순서

1. `llm_client.py`
   - `SYSTEM_PROMPT_OLLAMA`, `SYSTEM_PROMPT_OPENAI` 추가
   - `build_agent_prompt`의 기존 "stance/rationale 두 키만" 지시 제거
   - `build_agent_messages`에 `model_provider` 파라미터 추가
   - `build_agent_llm_payload`에 `model_provider` 파라미터 추가
   - `parse_agent_response`에 `blind_spot`, `affected_group`, `reframing`, `persona_link` 파싱 추가
   - `build_summary_llm_payload` return schema에 `blind_spot_clusters` 추가
   - `summary_from_text`, `failed_summary`에 `blind_spot_clusters` 기본값 추가

2. `simulate.py`
   - `model_provider`를 agent stream 함수와 `build_agent_llm_payload`에 전달
   - `agent_responded` 이벤트에 새 필드 포함
   - summary 기본값에 `blind_spot_clusters` 추가
   - aggregate 병합 시 `.get(..., [])` 사용

3. `aggregation.py`
   - `compute_aggregate`에 `blind_spot_raw`, `reframing_list`, `blind_spot_clusters` 추가
   - `affected_group_raw`, `affected_group_clusters`는 만들지 않는다

4. `frontend/src/lib/api.ts`
   - `AgentRespondedEvent`, `AggregateEvent` 타입 확장
   - `BlindSpotCluster`, `ReframingItem` 타입 추가

5. `frontend/src/App.tsx`
   - `/experiment`에 Level 탭 추가
   - 응답 카드에 `blind_spot`, `affected_group`, `persona_link` 표시
   - `agent_sampled`와 `agent_responded`를 `agent_id`로 조인해 나이/직업 표시
   - `BlindSpotMap`, `ReframingList` 추가

---

## 8. 건드리지 않는 것

- `SimulateRequest` 스키마
- `persona_sampler.py`, `persona_repository.py`
- `prior_service.py` stub
- SSE 스트리밍 구조와 heartbeat 구조
- `experiment.ts`, `experimentStorage.ts`, `experimentCsv.ts`
- `/experiment` 라우트, 멀티슬롯, 프리셋, 반복 실행 구조
- 검색 컨텍스트 주입

---

## 9. 테스트 권장 사항

백엔드:
- `parse_agent_response`가 한국어 stance와 새 필드를 파싱하는지 테스트
- OpenAI provider일 때만 `reframing`, `persona_link`를 보존하는지 테스트
- `summary_from_text`가 `blind_spot_clusters`만 있어도 `completed`를 반환하는지 테스트
- `failed_summary`와 simulate summary 기본값에 `blind_spot_clusters: []`가 있는지 테스트
- `/api/simulate`의 `agent_responded`와 `aggregate` 이벤트에 새 필드가 포함되는지 테스트

프런트엔드:
- `AgentRespondedEvent`, `AggregateEvent` 타입 확장 컴파일 확인
- Level 탭이 `/experiment`에만 표시되는지 확인
- OpenAI 선택 시 L3이 활성 표시되는지 확인
- `BlindSpotMap`은 cluster가 있을 때만 표시되는지 확인
- `ReframingList`는 reframing이 있을 때만 표시되는지 확인
