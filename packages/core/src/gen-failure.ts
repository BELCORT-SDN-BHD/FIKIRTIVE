/**
 * WHEN A GENERATION FAILS FOR A REASON THE MERCHANT CAN ACT ON (#765).
 *
 * Almost every way a generation dies is our problem, not theirs: the queue was busy, a
 * download dropped, a task expired. For those the honest thing to say is short — it didn't
 * go through, you weren't charged, try again — and that is what the whole failure path has
 * always said.
 *
 * This module is for the OTHER kind: the engine looked at what the merchant sent and refused
 * it. Retrying sends the same picture to the same engine and is refused identically, so the
 * merchant sits through the retry budget and is then told nothing. What they need instead is
 * WHAT was wrong and WHAT to do about it — once, immediately, in the same words wherever they
 * happen to be looking.
 *
 * TWO HALVES, AND WHY THEY ARE BOTH HERE:
 *
 *   1. `referenceImagePersonRejected` — does THIS engine reply mean that refusal? Written from
 *      measured machine output (see below), and deliberately narrow: an error it does not
 *      recognise is not this refusal, and takes the ordinary route. A classifier that guessed
 *      would tell merchants to crop a face out of a picture that was never the problem.
 *
 *   2. `merchantGenFailureReason` / `merchantGenFailureExplanation` — is THIS persisted job error
 *      one of our own merchant sentences, and if so which one? A WHITELIST, never a passthrough:
 *      `GenJob.error` also carries internal strings ("conditioning refs unreachable (0/1) —
 *      refusing to spend"), and a surface that forwarded whatever it found there would eventually
 *      show one of those to a merchant as advice. Only a sentence this file wrote for merchants
 *      can come back out of it. The reason is a NAME from a closed set (#827) so that a card can
 *      carry it as state rather than a surface having to be handed a sentence in the moment;
 *      `merchantGenFailureMessage` is the two composed, for readers that only want the words.
 *
 * WHITE LABEL. Every sentence below is read by a merchant, so none of them may name the engine,
 * the model, or the vendor — the standing Founder order enforced by `provider-secrecy`. They are
 * written vendor-free at the source rather than scrubbed on the way out, and
 * `gen-failure.test.ts` pins that: the redactor must leave them byte-identical, because the
 * whitelist above compares bytes and a scrub would silently break the merchant's own advice.
 */

/**
 * The sentence a merchant reads when the engine refused their reference image because it shows
 * a recognisable real person.
 *
 * ── WHY THE WAY OUT CHANGED (CREATE-A9, docs/specs/creation-engine.md; Founder 2026-08-30) ──
 *
 * The first version of this sentence offered the way out that was MEASURED in 2026-08-08: hide
 * the face — from behind, further away, cropped out — and the identical request is accepted.
 * True, and useless to the merchant who wanted a PERSON in their ad. It read as "photograph
 * your model from the back", which is not an ad anybody shoots.
 *
 * The 2026-08-29/30 probes closed that question for good. Real faces do not get in by any route
 * we can reach: not the photo itself, not an AI portrait made FROM the photo, not an outside
 * model's realistic face, not a crop of one that already passed (13 refusals, zero passes;
 * evidence in preserved/creation-probe-2026-08-29/). The refusal is not about how the face is
 * framed — it is about whose face it is. So an instruction to reframe was sending merchants to
 * retry a thing that cannot work, which is the exact failure #765 exists to stop.
 *
 * What DOES work is the cast library: platform-made fictional characters, generated text-to-image
 * by the same house that renders the video, accepted 3 of 3 across scenes on 2026-08-30. Every
 * merchant's Library is seeded with them at signup (apps/web/lib/actor-library-seed.ts), so the
 * way out this sentence points at is already sitting on their screen when they read it.
 *
 * "You weren't charged" is safe to say here and only here: this refusal arrives as an HTTP 4xx
 * at task creation, before the engine runs, and the worker's terminal path refunds the hold and
 * records no spend. It is the same promise the card's generic failure face makes for the same
 * reason. CREATE-A9 pins that promise on the ledger: `reserve:` and `refund:` in a pair, no
 * SETTLE, net zero.
 */
