import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCurrentRun, saveCurrentRun } from "../lib/currentRunStore"
import { ResultPage } from "./ResultPage"

const storage = vi.hoisted(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal("sessionStorage", {
    clear: () => storage.clear(),
    getItem: (key: string) => storage.get(key) ?? null,
    removeItem: (key: string) => storage.delete(key),
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  return storage
})

beforeEach(() => {
  storage.clear()
  sessionStorage.clear()
  clearCurrentRun()
})

describe("ResultPage", () => {
  it("renders empty state when no current run exists", () => {
    const html = renderToStaticMarkup(<ResultPage onDebug={() => {}} onExperiment={() => {}} onRerun={() => {}} />)

    expect(html).toContain("/에서 먼저 실행하세요")
  })

  it("renders header and hero stats from current run", () => {
    saveCurrentRun({
      policy: "학교 교육활동 중 발생하는 소리는 생활소음에서 제외한다.",
      n_agents: 5,
      model_name: "qwen3.5:9b",
      model_provider: "ollama",
      completedAt: "2026-05-30T00:00:00.000Z",
      sampledAgents: [
        { agent_id: 7, age: 52, gender: "female", region: "서울-은평구", job: "간호조무사", age_group: "50s", region_group: "capital" },
      ],
      aggregate: {
        total: { support: 3, oppose: 1, neutral: 1 },
        by_age: { "40s": { support: 2, oppose: 1, neutral: 0 } },
        by_gender: { female: { support: 2, oppose: 1, neutral: 0 } },
        by_region: { capital: { support: 2, oppose: 1, neutral: 0 } },
        concern_clusters: [{ label: "생활비 부담", short_label: "생활비", count: 1, examples: ["부담"] }],
        support_clusters: [{ label: "활동 보장", short_label: "활동", count: 3, examples: ["필요"] }],
        blind_spot_clusters: [
          {
            affected_group: "야간근무 보호자",
            short_title: "야간근무 보호자",
            count: 1,
            blind_spot_examples: ["낮 시간 안내를 챙기기 어렵습니다."],
            agent_ids: [7],
          },
        ],
        reframing_list: [{ text: "소음만 볼 게 아니라 아이들 활동권도 봐야 합니다.", age_group: "50s", gender: "female", region_group: "capital" }],
      },
    })

    const html = renderToStaticMarkup(<ResultPage onDebug={() => {}} onExperiment={() => {}} onRerun={() => {}} />)

    expect(html).toContain("KoreanSim")
    expect(html).toContain("찬성")
    expect(html).toContain("3")
    expect(html).toContain("사각지대")
    expect(html).toContain("qwen3.5:9b")
    expect(html).toContain("의견 지형도")
    expect(html).toContain("찬반 × 언급 수")
    expect(html).toContain("찬성 cluster")
    expect(html).toContain("반대 cluster")
    expect(html).toContain("응답 5개 모두 보기")
    expect(html).toContain("생활비")
    expect(html).toContain("활동")
    expect(html).toContain("인구 분포별 찬반")
    expect(html).toContain("좌(찬성) · 우(반대)")
    expect(html).toContain("막대 길이 = 응답자 수")
    expect(html).toContain("40대")
    expect(html).toContain("사각지대")
    expect(html).toContain("1건")
    expect(html).toContain("야간근무 보호자")
    expect(html).toContain("50대 여")
    expect(html).toContain("은평구")
    expect(html).toContain("정책 전제에 대한 반문")
    expect(html).toContain("1건 / 5명")
    expect(html).toContain("아이들 활동권")
  })
})
