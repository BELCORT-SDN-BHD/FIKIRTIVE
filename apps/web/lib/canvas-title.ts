/**
 * Canvas naming — the one place that decides what a merchant reads for a Canvas's name.
 *
 * Two separate jobs live here on purpose, because both need the same "what counts as a
 * still-blank placeholder" list (§7.3 single source of truth):
 *
 *   1. `DEFAULT_CANVAS_NAME` / `LEGACY_DEFAULT_CANVAS_NAMES` — the placeholder vocabulary.
 *      A Canvas is never called a "Project" to a merchant (Founder 2026-08-30 ruling,
 *      `apps/web/design-system/information-architecture/README.md:95`). The database model
 *      is still named `Project` (frozen non-goal —
 *      `frontend-convergence-phase-3-create-canvas-acceptance.md` item 3) and older rows
 *      carry older placeholder names ("New project", "My First Project", …); `actions.ts`
 *      imports `LEGACY_DEFAULT_CANVAS_NAMES` to keep recognizing all of them as reusable
 *      blank records, without this file needing to know anything about Prisma.
 *   2. `formatCanvasTitle` — turns any stored name (a placeholder, a merchant's real name,
 *      or a raw prompt auto-titled onto a Canvas — `canvas-entry-actions.ts`'s
 *      `canvasName()` only length-caps at 80 chars, no word boundary) into something a
 *      one-line list row can show: a placeholder becomes today's canvas vocabulary, a long
 *      prompt collapses to its first line/sentence, word-truncated with an ellipsis. This
 *      is a **display** transform only — it never renames the stored record. Migrating
 *      legacy rows to real canvas vocabulary in the database is next round's work (Codex
 *      QA-CRE-006, `docs/specs/frontend-baseline.md` §5).
 *
 * Pure functions, no React/Prisma/server-only — usable from a server entry
 * (`CreateWorkspaceEntry.tsx`) or a client component (`CreateWorkspace.tsx`) alike.
 */
import { PRODUCT_VOCABULARY } from "./product-vocabulary";

/** The name a freshly bootstrapped Canvas gets today. The noun comes from
 *  `product-vocabulary.ts` — that file is where the five product words are decided,
 *  this one only decides what a *name* made of that word looks like. */
export const DEFAULT_CANVAS_NAME = `New ${PRODUCT_VOCABULARY.canvas.toLowerCase()}`;

/** Every placeholder name a Canvas record has ever been created with, oldest first —
 *  still-live rows may carry any of these. Kept for `actions.ts`'s reuse/auto-title
 *  matching; this module only uses it to map old rows onto today's vocabulary at display
 *  time (see `canvasDisplayName`). */
export const LEGACY_DEFAULT_CANVAS_NAMES = ["New project", "New campaign", "Untitled Project", "My First Project"] as const;

const KNOWN_DEFAULT_NAMES: ReadonlySet<string> = new Set<string>([DEFAULT_CANVAS_NAME, ...LEGACY_DEFAULT_CANVAS_NAMES]);

/** True for the bootstrap placeholder and every legacy variant it replaced. */
export function isDefaultCanvasName(name: string): boolean {
  return KNOWN_DEFAULT_NAMES.has(name.trim());
}

/** The complete name a merchant should read for this Canvas — never truncated. A blank
 *  name or any known placeholder (legacy or current) collapses to today's canvas
 *  vocabulary; a real name (including a long auto-titled prompt) passes through
 *  untouched. Use this for a tooltip/detail view that wants the full string. */
export function canvasDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || isDefaultCanvasName(trimmed)) return DEFAULT_CANVAS_NAME;
  return trimmed;
}

const DEFAULT_TITLE_MAX_LENGTH = 56;

/** Word-boundary truncation for a one-line list row: first line only (a multi-line
 *  prompt shouldn't spill past row one), cut at the first sentence end if that lands
 *  inside the cap, otherwise at the last whole word, with a trailing ellipsis. Assumes
 *  `name` is already a real display name — pair it with `canvasDisplayName` (that's what
 *  `formatCanvasTitle` below does) rather than calling this on a raw placeholder. */
export function truncateCanvasTitle(name: string, maxLength: number = DEFAULT_TITLE_MAX_LENGTH): string {
  // Strip a wrapping quote pair — a prompt merchants often type as `"like this"`.
  let candidate = name.trim().replace(/^["'“‘]+/, "").replace(/["'”’]+$/, "").trim();
  const newline = candidate.indexOf("\n");
  if (newline !== -1) candidate = candidate.slice(0, newline).trim();
  if (!candidate) return DEFAULT_CANVAS_NAME;

  const sentenceEnd = candidate.search(/[.!?](\s|$)/);
  if (sentenceEnd !== -1 && sentenceEnd + 1 <= maxLength) {
    candidate = candidate.slice(0, sentenceEnd + 1).trim();
  }
  if (candidate.length <= maxLength) return candidate;

  const slice = candidate.slice(0, maxLength);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxLength * 0.4 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trim()}…`;
}

/** What a Canvas history row shows: placeholder names mapped to canvas vocabulary
 *  (`canvasDisplayName`), then word-boundary truncated to a scannable length
 *  (`truncateCanvasTitle`). Pair with the untruncated `canvasDisplayName` for a
 *  `title=` tooltip so the full name is still one hover away. */
export function formatCanvasTitle(name: string, maxLength: number = DEFAULT_TITLE_MAX_LENGTH): string {
  return truncateCanvasTitle(canvasDisplayName(name), maxLength);
}
