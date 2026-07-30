import { formatCredits } from "@/lib/credit-format";
import type { SpendEntry } from "@/lib/spend-history";
import type { SpendWindow } from "@/lib/spend-history-data";

/** Say what this list covers. The truncated case names the cut instead of implying "all" —
 *  round-1 review P1①: a PR that fixes "the product says one thing and does another" must not
 *  ship its own version of it. Pure, so the wording is unit-tested without a render. */
export function windowSummary(window: SpendWindow): string {
  if (window.hasMore) {
    return `Showing the last ${window.returned} charges, newest first — older activity isn’t listed here yet.`;
  }
  return window.returned === 1
    ? "Your 1 credit charge so far."
    : `All ${window.returned} credit charges on this workspace, newest first.`;
}

/**
 * Spend history on /billing (#555) — where the credits went.
 *
 * Presentational and server-rendered: it takes the already-shaped entries (see
 * lib/spend-history.ts) and lists them newest-first. It reads nothing and writes nothing.
 * An unsettled hold is labelled as such rather than shown as a final charge, and the list
 * states how far back it reaches (see windowSummary above).
 */
export function SpendHistory({ entries, window }: { entries: SpendEntry[]; window: SpendWindow }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>Spend history</h2>
      <p className="text-muted-foreground" style={{ fontSize: 14, margin: "0 0 12px" }}>
        {entries.length === 0
          ? "Chat and Review are Otto’s conversation turns; they show up here as soon as you use them."
          : `${windowSummary(window)} Chat and Review are Otto’s conversation turns.`}
      </p>

      {entries.length === 0 ? (
        <div className="text-muted-foreground" style={{ fontSize: 14 }}>
          No credit activity yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {entries.map((entry) => (
            <div
              key={entry.id}
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 12,
                padding: "10px 14px",
                borderRadius: "var(--radius-card)",
                border: "1px solid var(--border)",
                background: "var(--card)",
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>{entry.label}</div>
                {entry.detail ? (
                  <div className="text-muted-foreground" style={{ fontSize: 13, marginTop: 2 }}>
                    {entry.detail}
                  </div>
                ) : null}
              </div>
              <div style={{ textAlign: "right" }}>
                <div
                  style={{
                    fontSize: 15,
                    fontFamily: "var(--font-mono)",
                    fontVariantNumeric: "tabular-nums",
                    color: entry.delta > 0 ? "var(--success-soft-foreground)" : "var(--foreground)",
                  }}
                >
                  {entry.delta > 0 ? "+" : ""}
                  {formatCredits(entry.delta)}
                </div>
                <div className="text-muted-foreground" style={{ fontSize: 13, marginTop: 2 }}>
                  {entry.atLabel}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default SpendHistory;
