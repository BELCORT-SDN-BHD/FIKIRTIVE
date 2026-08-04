// Pure core of the chat→canvas bridge — no DB, no I/O, so it is unit-testable.
// (Kept out of the "use server" action file, whose exports must all be async.)
import { canvasJobIsInFlight } from "@fikirtive/core";

export type GenCardMsg = {
  seq: number;
  genJobId: string | null;
  payload: unknown;
  text: string | null;
};

export type PendingBridgeJob = {
  id: string;
  generationIds: string[];
  /** GenJob.status, exactly as stored. Read from the job row — never inferred from anything else. */
  status: string;
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
  // A cancelled job is its own ending, not a failure (#612 · #599 D4). The settlement writes it
  // on the row; saying it here too means a board opened before that write still reads truthfully.
  if (jobStatus === "CANCELLED") return "cancelled";
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

// The board readers used to recover a settled job's cards from HERE, with their own idea of how
// many there should be, where each one goes and what it hangs off, and they wrote what they
// concluded back onto the rows. That second opinion is gone (#601 T2b → #613 T2d): what a job's
// cards should be is decided once, by `planCanvasSettlement`, and written once, by the job's own
// completion path — with the backfill sweep behind it when that write cannot land. Reading a board
// writes nothing at all. What is left below is only the IN-FLIGHT card of a job that has not been
// delivered yet — a state the settlement deliberately does not project.

/**
 * Plan one pending canvas node per approved GEN_CARD of a job that is STILL RUNNING.
 *
 * Display-only: the GenJob already exists and has already gone through startGen/reserve. The
 * caller owner/project-scopes `jobs`.
 *
 * THE STATUS GATE (#613 r2, cross-family judge P1). A GEN_CARD is durable — `coworkGenerate`
 * stamps it with its job id and it stays in the thread for ever — so this planner meets the same
 * card again on every single board reload, long after the job finished. Without the gate, a job
 * that was DONE (or ended badly) but whose settlement write fell over got a fresh `pending` anchor
 * from an ordinary reload, at this bridge's linear position rather than the whole-batch origin the
 * settlement would have chosen. Opening the board then changed the merchant's final layout, and a
 * finished job sat there claiming to be in flight. A finished job — settled or not — is the
 * settlement's and the backfill sweep's business; the read walks past it.
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
    if (!canvasJobIsInFlight(job.status)) continue;
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
