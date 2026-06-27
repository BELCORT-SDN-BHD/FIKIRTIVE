"use client";
import { useCallback, useRef } from "react";
import { startGen, getGenJob } from "../../lib/gen-actions";
import { createCanvasNode } from "../../lib/canvas-actions";
import { activeImageModel, activeVideoModel } from "@fikirtive/core";

type Pos = { x: number; y: number; w: number; h: number };
type OnNode = (node: { id: string; type: "image" | "video"; pos: Pos; status: string; url?: string; prompt: string; sourceNodeId?: string }) => void;

async function poll(
  jobId: string,
  onUrl: (url: string | null, status: string, generationId?: string) => void,
  cancelledRef: React.MutableRefObject<boolean>,
) {
  for (let i = 0; i < 48; i++) {
    if (cancelledRef.current) return;
    const job = await getGenJob(jobId);
    if (!job) return;
    if (job.status === "DONE") return onUrl(job.urls[0] ?? null, "done", job.generationIds?.[0]);
    if (job.status === "FAILED") return onUrl(null, "failed", undefined);
    await new Promise((r) => setTimeout(r, 2500));
  }
  onUrl(null, "failed", undefined);
}

export function useCanvasGen(
  projectId: string,
  onNode: OnNode,
  onResolve: (nodeId: string, url: string | null, status: string, generationId?: string) => void,
) {
  const cancelledRef = useRef(false);

  const generateImage = useCallback(async (prompt: string, pos: Pos) => {
    const req = { projectId, prompt, count: 1, kind: "image" as const, model: activeImageModel(), idempotencyKey: `img-${Date.now()}` };
    const started = await startGen(req);
    if ("error" in started) return;
    const created = await createCanvasNode({ projectId, type: "image", ...pos, prompt, genJobId: started.id, status: "pending" });
    if ("error" in created) return;
    onNode({ id: created.id, type: "image", pos, status: "pending", prompt });
    poll(started.id, (url, status, generationId) => onResolve(created.id, url, status, generationId), cancelledRef);
  }, [projectId, onNode, onResolve]);

  const animate = useCallback(async (sourceGenerationId: string, sourceNodeId: string, prompt: string, pos: Pos) => {
    const req = { projectId, prompt, count: 1, kind: "video" as const, model: activeVideoModel(), sourceGenerationId, idempotencyKey: `vid-${Date.now()}` };
    const started = await startGen(req);
    if ("error" in started) return;
    const created = await createCanvasNode({ projectId, type: "video", ...pos, prompt, genJobId: started.id, status: "pending", sourceNodeId });
    if ("error" in created) return;
    onNode({ id: created.id, type: "video", pos, status: "pending", prompt, sourceNodeId });
    poll(started.id, (url, status) => onResolve(created.id, url, status), cancelledRef);
  }, [projectId, onNode, onResolve]);

  return { generateImage, animate, cancelledRef };
}
