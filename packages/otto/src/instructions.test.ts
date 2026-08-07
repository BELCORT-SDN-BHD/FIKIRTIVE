import { describe, it, expect } from "vitest";
import { ottoSimpleModeBlock, ottoInstructions } from "./instructions.js";

describe("ottoSimpleModeBlock", () => {
  it("simple-mode block bans jargon in plain language", () => {
    expect(ottoSimpleModeBlock).toMatch(/plain language/i);
    expect(ottoSimpleModeBlock).toMatch(/generation|render|model|keyframe/i); // names the banned words to avoid
    expect(ottoSimpleModeBlock).toMatch(/how does this look/i); // provides the plain replacement instead of a "verdict"
  });
});

describe("ottoInstructions — Honesty & limits", () => {
  it("contains the honesty section header", () => {
    expect(ottoInstructions).toContain("Honesty & limits");
  });

  it("instructs Otto never to assert status it doesn't know", () => {
    expect(ottoInstructions).toMatch(/never assert/i);
  });

  it("instructs Otto it cannot see the user's screen or UI", () => {
    expect(ottoInstructions).toMatch(/cannot see/i);
  });

  it("instructs Otto to own capability boundaries and offer alternatives", () => {
    // names capabilities that Otto can't do yet
    expect(ottoInstructions).toMatch(/publishing|schedul/i);
    // instructs honest decline with an offer of what it can do
    expect(ottoInstructions).toMatch(/say so plainly/i);
    expect(ottoInstructions).toMatch(/can.*do/i);
  });
});

describe("ottoInstructions — brand memory guidance", () => {
  it("references rememberBrandFact tool", () => {
    expect(ottoInstructions).toMatch(/rememberBrandFact/);
  });

  it("includes brand memory section", () => {
    expect(ottoInstructions).toMatch(/brand memory/i);
  });

  it("scopes to durable facts (not one-off choices)", () => {
    expect(ottoInstructions).toMatch(/durable/i);
    expect(ottoInstructions).toMatch(/one-off/i);
  });

  it("keeps Brand memory distinct from the Project brief and never calls either a brand brief", () => {
    expect(ottoInstructions).toMatch(/Brand memory[\s\S]*Project brief|Project brief[\s\S]*Brand memory/i);
    expect(ottoInstructions).not.toMatch(/brand brief/i);
  });
});

describe("ottoInstructions — meta-action tool name (F26)", () => {
  it("references the registered kebab-case tool name, not the un-callable camelCase alias", () => {
    // The skill is registered as "propose-meta-action" (skills/propose-meta-action.ts).
    // Instructing the model to call `proposeMetaAction` means it can never invoke the tool.
    expect(ottoInstructions).toContain("propose-meta-action");
    expect(ottoInstructions).not.toMatch(/proposeMetaAction/);
  });
});

describe("ottoInstructions — video keyframes", () => {
  it("prompt instructs Otto to pass forVideo:true when making an image keyframe for a video", () => {
    expect(ottoInstructions).toMatch(/forVideo/);
  });
});

describe("ottoInstructions — attached reference image", () => {
  it("instructs Otto to pick kind from intent for an attached reference (animate → video, style → image)", () => {
    expect(ottoInstructions).toContain("Attached reference");
    expect(ottoInstructions.toLowerCase()).toContain("animate");
    // style/inspiration → image branch (locks the full intent rule, not just the video branch)
    expect(ottoInstructions.toLowerCase()).toContain("style");
    // default-to-image guidance so a reference never silently forces video
    expect(ottoInstructions.toLowerCase()).toContain("default to");
  });
});

describe("ottoInstructions — 刨根问底 (intent before creating)", () => {
  it("has the intent-first section", () => {
    expect(ottoInstructions).toMatch(/刨根问底|before you propose|before creating/i);
  });
  it("tells Otto to autofill from brand memory and ask only for gaps", () => {
    expect(ottoInstructions).toMatch(/brand memory/i);
    expect(ottoInstructions).toMatch(/only for what.?s (genuinely )?missing|only for the gaps|only ask/i);
  });
  it("tells Otto how to handle a needMoreInfo tool result", () => {
    expect(ottoInstructions).toContain("needMoreInfo");
  });
});

