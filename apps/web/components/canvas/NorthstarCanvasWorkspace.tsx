"use client";

import type { EntityDTO } from "@/lib/types";
import { R22CanvasSurface } from "./R22CanvasSurface";

export type ImmersiveCanvasRuntimeContext = {
  projects: Array<{ id: string; name: string }>;
  threads: Array<{
    id: string;
    projectId: string;
    title: string;
    updatedAt: string;
    pinnedAt: string | null;
  }>;
  activeProjectId: string;
  activeThreadId: string | null;
  initialBalance: number | null;
  initialPrompt?: string;
  visualFixture?: "r22" | null;
  fixtureRouteState?: "ready" | "loading" | "error" | "permission" | "missing" | "unknown";
  fixtureSendOutcome?: "success" | "error" | "permission" | "credits" | "unknown";
};

export function NorthstarCanvasWorkspace({
  runtimeContext,
  entities = [],
}: {
  runtimeContext: ImmersiveCanvasRuntimeContext;
  entities?: EntityDTO[];
}) {
  return <R22CanvasSurface runtimeContext={runtimeContext} entities={entities} />;
}

export default NorthstarCanvasWorkspace;
