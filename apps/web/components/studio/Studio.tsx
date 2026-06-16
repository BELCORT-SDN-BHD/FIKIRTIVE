"use client";
/**
 * Studio prototype root (redesign-shell). Threads real data to the wired
 * surfaces (Elements, Gen space, Storyboard, Video editor, Assets); Canvas is
 * the only mock surface.
 */
import { useState } from "react";
import type { EntityDTO, ProjectDTO } from "@/lib/types";
import type { ArtlioEdit, ModelDirectiveRules } from "@artlio/core";
import { StudioShell, type StudioView } from "./StudioShell";
import { GenSpace } from "./GenSpace";
import { Canvas } from "./Canvas";
import { Storyboard, type StudioShot } from "./Storyboard";
import { VideoEditorSurface } from "./VideoEditor";
import { Elements } from "./Elements";
import { Assets, type MediaItem, type ShotOption } from "./Assets";
import { Cowork } from "./Cowork";
import type { ChatThreadDTO } from "@/lib/types";

export function Studio({
  project,
  projects,
  user,
  entities,
  shots,
  media,
  frameCandidates,
  shotOptions,
  boardEdit,
  savedEdit,
  attachedCount,
  rulesMap,
  threads,
  initialView,
}: {
  project: ProjectDTO;
  projects: ProjectDTO[];
  user: { initials: string; label: string };
  entities: EntityDTO[];
  shots: StudioShot[];
  media: MediaItem[];
  frameCandidates: { id: string; src: string }[];
  shotOptions: ShotOption[];
  boardEdit: ArtlioEdit | null;
  savedEdit: ArtlioEdit | null;
  attachedCount: number;
  rulesMap: Record<string, Record<string, ModelDirectiveRules>>;
  threads?: ChatThreadDTO[];
  initialView?: StudioView;
}) {
  const [view, setView] = useState<StudioView>(initialView ?? "genspace");
  // the editor tab reports its unsaved-cut state up so nav/project-switch can guard it
  const [editorDirty, setEditorDirty] = useState(false);
  const confirmLeave = () => !editorDirty || confirm("Discard unsaved changes to this cut?");

  function surface() {
    switch (view) {
      case "genspace": return <GenSpace projectId={project.id} entities={entities} rulesMap={rulesMap} onGoToElements={() => setView("elements")} />;
      case "canvas": return <Canvas />;
      case "storyboard": return <Storyboard projectId={project.id} shots={shots} entities={entities} candidates={frameCandidates} />;
      case "editor": return <VideoEditorSurface projectId={project.id} boardEdit={boardEdit} savedEdit={savedEdit} attachedCount={attachedCount} onDirtyChange={setEditorDirty} />;
      case "elements": return <Elements entities={entities} projectId={project.id} />;
      case "assets": return <Assets media={media} shotOptions={shotOptions} />;
      case "cowork": return <Cowork key={project.id} projectId={project.id} entities={entities} threads={threads ?? []} brief={project.coworkBrief ?? ""} />;
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
    <StudioShell view={view} onNavigate={setView} confirmLeave={confirmLeave} project={project} projects={projects} user={user}>
      {surface()}
    </StudioShell>
  );
}
