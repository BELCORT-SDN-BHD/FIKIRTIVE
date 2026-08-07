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

// What a card SAYS moved to `canvas-card-status.ts` (#602 T3): it is one derivation shared by
// every reader, with a closed set of faces and `unknown` — never "generating" — as its fallback.
// The version that lived here answered with the row's own word when nothing else matched, which
// is how a row carrying a word no renderer knew became an eternal spinner.

export function firstDisplayableGenerationId(
  generationIds: readonly string[] | null | undefined,
  thumbs: Record<string, { src?: string | null }>,
): string | null {
  if (!generationIds?.length) return null;
  return generationIds.find((id) => !!thumbs[id]?.src) ?? generationIds[0] ?? null;
}

/** What a job's live cards on this board add up to — the facts the rule below needs. */
export type CanvasJobCardCensus = ReadonlyMap<string, {
  /** Outputs already shown by a card of this job that carries one. */
  carried: ReadonlySet<string>;
  /** How many of this job's live cards carry no output at all. */
  unbound: number;
}>;

/** Count each job's live cards once, so the rule below costs one pass over the board. */
export function censusCanvasJobCards(
  liveCards: readonly { genJobId: string | null; generationId: string | null }[],
): CanvasJobCardCensus {
  const census = new Map<string, { carried: Set<string>; unbound: number }>();
  for (const card of liveCards) {
    if (!card.genJobId) continue;
    const entry = census.get(card.genJobId) ?? { carried: new Set<string>(), unbound: 0 };
    if (card.generationId) entry.carried.add(card.generationId);
    else entry.unbound += 1;
    census.set(card.genJobId, entry);
  }
  return census;
}

/**
 * WHICH OUTPUT A CARD SHOWS — the one rule both board readers use (#613 r4, judge P1).
 *
 * A row that carries an output shows that output, full stop. The interesting case is a row that
 * carries none, and there the answer used to be "the job's first output that has a picture",
 * asked of each card on its own. That is how an EXTRA unbound card came to display the paid
 * picture a real card was already showing — the very duplication the settlement projection refuses
 * to write (`duplicateAnchorIds`), reintroduced at the last moment on the way to the screen.
 *
 * WHAT THE FALLBACK IS LEGITIMATELY FOR: a card pressed from the canvas promptbar persists only
 * its job id, so between the job being delivered and its settlement binding the card there is a
 * genuine, single card whose row carries no output yet. Without the fallback the merchant sees a
 * blank card, and "Make video" / "Detail" no-op on it because the client's guard needs a
 * generationId. It exists for THAT card, and it is now gated so it cannot mean anything else:
 *
 *   - an output another live card of the same job already carries is never offered — the board
 *     never shows one paid picture twice;
 *   - and it applies only when the job has exactly ONE unbound live card. With two, nothing on the
 *     board says which is the real anchor, so letting either borrow a picture would be a coin
 *     toss; both wait for the settlement, which is the only thing that knows.
 *
 * A card left with nothing renders as `missing` (see `canvasCardFace`) — the board's existing,
 * honest word for a card that carries no output it can show.
 */
export function displayGenerationIdForCard(input: {
  rowGenerationId: string | null;
  genJobId: string | null;
  jobGenerationIds: readonly string[] | null | undefined;
  census: CanvasJobCardCensus;
  thumbs: Record<string, { src?: string | null }>;
}): string | null {
  if (input.rowGenerationId) return input.rowGenerationId;
  if (!input.genJobId) return null;
  const entry = input.census.get(input.genJobId);
  if (!entry || entry.unbound !== 1) return null;
  const unclaimed = (input.jobGenerationIds ?? []).filter((id) => !!id && !entry.carried.has(id));
  return firstDisplayableGenerationId(unclaimed, input.thumbs);
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
