import { describe, expect, it } from "vitest"

import presets from "./presets.json"

describe("generated presets", () => {
  it("keeps framing content without generator instructions", () => {
    const prompts = presets.map((preset) => preset.prompt)

    expect(prompts.some((prompt) => prompt.includes("[제시 관점]"))).toBe(true)
    expect(prompts.some((prompt) => prompt.includes("한국은 법률상 사형제를 유지하고 있으나 장기간 집행하지 않은 상태입니다."))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes("정책의 핵심 내용과 쟁점을 어느 한쪽에 유리하지 않게 사실 중심으로 제시합니다."))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes("해당 정책안에 찬성하도록 유리한 논거를 강조합니다."))).toBe(true)
    expect(prompts.every((prompt) => !prompt.includes("해당 정책안에 반대하도록 유리한 논거를 강조합니다."))).toBe(true)
  })
})
