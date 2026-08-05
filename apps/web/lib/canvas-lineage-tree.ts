/**
 * canvas-lineage-tree — "where did this card come from, and what came out of it?"
 *
 * ONE shaping of the recorded facts, for the tree a merchant opens on a card. Pure: no database,
 * no clock, no coordinates, no counting of what happens to be on the board.
 *
 * WHY IT READS ONLY FOUR COLUMNS (#605 T6 · spec #599 D8 · root map 根 3/根 4). The tree this
 * replaces was drawn on the north-star board from a single parentage field that carried three
 * meanings at once, and for a plain batch of four it carried the invented one: the second, third
 * and fourth card each "came from" the first. So the merchant opened a tree and read a family
 * story about four pictures that had simply come out of one press together. Since #603 T4 the
 * server writes the facts down separately, and this module may read those and nothing else:
 *
 *   · `madeFromNodeId` — the card this one's PAID JOB was conditioned on. The only thing that
 *     makes one card the parent of another.
 *   · `genJobId` + `batchIndex` + `batchSize` — which press made this card, which of its outputs
 *     it is, and how many that press produced. Siblings, never ancestors.
 *
 * THREE HONESTY RULES, each of which used to be broken by a guess:
 *   1. A recorded source that is not on this board is reported as exactly that (`off-board`).
 *      Nothing is drawn to a card the merchant cannot see, and the card is not re-described as
 *      an original. A card belonging to another workspace can never be on the board in the first
 *      place — every board read is owner-scoped — so this is also what a cross-tenant id reads as.
 *   2. `madeFromNodeId === null` is `not-recorded`, NOT "this is an original". T4's backfill
 *      writes NULL both for "no derivation" and for "a derivation nobody could verify", so the
 *      tree may only say that nothing was recorded.
 *   3. A batch position that was never recorded stays blank. It is not filled in from the order
 *      the cards arrive in, and never from where they sit.
 */

import { canvasBatchLetter, canvasBatchSize, isCanvasBatchCard } from "./canvas-batch-identity";

/** A board card, as far as its lineage is concerned. Exactly the recorded columns. */
export type CanvasLineageTreeCard = {
  id: string;
  /** "image" | "video" | "text" — display only; it never decides a relationship. */
  type?: string | null;
  /** The merchant's own words for this card. */
  prompt?: string | null;
  genJobId?: string | null;
  batchIndex?: number | null;
  batchSize?: number | null;
  madeFromNodeId?: string | null;
};

/** What the focused card records about where it came from. */
export type CanvasLineageOrigin = "not-recorded" | "on-board" | "off-board";

export type CanvasLineageTreeRow = {
  id: string;
  /** How far down the drawn chain this row sits. Indentation only. */
  depth: number;
  /** "Image" | "Video" | "Text" | "Card" — never a model or provider name. */
  kind: string;
  /** Trimmed prompt, or "" when the card kept none. Never invented. */
  prompt: string;
  /** "A" | "B" — only the two cards of a recorded two-card press wear one. */
  letter: "A" | "B" | null;
  /** "2 of 4" — the recorded position; null when the press never recorded one. */
  batchPosition: string | null;
  isFocus: boolean;
};

export type CanvasLineageTree = {
  focusId: string;
  origin: CanvasLineageOrigin;
  /** The recorded chain, oldest first, always ending with the focused card. */
  chain: CanvasLineageTreeRow[];
  /** Cards made FROM the focused card, and what those in turn made. */
  descendants: CanvasLineageTreeRow[];
  /** The cards of the focused card's own press, in recorded order. Null when it made only one. */
  batch: { size: number; rows: CanvasLineageTreeRow[] } | null;
};

const KIND_LABELS: Record<string, string> = { image: "Image", video: "Video", text: "Text" };

function kindLabel(type: string | null | undefined): string {
  return KIND_LABELS[type ?? ""] ?? "Card";
}

