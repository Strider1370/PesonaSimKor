import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import App, { ExperimentLevels, ResponseCard, Topbar, currentRunFromSnapshot, pageFromPathname } from "./App"

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

describe("snapshot loading", () => {
  it("maps a loaded snapshot into the dashboard current run", () => {
    const currentRun = currentRunFromSnapshot({
      id: "snapshot-1",
      createdAt: "2026-06-01T00:00:00.000Z",
      name: "saved",
      settings: { nAgents: 1, modelProvider: "openai", modelName: "gpt-5-mini" },
      slots: [{ id: "A", presetId: "", policy: "청년 월세" }],
      structuredPolicy: { policy_name: { value: "월세 지원", source: "stated" } },
      results: [
        {
          slotId: "A",
          presetId: "",
          total: { support: 0, oppose: 0, neutral: 1 },
          responses: [{ agent_id: 0, stance: "neutral", expected_complaint: "대상자?" } as any],
          aggregate: {
            total: { support: 0, oppose: 0, neutral: 1 },
            by_age: {},
            by_gender: {},
            by_region: {},
            concern_clusters: [],
            support_clusters: [],
            blind_spot_clusters: [],
            complaint_clusters: [{ representative_quote: "대상자?", count: 1, agent_ids: [0] }],
            reframing_list: [],
          } as any,
        },
      ],
    })

    expect(currentRun?.policy).toBe("청년 월세")
    expect(currentRun?.structuredPolicy?.policy_name?.value).toBe("월세 지원")
    expect(currentRun?.responses[0].expected_complaint).toBe("대상자?")
    expect((currentRun?.aggregate as any).complaint_clusters[0].representative_quote).toBe("대상자?")
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
