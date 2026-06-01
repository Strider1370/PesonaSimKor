import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import App, { ExperimentLevels, ResponseCard, Topbar, pageFromPathname } from "./App"

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
  it("does not render prior-specific level copy", () => {
    const html = renderToStaticMarkup(<ExperimentLevels />)

    expect(html).toContain("L2: 민원")
    expect(html).toContain("L3: 반문")
    expect(html).toContain("ON")
    expect(html).not.toContain("level-notes")
    expect(html).not.toContain("Prior")
  })
})

describe("main settings", () => {
  it("does not expose preset or OpenAI thinking controls", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/" },
      history: { pushState: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
    })

    const html = renderToStaticMarkup(<App />)

    expect(html).not.toContain("Thinking")
    expect(html).not.toContain('value="on"')
    expect(html).not.toContain("주제")
    expect(html).not.toContain("프리셋")
  })
})

describe("ResponseCard", () => {
  it("does not show prior badges", () => {
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