/** "2 of 4", or null when the press never wrote this card's position down. */
export function canvasBatchPositionLabel(card: CanvasLineageTreeCard): string | null {
  const size = canvasBatchSize(card);
  const index = card.batchIndex;
  if (size === null || typeof index !== "number" || !Number.isInteger(index)) return null;
  if (index < 0 || index >= size) return null;
  return `${index + 1} of ${size}`;
}

function row(card: CanvasLineageTreeCard, depth: number, focusId: string): CanvasLineageTreeRow {
  return {
    id: card.id,
    depth,
    kind: kindLabel(card.type),
    prompt: (card.prompt ?? "").trim(),
    letter: canvasBatchLetter(card),
    batchPosition: canvasBatchPositionLabel(card),
    isFocus: card.id === focusId,
  };
}

/**
 * The lineage of ONE card, from the recorded facts of the cards on this board.
 *
 * Returns null when the board does not carry the focused card — a card that is not here has no
 * story to tell, and inventing one is the whole defect this replaces.
 */
export function buildCanvasLineageTree(
  cards: readonly CanvasLineageTreeCard[],
  focusId: string,
): CanvasLineageTree | null {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const focus = byId.get(focusId);
  if (!focus) return null;

  // ── Up: the recorded chain. Stops at the first card that records nothing, and at any card
  //    whose recorded source is not on this board. A chain that points back at itself stops too.
  const ancestors: CanvasLineageTreeCard[] = [];
  const walked = new Set<string>([focus.id]);
  let origin: CanvasLineageOrigin = "not-recorded";
  let cursor: CanvasLineageTreeCard = focus;
  for (;;) {
    const sourceId = cursor.madeFromNodeId;
    if (!sourceId || sourceId === cursor.id) break;
    const source = byId.get(sourceId);
    if (!source) {
      if (cursor.id === focus.id) origin = "off-board";
      break;
    }
    if (cursor.id === focus.id) origin = "on-board";
    if (walked.has(source.id)) break;
    walked.add(source.id);
    ancestors.unshift(source);
    cursor = source;
  }
  const chain = [...ancestors, focus].map((card, index) => row(card, index, focus.id));

  // ── Down: what this card made, and what those made. Recorded parentage only — a batch sibling
  //    has nothing here, which is the whole point of splitting the column (#603 T4).
  const childrenByParent = new Map<string, CanvasLineageTreeCard[]>();
  for (const card of cards) {
    const parentId = card.madeFromNodeId;
    if (!parentId || parentId === card.id || !byId.has(parentId)) continue;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(card);
    childrenByParent.set(parentId, siblings);
  }
  const descendants: CanvasLineageTreeRow[] = [];
  const visited = new Set<string>([focus.id]);
  const walkDown = (parentId: string, depth: number): void => {
    const children = (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((left, right) => (left.batchIndex ?? 0) - (right.batchIndex ?? 0) || left.id.localeCompare(right.id));
    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      descendants.push(row(child, depth, focus.id));
      walkDown(child.id, depth + 1);
    }
  };
  walkDown(focus.id, chain.length);

  // ── Sideways: the cards of the same press. Ordered by what the press recorded, so no
  //    arrangement of the board can reorder them (#603 T4 · spec #599 D5).
  let batch: CanvasLineageTree["batch"] = null;
  if (isCanvasBatchCard(focus)) {
    const members = cards
      .filter((card) => !!card.genJobId && card.genJobId === focus.genJobId)
      .slice()
      .sort((left, right) => {
        const leftIndex = typeof left.batchIndex === "number" ? left.batchIndex : Number.MAX_SAFE_INTEGER;
        const rightIndex = typeof right.batchIndex === "number" ? right.batchIndex : Number.MAX_SAFE_INTEGER;
        return leftIndex - rightIndex || left.id.localeCompare(right.id);
      });
    batch = {
      size: canvasBatchSize(focus)!,
      rows: members.map((card) => row(card, 0, focus.id)),
    };
  }

  return { focusId: focus.id, origin, chain, descendants, batch };
}
