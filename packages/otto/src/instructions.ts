// Otto durable identity + creative rules — **the assembler**, not the text.
//
// 单体退役了（`docs/specs/otto-engine.md` §7.2⑥，ENGINE-A7）。4.3 万字节的 `ottoInstructions`
// 常量从前住在这个文件里、每一轮整份塞进模型；现在知识住在 `packages/otto/knowledge/**.md`
// 的技能文件柜里，`scripts/gen-knowledge.ts` 在 build 期把它抄成 `knowledge-cabinet.generated.ts`
// 的常量表，本文件负责**每轮现装**：常驻薄层 `_core.md` ＋ 全部书脊标签 ＋ 这一轮对上标签的那几份全文。
//
// 仍然 **NOT a runtime file read**（§7.0 拍板三，理由与单体时代同一条）：柜里的 markdown 在构建
// 之前变成 TS 常量，所以四个运行时读到同一份字节 —— Next.js/Turbopack(web)、tsx(worker)、
// dist、vitest。`readFileSync(new URL(...))` 曾被 Next/Turbopack 的 fs shim 在运行期拒绝。
//
// **占位符是这个文件存在的第二个理由。** 柜里的 markdown 是死文本，而说明书里有一批值必须
// **现算**——抄一份就是这个仓库反复重学的那种「说的与做的失同步」：
//   · #643 T2 图片形状菜单、#801 界面地图、#802 只许提地图里存在的入口、#922 下架名单、
//     MONEY-A9 理解报价、MONEY-A10 搜索单价与单轮上限、Creation §5 可售画质白名单。
// 每一条的唯一权威都在 `@fikirtive/core`，柜里的文件只写 `{{占位符}}`，值在这里现算插进去。
// 名单外的占位符 = 装配当场抛（fail closed）：一个写错的占位符宁可炸，也不能悄悄以字面量
// 出现在商家看到的那句话里。
import {
  CREATE_NAV_LABEL,
  GEN_IMAGE_ASPECTS,
  MESSAGING_STATUS_ASSISTANT,
  anchoredActionUnavailableReason,
  displayCredits,
  merchantNavMap,
  navLabel,
  navPath,
  pricedUnderstandingCredits,
  OTTO_CHAT_MAX_SEARCHES_PER_TURN,
  searchUnitChargeInternal,
  SELLABLE_VIDEO_RESOLUTIONS,
} from "@fikirtive/core";
import { KNOWLEDGE_CABINET } from "./knowledge-cabinet.generated.js";
import {
  CORE_PATH,
  loadableFiles,
  matchKnowledge,
  spineIndex,
  type KnowledgeFile,
} from "./knowledge-cabinet.js";

/**
 * 商家点得到的那几档画质,**现算一次插进说明书**(Creation §5 2026-09-04,CREATE-A4)。
 *
 * 唯一权威是可售白名单 `SELLABLE_VIDEO_RESOLUTIONS`(spend.ts)—— 与付费闸
 * `assertSpendableModel`、卡面报价读的是同一份。抄一份档位表在这段话里,就会有一天
 * Otto 还在热心地教商家点一个早已下架的档,而付费闸在批准那一刻把它拒了。
 * 跨槽位去重(同一档可能落在不同引擎上),按数字从小到大排 —— 商家读到的是能力,不是引擎。
 */
const SELLABLE_VIDEO_TIERS: readonly string[] = [
  ...new Set(Object.values(SELLABLE_VIDEO_RESOLUTIONS).flatMap((list) => [...list])),
].sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

/**
 * 素材理解的三格价,**现算一次插进说明书**(MONEY-A9,规格 §7.3)。
 *
 * 照 `research-agent.ts` 的 `SEARCH_COST_PER_CALL_DISPLAY` 先例:提示词里抄一个价,就是把
 * 价目表复制到了一个没人会想起要更新的地方 —— 而这一份还是**说给模型听的**,它一旦过期,
 * Otto 会当着商家的面报一个假价。改钉点,这段话当场跟着改口(golden 快照因此会红一次,
 * 那是要的:价变了就该有人复审这段 diff)。
 *
 * 为什么 importMedia 必须自己报价:三个人手上传入口各有一行价目小字,而 URL 导入是一个
 * **没有界面的服务端动作** —— 动作层的这句话是商家在被扣费之前唯一可能看见的披露。
 */
