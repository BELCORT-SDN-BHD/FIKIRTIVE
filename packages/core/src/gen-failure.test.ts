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
  GENERATION_DID_NOT_GO_THROUGH,
  REFERENCE_ASSET_UNREACHABLE,
  REFERENCE_IMAGE_PERSON_REJECTED,
  REFERENCE_UNAVAILABLE_REASONS,
  isGenFailureReason,
  merchantGenFailureCopy,
  merchantGenFailureExplanation,
  merchantGenFailureMessage,
  merchantGenFailureReason,
  referenceImagePersonRejected,
  referenceUnavailableMessage,
  referenceUnavailableSentence,
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

/**
 * Codex QA-CRE-007 — the QA report's own finding: Library "Needs attention" and the cast
 * library's variant problem line showed backend/provider sentences verbatim ("reference video
 * unreachable — refusing to spend", "conditioning refs unreachable (0/2)" and siblings). This
 * reason maps every one of those throw sites (apps/worker/src/jobs/gen.ts,
 * apps/worker/src/jobs/refgen.ts) to ONE honest sentence, under the docs/specs/creation-engine.md
 * CREATE-A2 principle — refuse before spend, tell the merchant why, in words they can act on.
 */
describe("REFERENCE_ASSET_UNREACHABLE — CREATE-A2: honest refusal before spend, Codex QA-CRE-007", () => {
  it("names no engine, model or vendor", () => {
    for (const secret of ["seedance", "seedream", "byteplus", "bytedance", "dreamina", "ark", "jimeng"]) {
      expect(REFERENCE_ASSET_UNREACHABLE.toLowerCase()).not.toContain(secret);
    }
  });

  it("survives the provider-name redactor byte for byte", () => {
    expect(redactProviderNames(REFERENCE_ASSET_UNREACHABLE)).toBe(REFERENCE_ASSET_UNREACHABLE);
  });

  it("fits inside the 300-character cap every persisted job error is truncated to", () => {
    expect(REFERENCE_ASSET_UNREACHABLE.length).toBeLessThanOrEqual(300);
  });

  it("CREATE-A2: says nothing was charged, and gives a recovery hint", () => {
    expect(REFERENCE_ASSET_UNREACHABLE).toContain("so nothing was charged");
    expect(REFERENCE_ASSET_UNREACHABLE).toContain("Replace it and try again.");
  });

  it("is not an internal diagnostic — no 'refusing to spend', no 'unreachable ('", () => {
    // The exact two substrings the QA report caught reaching the merchant. If a future edit to
    // this sentence reintroduces either, this is the first thing that goes red.
    expect(REFERENCE_ASSET_UNREACHABLE).not.toContain("refusing to spend");
    expect(REFERENCE_ASSET_UNREACHABLE).not.toContain("unreachable (");
  });

  it("is recognised as the reason 'referenceAssetUnreachable'", () => {
    expect(merchantGenFailureReason(REFERENCE_ASSET_UNREACHABLE)).toBe("referenceAssetUnreachable");
    expect(merchantGenFailureExplanation("referenceAssetUnreachable")).toBe(REFERENCE_ASSET_UNREACHABLE);
  });
});