export const REFERENCE_IMAGE_PERSON_REJECTED =
  "Real human faces aren't supported yet. Pick a cast member from your Library instead. "
  + "You weren't charged.";

/**
 * The sentence a merchant reads when THIS DEPLOY HAS NO ENGINE WIRED UP.
 *
 * Not a refusal of anything they sent: the generation never reached an engine because this
 * environment has no paid provider selected. Until now that condition was invisible — the
 * factory quietly handed back the offline stand-in, the worker rendered a solid-colour PNG,
 * settled the hold, and the merchant paid credits for a swatch. The honest ending is a refusal
 * plus a refund, and this is what that refusal says.
 *
 * Every clause is one this system can prove at the moment it is written:
 *   - "a problem on our side" — the request never left the building, so nothing about it was
 *     wrong; saying otherwise would send a merchant editing a prompt that was fine.
 *   - "You weren't charged" — the stand-in throws BEFORE any engine call, so the failure is
 *     provably free and the worker's terminal branch refunds the hold in the same transaction.
 *     It is the same promise, for the same reason, as the refusal above.
 *   - "trying again won't help until we've fixed it" — the condition is a deployment setting,
 *     identical on every retry. The generic copy's "you can try again" would burn the merchant's
 *     afternoon on an answer that cannot change, which is the exact failure #765 exists to stop.
 *
 * WHITE LABEL, like every sentence here: it names no engine, no model, no vendor — a merchant
 * must not learn what is missing, only that something on our side is.
 */
export const GENERATION_ENGINE_UNAVAILABLE =
  "Generation isn't available right now — that's a problem on our side, not with what you sent. "
  + "You weren't charged, and trying again won't help until we've fixed it.";

/**
 * The sentence a merchant reads when a REFERENCE ASSET the job needed could not be fetched right
 * before the paid call (Codex QA-CRE-007, docs/specs/creation-engine.md CREATE-A2).
 *
 * ── WHERE THIS COMES FROM ──
 *
 * A generation can name up to five kinds of reference asset — @mentioned entity/product refs,
 * an i2v start frame, an end frame, a whole-clip reference video, an edit's base image, a cast
 * variant's locked base — and every one of those is re-resolved from storage immediately before
 * the paid engine call (`apps/worker/src/jobs/gen.ts`, `apps/worker/src/jobs/refgen.ts`). Before
 * this file existed, a presign miss there threw the OPS diagnostic itself — e.g.
 * "conditioning refs unreachable (0/2) — refusing to spend", "reference video unreachable —
 * refusing to spend" — straight into `GenJob.error`/`RefGenJob.error`, and two surfaces read that
 * column with nothing but a vendor-name scrub between it and the merchant: the Library "Needs
 * attention" board (`apps/web/components/otto/OttoStuff.tsx`) and the cast library's variant
 * problem line (`apps/web/components/otto/stuff/ElementVariantsDialog.tsx`). Both would show the
 * sentence above, byte for byte, to a merchant who has never heard the word "conditioning" — an
 * internal diagnostic standing in for advice, the exact failure #765 exists to stop.
 *
 * ONE SENTENCE for all of them, deliberately: from where a merchant stands, "the picture/video I
 * gave you couldn't be reached" is the same problem and the same fix (swap the reference, try
 * again) whether the asset in question was a product photo, a start frame, or a cast member's
 * locked base. Splitting this into five near-identical sentences would multiply the whitelist for
 * no question a merchant actually has.
 *
 * "so nothing was charged" is safe here for the same reason it is safe on the sibling sentences
 * above: every throw site this maps sits BEFORE the paid provider call, so the worker's terminal
 * branch refunds the hold (or never took it past a pre-charge retry) — never a spend.
 *
 * The raw diagnostic is not thrown away — it still reaches `console.error` at the throw site (and
 * from there, wherever server logs go), which is what "for support/debugging" means here. What
 * changes is what gets PERSISTED to the row a merchant's own screen reads back: the merchant
 * sentence itself, not the ops string, mirroring `REFERENCE_IMAGE_PERSON_REJECTED` above.
 *
 * ── WHY THE ENDING SAYS "ask again", NOT "try again" (Codex E2E-CRE-PAV-005, 2026-09-04) ──
 *
 * The QA-CRE-007 PR that introduced this sentence deliberately left its recovery action alone
 * ("Try again/Replace reference 类专属恢复动作未新增" — the change register row for that PR says
 * so in as many words) and kept the card's existing "Retry with Otto" button as the only control.
 * That was the right call for that PR's scope, but it left the WORDING doing something the button
 * still cannot: a merchant who reads "Replace it and try again" and then just presses retry —
 * without swapping the reference — spends a second attempt on the exact request that already
 * failed, because the same missing/unreachable asset is still attached. The retry was never going
 * to succeed until something about the request changed; the old wording said "try again" right
 * next to the actual fix, so it read as permission to skip the fix.
 *
 * "ask again" names what happens ONLY after the merchant has done the fix ("Replace it"), not an
 * action that stands on its own — it cannot be read as "press retry and hope". The generic
 * catch-all a merchant sees for an ordinary, actually-retryable failure (`GENERATION_DID_NOT_GO_
 * THROUGH` / the card's own resting-face copy) keeps "Try again" verbatim, because for THAT case
 * pressing retry is the whole fix. Reserving the phrase for the case where it is true is the
 * point: `E2E-CRE-PAV-005` — reference-unavailable copy must point at an executable action, and a
 * retryable provider error is the only class allowed to still say "Try again".
 */
