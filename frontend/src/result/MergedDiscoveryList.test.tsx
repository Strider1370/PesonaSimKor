import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { MergedDiscoveryList } from "./MergedDiscoveryList"

describe("MergedDiscoveryList", () => {
  it("renders merged items with counts and detail controls", () => {
    const html = renderToStaticMarkup(
      <MergedDiscoveryList
        title="민원"
        items={[
          { label: "where apply", quote: "where apply", count: 2, denominator: null, inferredBased: false, agentIds: [1, 2] },
          { label: "offline access", quote: "offline access gap", count: 1, denominator: null, inferredBased: true, agentIds: [3] },
        ]}
        onSelect={() => {}}
      />,
    )

    expect(html).toContain("민원")
    expect(html).toContain("where apply")
    expect(html).toContain("2명")
    expect(html).toContain("원문 보기")
    expect(html).toContain("추정")
  })
})
