"use client";
/**
 * OPT-6 P1b §④ Team & access. Lists team members + roles; a super-admin assigns a
 * role per row via saveUserRole (server is self-escalation-proof; the UI also
 * disables the self-row). Mirrors ModelsAdmin's row + {ok|error} pattern + the
 * shared CSS variables (no new design system).
 */
import { useState } from "react";
import { Button } from "@/components/ds";
import { saveUserRole } from "@/lib/admin-actions";

export type TeamRow = { id: string; email: string; name: string; role: string };

function RoleRow({ row, roles, isSelf }: { row: TeamRow; roles: string[]; isSelf: boolean }) {
  const [role, setRole] = useState(row.role);
  const [base, setBase] = useState(row.role);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = role !== base;

  async function save() {
    if (saving || isSelf) return;
    setSaving(true); setMsg(null);
    let res: Awaited<ReturnType<typeof saveUserRole>> | null = null;
    try { res = await saveUserRole({ userId: row.id, role }); } catch { res = null; }
    setSaving(false);
    if (!res) { setMsg({ ok: false, text: "Save failed." }); return; }
    if ("error" in res) { setMsg({ ok: false, text: res.error }); return; }
    setBase(role);
    setMsg({ ok: true, text: "Saved." });
  }

  return (
    <tr>
      <td style={{ padding: "8px 10px", font: "var(--text-body)", color: "var(--foreground)" }}>
        {row.email}{isSelf && <span style={{ color: "var(--muted-foreground)", font: "var(--text-caption)" }}> (you)</span>}
      </td>
      <td style={{ padding: "8px 10px" }}>
        <select
          value={role} disabled={isSelf || saving}
          onChange={(e) => setRole(e.target.value)}
          style={{ font: "var(--text-body)", padding: "6px 10px", borderRadius: 8, background: "var(--muted)", color: "var(--foreground)", border: "1px solid var(--border)" }}
        >
          {roles.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
      <td style={{ padding: "8px 10px", display: "flex", alignItems: "center", gap: 10 }}>
        {!isSelf && <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>}
        {msg && <span style={{ font: "var(--text-caption)", color: msg.ok ? "#3fb950" : "#e5484d" }}>{msg.text}</span>}
      </td>
    </tr>
  );
}

export function TeamAdmin({ rows, roles, selfEmail }: { rows: TeamRow[]; roles: string[]; selfEmail: string }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--foreground)", margin: 0 }}>Team &amp; access</h1>
        <p style={{ font: "var(--text-body)", color: "var(--muted-foreground)", margin: 0 }}>
          Operator roles. You can&apos;t change your own role (anti-lockout). super-admin grants super-admin.
        </p>
      </header>
      <table style={{ borderCollapse: "collapse", width: "100%", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
        <thead>
          <tr style={{ background: "var(--card)" }}>
            <th style={{ textAlign: "left", padding: "8px 10px", font: "var(--text-caption)", color: "var(--muted-foreground)" }}>Member</th>
            <th style={{ textAlign: "left", padding: "8px 10px", font: "var(--text-caption)", color: "var(--muted-foreground)" }}>Role</th>
            <th style={{ textAlign: "left", padding: "8px 10px", font: "var(--text-caption)", color: "var(--muted-foreground)" }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => <RoleRow key={r.id} row={r} roles={roles} isSelf={!!selfEmail && r.email.toLowerCase() === selfEmail.toLowerCase()} />)}
        </tbody>
      </table>
    </main>
  );
}
