"use client";
/**
 * Closed-beta P3 tenants view (section tenants). Shows all merchant orgs and
 * their key metrics (credits, gens, last active), plus the invited-not-yet-signed-in
 * list. Links each merchant to /admin/tenants/${orgId}.
 * Actions: invite via email form, revoke pending invite.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { TenantRow, InvitedRow } from "@/lib/tenant-admin";
import { inviteTenant, revokeTenantInvite } from "@/lib/tenant-actions";

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
  const revokedInvited = invited.filter((r) => r.status === "revoked");
  const router = useRouter();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [revokingEmail, setRevokingEmail] = useState<string | null>(null);
  const [revokeMsg, setRevokeMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteBusy(true);
    setInviteMsg(null);
    const res = await inviteTenant(inviteEmail);
    setInviteBusy(false);
    if ("error" in res) { setInviteMsg({ ok: false, text: res.error }); return; }
    setInviteMsg({ ok: true, text: `Invited ${inviteEmail}.` });
    setInviteEmail("");
    router.refresh();
  }

  async function revokeInvite(email: string) {
    if (!confirm(`Revoke invite for ${email}?`)) return;
    setRevokingEmail(email);
    setRevokeMsg(null);
    const res = await revokeTenantInvite(email);
    setRevokingEmail(null);
    if ("error" in res) { setRevokeMsg({ ok: false, text: res.error }); return; }
    router.refresh();
  }

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 24 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Tenants</h1>
        <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>
          All merchant organisations (excluding founder). Click a row to view detail.
        </p>
        <form onSubmit={submitInvite} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
          <input
            type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="merchant@example.com" required
            style={{ font: "var(--text-body)", color: "var(--fg-1)", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 8, padding: "6px 10px", flex: "1 1 220px", maxWidth: 320 }}
          />
          <button type="submit" disabled={inviteBusy}
            style={{ font: "var(--text-body)", color: "var(--bg-1)", background: "var(--fg-1)", border: "none", borderRadius: 8, padding: "6px 16px", cursor: inviteBusy ? "default" : "pointer", opacity: inviteBusy ? 0.6 : 1, whiteSpace: "nowrap" }}>
            {inviteBusy ? "Inviting…" : "Invite"}
          </button>
          {inviteMsg && <span style={{ font: "var(--text-caption)", color: inviteMsg.ok ? "var(--fg-2)" : "#e5484d" }}>{inviteMsg.text}</span>}
        </form>
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
        {revokeMsg && <span style={{ font: "var(--text-caption)", color: revokeMsg.ok ? "var(--fg-2)" : "#e5484d" }}>{revokeMsg.text}</span>}
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
            <button
              onClick={() => revokeInvite(r.email)}
              disabled={revokingEmail === r.email}
              style={{ font: "var(--text-caption)", color: "#e5484d", background: "none", border: "1px solid #e5484d", borderRadius: 6, padding: "3px 10px", cursor: revokingEmail === r.email ? "default" : "pointer", opacity: revokingEmail === r.email ? 0.6 : 1, whiteSpace: "nowrap" }}>
              {revokingEmail === r.email ? "…" : "Revoke"}
            </button>
          </div>
        ))}
        {revokedInvited.length > 0 && (
          <>
            <h3 style={{ font: "var(--text-caption)", color: "var(--fg-4)", margin: "12px 0 4px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Revoked</h3>
            {revokedInvited.map((r, i) => (
              <div
                key={`revoked-${r.email}-${i}`}
                style={{ display: "flex", alignItems: "center", gap: 16, padding: "4px 0", borderBottom: "1px solid var(--line-2)" }}
              >
                <span style={{ font: "var(--text-caption)", color: "var(--fg-4)", flex: "2 1 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.email}</span>
                <span style={{ font: "var(--text-caption)", color: "var(--fg-4)", flex: "1 1 0" }}>by {r.invitedBy}</span>
              </div>
            ))}
          </>
        )}
      </section>
    </main>
  );
}
