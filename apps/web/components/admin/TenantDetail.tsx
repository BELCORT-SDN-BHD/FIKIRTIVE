"use client";
/**
 * Detail view for a single merchant org (/admin/tenants/[orgId]).
 * Shows: header (owner email + orgId + status), stats row (balance, reserved,
 * true cost, projects, gens), controls (grant credits, suspend/resume, cut sessions),
 * credit ledger (last 25), recent audit log (last 25).
 * Matches admin house style (CSS vars, card pattern from CreditsAdmin.tsx).
 */
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TenantDetail as Detail } from "@/lib/tenant-admin";
import { grantTenantCredits, setMembershipStatus, cutTenantSessions, impersonateTenant } from "@/lib/tenant-actions";

const BADGE_COLORS: Record<string, string> = {
  active: "var(--fg-2)",
  suspended: "#e5484d",
  revoked: "#e5484d",
};

function statusColor(s: string): string {
  return BADGE_COLORS[s] ?? "var(--fg-3)";
}

function fmtDate(iso: string): string {
  return iso.slice(0, 16).replace("T", " ");
}

function fmtUsd(n: number): string {
  return "$" + n.toFixed(4);
}

export function TenantDetail({ detail }: { detail: Detail }) {
  const { orgId, name, ownerEmail, status, balance, reserved, spentUsd, projectCount, genCount, ledger, audit } = detail;
  const router = useRouter();

  // Grant credits state
  const [grantAmount, setGrantAmount] = useState("");
  const [grantReason, setGrantReason] = useState("");
  const [grantBusy, setGrantBusy] = useState(false);
  const [grantMsg, setGrantMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const grantBusyRef = useRef(false); // synchronous double-submit guard (state hasn't re-rendered yet on 2nd click)

  // Suspend/resume state
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Cut sessions state
  const [cutBusy, setCutBusy] = useState(false);
  const [cutMsg, setCutMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Impersonate state
  const [impersonateBusy, setImpersonateBusy] = useState(false);
  const [impersonateMsg, setImpersonateMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submitGrant(e: React.FormEvent) {
    e.preventDefault();
    if (grantBusyRef.current) return; // synchronous double-submit guard
    grantBusyRef.current = true;
    try {
      const displayedAmount = Number(grantAmount);
      if (!Number.isInteger(displayedAmount) || displayedAmount === 0) {
        setGrantMsg({ ok: false, text: "Enter a non-zero whole number of credits (negative to deduct)." });
        return;
      }
      setGrantBusy(true);
      setGrantMsg(null);
      const res = await grantTenantCredits({ orgId, displayedAmount, reason: grantReason, idempotencyKey: `admin-tenant-grant:${crypto.randomUUID()}` });
      setGrantBusy(false);
      if ("error" in res) { setGrantMsg({ ok: false, text: res.error }); return; }
      setGrantMsg({ ok: true, text: `Applied ${displayedAmount > 0 ? "+" : ""}${displayedAmount} credits.` });
      setGrantAmount("");
      setGrantReason("");
      router.refresh();
    } finally {
      grantBusyRef.current = false;
    }
  }

  async function toggleStatus() {
    const isSuspended = status === "suspended";
    const nextStatus = isSuspended ? "active" : "suspended";
    if (!isSuspended && !confirm(`Suspend this tenant? They will be locked out immediately.`)) return;
    setStatusBusy(true);
    setStatusMsg(null);
    const res = await setMembershipStatus(orgId, nextStatus);
    setStatusBusy(false);
    if ("error" in res) { setStatusMsg({ ok: false, text: res.error }); return; }
    setStatusMsg({ ok: true, text: `Status set to ${nextStatus}.` });
    router.refresh();
  }

  async function cutSessions() {
    if (!confirm("Sign this merchant out now? All their active sessions will be deleted.")) return;
    setCutBusy(true);
    setCutMsg(null);
    const res = await cutTenantSessions(orgId);
    setCutBusy(false);
    if ("error" in res) { setCutMsg({ ok: false, text: res.error }); return; }
    setCutMsg({ ok: true, text: `Signed out ${res.cut} session${res.cut === 1 ? "" : "s"}.` });
    router.refresh();
  }

  async function startImpersonating() {
    if (!confirm(`Impersonate ${ownerEmail || orgId}? You will be signed in as this customer.`)) return;
    setImpersonateBusy(true);
    setImpersonateMsg(null);
    const res = await impersonateTenant(orgId);
    setImpersonateBusy(false);
    if ("error" in res) { setImpersonateMsg({ ok: false, text: res.error }); return; }
    router.push("/");
  }

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>

      {/* Back link */}
      <Link
        href="/admin/tenants"
        style={{ font: "var(--text-caption)", color: "var(--fg-3)", textDecoration: "none", width: "fit-content" }}
      >
        ← Tenants
      </Link>

      {/* Header */}
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>
          {ownerEmail || name || orgId}
        </h1>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-4)" }}>{orgId}</span>
          <span style={{ font: "var(--text-body)", color: statusColor(status) }}>{status}</span>
          <Link
            href={`/admin/content?orgId=${orgId}`}
            style={{ font: "var(--text-mono-meta)", padding: "3px 8px", borderRadius: 6, background: "var(--bg-2)", color: "var(--fg-1)", textDecoration: "none", marginLeft: "auto" }}
          >
            View content →
          </Link>
        </div>
      </header>

      {/* Stats row */}
      <section style={{ display: "flex", flexWrap: "wrap", gap: 24, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>BALANCE</span>
          <span style={{ font: "var(--text-display)", color: "var(--fg-1)" }}>{balance.toLocaleString()}</span>
          <span style={{ font: "var(--text-caption)", color: "var(--fg-4)" }}>credits</span>
        </div>
        {reserved > 0 && (
          <div style={{ display: "grid", gap: 2 }}>
            <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>RESERVED</span>
            <span style={{ font: "var(--text-display)", color: "var(--fg-1)" }}>{reserved.toLocaleString()}</span>
            <span style={{ font: "var(--text-caption)", color: "var(--fg-4)" }}>in-flight</span>
          </div>
        )}
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>TRUE COST</span>
          <span style={{ font: "var(--text-display)", color: "var(--fg-1)" }}>{fmtUsd(spentUsd)}</span>
          <span style={{ font: "var(--text-caption)", color: "var(--fg-4)" }}>USD spent</span>
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>PROJECTS</span>
          <span style={{ font: "var(--text-display)", color: "var(--fg-1)" }}>{projectCount}</span>
        </div>
        <div style={{ display: "grid", gap: 2 }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>GENS</span>
          <span style={{ font: "var(--text-display)", color: "var(--fg-1)" }}>{genCount}</span>
        </div>
      </section>

      {/* Controls */}
      <section style={{ display: "grid", gap: 10, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Controls</h2>

        {/* Grant credits form */}
        <form onSubmit={submitGrant} style={{ display: "grid", gap: 8 }}>
          <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>Grant / adjust credits (1 credit = $0.10; negative to deduct)</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="number" step="1" inputMode="numeric" value={grantAmount} onChange={(e) => setGrantAmount(e.target.value)}
              placeholder="e.g. 500" required
              style={{ font: "var(--text-body)", color: "var(--fg-1)", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 8, padding: "6px 10px", width: 120 }}
            />
            <input
              type="text" maxLength={500} value={grantReason} onChange={(e) => setGrantReason(e.target.value)}
              placeholder="Reason (optional)"
              style={{ font: "var(--text-body)", color: "var(--fg-1)", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 8, padding: "6px 10px", flex: "1 1 160px" }}
            />
            <button type="submit" disabled={grantBusy}
              style={{ font: "var(--text-body)", color: "var(--bg-1)", background: "var(--fg-1)", border: "none", borderRadius: 8, padding: "6px 16px", cursor: grantBusy ? "default" : "pointer", opacity: grantBusy ? 0.6 : 1, whiteSpace: "nowrap" }}>
              {grantBusy ? "Applying…" : "Grant"}
            </button>
          </div>
          {grantMsg && <span style={{ font: "var(--text-caption)", color: grantMsg.ok ? "var(--fg-2)" : "#e5484d" }}>{grantMsg.text}</span>}
        </form>

        {/* Suspend / Resume + Cut sessions */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", paddingTop: 4 }}>
          <button onClick={toggleStatus} disabled={statusBusy}
            style={{ font: "var(--text-body)", color: status === "suspended" ? "var(--bg-1)" : "#fff", background: status === "suspended" ? "var(--fg-2)" : "#e5484d", border: "none", borderRadius: 8, padding: "6px 16px", cursor: statusBusy ? "default" : "pointer", opacity: statusBusy ? 0.6 : 1 }}>
            {statusBusy ? "…" : status === "suspended" ? "Resume" : "Suspend"}
          </button>
          <button onClick={cutSessions} disabled={cutBusy}
            style={{ font: "var(--text-body)", color: "var(--fg-1)", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 8, padding: "6px 16px", cursor: cutBusy ? "default" : "pointer", opacity: cutBusy ? 0.6 : 1 }}>
            {cutBusy ? "Signing out…" : "Sign this merchant out now"}
          </button>
          <button onClick={startImpersonating} disabled={impersonateBusy}
            style={{ font: "var(--text-body)", color: "var(--fg-1)", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 8, padding: "6px 16px", cursor: impersonateBusy ? "default" : "pointer", opacity: impersonateBusy ? 0.6 : 1 }}>
            {impersonateBusy ? "Impersonating…" : "Impersonate"}
          </button>
          {statusMsg && <span style={{ font: "var(--text-caption)", color: statusMsg.ok ? "var(--fg-2)" : "#e5484d" }}>{statusMsg.text}</span>}
          {cutMsg && <span style={{ font: "var(--text-caption)", color: cutMsg.ok ? "var(--fg-2)" : "#e5484d" }}>{cutMsg.text}</span>}
          {impersonateMsg && <span style={{ font: "var(--text-caption)", color: impersonateMsg.ok ? "var(--fg-2)" : "#e5484d" }}>{impersonateMsg.text}</span>}
        </div>
      </section>

      {/* Credit ledger */}
      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Credit activity</h2>
        {ledger.length === 0 && (
          <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No ledger entries yet.</p>
        )}
        {ledger.map((row) => (
          <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line-2)" }}>
            <span style={{ font: "var(--text-caption)", color: "var(--fg-4)", minWidth: 130, whiteSpace: "nowrap" }}>{fmtDate(row.createdAt)}</span>
            <span style={{ font: "var(--text-body)", color: row.displayedDelta < 0 ? "#e5484d" : "var(--fg-1)", minWidth: 64 }}>
              {row.displayedDelta > 0 ? "+" : ""}{row.displayedDelta.toLocaleString()}
            </span>
            <span style={{ font: "var(--text-caption)", color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {row.reason || row.kind}
            </span>
          </div>
        ))}
      </section>

      {/* Audit log */}
      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Recent audit</h2>
        {audit.length === 0 && (
          <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>No audit events yet.</p>
        )}
        {audit.map((row) => (
          <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line-2)" }}>
            <span style={{ font: "var(--text-caption)", color: "var(--fg-4)", minWidth: 130, whiteSpace: "nowrap" }}>{fmtDate(row.createdAt)}</span>
            <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-2)" }}>{row.type}</span>
          </div>
        ))}
      </section>

    </main>
  );
}
