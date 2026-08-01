/**
 * canvas-settlement-plan — the ONE answer to "what should be on the board for this job?"
 *
 * Given a paid generation job's recorded result and the cards that already exist for it, this
 * decides how many cards there should be, what each one's status is, which output it carries and
 * where in the batch it sits. Nothing else may hold an opinion about that: the browser, the web
 * server and the worker all read this function, so a card cannot mean one thing in the tab that
 * made it and another thing after a reload (#601 / #599 D3, D5).
 *
 * Pure by construction — no database, no clock, no randomness, no ids minted here. The caller
 * reads the rows, calls this, and applies the actions. That is what makes the whole state space
 * testable without a database.
 *
 * SCOPE (#601 T2a/T2b): this slice projects the SUCCESS terminal only. A job that is not DONE
 * gets `skip: "not-settled"`. Projecting failed / cancelled / timed-out terminals onto a card is
 * T2c and lands with the code that writes them — deliberately not pre-built here, so nobody has
 * to guess later whether an unwired branch was reviewed.
 */
import { canvasBatchFootprint, canvasBatchSlotOffset, nextCanvasSpawnOrigin, type CanvasRect } from "./canvas-layout.js";

/** Default card size — what the canvas promptbar and the chat→canvas bridge both place. */
export const CANVAS_SETTLEMENT_CARD = { w: 320, h: 320 } as const;

/** A card that already exists for the job being settled (tombstones included — they matter). */
export type SettlementCard = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  prompt: string | null;
  generationId: string | null;
  /** "pending" | "done" | "failed" | "deleted" | legacy "timeout" / "missing". */
  status: string;
  sourceNodeId: string | null;
};

export type SettlementJob = {
  /** GenJob.status — only "DONE" projects onto cards in this slice. */
  status: string;
  /** The outputs the paid job recorded, in the order it recorded them. */
  generationIds: readonly string[];
  kind: "IMAGE" | "VIDEO";
  prompt: string;
  /** A chat/canvas job carries a thread; a storyboard/Gen-space job does not. */
  hasLiveThread: boolean;
};

type PlannedCardShape = {
  action: "create";
  /** Index in the job's output list — the card's batch position (0 = the anchor). */
  batchIndex: number;
  generationId: string;
  type: "image" | "video";
  x: number;
  y: number;
  w: number;
  h: number;
  prompt: string | null;
};

export type PlannedAnchorCreate = PlannedCardShape & {
  role: "anchor";
  // No layout source: an anchor has no anchor. Whether the JOB was made from an earlier output
  // is a fact only the caller can resolve (from GenJob.sourceGenerationId), never this function.
};

export type PlannedSiblingCreate = PlannedCardShape & {
  role: "sibling";
  /** The card this sibling is laid out around. `null` means "the anchor card of THIS plan" —
   *  the caller knows its id, having just kept, updated or created it. It is a layout anchor,
   *  never a parent: the cards of one batch came out of a single press together. */
  layoutSourceNodeId: string | null;
};

export type PlannedCardCreate = PlannedAnchorCreate | PlannedSiblingCreate;

export type PlannedCardUpdate = {
  action: "update";
  role: "anchor" | "sibling";
  batchIndex: number;
  id: string;
  patch: { status?: string; generationId?: string };
};

export type PlannedCardKeep = {
  action: "keep";
  role: "anchor" | "sibling";
  batchIndex: number;
  id: string;
};

export type PlannedCard = PlannedCardCreate | PlannedCardUpdate | PlannedCardKeep;

export type CanvasSettlementPlan =
  | {
      kind: "place";
      /** Anchor first, then siblings in batch order. */
      cards: PlannedCard[];
    }
  | {
      kind: "skip";
      reason:
        /** Not DONE yet (or a terminal this slice does not project — see SCOPE above). */
        | "not-settled"
        /** A storyboard/Gen-space job with no card and no thread: it has no place on a board. */
        | "not-a-canvas-job"
        /** The merchant deleted the in-flight card, which suppresses the whole job. */
        | "suppressed"
        /** DONE but the job recorded no output — there is nothing to show. */
        | "nothing-to-place";
    };

