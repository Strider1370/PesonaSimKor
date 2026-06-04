import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import App, { ResponseCard, Topbar, currentRunFromSnapshot, pageFromPathname } from "./App"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("routing", () => {
  it("uses the home page for root, input for /input, result for /result", () => {
    expect(pageFromPathname("/")).toBe("home")
    expect(pageFromPathname("/experiment")).toBe("home")
    expect(pageFromPathname("/input")).toBe("input")
    expect(pageFromPathname("/result")).toBe("result")
  })
})

describe("Topbar", () => {
  it("shows 홈 button on the input page", () => {
    const html = renderToStaticMarkup(
      <Topbar page="input" health={null} healthError={null} onOpenHome={() => {}} onOpenInput={() => {}} />,
    )

    expect(html).toContain("KoreanSim")
    expect(html).toContain("홈")
    expect(html).not.toContain("Ollama")
  })

  it("shows 입력 button on the home page", () => {
    const html = renderToStaticMarkup(
      <Topbar page="home" health={null} healthError={null} onOpenHome={() => {}} onOpenInput={() => {}} />,
    )

    expect(html).toContain("입력")
    expect(html).not.toContain("Ollama")
  })
})

describe("main settings", () => {
  it("shows experiment controls without level or prompt guide noise", () => {
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
    expect(html).not.toContain("입력 프롬프트 기준")
    expect(html).not.toContain("OpenAI schema")
    expect(html).not.toContain("출력 필드")
    expect(html).not.toContain("L1: 다양성")
    expect(html).not.toContain("L2: 민원")
    expect(html).not.toContain("L3: 반문")
    expect(html).not.toContain("L4: 대안")
    expect(html).toContain("모델")
    expect(html).toContain("페르소나")
    expect(html).toContain("반복")
    expect(html).toContain("에이전트 수")
    expect(html).not.toContain("OpenAI는 백엔드")
  })

  it("keeps the experiment page mounted while showing results", () => {
    vi.stubGlobal("window", {
      location: { pathname: "/result" },
      history: { pushState: () => {}, replaceState: () => {} },
      addEventListener: () => {},
      removeEventListener: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
    })

    const storage = new Map<string, string>()
    vi.stubGlobal("sessionStorage", {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    })

    const html = renderToStaticMarkup(<App />)

    expect(html).toContain("data-page=\"home\"")
    expect(html).toContain("data-page=\"result\"")
    expect(html).toContain("모델")
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
          discoveryAggregate: {
            axes: {
              occupation_stratum: {
                etc: { presence: true, blind_spot_headcount: 1, agent_ids: [0], category_population: 1 },
              },
            },
            featured_axis: { primary: "occupation_stratum", secondary: null },
          },
          discoverySummary: {
            merged_blind_spots: [{ label: "대상자", text: "대상자?", agent_ids: [0], grounding: "direct" }],
            merged_reframings: [],
            merged_complaints: [{ label: "대상자?", agent_ids: [0] }],
            featured_axis_rationale: "occupation stratum",
          },
        },
      ],
    })

    expect(currentRun?.policy).toBe("청년 월세")
    expect(currentRun?.structuredPolicy?.policy_name?.value).toBe("월세 지원")
    expect(currentRun?.responses[0].expected_complaint).toBe("대상자?")
    expect(currentRun?.discoveryAggregate?.featured_axis.primary).toBe("occupation_stratum")
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
