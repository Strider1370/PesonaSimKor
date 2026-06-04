# KoreanSim Detailed Design

Date: 2026-05-27

## 1. Goal

Build an MVP that simulates Korean citizens' reactions to a policy prompt by:

- sampling personas from the local `Nemotron-Personas-Korea` parquet dataset
- preserving dataset-driven population structure across age group, region group, and gender
- generating agent-level responses through a local Ollama LLM
- streaming intermediate and final results to a React frontend over SSE
- leaving a clean extension point for future prior injection based on survey data

This document is intentionally detailed so that another LLM or engineer can implement it without needing the earlier conversation.

## 2. Non-Goals

These are explicitly out of scope for the first implementation pass:

- real survey prior retrieval and ranking
- embeddings / vector DB integration
- multi-model routing
- persistent simulation history or user accounts
- deployment concerns beyond local development
- sophisticated statistical weighting outside the dataset-driven stratified sampler

## 3. Current Repository Reality

The current workspace is not yet in the target structure.

Existing root files:

- `App.tsx`
- `simulate.py`
- `llm_client.py`
- `README.md`
- `DESIGN.md`
- `data/Nemotron-Personas-Korea/...`

The root files are partial references, not runnable final code. They contain useful logic sketches:

- `simulate.py`: SSE event order and orchestration shape
- `llm_client.py`: Ollama prompt structure and JSON expectations
- `App.tsx`: frontend state flow and result rendering shape

The implementation should use these as source material, but the project must be reorganized into a proper backend/frontend layout.

Root files are reference material only. Do not keep them as runtime entry points in the final MVP. During implementation, move or adapt useful logic from these files into the target backend/frontend structure, and apply this design's configuration decisions there.

## 4. Target Architecture

### 4.1 Directory Layout

```text
civicsimKR/
?ú‚??Ä backend/
??  ?ú‚??Ä requirements.txt
??  ?î‚??Ä app/
??      ?ú‚??Ä __init__.py
??      ?ú‚??Ä main.py
??      ?ú‚??Ä api/
??      ??  ?ú‚??Ä __init__.py
??      ??  ?ú‚??Ä simulate.py
??      ??  ?î‚??Ä health.py
??      ?ú‚??Ä models/
??      ??  ?ú‚??Ä __init__.py
??      ??  ?î‚??Ä schemas.py
??      ?î‚??Ä services/
??          ?ú‚??Ä __init__.py
??          ?ú‚??Ä llm_client.py
??          ?ú‚??Ä persona_repository.py
??          ?ú‚??Ä persona_sampler.py
??          ?î‚??Ä prior_service.py
?ú‚??Ä frontend/
??  ?ú‚??Ä package.json
??  ?ú‚??Ä tsconfig.json
??  ?ú‚??Ä vite.config.ts
??  ?ú‚??Ä index.html
??  ?î‚??Ä src/
??      ?ú‚??Ä main.tsx
??      ?ú‚??Ä App.tsx
??      ?ú‚??Ä App.css
??      ?î‚??Ä lib/
??          ?î‚??Ä api.ts
?ú‚??Ä data/
??  ?î‚??Ä Nemotron-Personas-Korea/
?î‚??Ä docs/
    ?î‚??Ä superpowers/
        ?î‚??Ä specs/
            ?î‚??Ä 2026-05-27-koreansim-design.md
```

### 4.2 High-Level Flow

1. User enters a policy prompt and requested simulation count.
2. Frontend calls `POST /api/simulate`.
3. Backend loads dataset-backed personas and performs stratified sampling.
4. Backend emits `agent_sampled` SSE events as personas are selected.
5. Backend calls local Ollama for each persona and emits `agent_responded`.
6. Backend computes deterministic aggregate counts in Python.
7. Backend optionally asks the LLM for concern/support cluster summaries.
8. Backend emits final `aggregate` and then `done`.
9. Frontend renders live responses and final tables/cards.

### 4.3 Local Development Runbook

Backend development server:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend development server:

```powershell
cd frontend
npm install
npm run dev
```

Local URLs:

