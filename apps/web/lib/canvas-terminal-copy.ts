/**
 * WHAT A RESTED CARD SAYS — the words for every terminal state, in one table (#602 T3 · #827).
 *
 * This used to be a stack of nested ternaries inside `FailedBody`. It moved out here for two
 * reasons, and both are about the algebra rather than tidiness:
 *
 *   1. EXHAUSTIVENESS. `TERMINAL_FACE_COPY` is a `Record` over `TerminalCardStatus`, so adding a
 *      resting face to the algebra fails `tsc` here until someone writes what that face says. A
 *      ternary chain would have quietly fallen through to the last `else` — which is how a card
 *      comes to describe itself as something it is not.
 *   2. TESTABILITY. The board read is proved against the real database in a Node environment; the
 *      card components need jsdom. With the words in a plain module both halves can assert the
 *      SAME function, so "the durable read produces this reason" and "the real card renders this
 *      reason" join up instead of being two claims that merely agree.
 *
 * WHITE LABEL: nothing here names an engine, a model, or a vendor — the standing Founder order.
 * The one explanation this file can show is not written here at all; it comes from the single
 * whitelist in `@fikirtive/core/gen-failure`, byte for byte, which is what keeps the card and
 * Otto from telling one merchant two versions of one refusal (#765).
 */
import { merchantGenFailureExplanation, type GenFailureReason } from "@fikirtive/core/gen-failure";
import type { TerminalCardStatus } from "./canvas-card-status";

export type TerminalCardCopy = {
  /** The glyph above the words. Decoration — every card also says its state in text. */
  icon: string;
  /** The state this card reached, in two or three words. */
  title: string;
  /** What that means for the merchant, and what (if anything) they can do. */
  detail: string;
  /** Does this ending offer "Check again"? Only where looking again could change the answer. */
  offersRefresh: boolean;
};

/**
 * ONE ENTRY PER RESTING FACE, and each one says only what it can prove.
 *
 * `failed` is a hard fail: the worker refunded the job, so "You weren't charged" is safe here.
 * `cancelled` is the merchant's own decision rather than a failure, so it claims nothing about
 * money it cannot prove and offers nothing to retry. `timeout` is SOFT — the tab stopped polling
 * but the worker may still settle it — so it invites a check-back instead of claiming failure.
 * `missing` means the job finished and this card cannot show the media, so it must not claim a
 * refund. `unknown` is the fallback (#602 T3): the card has no account of itself, and saying so
 * with a way to look again beats a spinner that will never stop (F21).
 */
const TERMINAL_FACE_COPY: Readonly<Record<TerminalCardStatus, TerminalCardCopy>> = {
  failed: {
    icon: "⚠️",
    title: "That didn't finish",
    detail: "You weren't charged. Try again.",
    offersRefresh: false,
  },
  cancelled: {
    icon: "⃠",
    title: "Cancelled",
    detail: "This generation was cancelled.",
    offersRefresh: false,
  },
  timeout: {
    icon: "⏳",
    title: "Still working…",
    detail: "This is taking longer than usual — check back in a moment.",
    offersRefresh: true,
  },
  missing: {
    icon: "⚠️",
    title: "Preview missing",
    detail: "The job finished, but this card could not load the media.",
    offersRefresh: true,
  },
  unknown: {
    icon: "？",
    title: "Status unknown",
    detail: "We can't tell what happened to this one. Check again to reload it.",
    offersRefresh: true,
  },
};

/**
 * The words for a card that has come to rest, given its face AND why it rested (#827).
 *
 * A reason REPLACES the generic detail line and nothing else. That is deliberate: the generic
 * line ("You weren't charged. Try again.") is true but tells the merchant to repeat the one thing
 * that cannot work, and the explanation it gives way to already ends with the same refund promise.
 * No new merchant-facing sentence is written here — the replacement is the exact whitelisted
 * sentence, so the card, the toast and Otto are the same words by construction rather than by
 * three people keeping three copies in step.
 *
 * A CARD THAT HAS NOT FAILED KEEPS ITS OWN WORDS whatever reason it is handed. `canvasCardState`
 * already refuses to attach a reason to any other face, and this is that invariant said a second
 * time on purpose: this function's inputs cross an untyped boundary (React Flow hands node
 * components a plain data bag), and the worst outcome available here — telling a merchant their
 * still-running job was refused — is not one to leave to a type that was erased two frames ago.
 *
 * A card that ended before #827, or for any of the ordinary reasons, arrives as `unexplained` and
 * reads exactly as it always has. Nothing is invented for a card that never recorded a reason.
 */
export function terminalCardCopy(
  status: TerminalCardStatus,
  reason: GenFailureReason,
): TerminalCardCopy {
  const face = TERMINAL_FACE_COPY[status];
  const explanation = status === "failed" ? merchantGenFailureExplanation(reason) : null;
  return explanation ? { ...face, detail: explanation } : face;
}
