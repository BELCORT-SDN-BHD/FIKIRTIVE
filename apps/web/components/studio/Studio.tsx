"use client";
/**
 * Studio prototype root (redesign-shell branch). Holds the active-surface
 * state and renders the shell + the active surface. Mock-first — surfaces 2-6
 * are placeholders until built; engine wiring comes after the shell is signed
 * off.
 */
import { useState } from "react";
import { StudioShell, type StudioView } from "./StudioShell";
import { GenSpace } from "./GenSpace";

function Placeholder({ label }: { label: string }) {
  return (
    <div className="screen">
      <div className="screen-pad" style={{ display: "grid", placeItems: "center", minHeight: "60vh", textAlign: "center" }}>
        <div>
          <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>{label}</h1>
          <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: "8px 0 0" }}>
            Surface coming next in the shell build.
          </p>
        </div>
      </div>
    </div>
  );
}

export function Studio() {
  const [view, setView] = useState<StudioView>("genspace");
  return (
    <StudioShell view={view} onNavigate={setView}>
      {view === "genspace" ? <GenSpace /> : <Placeholder label={view[0].toUpperCase() + view.slice(1)} />}
    </StudioShell>
  );
}
