/**
 * canvas-batch-identity — "which of the batch is this, and how big was the batch?"
 *
 * ONE reading of the persisted facts, shared by every surface that shows batch identity: the
 * A/B letters, the same-batch group frame, and the gate on side-by-side compare. Pure — no
 * database, no coordinates, no clock, no counting of what happens to be on the board.
 *
 * WHY IT EXISTS (#603 T4 · spec #599 D5 · root map 根 4·A). Both of these facts were server-side
 * truths that nobody wrote down, so the browser re-derived them from things the merchant changes:
 *
 *   - WHICH ONE — derived by sorting the cards by y coordinate, then by x. Dragging B above A
 *     rewrote the sort, so the letters swapped. The merchant screenshotted "I pick A" and their
 *     colleague opened a different picture.
 *   - HOW MANY — counted from the cards still on the board. Delete two of a batch of four and the
 *     two survivors grew A/B badges and unlocked Compare, announcing a comparison the merchant had
 *     never made.
 *
 * So nothing here looks at a coordinate or counts a row. `batchIndex` and `batchSize` are read off
 * the card, exactly as the server settled them, and `null` means "not known" — which draws
 * nothing at all rather than guessing (the repo's honest-history precedent: 早期作品,来历不详).
 */

/** The persisted batch facts a card carries. Anything absent is unknown, never inferred. */
export type CanvasBatchFacts = {
  /** Which paid press produced this card. */
  genJobId?: string | null;
  /** 0-based position in that press's output list, as the server recorded it. */
  batchIndex?: number | null;
  /** How many outputs that press produced — never how many are left on the board. */
  batchSize?: number | null;
};

/** A card, as far as batch identity and parentage are concerned. */
export type CanvasBatchNode = CanvasBatchFacts & {
  id: string;
  /** "image" | "video" | "text" — only cards of the same kind are ever comparable. */
  type?: string | null;
  /** The card this one's paid job was actually made FROM. Never a batch anchor (#603 T4). */
  madeFromNodeId?: string | null;
};

/** A batch of exactly two is the only thing an A/B pair can be. */
const AB_BATCH_SIZE = 2;
const AB_LETTERS = ["A", "B"] as const;

/** A card as the browser holds it, before anything it says may be believed. */
export type CanvasRecordedFactsSource = {
  genJobId?: string | null;
  batchIndex?: number | null;
  batchSize?: number | null;
  madeFromNodeId?: string | null;
  /**
   * A board read has returned this card (`serverKnown`, stamped by the canvas merge). It is the
   * only thing that separates a recorded fact from a request the browser has just sent.
   */
  serverKnown?: unknown;
};

/** The four columns, as the server settled them. Every one is null until it has. */
export type CanvasRecordedFacts = {
  genJobId: string | null;
  batchIndex: number | null;
  batchSize: number | null;
  madeFromNodeId: string | null;
};

const NOTHING_RECORDED: CanvasRecordedFacts = {
  genJobId: null, batchIndex: null, batchSize: null, madeFromNodeId: null,
};

/**
 * The four recorded columns of a card — and NOTHING from a card the server has not answered for.
 *
 * WHY (#605 r1 judge P1-1). The moment a merchant presses Generate, the browser puts a queued card
 * down and it knows only what it ASKED for: two images, made from this one. What the batch turns
 * out to be is the paid job's to settle, and until it does, the row's columns are null (see
 * `canvas-node-placement`) — a press can come back with fewer outputs, or the derivation can
 * resolve to nothing. Those request numbers used to be written onto the local card and read
 * straight back out by the tree, the A/B badge, the same-batch frame and the compare gate, so a
 * card that was still queueing already announced "Batch of 2", wore an A, and had a line drawn to
 * a parent — statements the server had never made and might never make.
 *
 * A queued card is still a card: it sits on the board and says it is queued. It just says nothing
 * about batches or parentage until the board read brings the settled columns back.
 */
export function canvasRecordedFacts(card: CanvasRecordedFactsSource): CanvasRecordedFacts {
  if (card.serverKnown !== true) return NOTHING_RECORDED;
  return {
    genJobId: card.genJobId ?? null,
    batchIndex: typeof card.batchIndex === "number" ? card.batchIndex : null,
    batchSize: typeof card.batchSize === "number" ? card.batchSize : null,
    madeFromNodeId: card.madeFromNodeId ?? null,
  };
}

function knownIndex(facts: CanvasBatchFacts): number | null {
  const { batchIndex, batchSize } = facts;
  if (typeof batchIndex !== "number" || !Number.isInteger(batchIndex) || batchIndex < 0) return null;
  if (typeof batchSize !== "number" || !Number.isInteger(batchSize) || batchSize < 1) return null;
  return batchIndex < batchSize ? batchIndex : null;
}

/** How many cards that paid press produced, or null when the card cannot say. */
export function canvasBatchSize(facts: CanvasBatchFacts): number | null {
  const { batchSize } = facts;
  return typeof batchSize === "number" && Number.isInteger(batchSize) && batchSize >= 1 ? batchSize : null;
}

