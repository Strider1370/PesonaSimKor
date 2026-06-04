import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { VoiceCard } from "./VoiceCard"

describe("VoiceCard", () => {
  it("renders persona tags, stance, blind spot reason, affected group, and grounding", () => {
    const html = renderToStaticMarkup(
      <VoiceCard
        persona={{
          agentId: 4,
          stance: "oppose",
          meta: "",
          headlineParts: ["응답 #4", "42세", "Seoul"],
          metaParts: [{ value: "occupation_stratum 3", tooltip: "직업" }, { value: "rent", tooltip: "주거" }],
          rationale: "Application windows are hard to use.",
          blindSpot: "night workers miss the window",
          blindSpotReason: "shift schedules conflict with office hours",
          affectedGroup: "night-shift workers",
          grounding: "inferred",
          expectedComplaint: "Where can I apply offline?",
        }}
      />,
    )

    expect(html).toContain("응답 #4")
    expect(html).toContain("반대")
    expect(html).toContain("직업 사무")
    expect(html).toContain("월세")
    expect(html).not.toContain("occupation_stratum")
    expect(html).not.toContain("rent")
    expect(html).toContain("Application windows are hard to use.")
    expect(html).toContain("shift schedules conflict with office hours")
    expect(html).toContain("night-shift workers")
    expect(html).toContain("추정")
    expect(html).toContain("Where can I apply offline?")
  })
})
