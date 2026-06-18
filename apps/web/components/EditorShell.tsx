"use client";

import { useState } from "react";
import type { ProjectDTO } from "@/lib/types";
import type { ArtlioEdit } from "@artlio/core";
import { AppShell } from "./AppShell";
import { Editor } from "./Editor";

/** Client wrapper so the editor's dirty state can guard navigation
 *  (codex review: the cut needs the same leave-guard the composer has). */
export function EditorShell({
  project,
  projects,
  boardEdit,
  savedEdit,
  attachedCount,
  editedAt,
}: {
  project: ProjectDTO;
  projects: ProjectDTO[];
  boardEdit: ArtlioEdit | null;
  savedEdit: ArtlioEdit | null;
  attachedCount: number;
  /** Project.updatedAt at load (ISO) — base for optimistic-concurrency saves. */
  editedAt?: string;
}) {
  const [dirty, setDirty] = useState(false);
  const confirmLeave = () =>
    !dirty || confirm("Discard unsaved changes to this cut?");

  return (
    <AppShell
      view="editor"
      title="Editor"
      confirmLeave={confirmLeave}
      project={project}
      projects={projects}
    >
      <div className="flex flex-col flex-1 min-h-0 max-lg:pointer-events-none">
        <Editor
          projectId={project.id}
          boardEdit={boardEdit}
          savedEdit={savedEdit}
          attachedCount={attachedCount}
          editedAt={editedAt}
          onDirtyChange={setDirty}
        />
      </div>
    </AppShell>
  );
}
