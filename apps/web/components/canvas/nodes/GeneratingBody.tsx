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