- frontend: `http://localhost:5173`
- backend API: `http://localhost:8000`
- health check: `http://localhost:8000/healthz`

## 5. Data Source

### 5.1 Dataset

Use the already-downloaded local dataset under:

- `data/Nemotron-Personas-Korea/data/train-*.parquet`

Do not depend on downloading from Hugging Face at runtime.

### 5.2 Relevant Source Columns

The dataset contains many fields. The MVP only needs a subset:

- `age`
- `sex`
- `province`
- `district`
- `occupation`
- `education_level`
- `persona`
- optionally one or more persona detail text fields if `persona` is too sparse

Suggested text preference:

1. `persona`
2. fallback to concatenation of relevant persona text fields if needed

### 5.2.1 Inspected Dataset Snapshot

The local parquet files were inspected directly from:

- `data/Nemotron-Personas-Korea/data/train-*.parquet`

Observed facts:

- row count: `1,000,000`
- `age`: `int64`, min `19`, max `99`
- `sex`: string, values `?®Ïûê`, `?¨Ïûê`
- `province`: string, values `Í∞ïÏõê`, `Í≤ΩÍ∏∞`, `Í≤ΩÏÉÅ??, `Í≤ΩÏÉÅÎ∂?, `Í¥ëÏ£º`, `?ÄÍµ?, `?Ä??, `Î∂Ä??, `?úÏö∏`, `?∏Ï¢Ö`, `?∏ÏÇ∞`, `?∏Ï≤ú`, `?ÑÎùº??, `?ÑÎ∂Å`, `?úÏ£º`, `Ï∂©Ï≤≠??, `Ï∂©Ï≤≠Î∂?
- inspected MVP columns had zero nulls: `sex`, `province`, `district`, `persona`, `occupation`, `education_level`, `age`

Observed counts:

```text
sex:
  ?®Ïûê: 495558
  ?¨Ïûê: 504442

province:
  Í∞ïÏõê: 30200
  Í≤ΩÍ∏∞: 262154
  Í≤ΩÏÉÅ?? 62416
  Í≤ΩÏÉÅÎ∂? 50298
  Í¥ëÏ£º: 27594
  ?ÄÍµ? 46934
  ?Ä?? 28646
  Î∂Ä?? 65285
  ?úÏö∏: 185228
  ?∏Ï¢Ö: 6933
  ?∏ÏÇ∞: 21317
  ?∏Ï≤ú: 58991
  ?ÑÎùº?? 34391
  ?ÑÎ∂Å: 34188
  ?úÏ£º: 12673
  Ï∂©Ï≤≠?? 41456
  Ï∂©Ï≤≠Î∂? 31296
```

### 5.3 Canonical Persona Shape

After normalization, each sampled persona should look like:

```python
{
    "agent_id": 0,
    "age": 54,
    "gender": "female",
    "region": "?úÏö∏ ÎßàÌè¨Íµ?,
    "job": "?¨Î¨¥Ïß?,
    "education": "?Ä?ôÍµê Ï°∏ÏóÖ",
    "background": "...",
    "age_group": "50s",
    "region_group": "capital",
}
```

Notes:

- `region` is a human-readable province/district string.
- `gender`, `age_group`, `region_group` are normalized backend-facing values.
- the frontend will localize labels; backend values should remain stable and ASCII-safe where possible.

## 6. Normalization Rules

### 6.1 Gender

Normalize raw dataset sex values to:

- `male`
- `female`
- optionally `unknown` if unexpected data appears

Actual MVP mapping:

```python
SEX_MAP = {
    "?®Ïûê": "male",
    "?¨Ïûê": "female",
}
```

For MVP, if the dataset is reliably binary, `unknown` can be omitted from sampling quotas but should still be handled defensively.

### 6.2 Age Group

Map integer age to:

- `20s`
- `30s`
- `40s`
- `50s`
- `60s`
- `70_plus`

Suggested mapping:

- 19-29 => `20s`
- 30-39 => `30s`
- 40-49 => `40s`
- 50-59 => `50s`
- 60-69 => `60s`
- 70+ => `70_plus`

Important:

