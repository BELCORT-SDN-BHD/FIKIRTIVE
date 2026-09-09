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
 */
import { prisma } from "@fikirtive/db";
import { cardQuoteVersion, QUOTE_VERSION_STALE } from "@fikirtive/core";

/** 对不上时交回商家的那一份：一句话 ＋ **刷新后的那张卡**（界面据此换掉卡面报价）。 */
export type StaleQuote = { error: string; quote: unknown };

/**
 * 对不上 ⇒ 返回拒绝；对得上、或这一趟根本没带版本 ⇒ 返回 null（调用方照旧往下走）。
 *
 * 带不带版本由客户端决定，而这是有意的降级面：老客户端、非确认卡的入口（画布、资产详情）
 * 从来不带这一格，它们的报价窗口也不是这道闸要治的那一个。带了就必须对得上。
 */
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
  // 读不到这张卡不是这道闸的事（调用方各自有「卡不存在」的说法，措辞也各自不同）——
  // 这里只在**读得到**的时候比对，绝不替调用方发明第二句「找不到」。
  if (!card) return null;
  // 已经挂着任务行的卡 = 一次**已经成交**的批准。它的第二次点击是幂等地取回那一行，
  // 不是一次新的报价；拿版本去拦它，只会把一次成功说成「价变了」。两条路上的再花钱守卫
  // 各自拦得住重复扣费，这道闸在这里让开。
  if (card.genJobId) return null;
  if (cardQuoteVersion(card.payload) === submittedVersion) return null;
  return { error: QUOTE_VERSION_STALE, quote: card.payload };
}
