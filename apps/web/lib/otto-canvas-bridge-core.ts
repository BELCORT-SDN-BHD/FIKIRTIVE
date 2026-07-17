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

export type GenCardMsg = {
  seq: number;
  genJobId: string | null;
  payload: unknown;
  text: string | null;
};

export type PendingBridgeJob = {
  id: string;
  generationIds: string[];
};

export type PendingJobNode = {
  genJobId: string;
  kind: "image" | "video";
  prompt: string | null;
};

function mediaKindFromPayload(payload: unknown): "image" | "video" {
  return (payload as { kind?: string } | null)?.kind === "video" ? "video" : "image";
}

function promptFromCardMessage(message: GenCardMsg): string | null {
  const payload = message.payload as { structuredPrompt?: unknown; prompt?: unknown } | null;
  if (typeof payload?.structuredPrompt === "string" && payload.structuredPrompt.trim()) return payload.structuredPrompt;
  if (typeof payload?.prompt === "string" && payload.prompt.trim()) return payload.prompt;
  return message.text;
}

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
  genJobId: string;
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
  const nodesByJob = new Map<string, CanvasJobRecoveryNode[]>();
  for (const node of nodes) {
    if (!node.genJobId) continue;
    const group = nodesByJob.get(node.genJobId) ?? [];
    group.push(node);
    nodesByJob.set(node.genJobId, group);
  }

  for (const [genJobId, jobNodes] of nodesByJob) {
    const job = jobById.get(genJobId);
    if (!job || job.status !== "DONE" || job.generationIds.length <= 1) continue;

    // Recovery is not tied to winning the primary row's pending→done CAS. A browser may have
    // resolved the primary and exited before placing siblings, or another reload may have won
    // that repair. Use the durable primary card as the anchor in either state; the caller's
    // job-wide placement lock makes each planned generation idempotent under concurrency.
    const expectedPrimaryId = firstDisplayableGenerationId(job.generationIds, thumbs);
    const node =
      jobNodes.find((candidate) => candidate.generationId === expectedPrimaryId) ??
      jobNodes.find((candidate) => candidate.generationId === null) ??
      [...jobNodes].sort(
        (left, right) => left.y - right.y || left.x - right.x || left.id.localeCompare(right.id),
      )[0];
    if (!node) continue;

    const primaryGenerationId = node.generationId ?? expectedPrimaryId;
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
        genJobId: job.id,
        sourceNodeId: node.sourceNodeId ?? node.id,
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

/**
 * Plan one pending canvas node per approved GEN_CARD before the worker emits a
 * GEN_RESULT. This is display-only: the GenJob already exists and has already
 * gone through startGen/reserve. The caller owner/project-scopes `jobs`.
 */
export function planPendingJobNodes(
  genCards: GenCardMsg[],
  jobs: Map<string, PendingBridgeJob>,
  haveGenerations: Iterable<string | null>,
  haveJobs: Iterable<string | null>,
): PendingJobNode[] {
  const seenGenerations = new Set<string | null>(haveGenerations);
  const seenJobs = new Set<string | null>(haveJobs);
  const out: PendingJobNode[] = [];

  for (const message of [...genCards].sort((a, b) => a.seq - b.seq)) {
    if (!message.genJobId || seenJobs.has(message.genJobId)) continue;
    const job = jobs.get(message.genJobId);
    if (!job) continue;
    if (job.generationIds.some((id) => seenGenerations.has(id))) continue;
    seenJobs.add(message.genJobId);
    out.push({
      genJobId: message.genJobId,
      kind: mediaKindFromPayload(message.payload),
      prompt: promptFromCardMessage(message),
    });
  }

  return out;
}
