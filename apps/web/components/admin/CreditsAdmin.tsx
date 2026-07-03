"use client";
/**
 * Closed-beta P2 credits view (section ⑦). Shows the org's balance + held reserve and
 * the recent ledger, and a grant/adjust form. The form speaks DISPLAYED credits (1 = $0.10);
 * a per-submit idempotency key makes a double-click a no-op (grantCredits dedupes). Mirrors
 * CostAdmin's inline-style card pattern. This is the admin WRITE surface; the ledger service
 * remains the only account writer.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { displayCredits } from "@fikirtive/core/spend";
import { grantCreditsAction } from "@/lib/credit-actions";

export type LedgerRow = {
  id: string; kind: string; source: string; displayedDelta: number; displayedReservedDelta: number;
  reason: string; createdBy: string; createdAt: string;
};

const usdFromInternal = (internal: number) => `$${(internal / 100).toFixed(2)}`; // 1 internal credit = $0.01

export function CreditsAdmin({ orgId, balance, reserved, rows }: { orgId: string; balance: number; reserved: number; rows: LedgerRow[] }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const displayedAmount = Number(amount);
    if (!Number.isInteger(displayedAmount) || displayedAmount === 0) {
      setMsg({ ok: false, text: "Enter a non-zero whole number of credits (negative to deduct)." });
      return;
    }
    setBusy(true);
    setMsg(null);
    // one key per submit intent → a double-click reuses it → grantCredits no-ops the second.
    const idempotencyKey = `admin-grant:${crypto.randomUUID()}`;
    const res = await grantCreditsAction({ orgId, displayedAmount, reason, idempotencyKey });
    setBusy(false);
    if ("error" in res) {
      setMsg({ ok: false, text: res.error });
      return;
    }
    setMsg({ ok: true, text: res.duplicate ? "Already applied (duplicate submit ignored)." : `Applied ${displayedAmount > 0 ? "+" : ""}${displayedAmount} credits.` });
    setAmount("");
    setReason("");
    router.refresh();
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--foreground)", margin: 0 }}>Credits</h1>
        <p style={{ font: "var(--text-body)", color: "var(--muted-foreground)", margin: 0 }}>
          The per-org credit balance and ledger. 1 credit = $0.10. Grants and adjustments are recorded as an append-only ledger; this form is the only way to add credits.
        </p>
      </header>

      <section style={{ display: "flex", gap: 24, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)" }}>BALANCE</span>
          <span style={{ font: "var(--text-display)", color: "var(--foreground)" }}>{displayCredits(balance).toLocaleString()}</span>
          <span style={{ font: "var(--text-caption)", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)" }}>≈ {usdFromInternal(balance)}</span>
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)" }}>HELD (in-flight)</span>
          <span style={{ font: "var(--text-display)", color: "var(--foreground)" }}>{displayCredits(reserved).toLocaleString()}</span>
          <span style={{ font: "var(--text-caption)", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)" }}>≈ {usdFromInternal(reserved)}</span>
        </div>
        <div style={{ display: "grid", gap: 2, marginLeft: "auto" }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)" }}>ORG</span>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)" }}>{orgId}</span>
        </div>
      </section>

      <section style={{ display: "grid", gap: 10, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>Grant / adjust</h2>
        <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ font: "var(--text-caption)", color: "var(--muted-foreground)" }}>Credits (negative to deduct) — 1 credit = $0.10</span>
            <input
              type="number" step="1" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="1000" required
              style={{ font: "var(--text-body)", color: "var(--foreground)", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            <span style={{ font: "var(--text-caption)", color: "var(--muted-foreground)" }}>Reason (optional)</span>
            <input
              type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="beta top-up"
              style={{ font: "var(--text-body)", color: "var(--foreground)", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px" }}
            />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button type="submit" disabled={busy}
              style={{ font: "var(--text-body)", color: "var(--card)", background: "var(--foreground)", border: "none", borderRadius: 8, padding: "8px 16px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
              {busy ? "Applying…" : "Apply"}
            </button>
            {msg && <span style={{ font: "var(--text-caption)", color: msg.ok ? "var(--muted-foreground)" : "#e5484d" }}>{msg.text}</span>}
          </div>
        </form>
      </section>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>Recent ledger</h2>
        {rows.length === 0 && <p style={{ font: "var(--text-caption)", color: "var(--muted-foreground)", margin: 0 }}>No ledger entries yet.</p>}
        {rows.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)", minWidth: 70 }}>{r.kind}</span>
            <span style={{ font: "var(--text-body)", color: r.displayedDelta < 0 ? "#e5484d" : "var(--foreground)", minWidth: 64 }}>{r.displayedDelta > 0 ? "+" : ""}{r.displayedDelta.toLocaleString()}</span>
            {/* reserved-column movement — so SETTLE (balanceDelta 0) doesn't read as a no-op */}
            <span style={{ font: "var(--text-caption)", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)", minWidth: 70 }}>{r.displayedReservedDelta !== 0 ? `${r.displayedReservedDelta > 0 ? "+" : ""}${r.displayedReservedDelta.toLocaleString()} hold` : ""}</span>
            <span style={{ font: "var(--text-mono-meta)", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)", minWidth: 60 }}>{r.source}</span>
            <span style={{ font: "var(--text-caption)", color: "var(--muted-foreground)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason || r.createdBy}</span>
            <span style={{ font: "var(--text-caption)", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)", marginLeft: "auto", whiteSpace: "nowrap" }}>{r.createdAt.slice(0, 16).replace("T", " ")}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
