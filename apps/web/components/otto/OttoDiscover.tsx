"use client";
import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { INSPIRATIONS, inspirationCategories, type Inspiration } from "@/lib/inspirations";

export default function OttoDiscover({ onUseInOtto }: { onUseInOtto: (prompt: string) => void }) {
  const [cat, setCat] = useState<string>("All");
  const [active, setActive] = useState<Inspiration | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const cats = ["All", ...inspirationCategories(INSPIRATIONS)];
  const shown = cat === "All" ? INSPIRATIONS : INSPIRATIONS.filter((i) => i.category === cat);

  async function copy(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; ignore (Copy is best-effort)
    }
  }

  return (
    // gb: .gb resolves brand/accent/muted tokens for the Grok-bright skin;
    // leading-[1.65] pins the inherited line-height so S4 teardown won't reflow.
    <div className="gb leading-[1.65]" style={{ flex: 1, overflow: "auto", padding: "20px" }}>
      <div style={{ marginBottom: "16px" }}>
        <h2 style={{ margin: 0, fontSize: "1.125rem", color: "var(--text-body)" }}>Discover</h2>
        <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: "0.875rem" }}>
          Ideas to start from — pick one, tweak it, make it yours.
        </p>
      </div>

      <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
        {cats.map((c) => (
          <Button
            key={c}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCat(c)}
            className={cat === c ? "bg-card" : ""}
          >
            {c}
          </Button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px" }}>
        {shown.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => setActive(i)}
            style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "16px", color: "var(--text-body)" }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{i.category}</div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 600, marginTop: 2 }}>{i.title}</div>
            <div style={{ fontSize: "0.8125rem", color: "var(--text-muted)", marginTop: "4px" }}>{i.description}</div>
          </button>
        ))}
      </div>

      {active && (
        <Dialog open onOpenChange={(open) => { if (!open) setActive(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{active.title}</DialogTitle>
              <DialogDescription>{active.category}</DialogDescription>
            </DialogHeader>
            <p style={{ color: "var(--text-body)", fontSize: "0.875rem", marginTop: 0 }}>{active.description}</p>
            <div style={{ background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "12px", fontSize: "0.8125rem", color: "var(--text-body)", whiteSpace: "pre-wrap" }}>{active.prompt}</div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.75rem", marginTop: "8px" }}>Tip: replace [your product] with your product name.</p>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => copy(active.prompt)}>{copied ? "Copied" : "Copy prompt"}</Button>
              <Button variant="brand" size="sm" onClick={() => { onUseInOtto(active.prompt); setActive(null); }}>Use in Otto</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
