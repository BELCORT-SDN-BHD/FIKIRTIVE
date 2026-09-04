/**
 * library-item-a11y — the single place that turns a Library item's raw name (today, almost
 * always the full generation prompt) into a screen-reader/voice-control-friendly accessible
 * name.
 *
 * Codex staging audit, 2026-09-04 (docs/audits/creation-staging-product-avatar-video-2026-09-04.md,
 * **LIB-STG-P2-005**): "Generated assets use the full generation prompt, sometimes duplicated,
 * as the button's accessible name." A paragraph-length `aria-label` makes screen-reader
 * navigation exhausting (every Tab stop reads the whole prompt aloud) and voice-control
 * targeting unreliable (nobody says "click A premium coral-orange insulated tumbler, ribbed
 * grip, silver lid, image" to select a tile).
 *
 * Two callers shared this exact disease before this file existed — `CanvasLibraryPicker.tsx`
 * (the Canvas composer's "Choose from Library" half-sheet) had its own `libraryItemAccessibleName`,
 * and `StuffLibrary.tsx` (the main Library grid) built the same shape inline via `item.label`.
 * Both read the same underlying `Generation.prompt`, so the fix belongs at the one place both
 * import — not patched twice (CLAUDE.md §7.3, single source of truth).
 *
 * This file only shrinks the ACCESSIBLE name. The visible caption stays exactly what it was —
 * callers that want the whole prompt for sighted users, or as an AX description/tooltip, keep
 * using the raw name they already have (e.g. a `title` attribute), not this module's output.
 */

/** Word-boundary cut length for the concise title — long enough to stay recognisable, short
 *  enough that a screen reader doesn't read a paragraph per Tab stop. */
const MAX_TITLE_CHARS = 60;

/**
 * Collapses an exact whole-string duplication down to one copy — the "sometimes duplicated"
 * half of the audit finding. Handles two shapes:
 *   1. The same sentence written twice with punctuation between ("A tumbler. A tumbler.").
 *   2. The same text written twice back to back with no punctuation ("A tumbler A tumbler").
 * Anything that is not an exact repeat (case-insensitive) is returned unchanged — this never
 * rewrites a prompt that merely mentions the same word twice.
 */
function collapseRepeatedName(trimmed: string): string {
  const sentences = trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length > 1) {
    const deduped = sentences.filter(
      (s, i) => i === 0 || s.toLowerCase() !== sentences[i - 1]!.toLowerCase(),
    );
    if (deduped.length < sentences.length) return deduped.join(" ");
  }

  // No sentence punctuation to split on — check whether the whole string is the same text
  // written twice back to back (optionally separated by a comma/semicolon or plain space).
  const mid = Math.floor(trimmed.length / 2);
  const first = trimmed.slice(0, mid).trim();
  const second = trimmed.slice(mid).trim().replace(/^[,;]\s*/, "");
  if (first.length > 0 && first.toLowerCase() === second.toLowerCase()) return first;

  return trimmed;
}

/**
 * Cuts to the first sentence, or to `MAX_TITLE_CHARS` on a word boundary with an ellipsis —
 * whichever is shorter. Never cuts mid-word.
 */
function truncateToTitle(text: string, max = MAX_TITLE_CHARS): string {
  const sentenceMatch = text.match(/^(.+?[.!?])(\s|$)/);
  const candidate = sentenceMatch ? sentenceMatch[1]!.trim() : text;
  if (candidate.length <= max) return candidate;
  const slice = candidate.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trimEnd();
  return `${cut}…`;
}

/**
 * The concise title alone, deduplicated and truncated — empty input gives back an empty
 * string, so callers can apply their own media-type fallback (e.g. "Image"/"Video").
 */
export function conciseAssetTitle(rawName: string): string {
  const trimmed = rawName.trim();
  if (!trimmed) return "";
  return truncateToTitle(collapseRepeatedName(trimmed));
}

/**
 * Full accessible name for one Library item's control: concise title + media type — never the
 * raw generation prompt. Falls back to the media type alone when the item has no name.
 */
export function libraryItemAccessibleName(rawName: string, kind: "image" | "video"): string {
  const title = conciseAssetTitle(rawName);
  if (!title) return kind === "video" ? "Video" : "Image";
  return `${title}, ${kind}`;
}
