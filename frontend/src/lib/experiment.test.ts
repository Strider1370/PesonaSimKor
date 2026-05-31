import { describe, expect, it } from "vitest"

import {
  addPolicySlot,
  buildSnapshotResults,
  compareWithRealOpinion,
  computeStabilityReport,
  createInitialSlots,
  getPresetOptions,
  removePolicySlot,
  restoreSnapshotRuns,
  resolvePresetSelection,
  resolveVisibleSlotId,
  updateSlotFromPreset,
  updateSlotPolicy,
  type ExperimentPreset,
} from "./experiment"

const preset = {
  id: "1_1_neutral_no_context_explicit_base",
  topic_id: "1_1",
  topic: "사형제 유지",
  quadrant: "universal_biased",
  framing: "neutral",
  context: "no_context",
  stance_format: "explicit",
  parameter_variant: "base",
  label: "사형제 유지 / 중립 / 배경없음 / 명시적 / 기본",
  real_opinion: null,
  prompt: "현행 사형제를 유지한다.",
}

const presets = [
  preset,
  {
    ...preset,
    id: "1_1_positive_with_context_scale_base",
    framing: "positive",
    context: "with_context",
    stance_format: "scale",
    prompt: "사형제 유지에 찬성하는 관점이다.",
  },
  {
    ...preset,
    id: "2_1_neutral_no_context_explicit_variant_a",
    topic_id: "2_1",
    topic: "원자력 발전 확대",
    parameter_variant: "variant_a",
    label: "원자력 발전 확대 / 중립 / 배경없음 / 명시적 / 신규 원전 건설",
    prompt: "신규 원전을 건설한다.",
  },
]

