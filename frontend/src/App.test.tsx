import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ExperimentLevels, formatPresetTopicLabel } from "./App"

describe("ExperimentLevels", () => {
  it("marks the prior level active when a prior-enabled preset is selected", () => {
    const html = renderToStaticMarkup(<ExperimentLevels modelProvider="ollama" hasPrior />)

    expect(html).toContain("L2: Prior 대응")
    expect(html).toContain("ON")
    expect(html).toContain("한국갤럽 원전 prior 적용")
    expect(html).not.toContain("Prior 데이터 미수집")
  })
})

describe("formatPresetTopicLabel", () => {
  it("marks preset topics that have prior data", () => {
    expect(formatPresetTopicLabel({ id: "2_1", label: "원자력 발전 확대" })).toBe("원자력 발전 확대 (prior 있음)")
    expect(formatPresetTopicLabel({ id: "1_1", label: "사형제 유지" })).toBe("사형제 유지")
  })
})
