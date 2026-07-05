// Pure core of the chat→canvas bridge — no DB, no I/O, so it is unit-testable.
// (Kept out of the "use server" action file, whose exports must all be async.)

export type GenResultMsg = {
  seq: number;
  genJobId: string | null;
  payload: unknown;
  text: string | null;
};

export type BridgeNode = {
  generationId: string;
  genJobId: string;
  kind: "image" | "video";
  prompt: string | null;
};

export function canvasNodeDisplayStatus(
  rowStatus: string,
  jobStatus: string | null | undefined,
  url: string | null | undefined,
): string {
  if (url) return "done";
  if (jobStatus === "FAILED") return "failed";
  if (jobStatus === "DONE") return "missing";
  if (jobStatus === "QUEUED" || jobStatus === "GENERATING") return "pending";
  return rowStatus;
}

export function firstDisplayableGenerationId(
  generationIds: readonly string[] | null | undefined,
  thumbs: Record<string, { src?: string | null }>,
): string | null {
  if (!generationIds?.length) return null;
  return generationIds.find((id) => !!thumbs[id]?.src) ?? generationIds[0] ?? null;
}

export type CanvasNodeRepairPatch = {
  status?: string;
  generationId?: string;
};

export type CanvasJobRecoveryNode = {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  prompt: string | null;
  generationId: string | null;
  genJobId: string | null;
  status: string;
  sourceNodeId: string | null;
  threadId: string | null;
};

export type CanvasJobRecoveryJob = {
  id: string;
  status: string;
  generationIds: string[];
};

export type PlannedCanvasJobSiblingNode = {
  type: "image" | "video";
  x: number;
  y: number;
  w: number;
  h: number;
  prompt: string | null;
  generationId: string;
  sourceNodeId: string | null;
  threadId: string | null;
  url: string;
};

export function settledCanvasNodeRepairPatch(
  rowStatus: string,
  rowGenerationId: string | null,
  jobStatus: string | null | undefined,
  resolvedGenerationId: string | null,
  url: string | null | undefined,
): CanvasNodeRepairPatch | null {
  const patch: CanvasNodeRepairPatch = {};
  if (url && resolvedGenerationId) {
    if (rowStatus !== "done") patch.status = "done";
    if (rowGenerationId !== resolvedGenerationId) patch.generationId = resolvedGenerationId;
  } else if (jobStatus === "FAILED" && rowStatus !== "failed") {
    patch.status = "failed";
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * Recover the sibling canvas cards for a settled multi-output job when the
 * browser left before the client poll placed them. Mirrors useCanvasGen's 2x2
 * variant layout and only plans nodes for displayable generations.
 */
export function planSettledCanvasJobSiblingNodes(
  nodes: CanvasJobRecoveryNode[],
  jobById: Map<string, CanvasJobRecoveryJob>,
  thumbs: Record<string, { src?: string | null }>,
  resolvedGenerationIds: Iterable<string | null | undefined>,
): PlannedCanvasJobSiblingNode[] {
  const have = new Set<string>();
  for (const id of resolvedGenerationIds) if (id) have.add(id);

  const planned: PlannedCanvasJobSiblingNode[] = [];
  const seenJobs = new Set<string>();

  for (const node of nodes) {
    if (!node.genJobId || seenJobs.has(node.genJobId)) continue;
    seenJobs.add(node.genJobId);
    const job = jobById.get(node.genJobId);
    if (!job || job.status !== "DONE" || job.generationIds.length <= 1) continue;
    if (node.status === "done" && node.generationId) continue;

    const primaryGenerationId = node.generationId ?? firstDisplayableGenerationId(job.generationIds, thumbs);
    if (primaryGenerationId) have.add(primaryGenerationId);

    for (let i = 0; i < job.generationIds.length; i++) {
      const generationId = job.generationIds[i];
      const url = thumbs[generationId]?.src;
      if (!url || generationId === primaryGenerationId || have.has(generationId)) continue;
      have.add(generationId);
      planned.push({
        type: node.type === "video" ? "video" : "image",
        x: node.x + (i % 2) * (node.w + 20),
        y: node.y + Math.floor(i / 2) * (node.h + 20),
        w: node.w,
        h: node.h,
        prompt: node.prompt,
        generationId,
        sourceNodeId: node.sourceNodeId,
        threadId: node.threadId,
        url,
      });
    }
  }

  return planned;
}

/**
 * Decide which canvas nodes to create for a thread's GEN_RESULT messages.
 *
 * Idempotent: a generation already in `have` (i.e. already on the canvas) is
 * skipped, and a generation is never planned twice within one pass. Results are
 * ordered by message seq so older results land left of newer ones. Pure — the
 * caller does the DB reads (jobGenIds) and the inserts.
 */
export function planBridgeNodes(
  genResults: GenResultMsg[],
  jobGenIds: Map<string, string[]>,
  have: Iterable<string | null>,
): BridgeNode[] {
  const seen = new Set<string | null>(have);
  const out: BridgeNode[] = [];
  for (const m of [...genResults].sort((a, b) => a.seq - b.seq)) {
    if (!m.genJobId) continue;
    const kind: "image" | "video" =
      (m.payload as { kind?: string } | null)?.kind === "video" ? "video" : "image";
    for (const gid of jobGenIds.get(m.genJobId) ?? []) {
      if (seen.has(gid)) continue;
      seen.add(gid);
      out.push({ generationId: gid, genJobId: m.genJobId, kind, prompt: m.text });
    }
  }
  return out;
}
