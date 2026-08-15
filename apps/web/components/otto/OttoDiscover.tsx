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
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const cats = ["All", ...inspirationCategories(INSPIRATIONS)];
  const shown = cat === "All" ? INSPIRATIONS : INSPIRATIONS.filter((i) => i.category === cat);

  async function copy(prompt: string) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(prompt);
      ok = true;
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = prompt;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        ok = document.execCommand("copy");
        textarea.remove();
      } catch {
        ok = false;
      }
    }
    setCopyStatus(ok ? "copied" : "failed");
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus("idle"), 1500);
  }

  return (
    // gb: .gb resolves brand/accent/muted tokens for the Grok-bright skin;
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    // padding-top 64px (not 20px) — clears the floating "show sidebar" toggle
    // (OttoApp.tsx: `absolute left-3 top-3 size-[34px]`, footprint to 46px) that
    // otherwise sits on top of this pane and ate the "Dis" of "Discover" (#949 A1).
    <div className="gb leading-[1.5]" style={{ flex: 1, overflow: "auto", padding: "64px 20px 20px" }}>
      <div style={{ marginBottom: "16px" }}>
        <h2 style={{ margin: 0, fontSize: "1.125rem", color: "var(--foreground)" }}>Discover</h2>
        <p style={{ margin: "4px 0 0", color: "var(--muted-foreground)", fontSize: "0.875rem" }}>
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
            style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border)", background: "var(--card)", borderRadius: "14px", padding: "16px", color: "var(--foreground)" }}
          >
            <div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.4 }}>{i.category}</div>
            <div style={{ fontSize: "0.9375rem", fontWeight: 600, marginTop: 2 }}>{i.title}</div>
            <div style={{ fontSize: "0.8125rem", color: "var(--muted-foreground)", marginTop: "4px" }}>{i.description}</div>
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
            <p style={{ color: "var(--foreground)", fontSize: "0.875rem", marginTop: 0 }}>{active.description}</p>
            <div style={{ background: "var(--card)", borderRadius: "14px", padding: "12px", fontSize: "0.8125rem", color: "var(--foreground)", whiteSpace: "pre-wrap" }}>{active.prompt}</div>
            <p style={{ color: "var(--muted-foreground)", fontSize: "0.75rem", marginTop: "8px" }}>Tip: replace [your product] with your product name.</p>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => copy(active.prompt)}>
                {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy prompt"}
              </Button>
              <Button variant="brand" size="sm" onClick={() => { onUseInOtto(active.prompt); setActive(null); }}>Use in Otto</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
