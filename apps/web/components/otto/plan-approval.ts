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
import { chainedApprovalOf, type ChainedApproval } from "./approval-chain";
import type { OttoPlanCardPayload } from "./plan-card-contract";

/** 这一次批准的结局。`error` 是给商家看的一句话，不是异常。 */
export type PlanApprovalResult =
  | { ok: true; chained: ChainedApproval | null }
  | { ok: false; error: string };

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
    const res = pendingApproval
      ? await ottoApprove({ threadId, cardId })
      : await coworkGenerate({
          cardId,
          prompt: payload.structuredPrompt ?? "",
          entityIds: Array.isArray(payload.entityIds) ? payload.entityIds : [],
          variantSel: payload.variantSel && typeof payload.variantSel === "object" ? payload.variantSel : {},
        });
    if (res && "error" in res) return { ok: false, error: res.error };
    return { ok: true, chained: chainedApprovalOf(res) };
  } catch {
    return { ok: false, error: "Couldn't start that — please try again." };
  } finally {
    // 扣费的那一刻：两条路都会预扣（ottoApprove 续跑一次已停住的付费生成，
    // coworkGenerate 派发一次新的）。放在 finally 里是因为**失败的响应从不证明零花费**（#550）。
    notifyBalanceRefresh();
  }
}
