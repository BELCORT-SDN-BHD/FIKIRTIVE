"use client";
/**
 * Closed-beta P3 tenants view (section tenants). Shows all merchant orgs and
 * their key metrics (credits, gens, last active), plus the invited-not-yet-signed-in
 * list. Read-only — no actions. Links each merchant to /admin/tenants/${orgId}.
 */
import Link from "next/link";
import type { TenantRow, InvitedRow } from "@/lib/tenant-admin";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 16).replace("T", " ");
}

const BADGE_COLORS: Record<string, string> = {
  active: "var(--fg-2)",
  suspended: "#e5484d",
  revoked: "#e5484d",
};

function statusColor(status: string): string {
  return BADGE_COLORS[status] ?? "var(--fg-3)";
}

export function TenantsAdmin({ tenants, invited }: { tenants: TenantRow[]; invited: InvitedRow[] }) {
  const pendingInvited = invited.filter((r) => r.status === "invited");

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 24 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Tenants</h1>
        <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>
          All merchant organisations (excluding founder). Click a row to view detail.
        </p>
      </header>

      {/* Tenants table */}
      <section style={{ display: "grid", gap: 0, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 80px 64px 1fr", gap: 0, padding: "8px 16px", borderBottom: "1px solid var(--line-1)", background: "var(--bg-2)" }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>MERCHANT</span>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>STATUS</span>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>CREDITS</span>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>GENS</span>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-3)" }}>LAST ACTIVE</span>
        </div>
        {tenants.length === 0 && (
          <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0, padding: "12px 16px" }}>No merchant orgs yet.</p>
        )}
        {tenants.map((t) => (
          <div
            key={t.orgId}
            style={{ display: "grid", gridTemplateColumns: "2fr 1fr 80px 64px 1fr", gap: 0, padding: "10px 16px", borderBottom: "1px solid var(--line-2)", alignItems: "center" }}
          >
            <div style={{ display: "grid", gap: 2, overflow: "hidden" }}>
              <Link
                href={`/admin/tenants/${t.orgId}`}
                style={{ font: "var(--text-body)", color: "var(--fg-1)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {t.ownerEmail || t.orgId}
              </Link>
              <span style={{ font: "var(--text-caption)", color: "var(--fg-4)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</span>
            </div>
            <span style={{ font: "var(--text-body)", color: statusColor(t.status) }}>{t.status}</span>
            <span style={{ font: "var(--text-body)", color: "var(--fg-1)" }}>{t.balance.toLocaleString()}</span>
            <span style={{ font: "var(--text-body)", color: "var(--fg-2)" }}>{t.genCount}</span>
            <span style={{ font: "var(--text-caption)", color: "var(--fg-3)" }}>{fmtDate(t.lastActiveAt)}</span>
          </div>
        ))}
      </section>

      {/* Invited section */}
      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--line-1)", borderRadius: 12, background: "var(--bg-1)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0 }}>Invited (not yet signed in)</h2>
        {pendingInvited.length === 0 && (
          <p style={{ font: "var(--text-caption)", color: "var(--fg-3)", margin: 0 }}>None.</p>
        )}
        {pendingInvited.map((r, i) => (
          <div
            key={`${r.email}-${i}`}
            style={{ display: "flex", alignItems: "center", gap: 16, padding: "6px 0", borderBottom: "1px solid var(--line-2)" }}
          >
            <span style={{ font: "var(--text-body)", color: "var(--fg-1)", flex: "2 1 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
            <span style={{ font: "var(--text-body)", color: statusColor(r.status), flex: "1 1 0" }}>{r.status}</span>
            <span style={{ font: "var(--text-caption)", color: "var(--fg-3)", flex: "1 1 0" }}>by {r.invitedBy}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
