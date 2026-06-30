"use client";
/**
 * OPT-6 P3a money-gate audit viewer (section ③ slice). READ-ONLY: lists recent
 * spend-relevant ActionEvents (gen/refgen starts, guardian blocks, cowork turns,
 * config/model/directive edits), filterable by type. It only reads the audit log.
 */
import Link from "next/link";

export type AuditRow = { id: string; type: string; projectId: string | null; payload: string; createdAt: string };

// Pull up to 4 salient scalar fields off the (JSON-stringified) payload for an
// at-a-glance inline summary; the full raw JSON stays behind the "raw" expander.
function salientFields(payload: string): { key: string; value: string }[] {
  let obj: unknown;
  try { obj = JSON.parse(payload); } catch { return []; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, unknown>)
    .filter(([, v]) => v != null && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
    .slice(0, 4)
    .map(([key, v]) => ({ key, value: String(v) }));
}

export function AuditAdmin({ rows, types, active }: { rows: AuditRow[]; types: string[]; active: string | null }) {
  return (
    <main style={{ maxWidth: 980, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--foreground)", margin: 0 }}>Audit</h1>
        <p style={{ font: "var(--text-body)", color: "var(--muted-foreground)", margin: 0 }}>
          The money-gate trail: every spend-relevant action the system recorded. Read-only.
        </p>
      </header>

      <nav style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Link href="/admin/audit" style={{ font: "var(--text-mono-meta)", padding: "3px 8px", borderRadius: 6, background: active ? "var(--muted)" : "var(--accent)", color: "var(--foreground)", textDecoration: "none" }}>all</Link>
        {types.map((t) => (
          <Link key={t} href={`/admin/audit?type=${encodeURIComponent(t)}`}
            style={{ font: "var(--text-mono-meta)", padding: "3px 8px", borderRadius: 6, background: active === t ? "var(--accent)" : "var(--muted)", color: "var(--foreground)", textDecoration: "none" }}>
            {t}
          </Link>
        ))}
      </nav>

      <section style={{ display: "grid", gap: 6, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        {rows.length === 0 && <p style={{ font: "var(--text-caption)", color: "var(--muted-foreground)", margin: 0 }}>No events.</p>}
        {rows.map((r) => {
          const fields = salientFields(r.payload);
          return (
          <div key={r.id} style={{ display: "grid", gap: 2, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ font: "var(--text-mono-meta)", color: "var(--foreground)", minWidth: 160 }}>{r.type}</span>
              <span style={{ font: "var(--text-caption)", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)", marginLeft: "auto" }}>{r.createdAt.slice(0, 19).replace("T", " ")}</span>
            </div>
            {fields.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {fields.map((f) => (
                  <span key={f.key} style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)", wordBreak: "break-all" }}>
                    <span style={{ color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)" }}>{f.key}:</span> {f.value}
                  </span>
                ))}
              </div>
            )}
            <details>
              <summary style={{ font: "var(--text-caption)", color: "color-mix(in oklab, var(--muted-foreground) 55%, transparent)", cursor: "pointer" }}>raw</summary>
              <code style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{r.payload}</code>
            </details>
          </div>
          );
        })}
      </section>
    </main>
  );
}
