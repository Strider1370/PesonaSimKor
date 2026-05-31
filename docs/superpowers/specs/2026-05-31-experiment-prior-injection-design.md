# Experiment Prior Injection — Design Spec

- **Date**: 2026-05-31
- **Status**: Approved (design), pending implementation plan
- **Scope**: Wire real survey distributions (한국갤럽) into agent prompts as `prior`, for preset topics. PoC with 원전(`2_1`).

---

## 1. Background & Goal

`/experiment` samples Korean personas and asks an LLM to respond to a policy. The
`prior` hook (`prior_service.get_prior`) is meant to inject **real-world survey
results** so each persona is anchored to actual public opinion (enables Level 2 —
"Prior 저항"). Today `get_prior` is a stub returning `None`, and no survey data is
collected.

This spec defines a minimal, test-oriented implementation: for **preset** topics,
look up a precomputed survey distribution matched to each persona's **gender,
age group, and province**, and inject it into the existing prompt path.

### Non-goals (YAGNI)
- Free-text policy → topic matching (keyword/embedding). Presets only.
- Joint/cross distributions (e.g. 서울×남성×30대). Gallup only publishes per-axis
  marginals, so only marginals are used.
- Topics beyond 원전(`2_1`). 사형제(`1_1`)/전세(`4_1`) data added later if PoC succeeds.
- Changes to `llm_client` prompt builders. The injected `prior` dict flows through
  the existing `prior_text` JSON serialization unchanged.

---

## 2. Data Source

**한국갤럽 데일리 오피니언 제648호** (조사 2026.1.13~15, 전국 만18세+ n=1,000,
가중적용 기준). Question: *"신규 원전을 건설해야 한다 / 건설하지 말아야 한다"*.

PDF: `https://www.gallup.co.kr/dir/GallupKoreaDaily/GallupKoreaDailyOpinion_648(20260116).pdf`
(p.14 교차집계표). Local provenance: `data/gallup/` (PDF + rendered cross-tab + README).

National: support 54 / oppose 25 / undecided 21.

| Axis | Bucket | support | oppose | undecided |
|---|---|---|---|---|
| gender | male | 70 | 20 | 10 |
| gender | female | 38 | 29 | 32 |
| age | 20s (18–29) | 50 | 19 | 31 |
| age | 30s | 51 | 28 | 20 |
| age | 40s | 48 | 36 | 16 |
| age | 50s | 52 | 31 | 17 |
| age | 60s | 69 | 16 | 14 |
| age | 70_plus | 51 | 16 | 33 |
| region (권역) | seoul | 60 | 20 | 20 |
| region | incheon_gyeonggi | 55 | 25 | 20 |
| region | daejeon_sejong_chungcheong | 50 | 26 | 24 |
| region | gwangju_jeolla | 42 | 28 | 29 |
| region | daegu_gyeongbuk | 59 | 15 | 26 |
| region | busan_ulsan_gyeongnam | 49 | 35 | 16 |
| region | gangwon | — (n<50, suppressed) | | |
| region | jeju | — (n<50, suppressed) | | |

Percentages are taken verbatim from the Gallup cross-tab. No aggregation/weighting
is performed — each persona province maps to exactly one 권역 (see §3).

---

## 3. Persona ↔ Gallup Bucket Mapping

- **gender**: `male`/`female` ↔ 남성/여성. 1:1.
- **age_group**: `20s/30s/40s/50s/60s/70_plus` ↔ 18-29/30대/40대/50대/60대/70대+. 1:1.
- **region**: use the persona's **`structured_profile.province`** (not the collapsed
  6-bucket `region_group`). Each province belongs to exactly one Gallup 권역:

| province (Nemotron) | Gallup 권역 key |
|---|---|
| 서울 | seoul |
| 인천, 경기 | incheon_gyeonggi |
| 대전, 세종, 충청남, 충청북 | daejeon_sejong_chungcheong |
| 광주, 전라남, 전북 | gwangju_jeolla |
| 대구, 경상북 | daegu_gyeongbuk |
| 부산, 울산, 경상남 | busan_ulsan_gyeongnam |
| 강원 | gangwon |
| 제주 | jeju |

`gangwon`/`jeju` have no published value (suppressed) and fall back to `national`.
Any unmapped province also falls back to `national`.

---

## 4. Components

### 4.1 Prior data file — `backend/app/data/priors/2_1.json`
Static, hand-authored from §2. Region keyed by Gallup 권역 code; suppressed cells
omitted (absence → national fallback in lookup).

```json
{
  "topic_id": "2_1",
  "topic": "신규 원전 건설",
  "source": "한국갤럽 데일리 오피니언 제648호 (2026.1.13~15, n=1000)",
  "question": "신규 원전을 건설해야 한다 / 건설하지 말아야 한다",
  "national": { "support": 54, "oppose": 25, "undecided": 21 },
  "by_gender": {
    "male":   { "support": 70, "oppose": 20, "undecided": 10 },
    "female": { "support": 38, "oppose": 29, "undecided": 32 }
  },
  "by_age_group": {
    "20s":     { "support": 50, "oppose": 19, "undecided": 31 },
    "30s":     { "support": 51, "oppose": 28, "undecided": 20 },
    "40s":     { "support": 48, "oppose": 36, "undecided": 16 },
    "50s":     { "support": 52, "oppose": 31, "undecided": 17 },
    "60s":     { "support": 69, "oppose": 16, "undecided": 14 },
    "70_plus": { "support": 51, "oppose": 16, "undecided": 33 }
  },
  "by_region": {
    "seoul":                      { "support": 60, "oppose": 20, "undecided": 20 },
    "incheon_gyeonggi":           { "support": 55, "oppose": 25, "undecided": 20 },
    "daejeon_sejong_chungcheong": { "support": 50, "oppose": 26, "undecided": 24 },
    "gwangju_jeolla":             { "support": 42, "oppose": 28, "undecided": 29 },
    "daegu_gyeongbuk":            { "support": 59, "oppose": 15, "undecided": 26 },
    "busan_ulsan_gyeongnam":      { "support": 49, "oppose": 35, "undecided": 16 }
  }
}
```