describe("the ops strings this reason replaces never reach a merchant — Codex QA-CRE-007 grep-guard", () => {
  // Copied verbatim from the throw sites that used to persist these (before this fix): five in
  // apps/worker/src/jobs/gen.ts (conditioning refs, i2v source, last-frame, reference video, edit
  // source) and three in apps/worker/src/jobs/refgen.ts (variant base missing/unreachable,
  // refgen conditioning refs). A row persisted before this fix shipped still carries one of these
  // — the whitelist must keep refusing them, not just refuse the new sentence's opposite.
  const RAW_OPS_STRINGS = [
    "conditioning refs unreachable (0/2) — refusing to spend",
    "source image unreachable — refusing to spend on i2v",
    "last-frame image unreachable — refusing to spend on i2v",
    "reference video unreachable — refusing to spend",
    "edit source image unreachable — refusing to spend",
    "variant base asset is missing — refusing to spend",
    "variant base unreachable — refusing to spend on a degraded generation",
    "conditioning refs unreachable (0/2 signable) — refusing to spend on a degraded generation",
  ];

  it.each(RAW_OPS_STRINGS)("refuses to present %j as merchant advice", (raw) => {
    expect(merchantGenFailureMessage(raw)).toBeNull();
    expect(merchantGenFailureReason(raw)).toBe("unexplained");
  });

  it("no whitelisted sentence itself contains either raw marker — a structural guard against a future reason copying the ops string in", () => {
    for (const reason of GEN_FAILURE_REASONS) {
      if (reason === "unexplained") continue;
      const sentence = String(merchantGenFailureExplanation(reason));
      expect(sentence, `reason "${reason}" reads like an ops string, not merchant copy`).not.toContain("refusing to spend");
      expect(sentence, `reason "${reason}" reads like an ops string, not merchant copy`).not.toContain("unreachable (");
    }
  });
});

/**
 * `merchantGenFailureCopy` — the total function `apps/web/lib/data.ts` (getMyAdJobs) and
 * `apps/web/lib/refgen-actions.ts` (getRefGenJobs) now call so the Library "Needs attention"
 * card and the cast library's variant problem line NEVER render the raw persisted string:
 * a mapped explanation when there is one, `GENERATION_DID_NOT_GO_THROUGH` otherwise.
 */
describe("merchantGenFailureCopy — always a sentence, never the raw string (Codex QA-CRE-007)", () => {
  it("gives the specific explanation for a known reason", () => {
    expect(merchantGenFailureCopy(REFERENCE_ASSET_UNREACHABLE)).toBe(REFERENCE_ASSET_UNREACHABLE);
    expect(merchantGenFailureCopy(REFERENCE_IMAGE_PERSON_REJECTED)).toBe(REFERENCE_IMAGE_PERSON_REJECTED);
  });

  it.each([
    "conditioning refs unreachable (0/2) — refusing to spend",
    "stale GENERATING reaped — worker hung or crashed; refunded",
    "generation provider video submit failed (400)",
    "",
    "   ",
  ])("falls back to the honest generic line for %j, never the raw string", (persisted) => {
    const copy = merchantGenFailureCopy(persisted);
    expect(copy).toBe(GENERATION_DID_NOT_GO_THROUGH);
    if (persisted.trim()) expect(copy).not.toBe(persisted);
  });

  it("falls back to the honest generic line for an absent error", () => {
    expect(merchantGenFailureCopy(null)).toBe(GENERATION_DID_NOT_GO_THROUGH);
    expect(merchantGenFailureCopy(undefined)).toBe(GENERATION_DID_NOT_GO_THROUGH);
  });

  it("the fallback itself names no engine/model/vendor and promises no unproven charge claim", () => {
    for (const secret of ["seedance", "seedream", "byteplus", "bytedance", "dreamina", "ark", "jimeng"]) {
      expect(GENERATION_DID_NOT_GO_THROUGH.toLowerCase()).not.toContain(secret);
    }
    expect(redactProviderNames(GENERATION_DID_NOT_GO_THROUGH)).toBe(GENERATION_DID_NOT_GO_THROUGH);
  });
});

/**
 * `referenceUnavailableSentence` —— 判官 P1-1(PR #1177)。
 *
 * 这是一道**守卫**,不是一个格式化函数:路由在 SSE 打开之前用普通 400 拒绝整轮,客户端
 * (`apps/web/components/otto/OttoChatStream.tsx`)手上只有那段原始 body。把 body 原样上屏,
 * 迟早会把代理的 HTML 错误页、堆栈、内部串送到商家眼前。所以只有**这个文件写给商家的那两句**
 * 认得出来,别的一律回 `null`,由界面用它自己的诚实兜底句收场。
 *
 * 与上面 `merchantGenFailureMessage` 是同一条纪律(白名单,不是 passthrough),测法也照抄。
 */