- the dataset starts at adult age 19, so `20s` is an implementation bucket meaning "under 30" for MVP
- frontend labels should avoid implying exact `20-29` coverage unless 19-year-olds are split into a future dedicated bucket

### 6.3 Region Group

Map province to a compact region bucket:

- `capital`
- `yeongnam`
- `honam`
- `chungcheong`
- `gangwon`
- `jeju`
- `other`

Recommended first-pass mapping:

- `capital`: ?úÏö∏, Í≤ΩÍ∏∞, ?∏Ï≤ú
- `yeongnam`: Î∂Ä?? ?ÄÍµ? ?∏ÏÇ∞, Í≤ΩÏÉÅ?? Í≤ΩÏÉÅÎ∂?- `honam`: Í¥ëÏ£º, ?ÑÎùº?? ?ÑÎ∂Å
- `chungcheong`: ?Ä?? ?∏Ï¢Ö, Ï∂©Ï≤≠?? Ï∂©Ï≤≠Î∂?- `gangwon`: Í∞ïÏõê
- `jeju`: ?úÏ£º
- `other`: anything unexpected

Implementation detail:

- keep the mapping in one dedicated helper or constant table
- do not scatter province logic across multiple files
- map the observed raw parquet values exactly; do not assume `Í≤ΩÎÇ®`, `Í≤ΩÎ∂Å`, `?ÑÎÇ®`, `Ï∂©ÎÇ®`, or `Ï∂©Î∂Å` unless future data inspection finds those values

Suggested constant:

```python
REGION_GROUP_MAP = {
    "?úÏö∏": "capital",
    "Í≤ΩÍ∏∞": "capital",
    "?∏Ï≤ú": "capital",
    "Î∂Ä??: "yeongnam",
    "?ÄÍµ?: "yeongnam",
    "?∏ÏÇ∞": "yeongnam",
    "Í≤ΩÏÉÅ??: "yeongnam",
    "Í≤ΩÏÉÅÎ∂?: "yeongnam",
    "Í¥ëÏ£º": "honam",
    "?ÑÎùº??: "honam",
    "?ÑÎ∂Å": "honam",
    "?Ä??: "chungcheong",
    "?∏Ï¢Ö": "chungcheong",
    "Ï∂©Ï≤≠??: "chungcheong",
    "Ï∂©Ï≤≠Î∂?: "chungcheong",
    "Í∞ïÏõê": "gangwon",
    "?úÏ£º": "jeju",
}
```

## 7. Sampling Design

### 7.1 Core Requirement

Sampling must be stratified by:

- `age_group`
- `region_group`
- `gender`

This is required because future prior injection is expected to attach at this same axis combination.

### 7.2 Distribution Source

Use the observed local Nemotron dataset distribution itself as the target population distribution.

Do not use a manually authored census weight table for MVP.

### 7.3 Sampling Behavior

Given `n_agents`, the sampler should:

1. compute the empirical proportion of each `(age_group, region_group, gender)` cell
2. convert those proportions into integer quotas
3. sample rows from each cell
4. assign sequential `agent_id` values
5. return normalized persona dicts

### 7.4 Quota Calculation

Recommended method:

1. compute ideal counts as `proportion * n_agents`
2. take floor for each cell
3. compute remaining seats from rounding
4. distribute remaining seats by largest fractional remainder

This avoids drift and keeps totals exact.

### 7.5 Undersupply Handling

Some cells may not have enough rows for quota if sampling without replacement and `n_agents` is large relative to that cell.

Required fallback:

1. attempt per-cell sampling without replacement
2. record any shortfall
3. redistribute shortfall across the remaining unsaturated pool

For MVP, redistribution may be global rather than using a complicated nearest-neighbor demographic fallback.

Important:

- log the shortfall condition clearly
- never fail the whole simulation solely because a small cell is underfilled

### 7.6 Replacement Policy

Use sampling without replacement within a single simulation run.

Across separate runs, the same dataset row may appear again.

### 7.7 Future-Proofing

Although MVP sampling axes are fixed, implementation should make extension feasible.

Recommended internal pattern:

- keep `SAMPLING_AXES = ["age_group", "region_group", "gender"]`
- implement generic group key creation from a list of field names