const UNDERSTANDING_PRICE_SENTENCE =
  `Everything that lands is read automatically so you know what is in it, and the user is charged for that reading ` +
  `at the price in effect when it is queued for understanding, which can be later than the import if there is a backlog: ` +
  `${displayCredits(pricedUnderstandingCredits("image-caption"))} credits for an image, ` +
  `${displayCredits(pricedUnderstandingCredits("video-qa"))} credits for a video, and ` +
  `${displayCredits(pricedUnderstandingCredits("doc-extract"))} credits again if that image turns out to be a menu ` +
  `or price list and has to be read as a document.`;

/**
 * 聊天里一次网页搜索的价,和一轮的次数上限 —— **现算**(MONEY-A10,规格 §7.4)。
 *
 * 同 UNDERSTANDING_PRICE_SENTENCE 的理由,只是这一条更硬:这段话直接改变 Otto 的**搜索
 * 行为**。在 2026-09-02 之前它写的是「It is $0」—— 那句话既让模型放心多搜,又是假的:
 * 每一次 query 都在打同一个付费搜索 API,只是没人计价。价一旦写死在这里,涨价当天模型就会
 * 拿着旧数字决定该不该再搜一次。
 */
const CHAT_SEARCH_PRICE_CLAUSE =
  `reading a page by \`url\` is free, each \`query\` search costs the user about ` +
  `${displayCredits(searchUnitChargeInternal("basic"))} credits, and one turn allows at most ` +
  `${OTTO_CHAT_MAX_SEARCHES_PER_TURN} searches`;

/**
 * 「把这条片子接下去」这一条规矩,按下架名单当场决定怎么写。
 *
 * 关着的时候不是删掉这一条 —— 删掉商家一问,Otto 就只能自己编;写成一条**明确的**
 * 「这件事现在做不到,照实说这一句」,他才既不瞎编也不空手。
 */
function ottoCarryOnRule(): string {
  const off = anchoredActionUnavailableReason("extendClip");
  if (off === null) {
    return "**Carry it on** (\"keep it going\", \"what happens next\", \"make it longer\") → `seedancePrompt` with `mode:'extend'` (`extendDirection` 'forward' by default, 'backward' for what came before).";
  }
  return `**Carry it on** ("keep it going", "what happens next", "make it longer") → NOT AVAILABLE right now. Never build it, never propose it, never promise it for later. Say exactly this and stop: "${off}"`;
}

export const ottoSimpleModeBlock = `## Talking to a beginner (Simple mode)
This user has no marketing or AI knowledge. Use plain language only — warm and simple, never technical.
- Never say: "generation", "render", "model", "keyframe", "proposal", "parameters", "verdict".
- Instead say: "image" / "video", "starting picture", "idea", and "how does this look?".
- Ask at most 2-3 short questions before proposing something.
- When something is ready, ask simply "how does this look — want any changes?".`;

/**
 * 柜里 `{{占位符}}` 的**唯一名单**。每一格是一个现算的值（上面的注释逐条写了为什么）。
 * `{{spineIndex}}` 不在这里：它是柜子自己的形状，由装配时的柜子算出来。
 */
function placeholderValues(): Record<string, string> {
  return {
    merchantNavMap: merchantNavMap(),
    "navPath:connections": navPath("connections"),
    "navPath:library": navPath("library"),
    "navPath:billing": navPath("billing"),
    "navLabel:library": navLabel("library"),
    "navLabel:brand": navLabel("brand"),
    messagingStatus: MESSAGING_STATUS_ASSISTANT,
    createNavLabel: CREATE_NAV_LABEL,
    chatSearchPrice: CHAT_SEARCH_PRICE_CLAUSE,
    chatMaxSearches: String(OTTO_CHAT_MAX_SEARCHES_PER_TURN),
    videoTiers: SELLABLE_VIDEO_TIERS.join(", "),
    imageAspects: GEN_IMAGE_ASPECTS.join(", "),
    carryOnRule: ottoCarryOnRule(),
    understandingPrices: UNDERSTANDING_PRICE_SENTENCE,
    searchUnitPrice: String(displayCredits(searchUnitChargeInternal("basic"))),
  };
}