describe("referenceUnavailableSentence — CREATE-A2: 一份白名单,不是 passthrough", () => {
  it("CREATE-A2: notFound 那一句原样送回来,认得出", () => {
    const sentence = referenceUnavailableMessage("notFound");
    expect(referenceUnavailableSentence(sentence)).toBe(sentence);
  });

  it("CREATE-A2: fileMissing 那一句原样送回来,认得出", () => {
    const sentence = referenceUnavailableMessage("fileMissing");
    expect(referenceUnavailableSentence(sentence)).toBe(sentence);
  });

  it("CREATE-A2: 两个原因一个不落 —— 表里每一句都认得出,且认回它自己", () => {
    // 结构性:将来加第三个原因(比如「格式不支持」),忘了它会在这里红,而不是等到某天
    // 商家看见一段裸 body。
    for (const reason of REFERENCE_UNAVAILABLE_REASONS) {
      const sentence = referenceUnavailableMessage(reason);
      expect(referenceUnavailableSentence(sentence), `reason "${reason}" 没被自己的白名单认出来`)
        .toBe(sentence);
    }
  });

  it("CREATE-A2: 传输层给句子裹了空白 —— 去掉首尾空白后仍然认得出", () => {
    // 唯一允许的宽容,而且是文档写明的:前后空白。信封拆解与换行会带上它们。
    const sentence = referenceUnavailableMessage("notFound");
    expect(referenceUnavailableSentence(`  ${sentence}\n`)).toBe(sentence);
  });

  it("CREATE-A2: 多一个空格、前后加字、大小写变了 —— 一律不认,回 null", () => {
    const sentence = referenceUnavailableMessage("notFound");
    const nearMisses = [
      sentence.replace("references isn't", "references  isn't"), // 句中多一个空格
      `Otto says: ${sentence}`, // 前面加字
      `${sentence} (ref_01H8XYZ)`, // 后面加字(正是我们最怕的那类:尾巴上挂个 id)
      sentence.toLowerCase(), // 大小写变了
      sentence.slice(0, -1), // 少了句末的句号
      sentence.replace(/—/g, "-"), // em dash 被某一层换成了连字符
    ];
    for (const nearMiss of nearMisses) {
      expect(referenceUnavailableSentence(nearMiss), `${JSON.stringify(nearMiss)} 不是我们写的那一句,不该放行`)
        .toBeNull();
    }
  });

  it.each([
    // 代理的 HTML 错误页 —— 这道守卫存在的头号理由。
    "<html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1></body></html>",
    "<!DOCTYPE html>\n<html><body>Request Timeout</body></html>",
    // 堆栈。
    "TypeError: Cannot read properties of undefined (reading 'ownerId')\n    at validateOttoTurnReferences (/app/packages/core/dist/generation-reference.js:46:19)",
    // 传输层自己的话(#949 A2 那一句)。
    "Failed to fetch",
    // 内部串:ops 文案、id、存储路径。
    "conditioning refs unreachable (0/2) — refusing to spend",
    "generation cm_01H8XYZ not found (or not an image) for this account",
    "https://storage.internal/tenants/org_123/generations/cm_01H8XYZ.png",
    // 空的与只有空白的。
    "",
    "   ",
  ])("CREATE-A2: 不是我方文案的 %j —— 回 null,让界面用自己的兜底句", (foreign) => {
    expect(referenceUnavailableSentence(foreign)).toBeNull();
  });

  it("CREATE-A2: 没有 body(null / undefined)也回 null,不抛", () => {
    expect(referenceUnavailableSentence(null)).toBeNull();
    expect(referenceUnavailableSentence(undefined)).toBeNull();
  });

  it("CREATE-A2: 认得出的那两句本身不含 id、URL 或存储路径", () => {
    // 白名单放行的东西必须自己先干净 —— 否则守卫只是把泄露搬进了表里。
    for (const reason of REFERENCE_UNAVAILABLE_REASONS) {
      const sentence = referenceUnavailableMessage(reason);
      expect(sentence).not.toMatch(/https?:\/\//);
      expect(sentence).not.toContain("/");
      expect(sentence).not.toMatch(/\bcm_[a-z0-9]/i);
      expect(redactProviderNames(sentence)).toBe(sentence);
    }
  });
});