This allows future expansion to `job` or `education` with minimal restructuring.

## 8. Prior Injection Interface

### 8.1 MVP Behavior

`prior_service` is a stub in MVP.

It does not retrieve real survey priors yet.

### 8.2 Required Interface

The service should still expose a stable interface such as:

```python
def get_prior(policy_text: str, persona_axes: dict[str, str]) -> dict | None:
    ...
```

Suggested `persona_axes` payload:

```python
{
    "age_group": "50s",
    "region_group": "capital",
    "gender": "female",
}
```

### 8.3 Reason for This Interface

Future prior retrieval is expected to depend on the same three axes:

- age group
- region group
- gender

Potential future fields like `job` or `education` should be addable by extending this dictionary, not by changing every call site.

### 8.4 LLM Integration Contract

If a prior is returned, `llm_client` should be able to inject it into the prompt as structured context.

If no prior is returned:

- the call should still work
- no branch explosion in the API layer

## 9. Local LLM Design

### 9.1 Runtime

Use local Ollama.

Confirmed working locally:

- Ollama root endpoint responds
- Python `ollama` package can connect
- installed models include `qwen3.5:9b`

### 9.2 Model Decision

Default model for MVP:

- `qwen3.5:9b`

This must be configurable through environment variables, not hardcoded only in source. The default is intentionally `qwen3.5:9b`.

### 9.3 Environment Variables

Backend must support:

```env
OLLAMA_HOST=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:9b
CORS_ORIGINS=http://localhost:5173
```

Behavior:

- `OLLAMA_HOST` defaults to `http://127.0.0.1:11434`
- `OLLAMA_MODEL` defaults to `qwen3.5:9b`
- `CORS_ORIGINS` may be comma-separated

Frontend should support:

```env
VITE_API_BASE_URL=http://localhost:8000
```

Behavior:

- `VITE_API_BASE_URL` defaults to `http://localhost:8000` in local development
- `frontend/src/lib/api.ts` calls `${VITE_API_BASE_URL}/api/simulate`

### 9.4 `llm_client.py` Responsibilities

`backend/app/services/llm_client.py` should:

- read `OLLAMA_HOST` and `OLLAMA_MODEL`
- instantiate the Ollama client
- build agent prompt payloads
- build aggregate clustering prompt payloads
- call the model
- parse JSON or text output
- apply fallback logic on malformed output

It should be the only service that knows Ollama implementation details.

### 9.5 Agent-Level Output Contract

Canonical backend-level response:

```python
{
    "stance": "support",
    "rationale": "..."
}
```

Valid stances:

- `support`
- `oppose`
- `neutral`

### 9.6 Aggregate-Level LLM Use

Aggregate counts must be computed deterministically in Python first.

The LLM should only be used for:

- concern cluster labeling
- support cluster labeling
- short example extraction or summarization

This reduces fragility. If the aggregate LLM step fails, the app should still return:

- total counts
- breakdown tables
- empty cluster arrays

### 9.7 Prompt Strategy

The prompt should be explicit and restrictive.

Recommended agent prompt structure:

1. system message:
   - act as the given Korean citizen
   - answer only in JSON
   - choose one of `support`, `oppose`, `neutral`
2. user message:
   - normalized persona fields
   - natural-language background text
   - policy text
   - optional prior summary

Important:

- keep backend JSON keys English even if prompt body is Korean
- frontend will localize the labels

### 9.8 Output Parsing

Because local models can drift, parsing must be defensive.

Required behavior:

- attempt JSON parse if format is requested
- if parsing fails, try minimal repair or extract the first JSON-like block
- if still failing, return fallback:

```python
{
    "stance": "neutral",
    "rationale": "Model output could not be parsed."
}
```

### 9.9 Known Risk

Connection works, but prompt-following quality is not guaranteed.

Implementation must assume:

- the model may ignore language instructions
- the model may return invalid JSON
- the model may hallucinate meta text

That is why fallback handling is mandatory.

### 9.10 Timeout Policy

Required timeout behavior:

- per-agent Ollama call timeout: `60` seconds
- aggregate clustering Ollama call timeout: `90` seconds

