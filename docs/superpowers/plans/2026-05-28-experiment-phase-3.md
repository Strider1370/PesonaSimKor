# Experiment Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Phase 3 convenience features to the experiment page: save/load experiment snapshots in localStorage and export experiment results as CSV.

**Architecture:** Keep persistence and CSV generation entirely on the frontend. Store compact experiment snapshots containing settings, slots, selected presets, run summaries, stability summaries, and real-opinion comparisons. Export CSV from the same normalized snapshot shape so saved experiments and current experiments use one data model.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, browser localStorage, Blob URL download.

---

## Scope

Implement only Phase 3:
- Save experiment result snapshots to localStorage.
- Load saved experiment snapshots back into `/experiment`.
- Delete saved snapshots.
- Export current experiment results to CSV.

Explicitly exclude:
- Phase 2-4 search context injection.
- Tavily/DuckDuckGo.
- Backend/database persistence.
- Server-side CSV generation.
- User accounts or cloud sync.

## Preconditions

This plan assumes Phase 1 is already implemented and Phase 2-1 through Phase 2-3 may already be implemented:
- `/experiment` exists in `frontend/src/App.tsx`.
- Experiment slots support A/B/C.
- `frontend/src/lib/experiment.ts` exists.
- `frontend/src/data/presets.json` exists.
- After Phase 2-2, repeated-run stability data may exist.
- After Phase 2-3, real-opinion comparison data may exist.

If Phase 2-2 or Phase 2-3 is not implemented yet, still implement Phase 3 so it gracefully stores/exports only the fields currently available. Do not block on Phase 2-4.

## File Structure

- Create `frontend/src/lib/experimentStorage.ts`: localStorage snapshot types and save/load/delete helpers.
- Create `frontend/src/lib/experimentStorage.test.ts`: tests for snapshot serialization, ordering, and corruption handling.
- Create `frontend/src/lib/experimentCsv.ts`: CSV escaping and export row generation.
- Create `frontend/src/lib/experimentCsv.test.ts`: tests for CSV escaping and generated rows.
- Modify `frontend/src/App.tsx`: add save/load/delete/export controls to `/experiment`.
- Modify `frontend/src/App.css`: style saved snapshot list and export controls.

---

### Task 1: Snapshot Storage Utilities

