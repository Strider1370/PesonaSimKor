# KoreanSim MVP Implementation Plan

## Summary

Build the MVP defined in `docs/superpowers/specs/2026-05-27-koreansim-design.md`: a local FastAPI backend and React/Vite frontend that simulate Korean citizen policy reactions using the local Nemotron parquet dataset and Ollama `qwen3.5:9b`.

The existing root files `App.tsx`, `simulate.py`, and `llm_client.py` are reference material only. Useful logic may be adapted into the new structure, then the root reference files should be removed at the end along with obsolete root docs if they are fully superseded.

## Implementation Changes

### Backend

- Create FastAPI app under `backend/app/`.
- Load local parquet files from `data/Nemotron-Personas-Korea/data/train-*.parquet`.
- Normalize actual dataset values: `남자 -> male`, `여자 -> female`, and observed Korean province values to compact region groups.
- Stratified sample by `age_group`, `region_group`, and `gender`.
- Stream `agent_sampled`, `agent_responded`, `aggregate`, and `done` over SSE.
- Use Ollama model `qwen3.5:9b` by default with defensive parsing and fallback behavior.
- Compute aggregate counts deterministically in Python.

### Frontend

- Create Vite React TypeScript app under `frontend/`.
- Use browser policy input, `n_agents`, progress, live feed, aggregate tables, and cluster cards.
- Call backend with `fetch` and parse `POST` SSE streams via `ReadableStream`.
- Keep backend enum values English and localize labels in the UI.

### Cleanup

- Remove superseded root reference files after verification: `App.tsx`, `simulate.py`, `llm_client.py`.
- Replace obsolete root docs with current run instructions or remove them if superseded.

## Interfaces

- `POST /api/simulate` returns `text/event-stream`.
- `GET /healthz` returns service, model, Ollama, and dataset status.
- Defaults:
  - `OLLAMA_HOST=http://127.0.0.1:11434`
  - `OLLAMA_MODEL=qwen3.5:9b`
  - `CORS_ORIGINS=http://localhost:5173`
  - `VITE_API_BASE_URL=http://localhost:8000`

## Test Plan

- Backend: normalization, quota allocation, sampling, aggregation, LLM parsing, API event order, health.
- Frontend: parser test for chunked SSE, `npm run build`.
- Manual: run backend on `8000`, frontend on `5173`, simulate 5 agents from browser.

## Assumptions

- Local-development MVP only.
- Runtime data is local only.
- `qwen3.5:9b` is the correct default model.
- Root reference files are not final runtime entrypoints.
