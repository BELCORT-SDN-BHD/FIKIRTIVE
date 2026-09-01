/**
 * UnderstandingCostHint — the ONE line a merchant reads BEFORE they pick a file
 * (钱引擎 S2 §7.3 / MONEY-A9,Founder 2026-08-31「就是用户使用照算」).
 *
 * 披露先于扣费. Understanding used to be the platform's own cost and the merchant's
 * zero-touch background magic; it is now a real charge, and a charge nobody was told
 * about is the one kind of money bug a merchant cannot forgive. So this line is mounted
 * at every upload entry that actually produces an AssetUnderstanding row — OttoChatStream,
 * TemplateModal, AddAssetDialog — and it is on screen while the file picker is still
 * closed, not after the bytes are in.
 *
 * 三处一个组件, one sentence, one source: change the wording here and all three move.
 * §7.3 names the same three mounts; EditDesk is deliberately absent (it takes audio only,
 * and audio is not one of the three priced kinds — see the note in that file).
 *
 * **数值禁字面量.** Every number below is `pricedUnderstandingCredits(kind)` run right now,
 * the SAME function the upload path quotes and snapshots with. A hand-typed "0.1" would
 * become a lie the first time a cost pin moves, and it would become that lie silently —
 * which is exactly how a disclosure turns into a trap. The prices are internal credits at
 * the source, so they cross `displayCredits` before a merchant ever sees them.
 *
 * **级联说明 is not optional** (计费四则②: 两段价目上传时一并披露、一并锁价). An image that
 * turns out to be a page of text (a menu, a price list) gets a SECOND pass — the worker's
 * caption step queues a doc-extract row for it (`apps/worker/src/jobs/understand.ts`) —
 * so the merchant can be charged twice for one file. Naming only the first price would be
 * true and still deceptive.
 *
 * NOT a "use client" module on purpose: it holds no state and no handlers, so it stays a
 * shared component that both the client composers and the server-rendered pages can pull
 * from one file (a "use client" directive here would fence off the plain string exports).
 */
import { displayCredits, pricedUnderstandingCredits } from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";

/** What one item of `kind` costs, in the words the rest of the money UI uses
 *  ("0.1 credits" / "1 credit") — derived, never typed. */
function priceOf(kind: "image-caption" | "doc-extract" | "video-qa"): string {
  return creditsLabel(displayCredits(pricedUnderstandingCredits(kind)));
}

/** The disclosure sentence itself, exported so the tests (and any future surface) read the
 *  same string the merchant does rather than a second copy of it. */
export const UNDERSTANDING_COST_HINT =
  `Uploads are understood automatically — ${priceOf("image-caption")} an image, ` +
  `${priceOf("video-qa")} a video, and ${priceOf("doc-extract")} more when an image ` +
  `turns out to be a menu or price list.`;

/** The hover explanation. Says WHEN the charge lands and WHICH price applies, because
 *  understanding is charged at the price snapshotted at upload time, not at the price on
 *  the day the scan actually runs (计费四则①). */
export const UNDERSTANDING_COST_HINT_TITLE =
  "Charged when the file is understood, at the price shown when you upload";

/**
 * The shared line. Styling is the repo's existing cost hint (`FlowCanvas.tsx:1727`) —
 * same `text-[0.75rem] text-muted-foreground`, same `title` role — so a cost disclosure
 * looks the same wherever a merchant meets one.
 *
 * The ONE deliberate difference from that master: no `whiteSpace: "nowrap"`. There it
 * guards a four-word phrase ("Cost: 20 credits") sitting in a flex toolbar; here the
 * sentence is three clauses long and two of the three mounts are narrow dialogs, so
 * nowrap would push the line out of the dialog instead of protecting it.
 */
export function UnderstandingCostHint() {
  return (
    <span className="text-[0.75rem] text-muted-foreground" title={UNDERSTANDING_COST_HINT_TITLE}>
      {UNDERSTANDING_COST_HINT}
    </span>
  );
}

export default UnderstandingCostHint;
