"use client";
/**
 * Video editor surface — WIRED. Renders the existing Shotstack-based Editor
 * (real timeline + ffmpeg-worker render + MP4 export) inside the Studio shell,
 * fed the boardEdit/savedEdit built server-side from the storyboard's shots.
 * The connective tissue: shots generate → their renders become the cut here.
 */
import { Editor } from "@/components/Editor";
import type { ArtlioEdit } from "@artlio/core";

export function VideoEditorSurface({
  projectId,
  boardEdit,
  savedEdit,
  attachedCount,
}: {
  projectId: string;
  boardEdit: ArtlioEdit | null;
  savedEdit: ArtlioEdit | null;
  attachedCount: number;
}) {
  return (
    <Editor
      projectId={projectId}
      boardEdit={boardEdit}
      savedEdit={savedEdit}
      attachedCount={attachedCount}
      onDirtyChange={() => {}}
    />
  );
}