export const REFERENCE_ASSET_UNREACHABLE =
  "We couldn't reach one of your references, so nothing was charged. "
  + "Replace it and ask again.";

/**
 * WHY A GENERATION FAILED, as a CLOSED SET OF NAMES (#827).
 *
 * #765 gave the refusal a sentence. This gives it a NAME, and the difference is what survives a
 * page reload: a sentence is something a surface was handed once, while a name is something a
 * card can carry as part of its own state, be read back out of the database, and be projected
 * onto every surface that asks. Before this, a merchant who refreshed lost the explanation
 * entirely and the card went back to the generic resting face (#827).
 *
 * `unexplained` is a MEMBER, not an absence, and that is the point of shape here. Most failures
 * genuinely have no merchant-facing reason — a queue hiccup, a dropped download — and so does
 * every card that ended before this existed. Naming that case means every terminal card has a
 * reason of some kind, so the projection is total and no reader needs an "and if there is
 * nothing?" branch that could be forgotten. It also means the honest generic copy is a branch of
 * the same algebra rather than the fallback of a missing field.
 *
 * ADDING ONE IS DELIBERATELY NOISY. A new name has to be placed in `MERCHANT_GEN_FAILURE_SENTENCES`
 * below (a `Record` over the union, so `tsc` refuses an unhandled member) and in the card copy
 * table `apps/web/lib/canvas-terminal-copy.ts` (the same trick). That is the closed algebra doing
 * its job: a reason nobody wrote copy for cannot ship as a blank card.
 */
export const GEN_FAILURE_REASONS = [
  "unexplained",
  "referenceImagePerson",
  "engineUnavailable",
  "referenceAssetUnreachable",
] as const;

export type GenFailureReason = (typeof GEN_FAILURE_REASONS)[number];

/** The reasons that HAVE something to say. `unexplained` is excluded by construction, so the
 *  sentence table below cannot be given an entry for "we have no idea" — inventing one is exactly
 *  the failure this whole file exists to prevent. */
export type ExplainedGenFailureReason = Exclude<GenFailureReason, "unexplained">;

