"use client";
/**
 * Studio prototype root (redesign-shell branch). Holds the active-surface
 * state and renders the shell + the active surface. Elements is now wired to
 * real data (the existing Library engine); the rest are mock until wired.
 */
import { useState } from "react";
import type { EntityDTO } from "@/lib/types";
import { StudioShell, type StudioView } from "./StudioShell";
import { GenSpace } from "./GenSpace";
import { Canvas } from "./Canvas";
import { Storyboard } from "./Storyboard";
import { VideoEditor } from "./VideoEditor";
import { Elements } from "./Elements";
import { Assets } from "./Assets";

function Placeholder({ label }: { label: string }) {
  return (
    <div className="screen">
      <div className="screen-pad" style={{ display: "grid", placeItems: "center", minHeight: "60vh", textAlign: "center" }}>
        <div>
          <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>{label}</h1>
          <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: "8px 0 0" }}>Coming soon.</p>
        </div>
      </div>
    </div>
  );
}

export function Studio({ entities, projectId }: { entities: EntityDTO[]; projectId: string | null }) {
  const [view, setView] = useState<StudioView>("genspace");

  function surface() {
    switch (view) {
      case "genspace": return <GenSpace projectId={projectId} />;
      case "canvas": return <Canvas />;
      case "storyboard": return <Storyboard />;
      case "editor": return <VideoEditor />;
      case "elements": return <Elements entities={entities} />;
      case "assets": return <Assets />;
      default: return <Placeholder label={view[0].toUpperCase() + view.slice(1)} />;
    }
  }

  return (
    <StudioShell view={view} onNavigate={setView}>
      {surface()}
    </StudioShell>
  );
}
