"use client";
/**
 * Studio prototype root (redesign-shell). Threads real data to the wired
 * surfaces (Elements, Gen space, Storyboard, Video editor, Assets); Canvas is
 * the only mock surface.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EntityDTO, ProjectDTO } from "@/lib/types";
import type { FikirtiveEdit, ModelDirectiveRules } from "@fikirtive/core";
import { StudioShell, type StudioView } from "./StudioShell";
import { GenSpace } from "./GenSpace";
import { Canvas } from "./Canvas";
import { Storyboard, type StudioShot } from "./Storyboard";
import { VideoEditorSurface } from "./VideoEditor";
import { Elements } from "./Elements";
import { Assets, type MediaItem, type ShotOption } from "./Assets";
import { Cowork } from "./Cowork";
import { Account } from "./Account";
import type { ChatThreadDTO } from "@/lib/types";

export function Studio({
  project,
  projects,
  user,
  entities,
  shots,
  media,
  mediaCursor,
  mediaHasMore,
  frameCandidates,
  shotOptions,
  boardEdit,
  savedEdit,
  attachedCount,
  editedAt,
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
  mediaCursor: string | null;
  mediaHasMore: boolean;
  frameCandidates: { id: string; src: string }[];
  shotOptions: ShotOption[];
  boardEdit: FikirtiveEdit | null;
  savedEdit: FikirtiveEdit | null;
  attachedCount: number;
  /** Project.updatedAt at load (ISO) — base for the editor's optimistic-concurrency saves (D1). */
  editedAt?: string;
  rulesMap: Record<string, Record<string, ModelDirectiveRules>>;
  threads?: ChatThreadDTO[];
  initialView?: StudioView;
}) {
  const router = useRouter();
  const [view, setView] = useState<StudioView>(initialView ?? "genspace");
  // the route is the single source of truth: a soft router.push(?view=X) (project
  // switch, Add-to-editor) re-runs the page and passes a new initialView prop, so
  // follow it to actually switch the surface (a useState initializer never re-runs).
  // Sync during render (React's prop-change pattern) rather than in an effect.
  const [prevInitialView, setPrevInitialView] = useState(initialView);
  if (initialView !== prevInitialView) {
    setPrevInitialView(initialView);
    setView(initialView ?? "genspace");
  }
  // the editor tab reports its unsaved-cut state up so nav/project-switch can guard it
  const [editorDirty, setEditorDirty] = useState(false);
  const confirmLeave = () => !editorDirty || confirm("Discard unsaved changes to this cut?");
  // nav clicks flip local view AND keep the URL truthful (preserving the active
  // project) so deep-links/refresh land on the same surface — same pattern as switchProject
  function navigate(v: StudioView) {
    setView(v);
    router.replace(`/studio?p=${project.id}&view=${v}`);
  }

  function surface() {
    switch (view) {
      case "genspace": return <GenSpace projectId={project.id} entities={entities} rulesMap={rulesMap} onGoToElements={() => navigate("elements")} />;
      case "canvas": return <Canvas />;
      case "storyboard": return <Storyboard projectId={project.id} shots={shots} entities={entities} candidates={frameCandidates} />;
      case "editor": return <VideoEditorSurface key={project.id} projectId={project.id} boardEdit={boardEdit} savedEdit={savedEdit} attachedCount={attachedCount} editedAt={editedAt} onDirtyChange={setEditorDirty} />;
      case "elements": return <Elements entities={entities} projectId={project.id} />;
      case "assets": return <Assets projectId={project.id} media={media} mediaCursor={mediaCursor} mediaHasMore={mediaHasMore} shotOptions={shotOptions} />;
      case "cowork": return <Cowork key={project.id} projectId={project.id} entities={entities} threads={threads ?? []} brief={project.coworkBrief ?? ""} />;
      case "account": return <Account />;
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
    <StudioShell view={view} onNavigate={navigate} confirmLeave={confirmLeave} project={project} projects={projects} user={user}>
      {surface()}
    </StudioShell>
  );
}
