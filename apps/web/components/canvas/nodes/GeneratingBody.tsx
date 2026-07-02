// apps/web/components/canvas/nodes/GeneratingBody.tsx
// In-node "generating" state. Under the Grok-bright skin (gb) it shows OTTO
// making the asset + an indeterminate progress bar + the honest money line
// ("billed only when it finishes" — no fabricated credit number). The legacy
// skin keeps the plain centered text so the old look is untouched (strangler).
function OttoCloud() {
  return (
    <svg width="30" height="27" viewBox="0 0 120 110" aria-hidden>
      <g fill="currentColor">
        <ellipse cx="60" cy="64" rx="43" ry="22" />
        <circle cx="37" cy="52" r="18" />
        <circle cx="61" cy="40" r="24" />
        <circle cx="85" cy="53" r="17" />
      </g>
      <ellipse cx="56" cy="49" rx="3.6" ry="4.6" fill="#2B1308" />
      <ellipse cx="71" cy="49" rx="3.6" ry="4.6" fill="#2B1308" />
    </svg>
  );
}

/** Terminal state for a card whose gen didn't deliver. "failed" is a hard fail (the worker
 *  FAILED + refunded the job, so it's safe to say "not charged"); "timeout" is soft — the
 *  client stopped polling but the worker may still settle it, so it invites a check-back
 *  rather than claiming failure. Without this, a FAILED/timed-out node showed GeneratingBody
 *  forever (the eternal spinner, F21). */
export function FailedBody({ status }: { status: "failed" | "timeout" }) {
  const timeout = status === "timeout";
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 12, textAlign: "center", gap: 6 }}>
      <div style={{ fontSize: 20, opacity: 0.5 }} aria-hidden>{timeout ? "⏳" : "⚠️"}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.8 }}>
        {timeout ? "Still working…" : "That didn't finish"}
      </div>
      <div style={{ fontSize: 11.5, opacity: 0.55, lineHeight: 1.4 }}>
        {timeout
          ? "This is taking longer than usual — check back in a moment."
          : "You weren't charged. Try again."}
      </div>
    </div>
  );
}

export function GeneratingBody({ gb, kind }: { gb?: boolean; kind: "image" | "video" }) {
  if (!gb) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6 }}>
        {kind === "video" ? "Rendering…" : "Generating…"}
      </div>
    );
  }
  return (
    <div className="cv-gen">
      <span className="cv-gen-otto"><OttoCloud /> OTTO is making this</span>
      <div className="cv-gen-bar" />
      <div className="cv-gen-meta">billed only when it finishes</div>
    </div>
  );
}
