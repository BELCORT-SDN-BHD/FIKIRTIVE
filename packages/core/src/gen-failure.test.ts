/**
 * gen-failure.test.ts — the classifier that decides a merchant gets an explanation, and the
 * whitelist that decides what they are allowed to be shown (#765).
 *
 * The measured bodies below are copied from the 2026-08-08 run against the live engine
 * (4 refusals out of 4 face shapes, HTTP 400 at task creation, nothing billed). They are the
 * only reason this classifier is allowed to exist: the rule is that a refusal is translated
 * when the engine really returns it, never when we imagine it might.
 */
import { describe, it, expect } from "vitest";
import {
  REFERENCE_IMAGE_PERSON_REJECTED,
  merchantGenFailureMessage,
  referenceImagePersonRejected,
} from "./gen-failure.js";
import { redactProviderNames } from "./provider-secrecy.js";

/** The exact body the engine returned, straight from the recorded run. */
const MEASURED_REJECTION = JSON.stringify({
  error: {
    code: "InputImageSensitiveContentDetected.PrivacyInformation",
    message:
      "The request failed because the input image 'content[1]' may contain real person. "
      + "Request id: 021786186880661c323afa74840446e61be924aaf3459eedb6c0b",
    param: "content[1]",
    type: "BadRequest",
  },
});

describe("referenceImagePersonRejected — only what the engine really said", () => {
  it("recognises the measured refusal", () => {
    expect(referenceImagePersonRejected(MEASURED_REJECTION)).toBe(true);
  });

  it("recognises it from the code alone, and from the message alone", () => {
    // The worker only ever sees the first 300 characters of the body, and a code can be
    // renamed under us. Either marker on its own has to be enough.
    expect(referenceImagePersonRejected(`{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation"`)).toBe(true);
    expect(referenceImagePersonRejected("The request failed because the input image 'content[0]' may contain real person.")).toBe(true);
  });

  it("does not care which content slot the image occupied", () => {
    // Where the picture sits in the request is a fact about the request we built, not about
    // the refusal — a first+last-frame job puts it somewhere else.
    expect(referenceImagePersonRejected(MEASURED_REJECTION.replace("content[1]", "content[2]"))).toBe(true);
  });

  // FAIL CLOSED. Everything here must keep the ordinary failure route: telling a merchant to
  // crop a face out of a picture that was never the problem is worse than the generic apology.
  it.each([
    ["a rate limit", `{"error":{"code":"QuotaExceeded.RPM","message":"Too many requests","type":"TooManyRequests"}}`],
    ["a bad key", `{"error":{"code":"AuthenticationError","message":"invalid api key","type":"Unauthorized"}}`],
    ["a rejected parameter", `{"error":{"code":"InvalidParameter","message":"duration must be one of 4,5,...","type":"BadRequest"}}`],
    ["a DIFFERENT moderation category", `{"error":{"code":"InputImageSensitiveContentDetected.Violence","message":"The request failed because the input image 'content[1]' was rejected.","type":"BadRequest"}}`],
    ["the family prefix with no sub-code", `{"error":{"code":"InputImageSensitiveContentDetected","message":"rejected","type":"BadRequest"}}`],
    ["an empty body", ""],
    ["a body about a person that is not an input-image refusal", "the prompt may contain real person names"],
  ])("does not claim %s is this refusal", (_label, body) => {
    expect(referenceImagePersonRejected(body)).toBe(false);
  });

  it("treats a missing body as unrecognised, not as a match", () => {
    expect(referenceImagePersonRejected(null)).toBe(false);
    expect(referenceImagePersonRejected(undefined)).toBe(false);
  });
});

describe("REFERENCE_IMAGE_PERSON_REJECTED — what the merchant actually reads", () => {
  it("names no engine, model or vendor", () => {
    // Written vendor-free at the source, not scrubbed on the way out.
    for (const secret of ["seedance", "seedream", "byteplus", "bytedance", "dreamina", "ark", "jimeng"]) {
      expect(REFERENCE_IMAGE_PERSON_REJECTED.toLowerCase()).not.toContain(secret);
    }
  });

  it("survives the provider-name redactor byte for byte", () => {
    // Load-bearing, not decorative: the whitelist below compares bytes, so a sentence the
    // redactor rewrote on its way to the merchant would stop being recognised as ours — and
    // the merchant would silently drop back to the generic apology.
    expect(redactProviderNames(REFERENCE_IMAGE_PERSON_REJECTED)).toBe(REFERENCE_IMAGE_PERSON_REJECTED);
  });

  it("fits inside the 300-character cap every persisted job error is truncated to", () => {
    expect(REFERENCE_IMAGE_PERSON_REJECTED.length).toBeLessThanOrEqual(300);
  });

  it("says what is wrong, what to do about it, and that no money moved", () => {
    expect(REFERENCE_IMAGE_PERSON_REJECTED).toContain("face");
    expect(REFERENCE_IMAGE_PERSON_REJECTED).toContain("Try one where the face isn't visible");
    expect(REFERENCE_IMAGE_PERSON_REJECTED).toContain("You weren't charged.");
  });
});

describe("merchantGenFailureMessage — a whitelist, never a passthrough", () => {
  it("gives our own sentence back", () => {
    expect(merchantGenFailureMessage(REFERENCE_IMAGE_PERSON_REJECTED)).toBe(REFERENCE_IMAGE_PERSON_REJECTED);
  });

  it("survives whitespace on the way through storage", () => {
    expect(merchantGenFailureMessage(`  ${REFERENCE_IMAGE_PERSON_REJECTED}  `)).toBe(REFERENCE_IMAGE_PERSON_REJECTED);
  });

  // GenJob.error is an OPS column as much as a merchant one. These are real strings the worker
  // writes into it; not one of them may be shown to a merchant as advice.
  it.each([
    "conditioning refs unreachable (0/1) — refusing to spend",
    "generation provider video submit failed (400)",
    "stale GENERATING reaped — worker hung or crashed; refunded",
    "queued too long — worker never picked it up; refunded",
    "",
    "   ",
  ])("refuses to present %j as merchant advice", (persisted) => {
    expect(merchantGenFailureMessage(persisted)).toBeNull();
  });

  it("refuses text that merely STARTS with one of our sentences", () => {
    // Exact match, so nothing can ride into a merchant's view on the back of our own words.
    expect(merchantGenFailureMessage(`${REFERENCE_IMAGE_PERSON_REJECTED} …and here is the raw engine reply`)).toBeNull();
  });

  it("treats an absent error as nothing to say", () => {
    expect(merchantGenFailureMessage(null)).toBeNull();
    expect(merchantGenFailureMessage(undefined)).toBeNull();
  });
});
