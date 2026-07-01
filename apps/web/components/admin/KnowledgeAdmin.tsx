"use client";
/**
 * OPT-6 P2 §⑥ knowledge editing. Three runtime-config text keys via the SAME
 * saveRuntimeConfig action (P1a) + extended runtimeConfigInput schema. $0 planner
 * text — not a spend gate. Mirrors SettingsAdmin's card + {ok|error} pattern.
 *
 * Scope note (per the plan): this ships the EDIT + persist + read-back surface.
 * Re-threading these DB values back into buildPlannerMessages is a money-neutral
 * $0 follow-on, explicitly DEFERRED — persistence + read-back only for now.
 */
import { useState } from "react";
import { Button } from "@/components/ds";
import { saveRuntimeConfig } from "@/lib/admin-actions";

function TextCard({ title, hint, value, configKey }: { title: string; hint: string; value: string; configKey: "planner_system" | "brief_default" | "description_template" }) {
  const [text, setText] = useState(value);
  const [base, setBase] = useState(value);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = text !== base;

  async function save() {
    if (saving) return;
    setSaving(true); setMsg(null);
    let res: Awaited<ReturnType<typeof saveRuntimeConfig>> | null = null;
    try { res = await saveRuntimeConfig({ key: configKey, value: { text } }); } catch { res = null; }
    setSaving(false);
    if (!res) { setMsg({ ok: false, text: "Save failed." }); return; }
    if ("error" in res) { setMsg({ ok: false, text: res.error }); return; }
    setBase(text);
    setMsg({ ok: true, text: "Saved." });
  }

  return (
    <section style={{ display: "grid", gap: 10, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)" }}>
      <h2 style={{ font: "var(--text-title)", color: "var(--foreground)", margin: 0 }}>{title}</h2>
      <p style={{ font: "var(--text-caption)", color: "var(--muted-foreground)", margin: 0 }}>{hint}</p>
      <textarea
        value={text} onChange={(e) => setText(e.target.value)} rows={configKey === "planner_system" ? 12 : 5}
        style={{ font: "var(--text-body)", color: "var(--foreground)", background: "var(--muted)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", resize: "vertical" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {msg && <span style={{ font: "var(--text-caption)", color: msg.ok ? "#3fb950" : "#e5484d" }}>{msg.text}</span>}
        <div style={{ marginLeft: "auto" }}>
          <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      </div>
    </section>
  );
}

export function KnowledgeAdmin({ plannerSystem, briefDefault, descriptionTemplate }: { plannerSystem: string; briefDefault: string; descriptionTemplate: string; codeDefaultPlanner: string }) {
  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--foreground)", margin: 0 }}>Knowledge</h1>
        <p style={{ font: "var(--text-body)", color: "var(--muted-foreground)", margin: 0 }}>Planner system prompt + project-brief default + reference-description template. $0 text — not a spend control. Saved here for now; wiring back into the live planner is a deferred $0 follow-on.</p>
      </header>
      <TextCard configKey="planner_system" title="Planner system prompt" hint="The creative-director agent's system prompt. Empty/unset → the code default." value={plannerSystem} />
      <TextCard configKey="brief_default" title="Project-brief default" hint="Seed text for a new project's brief." value={briefDefault} />
      <TextCard configKey="description_template" title="Reference-description template" hint="The see-once visual-description shape the planner caches per @ref." value={descriptionTemplate} />
    </main>
  );
}