describe("ottoInstructions — model prompt routing", () => {
  it("routes image → seedreamPrompt and video → seedancePrompt", () => {
    expect(ottoInstructions).toMatch(/seedreamPrompt/);
    expect(ottoInstructions).toMatch(/seedancePrompt/);
  });
  it("tells Otto to feed the result into propose's structuredPrompt", () => {
    expect(ottoInstructions).toMatch(/structuredPrompt/);
  });
  it("tells Otto to supply the craft (users don't know photography)", () => {
    expect(ottoInstructions).toMatch(/camera|lighting/i);
  });
  it("tells Otto to use t2v when there is no source frame", () => {
    expect(ottoInstructions).toMatch(/t2v/);
  });
});

describe("ottoInstructions — audit fix: propose/identity/keyframe reconciled with prompt-skill routing", () => {
  it("tells Otto not to hand-write structuredPrompt for these models (Fix 5)", () => {
    expect(ottoInstructions).toMatch(/don't hand-write|do not hand-write|build that structuredPrompt/i);
  });

  it("tells Otto desiredDuration/desiredAspect/desiredAudio go on propose, not the prompt text (Fix 10)", () => {
    expect(ottoInstructions).toMatch(/desiredDuration/);
    expect(ottoInstructions).toMatch(/desiredAspect/);
  });

  it("#643 T2:图片形状菜单是插值进来的真菜单 —— 不是抄在文本里的一份副本", async () => {
    const { GEN_IMAGE_ASPECTS, GEN_IMAGE_DEFAULT_ASPECT } = await import("@fikirtive/core");
    // 每一格都真的出现在指令里（菜单加一格，这条自动开始要求它出现）。
    for (const aspect of GEN_IMAGE_ASPECTS) expect(ottoInstructions).toContain(aspect);
    expect(ottoInstructions).toContain(GEN_IMAGE_ASPECTS.join(", "));
    // 菜单外的形状会被交付成默认形状，这句话必须说出口。
    expect(ottoInstructions).toMatch(new RegExp(`delivered as ${GEN_IMAGE_DEFAULT_ASPECT}`));
  });

  it("bridges the keyframe rule to seedreamPrompt's forVideo (Fix 8)", () => {
    expect(ottoInstructions).toMatch(/keyframe/i);
    expect(ottoInstructions).toMatch(/forVideo/);
  });
});

describe("ottoInstructions — web research (researchWeb query→url→page)", () => {
  it("has a research section that names the researchWeb tool", () => {
    expect(ottoInstructions).toMatch(/research/i);
    expect(ottoInstructions).toMatch(/researchWeb/);
  });
  it("teaches the query→url two-step (thin list first, then read chosen pages)", () => {
    expect(ottoInstructions).toMatch(/query/);
    expect(ottoInstructions).toMatch(/snippet|thin/i);
  });
  it("teaches page-by-page reading (paging token)", () => {
    expect(ottoInstructions).toMatch(/totalPages|page by page|page-by-page|page: ?\d/i);
  });
  it("warns against reading everything / dumping whole pages at once", () => {
    expect(ottoInstructions).toMatch(/do not (try to )?open every|don't (try to )?open every|not.*every (search )?result|read page by page|sparingly/i);
  });
});

describe("ottoInstructions — deep vs lightweight (proposeResearch)", () => {
  it("names the proposeResearch tool for deep research", () => {
    expect(ottoInstructions).toMatch(/proposeResearch/);
  });
  it("says proposeResearch costs credits and needs the user's approval", () => {
    // anchor to the approval/credits gate — the new deep-research content, not the S1 researchWeb section
    expect(ottoInstructions).toMatch(/proposeResearch/);
    expect(ottoInstructions).toMatch(/approve|approval|costs? credits|charged/i);
  });
  it("is honest that proposeResearch only lays out the PLAN — research runs after approval", () => {
    // Anchor to phrases UNIQUE to the proposeResearch honesty paragraph — NOT the
    // pre-existing proposeStoryboard "only lays out the plan" line (which /only.*plan/
    // would also satisfy). These two phrases occur only in the new deep-research content.
    expect(ottoInstructions).toMatch(/does not research anything yet/i);
    expect(ottoInstructions).toMatch(/never claim you already researched/i);
  });
  it("distinguishes lightweight researchWeb from deep proposeResearch in the research context", () => {
    // both tools must be named so the lightweight-vs-deep routing is unambiguous
    expect(ottoInstructions).toMatch(/researchWeb/);
    expect(ottoInstructions).toMatch(/proposeResearch/);
  });
  it("gates proposeResearch on a topic (刨根问底)", () => {
    expect(ottoInstructions).toMatch(/topic/);
  });
});

describe("ottoInstructions — reference video", () => {
  it("mentions an attached reference video guides motion/style of a video plan", () => {
    expect(ottoInstructions.toLowerCase()).toContain("reference video");
  });
});

describe("ottoInstructions — storyboard routing", () => {
  it("names the proposeStoryboard tool", () => {
    expect(ottoInstructions).toMatch(/proposeStoryboard/);
  });
  it("routes multi-shot video/ad requests to a storyboard", () => {
    expect(ottoInstructions).toMatch(/storyboard/i);
    expect(ottoInstructions).toMatch(/multi-shot|multiple shots|several shots|scene/i);
  });
  it("tells Otto to build each shot's prompts with the model skills first", () => {
    // 锚定 storyboard 专属 token(firstFramePrompt/videoPrompt),而非到处都出现的
    // seedreamPrompt/seedancePrompt —— 否则断言在别处也能满足,失去意义。
    expect(ottoInstructions).toMatch(/firstFramePrompt/);
    expect(ottoInstructions).toMatch(/videoPrompt/);
  });
  it("tells Otto to pass @-entity ids via the shot's entityIds (reference image reaches the model)", () => {
    expect(ottoInstructions).toMatch(/entityIds/);
  });
  it("makes clear the storyboard itself spends nothing", () => {
    expect(ottoInstructions).toMatch(/no credits|nothing is charged|does not spend|doesn.t spend/i);
  });
});

describe("ottoInstructions — #498 verbal approval honesty (generate)", () => {
  it("states that calling generate only pauses for the card's confirmation, never starts work", () => {
    expect(ottoInstructions).toMatch(/does NOT make anything by itself/);
    expect(ottoInstructions).toMatch(/only after the user confirms on the card/i);
  });
  it("requires narrating the pending confirmation after calling generate", () => {
    expect(ottoInstructions).toMatch(/ALWAYS say in your reply that the card is now waiting/);
    expect(ottoInstructions).toMatch(/never leave the turn silent/i);
  });
  it("forbids inviting a words-only go-ahead it cannot honor (the walkthrough's exact broken promise)", () => {
    expect(ottoInstructions).toMatch(/NEVER promise that saying a word will directly make things/);
    expect(ottoInstructions).toMatch(/generate all/); // the literal invitation from the #498 repro
    expect(ottoInstructions).toMatch(/you cannot keep that promise/i);
  });
});

describe("ottoInstructions — #555 credits and spending", () => {
  it("routes every money question to the readSpending skill", () => {
    expect(ottoInstructions).toMatch(/readSpending/);
    expect(ottoInstructions).toMatch(/how much do I have left/i);
  });
  it("forbids answering from memory when the skill has not been called", () => {
    expect(ottoInstructions).toMatch(/never state, estimate, or guess a balance/i);
    expect(ottoInstructions).toMatch(/you do not know the numbers/i);
  });
  it("names the categories the merchant will actually see", () => {
    expect(ottoInstructions).toMatch(/\*\*Chat\*\* = one conversation turn/);
    expect(ottoInstructions).toMatch(/\*\*Review\*\* = the automatic check/);
  });
  it("requires admitting the window instead of claiming all-time coverage", () => {
    expect(ottoInstructions).toMatch(/window\.hasMore/);
    expect(ottoInstructions).toMatch(/never "everything you've ever spent"/i);
  });
  it("keeps a hold separate from money actually spent", () => {
    expect(ottoInstructions).toMatch(/totals\.charged` is money already SPENT/);
    expect(ottoInstructions).toMatch(/totals\.onHold` is money only HELD/);
    expect(ottoInstructions).toMatch(/never add it to the spent figure/i);
  });
  it("keeps the per-reply cost promise to what actually happens — live, under that reply", () => {
    expect(ottoInstructions).toMatch(/Talking to you costs credits/i);
    // Round-1 review P1②: the old wording ("each reply shows what it cost") over-promised —
    // it is not true after a reload, so the promise is now scoped to the live turn.
    expect(ottoInstructions).toMatch(/While you are replying, the cost of that reply appears underneath it/);
    expect(ottoInstructions).not.toMatch(/Each reply shows what that reply cost/);
  });
  // Round-2 review P1①: pinning one exact wrong sentence let its SYNONYMS survive — the
  // instructions admitted `hasMore` on one line and called the same list "the complete
  // record" two lines later. The guard is now a family ban on completeness claims, and no
  // positive assertion locks any of them in.
  //
  // Round-3 review: four EXACT phrases is still a phrase list, not a family — "the entire
  // history" or "every transaction" would have walked through it. These are patterns over
  // (completeness adjective x record noun) and (universal quantifier x charge noun).
  //
  // Deliberately NOT banned as bare words: "full" and "every" appear all over the
  // instructions legitimately ("fetch full text sparingly", "every call pauses…"), and the
  // instructions QUOTE `never "everything you've ever spent"` in order to forbid it — a
  // ban on that literal string would red-line the very sentence doing the forbidding.
  const COMPLETENESS_OVERCLAIMS = [
    /\b(complete|full|entire|whole)\s+(spending\s+|billing\s+|payment\s+|charge\s+)?(record|history|list|ledger|picture|breakdown)\b/i,
    /\bevery\s+(charge|transaction|payment|purchase)\b/i,
    /\ball\s+(of\s+)?your\s+(charges|transactions|payments|spending|credits\s+spent)\b/i,
  ];

  it("bans every completeness claim about a list that is a bounded window", () => {
    for (const overclaim of COMPLETENESS_OVERCLAIMS) {
      expect(ottoInstructions, `completeness overclaim ${overclaim} must not appear`).not.toMatch(
        overclaim,
      );
    }
  });

  // Positive control: a banned family nobody has tested is a banned family that may match
  // nothing at all. These are the rewrites the round-3 review said would escape a phrase list.
  it("the completeness ban actually catches the rewrites, not just the original wording", () => {
    const escapes = [
      "this is the complete record of your spending",
      "here is your full history",
      "that is the entire billing history",
      "the whole ledger is below",
      "this covers every transaction",
      "you can see every charge here",
      "that is all your charges",
      "this is all of your spending",
    ];
    for (const sentence of escapes) {
      expect(
        COMPLETENESS_OVERCLAIMS.some((pattern) => pattern.test(sentence)),
        `"${sentence}" must be caught by the completeness ban`,
      ).toBe(true);
    }
  });

  // …and does not fire on the legitimate uses, so the guard cannot be "fixed" by deleting it.
  it("the completeness ban leaves honest wording alone", () => {
    const allowed = [
      "fetch full text sparingly",
      "every call pauses as a confirmation step on that card",
      "say your figures cover their recent charges",
      "reorderShots re-sequences with the FULL new order",
      "propose the full two-step plan and total",
    ];
    for (const sentence of allowed) {
      expect(
        COMPLETENESS_OVERCLAIMS.some((pattern) => pattern.test(sentence)),
        `"${sentence}" is honest wording and must NOT be caught`,
      ).toBe(false);
    }
  });
  it("says plainly what to do when the read fails, instead of guessing", () => {
    expect(ottoInstructions).toMatch(/Never fill the gap with a guess/i);
  });
});