**Files:**
- Create: `frontend/src/lib/experimentStorage.ts`
- Create: `frontend/src/lib/experimentStorage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Create `frontend/src/lib/experimentStorage.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  deleteExperimentSnapshot,
  listExperimentSnapshots,
  loadExperimentSnapshot,
  saveExperimentSnapshot,
} from "./experimentStorage"

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe("experiment snapshot storage", () => {
  it("saves and lists snapshots newest first", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-28T10:00:00Z"))
    const first = saveExperimentSnapshot({
      name: "first",
      settings: { nAgents: 30, repeatCount: 1 },
      slots: [{ id: "A", presetId: "1_1_neutral_no_context_explicit_base", policy: "정책 A" }],
      results: [],
    })

    vi.setSystemTime(new Date("2026-05-28T10:01:00Z"))
    const second = saveExperimentSnapshot({
      name: "second",
      settings: { nAgents: 30, repeatCount: 1 },
      slots: [{ id: "A", presetId: "2_1_neutral_no_context_explicit_base", policy: "정책 B" }],
      results: [],
    })

    expect(listExperimentSnapshots().map((snapshot) => snapshot.id)).toEqual([second.id, first.id])
  })

  it("loads and deletes a snapshot", () => {
    const saved = saveExperimentSnapshot({
      name: "load me",
      settings: { nAgents: 10, repeatCount: 3 },
      slots: [{ id: "A", presetId: "", policy: "직접 입력" }],
      results: [],
    })

    expect(loadExperimentSnapshot(saved.id)?.name).toBe("load me")
    deleteExperimentSnapshot(saved.id)
    expect(loadExperimentSnapshot(saved.id)).toBeNull()
  })

  it("returns an empty list when localStorage contains invalid JSON", () => {
    localStorage.setItem("koreansim.experiment.snapshots.v1", "not json")

    expect(listExperimentSnapshots()).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm --prefix frontend test -- experimentStorage.test.ts
```

Expected: fail because `experimentStorage.ts` does not exist.

- [ ] **Step 3: Implement storage helper**

Create `frontend/src/lib/experimentStorage.ts`:

```ts
export type ExperimentSnapshotSlot = {
  id: "A" | "B" | "C"
  presetId: string
  policy: string
}

export type ExperimentSnapshotSettings = {
  nAgents: number
  repeatCount?: number
  modelProvider?: "ollama" | "openai"
  modelName?: string
  thinking?: boolean
  personaDepth?: "minimal" | "standard" | "full"
}

export type ExperimentSnapshotResult = {
  slotId: "A" | "B" | "C"
  presetId: string
  total: {
    support: number
    oppose: number
    neutral: number
  } | null
  runs?: Array<{
    support: number
    oppose: number
    neutral: number
  }>
  stability?: {
    supportMean: number
    supportStddev: number
    opposeMean: number
    opposeStddev: number
    neutralMean: number
    neutralStddev: number
  } | null
  realOpinion?: {
    source: string
    year: number
    supportActual: number
    supportSimulated: number
    supportDiff: number
    opposeActual: number
    opposeSimulated: number
    opposeDiff: number
    note: string
  } | null
}

export type ExperimentSnapshotInput = {
  name: string
  settings: ExperimentSnapshotSettings
  slots: ExperimentSnapshotSlot[]
  results: ExperimentSnapshotResult[]
}

export type ExperimentSnapshot = ExperimentSnapshotInput & {
  id: string
  createdAt: string
}

const STORAGE_KEY = "koreansim.experiment.snapshots.v1"

export function saveExperimentSnapshot(input: ExperimentSnapshotInput): ExperimentSnapshot {
  const snapshot: ExperimentSnapshot = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  }
  const snapshots = listExperimentSnapshots()
  writeSnapshots([snapshot, ...snapshots])
  return snapshot
}

export function listExperimentSnapshots(): ExperimentSnapshot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isSnapshot)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch {
    return []
  }
}

export function loadExperimentSnapshot(id: string): ExperimentSnapshot | null {
  return listExperimentSnapshots().find((snapshot) => snapshot.id === id) ?? null
}

export function deleteExperimentSnapshot(id: string): void {
  writeSnapshots(listExperimentSnapshots().filter((snapshot) => snapshot.id !== id))
}

function writeSnapshots(snapshots: ExperimentSnapshot[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshots))
}

function isSnapshot(value: unknown): value is ExperimentSnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<ExperimentSnapshot>
  return (
    typeof snapshot.id === "string" &&
    typeof snapshot.createdAt === "string" &&
    typeof snapshot.name === "string" &&
    !!snapshot.settings &&
    Array.isArray(snapshot.slots) &&
    Array.isArray(snapshot.results)
  )
}
```

- [ ] **Step 4: Verify storage tests pass**

Run:

```bash
npm --prefix frontend test -- experimentStorage.test.ts
```

Expected: all storage tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/experimentStorage.ts frontend/src/lib/experimentStorage.test.ts
git commit -m "feat: add experiment snapshot storage"
```

---

### Task 2: CSV Export Utilities

**Files:**
- Create: `frontend/src/lib/experimentCsv.ts`
- Create: `frontend/src/lib/experimentCsv.test.ts`

- [ ] **Step 1: Write failing CSV tests**

