import { formatCredits } from "@/lib/credit-format";
import type { SpendEntry } from "@/lib/spend-history";

/**
 * Spend history on /billing (#555) — where the credits went.
 *
 * Presentational and server-rendered: it takes the already-shaped entries (see
 * lib/spend-history.ts) and lists them newest-first. It reads nothing and writes nothing.
 * An unsettled hold is labelled as such rather than shown as a final charge.
 */
export function SpendHistory({ entries }: { entries: SpendEntry[] }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 4px" }}>Spend history</h2>
      <p className="text-muted-foreground" style={{ fontSize: 14, margin: "0 0 12px" }}>
        Every credit charge on this workspace, newest first. Chat and Review are Otto&rsquo;s
        conversation turns.
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
