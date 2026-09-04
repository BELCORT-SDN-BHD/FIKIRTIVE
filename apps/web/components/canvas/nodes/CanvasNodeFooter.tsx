/**
 * CanvasNodeFooter — the 42px strip under a media card, as the approved canvas pattern draws it
 * (`design-system/patterns/canvas/CanvasReference.tsx`: `<footer className="flex h-[42px] items-
 * center justify-between px-3 text-xs">` carrying the card's name on the left and its version on
 * the right).
 *
 * BOTH COLUMNS ARE NOW FILLED (FRONT §7.1 ⑨ 第二刀 · FRONT-A15). The first cut shipped the name
 * only and logged the version as "no honest source"; this cut closes that, without inventing a
 * column, by reading the two the server already settles.
 *
 *   · name — the merchant's own words for this card, which is the prompt it was made from. It runs
 *     through the repo's single naming source (`@/lib/canvas-title`) rather than a second
 *     truncation rule of its own, so a card's strip breaks a long prompt exactly where a Canvas
 *     history row does: first line, first sentence if it fits, otherwise the last whole word plus
 *     an ellipsis — never mid-word. The untruncated prompt stays one hover away on `title=`.
 *     A card with no prompt (an upload dropped straight onto the board) still says nothing rather
 *     than borrowing the Canvas placeholder — a card is not a Canvas.
 *   · version — this card's 1-based position inside the paid press that produced it
 *     (`batchIndex` + 1), which is the same ordinal the pattern's `v1 … v4` shows for the four
 *     cards of one turn. It is READ, never derived from the board: `canvasRecordedFacts` has
 *     already refused everything the server has not settled, so deleting a sibling cannot
 *     renumber a survivor (the invented-identity class #603 T4 closed) and a card that is still
 *     queueing wears no version at all. Unknown renders nothing — never "v?" and never a guess.
 */
import { canvasBatchSize, type CanvasBatchFacts } from "@/lib/canvas-batch-identity";
import { truncateCanvasTitle } from "@/lib/canvas-title";

/**
 * Which one of its press this card is, 1-based — or null when the press has not said.
 *
 * Reads the recorded size through the same exported reader the A/B letter and the compare gate
 * use, so "what counts as a recorded batch" is decided in one place. A position outside its own
 * recorded size is not a position, and answers null like anything else unrecorded.
 */
export function canvasCardVersion(facts: CanvasBatchFacts): number | null {
  const size = canvasBatchSize(facts);
  if (size === null) return null;
  const index = facts.batchIndex;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= size) return null;
  return index + 1;
}

export function CanvasNodeFooter({ name, facts }: { name?: string | null; facts?: CanvasBatchFacts }) {
  const full = (name ?? "").trim();
  const version = facts ? canvasCardVersion(facts) : null;
  if (!full && version === null) return null;
  return (
    <footer className="cv-node-footer">
      {full ? (
        <span className="cv-node-footer-name" title={full}>{truncateCanvasTitle(full)}</span>
      ) : (
        <span className="cv-node-footer-name" />
      )}
      {version !== null && (
        <span className="ml-2 shrink-0 text-muted-foreground tabular-nums">v{version}</span>
      )}
    </footer>
  );
}

export default CanvasNodeFooter;