/** Did one press produce several cards? Only the recorded size answers this. */
export function isCanvasBatchCard(facts: CanvasBatchFacts): boolean {
  return !!facts.genJobId && (canvasBatchSize(facts) ?? 1) > 1;
}

/**
 * The A/B letter this card wears — and it wears it for life.
 *
 * Only a batch of exactly two has an A and a B, and which is which is the recorded position, so
 * no arrangement of the board can swap them. Everything else gets no letter.
 */
export function canvasBatchLetter(facts: CanvasBatchFacts): "A" | "B" | null {
  if (canvasBatchSize(facts) !== AB_BATCH_SIZE) return null;
  const index = knownIndex(facts);
  return index === null ? null : AB_LETTERS[index] ?? null;
}

/**
 * May these two cards be shown side by side as A and B?
 *
 * ONE way in, and every part of it is a recorded fact: they are the two cards of one two-card
 * press — same job, a recorded size of two, positions 0 and 1, all settled by the server.
 *
 * A batch of three or four has no A and no B, so nothing inside it is comparable — which is what
 * the gate was for before a batch's shared layout anchor lit it up for every pair (root map 根 3).
 *
 * A card and the card it was MADE FROM used to be let through here too (#605 r1 judge P1-2). That
 * is a different thing to put on screen — a before and an after, not the two halves of one press —
 * and nobody approved it: the letters A and B do not apply, so the panel had to invent "Source"
 * and "Made from it" for the two sides. Comparing a card with what it made may well be worth
 * building; it is its own product decision, not something this gate carries in on the side.
 */
export function canvasCardsComparable(left: CanvasBatchNode, right: CanvasBatchNode): boolean {
  if (left.id === right.id) return false;
  if ((left.type ?? null) !== (right.type ?? null)) return false;
  if (!left.genJobId || left.genJobId !== right.genJobId) return false;
  const leftLetter = canvasBatchLetter(left);
  const rightLetter = canvasBatchLetter(right);
  return !!leftLetter && !!rightLetter && leftLetter !== rightLetter;
}

/** Which card goes on which side of a side-by-side compare, and what each side is called. */
export type CanvasComparePair = {
  left: { id: string; label: string };
  right: { id: string; label: string };
  title: string;
};

/**
 * The two sides of a side-by-side compare — decided by the recorded facts, never by the picking.
 *
 * A merchant screenshots the comparison and tells a colleague "I pick A". So the side a card
 * lands on may not depend on which one they clicked first, or on where the cards sit: the
 * recorded batch position puts A on the left, full stop.
 *
 * Returns null for anything the gate refuses, so the caller cannot open a comparison the facts
 * do not support.
 */
export function canvasComparePair(
  first: CanvasBatchNode,
  second: CanvasBatchNode,
): CanvasComparePair | null {
  if (!canvasCardsComparable(first, second)) return null;

  // The gate passed, so both cards carry a recorded letter and the letters differ.
  const [left, right] = canvasBatchLetter(first) === "A" ? [first, second] : [second, first];
  return {
    left: { id: left.id, label: "A" },
    right: { id: right.id, label: "B" },
    title: "Comparing A and B",
  };
}

/** One press's cards that are on the board right now, for the frame drawn around them. */
export type CanvasBatchGroup = {
  genJobId: string;
  /** The recorded size of the press — what the merchant bought, not what survived. */
  batchSize: number;
  /** The cards of that press still on the board, in recorded batch order. */
  memberIds: string[];
};

/**
 * The same-batch groups worth drawing a frame around.
 *
 * Members are ordered by their recorded position, so the frame's contents read left-to-right the
 * way the press produced them however the merchant has since arranged them. A press with only one
 * card left on the board gets no frame — there is nothing to group — but its recorded size is
 * unchanged, which is why a lone survivor of a batch of four still never becomes an A or a B.
 */
export function canvasBatchGroups(nodes: readonly CanvasBatchNode[]): CanvasBatchGroup[] {
  const byJob = new Map<string, { batchSize: number; members: CanvasBatchNode[] }>();
  for (const node of nodes) {
    if (!isCanvasBatchCard(node)) continue;
    const genJobId = node.genJobId!;
    const group = byJob.get(genJobId) ?? { batchSize: canvasBatchSize(node)!, members: [] };
    group.members.push(node);
    byJob.set(genJobId, group);
  }
  const groups: CanvasBatchGroup[] = [];
  for (const [genJobId, group] of byJob) {
    if (group.members.length < 2) continue;
    groups.push({
      genJobId,
      batchSize: group.batchSize,
      memberIds: group.members
        .slice()
        .sort((left, right) => (knownIndex(left) ?? 0) - (knownIndex(right) ?? 0) || left.id.localeCompare(right.id))
        .map((member) => member.id),
    });
  }
  return groups.sort((left, right) => left.genJobId.localeCompare(right.genJobId));
}

/** "Batch of 4" — what the merchant bought in one press, in sentence case. */
export function canvasBatchFrameLabel(batchSize: number): string {
  return `Batch of ${batchSize}`;
}
