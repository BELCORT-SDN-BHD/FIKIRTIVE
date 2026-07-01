"use client";
import React, { useState } from "react";
import type { EntityDTO } from "@/lib/types";
import { TEMPLATES, type Template } from "@/lib/templates";
import TemplateModal from "./TemplateModal";

export default function OttoTemplates({ projectId, entities = [] }: { projectId: string; entities?: EntityDTO[] }) {
  const [active, setActive] = useState<Template | null>(null);
  // .gb resolves brand/surface/text tokens; leading-[1.65] pins the inherited
  // line-height so S4 teardown of --leading-relaxed can remove it safely.
  return (
    <div className="gb leading-[1.65]" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", padding: "1.25rem" }}>
      <div style={{ marginBottom: "1rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.125rem", color: "var(--foreground)" }}>Templates</h2>
        <p style={{ margin: "0.25rem 0 0", color: "var(--muted-foreground)", fontSize: "0.875rem" }}>
          Pick a template, upload your product, get a polished image.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t)}
            style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)", background: "var(--card)", borderRadius: "14px", padding: "1rem", color: "var(--foreground)" }}
          >
            <div style={{ fontSize: "0.9375rem", fontWeight: 600 }}>{t.name}</div>
            <div style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)", marginTop: "0.25rem" }}>{t.description}</div>
          </button>
        ))}
      </div>
      {active && (
        <TemplateModal template={active} projectId={projectId} entities={entities} onClose={() => setActive(null)} />
      )}
    </div>
  );
}
