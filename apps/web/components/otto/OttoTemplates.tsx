"use client";
import React, { useState } from "react";
import type { EntityDTO } from "@/lib/types";
import { TEMPLATES, type Template } from "@/lib/templates";
import TemplateModal from "./TemplateModal";

export default function OttoTemplates({ projectId, entities = [] }: { projectId: string; entities?: EntityDTO[] }) {
  const [active, setActive] = useState<Template | null>(null);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", padding: "var(--space-5)" }}>
      <div style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-body)" }}>Templates</h2>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: 14 }}>
          Pick a template, upload your product, get a polished image.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-3)" }}>
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t)}
            style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", color: "var(--text-body)" }}
          >
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t.name}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: "var(--space-1)" }}>{t.description}</div>
          </button>
        ))}
      </div>
      {active && (
        <TemplateModal template={active} projectId={projectId} entities={entities} onClose={() => setActive(null)} />
      )}
    </div>
  );
}
