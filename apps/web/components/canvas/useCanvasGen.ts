"use client";
import { useCallback, useRef } from "react";
import { startGen, getGenJob } from "../../lib/gen-actions";
import { createCanvasNode } from "../../lib/canvas-actions";
import { activeImageModel, activeVideoModel } from "@fikirtive/core";

type Pos = { x: number; y: number; w: number; h: number };
type OnNode = (node: { id: string; type: "image" | "video"; pos: Pos; status: string; url?: string; prompt: string; sourceNodeId?: string }) => void;

/** Phase 2: how many image variants a single canvas generation produces. Must be
 *  ≤ MAX_GEN_COUNT (4) — the gate rejects more, and the charge scales by count. */
const IMAGE_VARIANT_COUNT = 4;

async function poll(
  jobId: string,
  onDone: (urls: string[], status: string, generationIds: string[]) => void,
  cancelledRef: React.MutableRefObject<boolean>,
) {
  for (let i = 0; i < 48; i++) {
    if (cancelledRef.current) return;
    const job = await getGenJob(jobId);
    if (!job) return;
    if (job.status === "DONE") return onDone(job.urls, "done", job.generationIds ?? []);
    if (job.status === "FAILED") return onDone([], "failed", []);
    await new Promise((r) => setTimeout(r, 2500));
  }
  onDone([], "failed", []);
}

export function useCanvasGen(
  projectId: string,
  onNode: OnNode,
  onResolve: (nodeId: string, url: string | null, status: string, generationId?: string) => void,
  activeThreadId?: string | null,
) {
  const cancelledRef = useRef(false);

  const generateImage = useCallback(async (prompt: string, pos: Pos, entityIds: string[] = [], variantSel: Record<string, string> = {}) => {
    const vsel = Object.keys(variantSel).length ? variantSel : undefined;
    // Phase 2: request 4 variants in one job. count is a priced/gated/capped
    // parameter (MAX_GEN_COUNT=4) and the charge scales by it — this is the ONLY
    // spend change. The owner keeps one card and deletes the rest; all 4 stay in
    // the library. Sibling cards below are pure placement (no extra spend).
    const req = { projectId, prompt, count: IMAGE_VARIANT_COUNT, kind: "image" as const, model: activeImageModel(), entityIds, ...(vsel && { variantSel: vsel }), idempotencyKey: `img-${Date.now()}` };
    const started = await startGen(req);
    if ("error" in started) return;
    const created = await createCanvasNode({ projectId, type: "image", ...pos, prompt, genJobId: started.id, status: "pending", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
    if ("error" in created) return;
    onNode({ id: created.id, type: "image", pos, status: "pending", prompt });
    poll(started.id, async (urls, status, generationIds) => {
      if (status !== "done" || urls.length === 0) { onResolve(created.id, null, status); return; }
      // primary card → first variant
      onResolve(created.id, urls[0], "done", generationIds[0]);
      // one sibling card per remaining variant, laid out in a 2×2 cluster. Each
      // is a plain canvas-node placement of an already-generated (already-charged)
      // Generation — createCanvasNode is not a spend path.
      for (let i = 1; i < urls.length; i++) {
        const sx = pos.x + (i % 2) * (pos.w + 20);
        const sy = pos.y + Math.floor(i / 2) * (pos.h + 20);
        const sib = await createCanvasNode({ projectId, type: "image", x: sx, y: sy, w: pos.w, h: pos.h, prompt, generationId: generationIds[i], status: "done", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
        if ("error" in sib) continue;
        onNode({ id: sib.id, type: "image", pos: { x: sx, y: sy, w: pos.w, h: pos.h }, status: "pending", prompt });
        onResolve(sib.id, urls[i], "done", generationIds[i]);
      }
    }, cancelledRef);
  }, [projectId, onNode, onResolve, activeThreadId]);

  const animate = useCallback(async (sourceGenerationId: string, sourceNodeId: string, prompt: string, pos: Pos) => {
    const req = { projectId, prompt, count: 1, kind: "video" as const, model: activeVideoModel(), sourceGenerationId, idempotencyKey: `vid-${Date.now()}` };
    const started = await startGen(req);
    if ("error" in started) return;
    const created = await createCanvasNode({ projectId, type: "video", ...pos, prompt, genJobId: started.id, status: "pending", sourceNodeId, ...(activeThreadId ? { threadId: activeThreadId } : {}) });
    if ("error" in created) return;
    onNode({ id: created.id, type: "video", pos, status: "pending", prompt, sourceNodeId });
    poll(started.id, (urls, status, generationIds) => onResolve(created.id, urls[0] ?? null, status, generationIds[0]), cancelledRef);
  }, [projectId, onNode, onResolve, activeThreadId]);

  return { generateImage, animate, cancelledRef };
}