Create `frontend/src/lib/experimentCsv.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { buildExperimentCsv, csvEscape } from "./experimentCsv"
import type { ExperimentSnapshot } from "./experimentStorage"

describe("experiment CSV", () => {
  it("escapes commas, quotes, and newlines", () => {
    expect(csvEscape('a,b "c"\nd')).toBe('"a,b ""c""\nd"')
  })

  it("builds CSV rows from a snapshot", () => {
    const snapshot: ExperimentSnapshot = {
      id: "snapshot-1",
      createdAt: "2026-05-28T10:00:00.000Z",
      name: "test",
      settings: { nAgents: 30, repeatCount: 3, modelProvider: "ollama", modelName: "qwen3.5:9b" },
      slots: [{ id: "A", presetId: "preset-a", policy: "정책 A" }],
      results: [
        {
          slotId: "A",
          presetId: "preset-a",
          total: { support: 6, oppose: 3, neutral: 1 },
          stability: {
            supportMean: 60,
            supportStddev: 4.1,
            opposeMean: 30,
            opposeStddev: 2.2,
            neutralMean: 10,
            neutralStddev: 1,
          },
          realOpinion: {
            source: "한국갤럽",
            year: 2022,
            supportActual: 69,
            supportSimulated: 60,
            supportDiff: -9,
            opposeActual: 23,
            opposeSimulated: 30,
            opposeDiff: 7,
            note: "참고",
          },
        },
      ],
    }

    const csv = buildExperimentCsv(snapshot)

    expect(csv).toContain("snapshot_id,name,created_at")
    expect(csv).toContain("snapshot-1,test,2026-05-28T10:00:00.000Z")
    expect(csv).toContain("A,preset-a,30,3,ollama,qwen3.5:9b")
    expect(csv).toContain("6,3,1")
    expect(csv).toContain("한국갤럽,2022,69,60,-9")
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm --prefix frontend test -- experimentCsv.test.ts
```

Expected: fail because `experimentCsv.ts` does not exist.

- [ ] **Step 3: Implement CSV helper**

Create `frontend/src/lib/experimentCsv.ts`:

```ts
import type { ExperimentSnapshot } from "./experimentStorage"

const HEADERS = [
  "snapshot_id",
  "name",
  "created_at",
  "slot_id",
  "preset_id",
  "n_agents",
  "repeat_count",
  "model_provider",
  "model_name",
  "support",
  "oppose",
  "neutral",
  "support_mean",
  "support_stddev",
  "oppose_mean",
  "oppose_stddev",
  "neutral_mean",
  "neutral_stddev",
  "real_source",
  "real_year",
  "real_support",
  "sim_support",
  "support_diff",
  "real_oppose",
  "sim_oppose",
  "oppose_diff",
  "real_note",
]

export function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`
  }
  return text
}

