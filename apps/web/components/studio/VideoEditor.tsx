"use client";
/**
 * Video editor surface — WIRED. Renders the existing Shotstack-based Editor
 * (real timeline + ffmpeg-worker render + MP4 export) inside the Studio shell,
 * fed the boardEdit/savedEdit built server-side from the storyboard's shots +
 * loose Gen-space clips. Reports its dirty state up so Studio can guard
 * navigation, and is read-only on small screens (same as the /editor route).
 */
import { Editor } from "@/components/Editor";
import type { ArtlioEdit } from "@artlio/core";

export function VideoEditorSurface({
  projectId,
  boardEdit,
  savedEdit,
  attachedCount,
  onDirtyChange,
}: {
  projectId: string;
  boardEdit: ArtlioEdit | null;
  savedEdit: ArtlioEdit | null;
  attachedCount: number;
  onDirtyChange: (dirty: boolean) => void;
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="lg:hidden bg-accent-soft text-ink text-sm px-4 py-2 text-center" role="status">
        The editor works best on desktop — this view is read-only on small screens.
      </div>
      <div className="flex flex-col flex-1 min-h-0 max-lg:pointer-events-none">
        <Editor
          projectId={projectId}
          boardEdit={boardEdit}
          savedEdit={savedEdit}
          attachedCount={attachedCount}
          onDirtyChange={onDirtyChange}
        />
      </div>
    </div>
  );
}
