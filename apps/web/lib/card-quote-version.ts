import "server-only";
/**
 * card-quote-version —— 「商家按下的那份报价，还是不是库里这一份？」**一道闸，一份口径**
 * （规格 docs/specs/creation-engine.md §5 :170，FSE-012；Founder 2026-09-10 裁）。
 *
 * 走查现象：确认卡上把张数从 1 改到 2，服务端已经重铸了卡，而商家眼前那颗按钮仍写着
 * `Generate · 1 credit`、仍然可点。钱不会被多扣（预扣只认持久化的卡），但**他按下的那份
 * 报价与被执行的那份报价是两份**——那正是「说的」与「做的」分家。
 *
 * Founder 的口径是三句话：走服务器校验报价版本；旧报价提交即拒绝并刷新；**不锁控件**
 * （2026-09-06 A4 那一轮「重铸进行中不锁控件」的决定不推翻）。这个文件就是第一句与第二句。
 *
 * 为什么是一份而不是两份：花钱的批准有两条路——刚被提议的卡走 `coworkGenerate`，Otto 停下来
 * 等批准的卡走 `ottoApprove`。两条路各判一次，就是把同一条规则复制成两份（§7.3），改了一处
 * 忘了另一处，商家就在另一条路上照旧按着旧价成交。
 *
 * **零写入、零花费。** 它只读一张 GEN_CARD 的 payload，拒绝时调用方在 create/reserve 之前
 * 返回 —— 账本零新增行。指纹本身不是授权：`cardQuoteVersion` 那个文件头写清了为什么伪造它
 * 的收益是零。
 *
 * **两种用法，一个判据（判官第 3 轮 P2-b）：**
 *   · `staleQuoteRefusalFor(card, …)` —— 调用方**已经把卡读出来了**，就拿那一次读的结果比对。
 *     校验的那份卡与执行用的那份卡因此是同一份，中间不留第二次读的窗口；
 *   · `staleQuoteRefusal(ownerId, cardId, …)` —— 调用方手上还没有卡（`ottoApprove` 的门口），
 *     由它读一次再交给上面那个函数。
 */
import { prisma } from "@fikirtive/db";
import { cardQuoteVersion, QUOTE_VERSION_STALE } from "@fikirtive/core";
import { genCardPayloadDTO } from "./dto";

/** 对不上时交回商家的那一份：一句话 ＋ **刷新后的那张卡**（界面据此换掉卡面报价）。 */
export type StaleQuote = { error: string; quote: unknown };

/** 这道闸比对时用得着的那两格 —— 调用方读卡时顺手 select 到的就是这两格。 */
export type QuoteGateCard = { payload: unknown; genJobId: string | null };

/**
 * 对不上 ⇒ 返回拒绝；对得上、或这一趟根本没带版本 ⇒ 返回 null（调用方照旧往下走）。
 *
 * 带不带版本由客户端决定，而这是有意的降级面：老客户端、非确认卡的入口（画布、资产详情）
 * 从来不带这一格，它们的报价窗口也不是这道闸要治的那一个。带了就必须对得上。
 */
export function staleQuoteRefusalFor(
  card: QuoteGateCard | null,
  submittedVersion: unknown,
): StaleQuote | null {
  if (typeof submittedVersion !== "string" || submittedVersion.length === 0) return null;
  // 读不到这张卡不是这道闸的事（调用方各自有「卡不存在」的说法，措辞也各自不同）——
  // 这里只在**读得到**的时候比对，绝不替调用方发明第二句「找不到」。
  if (!card) return null;
  // 已经挂着任务行的卡 = 一次**已经成交**的批准。它的第二次点击是幂等地取回那一行，
  // 不是一次新的报价；拿版本去拦它，只会把一次成功说成「价变了」。两条路上的再花钱守卫
  // 各自拦得住重复扣费，这道闸在这里让开。
  if (card.genJobId) return null;
  if (cardQuoteVersion(card.payload) === submittedVersion) return null;
  // 交回浏览器的那一份必须走**与刷新那条读路同一条剥离**（`genCardPayloadDTO`）：库里的
  // 原始 payload 上带着 `model` 与 `reason`，原样交回去就是把供应商型号名送上商家的屏幕
  // （Founder 常令：provider 保密）。判官第 3 轮 P2-c 抓的正是这一条。
  return staleQuoteOf(card);
}

/**
 * 交回商家的那一份，**不再比对**：一句 `QUOTE_VERSION_STALE` ＋ 走同一条剥离
 * （`genCardPayloadDTO`）的那张卡。剥离是承重的 —— 库里的原始 payload 带着 `model` 与
 * `reason`，原样交回去就是把供应商型号名送上商家的屏幕（Founder 常令：provider 保密）。
 */
function staleQuoteOf(card: QuoteGateCard): StaleQuote {
  return { error: QUOTE_VERSION_STALE, quote: genCardPayloadDTO(card.payload) };
}

/**
 * 「刷新」那一半（验收 R1）—— **拒绝已经是既成事实**，这里只负责去库里取回那张卡此刻
 * 的报价，按交回浏览器的形状。
 *
 * 为什么不复用上面那条比对：恢复轮里那道迟到的拒绝，是 `generate` 技能自己报上来的事实
 * （`ctx.approvedQuoteVersion.refused`）。到这里再比一次版本，就是拿一个**推断**去覆盖一个
 * 已知的事实 —— 比如商家在拒绝之后又把那一格改了回去，版本于是重新对得上，而那一趟确实
 * 什么都没生成：再比一次会把它说成一次成功的批准。判决只作一次，在闸那里。
 */
export async function refreshedQuoteFor(ownerId: string, cardId: string): Promise<StaleQuote | null> {
  const card = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "GEN_CARD", deletedAt: null },
    select: { payload: true, genJobId: true },
  });
  return card ? staleQuoteOf(card) : null;
}

/** 调用方手上还没有卡时的那一支：读一次（owner scoped），再走上面那个判据。 */
export async function staleQuoteRefusal(
  ownerId: string,
  cardId: string,
  submittedVersion: unknown,
): Promise<StaleQuote | null> {
  if (typeof submittedVersion !== "string" || submittedVersion.length === 0) return null;
  const card = await prisma.chatMessage.findFirst({
    where: { id: cardId, ownerId, kind: "GEN_CARD", deletedAt: null },
    select: { payload: true, genJobId: true },
  });
  return staleQuoteRefusalFor(card, submittedVersion);
}
