"use client";

import { useState } from "react";
import type { EntityDTO, GenerationDTO, ProjectDTO, ShotDTO } from "@/lib/types";
import { TopBar } from "./TopBar";
import { EntitySidebar } from "./EntitySidebar";
import { Composer } from "./Composer";
import { ShotStrip } from "./ShotStrip";
import { CandidatePanel } from "./CandidatePanel";

export function Workbench({
  project,
  projects,
  entities,
  shots,
  candidates,
}: {
  project: ProjectDTO;
  projects: ProjectDTO[];
  entities: EntityDTO[];
  shots: ShotDTO[];
  candidates: GenerationDTO[];
}) {
  const [selectedShotId, setSelectedShotId] = useState<string | null>(
    shots[0]?.id ?? null,
  );
  const selectedShot = shots.find((s) => s.id === selectedShotId) ?? null;

  // switching shots replaces the composer — never silently drop unsaved edits
  const [composerDirty, setComposerDirty] = useState(false);
  function selectShot(id: string) {
    if (
      composerDirty &&
      id !== selectedShotId &&
      !confirm("Discard unsaved prompt changes on the current shot?")
    )
      return;
    setSelectedShotId(id);
  }

  return (
    <div className="flex flex-col h-dvh">
      {/* <1024: phase 1 is desktop-first — read-only notice (design doc D9) */}
      <div
        className="lg:hidden bg-accent-soft text-accent text-sm px-4 py-2 text-center"
        role="status"
      >
        Artlio works best on a desktop browser — this view is read-only.
      </div>

      <TopBar project={project} projects={projects} />

      <div className="flex flex-1 min-h-0 max-lg:pointer-events-none">
        <nav
          aria-label="Entity library"
          className="w-72 shrink-0 border-r border-edge bg-surface overflow-y-auto max-lg:hidden"
        >
          <EntitySidebar entities={entities} />
        </nav>

        <main className="flex-1 min-w-0 flex flex-col overflow-y-auto">
          <Composer
            shot={selectedShot}
            shots={shots}
            entities={entities}
            projectId={project.id}
            onSelectShot={selectShot}
            onDirtyChange={setComposerDirty}
          />
          <ShotStrip
            shots={shots}
            entities={entities}
            projectId={project.id}
            selectedShotId={selectedShotId}
            onSelectShot={selectShot}
          />
        </main>

        <aside
          aria-label="Candidates and history"
          className="w-80 shrink-0 border-l border-edge bg-surface overflow-y-auto max-lg:hidden"
        >
          <CandidatePanel
            candidates={candidates}
            shots={shots}
            entities={entities}
            selectedShot={selectedShot}
            projectId={project.id}
          />
        </aside>
      </div>
    </div>
  );
}