export type CanvasSettlementInput = {
  job: SettlementJob;
  /** Every card already linked to this job, tombstones included. */
  cards: readonly SettlementCard[];
  /** Live card rectangles anywhere on this board — used to find a free spot for a batch whose
   *  card was never placed by anyone. */
  occupied: readonly CanvasRect[];
};

/** Deletion is a durable owner instruction, so it is read before anything else is decided. */
function tombstoneRules(cards: readonly SettlementCard[]): {
  suppressesJob: boolean;
  suppressedGenerationIds: Set<string>;
} {
  const tombstones = cards.filter((card) => card.status === "deleted");
  return {
    // A deleted in-flight card (no generation yet) was a decision about the whole job.
    suppressesJob: tombstones.some((card) => card.generationId === null),
    suppressedGenerationIds: new Set(
      tombstones.map((card) => card.generationId).filter((id): id is string => !!id),
    ),
  };
}

/**
 * Which existing card is the batch's anchor?
 *
 * The card the browser placed while the job was in flight carries no generation yet; after a
 * repair it carries the first output. Either way it is the one the batch is laid out around.
 * Oldest-first ordering by the caller makes this deterministic when neither shape matches.
 */
function findAnchor(live: readonly SettlementCard[], primaryGenerationId: string | null): SettlementCard | null {
  return (
    live.find((card) => card.generationId === null)
    ?? (primaryGenerationId ? live.find((card) => card.generationId === primaryGenerationId) : undefined)
    ?? live[0]
    ?? null
  );
}

/**
 * Project a settled job onto the cards that should exist for it.
 *
 * Idempotent by shape: run it against a board that is already correct and every card comes back
 * as `keep`, so applying the plan twice writes nothing the second time.
 */
