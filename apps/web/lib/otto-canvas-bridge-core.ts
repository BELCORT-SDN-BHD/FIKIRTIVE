// Pure core of the chat→canvas bridge — no DB, no I/O, so it is unit-testable.
// (Kept out of the "use server" action file, whose exports must all be async.)

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

// The board readers used to recover a settled job's cards from HERE, with their own idea of how
// many there should be, where each one goes and what it hangs off. That second opinion is gone:
// both readers now call the one settlement (`canvas-settlement-reconcile.ts` →
// `planCanvasSettlement`), the same one the worker runs, so a board cannot come out differently
// depending on who got there first. What is left below is only the IN-FLIGHT card of a job that
// has not been delivered yet — a state the settlement deliberately does not project (#601 T2b).

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
