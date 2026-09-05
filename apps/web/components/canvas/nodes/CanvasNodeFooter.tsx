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
import { canvasBatchPosition, type CanvasBatchFacts } from "@/lib/canvas-batch-identity";
import { DEFAULT_CANVAS_NAME, truncateCanvasTitle } from "@/lib/canvas-title";

/**
 * Which one of its press this card is, 1-based — or null when the press has not said.
 *
 * The whole judgment of "is this a recorded position at all" belongs to `canvasBatchPosition`,
 * the reader the A/B letter and the compare gate already share; this is only the 0-based → 1-based
 * step the merchant reads. It used to re-state that guard here, and two copies of one rule are two
 * truths waiting to drift (judge #1194 P2-1).
 */
export function canvasCardVersion(facts: CanvasBatchFacts): number | null {
  const index = canvasBatchPosition(facts);
  return index === null ? null : index + 1;
}

/**
 * The card's name, as the strip should show it — or "" for a card that has no name to show.
 *
 * `truncateCanvasTitle` is a CANVAS titler: handed something that reduces to nothing it answers
 * with the Canvas placeholder ("New canvas"). A card is not a Canvas, and a prompt of nothing but
 * quotation marks trimmed to nothing used to reach it and borrow that placeholder, so a nameless
 * card announced itself as a canvas (judge #1194 P2-2). The strip therefore checks what the titler
 * ACTUALLY produced: a result that is the placeholder, from a card that was not literally named
 * that, is not this card's name.
 */
function cardStripName(full: string): string {
  if (!full) return "";
  const shown = truncateCanvasTitle(full);
  if (shown === DEFAULT_CANVAS_NAME && full !== DEFAULT_CANVAS_NAME) return "";
  return shown;
}

export function CanvasNodeFooter({ name, facts }: { name?: string | null; facts?: CanvasBatchFacts }) {
  const full = (name ?? "").trim();
  const shown = cardStripName(full);
  const version = facts ? canvasCardVersion(facts) : null;
  if (!shown && version === null) return null;
  return (
    <footer className="cv-node-footer">
      {shown ? (
        <span className="cv-node-footer-name" title={full}>{shown}</span>
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
