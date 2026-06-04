import { describe, expect, it } from "vitest"

import presets from "./presets.json"

describe("generated presets", () => {
  it("contains practical policy examples without prior/framing variants", () => {
    const prompts = presets.map((preset) => preset.prompt)

    expect(prompts.some((prompt) => prompt.includes("대상:"))).toBe(true)
    expect(prompts.some((prompt) => prompt.includes("신청 방식:"))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes("[제시 관점]"))).toBe(true)
    expect(presets.every((preset) => !("topic_id" in preset))).toBe(true)
    expect(presets.every((preset) => !("real_opinion" in preset))).toBe(true)
  })
})
