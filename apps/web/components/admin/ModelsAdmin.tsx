"use client";
/**
 * OPT-6 P2 model registry (section ①). Lists the typed model catalogs and toggles
 * each model's enable/disable via saveModelEnabled (the overlay narrows the typed
 * menu; it can never add a model). Surfaces the seedream coupling + per-family
 * directive-coverage metric. Mirrors SettingsAdmin's card + {ok|error} pattern.
 */
import { useState } from "react";
import { saveModelEnabled } from "@/lib/admin-actions";

export type ModelRow = { id: string; kind: "image" | "video"; family: string; enabled: boolean; notes: string };

function ModelToggle({ row }: { row: ModelRow }) {
  const [enabled, setEnabled] = useState(row.enabled);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function toggle(next: boolean) {
    if (saving) return;
    setSaving(true); setMsg(null);
    let res: Awaited<ReturnType<typeof saveModelEnabled>> | null = null;
    try { res = await saveModelEnabled({ modelId: row.id, enabled: next, notes: row.notes }); } catch { res = null; }
    setSaving(false);
    if (!res) { setMsg({ ok: false, text: "Save failed." }); return; }
    if ("error" in res) { setMsg({ ok: false, text: res.error }); return; }
    setEnabled(next);
    setMsg({ ok: true, text: "Saved." });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ font: "var(--text-body)", color: "var(--foreground)", minWidth: 160 }}>{row.id}</span>
      <span style={{ font: "var(--text-mono-meta)", color: "var(--muted-foreground)", minWidth: 90 }}>{row.family}</span>
      <label style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--text-caption)", color: "var(--muted-foreground)" }}>
        <input type="checkbox" aria-label={`${row.id} enabled`} checked={enabled} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
        <span>{enabled ? "enabled" : "disabled"}</span>
      </label>
      {msg && <span style={{ font: "var(--text-caption)", color: msg.ok ? "#3fb950" : "#e5484d", marginLeft: "auto" }}>{msg.text}</span>}
    </div>
  );
}

export function ModelsAdmin({ imageRows, videoRows, coverage }: { imageRows: ModelRow[]; videoRows: ModelRow[]; coverage: { family: string; covered: boolean }[]; families: string[] }) {
  const covered = coverage.filter((c) => c.covered).length;
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--foreground)", margin: 0 }}>Models</h1>
        <p style={{ font: "var(--text-body)", color: "var(--muted-foreground)", margin: 0 }}>
          Turn a model off and it stops spending everywhere (picker, direct gen, references, and any already-queued job). Capability is fixed in code — this only disables.
        </p>
      </header>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>Image model</h2>
        <p style={{ font: "var(--text-caption)", color: "var(--muted-foreground)", margin: 0 }}>
          One shared image model (Seedream). Turning it off disables ALL image generation — element bases, ref sheets, variants, and direct image gen.
        </p>
        {imageRows.map((r) => <ModelToggle key={r.id} row={r} />)}
      </section>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>Video models</h2>
        {videoRows.map((r) => <ModelToggle key={r.id} row={r} />)}
      </section>

      <section style={{ display: "grid", gap: 8, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
        <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>Directive coverage</h2>
        <p style={{ font: "var(--text-caption)", color: "var(--muted-foreground)", margin: 0 }}>{covered}/{coverage.length} routed video families have an enabled directive.</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {coverage.map((c) => (
            <span key={c.family} style={{ font: "var(--text-mono-meta)", padding: "3px 8px", borderRadius: 6, background: "var(--muted)", color: c.covered ? "#3fb950" : "#e5484d" }}>
              {c.family} {c.covered ? "✓" : "—"}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}
