"use client";
/**
 * Elements surface — WIRED. Renders the real, fully-engined Library (entity
 * CRUD, reference upload, fal-backed guided generation) inside the Studio
 * shell. The mock cards are gone; this is live data.
 */
import { Library } from "@/components/Library";
import type { EntityDTO } from "@/lib/types";

export function Elements({ entities, projectId }: { entities: EntityDTO[]; projectId: string }) {
  return (
    <div className="flex flex-1 min-h-0">
      <Library entities={entities} initialSelectedId={null} routeSync={false} projectId={projectId} />
    </div>
  );
}