describe("experiment slots", () => {
  it("starts with one empty slot A", () => {
    expect(createInitialSlots()).toEqual([{ id: "A", policy: "", presetId: "" }])
  })

  it("adds slots up to C", () => {
    const slots = addPolicySlot(addPolicySlot(addPolicySlot(createInitialSlots())))

    expect(slots.map((slot) => slot.id)).toEqual(["A", "B", "C"])
  })

  it("keeps at least one slot when removing", () => {
    expect(removePolicySlot(createInitialSlots(), "A")).toEqual(createInitialSlots())
  })

  it("fills a slot from a preset prompt", () => {
    const [slot] = updateSlotFromPreset(createInitialSlots(), "A", preset)

    expect(slot.presetId).toBe(preset.id)
    expect(slot.policy).toBe(preset.prompt)
  })

  it("groups preset options for topic-first picking", () => {
    const options = getPresetOptions(presets)

    expect(options.topics).toEqual([
      { id: "1_1", label: "사형제 유지" },
      { id: "2_1", label: "원자력 발전 확대" },
    ])
    expect(options.byTopic["1_1"].framings.map((option) => option.id)).toEqual(["neutral", "positive"])
    expect(options.byTopic["1_1"].contexts.map((option) => option.id)).toEqual(["no_context", "with_context"])
    expect(options.byTopic["1_1"].stanceFormats.map((option) => option.id)).toEqual(["explicit", "scale"])
  })

  it("resolves the selected topic and toggle values to one preset", () => {
    const resolved = resolvePresetSelection(presets, {
      topicId: "1_1",
      variant: "base",
      framing: "positive",
      context: "with_context",
      stanceFormat: "scale",
    })

    expect(resolved?.id).toBe("1_1_positive_with_context_scale_base")
  })

  it("keeps the selected trace tab on a visible slot", () => {
    expect(resolveVisibleSlotId(["A", "B"], "B")).toBe("B")
    expect(resolveVisibleSlotId(["A", "B"], "C")).toBe("A")
    expect(resolveVisibleSlotId([], "A")).toBeNull()
  })

  it("computes mean and standard deviation for repeated runs", () => {
    const report = computeStabilityReport([
      { total: { support: 6, oppose: 3, neutral: 1 } },
      { total: { support: 7, oppose: 2, neutral: 1 } },
      { total: { support: 5, oppose: 4, neutral: 1 } },
    ])

    expect(report.support.mean).toBeCloseTo(60, 1)
    expect(report.support.stddev).toBeCloseTo(8.16, 1)
    expect(report.runs).toHaveLength(3)
  })

  it("compares aggregate support and oppose rates with real opinion", () => {
    const comparison = compareWithRealOpinion(
      { total: { support: 3, oppose: 6, neutral: 1 } },
      {
        support: 64,
        oppose: 36,
        neutral: 0,
        source: "Realty Chosun community survey",
        year: 2023,
        question: "Need to improve jeonse system",
        url: "https://realty.chosun.com/site/data/html_dir/2023/05/22/2023052200431.html",
        note: "Weak reference only.",
      },
    )

    expect(comparison?.support.simulated).toBe(30)
    expect(comparison?.support.diff).toBe(-34)
    expect(comparison?.oppose.simulated).toBe(60)
    expect(comparison?.oppose.diff).toBe(24)
  })

  it("builds snapshot results from slot aggregates", () => {
    const results = buildSnapshotResults(
      [
        { id: "A", presetId: "preset-a", policy: "policy A" },
        { id: "B", presetId: "", policy: "policy B" },
      ],
      {
        A: {
          aggregate: { total: { support: 6, oppose: 3, neutral: 1 } },
          aggregateRuns: [{ total: { support: 6, oppose: 3, neutral: 1 } }],
        },
      },
    )

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      slotId: "A",
      presetId: "preset-a",
      total: { support: 6, oppose: 3, neutral: 1 },
      runs: [{ support: 6, oppose: 3, neutral: 1 }],
      stability: null,
      realOpinion: null,
      sampledAgents: [],
      responses: [],
      llmPrompts: [],
      aggregate: { total: { support: 6, oppose: 3, neutral: 1 } },
      aggregateRuns: [{ total: { support: 6, oppose: 3, neutral: 1 } }],
    })
  })

  it("restores saved snapshot details into run state", () => {
    const runs = restoreSnapshotRuns([
      {
        slotId: "A",
        presetId: "preset-a",
        total: { support: 0, oppose: 1, neutral: 0 },
        sampledAgents: [
          {
            agent_id: 3,
            age: 41,
            gender: "female",
            region: "Seoul",
            job: "driver",
            age_group: "40s",
            region_group: "capital",
          },
        ],
        responses: [
          {
            agent_id: 3,
            age_group: "40s",
            gender: "female",
            region_group: "capital",
            stance: "oppose",
            rationale: "rationale",
            blind_spot: "blind spot",
          },
        ],
        llmOutputs: { 3: "raw" },
        aggregate: {
          total: { support: 0, oppose: 1, neutral: 0 },
          by_age: { "40s": { support: 0, oppose: 1, neutral: 0 } },
          by_gender: {},
          by_region: {},
          concern_clusters: [],
          support_clusters: [],
          blind_spot_clusters: [
            { affected_group: "workers", short_title: "workers", count: 1, blind_spot_examples: ["blind spot"], agent_ids: [3] },
          ],
          reframing_list: [],
        },
        aggregateRuns: [
          {
            total: { support: 0, oppose: 1, neutral: 0 },
            by_age: {},
            by_gender: {},
            by_region: {},
            concern_clusters: [],
            support_clusters: [],
            blind_spot_clusters: [],
            reframing_list: [],
          },
        ],
      },
    ])

    expect(runs.A?.phase).toBe("done")
    expect(runs.A?.sampled).toBe(1)
    expect(runs.A?.responses[0].blind_spot).toBe("blind spot")
    expect(runs.A?.llmOutputs[3]).toBe("raw")
    expect(runs.A?.aggregate?.blind_spot_clusters[0].affected_group).toBe("workers")
    expect(runs.A?.aggregateRuns).toHaveLength(1)
  })

  it("restores old summary-only snapshots with fallback aggregates", () => {
    const runs = restoreSnapshotRuns([
      {
        slotId: "A",
        presetId: "preset-a",
        total: { support: 6, oppose: 3, neutral: 1 },
        runs: [{ support: 6, oppose: 3, neutral: 1 }],
        stability: null,
        realOpinion: null,
      },
    ])

    expect(runs.A?.phase).toBe("done")
    expect(runs.A?.aggregate?.total).toEqual({ support: 6, oppose: 3, neutral: 1 })
    expect(runs.A?.aggregateRuns[0].total).toEqual({ support: 6, oppose: 3, neutral: 1 })
    expect(runs.A?.responses).toEqual([])
  })
})

describe("slot topicId", () => {
  const preset = {
    id: "2_1_neutral_no_context_explicit_base",
    topic_id: "2_1",
    topic: "원자력 발전 확대",
    prompt: "정책 본문",
  } as unknown as ExperimentPreset

  it("sets topicId when a preset is applied", () => {
    const slots = createInitialSlots()
    const next = updateSlotFromPreset(slots, slots[0].id, preset)
    expect(next[0].topicId).toBe("2_1")
  })

  it("clears topicId when policy is edited freely", () => {
    const slots = updateSlotFromPreset(createInitialSlots(), "A", preset)
    const next = updateSlotPolicy(slots, "A", "자유 입력")
    expect(next[0].topicId).toBeUndefined()
  })
})