export function planCanvasSettlement(input: CanvasSettlementInput): CanvasSettlementPlan {
  const { job, cards, occupied } = input;
  if (job.status !== "DONE") return { kind: "skip", reason: "not-settled" };

  const { suppressesJob, suppressedGenerationIds } = tombstoneRules(cards);
  if (suppressesJob) return { kind: "skip", reason: "suppressed" };

  const live = cards.filter((card) => card.status !== "deleted");
  // A job with no card of its own only belongs on the board if it is a chat/canvas job. A
  // storyboard job has neither, and must not sprout a card it never had.
  if (!live.length && !job.hasLiveThread) return { kind: "skip", reason: "not-a-canvas-job" };

  const outputs = job.generationIds.filter((id): id is string => !!id);
  if (!outputs.length) return { kind: "skip", reason: "nothing-to-place" };

  // The batch leads with the first output the merchant has NOT deleted. Reading it off the raw
  // list instead would hand a deleted output to the anchor below — and a job whose every card was
  // deleted would be rebuilt from scratch the next time a redelivery or the reaper settled it.
  const surviving = outputs.filter((id) => !suppressedGenerationIds.has(id));
  if (!surviving.length) return { kind: "skip", reason: "suppressed" };

  const type = job.kind === "VIDEO" ? "video" : "image";
  const primaryGenerationId = surviving[0]!;
  const anchor = findAnchor(live, primaryGenerationId);
  const planned: PlannedCard[] = [];

  // ── the anchor card ──────────────────────────────────────────────────────────────────────
  let anchorRect: CanvasRect;
  let anchorId: string | null;
  let anchorPrompt: string | null;
  let anchorSourceNodeId: string | null;
  // Which output the anchor ends up carrying. Normally the batch's first, but a board can be
  // reached where the only surviving card is a later one — and then the batch is laid out around
  // THAT card, and the earlier output is planned like any other sibling. Without this, the anchor
  // would be planned once as the anchor and again as a sibling.
  let anchorGenerationId: string;

  if (!anchor) {
    // Nobody ever placed a card — an Otto chat job on a board that was never opened. Put the
    // batch in the first free slot rather than on top of work that is already there (#547 A2).
    const footprint = canvasBatchFootprint(outputs.length, CANVAS_SETTLEMENT_CARD);
    const origin = nextCanvasSpawnOrigin(occupied, footprint);
    anchorRect = { x: origin.x, y: origin.y, ...CANVAS_SETTLEMENT_CARD };
    anchorId = null;
    anchorPrompt = job.prompt || null;
    anchorSourceNodeId = null;
    anchorGenerationId = primaryGenerationId;
    planned.push({
      action: "create",
      role: "anchor",
      batchIndex: outputs.indexOf(anchorGenerationId),
      generationId: anchorGenerationId,
      type,
      ...anchorRect,
      prompt: anchorPrompt,
    });
  } else {
    anchorRect = { x: anchor.x, y: anchor.y, w: anchor.w, h: anchor.h };
    anchorId = anchor.id;
    anchorPrompt = anchor.prompt ?? (job.prompt || null);
    anchorSourceNodeId = anchor.sourceNodeId;
    const patch: { status?: string; generationId?: string } = {};
    // Only an anchor with no output yet may be bound to one. A card that already shows a
    // different output is a sibling's card, and is never re-pointed.
    if (anchor.generationId === null) patch.generationId = primaryGenerationId;
    anchorGenerationId = patch.generationId ?? anchor.generationId ?? primaryGenerationId;
    if (anchor.status !== "done") patch.status = "done";
    const batchIndex = Math.max(0, outputs.indexOf(anchorGenerationId));
    planned.push(
      Object.keys(patch).length
        ? { action: "update", role: "anchor", batchIndex, id: anchor.id, patch }
        : { action: "keep", role: "anchor", batchIndex, id: anchor.id },
    );
  }

  // ── the sibling cards ────────────────────────────────────────────────────────────────────
  // Slots are measured from the anchor's OWN place in the batch, so the grid stays coherent even
  // when the anchor is not the batch's first card.
  const anchorSlot = canvasBatchSlotOffset(Math.max(0, outputs.indexOf(anchorGenerationId)), anchorRect);
  const accountedFor = new Set<string>();
  for (const card of live) if (card.generationId) accountedFor.add(card.generationId);
  accountedFor.add(anchorGenerationId);

  for (let index = 0; index < outputs.length; index += 1) {
    const generationId = outputs[index]!;
    if (suppressedGenerationIds.has(generationId) || generationId === anchorGenerationId) continue;
    const existing = live.find((card) => card.generationId === generationId);
    if (existing) {
      planned.push(
        existing.status === "done"
          ? { action: "keep", role: "sibling", batchIndex: index, id: existing.id }
          : { action: "update", role: "sibling", batchIndex: index, id: existing.id, patch: { status: "done" } },
      );
      continue;
    }
    if (accountedFor.has(generationId)) continue; // the same output twice in one job's list
    accountedFor.add(generationId);
    const slot = canvasBatchSlotOffset(index, anchorRect);
    planned.push({
      action: "create",
      role: "sibling",
      batchIndex: index,
      generationId,
      type,
      x: anchorRect.x + slot.dx - anchorSlot.dx,
      y: anchorRect.y + slot.dy - anchorSlot.dy,
      w: anchorRect.w,
      h: anchorRect.h,
      prompt: anchorPrompt,
      // The batch's ANCHOR, for layout — not a parent. If the anchor itself hangs off an earlier
      // card, siblings hang off the same one; otherwise null means "this plan's anchor card".
      layoutSourceNodeId: anchorSourceNodeId ?? anchorId,
    });
  }

  return { kind: "place", cards: planned };
}
