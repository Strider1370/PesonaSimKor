import { describe, expect, it } from "vitest"
import {
  ageGroupShort,
  genderShort,
  niceTickMax,
  placeOpinionBadges,
  regionGroupLabel,
  regionShort,
  seededJitter,
} from "./resultHelpers"

describe("resultHelpers", () => {
  it("formats demographic labels", () => {
    expect(ageGroupShort("20s")).toBe("20대")
    expect(ageGroupShort("70_plus")).toBe("70대+")
    expect(genderShort("female")).toBe("여")
    expect(regionGroupLabel("capital")).toBe("수도권")
  })

  it("shortens district names from sampled region", () => {
    expect(regionShort("서울-은평구", "capital")).toBe("은평구")
    expect(regionShort("경기-성남시 분당구", "capital")).toBe("성남시")
    expect(regionShort("형식없음", "honam")).toBe("호남")
  })

  it("calculates nice y axis maximum", () => {
    expect(niceTickMax(5)).toBe(5)
    expect(niceTickMax(6)).toBe(10)
    expect(niceTickMax(21)).toBe(30)
    expect(niceTickMax(101)).toBe(150)
  })

  it("returns deterministic jitter", () => {
    expect(seededJitter("생활비 부담")).toBe(seededJitter("생활비 부담"))
    expect(seededJitter("생활비 부담")).toBeGreaterThanOrEqual(-1)
    expect(seededJitter("생활비 부담")).toBeLessThanOrEqual(1)
  })

  it("places same-side opinion badges without exact overlap", () => {
    const badges = placeOpinionBadges(
      [
        { label: "a", short_label: "a", count: 3, examples: [] },
        { label: "b", short_label: "b", count: 3, examples: [] },
        { label: "c", short_label: "c", count: 3, examples: [] },
      ],
      "support",
      10,
    )

    expect(new Set(badges.map((badge) => `${badge.x.toFixed(1)}-${badge.y.toFixed(1)}`)).size).toBe(3)
    expect(badges.every((badge) => badge.x < 50)).toBe(true)
  })
})