/**
 * THE ONE TABLE: a reason's name → the sentence a merchant reads for it.
 *
 * Every surface reads THIS — the card on the board, Otto describing that card, the live poll's
 * toast, the durable turn message. A second mapping anywhere is how one refusal comes to be
 * described two ways to one merchant, which is the defect #765 closed and the reason this stayed
 * a single table when #827 added names on top of it.
 *
 * It is also still the WHITELIST `merchantGenFailureMessage` reads: `GenJob.error` doubles as an
 * ops column, and only a sentence written here may come back out of it.
 */
const MERCHANT_GEN_FAILURE_SENTENCES: Readonly<Record<ExplainedGenFailureReason, string>> = {
  referenceImagePerson: REFERENCE_IMAGE_PERSON_REJECTED,
  engineUnavailable: GENERATION_ENGINE_UNAVAILABLE,
  referenceAssetUnreachable: REFERENCE_ASSET_UNREACHABLE,
};

/** Is this string one of the names above? For the untyped edges — a React node's data bag, a
 *  board read that crossed a wire — where an unrecognised word must land on `unexplained`
 *  rather than on a blank card. */
export function isGenFailureReason(value: string | null | undefined): value is GenFailureReason {
  return (GEN_FAILURE_REASONS as readonly string[]).includes(value ?? "");
}

/**
 * WHICH reason a persisted job error is — total, and `unexplained` for everything unrecognised.
 *
 * Exact match against the table above, trimmed on both sides only: the one thing that happens
 * between the worker writing this string and a reader asking about it is whitespace
 * normalisation, never rewording. Not a prefix and not a substring, so an internal ops string
 * that happens to begin with one of our sentences is still `unexplained`.
 */
export function merchantGenFailureReason(persistedError: string | null | undefined): GenFailureReason {
  const written = String(persistedError ?? "").trim();
  if (!written) return "unexplained";
  for (const [reason, sentence] of Object.entries(MERCHANT_GEN_FAILURE_SENTENCES)) {
    if (sentence.trim() === written) return reason as ExplainedGenFailureReason;
  }
  return "unexplained";
}

/**
 * The sentence for a reason, or null when the reason is `unexplained`.
 *
 * Null is not a gap to paper over: it means this ending has no explanation we can prove, and the
 * surface must say its own honest generic thing rather than invent one. Card and Otto both come
 * through here, which is what keeps them saying the same words about the same card.
 */
export function merchantGenFailureExplanation(reason: GenFailureReason): string | null {
  return reason === "unexplained" ? null : MERCHANT_GEN_FAILURE_SENTENCES[reason];
}

/**
 * THE MEASURED SHAPE of the refusal — the only thing this classifier is allowed to be sure of.
 *
 * Recorded 2026-08-08 against the live engine (4 of 4 attempts refused; a straight-on face, the
 * same face re-uploaded as base64, a three-quarter half-body, and a full profile). Every one came
 * back HTTP 400 at task creation, nothing billed, with this body — 274 characters, so it arrives
 * whole through the 300-character cap the adapter reads replies under, and parses as JSON:
 *
 *   {"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation",
 *             "message":"The request failed because the input image 'content[1]' may contain
 *                        real person. Request id: …",
 *             "param":"content[1]","type":"BadRequest"}}
 *
 * Two markers, because the reply carries both and either alone is decisive:
 *   - the FULL code, compared as a whole string;
 *   - the message's own sentence, which needs no JSON and would survive the code being renamed.
 *
 * ── WHY BOTH ARE ANCHORED, AND WHAT A LOOSE ONE COST (r2, judge P1) ───────────────────────
 * The first cut of this file matched both markers as SUBSTRINGS — a regex looking for the code
 * anywhere in the body, and another for "input image … may contain real person" with 120 free
 * characters in the middle. Three replies that are NOT this refusal walked straight through it:
 *
 *   · `…PrivacyInformation` is a PREFIX of `…PrivacyInformationV2` — a different, unknown
 *     refusal, matched because nothing said where the code ended;
 *   · likewise `…PrivacyInformation.Other`, a narrower sub-code with its own meaning;
 *   · "The input image was accepted, but the prompt may contain real person names" — a
 *     complaint about the PROMPT, matched because the gap regex bridged "input image" and
 *     "may contain real person" across the very words that said the image was fine.
 *
 * Each of those would have been terminal on the first attempt (no retry for something that may
 * well have been transient) AND shown the merchant advice about cropping a face out of a
 * picture that was never the problem. That is the exact failure this classifier was written to
 * avoid, so the fix is to stop pattern-matching near the shape and match the shape:
 *
 *   - the code is compared with `===` against the whole string. Not a regex, so there is no
 *     such thing as "and then some" — a longer code is a different code.
 *   - the message is the engine's own sentence end to end, with a boundary after it so
 *     "real personality" cannot pass as "real person". Only the content index varies, because
 *     which slot the image occupies is a fact about the request WE built, not about the refusal.
 */
