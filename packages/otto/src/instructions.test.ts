/**
 * 威胁模型与守卫结构(#541 r6 终案,断路器三级,编排者裁定)
 * ────────────────────────────────────────────────────────────────────────────
 * 六轮演化一句话总结:**词表判定语义封不死自然英语,所以不再判定语义 —— 改为冻结
 * 字节**。r1→r5 每轮都在加正则(句式枚举 → 通用规则 → 词汇封闭 → 补词 → 真封闭),
 * 判官每轮都用一句新的自然英语穿透(Pick Confirm / costs the same as / three
 * credits 拼写数字)。根因是判定环节本身:只要守卫要"读懂"一句话是不是在点名按钮、
 * 是不是在承诺金额,就总有它没读懂的写法。
 *
 * ── 主守卫:golden 快照 ──────────────────────────────────────────────────
 * `ottoInstructions` 整份文本冻结在 `__snapshots__/otto-instructions.golden.txt`。
 * **任何字节改动 → 红。这个守卫没有判定环节,因此不存在写法逃逸。**
 * 有意修改提示词的人必须同步更新快照,而**快照 diff 就是复审对象** —— 改了什么、
 * 改成什么样,一行不落地摆在复审者面前。
 *
 * ── 辅助:启发式预警 ────────────────────────────────────────────────────
 * 下面的 UI/金额词表与存在断言**降级为启发式**:它们的价值是在常见回归上给出
 * 比"快照对不上"更友好的报错信息(直接指出是按钮点名还是金额承诺)。
 * 它们**不承诺封闭**,漏过某种写法不构成缺陷 —— 完整守卫是 golden 快照。
 *
 * ── 威胁模型 ────────────────────────────────────────────────────────────
 * · golden 快照保证:**任何**提示词改动都被标红并进入复审。
 * · 改动内容的语义真伪(这句话是不是假的、指的控件存不存在)由**跨族判官轮与
 *   复审流程**判定 —— 那需要读代码和界面,不是文本测试能做的事。
 * · 蓄意绕过(连快照一起改)同样由复审把关:快照 diff 让这种改动**无所遁形**,
 *   这正是设计意图 —— 不是把它挡在测试里,是把它摆到复审桌上。
 */
import { describe, it, expect } from "vitest";
import { ottoSimpleModeBlock, ottoInstructions } from "./instructions.js";

describe("ottoInstructions — golden 快照(#541 r6 主守卫)", () => {
  // 没有判定环节:不解析、不匹配、不推断语义,只比字节。
  // 红了不代表错了 —— 只代表"提示词变了,请复审这段 diff"。
  //
  // ⚠️ 这条红了怎么办:
  //  1. 你**有意**改了 `instructions.ts` ⇒ 跑 `vitest -u` 更新快照,把快照 diff
  //     一并提交,复审看的就是它。
  //  2. 你**没碰** `instructions.ts` 却红了 ⇒ 大概率是**上游插值**变了。提示词
  //     用模板串插入了 `@fikirtive/core` 的 `GEN_IMAGE_ASPECTS` /
  //     `GEN_IMAGE_DEFAULT_ASPECT`(见 instructions.ts 的图片形状段),所以改动
  //     图片形状菜单会连带改变提示词文本。这是**真的变了**,同样按 1 更新快照。
  it("整份提示词与 golden 快照逐字节一致", async () => {
    await expect(ottoInstructions).toMatchFileSnapshot(
      "./__snapshots__/otto-instructions.golden.txt",
    );
  });
});

describe("ottoSimpleModeBlock", () => {
  it("simple-mode block bans jargon in plain language", () => {
    expect(ottoSimpleModeBlock).toMatch(/plain language/i);
    expect(ottoSimpleModeBlock).toMatch(/generation|render|model|keyframe/i); // names the banned words to avoid
    expect(ottoSimpleModeBlock).toMatch(/how does this look/i); // provides the plain replacement instead of a "verdict"
  });
});

