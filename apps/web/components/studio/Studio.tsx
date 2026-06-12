"use client";
/**
 * Studio prototype root (redesign-shell). Threads real data to the wired
 * surfaces (Elements, Gen space, Storyboard, Video editor); Canvas/Assets are
 * still mock.
 */
import { useState } from "react";
import type { EntityDTO, ProjectDTO } from "@/lib/types";
import type { ArtlioEdit } from "@artlio/core";
import { StudioShell, type StudioView } from "./StudioShell";
import { GenSpace } from "./GenSpace";
import { Canvas } from "./Canvas";
import { Storyboard, type StudioShot } from "./Storyboard";
import { VideoEditorSurface } from "./VideoEditor";
import { Elements } from "./Elements";
import { Assets, type MediaItem, type ShotOption } from "./Assets";

export function Studio({
  project,
  projects,
  user,
  entities,
  shots,
  media,
  shotOptions,
  boardEdit,
  savedEdit,
  attachedCount,
}: {
  project: ProjectDTO;
  projects: ProjectDTO[];
  user: { initials: string; label: string };
  entities: EntityDTO[];
  shots: StudioShot[];
  media: MediaItem[];
  shotOptions: ShotOption[];
  boardEdit: ArtlioEdit | null;
  savedEdit: ArtlioEdit | null;
  attachedCount: number;
}) {
  const [view, setView] = useState<StudioView>("genspace");

  function surface() {
    switch (view) {
      case "genspace": return <GenSpace projectId={project.id} />;
      case "canvas": return <Canvas />;
      case "storyboard": return <Storyboard projectId={project.id} shots={shots} />;
      case "editor": return <VideoEditorSurface projectId={project.id} boardEdit={boardEdit} savedEdit={savedEdit} attachedCount={attachedCount} />;
      case "elements": return <Elements entities={entities} />;
      case "assets": return <Assets media={media} shotOptions={shotOptions} />;
      default:
        return (
          <div className="screen"><div className="screen-pad" style={{ display: "grid", placeItems: "center", minHeight: "60vh", textAlign: "center" }}>
            <div><h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>{view[0].toUpperCase() + view.slice(1)}</h1>
            <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: "8px 0 0" }}>Coming soon.</p></div>
          </div></div>
        );
    }
  }

  return (
    <StudioShell view={view} onNavigate={setView} project={project} projects={projects} user={user}>
      {surface()}
    </StudioShell>
  );
}