Fallback behavior:

- if a per-agent LLM call fails or times out, return `stance = "neutral"` and `rationale = "Response generation failed."`
- if aggregate clustering fails or times out, return deterministic counts and empty `concern_clusters` / `support_clusters`
- a single agent failure must not terminate the whole simulation

## 10. Backend API Design

### 10.1 `POST /api/simulate`

Request:

```json
{
  "policy": "Provide a monthly transportation subsidy for seniors aged 65 and older.",
  "n_agents": 30
}
```

Response content type:

- `text/event-stream`

### 10.2 SSE Event Order

Required order per simulation:

1. for each sampled persona, emit `agent_sampled`
2. for that same persona, emit `agent_responded` after its LLM call completes
3. repeat steps 1-2 for all personas
4. emit `aggregate`
5. emit `done`

Notes:

- `agent_sampled` appears once per persona before that persona's LLM completion
- `agent_responded` appears once per completed persona
- MVP uses sequential processing, so the stream is pairwise: `agent_sampled`, `agent_responded`, `agent_sampled`, `agent_responded`, ...
- `aggregate` appears once
- `done` appears once at the end
- if request-level setup fails before streaming can start, return a normal HTTP error response
- if an unrecoverable error happens after streaming starts, emit `error` and then end the stream

### 10.3 SSE Event Schemas

#### `agent_sampled`

```json
{
  "agent_id": 0,
  "age": 54,
  "gender": "female",
  "region": "?úÏö∏ ÎßàÌè¨Íµ?,
  "job": "?¨Î¨¥Ïß?,
  "age_group": "50s",
  "region_group": "capital"
}
```

#### `agent_responded`

```json
{
  "agent_id": 0,
  "age_group": "50s",
  "gender": "female",
  "region_group": "capital",
  "stance": "support",
  "rationale": "..."
}
```

#### `aggregate`

```json
{
  "total": {
    "support": 18,
    "oppose": 9,
    "neutral": 3
  },
  "by_age": {
    "20s": {"support": 3, "oppose": 1, "neutral": 1}
  },
  "by_gender": {
    "female": {"support": 9, "oppose": 5, "neutral": 1}
  },
  "by_region": {
    "capital": {"support": 8, "oppose": 3, "neutral": 1}
  },
  "concern_clusters": [
    {"label": "budget concerns", "count": 5, "examples": ["...", "..."]}
  ],
  "support_clusters": [
    {"label": "mobility support", "count": 8, "examples": ["...", "..."]}
  ]
}
```

#### `done`

```json
{}
```

#### `error`

```json
{
  "message": "Simulation failed.",
  "code": "simulation_error"
}
```

### 10.4 `GET /healthz`

Response should indicate:

- service status
- configured model name
- Ollama reachable or not
- dataset loaded or not

Example:

```json
{
  "status": "ok",
  "ollama_host": "http://127.0.0.1:11434",
  "ollama_model": "qwen3.5:9b",
  "ollama_reachable": true,
  "dataset_loaded": true
}
```

## 11. Backend Modules

### 11.1 `backend/app/main.py`

Responsibilities:

- create FastAPI app
- configure CORS from `CORS_ORIGINS`
- include routers

### 11.1.1 `backend/requirements.txt`

Minimum expected backend dependencies:

- `fastapi`
- `uvicorn`
- `pydantic`
- `pandas`
- `pyarrow`
- `ollama`

### 11.2 `backend/app/api/simulate.py`

Responsibilities:

- validate request body
- create streaming response
- orchestrate sampler, prior lookup, LLM calls, and aggregation
- format SSE events

Implementation notes:

- sequential agent processing is acceptable for MVP
- run blocking model calls in a thread executor if needed

### 11.3 `backend/app/api/health.py`

Responsibilities:

- expose runtime status checks

### 11.4 `backend/app/models/schemas.py`

Define:

- `SimulateRequest`
- SSE payload models if desired
- `Cluster`
- `AggregateResult`

Suggested request validation:

- `policy`: non-empty string
- `n_agents`: integer, minimum 5, maximum 100 for MVP