export function buildExperimentCsv(snapshot: ExperimentSnapshot): string {
  const rows = snapshot.results.map((result) => [
    snapshot.id,
    snapshot.name,
    snapshot.createdAt,
    result.slotId,
    result.presetId,
    snapshot.settings.nAgents,
    snapshot.settings.repeatCount ?? 1,
    snapshot.settings.modelProvider ?? "",
    snapshot.settings.modelName ?? "",
    result.total?.support ?? "",
    result.total?.oppose ?? "",
    result.total?.neutral ?? "",
    result.stability?.supportMean ?? "",
    result.stability?.supportStddev ?? "",
    result.stability?.opposeMean ?? "",
    result.stability?.opposeStddev ?? "",
    result.stability?.neutralMean ?? "",
    result.stability?.neutralStddev ?? "",
    result.realOpinion?.source ?? "",
    result.realOpinion?.year ?? "",
    result.realOpinion?.supportActual ?? "",
    result.realOpinion?.supportSimulated ?? "",
    result.realOpinion?.supportDiff ?? "",
    result.realOpinion?.opposeActual ?? "",
    result.realOpinion?.opposeSimulated ?? "",
    result.realOpinion?.opposeDiff ?? "",
    result.realOpinion?.note ?? "",
  ])

  return [HEADERS, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 4: Verify CSV tests pass**

Run:

```bash
npm --prefix frontend test -- experimentCsv.test.ts
```

Expected: all CSV tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/experimentCsv.ts frontend/src/lib/experimentCsv.test.ts
git commit -m "feat: add experiment csv export utility"
```

---

### Task 3: Build Snapshots From Current Experiment State

**Files:**
- Modify: `frontend/src/lib/experiment.ts`
- Modify: `frontend/src/lib/experiment.test.ts`

- [ ] **Step 1: Write failing snapshot builder test**

Append to `frontend/src/lib/experiment.test.ts`:

```ts
import { buildSnapshotResults } from "./experiment"

it("builds snapshot results from slot aggregates", () => {
  const results = buildSnapshotResults(
    [
      { id: "A", presetId: "preset-a", policy: "정책 A" },
      { id: "B", presetId: "", policy: "정책 B" },
    ],
    {
      A: {
        aggregate: { total: { support: 6, oppose: 3, neutral: 1 } },
        aggregateRuns: [{ total: { support: 6, oppose: 3, neutral: 1 } }],
      },
    },
  )

  expect(results).toEqual([
    {
      slotId: "A",
      presetId: "preset-a",
      total: { support: 6, oppose: 3, neutral: 1 },
      runs: [{ support: 6, oppose: 3, neutral: 1 }],
      stability: null,
      realOpinion: null,
    },
  ])
})
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
npm --prefix frontend test -- experiment.test.ts
```

Expected: fail because `buildSnapshotResults` does not exist.

- [ ] **Step 3: Implement snapshot builder**

In `frontend/src/lib/experiment.ts`, import the storage result type:

```ts
import type { ExperimentSnapshotResult, ExperimentSnapshotSlot } from "./experimentStorage"
```

Add:

```ts
type SnapshotRunInput = {
  aggregate?: {
    total: {
      support: number
      oppose: number
      neutral: number
    }
  } | null
  aggregateRuns?: Array<{
    total: {
      support: number
      oppose: number
      neutral: number
    }
  }>
}

export function buildSnapshotResults(
  slots: ExperimentSnapshotSlot[],
  runs: Partial<Record<"A" | "B" | "C", SnapshotRunInput>>,
): ExperimentSnapshotResult[] {
  return slots.flatMap((slot) => {
    const run = runs[slot.id]
    if (!run?.aggregate) return []
    const aggregateRuns = run.aggregateRuns ?? []
    const stability = aggregateRuns.length > 1 ? stabilitySnapshot(aggregateRuns) : null
    return [
      {
        slotId: slot.id,
        presetId: slot.presetId,
        total: run.aggregate.total,
        runs: aggregateRuns.map((item) => item.total),
        stability,
        realOpinion: null,
      },
    ]
  })
}

function stabilitySnapshot(runs: NonNullable<SnapshotRunInput["aggregateRuns"]>) {
  const report = computeStabilityReport(runs)
  return {
    supportMean: report.support.mean,
    supportStddev: report.support.stddev,
    opposeMean: report.oppose.mean,
    opposeStddev: report.oppose.stddev,
    neutralMean: report.neutral.mean,
    neutralStddev: report.neutral.stddev,
  }
}
```

- [ ] **Step 4: Verify test passes**

Run:

```bash
npm --prefix frontend test -- experiment.test.ts
```

Expected: all experiment tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/experiment.ts frontend/src/lib/experiment.test.ts
git commit -m "feat: build experiment snapshots"
```

---

### Task 4: Save And Load UI

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/App.css`
- Test: run existing frontend tests and build

- [ ] **Step 1: Add imports to `App.tsx`**

Add:

```ts
import { buildExperimentCsv, downloadCsv } from "./lib/experimentCsv"
import {
  ExperimentSnapshot,
  deleteExperimentSnapshot,
  listExperimentSnapshots,
  saveExperimentSnapshot,
} from "./lib/experimentStorage"
```

Also import `buildSnapshotResults` from `./lib/experiment`.

- [ ] **Step 2: Add saved snapshot state**

Inside `ExperimentPage`:

```ts
const [savedSnapshots, setSavedSnapshots] = useState<ExperimentSnapshot[]>(() => listExperimentSnapshots())
const [snapshotName, setSnapshotName] = useState("")
```

Add refresh helper:

```ts
function refreshSavedSnapshots() {
  setSavedSnapshots(listExperimentSnapshots())
}
```

- [ ] **Step 3: Build current snapshot**

Inside `ExperimentPage`, add:

```ts
function currentSnapshotInput() {
  const snapshotSlots = slots
    .filter((slot) => slot.policy.trim())
    .map((slot) => ({ id: slot.id, presetId: slot.presetId, policy: slot.policy }))
  return {
    name: snapshotName.trim() || `Experiment ${new Date().toLocaleString()}`,
    settings: {
      nAgents,
      repeatCount,
      modelProvider,
      modelName: effectiveModelName,
      thinking,
      personaDepth,
    },
    slots: snapshotSlots,
    results: buildSnapshotResults(snapshotSlots, runs),
  }
}
```

If Phase 2 settings do not exist yet, use:

```ts
settings: { nAgents, repeatCount: 1 }
```

- [ ] **Step 4: Add save/load/delete handlers**

Inside `ExperimentPage`:

```ts
function saveCurrentExperiment() {
  saveExperimentSnapshot(currentSnapshotInput())
  setSnapshotName("")
  refreshSavedSnapshots()
}

function loadSnapshot(snapshot: ExperimentSnapshot) {
  setSlots(snapshot.slots)
  setNAgents(snapshot.settings.nAgents)
  setRuns({})
  setSelectedTraceSlot(snapshot.slots[0]?.id ?? null)
}

function deleteSnapshot(id: string) {
  deleteExperimentSnapshot(id)
  refreshSavedSnapshots()
}

function exportCurrentExperiment() {
  const snapshot = {
    ...currentSnapshotInput(),
    id: "current",
    createdAt: new Date().toISOString(),
  }
  downloadCsv(`${snapshot.name.replace(/[^\w가-힣-]+/g, "_")}.csv`, buildExperimentCsv(snapshot))
}
```

- [ ] **Step 5: Add UI panel**

In `ExperimentPage`, below the result panel or above it, render:

```tsx
<section className="control-panel experiment-archive">
  <div className="section-head">
    <div>
      <h2>저장 및 내보내기</h2>
      <p>현재 실험을 브라우저에 저장하거나 CSV로 내보냅니다.</p>
    </div>
  </div>
  <div className="archive-actions">
    <input
      value={snapshotName}
      onChange={(event) => setSnapshotName(event.target.value)}
      placeholder="저장 이름"
    />
    <button type="button" className="secondary-button" disabled={isRunning || activeSlots.length === 0} onClick={saveCurrentExperiment}>
      저장
    </button>
    <button type="button" className="secondary-button" disabled={isRunning || activeSlots.length === 0} onClick={exportCurrentExperiment}>
      CSV 내보내기
    </button>
  </div>
  <div className="saved-snapshot-list">
    {savedSnapshots.length === 0 && <p className="empty compact">저장된 실험이 없습니다.</p>}
    {savedSnapshots.map((snapshot) => (
      <article key={snapshot.id} className="saved-snapshot-item">
        <div>
          <strong>{snapshot.name}</strong>
          <span>{new Date(snapshot.createdAt).toLocaleString()} · 슬롯 {snapshot.slots.length}개</span>
        </div>
        <div>
          <button type="button" className="secondary-button" disabled={isRunning} onClick={() => loadSnapshot(snapshot)}>
            불러오기
          </button>
          <button type="button" className="secondary-button danger" disabled={isRunning} onClick={() => deleteSnapshot(snapshot.id)}>
            삭제
          </button>
        </div>
      </article>
    ))}
  </div>
</section>
```

- [ ] **Step 6: Add CSS**

In `frontend/src/App.css`:

```css
.experiment-archive {
  display: grid;
  gap: 12px;
}

.archive-actions {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) auto auto;
  gap: 8px;
}

.saved-snapshot-list {
  display: grid;
  gap: 8px;
}

.saved-snapshot-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 1px solid #e5eaf0;
  border-radius: 6px;
  padding: 10px 12px;
  background: #f8fafc;
}

