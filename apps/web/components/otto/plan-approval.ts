"use client";

/**
 * plan-approval —— 一张 GEN_CARD 的「批准并开跑」这一次动作，**唯一的一份**。
 *
 * 根因（2026-09-04 走查 P0-3）：确认卡藏在默认折起的对话抽屉里，商家看不见它，于是
 * Otto 说「上面那两张卡」而上面什么都没有。修法是把确认渲染到那张始终可见的 Otto 卡里
 * —— 于是同一个动作有了第二个按钮。两个按钮各自抄一份 `ottoApprove` / `coworkGenerate`
 * 的分支，就是把钱路复制成两份（§7.3）：一处改了幂等键、另一处没改，商家付两次。
 *
 * 所以这里把 `OttoPlanCard.approve()` 里那段**动作**原样搬出来，语义一字不改：
 *   · 同样两条路（parked → `ottoApprove`；proposed → `coworkGenerate`）；
 *   · 同样的幂等身份（cardId + threadId，服务端认；这里不生成任何新 id）；
 *   · 同样在 `finally` 里 `notifyBalanceRefresh()` —— 失败的响应**不能**证明零花费。
 *
 * 这里**不**做价格担保判定：那是 `planCardGate` 的活，调用方渲染按钮时已经过一次门，
 * 两处都必须过同一个门（`gate.approvable`），这个函数只负责发出那一次动作。
 * 忙碌态与错误文案留给各自的调用方 —— 它们的按钮长得不一样，但花的是同一笔钱。
 */

import { ottoApprove } from "@/lib/otto-client-actions";
import { coworkGenerate } from "@/lib/cowork-actions";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
// Codex staging CRE-STG-P2-004 —— 失败那一句与那个短号,措辞与算法都只有这一份
// (`@fikirtive/core/gen-failure`)。子路径而不是包根:包根会把 node:crypto 拖进客户端包。
import { GENERATION_START_FAILED, diagnosticRef } from "@fikirtive/core/gen-failure";
// FSE-012 —— 「他按下的是哪一版报价」。同样走**子路径**(理由同上一行:包根带 node:crypto)。
// 铸造与校验的口径只有这一个函数,服务端拿库里那张卡再算一次。
import { cardQuoteVersion, QUOTE_VERSION_STALE } from "@fikirtive/core/quote-version";
import { chainedApprovalOf, quoteRefusalOf, type ChainedApproval } from "./approval-chain";
import type { OttoPlanCardPayload } from "./plan-card-contract";

/** 这一次批准的结局。`error` 是给商家看的一句话，不是异常。 */
export type PlanApprovalResult =
  | { ok: true; chained: ChainedApproval | null }
  /**
   * Codex staging CRE-STG-P2-004 —— `ref` 是这一次动作的**可复制短号**,只在失败时出现。
   *
   * 它给商家一个能念给客服听的把手:服务端在日志里写同一串,两边算的是同一个函数
   * (`diagnosticRef`)。句子里一个 id、URL、路径、堆栈都不许有 —— 那些是日志的活;
   * 短号单独一格,由卡面渲染在句子旁边。
   */
  | {
    ok: false;
    error: string;
    ref: string | null;
    /**
     * FSE-012 —— 服务端拒绝时交回来的**刷新后的那张卡**（报价版本对不上那一支才有）。
     * 调用方拿它换掉卡面，商家因此**看得到新价**再决定，而不是对着一个旧数字重按一次。
     * null = 这一次拒绝与报价无关（余额不足、供应商关停…），卡面照旧。
     */
    refreshedPayload: unknown;
  };

export interface RunPlanApprovalInput {
  threadId: string;
  cardId: string;
  /** 这张卡是「Otto 停下来等批准」的那一种（true → 走 `ottoApprove` 续跑）还是
   *  「刚被提议出来」的那一种（false → 走 `coworkGenerate` 直接派发）。 */
  pendingApproval: boolean;
  /** 已过 `planCardGate` 的卡面 payload —— proposed 那一条路要用它的三个字段。 */
  payload: OttoPlanCardPayload;
}