### 4.2 `prior_service.get_prior`
New signature: `get_prior(topic_id: str | None, persona_axes: dict) -> dict | None`
where `persona_axes = {"gender", "age_group", "province"}`.

Logic:
1. If `topic_id` is falsy or `priors/{topic_id}.json` does not exist → return `None`
   (current behavior preserved; free-text policies get no prior).
2. Load the file (cache with `lru_cache` keyed by topic_id).
3. Resolve province → 권역 key via the §3 map; missing/suppressed → use `national`.
4. Build and return:

```python
{
  "topic": data["topic"],
  "source": data["source"],
  "question": data["question"],
  "national":  data["national"],
  "by_gender": data["by_gender"].get(gender, data["national"]),
  "by_age":    data["by_age_group"].get(age_group, data["national"]),
  "by_region": data["by_region"].get(region_key, data["national"]),
}
```

The returned dict is JSON-serialized into the prompt by the existing
`build_agent_prompt` (`prior_text`). No prompt-builder changes.

### 4.3 Preset `real_opinion` correction (in scope)
The preset `2_1.real_opinion` currently holds spec-era reference values
(찬54/반35/중11) that disagree with the actual Gallup 648호 figures. Correct all
`2_1` entries in `frontend/src/data/presets.json` to the real national result:

```json
"real_opinion": {
  "support": 54, "oppose": 25, "neutral": 21,
  "source": "한국갤럽 데일리 오피니언 제648호",
  "year": 2026,
  "question": "신규 원전 2기 건설 찬반",
  "url": "https://www.gallup.co.kr/dir/GallupKoreaDaily/GallupKoreaDailyOpinion_648(20260116).pdf",
  "note": "한국갤럽 648호(2026.1.13~15, n=1000) 교차집계표 기준."
}
```

If a preset generator (`scripts/generate-experiment-presets.mjs`) is the source of
truth for `presets.json`, update the generator's `2_1` reference instead and
regenerate; otherwise edit `presets.json` directly. (Implementation plan to confirm.)

### 4.4 Request plumbing
- `SimulateRequest`: add `topic_id: str | None = None`.
- Frontend: include the preset's `topic_id` in the simulate request body. Free-text
  (non-preset) runs send `null`.
- `simulate.py`: both branches (ollama/openai) call
  `get_prior(req.topic_id, {"gender": persona["gender"], "age_group": persona["age_group"], "province": persona["structured_profile"]["province"]})`
  instead of the current `region_group`-based dict.

---

## 5. Data Flow

```
preset(topic_id) ──▶ SimulateRequest.topic_id
                         │
persona ──┐              ▼
          ├─▶ get_prior(topic_id, {gender, age_group, province})
          │        │  load priors/<topic_id>.json, map province→권역
          │        ▼
          │   prior dict {national, by_gender, by_age, by_region}
          ▼        │
  build_agent_prompt(persona, policy, prior) ──▶ prior_text (JSON) in prompt
```

---

## 6. Error Handling / Edge Cases
- Unknown/absent `topic_id`, or no JSON file → `None` (no prior; unchanged path).
- Suppressed/unmapped province (강원/제주/other) → region falls back to `national`.
- Missing gender/age bucket (should not happen) → that axis falls back to `national`.
- Malformed JSON → treat as no prior (`None`); log once. (Test asset is hand-authored.)

---

## 7. Testing
- `prior_service` unit tests:
  - male + 60s + 서울 → by_gender 70/20/10, by_age 69/16/14, by_region 60/20/20.
  - province 강원 → by_region == national (54/25/21).
  - unmapped province → by_region == national.
  - `topic_id=None` and unknown topic_id → `None`.
- `simulate.py`: existing stream test extended to assert `get_prior` receives
  `topic_id` and `province` (e.g. via monkeypatch capturing args).
- Frontend: preset run includes `topic_id` in request payload (existing experiment
  request test extended).

---

## 8. Files Touched
- `backend/app/data/priors/2_1.json` (new)
- `backend/app/services/prior_service.py` (implement)
- `backend/app/models/schemas.py` (`topic_id` field)
- `backend/app/api/simulate.py` (pass `topic_id` + `province` to `get_prior`)
- `frontend/src/data/presets.json` — correct `2_1.real_opinion` (and/or
  `scripts/generate-experiment-presets.mjs` if it generates presets)
- frontend simulate request builder (include `topic_id`)
- `data/gallup/` (source provenance — PDF, cross-tab image, README) [added]
- tests: backend `prior_service`, `simulate`; frontend request test

---

## 9. Open Follow-ups (post-PoC, not in scope)
- Add 사형제(`1_1`) cross-tab; decide replacement for 전세(`4_1`, no Gallup data).
- UI to surface that Level 2 is active when a prior exists.
