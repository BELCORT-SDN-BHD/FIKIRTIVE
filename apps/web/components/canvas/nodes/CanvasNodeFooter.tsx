/**
 * CanvasNodeFooter — the 42px strip under a media card, as the approved canvas pattern draws it
 * (`design-system/patterns/canvas/CanvasReference.tsx`: `<footer className="flex h-[42px] items-
 * center justify-between px-3 text-xs">` carrying the card's name on the left and its version on
 * the right).
 *
 * WHAT PRODUCTION CAN HONESTLY PUT IN IT. The pattern's fixture card has two columns; the board
 * has a column for only one of them.
 *
 *   · name — the merchant's own words for this card. A generation carries the prompt it was made
 *     from, and that is the merchant's own name for it, so it is what the strip says. A card with
 *     no prompt (an upload dropped straight onto the board) says nothing rather than inventing a
 *     title for it.
 *   · version — there is no version column on a canvas node, and there is no honest way to derive
 *     one in the browser. "Nth in its lineage" would have to be counted from the cards currently
 *     on the board, which is exactly the invented-identity class #603 T4 closed: delete one card
 *     and every survivor silently renumbers itself. So the right-hand slot renders nothing until a
 *     version is a recorded fact, and the difference is logged for the Founder instead.
 */
export function CanvasNodeFooter({ name }: { name?: string | null }) {
  const label = (name ?? "").trim();
  if (!label) return null;
  return (
    <footer className="cv-node-footer">
      <span className="cv-node-footer-name" title={label}>{label}</span>
    </footer>
  );
}

export default CanvasNodeFooter;
