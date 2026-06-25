"use client";
import React from "react";
import { ArrowLeft, Wrench } from "lucide-react";
import { Button } from "@/components/fk";

/** The "manual room" — a stub for now. Reached from "Edit by hand" on a result.
 *  The copy sets the expectation that most people never need to come here. */
export function OttoWorkshop({ onBack }: { onBack: () => void }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        background: "var(--bg-page)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-4) var(--space-6)",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
        }}
      >
        <Button variant="ghost" size="sm" leftIcon={<ArrowLeft size={18} />} onClick={onBack}>
          Back to Otto
        </Button>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-semibold)" as React.CSSProperties["fontWeight"], color: "var(--text-strong)" }}>
          Workshop
        </span>
      </div>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-8)" }}>
        <div style={{ maxWidth: 460, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-4)" }}>
          <span style={{ width: 64, height: 64, borderRadius: 20, background: "var(--brand-soft)", color: "var(--on-brand-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Wrench size={28} />
          </span>
          <h2 style={{ fontFamily: "var(--font-display)", fontWeight: "var(--weight-bold)" as React.CSSProperties["fontWeight"], fontSize: "var(--text-xl)", color: "var(--text-strong)", margin: 0 }}>
            The hands-on room
          </h2>
          <p style={{ fontSize: "var(--text-base)", color: "var(--text-muted)", lineHeight: "var(--leading-relaxed)", margin: 0 }}>
            This is where you can tweak things by hand — fonts, layout, the fine details.
            It&rsquo;s coming soon, and honestly? Most people never need it. Otto&rsquo;s got you.
          </p>
          <Button variant="primary" size="md" onClick={onBack}>
            Take me back to Otto
          </Button>
        </div>
      </div>
    </div>
  );
}

export default OttoWorkshop;