### 11.5 `backend/app/services/persona_repository.py`

Responsibilities:

- locate local parquet files
- load required columns
- normalize columns
- compute derived fields
- cache the prepared dataframe or records in memory

Important:

- dataset load is expensive, so avoid re-reading parquet on every request
- prefer one-time startup load or lazy singleton cache

### 11.6 `backend/app/services/persona_sampler.py`

Responsibilities:

- compute empirical distribution over the three axes
- calculate quotas
- sample actual personas
- assign `agent_id`

### 11.7 `backend/app/services/prior_service.py`

Responsibilities:

- provide a no-op stub now
- preserve extension point for later real survey matching

### 11.8 `backend/app/services/llm_client.py`

Responsibilities:

- encapsulate Ollama usage
- build prompts
- call `ollama.chat`
- parse/repair output
- provide aggregate cluster summarization

## 12. Frontend Design

### 12.1 Stack

- React 18
- TypeScript
- Vite

### 12.2 File Responsibilities

#### `frontend/src/lib/api.ts`

Responsibilities:

- call `POST /api/simulate`
- parse the SSE stream from the `fetch` response body with `ReadableStream`
- yield typed events through an async iterator or callback-driven helper

Important:

- use `fetch`, not browser `EventSource`, because the API is `POST /api/simulate`
- parse `event:` and `data:` lines defensively across chunk boundaries
- expose a typed event union to the UI

Required TypeScript event shape:

```ts
export type Stance = "support" | "oppose" | "neutral"

export type AgentSampledEvent = {
  agent_id: number
  age: number
  gender: "male" | "female" | "unknown"
  region: string
  job: string
  age_group: "20s" | "30s" | "40s" | "50s" | "60s" | "70_plus"
  region_group:
    | "capital"
    | "yeongnam"
    | "honam"
    | "chungcheong"
    | "gangwon"
    | "jeju"
    | "other"
}

export type AgentRespondedEvent = {
  agent_id: number
  age_group: AgentSampledEvent["age_group"]
  gender: AgentSampledEvent["gender"]
  region_group: AgentSampledEvent["region_group"]
  stance: Stance
  rationale: string
}

export type StanceCounts = Record<Stance, number>

export type Cluster = {
  label: string
  count: number
  examples: string[]
}

export type AggregateEvent = {
  total: StanceCounts
  by_age: Record<string, StanceCounts>
  by_gender: Record<string, StanceCounts>
  by_region: Record<string, StanceCounts>
  concern_clusters: Cluster[]
  support_clusters: Cluster[]
}

export type SimulateEvent =
  | { type: "agent_sampled"; data: AgentSampledEvent }
  | { type: "agent_responded"; data: AgentRespondedEvent }
  | { type: "aggregate"; data: AggregateEvent }
  | { type: "error"; data: { message: string; code: string } }
  | { type: "done"; data: Record<string, never> }
```

#### `frontend/src/App.tsx`

Responsibilities:

- policy input
- `n_agents` input
- run button
- live response feed
- progress display
- final aggregate tables and cluster cards

`App.tsx` at repo root should be treated as a reference and migrated into this structure.

#### `frontend/src/App.css`

Responsibilities:

- basic layout
- stance colors
- card styling
- table styling
- responsive layout

### 12.3 UI State

Recommended state model:

- `policy: string`
- `nAgents: number`
- `phase: "idle" | "running" | "done" | "error"`
- `responses: AgentRespondedEvent[]`
- `aggregate: AggregateEvent | null`
- `progress: number`
- `error: string | null`

### 12.4 Localization Strategy

Backend API keys stay English.

Frontend maps values to Korean labels:

- `support` => `Ï∞¨ÏÑ±`
- `oppose` => `Î∞òÎ?`
- `neutral` => `Ï§ëÎ¶Ω`
- `male` => `?®ÏÑ±`
- `female` => `?¨ÏÑ±`
- region and age group can also be localized in helper maps

Reason:

- avoids encoding and identifier instability
- keeps TypeScript types cleaner
- makes future prompt and prior logic easier to maintain

## 13. Aggregation Rules

### 13.1 Deterministic Counts