const PERSON_REJECTION_CODE = "InputImageSensitiveContentDetected.PrivacyInformation";

const PERSON_REJECTION_MESSAGE =
  /The request failed because the input image 'content\[\d{1,3}\]' may contain real person(?![A-Za-z])/;

/** `error.code` from a JSON error body, or null when the body is not JSON at all, is not an
 *  object, or carries no string code. Every one of those is "no code to compare", never a
 *  match — the message marker below is what still speaks for a reply this cannot read. */
function errorCode(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const error = (parsed as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Does this engine error body mean "the reference image shows a recognisable real person"?
 *
 * FAIL CLOSED, and that is the whole design: an unrecognised error is not this one. Every other
 * refusal — rate limit, auth, a malformed parameter, a neighbouring moderation sub-code, a
 * complaint about the prompt rather than the picture — answers false and keeps the ordinary
 * failure route, which retries what may be transient and ends with the honest generic apology.
 * Being wrong in this direction costs a retry; being wrong in the other direction tells a
 * merchant to fix something that was never broken, and refuses to try again while doing it.
 */
export function referenceImagePersonRejected(detail: string | null | undefined): boolean {
  const body = String(detail ?? "");
  if (!body) return false;
  return errorCode(body) === PERSON_REJECTION_CODE || PERSON_REJECTION_MESSAGE.test(body);
}

/**
 * The merchant-facing sentence a persisted job error IS, or null when it is anything else.
 *
 * The whitelist read, kept as one call for the surfaces that only ever want the words (the live
 * poll's `guidance`, Otto's status line). Since #827 it is the composition of the two functions
 * above rather than a second lookup of its own — name the reason, then ask the one table what
 * that reason says — so a sentence can never be reachable through one reader and not the other.
 */
export function merchantGenFailureMessage(persistedError: string | null | undefined): string | null {
  return merchantGenFailureExplanation(merchantGenFailureReason(persistedError));
}

/**
 * The honest thing to say about a failed generation when NOTHING more specific is known
 * (`unexplained` — a queue hiccup, a dropped download, a persisted row from before this file
 * existed). Codex QA-CRE-007 — added because the Library "Needs attention" board had no fallback
 * at all: it showed `GenJob.error` whenever the column was non-empty, so an unrecognised ops
 * string reached the merchant exactly as often as a recognised one did. `merchantGenFailureCopy`
 * below is that fallback, composed with the whitelist above, so a caller never has to remember to
 * apply it.
 */
export const GENERATION_DID_NOT_GO_THROUGH = "This generation didn't go through and nothing was charged.";

/**
 * ALWAYS a sentence a merchant may read — the specific explanation when the persisted error is
 * one of ours, the honest generic line otherwise. Never the raw string: unlike
 * `merchantGenFailureMessage` (which answers `null` for "nothing to say" and leaves the fallback
 * to the caller), this is the total function a card can call and render without a branch of its
 * own — the same shape `terminalCardCopy` already gets for free by keying `TERMINAL_FACE_COPY`
 * on status first.
 */
export function merchantGenFailureCopy(persistedError: string | null | undefined): string {
  return merchantGenFailureMessage(persistedError) ?? GENERATION_DID_NOT_GO_THROUGH;
}

// ---------------------------------------------------------------------------
// 挂在这一轮消息上的参考,发送之前就取不到(Codex QA-CRE-FE9-013,2026-09-04)
// ---------------------------------------------------------------------------

/**
 * A REFERENCE THE MERCHANT ATTACHED IS NOT USABLE — and the send has to say so.
 *
 * This is not a generation failure: nothing has been queued, nothing reserved, no engine has
 * seen anything. It is the moment BEFORE all of that, when the composer carries a reference
 * (an `Image ref` chip, a clip) whose generation the server cannot resolve for this tenant.
 *
 * It lives in this file because it is the same discipline the rest of the file exists for: a
 * closed set of NAMES, one table from name to the sentence a merchant reads, and no second
 * mapping anywhere. What made QA-CRE-FE9-013 a P0 was precisely the absence of a sentence —
 * the reference was dropped in silence, Otto planned without it, the confirmation card listed
 * only the person, and the merchant approved and paid for a picture that never contained the
 * product they had picked.
 *
 * These names are DELIBERATELY separate from `GenFailureReason` above: that union is the
 * whitelist for `GenJob.error`, and every member of it needs terminal-card copy. A refusal that
 * happens before a job exists must never be able to arrive as a card state.
 */
export const REFERENCE_UNAVAILABLE_REASONS = ["notFound", "fileMissing"] as const;

export type ReferenceUnavailableReason = (typeof REFERENCE_UNAVAILABLE_REASONS)[number];

/**
 * THE ONE TABLE for the two ways an attached reference can be unusable.
 *
 * Both sentences say the same three things, because for the merchant both endings are the same:
 * what happened, that nothing was sent, and the one move that fixes it. Neither names the tenant
 * check, the storage layer, or an id — a merchant learns that this attachment can't be used, not
 * how our lookup works.
 *
 * `notFound` deliberately covers "deleted since you attached it" AND "belongs to someone else"
 * with ONE sentence: telling those two apart would answer whether a given id exists in another
 * account.
 *
 * Ending is "ask again", not "try again" — same discipline as `REFERENCE_ASSET_UNREACHABLE` above
 * (Codex E2E-CRE-PAV-005): the request cannot succeed by pressing retry alone, only by removing
 * the attachment first, and "ask again" names what happens after that fix rather than reading as
 * permission to skip it.
 */
const REFERENCE_UNAVAILABLE_SENTENCES: Readonly<Record<ReferenceUnavailableReason, string>> = {
  notFound:
    "One of your references isn't available any more. Remove it and ask again — nothing was sent.",
  fileMissing:
    "One of your references can't be opened right now. Remove it and ask again — nothing was sent.",
};

/** The sentence a merchant reads for an unusable attachment. One table, no second mapping. */
export function referenceUnavailableMessage(reason: ReferenceUnavailableReason): string {
  return REFERENCE_UNAVAILABLE_SENTENCES[reason];
}

/**
 * Is this transport text one of OUR two sentences? A WHITELIST, exactly like the `GenJob.error`
 * reader above and for the same reason.
 *
 * The composer needs it because the refusal arrives as a plain 400 BEFORE the SSE opens, so what
 * the client holds is the raw response body. Forwarding whatever came back would eventually put a
 * stack trace, a proxy's HTML error page, or an internal string on a merchant's screen. Only a
 * sentence written in this file may come back out of it; anything else keeps the surface's own
 * honest generic copy.
 *
 * Exact match after trimming — not a prefix, not a substring.
 */
export function referenceUnavailableSentence(text: string | null | undefined): string | null {
  const written = String(text ?? "").trim();
  if (!written) return null;
  for (const sentence of Object.values(REFERENCE_UNAVAILABLE_SENTENCES)) {
    if (sentence.trim() === written) return sentence;
  }
  return null;
}
