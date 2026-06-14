"use client";
/**
 * Cowork knowledge-base admin grid (Phase 0B). The founder edits one (family ×
 * mode) directive cell at a time — directive text, confidence, enabled — and the
 * next Enhance reflects it (the read is uncached, R6). Matches the app's
 * interactive pattern: a client component calling the server action with an
 * object and handling {ok}|{error} (like GenSpace's ✨ Enhance).
 *
 * v1 edits directive/confidence/enabled/notes; the structured `rules` (R5) are
 * shown read-only and preserved on save (rules editing lands with Guardian/Coach).
 */
import { useState } from "react";
import { Button, Badge } from "@/components/ds";
import { CONFIDENCE_LEVELS } from "@artlio/core";
import { saveModelDirective, seedResearchDirectives } from "@/lib/admin-actions";

export type AdminCell = {
  family: string;
  mode: string;
  directive: string;
  confidence: string;
  enabled: boolean;
  notes: string;
  source: string;
  rules: unknown;
  exists: boolean;
};

const CONFIDENCE_TONE: Record<string, "positive" | "accent" | "warning" | "neutral"> = {
  high: "positive", medium: "accent", low: "warning", untested: "neutral",
};

function Cell({ cell }: { cell: AdminCell }) {
  const [directive, setDirective] = useState(cell.directive);
  const [confidence, setConfidence] = useState(cell.confidence);
  const [enabled, setEnabled] = useState(cell.enabled);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // last-saved baseline (drives the dirty check) — updated locally on a successful
  // save so the button disables again without a full page reload
  const [base, setBase] = useState({ directive: cell.directive, confidence: cell.confidence, enabled: cell.enabled, exists: cell.exists, source: cell.source });
  const dirty = directive !== base.directive || confidence !== base.confidence || enabled !== base.enabled;

  async function save() {
    if (saving) return;
    setSaving(true); setMsg(null);
    let res: Awaited<ReturnType<typeof saveModelDirective>> | null = null;
    try {
      res = await saveModelDirective({
        family: cell.family, mode: cell.mode,
        directive, notes: cell.notes,
        confidence, enabled,
        source: base.exists ? base.source : "founder",
      });
    } catch { res = null; }
    setSaving(false);
    if (!res) { setMsg({ ok: false, text: "Save failed — try again." }); return; }
    if ("error" in res) { setMsg({ ok: false, text: res.error }); return; }
    setBase({ directive, confidence, enabled, exists: true, source: base.exists ? base.source : "founder" });
    setMsg({ ok: true, text: "Saved." });
  }

  const rulesText = cell.rules && typeof cell.rules === "object" ? JSON.stringify(cell.rules) : "";

  return (
    <div style={{ display: "grid", gap: 6, padding: 12, border: "1px solid var(--line-1)", borderRadius: 10, background: "var(--bg-1)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ font: "var(--text-mono)", color: "var(--fg-2)" }}>{cell.mode}</span>
        {!base.exists && <Badge tone="neutral">unset</Badge>}
        {rulesText && <span title={rulesText} style={{ font: "var(--text-mono)", color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{rulesText}</span>}
      </div>
      <textarea
        value={directive}
        onChange={(e) => setDirective(e.target.value)}
        rows={3}
        placeholder="family-neutral base (no directive)"
        maxLength={2000}
        style={{ width: "100%", resize: "vertical", font: "var(--text-body)", color: "var(--fg-1)", background: "var(--bg-2)", border: "1px solid var(--line-1)", borderRadius: 8, padding: "8px 10px" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--text-caption)", color: "var(--fg-2)" }}>
          <span>confidence</span>
          <select value={confidence} onChange={(e) => setConfidence(e.target.value)} style={{ font: "var(--text-caption)", padding: "3px 6px", borderRadius: 6, background: "var(--bg-2)", color: "var(--fg-1)", border: "1px solid var(--line-1)" }}>
            {CONFIDENCE_LEVELS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <Badge tone={CONFIDENCE_TONE[confidence] ?? "neutral"} dot>{confidence}</Badge>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--text-caption)", color: "var(--fg-2)" }}>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          <span>enabled</span>
        </label>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {msg && <span style={{ font: "var(--text-caption)", color: msg.ok ? "#3fb950" : "#e5484d" }}>{msg.text}</span>}
          <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

export function DirectivesAdmin({ families, modes, cells }: { families: string[]; modes: string[]; cells: AdminCell[] }) {
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const byKey = new Map(cells.map((c) => [`${c.family}:${c.mode}`, c]));

  async function seed() {
    if (seeding) return;
    setSeeding(true); setSeedMsg(null);
    let res: Awaited<ReturnType<typeof seedResearchDirectives>> | null = null;
    try { res = await seedResearchDirectives(); } catch { res = null; }
    setSeeding(false);
    if (!res) { setSeedMsg("Seed failed — try again."); return; }
    if ("error" in res) { setSeedMsg(res.error); return; }
    setSeedMsg(res.inserted || res.refreshed ? `Inserted ${res.inserted}, refreshed ${res.refreshed} research default${res.inserted + res.refreshed === 1 ? "" : "s"}. Refresh to see them.` : "Already seeded — in sync.");
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Button variant="glass" size="sm" disabled={seeding} onClick={seed}>{seeding ? "Seeding…" : "Seed research defaults"}</Button>
        {seedMsg && <span style={{ font: "var(--text-caption)", color: "var(--fg-2)" }}>{seedMsg}</span>}
      </div>
      {families.map((family) => (
        <section key={family} style={{ display: "grid", gap: 10 }}>
          <h2 style={{ font: "var(--text-title)", color: "var(--fg-1)", margin: 0, textTransform: "capitalize" }}>{family}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 10 }}>
            {modes.map((mode) => {
              const cell = byKey.get(`${family}:${mode}`)!;
              return <Cell key={mode} cell={cell} />;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
