"use client";
/**
 * Studio prototype root (redesign-shell branch). Holds the active-surface
 * state and renders the shell + the active surface. Mock-first — engine wiring
 * comes after the shell is signed off.
 */
import { useState } from "react";
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

const SURFACES: Record<StudioView, React.ReactNode> = {
  genspace: <GenSpace />,
  canvas: <Canvas />,
  storyboard: <Storyboard />,
  editor: <VideoEditor />,
  elements: <Elements />,
  assets: <Assets />,
  plans: <Placeholder label="Plans" />,
  account: <Placeholder label="Account" />,
};

export function Studio() {
  const [view, setView] = useState<StudioView>("genspace");
  return (
    <StudioShell view={view} onNavigate={setView}>
      {SURFACES[view]}
    </StudioShell>
  );
}
