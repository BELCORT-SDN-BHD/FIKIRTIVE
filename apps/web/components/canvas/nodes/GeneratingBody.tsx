// apps/web/components/canvas/nodes/GeneratingBody.tsx
// In-node "generating" state. Under the Grok-bright skin (gb) it shows OTTO
// making the asset + an indeterminate progress bar + the honest money line
// ("billed only when it finishes" — no fabricated credit number). The legacy
// skin keeps the plain centered text so the old look is untouched (strangler).
import type { TerminalCardStatus } from "@/lib/canvas-card-status";
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

function RefreshButton({ onRefresh }: { onRefresh?: () => void }) {
  if (!onRefresh) return null;
  return (
    <button
      type="button"
      className="nodrag nopan"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onRefresh(); }}
      style={{
        border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
        borderRadius: 999,
        background: "color-mix(in srgb, var(--background) 86%, transparent)",
        color: "inherit",
        fontSize: 11.5,
        fontWeight: 650,
        lineHeight: 1,
        padding: "7px 10px",
        marginTop: 2,
        cursor: "pointer",
      }}
    >
      Check again
    </button>
  );
}

/** ONE FACE PER RESTING STATE — a card that has stopped being made says which ending it reached.
 *
 *  "failed" is a hard fail (the worker FAILED + refunded the job, so it's safe to say "not
 *  charged"); "cancelled" is the merchant's own decision, not a failure, so it says nothing about
 *  money it cannot prove and offers nothing to retry; "timeout" is soft — the client stopped
 *  polling but the worker may still settle it, so it invites a check-back rather than claiming
 *  failure; "missing" means the job finished but the preview URL could not be resolved, so do not
 *  claim a refund; "unknown" is the fallback (#602 T3) — the card has no account of itself, and
 *  saying so with a way to look again beats a spinner that will never stop (F21). Without this
 *  whole family, a card that stopped showed GeneratingBody for ever. */
export function FailedBody({ status, onRefresh }: { status: TerminalCardStatus; onRefresh?: () => void }) {
  const timeout = status === "timeout";
  const missing = status === "missing";
  const cancelled = status === "cancelled";
  const unknown = status === "unknown";
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 12, textAlign: "center", gap: 6 }}>
      <div style={{ fontSize: 20, opacity: 0.5 }} aria-hidden>{timeout ? "⏳" : cancelled ? "⃠" : unknown ? "？" : "⚠️"}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.8 }}>
        {timeout
          ? "Still working…"
          : missing
            ? "Preview missing"
            : cancelled
              ? "Cancelled"
              : unknown
                ? "Status unknown"
                : "That didn't finish"}
      </div>
      <div style={{ fontSize: 11.5, opacity: 0.55, lineHeight: 1.4 }}>
        {timeout
          ? "This is taking longer than usual — check back in a moment."
          : missing
            ? "The job finished, but this card could not load the media."
            : cancelled
              ? "This generation was cancelled."
              : unknown
                ? "We can't tell what happened to this one. Check again to reload it."
                : "You weren't charged. Try again."}
      </div>
      {(timeout || missing || unknown) && <RefreshButton onRefresh={onRefresh} />}
    </div>
  );
}

/** The card while work really is happening — and only then (#602 T3).
 *
 *  `queued` and `generating` are two different claims and the card must not confuse them: knowing
 *  a job exists is not knowing it started, and "Otto is making this" about a job still waiting in
 *  line is an assertion with nothing behind it. The queued face says the true thing instead. */
export function GeneratingBody({
  gb,
  kind,
  queued,
  onRefresh,
}: { gb?: boolean; kind: "image" | "video"; queued?: boolean; onRefresh?: () => void }) {
  if (!gb) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6, gap: 8 }}>
        <span>{queued ? "In the queue…" : kind === "video" ? "Rendering…" : "Generating…"}</span>
        <RefreshButton onRefresh={onRefresh} />
      </div>
    );
  }
  return (
    <div className="cv-gen">
      <span className="cv-gen-otto">
        <OttoCloud /> {queued ? "In the queue — Otto starts shortly" : "Otto is making this"}
      </span>
      <div className="cv-gen-bar" />
      <div className="cv-gen-meta">billed only when it finishes</div>
      <RefreshButton onRefresh={onRefresh} />
    </div>
  );
}