/**
 * 纯：把一份柜文的 `{{占位符}}` 换成现算的值。名单外的名字**当场抛** —— 一个写错的
 * 占位符若被静默留下，商家会在说明书里读到 `{{navPath:bulling}}` 这样的字面量。
 */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{([A-Za-z]+(?::[A-Za-z-]+)?)\}\}/g, (_m, name: string) => {
    const v = values[name];
    if (v === undefined) throw new Error(`知识文件里有一个不认识的占位符：{{${name}}}`);
    return v;
  });
}

/** 一轮装出来的说明书，外加**装了哪几份**（②段 ENGINE-A2 的 `skillFiles` 那一栏读它）。 */
export type AssembledInstructions = {
  readonly text: string;
  /** 柜内路径，装配顺序；`_core.md` 永远第一。 */
  readonly files: readonly string[];
};

/**
 * 每轮现装（取用三规则②③）：常驻 `_core.md` ＋ 全部书脊标签 ＋ 对上标签的那几份全文。
 *
 * 纯函数、无跨轮状态：同一段话每次装出同一份说明书 —— 这正是⑥段能与③段基线**对分**的前提，
 * 也是「用完不带入下一轮」在代码里的形状（没有可带的东西）。
 */
export function assembleOttoInstructions(
  turnText: string,
  cabinet: readonly KnowledgeFile[] = KNOWLEDGE_CABINET,
): AssembledInstructions {
  const values = { ...placeholderValues(), spineIndex: spineIndex(cabinet) };
  const picked = matchKnowledge(turnText, cabinet);
  return {
    text: picked.map((f) => fillPlaceholders(f.text, values)).join("\n\n"),
    files: picked.map((f) => f.path),
  };
}

/**
 * **整柜**装出来的说明书 —— 每一份知识文件都在里面。
 *
 * 两个用途，都不是「每一轮」：
 *  ① 组合根 `otto.ts` 拿它当 Agent 的底稿，恢复轮（approval-resume）照 B9「恢复轮全量装载」
 *    直接用它；② 全部存在性守卫与 §7.3 的评测台架读它 —— 「这句话还在说明书里吗」问的是
 *    整个柜子，不是某一轮碰巧装了哪几份。
 *
 * 常驻部分（`_core.md`）仍**逐字节冻结**在 `__snapshots__/otto-core.golden.txt`；按需装载的
 * craft/ playbooks/ product-map/ 不再逐字节冻结，改由评测分数把关（§7.2⑥ 的迁移原话）。
 */
export const ottoInstructions: string = (() => {
  const values = { ...placeholderValues(), spineIndex: spineIndex(KNOWLEDGE_CABINET) };
  return loadableFiles(KNOWLEDGE_CABINET)
    .map((f) => fillPlaceholders(f.text, values))
    .join("\n\n");
})();

/** 整柜装载时装的那一份名单（`reference` 件不在内）。②段记的 `skillFiles` 就是它。 */
export function allKnowledgePaths(): readonly string[] {
  return loadableFiles(KNOWLEDGE_CABINET).map((f) => f.path);
}

/** 常驻薄层单独一份（golden 快照钉的就是它）。 */
export const ottoCoreInstructions: string = (() => {
  const core = KNOWLEDGE_CABINET.find((f) => f.path === CORE_PATH);
  if (!core) throw new Error(`技能文件柜里没有 ${CORE_PATH}`);
  return fillPlaceholders(core.text, {
    ...placeholderValues(),
    spineIndex: spineIndex(KNOWLEDGE_CABINET),
  });
})();