.saved-snapshot-item div:first-child {
  display: grid;
  gap: 4px;
}

.saved-snapshot-item span {
  color: #627d98;
  font-size: 13px;
}

.saved-snapshot-item div:last-child {
  display: flex;
  gap: 8px;
}

@media (max-width: 820px) {
  .archive-actions,
  .saved-snapshot-item {
    grid-template-columns: 1fr;
  }

  .saved-snapshot-item,
  .saved-snapshot-item div:last-child {
    align-items: stretch;
    flex-direction: column;
  }
}
```

- [ ] **Step 7: Verify frontend**

Run:

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

Expected: tests and build pass.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css
git commit -m "feat: add experiment save and load UI"
```

---

### Task 5: Final Integration Verification

**Files:**
- No new files. Verification only.

- [ ] **Step 1: Run full tests**

Run:

```bash
npm test
```

Expected: backend and frontend tests pass.

- [ ] **Step 2: Run frontend build**

Run:

```bash
npm --prefix frontend run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 3: Start dev server**

Run:

```bash
npm run dev
```

Expected: backend and frontend dev servers start.

- [ ] **Step 4: Manual smoke test**

Open:

```text
http://127.0.0.1:5173/experiment
```

Verify:
- Select a preset.
- Run one slot.
- Save the result.
- Reload the page.
- Confirm saved experiment appears.
- Load the saved experiment.
- Export CSV.
- Open the CSV and confirm Korean text is preserved.

- [ ] **Step 5: Commit any final fixes**

```bash
git status --short
git add frontend/src
git commit -m "test: verify experiment phase 3"
```

Only commit if there are actual final fixes or verification-support changes.

---

## New Session Prompt

Use this prompt in a fresh session:

```text
We are in C:\Users\Jond Doe\Desktop\Project\civicsimKR.

