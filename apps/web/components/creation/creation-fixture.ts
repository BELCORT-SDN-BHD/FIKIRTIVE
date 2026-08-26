/**
 * creation-fixture.ts —— 全屏创作对话这一面的事实(没有 React)。
 *
 * 三类东西住在这里,理由都是「不止一处要用,而两处各写一份就会各走各的」:
 *   ① **余额与充值面额** —— 线程内闸卡(Founder 2026-08-26 第 6 件)算的是「还差多少」,
 *      算的时候用的必须是与报价同一套数。价钱本身不在这里 —— 它在 `r22-canvas-fixture.ts`,
 *      这一面一个价格字面量都不写。
 *   ② **@ 候选** —— 商家 @ 得到的东西必须是他**真的**有的东西:仓库里的素材、他的项目、
 *      他教过 Otto 的话。写死四条私种子,商家 @ 出来的会是他从没见过的名字。
 *   ③ **起手问卷** —— 一句话太含糊时先问的那两道题。判词与 Library 快产车间同一条
 *      (`isVagueCreationRequest`),不另发明第二套「什么叫含糊」。
 */
import type { MentionCandidate } from "@/components/otto/conversation/MentionField";
import {
  QUICK_CREATE_PROJECT_NAME,
  libraryProjects,
  visibleLibraryAssets,
  type LibraryArchive,
} from "@/components/library/library-fixture";
import { readOttoIQSavedRows } from "@/components/otto-iq/otto-iq-fixture";
import type { QuestionnaireQuestion } from "@/components/otto/conversation/ConversationParts";

/* ── 余额(闸卡算的那几个数)────────────────────────────────────────────────── */

/**
 * 这个样例工作区开局有多少 cr。
 *
 * 它有意**不大**:第 6 件要演的正是「连着做几次就撞上闸」,而一个大到撞不上的余额等于
 * 把闸卡藏起来 —— 那张卡商家永远看不到,也就永远没被验过。
 */
export const CREATION_FIXTURE_START_CREDITS = 9;

/** 闸卡主键一次加多少 cr(与 Settings 那份充值面额的第一档同一个数)。 */
export const CREATION_FIXTURE_TOPUP_CREDITS = 200;

/** 充值那一下的诚实回执 —— 口径照 Settings 现行那一句(“in this preview”)。 */
export const CREATION_TOPUP_NOTICE = `${CREATION_FIXTURE_TOPUP_CREDITS} cr added in this preview.`;

/** 「还剩多少 · 这一批要多少」那一行。闸卡与 composer 报价读的是同一组数。 */
export function creationBalanceLine(balance: number, needed: number): string {
  return `${balance} cr left · this one needs ${needed} cr`;
}

/** 这一次做得起吗。够不够只有这一处判 —— 界面上那颗发送键与闸卡问的是同一个问题。 */
export function creationCanAfford(balance: number, needed: number): boolean {
  return balance >= needed;
}

/* ── @ 候选 ─────────────────────────────────────────────────────────────────── */

export const MENTION_GROUP_LIBRARY = "Library";
export const MENTION_GROUP_PROJECTS = "Projects";
export const MENTION_GROUP_OTTO_IQ = "Otto IQ";

/**
 * 商家此刻 @ 得到的东西。
 *
 * 三类各有各的来源,全部是他**真的**有的:仓库存档里没被收起来的素材、这些素材归到的
 * 项目、以及他教给 Otto 的那几条(研究链批准之后落进去的也在里面 —— 刚批完就 @ 得到)。
 * 一条私种子都没有。
 */
export function creationMentionCandidates(archive: LibraryArchive): MentionCandidate[] {
  const assets = visibleLibraryAssets(archive.assets, { section: "all", type: "all", query: "", sort: "newest" });
  const out: MentionCandidate[] = assets.slice(0, 12).map((asset) => ({
    id: `library:${asset.id}`,
    name: asset.name,
    group: MENTION_GROUP_LIBRARY,
    hint: asset.kind === "video" ? "Video" : "Image",
  }));
  for (const project of libraryProjects(archive.assets)) {
    out.push({ id: `project:${project.id}`, name: project.name, group: MENTION_GROUP_PROJECTS, hint: `${project.count}` });
  }
  for (const row of readOttoIQSavedRows().slice(0, 6)) {
    // Otto IQ 那一条存的是一整段话,@ 表里读的必须是一个**名字**,不是一段文。
    const name = row.content.split(/[:.]/)[0]?.trim() || row.category;
    out.push({ id: `iq:${row.id}`, name, group: MENTION_GROUP_OTTO_IQ, hint: row.category });
  }
  return out;
}

/* ── 起手问卷 ───────────────────────────────────────────────────────────────── */

/**
 * 一句话太含糊时先问的两道题。
 *
 * 两道而不是一道,是因为「问卷」这件事从此按序列走(第 2 件):题号、Previous、
 * Skip、Next 只有在**真的不止一道**的时候才有意义,一道题的序列验不出这几颗按钮。
 * 第二道是多选 —— 单选与多选走的是同一张卡,那也必须有真东西可验。
 */
export const CREATION_QUESTIONS: readonly QuestionnaireQuestion[] = [
  {
    id: "purpose",
    question: "What should this be for?",
    help: "Pick one so the first try is close. Answering costs nothing.",
    options: [
      { label: "A product shot", description: "One product, clean background, ready for a feed post" },
      { label: "A lifestyle scene", description: "The product in use, with a room or table around it" },
      { label: "A promotion graphic", description: "Room left over the picture for a price or an offer" },
    ],
  },
  {
    id: "mood",
    multi: true,
    question: "Anything it has to carry?",
    options: [
      { label: "Warm light", description: "Late afternoon, soft shadows" },
      { label: "Your packaging", description: "Box and label stay readable" },
      { label: "People in frame", description: "Hands or a person using it" },
      { label: "Room for text", description: "Keep one side quiet" },
    ],
  },
];

/** 全屏对话里那块产物区在存档里的项目身份 —— 与 Quick create 同一格,不另开一个。 */
export { QUICK_CREATE_PROJECT_NAME };
