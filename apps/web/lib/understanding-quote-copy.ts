/**
 * understanding-quote-copy — the URL-import **动作前报价** sentence, and nothing else.
 *
 * MONEY-A9 §7.3: a URL import is a server-side action with no UI of its own, so the price has
 * to travel with the action. `otto-media-port.ts` composes that sentence into its result, and
 * the disclosure fence (`lib/__tests__/understanding-disclosure.test.ts`) asserts what the
 * sentence actually SAYS.
 *
 * **Why this is its own file — a leaf, deliberately.** The fence used to reach the sentence by
 * importing `otto-media-port` itself. That module opens with `import "server-only"` and pulls in
 * the whole server action graph (`./actions`, `./cowork-actions`, `./upload-actions`, prisma),
 * and `apps/web`'s vitest runs every file in ONE worker (`pool: "threads"`,
 * `singleThread: true`). Loading Next's request-scoped runtime from a test that has no request
 * context poisoned that worker: 24 unrelated files then died with
 * `Invariant: AsyncLocalStorage accessed in runtime where it is not available` (E504).
 * A money disclosure has to be assertable at runtime, so the sentence moved to where a test can
 * call it — instead of the test dragging a server module into a place it cannot live.
 *
 * **The rule for this file: it stays a leaf.** Pure functions over the price truth and the MIME
 * router — no `next/*`, no `server-only`, no prisma, no I/O, no clock. Anything that needs those
 * belongs in `otto-media-port.ts`, which imports from here.
 */
import { understandingKindForMime } from "@fikirtive/core";
import { displayCredits, pricedUnderstandingCredits } from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";

/** content-type → candidate ext (re-validated through the canonical deriver at the call site). */
export const CT_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** The video exts this contract already declares (derived from CT_EXT, never a second list) —
 *  the fallback when a server sends bytes with no usable content-type. */
const VIDEO_EXTS = new Set(
  Object.entries(CT_EXT)
    .filter(([contentType]) => contentType.startsWith("video/"))
    .map(([, ext]) => ext),
);

/**
 * The sentence Otto returns with a URL import.
 *
 * Same source as every other quote in the product (`pricedUnderstandingCredits`), so the number
 * Otto says and the number the ledger takes cannot drift; nothing is typed by hand. Which kind
 * runs is `understandingKindForMime`, the same router the ingest uses — with the file's derived
 * ext as the fallback when the origin sent no usable content-type.
 *
 * The cascade clause (计费四则②) is added for images only: the second, doc-extract charge is
 * triggered by the caption's `isDocument`, so a video genuinely cannot incur it and promising
 * otherwise would be its own small lie.
 *
 * The price is the one **in effect when the scanner queues the file for understanding** — which
 * can be well after the import when there is a backlog (`apps/worker/src/jobs/understand.ts`
 * writes the snapshot at row creation, at most UNDERSTAND_SCAN_BATCH rows a minute). Saying
 * "locked in on upload" here would be a promise the charging path does not keep.
 */
export function importUnderstandingQuote(ext: string, contentType: string | null): string {
  const kind =
    understandingKindForMime(contentType ?? "") ?? (VIDEO_EXTS.has(ext) ? "video-qa" : "image-caption");
  const price = (k: typeof kind | "doc-extract") =>
    creditsLabel(displayCredits(pricedUnderstandingCredits(k)));
  const cascade =
    kind === "image-caption"
      ? ` If it turns out to be a menu or price list, reading it as a document costs ${price("doc-extract")} more.`
      : "";
  return `Imported. It is read automatically so Otto knows what is in it: ${price(kind)}, charged at the price in effect when it is queued for understanding — which can be later than the import if there is a backlog.${cascade}`;
}