export async function runPlanApproval(input: RunPlanApprovalInput): Promise<PlanApprovalResult> {
  const { threadId, cardId, pendingApproval, payload } = input;
  try {
    // 两条花钱的路。Otto 若把 generate **停住**了（这一轮返回 needs_approval），用
    // ottoApprove 续跑；否则这是一张刚被**提议**的卡，直接用 coworkGenerate 派发。
    // （对提议卡调 ottoApprove 会得到「That card isn't awaiting approval」，生成根本
    // 不会开始 —— 这就是这两条路必须分清的原因。）
    // FSE-012 —— 两条路都带上「他眼前这一版」。服务端拿库里那张卡再算一次:对不上就拒绝
    // 并把新报价交回来。**不锁控件**(2026-09-06 A4 那一轮的决定不推翻):旧报价照旧点得动,
    // 只是点下去会被诚实地拒绝。
    const quoteVersion = cardQuoteVersion(payload);
    const res = pendingApproval
      ? await ottoApprove({ threadId, cardId, quoteVersion })
      : await coworkGenerate({
          cardId,
          prompt: payload.structuredPrompt ?? "",
          entityIds: Array.isArray(payload.entityIds) ? payload.entityIds : [],
          variantSel: payload.variantSel && typeof payload.variantSel === "object" ? payload.variantSel : {},
          quoteVersion,
        });
    // FSE-012（判官第 5 轮 P2-b）—— 恢复轮**停在别的批准上**，而这一张被报价版本闸拒了。
    // 服务端把两件事分开说（`ok:true, status:"needs_approval"` ＋ `staleQuote`），因为链上
    // 那些卡确实还等着；只看 `error` 在不在的读法会把这一支读成一次成功的批准，于是
    // `onApproved` 被调用、这张什么都没生成的卡被父层标成已批准。这一支照拒绝处理：卡面
    // 换成交回来的那一版，控件不锁。（链上那些卡的 id 随这一支丢掉了 —— 它们已经落库，
    // 由批准后的那次轮询补上；见 PR 描述「未做」。）
    // 「这一次答复是不是一次报价拒绝」只有一份读法(`quoteRefusalOf`,一叠卡的批量循环
    // 读的是同一个函数)。这里只管它的 `staleQuote` 那一形:另一形(`error` + `quote`)由
    // 下面那条既有的错误出口原样处理,措辞与短号都不变。
    const chainedRefusal = res && typeof res === "object" && !("error" in res) ? quoteRefusalOf(res) : null;
    if (chainedRefusal) {
      return { ok: false, error: QUOTE_VERSION_STALE, ref: diagnosticRef(cardId), refreshedPayload: chainedRefusal.quote };
    }
    if (res && "error" in res) {
      // 服务端已经说清楚了 —— 原样传上去,泛化句不许盖掉它。短号优先跟着服务端那一份
      // (它与那一行日志同源);服务端没给的分支由卡的身份算一个,算法是同一个函数。
      const serverRef = typeof (res as { ref?: unknown }).ref === "string" ? (res as { ref: string }).ref : null;
      // 报价版本对不上那一支带着**刷新后的那张卡**回来 —— 原样交给调用方,让卡面换成新价。
      const refreshedPayload = (res as { quote?: unknown }).quote ?? null;
      return { ok: false, error: res.error, ref: serverRef ?? diagnosticRef(cardId), refreshedPayload };
    }
    return { ok: true, chained: chainedApprovalOf(res) };
  } catch {
    // Codex staging CRE-STG-P0-001 / P2-004 —— 走查那两次点击读到的就是这一支。
    //
    // 从前这里是一句写死的 `Couldn't start that — please try again.`:服务端动作只要**抛**
    // 了(任何原因),商家、走查员、日志三方看到的就是三件对不起来的事,而唯一能把它们串
    // 起来的东西不存在。现在句子来自单一措辞源,短号来自这张卡自己的身份,服务端在日志里
    // 写的是同一串。泛化句**只**留给这一支(真正未知的错误);已知的拒绝走上面那条路,
    // 原样把服务端那句话交给商家。
    return { ok: false, error: GENERATION_START_FAILED, ref: diagnosticRef(cardId), refreshedPayload: null };
  } finally {
    // 扣费的那一刻：两条路都会预扣（ottoApprove 续跑一次已停住的付费生成，
    // coworkGenerate 派发一次新的）。放在 finally 里是因为**失败的响应从不证明零花费**（#550）。
    notifyBalanceRefresh();
  }
}
