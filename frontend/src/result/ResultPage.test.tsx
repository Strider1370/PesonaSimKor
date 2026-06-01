import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { clearCurrentRun } from "../lib/currentRunStore"
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

const fixtureRun = {
  policy: "청년 월세 한시 지원",
  n_agents: 3,
  model_name: "gpt-5-mini",
  model_provider: "openai",
  completedAt: "2026-06-01T00:00:00.000Z",
  sampledAgents: [],
  structuredPolicy: {
    policy_name: { value: "청년 월세", source: "stated" },
  },
  responses: [
    {
      agent_id: 0,
      age: 27,
      gender: "female",
      province: "경기",
      district: "파주시",
      occupation: "무직",
      family_type: "3세대 동거",
      age_group: "20s",
      region_group: "capital",
      stance: "oppose",
      rationale: "가족이랑 같이 사는 청년은 빠지는 느낌이에요.",
      blind_spot: "가구 조건이 좁다",
      expected_complaint: "나는 대상자인가요?",
    },
    {
      agent_id: 1,
      age: 33,
      gender: "male",
      province: "서울",
      district: "마포구",
      occupation: "사무원",
      family_type: "1인 가구",
      age_group: "30s",
      region_group: "capital",
      stance: "support",
      rationale: "월세 부담을 낮춰줘서 필요합니다.",
    },
  ],
  aggregate: {
    total: { support: 1, oppose: 1, neutral: 1 },
    by_age: {},
    by_gender: {},
    by_region: {},
    concern_clusters: [{ label: "LLM 요약 라벨", short_label: "요약", count: 1, examples: [] }],
    support_clusters: [],
    blind_spot_clusters: [
      {
        affected_group: "동거 청년",
        short_title: "표시하면 안 되는 요약",
        representative_quote: "가구 조건이 좁다",
        count: 1,
        denominator: 1,
        inferred_based: true,
        blind_spot_examples: ["가구 조건이 좁다"],
        agent_ids: [0],
      },
    ],
    complaint_clusters: [{ representative_quote: "나는 대상자인가요?", count: 1, denominator: 1, agent_ids: [0] }],
    affected_group_clusters: [{ representative_quote: "동거 청년", count: 1, denominator: 1, agent_ids: [0] }],
    reframing_list: [],
  },
} as any

describe("ResultPage", () => {
  it("renders empty state when no current run exists", () => {
    const html = renderToStaticMarkup(<ResultPage onDebug={() => {}} />)

    expect(html).toContain("/에서 먼저 실행하세요")
  })

  it("renders data-only dashboard blocks and verbatim response labels", () => {
    const html = renderToStaticMarkup(<ResultPage run={fixtureRun} onDebug={() => {}} />)

    expect(html).toContain("실제 의견수렴을 대체하지 않습니다")
    expect(html).toContain("청년 월세")
    expect(html).toContain("페르소나 3명")
    expect(html).toContain("입장 분포")
    expect(html).toContain("찬성")
    expect(html).toContain("중립")
    expect(html).toContain("반대")
    expect(html).toContain("반복된 우려")
    expect(html).toContain("가구 조건이 좁다")
    expect(html).toContain("1명 중")
    expect(html).toContain("추론 기반")
    expect(html).toContain("예상 민원")
    expect(html).toContain("나는 대상자인가요?")
    expect(html).toContain("불리하다고 지목된 집단")
    expect(html).toContain("가구 기준·가족 동의 영향 집단")
    expect(html).toContain("집단이 불리하다고 지목된 이유")
    expect(html).toContain("가구 조건이 좁다")
    expect(html).toContain("대표 응답")
    expect(html).toContain("27세 · 경기 파주시 · 무직 · 3세대 동거")
    expect(html).toContain("우려")
    expect(html).toContain("예상 민원")
    expect(html).not.toContain("월세 부담을 낮춰줘서 필요합니다.")
    expect(html).not.toContain("가족이랑 같이 사는 청년")
    expect(html).not.toContain("표시하면 안 되는 요약")
    expect(html).not.toContain("LLM 요약 라벨")
    expect(html).not.toContain("심각도")
    expect(html).not.toContain("위험도")
  })

  it("marks inferred policy fields", () => {
    const run = {
      ...fixtureRun,
      structuredPolicy: {
        policy_name: { value: "월세 지원", source: "stated" },
        apply_method: { value: "앱 신청", source: "inferred" },
      },
    } as any

    const html = renderToStaticMarkup(<ResultPage run={run} onDebug={() => {}} />)

    expect(html).toContain('data-source="inferred"')
    expect(html).toContain("앱 신청")
  })
})
