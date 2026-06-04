import type { DashboardPersona } from "./dashboardModel"
import { groundingLabel, stanceLabel, tagLabel } from "./labels"

export type VoiceCardMode = "blindspot" | "complaint" | "reframing" | "default"

export function VoiceCard({ persona, mode = "default" }: { persona: DashboardPersona; mode?: VoiceCardMode }) {
  return (
    <article className="voice-card card">
      <header className="voice-card-head">
        <div className="persona-headline-text">
          <span className="persona-name">{persona.headlineParts[0]}</span>
          {persona.headlineParts.length > 1 && (
            <span className="persona-sub">
              {persona.headlineParts.slice(1).join(" · ")}
            </span>
          )}
        </div>
        <strong className={`stance-pill ${persona.stance}`}>{stanceLabel(persona.stance)}</strong>
      </header>

      {mode === "blindspot" && (
        <>
          {persona.blindSpot && (
            <div className="signal danger">
              <div className="signal-title">설계 미비 항목</div>
              <p>{persona.blindSpot}</p>
            </div>
          )}
          <div className="voice-foot">
            {persona.blindSpotReason && (
              <span>
                <b>이유</b> {persona.blindSpotReason}
              </span>
            )}
            {persona.affectedGroup && (
              <span>
                <b>집단</b> {persona.affectedGroup}
              </span>
            )}
          </div>
        </>
      )}

      {mode === "reframing" && (
        <>
          <p className="voice-rationale">{persona.rationale}</p>
          {persona.reframing && (
            <div className="signal reframing">
              <div className="signal-title">정책 전제 반문</div>
              <p>{persona.reframing}</p>
            </div>
          )}
        </>
      )}

      {mode === "complaint" && (
        <>
          <p className="voice-rationale">{persona.rationale}</p>
          {persona.expectedComplaint && (
            <div className="signal warning">
              <div className="signal-title">예상 민원</div>
              <p>{persona.expectedComplaint}</p>
            </div>
          )}
        </>
      )}

      {mode === "default" && (
        <>
          <p className="voice-rationale">{persona.rationale}</p>
          {persona.blindSpot && (
            <div className="signal danger">
              <div className="signal-title">설계 미비 항목</div>
              <p>{persona.blindSpot}</p>
            </div>
          )}
          <div className="voice-foot">
            {persona.blindSpotReason && (
              <span>
                <b>이유</b> {persona.blindSpotReason}
              </span>
            )}
            {persona.affectedGroup && (
              <span>
                <b>집단</b> {persona.affectedGroup}
              </span>
            )}
          </div>
          {persona.expectedComplaint && (
            <div className="signal warning">
              <div className="signal-title">예상 민원</div>
              <p>{persona.expectedComplaint}</p>
            </div>
          )}
        </>
      )}
      {persona.metaParts.length > 0 && (
        <div className="persona-meta-badges persona-meta-footer">
          {persona.metaParts.map((part) => (
            <span key={part.value} className="chip" title={part.tooltip}>
              {part.value}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}
