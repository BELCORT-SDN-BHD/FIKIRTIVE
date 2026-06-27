"use client";
import React, { useState } from "react";
import { Dialog } from "@/components/fk/Dialog";
import { INSPIRATIONS, inspirationCategories, type Inspiration } from "@/lib/inspirations";

export default function OttoDiscover({ onUseInOtto }: { onUseInOtto: (prompt: string) => void }) {
  const [cat, setCat] = useState<string>("All");
  const [active, setActive] = useState<Inspiration | null>(null);
  const [copied, setCopied] = useState(false);

  const cats = ["All", ...inspirationCategories(INSPIRATIONS)];
  const shown = cat === "All" ? INSPIRATIONS : INSPIRATIONS.filter((i) => i.category === cat);

  async function copy(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; ignore (Copy is best-effort)
    }
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--space-5)" }}>
      <div style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-body)" }}>Discover</h2>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: 14 }}>
          Ideas to start from — pick one, tweak it, make it yours.
        </p>
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
        {cats.map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} className="al-btn al-btn-sm" style={{ background: cat === c ? "var(--surface-raised)" : "transparent" }}>
            {c}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--space-3)" }}>
        {shown.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => setActive(i)}
            style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", color: "var(--text-body)" }}
          >
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{i.category}</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{i.title}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: "var(--space-1)" }}>{i.description}</div>
          </button>
        ))}
      </div>

      {active && (
        <Dialog
          open
          onClose={() => setActive(null)}
          title={active.title}
          description={active.category}
          footer={
            <>
              <button type="button" className="al-btn al-btn-sm" onClick={() => copy(active.prompt)}>{copied ? "Copied" : "Copy prompt"}</button>
              <button type="button" className="al-btn al-btn-primary al-btn-sm" onClick={() => { onUseInOtto(active.prompt); setActive(null); }}>Use in Otto</button>
            </>
          }
        >
          <p style={{ color: "var(--text-body)", fontSize: 14, marginTop: 0 }}>{active.description}</p>
          <div style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", fontSize: 13, color: "var(--text-body)", whiteSpace: "pre-wrap" }}>{active.prompt}</div>
          <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: "var(--space-2)" }}>Tip: replace [your product] with your product name.</p>
        </Dialog>
      )}
    </div>
  );
}
