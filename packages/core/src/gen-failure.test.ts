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
  GEN_FAILURE_REASONS,
  REFERENCE_IMAGE_PERSON_REJECTED,
  isGenFailureReason,
  merchantGenFailureExplanation,
  merchantGenFailureMessage,
  merchantGenFailureReason,
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

  it("arrives whole through the 300-character cap the adapter reads replies under", () => {
    // Load-bearing, not trivia: at 274 characters the real reply reaches the classifier with
    // both markers intact. If the engine ever pads this body past the cap, this goes red here
    // rather than silently downgrading live refusals to the generic apology.
    expect(MEASURED_REJECTION.length).toBeLessThanOrEqual(300);
    expect(referenceImagePersonRejected(MEASURED_REJECTION.slice(0, 300))).toBe(true);
  });

  it("recognises it from the code alone, and from the message alone", () => {
    // Either marker on its own has to be enough: a code can be renamed under us, and a reply
    // that does not parse as JSON has no code to read at all.
    expect(referenceImagePersonRejected(`{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"rejected","type":"BadRequest"}}`)).toBe(true);
    expect(referenceImagePersonRejected("The request failed because the input image 'content[0]' may contain real person.")).toBe(true);
  });

  it("does not care which content slot the image occupied", () => {
    // Where the picture sits in the request is a fact about the request we built, not about
    // the refusal — a first+last-frame job puts it somewhere else.
    for (const slot of ["content[0]", "content[2]", "content[12]"]) {
      expect(referenceImagePersonRejected(MEASURED_REJECTION.replace("content[1]", slot))).toBe(true);
    }
  });

  // ── FAIL CLOSED ──────────────────────────────────────────────────────────────────────────
  //
  // Everything below must keep the ORDINARY failure route: retried while it may be transient,
  // and ending in the generic apology. Getting one of these wrong is the expensive direction —
  // the merchant is refused a retry AND told to crop a face out of a picture that was never
  // the problem.
  //
  // The first three are the judge's own counterexamples against r1 (#826 review): r1 matched
  // both markers as substrings, and all three came back `true`. They are pinned by name so the
  // loose matching cannot come back by accident.
  it.each([
    // — judge's counterexamples, r1 answered true for every one of these —
    ["judge: a longer code that merely STARTS with ours (…PrivacyInformationV2)", `{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformationV2","message":"rejected","type":"BadRequest"}}`],
    ["judge: a narrower sub-code under ours (…PrivacyInformation.Other)", `{"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation.Other","message":"rejected","type":"BadRequest"}}`],
    ["judge: the PROMPT was the problem, and the image was explicitly fine", `{"error":{"code":"InputTextSensitiveContentDetected","message":"The input image was accepted, but the prompt may contain real person names.","type":"BadRequest"}}`],
    // — neighbouring shapes of our own, same two failure modes from the other side —
    ["a code we are a SUFFIX of (a vendor prefix bolted on the front)", `{"error":{"code":"ArkInputImageSensitiveContentDetected.PrivacyInformation","message":"rejected","type":"BadRequest"}}`],
    ["the same sentence about the OUTPUT image, not the input", `{"error":{"code":"OutputImageSensitiveContentDetected.PrivacyInformation","message":"The request failed because the output image 'content[1]' may contain real person.","type":"BadRequest"}}`],
    ["a sentence that only shares our words up to 'real personality'", `{"error":{"code":"InvalidParameter","message":"The request failed because the input image 'content[1]' may contain real personality rights material.","type":"BadRequest"}}`],
    ["our code sitting somewhere it means nothing (not error.code)", `{"error":{"code":"InvalidParameter","message":"unrelated","hint":"InputImageSensitiveContentDetected.PrivacyInformation"}}`],
    // — ordinary refusals, which have always had to keep the retry —
    ["a rate limit", `{"error":{"code":"QuotaExceeded.RPM","message":"Too many requests","type":"TooManyRequests"}}`],
    ["a bad key", `{"error":{"code":"AuthenticationError","message":"invalid api key","type":"Unauthorized"}}`],
    ["a rejected parameter", `{"error":{"code":"InvalidParameter","message":"duration must be one of 4,5,...","type":"BadRequest"}}`],
    ["a DIFFERENT moderation category", `{"error":{"code":"InputImageSensitiveContentDetected.Violence","message":"The request failed because the input image 'content[1]' was rejected.","type":"BadRequest"}}`],
    ["the family prefix with no sub-code", `{"error":{"code":"InputImageSensitiveContentDetected","message":"rejected","type":"BadRequest"}}`],
    ["an empty body", ""],
    ["a plain-text gateway page", "<html><body>502 Bad Gateway</body></html>"],
    ["a body about a person that is not an input-image refusal", "the prompt may contain real person names"],
  ])("does not claim %s is this refusal", (_label, body) => {
    expect(referenceImagePersonRejected(body)).toBe(false);
  });

  it("falls back to the ordinary route when a reply is cut off mid-sentence", () => {
    // A body truncated before either marker completes is a reply we cannot read, and an
    // unreadable reply is not this refusal. Costs a retry; never mislabels one.
    const cutMidPhrase = MEASURED_REJECTION.slice(0, MEASURED_REJECTION.indexOf("may contain") + 6);
    expect(referenceImagePersonRejected(cutMidPhrase)).toBe(false);
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

  it("CREATE-A9: says what is wrong, points at the cast library, and that no money moved", () => {
    // 规格 docs/specs/creation-engine.md 验收表 CREATE-A9 —— 「人话提示 + 出路指向演员库」。
    // 逐字钉住,因为这两句是**出路本身**:商家的 Library 在注册时就已经播好了五位演员
    // (apps/web/lib/actor-library-seed.ts),这句话指的是他屏幕上已经有的东西。
    expect(REFERENCE_IMAGE_PERSON_REJECTED).toContain(
      "Real human faces aren't supported yet. Pick a cast member from your Library instead.",
    );
    // 旧口径(「把脸拍到看不见再试一次」)必须消失:2026-08-29/30 实测 13 拒零过,
    // 拒的是**这是谁的脸**,不是脸怎么取景 —— 教商家换个角度重拍等于教他重试一件做不到的事。
    expect(REFERENCE_IMAGE_PERSON_REJECTED).not.toContain("Try one where the face isn't visible");
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

/**
 * #827 — the reason as a NAME, so a card can carry it instead of a surface being handed a
 * sentence in the moment. Same whitelist, asked a different question.
 */
describe("merchantGenFailureReason — the closed set of names", () => {
  it("names the one refusal we can prove", () => {
    expect(merchantGenFailureReason(REFERENCE_IMAGE_PERSON_REJECTED)).toBe("referenceImagePerson");
  });

  // The honest answer for every ordinary failure, and for every card that ended before #827
  // existed. `unexplained` is a MEMBER of the set, which is why no reader needs an "and if there
  // is nothing?" branch it could forget.
  it.each([
    "conditioning refs unreachable (0/1) — refusing to spend",
    "stale GENERATING reaped — worker hung or crashed; refunded",
    `${REFERENCE_IMAGE_PERSON_REJECTED} …and here is the raw engine reply`,
    "",
    "   ",
  ])("answers unexplained for %j", (persisted) => {
    expect(merchantGenFailureReason(persisted)).toBe("unexplained");
  });

  it("answers unexplained for a job that recorded nothing at all", () => {
    expect(merchantGenFailureReason(null)).toBe("unexplained");
    expect(merchantGenFailureReason(undefined)).toBe("unexplained");
  });

  it("survives whitespace on the way through storage, exactly as the sentence reader does", () => {
    expect(merchantGenFailureReason(`  ${REFERENCE_IMAGE_PERSON_REJECTED}  `)).toBe("referenceImagePerson");
  });

  it("only ever answers with a member of the closed set", () => {
    for (const persisted of [REFERENCE_IMAGE_PERSON_REJECTED, "anything else", "", null, undefined]) {
      expect(GEN_FAILURE_REASONS).toContain(merchantGenFailureReason(persisted));
    }
  });
});

describe("isGenFailureReason — the untyped edges land back inside the set", () => {
  it("recognises every name and nothing else", () => {
    for (const reason of GEN_FAILURE_REASONS) expect(isGenFailureReason(reason)).toBe(true);
    // A React node's data bag, a board read from an older deploy, a hand-written fixture.
    for (const stranger of ["", "REFERENCE_IMAGE_PERSON", "referenceimageperson", null, undefined]) {
      expect(isGenFailureReason(stranger)).toBe(false);
    }
  });
});

describe("merchantGenFailureExplanation — ONE table, so two surfaces cannot drift", () => {
  it("gives the whitelisted sentence, byte for byte", () => {
    expect(merchantGenFailureExplanation("referenceImagePerson")).toBe(REFERENCE_IMAGE_PERSON_REJECTED);
  });

  it("gives nothing for an ending with no proven reason", () => {
    // Null is not a gap to paper over: the surface must say its own honest generic thing.
    expect(merchantGenFailureExplanation("unexplained")).toBeNull();
  });

  it("is the same answer the sentence reader gives — one table, asked two ways", () => {
    // This is the join that keeps the card (which holds a name) and the live poll (which holds a
    // sentence) saying the same words about the same job. If these two ever diverge, a merchant
    // reads one story in a toast and another on the card.
    for (const persisted of [REFERENCE_IMAGE_PERSON_REJECTED, "conditioning refs unreachable (0/1) — refusing to spend", "", null]) {
      expect(merchantGenFailureExplanation(merchantGenFailureReason(persisted)))
        .toBe(merchantGenFailureMessage(persisted));
    }
  });

  it("every explained reason has a sentence, and it is white-label", () => {
    for (const reason of GEN_FAILURE_REASONS) {
      if (reason === "unexplained") continue;
      const sentence = merchantGenFailureExplanation(reason);
      expect(sentence, `reason "${reason}" has no sentence`).toBeTruthy();
      // Vendor-free at the source, not scrubbed on the way out — the whitelist compares bytes,
      // so a scrub would silently turn the merchant's own advice back into the generic apology.
      expect(redactProviderNames(String(sentence))).toBe(sentence);
    }
  });
});
