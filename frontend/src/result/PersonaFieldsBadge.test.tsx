import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { PersonaFieldsBadge } from "./PersonaFieldsBadge"

describe("PersonaFieldsBadge", () => {
  it("shows depth, always-on, and policy-selected groups", () => {
    const html = renderToStaticMarkup(
      <PersonaFieldsBadge
        depth="standard"
        includedFields={["age", "occupation", "professional_persona", "arts_persona"]}
        selectedOptional={["arts_persona"]}
      />,
    )
    expect(html).toContain("표준")
    expect(html).not.toContain("standard")
    expect(html).toContain("직업")
    expect(html).toContain("예술 취향")
  })

  it("renders fallback for empty (legacy) data", () => {
    const html = renderToStaticMarkup(<PersonaFieldsBadge depth={undefined} includedFields={[]} selectedOptional={[]} />)
    expect(html).toContain("항목 정보 없음")
  })
})
