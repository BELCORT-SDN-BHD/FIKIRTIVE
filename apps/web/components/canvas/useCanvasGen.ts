"use client";
import { useCallback, useRef } from "react";
import { startGen, getGenJob, getActiveGenModels } from "../../lib/gen-actions";
import { createCanvasNode } from "../../lib/canvas-actions";

type Pos = { x: number; y: number; w: number; h: number };
type OnNode = (node: { id: string; type: "image" | "video"; pos: Pos; status: string; url?: string; prompt: string; sourceNodeId?: string }) => void;

/** Phase 2: how many image variants a single canvas generation produces. Must be
 *  ≤ MAX_GEN_COUNT (4) — the gate rejects more, and the charge scales by count. */
const IMAGE_VARIANT_COUNT = 4;

/** createCanvasNode with a small retry. By the time we place a paid GenJob's card,
 *  startGen has already reserved/queued it — so a transient node-create failure must
 *  not silently drop the card, or the owner sees nothing, clicks "Make it" again, and
 *  mints a fresh idempotencyKey → a second paid job. Retries the owner-scoped insert;
 *  if it still fails the paid output is not lost (it lands in the library) — we log. */
export async function createNodeWithRetry(
  args: Parameters<typeof createCanvasNode>[0],
  attempts = 3,
): Promise<Awaited<ReturnType<typeof createCanvasNode>>> {
  let last: Awaited<ReturnType<typeof createCanvasNode>> = { error: "not attempted" };
  for (let i = 0; i < attempts; i++) {
    // A network blip on the server action REJECTS (throws) — the real transient failure
    // class — rather than returning {error}. Catch it so the retry loop covers throws too,
    // and an exhausted throw becomes an {error} the caller can surface (never an escape).
    try {
      last = await createCanvasNode(args);
      if ("id" in last) return last;
    } catch (e) {
      last = { error: e instanceof Error ? e.message : "node create threw" };
    }
    await new Promise((r) => setTimeout(r, 300 * (i + 1)));
  }
  console.warn("[canvas] createCanvasNode failed after retries — a paid job's card is missing (output still in the library):", last);
  return last;
}