The backend must compute these directly from agent responses:

- `total`
- `by_age`
- `by_gender`
- `by_region`

Do not delegate these counts to the LLM.

### 13.2 Cluster Generation

The backend may ask the LLM to summarize rationales into:

- `concern_clusters`
- `support_clusters`

Suggested workflow:

1. separate rationales by stance
2. provide concise lists to LLM
3. ask for a fixed number of cluster summaries

Fallback:

- return empty arrays if clustering fails

## 14. Error Handling

### 14.1 Dataset Load Failure

Behavior:

- backend should fail clearly at startup or on first load
- `/healthz` should expose the failure state if app continues running

### 14.2 LLM Call Failure

Per-agent failure should not terminate the whole simulation.

Fallback per failed agent:

```python
{
    "stance": "neutral",
    "rationale": "Response generation failed."
}
```

### 14.3 Malformed LLM Output

Use parsing fallback and then return neutral fallback if needed.

### 14.4 Aggregate LLM Failure

Still return deterministic counts and empty cluster arrays.

### 14.5 SSE Stream Failure

Frontend should surface an error state and allow rerun.

## 15. Verification Plan

### 15.1 Backend Tests

At minimum:

- normalization tests for `age_group`, `region_group`, `gender`
- sampling quota test
- sampling total count test
- underfilled cell redistribution test
- deterministic aggregate count test
- LLM output parser fallback test

### 15.2 API Tests

At minimum:

- `POST /api/simulate` returns `text/event-stream`
- SSE events arrive in the expected order
- `done` is emitted
- `GET /healthz` returns model and dataset status

### 15.3 Frontend Checks

At minimum:

- form submits valid request
- progress updates as `agent_responded` arrives
- recent live responses render
- aggregate renders after final event
- Korean label mapping displays correctly

### 15.4 Definition of Done

The MVP is complete when all of the following pass:

Backend verification:

```powershell
cd backend
pytest
```

Frontend verification:

```powershell
cd frontend
npm run build
```

Manual local end-to-end check:

1. start backend on `http://localhost:8000`
2. start frontend on `http://localhost:5173`
3. open the frontend in a browser
4. enter a Korean policy prompt
5. run a 5-agent simulation
6. confirm live responses appear while the stream is active
7. confirm final aggregate tables render after `aggregate`
8. confirm `/healthz` reports configured model and dataset status

## 16. Implementation Order

Recommended implementation sequence:

1. create backend and frontend directory structure
2. add backend schemas and app bootstrap
3. implement dataset repository and normalization
4. implement stratified sampler
5. implement Ollama-backed `llm_client.py`
6. implement `/healthz`
7. implement SSE `/api/simulate`
8. scaffold frontend Vite app structure
9. implement `src/lib/api.ts` SSE parser
10. migrate and adapt `App.tsx`
11. add `App.css`
12. run end-to-end local verification

## 17. Open Risks

- local model may not follow Korean JSON instructions reliably
- parquet load time and memory usage may be non-trivial
- exact dataset field values may require small normalization adjustments once inspected directly
- cluster summaries may vary in quality

These are acceptable MVP risks if fallback behavior is implemented.

## 18. Explicit Build Decisions

These decisions were made intentionally and should not be re-litigated during implementation unless blocked by real evidence:

- use Nemotron local parquet as the source of truth for sampling distribution
- stratify on `age_group`, `region_group`, and `gender`
- keep prior retrieval as a stub with a stable interface
- use local Ollama with `qwen3.5:9b`
- use environment variables for Ollama host/model
- keep backend JSON keys in English and localize only in the UI
- compute counts in Python and use the LLM only for narrative clustering

## 19. Handoff Summary

If another LLM is implementing from this document, the key practical interpretation is:

- do not try to make the existing root files runnable in place
- rebuild into the target backend/frontend structure
- treat root `simulate.py`, `llm_client.py`, and `App.tsx` as reference logic only
- the most important correctness points are:
  - dataset-backed stratified sampling
  - stable SSE contract
  - resilient Ollama integration
  - deterministic aggregate counts
  - frontend label localization over English backend enums

