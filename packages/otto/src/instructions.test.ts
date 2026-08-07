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
    expect(ottoInstructions).toMatch(
      /NEVER promise that saying, typing, or replying with any word will start the work/,
    );
    // r2 (#541 judge P2): the literal "generate all" invitation used to be QUOTED here as
    // a negative example — a verbatim template even inside a NEVER still models it. The
    // instructions now carry a descriptive ban instead, and the #541 family below keeps
    // every invitation-shaped sentence (quoted or not) out of the instructions for good.
    expect(ottoInstructions).toMatch(/you cannot keep that promise/i);
  });
});

describe("ottoInstructions — #541 approving happens on the card, never by a word", () => {
  // Founder production repro (2026-07-31): despite the #498 rule, Otto still said
  // 'Just say "make it" and I\'ll get it going!' — the runtime then correctly refused the
  // words. Ruling: the only next-step instruction Otto may give for a pending card is to
  // act on the card itself.
  it("names approving on the card as the only way work starts", () => {
    expect(ottoInstructions).toMatch(/approve it on the card/i);
    expect(ottoInstructions).toMatch(/ONLY thing that ever starts the work/i);
  });

  // ── r2 → r3: 钉板降复杂度 ──────────────────────────────────────────────────────
  // r2 的钉板「太聪明反而不承重」,判官三条全指这一点。r3 由编排者直接下调设计,
  // 全部收进本文件,自含、肯定式、通用规则:
  //  1. 通用按钮点名检测器(不是枚举标签 —— 新造的 "Launch button" 也要红);
  //  2. 肯定式存在断言(直接 expect,不许包在 if 里 —— 删句必红);
  //  3. 禁语族扩容(免费打字 + 金额比较句式)。
  // 同时删掉 apps/web 那份跨包拼接式钉板:它把 4 个组件源码 join 后才全局检查,
  // 只改真卡的标签、别处留着旧字符串时照样绿 —— 拼接式设计不可救。组件行为归
  // 组件自己的测试管,不跨包。

  // 1) 通用按钮点名检测器 —— 对整份提示词跑,零命中。
  const BUTTON_NAMING_PATTERNS = [
    // "Confirm button" / "Review cost button" / "Launch button" —— 任何专名 + button
    /\b[A-Z][a-zA-Z]*(?: [A-Za-z]+)? button\b/,
    // 引号包裹的标签点名:press "X" / click 'X' / tap “X”
    /\b(?:press|click|tap|hit|push)\b[^.!?\n]{0,20}["'“”‘’]/i,
    // "the X button" 小写变体
    /\bthe\s+[a-z]+(?:\s+[a-z]+)?\s+button\b/i,
  ];

  it("names no UI button anywhere in the prompt (generic rule, not a label allowlist)", () => {
    for (const pattern of BUTTON_NAMING_PATTERNS) {
      const hit = ottoInstructions.match(pattern);
      expect(
        hit,
        `按钮点名 ${pattern} 命中「${hit?.[0] ?? ""}」—— 提示词不许点名任何按钮标签,Otto 看不见它们`,
      ).toBeNull();
    }
  });

  it("the button-naming detector actually catches naming, including labels that don't exist yet", () => {
    const namings = [
      "press the Confirm button on the card",
      "tell them to press the Launch button", // 从未存在过的新标签也要被逮住
      "click the Review cost button",
      'press "Confirm generate" to start',
      "tap the Approve button",
      "hit 'Go' when you're ready",
    ];
    for (const naming of namings) {
      expect(
        BUTTON_NAMING_PATTERNS.some((pattern) => pattern.test(naming)),
        `按钮点名 "${naming}" 必须被通用检测器逮住`,
      ).toBe(true);
    }
    // 反向:指向卡片本身、不点名标签的说法必须放行。
    const safe = [
      "tell them to approve it on the card to start",
      "the only next-step instruction you may give is to approve it on the card itself",
    ];
    for (const sentence of safe) {
      expect(BUTTON_NAMING_PATTERNS.some((pattern) => pattern.test(sentence))).toBe(false);
    }
  });

  // 2) 肯定式存在断言 —— 直接 expect,没有 if。任一句被删都会红。
  it("keeps the button-naming ban itself in the prompt", () => {
    expect(ottoInstructions).toContain(
      "Never tell the user to click a specific button or UI element",
    );
  });

  it("keeps the narrow carve-out for Otto's own card, and its no-label rider", () => {
    expect(ottoInstructions).toContain("exception is a card you yourself put in this conversation");
    expect(ottoInstructions).toContain("never name the button on it");
  });

  it("keeps the card-approval instruction that the carve-out exists for", () => {
    expect(ottoInstructions).toContain("approve it on the card");
  });

  it("keeps the truth that a conversation turn costs credits", () => {
    expect(ottoInstructions).toContain("Talking to you costs credits");
  });

  // 3) 禁语族扩容 —— 免费打字 + 金额比较。
  // r2 判官 P1-2:「typing never spends what a generation costs」仍是错误的金额保证 ——
  // 一轮对话实测可抵三张图(credit-format.ts 的 #555 实测记录),比较句不成立。
  // r3 裁定:删掉一切金额比较句式,真话只留两层(文字不启动生成 / 对话按轮计费)。
  const FALSE_MONEY_CLAIMS = [
    /\bwords?\b[^.!?\n]{0,40}\bnever\s+spends?\s+credits\b/i,
    /\b(?:typing|talking|words?|chatting|a\s+message)\b[^.!?\n]{0,40}\b(?:never|doesn['’]t|does\s+not|won['’]t)\s+(?:costs?|spends?)\s+(?:you\s+)?(?:any\s+)?credits\b/i,
    /\b(?:typing|talking|chatting)\b[^.!?\n]{0,20}\bis\s+free\b/i,
    // 金额比较句式:拿对话的花费去比生成的花费(任何方向都禁)
    /\b(?:never\s+)?spends?\s+what\s+a\s+generation\s+costs\b/i,
    /\b(?:typing|talking|chatting|a\s+turn|a\s+conversation|words?)\b[^.!?\n]{0,40}\b(?:cheaper|less\s+than|costs?\s+less|more\s+than)\b/i,
  ];

  it("makes no money claim about typing beyond the two true layers", () => {
    for (const claim of FALSE_MONEY_CLAIMS) {
      const hit = ottoInstructions.match(claim);
      expect(hit, `错误金额保证 ${claim} 命中「${hit?.[0] ?? ""}」`).toBeNull();
    }
  });

  it("the money-claim ban catches both the free-typing family and the comparison family", () => {
    const falseClaims = [
      // r1 原句:
      "words never start it and never spend credits",
      "typing never costs credits",
      "talking to me doesn't cost credits",
      "chatting is free",
      "a message never costs you any credits",
      "words will never spend credits",
      // r2 原句(金额比较):
      "typing never spends what a generation costs",
      "and typing never spends what a generation costs.",
      // 比较句的其他方向:
      "a conversation costs less than an image",
      "talking is cheaper than generating",
      "a turn costs less than a video",
    ];
    for (const claim of falseClaims) {
      expect(
        FALSE_MONEY_CLAIMS.some((pattern) => pattern.test(claim)),
        `错误金额保证 "${claim}" 必须被逮住`,
      ).toBe(true);
    }
    // 反向:r3 允许的两层真话必须放行。
    const trueLayers = [
      "nothing is charged for making an image or video until that approval happens",
      "A conversation turn has its own cost either way",
    ];
    for (const sentence of trueLayers) {
      expect(FALSE_MONEY_CLAIMS.some((pattern) => pattern.test(sentence))).toBe(false);
    }
  });

  // #559-style conservative safety lint: these are auditable banned wording families,
  // not a general English classifier. An ambiguous new instruction should be reviewed.
  const SAY_TO_START_INVITATIONS = [
    /\bjust\s+say\b[^.!?\n]{1,50}\b(?:and|then)\b[^.!?\n]{0,12}\b(?:I['’]ll(?:\s+be)?|I\s+will(?:\s+be)?|I['’]m\s+going\s+to)\s+(?:start(?:ing)?|begin(?:ning)?|get(?:ting)?|kick(?:ing)?|mak(?:e|ing)|creat(?:e|ing)|generat(?:e|ing)|build(?:ing)?|run(?:ning)?|do(?:ing)?|render(?:ing)?|animat(?:e|ing))\b/i,
    /\b(?:say|reply|respond|type|write|message|send|answer)\b[^.!?\n]{0,50}\b(?:(?:the\s+)?go(?:[- ]ahead)?|yes|ready|proceed|ok(?:ay)?|make\s+it|generate\s+all|the\s+word)\b[^.!?\n]{0,30}\b(?:and|then)\b[^.!?\n]{0,12}\b(?:I['’]ll(?:\s+be)?|I\s+will(?:\s+be)?|I['’]m\s+going\s+to)\s+(?:start(?:ing)?|begin(?:ning)?|get(?:ting)?|kick(?:ing)?|mak(?:e|ing)|creat(?:e|ing)|generat(?:e|ing)|build(?:ing)?|run(?:ning)?|do(?:ing)?|render(?:ing)?|animat(?:e|ing))\b/i,
    /\b(?:tell(?:\s+me)?|give(?:\s+me)?)\b[^.!?\n]{0,50}\b(?:(?:the\s+)?go(?:[- ]ahead)?|yes|ready|proceed|ok(?:ay)?|make\s+it|generate\s+all|the\s+word)\b[^.!?\n]{0,30}\b(?:and|then)\b[^.!?\n]{0,12}\b(?:I['’]ll(?:\s+be)?|I\s+will(?:\s+be)?|I['’]m\s+going\s+to)\s+(?:start(?:ing)?|begin(?:ning)?|get(?:ting)?|kick(?:ing)?|mak(?:e|ing)|creat(?:e|ing)|generat(?:e|ing)|build(?:ing)?|run(?:ning)?|do(?:ing)?|render(?:ing)?|animat(?:e|ing))\b/i,
    /\b(?:let\s+me\s+know|just\s+confirm)\b[^.!?\n]{0,50}\b(?:and|then)\b[^.!?\n]{0,12}\b(?:I['’]ll(?:\s+be)?|I\s+will(?:\s+be)?|I['’]m\s+going\s+to)\s+(?:start(?:ing)?|begin(?:ning)?|get(?:ting)?|kick(?:ing)?|mak(?:e|ing)|creat(?:e|ing)|generat(?:e|ing)|build(?:ing)?|run(?:ning)?|do(?:ing)?|render(?:ing)?|animat(?:e|ing))\b/i,
    /\b(?:say|reply|respond|type|write|message|send|answer|tell|give)\b[^.!?\n]{0,50}\b(?:(?:the\s+)?go(?:[- ]ahead)?|yes|ready|proceed|ok(?:ay)?|make\s+it|generate\s+all|the\s+word)\b[^.!?\n]{0,30}\b(?:and|then)\b[^.!?\n]{0,12}\bwe['’]re\s+off\b/i,
  ];

  it("bans the whole say-to-start invitation family from the instructions", () => {
    for (const invitation of SAY_TO_START_INVITATIONS) {
      expect(ottoInstructions, `say-to-start invitation ${invitation} must not appear`).not.toMatch(
        invitation,
      );
    }
  });

  // Positive control (same discipline as the completeness family below): a ban that
  // matches nothing proves nothing. Every known rewrite of the broken promise must be
  // caught by at least one family pattern — including the four escapes the r1 judge
  // proved the old family missed (unquoted, reply-led, tell-me-led, curly-quoted).
  it("the invitation ban actually catches the production repro and its rewrites", () => {
    const escapes = [
      'Just say "make it" and I\'ll get it going!',
      "just say yes and we're off",
      'say "go" and I\'ll start right away',
      "say the word and I'll kick things off",
      'tell me "ready" and I\'ll get started',
      // r2 — the r1 judge's escape quartet, verbatim:
      "Say yes and I'll start right away.",
      "Reply yes and I'll start right away.",
      "Tell me yes and I'll get started.",
      "Say ‘go’ and I’ll start right away.",
      // r3 — words-only consent + connector + paid-work promise variants:
      "Reply yes, then I’ll begin the video.",
      "Say yes and I will generate the images.",
      "Tell me to proceed, then I'll build the campaign assets.",
      "Send go-ahead and I will create the ad.",
      "Reply yes and I'll start the paid work.",
      "Say yes then I will run the generation.",
      "Tell me to proceed and I’ll do the image work.",
      "Send go-ahead then I will make the video.",
      "Reply with yes and I'll generate the image.",
      "Send the go-ahead, then I will build the assets.",
      // r4 — token-level rewrites found by the sealed precheck:
      "Reply go and I'll create the image.",
      "Say proceed and I will generate the video.",
      "Type go ahead, then I'll make the ad.",
      "Respond yes and I will build the campaign assets.",
      "Tell me you're ready and I'll start the paid work.",
      "Give me the go-ahead, then I will run the generation.",
      "Just confirm and I'll do the image work.",
      // r5 — the left-hand consent wording is irrelevant to the paid-work promise:
      "Message me when you're ready and I'll generate the image.",
      "Write back go and I will create the video.",
      "Answer yes and I'll build the ad creative.",
      "Let me know and I will make the campaign asset.",
      // r6 — original removed wording plus future morphology / implicit targets:
      "Tell me 'generate all' and I'll make all three at once.",
      "Say okay and I'm going to render the video.",
      "Reply go and I'll be animating it.",
      "Write yes and I'll render it.",
      "Message ready then I will animate the image.",
      "Answer ok and I'm going to start it.",
      "Let me know you're ready and I'll be creating it.",
      // r7 — Founder "just say X" wording may use any short phrase:
      "Just say ship it and I'll start the work.",
      "Just say do it then I will generate the image.",
    ];
    for (const escape of escapes) {
      expect(
        SAY_TO_START_INVITATIONS.some((pattern) => pattern.test(escape)),
        `escape "${escape}" must be caught by the family`,
      ).toBe(true);
    }
  });

  it("leaves obvious non-family wording alone", () => {
    const safeCopy = [
      "Tell me your business goal and I’ll suggest a plan.",
      "We're off to lunch.",
    ];
    for (const sentence of safeCopy) {
      expect(SAY_TO_START_INVITATIONS.some((pattern) => pattern.test(sentence))).toBe(false);
    }
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