export async function poll(
  jobId: string,
  onDone: (urls: string[], status: string, generationIds: string[]) => void,
  cancelledRef: React.MutableRefObject<boolean>,
  opts: { intervalMs?: number; maxPolls?: number } = {},
) {
  const intervalMs = opts.intervalMs ?? 2500;
  // ~8 min at 2.5s. Video gens can legitimately exceed 2 min (the old 48-iteration/~2-min cap
  // spuriously reported "failed"); the worker settles late ones regardless of the client poll.
  const maxPolls = opts.maxPolls ?? 192;
  for (let i = 0; i < maxPolls; i++) {
    if (cancelledRef.current) return;
    const job = await getGenJob(jobId);
    if (!job) return;
    if (job.status === "DONE") return onDone(job.urls, "done", job.generationIds ?? []);
    if (job.status === "FAILED") return onDone([], "failed", []);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Client-side give-up ≠ failure: the worker may still finish and settle. Report a distinct
  // "timeout" so the card shows "still working — check back" instead of a hard "failed".
  onDone([], "timeout", []);
}

export function useCanvasGen(
  projectId: string,
  onNode: OnNode,
  onResolve: (nodeId: string, url: string | null, status: string, generationId?: string) => void,
  activeThreadId?: string | null,
  onError?: (msg: string) => void,
) {
  const cancelledRef = useRef(false);
  // F18: resolve the active models SERVER-side (the client can't — the env isn't bundled, so
  // activeVideoModel() in the browser always returns the wrong default). Cache after first fetch;
  // await before every spend so the gen request carries the real model the server gate expects.
  const modelsRef = useRef<{ image: string; video: string } | null>(null);
  const ensureModels = async () => {
    if (!modelsRef.current) modelsRef.current = await getActiveGenModels();
    return modelsRef.current;
  };
  // A paid-gen kickoff that fails before any card is placed (out of credits, model disabled,
  // guardian block, or a node-create that never recovered) must tell the user — otherwise they
  // see nothing, assume the app broke, and re-click, minting a fresh idempotencyKey → a real
  // second charge attempt (F19/F20).
  const fail = (msg: string) => onError?.(msg || "That didn't go through — please try again.");

  const generateImage = useCallback(async (prompt: string, pos: Pos, entityIds: string[] = [], variantSel: Record<string, string> = {}) => {
    const vsel = Object.keys(variantSel).length ? variantSel : undefined;
    // Phase 2: request 4 variants in one job. count is a priced/gated/capped
    // parameter (MAX_GEN_COUNT=4) and the charge scales by it — this is the ONLY
    // spend change. The owner keeps one card and deletes the rest; all 4 stay in
    // the library. Sibling cards below are pure placement (no extra spend).
    const { image } = await ensureModels();
    const req = { projectId, prompt, count: IMAGE_VARIANT_COUNT, kind: "image" as const, model: image, entityIds, ...(vsel && { variantSel: vsel }), idempotencyKey: `img-${Date.now()}` };
    const started = await startGen(req);
    if ("error" in started) { fail(started.error); return; }
    const created = await createNodeWithRetry({ projectId, type: "image", ...pos, prompt, genJobId: started.id, status: "pending", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
    if ("error" in created) { fail("Your image is generating — the card didn't appear, but you can find it in your library."); return; }
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
  }, [projectId, onNode, onResolve, activeThreadId, onError]);

  const animate = useCallback(async (sourceGenerationId: string, sourceNodeId: string, prompt: string, pos: Pos) => {
    const { video } = await ensureModels();
    const req = { projectId, prompt, count: 1, kind: "video" as const, model: video, sourceGenerationId, idempotencyKey: `vid-${Date.now()}` };
    const started = await startGen(req);
    if ("error" in started) { fail(started.error); return; }
    const created = await createNodeWithRetry({ projectId, type: "video", ...pos, prompt, genJobId: started.id, status: "pending", sourceNodeId, ...(activeThreadId ? { threadId: activeThreadId } : {}) });
    if ("error" in created) { fail("Your video is generating — the card didn't appear, but you can find it in your library."); return; }
    onNode({ id: created.id, type: "video", pos, status: "pending", prompt, sourceNodeId });
    poll(started.id, (urls, status, generationIds) => onResolve(created.id, urls[0] ?? null, status, generationIds[0]), cancelledRef);
  }, [projectId, onNode, onResolve, activeThreadId, onError]);

  // Phase 3: text-to-video. The same paid video path as animate(), minus the
  // source frame — the gate allows video without sourceGenerationId (it's the
  // Gen-space path) and the provider uses the model's t2v endpoint. Video is
  // always count=1 (startGen forces it). New spend entry, existing spend logic.
  const generateVideoFromText = useCallback(async (prompt: string, pos: Pos) => {
    const { video } = await ensureModels();
    const req = { projectId, prompt, count: 1, kind: "video" as const, model: video, idempotencyKey: `vid-${Date.now()}` };
    const started = await startGen(req);
    if ("error" in started) { fail(started.error); return; }
    const created = await createNodeWithRetry({ projectId, type: "video", ...pos, prompt, genJobId: started.id, status: "pending", ...(activeThreadId ? { threadId: activeThreadId } : {}) });
    if ("error" in created) { fail("Your video is generating — the card didn't appear, but you can find it in your library."); return; }
    onNode({ id: created.id, type: "video", pos, status: "pending", prompt });
    poll(started.id, (urls, status, generationIds) => onResolve(created.id, urls[0] ?? null, status, generationIds[0]), cancelledRef);
  }, [projectId, onNode, onResolve, activeThreadId, onError]);

  return { generateImage, animate, generateVideoFromText, cancelledRef };
}