Please implement docs/superpowers/plans/2026-05-28-experiment-phase-3.md task by task.

Scope:
- Implement Phase 3 only.
- Add localStorage save/load/delete for experiment snapshots.
- Add CSV export for current experiment results.

Do not implement Phase 2-4 search context injection.
Do not implement Tavily or DuckDuckGo.
Do not add backend/database persistence.
Do not add user accounts or cloud sync.

Follow TDD:
- Write failing tests before implementation.
- Verify the failing tests fail for the expected reason.
- Implement the minimal changes.
- Run tests and build after each task.

Important existing files:
- frontend/src/App.tsx
- frontend/src/App.css
- frontend/src/lib/experiment.ts
- frontend/src/lib/experiment.test.ts
- frontend/src/data/presets.json

Expected new files:
- frontend/src/lib/experimentStorage.ts
- frontend/src/lib/experimentStorage.test.ts
- frontend/src/lib/experimentCsv.ts
- frontend/src/lib/experimentCsv.test.ts

At the end, run:
- npm test
- npm --prefix frontend run build

Then summarize changed files, verification output, and any remaining gaps.
```

---

## Self-Review

- Spec coverage: Covers Phase 3 items from `docs/EXPERIMENT_PAGE_SPEC.md`: save/load via localStorage and CSV export. Excludes Phase 2-4 search context by request.
- Placeholder scan: No placeholder implementation steps. Each task includes concrete file paths, tests, expected failures, implementation code, verification, and commit command.
- Type consistency: Snapshot types are defined once in `experimentStorage.ts`; CSV utility consumes `ExperimentSnapshot`; UI builds snapshots through `buildSnapshotResults`.