// ── #805 对外主话术:先说把活干完,「像真人」只是体验 ─────────────────────────
//
// Founder 裁决(2026-08-08 弹窗 产品⑤):主话术是「它帮你把活干完了 —— 建活动、调分群、
// 看钱、换素材」;「像真人」降为体验描述,不作定价论据。Otto 的自我介绍是这条裁决唯一
// 会开口说话的表面 —— 商家问「你是什么/我付钱买到什么」,答的是它做完的活。
//
// 这里不是完整守卫(完整守卫仍是 golden 快照),而是把裁决的两半各钉一句:换掉主话术
// 或删掉降级那句,都会在这里先红,报错直接说明是哪一半。
describe("ottoInstructions — #805 自我介绍先说把活干完", () => {
  it("身份句说的是做完的活,不是「把想法变成生成提案」", () => {
    expect(ottoInstructions).toContain("You get the work done for the user");
    // 四件事各对应一族真技能(plan-campaign / build-segment / read-spending +
    // meta-ad-performance / propose + manage-media)——只说做得到的。
    for (const outcome of [/campaigns/i, /segments/i, /has been spent/i, /creative/i]) {
      expect(ottoInstructions).toMatch(outcome);
    }
  });

  it("「像真人」被降级为体验描述,不许当成付钱的理由", () => {
    expect(ottoInstructions).toContain("Being easy to talk to is HOW you work, never WHAT you are worth");
    expect(ottoInstructions).toContain("never with how human you sound");
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

  // ── 启发式预警(r6 起降级)────────────────────────────────────────────────
  // 以下词表与存在断言**不是**完整守卫,完整守卫是上面的 golden 快照。
  // 它们的作用是:常见回归发生时给出比「快照对不上」更具体的报错(直接说明是
  // 按钮点名还是金额承诺),省掉一次人工定位。
  //
  // **不承诺封闭。** r1→r5 的教训就是词表判定语义封不死自然英语:判官先后用
  // "click Launch"、"Pick Confirm"、"costs the same as"、"three credits"(拼写
  // 数字)穿透过历轮词表。漏过某种写法**不构成缺陷** —— 那一层由快照兜住。
  const UI_VOCAB_ALLOWED = [
    // ① 按钮指路两句(r2 判官已认可,提示词侧一字未动)——它们必须提到 button 才能下禁令。
    "Point at the card, never at a button label — the card walks the user through its own cost check, and you cannot see what its buttons say.",
    "Never tell the user to click a specific button or UI element — describe the outcome they want instead.",
    "The one exception is a card you yourself put in this conversation: you may tell the user to act on that card (approve it, change it, cancel it), because you know it is there — but never name the button on it, because you still cannot see its label.",
    // ② main 的画布文案把 "press" 当**名词**用(一次付费生成),不是 UI 控件。
    //    #603/#605 的批次血缘段。留在词表里会误伤,故按原文剥离;
    //    main 改写这句时这里会红 —— 那正是应该复核的时刻。
    "Cards sharing a `genJobId` came out of ONE press together — `batchIndex` says which of that press this one is and `batchSize` how many it made.",
    // ③ 「你看不见 app 的按钮」这句自陈能力边界,本身要点名 buttons。
    "You cannot see the user's screen, the app's buttons, system logs, your own code, or infrastructure.",
  ];

  // 词表:UI 交互动词 + 控件名词。覆盖常见写法,不覆盖全部(见文件头)。
  // 含 r5 补的 hit/select/choose/toggle。当时先 rg 全文,唯一命中是
  // 「Do NOT choose a model」—— 那是对 Otto 说的挑模型,不是 UI 动作,已无损改写为
  // pick(与 :69 既有用词一致),因此不需要为它开白名单。
  const UI_VOCAB =
    /\b(?:button|buttons|click|clicks|clicked|clicking|press|presses|pressed|pressing|tap|taps|tapped|tapping|hit|hits|hitting|select|selects|selected|selecting|choose|chooses|chose|choosing|toggle|toggles|toggled|toggling)\b/i;

  function stripAllowed(text: string, allowed: string[]): string {
    return allowed.reduce((acc, sentence) => acc.replaceAll(sentence, ""), text);
  }

  it("uses no UI-interaction vocabulary outside the sentences explicitly allowed to", () => {
    const stripped = stripAllowed(ottoInstructions, UI_VOCAB_ALLOWED);
    const hit = stripped.match(UI_VOCAB);
    expect(
      hit,
      `提示词在白名单之外出现了 UI 交互词「${hit?.[0] ?? ""}」—— 大概率是在点名按钮。完整守卫是 golden 快照,这条只是更具体的提示`,
    ).toBeNull();
  });

  it("the closed vocabulary catches every escape the r3 detector let through", () => {
    // 判官 r3 点名的四种穿透 + r1/r2 原句。逐条按「加进提示词后是否命中」验。
    const escapes = [
      "click Launch",
      "press Review cost",
      "press the button labelled Launch",
      "tap the Confirm generate now button", // 三词标签
      "press the Confirm button on the card",
      "tell them to press the Launch button",
      'press "Confirm generate" to start',
      "hit the button when ready", // 含 button
      "clicking the card's control starts it",
      // r5 新补的四组动词:
      "hit Launch to start",
      "select Launch",
      "choose Confirm generate",
      "toggle Auto on",
    ];
    for (const escape of escapes) {
      const stripped = stripAllowed(`${ottoInstructions}\n${escape}`, UI_VOCAB_ALLOWED);
      expect(UI_VOCAB.test(stripped), `已知写法 "${escape}" 应被启发式词表逮住`).toBe(true);
    }
  });

  it("the closed vocabulary leaves label-free card guidance alone", () => {
    // 反向:指向卡片本身、不点名控件的说法加进去仍然绿。
    const safe = [
      "tell them to approve it on the card to start",
      "the only next-step instruction you may give is to approve it on the card itself",
      "say that the card is waiting for their confirmation",
    ];
    for (const sentence of safe) {
      const stripped = stripAllowed(`${ottoInstructions}\n${sentence}`, UI_VOCAB_ALLOWED);
      expect(UI_VOCAB.test(stripped), `不点名的说法 "${sentence}" 不该被逮`).toBe(false);
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

  // 3) 金额启发式 —— 同一把尺子,同样只是预警。
  // 提示词里的钱话的**口径**是:只留 canonical 句 + 两层生成边界;零数字、零比较、
  // 零 free。这条口径由复审与判官轮守;下面的词表只负责在常见回归上早点报警。
  // (r5 判官已证明它挡不住 "costs the same as" 与 "three credits" 这类写法。)
  const MONEY_ALLOWED = [
    // canonical 钱句(#555 唯一披露口径)
    "Talking to you costs credits.",
    // 生成边界:文字不启动、批准前不计生成费
    "no words start it, whatever the user types, and nothing is charged for making an image or video until that approval happens",
    // 既有的、说明生成要批准才花钱的那句
    "Making an image or a video costs credits and never happens without the user approving that specific card first.",
  ];

  // 词表:比较词 + 免费词 + 单价词。覆盖常见写法,不覆盖全部。
  // 「free」用裸词而非词组(r5 验红发现 "It's free" 的缩写绕过了 `is free`),
  // 唯一词法例外是 "free-text"(自由文本,与钱无关),用 lookahead 排除。
  const MONEY_VOCAB =
    /\b(?:as much as|as expensive as|more than|less than|cheaper|costlier|dearer|costs nothing|per image|per video|per turn|per generation)\b|\bfree\b(?!-text)/i;

  // 阿拉伯数字 + credits 的具体金额承诺。注意**只认阿拉伯数字**:
  // 拼写数字("three credits")不在内 —— r5 判官正是这样穿透的,留作提醒。
  const NUMERIC_CREDITS = /\b\d+\s*credits?\b/i;

  it("keeps the canonical money sentence, and makes no comparison or free claim anywhere else", () => {
    // 先肯定式:canonical 句必须在场。
    expect(ottoInstructions).toContain("Talking to you costs credits.");
    const stripped = stripAllowed(ottoInstructions, MONEY_ALLOWED);
    const hit = stripped.match(MONEY_VOCAB);
    expect(
      hit,
      `提示词在白名单之外出现了金额比较/免费词「${hit?.[0] ?? ""}」—— 大概率是回归。完整守卫是 golden 快照,这条只是更具体的提示`,
    ).toBeNull();
    // 具体金额承诺(阿拉伯数字 + credits)。
    const numeric = stripped.match(NUMERIC_CREDITS);
    expect(
      numeric,
      `提示词出现了具体金额承诺「${numeric?.[0] ?? ""}」—— 价目会变,提示词不许写死数字`,
    ).toBeNull();
  });

  it("the money vocabulary catches the comparison and free-typing families", () => {
    const falseClaims = [
      // r3 判官点名的残留原句:
      "Talking to you costs credits — a turn can cost as much as making an image.",
      // r2 原句族:
      "a conversation costs less than an image",
      "talking is cheaper than generating",
      "a turn costs less than a video",
      // r1 原句族:
      "chatting is free",
      "typing costs nothing",
      "replying is free of charge",
      // r5 验红发现的缩写绕过(裸词封禁后被捕获):
      "It's free, immediate, and needs no approval.",
      "this one's free",
      // 单价化:
      "it is 1 credit per image",
      // 具体金额承诺
      "A chat costs 3 credits",
      "this will be 22 credits",
      "that's 1 credit",
    ];
    for (const claim of falseClaims) {
      const stripped = stripAllowed(`${ottoInstructions}\n${claim}`, MONEY_ALLOWED);
      expect(
        MONEY_VOCAB.test(stripped) || NUMERIC_CREDITS.test(stripped),
        `错误金额话 "${claim}" 必须被逮住`,
      ).toBe(true);
    }
  });

  it("the money vocabulary leaves the two allowed true layers alone", () => {
    const stripped = stripAllowed(ottoInstructions, MONEY_ALLOWED);
    expect(MONEY_VOCAB.test(stripped)).toBe(false);
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
    // #791-4: the automatic Review round is gone. Otto is told Review can only appear as
    // an OLD entry and no longer runs — describing it as a live category would be the same
    // "说的≠做的" the round itself was.
    expect(ottoInstructions).toMatch(/\*\*Review\*\* entry — that was an automatic check/);
    expect(ottoInstructions).toMatch(/it no longer runs/);
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

  // #684: the list readSpending returns holds top-ups and grants, which ADD credits. /billing
  // now calls it "credit entries" and counts the charges inside it; instructions that keep
  // calling the whole list "charges" hand the merchant a second story from the same numbers —
  // exactly the split #683 closed for row labels.
  it("calls the readSpending list credit entries, not charges", () => {
    expect(ottoInstructions).toMatch(/`entries` are their recent credit entries/);
    expect(ottoInstructions).toMatch(/NOT all of them are charges/);
    expect(ottoInstructions).toMatch(/ADD credits and are not charges at all/);
    expect(ottoInstructions).toMatch(/OLDER credit entries that are not in it/);
  });

  const WHOLE_LIST_CALLED_CHARGES = [
    /\bOLDER charges\b/,
    /\brecent charges\b/i,
    /\bentries\b[^.]*\bare the recent charges\b/i,
  ];

  it("never calls the whole entry list charges", () => {
    for (const wording of WHOLE_LIST_CALLED_CHARGES) {
      expect(ottoInstructions, `wording ${wording} calls additions charges`).not.toMatch(wording);
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
