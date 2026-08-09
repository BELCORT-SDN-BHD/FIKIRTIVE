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
 *   2. `merchantGenFailureMessage` — is THIS persisted job error one of our own merchant
 *      sentences? A WHITELIST, never a passthrough: `GenJob.error` also carries internal
 *      strings ("conditioning refs unreachable (0/1) — refusing to spend"), and a surface that
 *      forwarded whatever it found there would eventually show one of those to a merchant as
 *      advice. Only a sentence this file wrote for merchants can come back out of it.
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
 * "You weren't charged" is safe to say here and only here: this refusal arrives as an HTTP 4xx
 * at task creation, before the engine runs, and the worker's terminal path refunds the hold and
 * records no spend. It is the same promise the card's generic failure face makes for the same
 * reason.
 *
 * The way out it offers is the one that was MEASURED to work (2026-08-08): with the face not
 * visible — from behind, far enough away, or cropped out of frame — the identical request is
 * accepted and produces a clip. It deliberately promises nothing else, because nothing else has
 * been proven.
 */
export const REFERENCE_IMAGE_PERSON_REJECTED =
  "That reference image shows a recognisable face, and video generation can't use it. "
  + "Try one where the face isn't visible — from behind, further away, or cropped out — "
  + "and generate again. You weren't charged.";

/** Every sentence this system writes FOR A MERCHANT about a failed generation. The whitelist
 *  `merchantGenFailureMessage` reads; nothing else may be presented to a merchant as advice. */
const MERCHANT_GEN_FAILURE_MESSAGES: readonly string[] = [REFERENCE_IMAGE_PERSON_REJECTED];

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
 * Exact match against the whitelist above — not a prefix, not a substring — so no internal error
 * text can carry itself into a merchant's view by starting with one of our sentences. Trimmed on
 * both sides only, because the one thing between the worker writing this string and a surface
 * reading it back is whitespace normalisation, never rewording.
 */
export function merchantGenFailureMessage(persistedError: string | null | undefined): string | null {
  const written = String(persistedError ?? "").trim();
  if (!written) return null;
  return MERCHANT_GEN_FAILURE_MESSAGES.find((sentence) => sentence.trim() === written) ?? null;
}
