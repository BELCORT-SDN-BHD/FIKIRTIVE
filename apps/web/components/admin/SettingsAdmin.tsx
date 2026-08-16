"use client";
/**
 * OPT-6 P1a runtime-config settings (the writable knobs in resolveVisionConfig).
 * Mirrors DirectivesAdmin: a client component calling the server action with an
 * object and surfacing {ok}|{error}. Worker-side env keys aren't editable here
 * (restart-required), only the DB-backed runtime config.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { saveRuntimeConfig } from "@/lib/admin-actions";

type Vision = { enabled: boolean; maxImages: number; maxBytes: number };

function VisionCard({ vision }: { vision: Vision }) {
  const [enabled, setEnabled] = useState(vision.enabled);
  const [maxImages, setMaxImages] = useState(vision.maxImages);
  const [maxBytes, setMaxBytes] = useState(vision.maxBytes);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [base, setBase] = useState({ enabled: vision.enabled, maxImages: vision.maxImages, maxBytes: vision.maxBytes });
  const dirty = enabled !== base.enabled || maxImages !== base.maxImages || maxBytes !== base.maxBytes;

  async function save() {
    if (saving) return;
    setSaving(true); setMsg(null);
    let res: Awaited<ReturnType<typeof saveRuntimeConfig>> | null = null;
    try {
      res = await saveRuntimeConfig({ key: "vision", value: { enabled, maxImages, maxBytes } });
    } catch { res = null; }
    setSaving(false);
    if (!res) { setMsg({ ok: false, text: "Save failed — try again." }); return; }
    if ("error" in res) { setMsg({ ok: false, text: res.error }); return; }
    setBase({ enabled, maxImages, maxBytes });
    setMsg({ ok: true, text: "Saved." });
  }

  return (
    <section style={{ display: "grid", gap: 12, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
      <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>Vision</h2>
      <label style={{ display: "flex", alignItems: "center", gap: 8, font: "var(--text-body)", color: "var(--muted-foreground)" }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Enabled (planner sees in-play reference pixels)</span>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 10, font: "var(--text-caption)", color: "var(--muted-foreground)" }}>
        <span style={{ minWidth: 90 }}>max images</span>
        <input
          type="number" min={1} max={8} value={maxImages}
          onChange={(e) => setMaxImages(Number(e.target.value))}
          style={{ width: 90, font: "var(--text-body)", color: "var(--foreground)", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px" }}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 10, font: "var(--text-caption)", color: "var(--muted-foreground)" }}>
        <span style={{ minWidth: 90 }}>max bytes</span>
        <input
          type="number" min={1} max={16000000} value={maxBytes}
          onChange={(e) => setMaxBytes(Number(e.target.value))}
          style={{ width: 140, font: "var(--text-body)", color: "var(--foreground)", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px" }}
        />
      </label>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {msg && <span style={{ font: "var(--text-caption)", color: msg.ok ? "var(--success)" : "var(--destructive)" }}>{msg.text}</span>}
        <div style={{ marginLeft: "auto" }}>
          <Button size="sm" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </section>
  );
}

export function SettingsAdmin({ vision }: { vision: Vision }) {
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--foreground)", margin: 0 }}>Settings</h1>
        <p style={{ font: "var(--text-body)", color: "var(--muted-foreground)", margin: 0 }}>
          Runtime config — takes effect on the next Otto turn (no redeploy).
        </p>
      </header>
      <VisionCard vision={vision} />
    </main>
  );
}
