"use client";
/**
 * Read-only detail view for a single merchant org (/admin/tenants/[orgId]).
 * Shows: header (owner email + orgId + status), stats row (balance, reserved,
 * true cost, projects, gens), credit ledger (last 25), recent audit log (last 25).
 * Matches admin house style (CSS vars, card pattern from CreditsAdmin.tsx).
 */
import Link from "next/link";
import type { TenantDetail as Detail } from "@/lib/tenant-admin";

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
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <span style={{ font: "var(--text-mono-meta)", color: "var(--fg-4)" }}>{orgId}</span>
          <span style={{ font: "var(--text-body)", color: statusColor(status) }}>{status}</span>
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
