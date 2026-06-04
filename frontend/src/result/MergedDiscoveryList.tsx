import { useState } from "react"
import type { DashboardCluster } from "./dashboardModel"

const INITIAL_LIMIT = 3

export function MergedDiscoveryList({
  title,
  items,
  tone = "danger",
  onSelect,
}: {
  title: string
  items: DashboardCluster[]
  tone?: "danger" | "purple" | "orange"
  onSelect: (agentIds: number[]) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, INITIAL_LIMIT)
  const hidden = items.length - visible.length

  return (
    <section className={`merged-list panel-block ${tone}`}>
      <div className="section-title">
        <h2>
          {title} <span className="count-chip">{items.length}</span>
        </h2>
      </div>
      {items.length === 0 ? (
        <p className="dashboard-empty">표시할 항목이 없습니다.</p>
      ) : (
        <>
          <div className="merged-list-items">
            {visible.map((item) => (
              <article key={`${item.label}-${item.agentIds.join("-")}`} className="merged-list-item">
                <div>
                  <strong>{item.label}</strong>
                  {item.quote !== item.label && <p>{item.quote}</p>}
                  {item.inferredBased && <em>추정</em>}
                </div>
                <div className="merged-list-actions">
                  <span>{item.count}명</span>
                  <button type="button" onClick={() => onSelect(item.agentIds)}>
                    원문 보기
                  </button>
                </div>
              </article>
            ))}
          </div>
          {hidden > 0 && (
            <button type="button" className="more-toggle" onClick={() => setExpanded(true)}>
              {hidden}건 더 보기 ▾
            </button>
          )}
          {expanded && items.length > INITIAL_LIMIT && (
            <button type="button" className="more-toggle" onClick={() => setExpanded(false)}>
              접기 ▴
            </button>
          )}
        </>
      )}
    </section>
  )
}
