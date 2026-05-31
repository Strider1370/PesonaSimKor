import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import App, { ExperimentLevels, ResponseCard, Topbar, formatPresetTopicLabel, pageFromPathname } from "./App"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("routing", () => {
  it("uses the main page for root and legacy experiment paths", () => {
    expect(pageFromPathname("/")).toBe("main")
    expect(pageFromPathname("/experiment")).toBe("main")
    expect(pageFromPathname("/result")).toBe("result")
  })
})

describe("Topbar", () => {
  it("hides connection and phase status on the result page", () => {
    const html = renderToStaticMarkup(
      <Topbar page="result" phase="idle" progress={0} health={null} healthError={null} onOpenResult={() => {}} onOpenMain={() => {}} />,
    )

    expect(html).toContain("KoreanSim")
    expect(html).toContain("메인")
    expect(html).not.toContain("Ollama")
    expect(html).not.toContain("대기")
    expect(html).not.toContain("결과</button>")
  })

  it("shows a result button on the main page instead of connection and phase status", () => {
    const html = renderToStaticMarkup(
      <Topbar page="main" phase="idle" progress={0} health={null} healthError={null} onOpenResult={() => {}} onOpenMain={() => {}} />,
    )

    expect(html).toContain("결과")
    expect(html).not.toContain("Ollama")
    expect(html).not.toContain("대기")
    expect(html).not.toContain("실험실")
  })
})

describe("ExperimentLevels", () => {
  it("marks the prior level active when a prior-enabled preset is selected", () => {
    const html = renderToStaticMarkup(<ExperimentLevels hasPrior />)

    expect(html).toContain("L2: Prior 대응")
    expect(html).toContain("L3: 반문")
    expect(html).toContain("ON")
    expect(html).toContain("한국갤럽 원전 prior 적용")
    expect(html).not.toContain("Prior 데이터 미수집")
  })
})

describe("main settings", () => {
  it("does not expose the OpenAI thinking effort control", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/" },
      history: { pushState: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    })

    const html = renderToStaticMarkup(<App />)

    expect(html).not.toContain("Thinking")
    expect(html).not.toContain('value="on"')
  })
})

describe("formatPresetTopicLabel", () => {
  it("marks preset topics that have prior data", () => {
    expect(formatPresetTopicLabel({ id: "1_1", label: "사형제 유지" })).toBe("사형제 유지 (prior 있음)")
    expect(formatPresetTopicLabel({ id: "1_2", label: "동성결혼 법제화" })).toBe("동성결혼 법제화 (prior 있음)")
    expect(formatPresetTopicLabel({ id: "2_1", label: "원자력 발전 확대" })).toBe("원자력 발전 확대 (prior 있음)")
    expect(formatPresetTopicLabel({ id: "4_1", label: "전세 제도 폐지" })).toBe("전세 제도 폐지")
  })
})

describe("ResponseCard", () => {
  it("shows prior badges when the response includes prior data", () => {
    const html = renderToStaticMarkup(
      <ResponseCard
        response={{
          agent_id: 1,
          age_group: "70_plus",
          gender: "female",
          region_group: "honam",
          stance: "support",
          stance_strength: "기울어짐",
          rationale: "마을의 평온을 지키는 데 필요하다고 느낍니다.",
          prior: {
            topic: "사형제 유지",
            source: "한국갤럽 데일리 오피니언 제504호",
            question: "사형 제도 유지/폐지 찬반",
            national: { support: 69, oppose: 23, undecided: 8 },
            groups: [
              { label: "여성", support: 66, oppose: 25, undecided: 9 },
              { label: "70대+", support: 75, oppose: 18, undecided: 7 },
              { label: "호남", support: 62, oppose: 28, undecided: 10 },
            ],
          },
        }}
        sampledAgent={{ agent_id: 1, age: 99, gender: "female", region: "전남", job: "무직", age_group: "70_plus", region_group: "honam" }}
      />,
    )

    expect(html).toContain("prior 있음")
    expect(html).toContain("전국 찬 69 · 반 23 · 유보 8")
    expect(html).toContain("여성 찬 66 · 반 25")
    expect(html).toContain("70대+ 찬 75 · 반 18")
    expect(html).toContain("호남 찬 62 · 반 28")
    expect(html.indexOf("강도 기울어짐")).toBeLessThan(html.indexOf("prior 있음"))
    expect(html.indexOf("prior 있음")).toBeLessThan(html.indexOf("마을의 평온"))
  })

  it("does not show prior badges without prior data", () => {
    const html = renderToStaticMarkup(
      <ResponseCard
        response={{
          agent_id: 1,
          age_group: "70_plus",
          gender: "female",
          region_group: "honam",
          stance: "support",
          rationale: "필요하다고 느낍니다.",
        }}
      />,
    )

    expect(html).not.toContain("prior 있음")
  })
})
