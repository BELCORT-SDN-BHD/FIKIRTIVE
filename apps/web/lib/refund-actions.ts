"use server";
/**
 * 人工退款(MONEY-A14 v2,规格 §7.6;Founder 2026-09-01 裁决)。
 *
 * 为什么要一个专用动作,而不是继续「负向调账 + 后台手点 Stripe」:那条过渡路上有两笔钱要动
 * (商家的 credits、我们的马币),而它们之间没有任何东西保证顺序与配对。人退到一半走神,商家
 * 就既留着 credits 又拿回了钱;单号只在台账里,账本上那一行永远说不清自己是什么。
 *
 * 所以退款走**钱路现成的三段机械**,一步都不新发明:
 *   ① `reserveCredits(refId = manual-refund:<退款单号>)` —— 先把要退的 credits **锁死**。
 *      顺序铁律:credits 先动不了,才允许去动马币。余额不足 = 预扣失败 = 当场拒退
 *      (或经 `allowPartial` 明示后按可扣部分退)。
 *   ② `stripe.refunds.create` —— 拿到 `re_…`。
 *   ③ `settleCredits` —— 落账,SETTLE 行 **reason 当场载 `re_…`**(落账时单号已经存在,
 *      所以账本仍然只追加、零修改;这正是 v1 那版物理上做不到、被改签的地方)。
 *   Stripe **明确拒绝** → `refundReservation` 释放,商家余额净变 0、账本成对。
 *   Stripe **答案不明**(超时 / 5xx / 幂等键撞参数)→ 预扣留着 + 报警,见
 *   {@link stripeDefinitelyRefused} 的判词:释放的前提是「确定没退成」。
 *
 * **退款单号就是幂等键**:`refundId` 由发起方带进来(一张退款单一个,重试用同一个),它同时是
 * 账本 refId 的后缀和 Stripe 的 idempotency key。所以「点了两次」「settle 之前进程挂了」都收敛
 * 到同一个结果,不会退两次钱。
 *
 * 退款计入 30 天 / 2000 显示 credits 的人工调账累计闸(与授信、调账同一口径)。大额退款撞闸是
 * **设计内摩擦**,解法是改常量走 PR + Founder 批,不是在这里绕过去。
 */
import { revalidatePath } from "next/cache";
import {
  prisma,
  reserveCredits,
  settleCredits,
  refundReservation,
  assertWithinAdjustWindow,
  InsufficientCredits,
  SpendCapBlocked,
  OrgSuspended,
  FinanceAdjustBlocked,
} from "@fikirtive/db";
import {
  newId,
  FOUNDER_OWNER_ID,
  INTERNAL_PER_DISPLAY,
  CREDIT_PACKS,
  FINANCE_ADJUST_LIMITS,
  FINANCE_PER_ACTION_LIMIT_MESSAGE,
  displayCredits,
  manualRefundRefId,
  myrMinorToUsd,
} from "@fikirtive/core";
import { requireRole } from "./auth-guard";
import { activeMerchantOrg } from "./tenant-admin";
import { financeAdjustBlockedMessage } from "./finance-limit-seam";
import { stripe } from "./stripe";
import { founderAlert } from "./founder-alert";

/** Stripe 退款失败后写在 REFUND 行上的标签(账本成对释放的那一半)。 */
const STRIPE_FAILED_REASON = "manual-refund:stripe-failed";

/**
 * **Stripe 是「明确拒绝了」,还是「我们不知道」?** 这两件事的处置相反,合并它们会亏钱。
 *
 * 释放预扣的前提是「那笔退款确定没有建出来」。一个网络超时、一个 5xx、一次幂等键撞参数,
 * 都可能发生在 Stripe **已经把钱退出去之后** —— 这时候再把 credits 还给商家,就成了「钱退了、
 * credits 也留着」,平台自己吃两遍。所以只有 Stripe 自己回了一个业务级拒绝(请求根本没被受理)
 * 才释放;其余一律**保持预扣**并报警,由人去 Dashboard 核一眼,再用同一个单号补跑或人工收尾。
 *
 * 方向是刻意不对称的:保持预扣最坏是商家的 credits 被多锁一会儿(一条正向调账就能补),
 * 错误释放则是一笔查不回来的平台损失。
 */
function stripeDefinitelyRefused(e: unknown): boolean {
  const err = e as { type?: unknown; statusCode?: unknown };
  // 5xx = Stripe 那边出事,状态未知。
  if (typeof err?.statusCode === "number" && err.statusCode >= 500) return false;
  // 幂等键撞参数:同一个单号此前**用别的参数**发过,那一笔可能已经成功。同样是「不知道」。
  return (
    err?.type === "StripeInvalidRequestError" ||
    err?.type === "StripeCardError" ||
    err?.type === "StripeAuthenticationError" ||
    err?.type === "StripePermissionError"
  );
}

export type RefundCreditsResult =
  | { ok: true; refundId: string; displayedAmount: number; amountMinor: number; duplicate?: boolean }
  | { error: string };

/**
 * 退款金额换算 = **商家原购包的实付单价**,不是面值、也不是汇率钉点(runbook `docs/runbooks/manual-refund.md`
 * 第 4 条):`RM = N × 该包 RM 价 ÷ 该包 credits 数`。例:Pro 包(RM250 → 600cr)退 100cr ≈ RM41.67。
 *
 * 面值口径会退多:1 显示 credit 面值 $0.10,而 Pro 包实付单价只有面值的约 92.6%,按面值退等于
 * 每退一次就白送一次包折扣。向下取整到**仙**,方向永远是少退一分,不是多退一分。
 */
function refundMinorForPack(displayedAmount: number, pack: { amountMinor: number; credits: number }): number {
  return Math.floor((displayedAmount * pack.amountMinor) / pack.credits);
}

/** SETTLE 行的 reason:退款单号 + 两种口径的金额(台账反查用;`reason` 不进商家读路径,#683)。 */
function settleReasonFor(refundStripeId: string, amountMinor: number): string {
  return `stripe-refund:${refundStripeId} myr_minor:${amountMinor} usd:${myrMinorToUsd(amountMinor).toFixed(2)}`;
}

/** 从已落账的 SETTLE 行里读回退款单号与真正退出去的马币数 —— 重放时回答的是**当时发生了什么**,
 *  不是拿这次表单里的参数再算一遍(操作员这次可能选了另一个包)。 */
function settledRefundFromReason(reason: string): { refundId: string; amountMinor: number } {
  return {
    refundId: /stripe-refund:(re_[A-Za-z0-9]+)/.exec(reason)?.[1] ?? "",
    amountMinor: Number(/myr_minor:(\d+)/.exec(reason)?.[1] ?? 0),
  };
}

export async function refundCreditsAction(raw: unknown): Promise<RefundCreditsResult> {
  // 跨租户 + 动真钱:与 `grantTenantCredits` 同一把闸(super-admin),不按角色名判,判的是
  // `tenants.mutate` 这个 capability。
  const gate = await requireRole("tenants", "mutate");
  if ("error" in gate) return gate;

  const v = raw as {
    orgId?: unknown; displayedAmount?: unknown; paymentIntentId?: unknown;
    packCredits?: unknown; refundId?: unknown; allowPartial?: unknown; reason?: unknown;
  };

  const orgId = typeof v?.orgId === "string" ? v.orgId : "";
  if (!orgId || orgId === FOUNDER_OWNER_ID) return { error: "Pick a merchant org." };
  if (!(await activeMerchantOrg(orgId))) return { error: "Unknown or closed org." };

  const displayedAmount = typeof v?.displayedAmount === "number" ? v.displayedAmount : NaN;
  // 退款只能是正数:这个动作**扣**商家的 credits 并把钱退回去。负数是另一件事(授信),
  // 它有自己的入口,不许从这里溜进来。
  if (!Number.isInteger(displayedAmount) || displayedAmount <= 0) return { error: "Enter a whole number of credits to refund." };
  if (displayedAmount > FINANCE_ADJUST_LIMITS.perActionDisplay) return { error: FINANCE_PER_ACTION_LIMIT_MESSAGE };

  const paymentIntentId = typeof v?.paymentIntentId === "string" ? v.paymentIntentId.trim() : "";
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return { error: "Enter the original payment intent id (pi_…)." };

  // 包由操作员在 Stripe Dashboard 上核对后选定(runbook 步骤 A 第 3 条),这里只认在售包表里
  // 真实存在的那三个 —— 单价是**代码表**说了算,不是表单里填一个数字进来。
  const packCredits = typeof v?.packCredits === "number" ? v.packCredits : NaN;
  const pack = CREDIT_PACKS.find((p) => p.credits === packCredits);
  if (!pack) return { error: "Pick the credit pack the merchant originally bought." };

  const refundId = typeof v?.refundId === "string" ? v.refundId.trim() : "";
  if (refundId.length < 8 || refundId.length > 64 || !/^[A-Za-z0-9:_-]+$/.test(refundId)) {
    return { error: "Invalid refund id." };
  }
  const allowPartial = v?.allowPartial === true;
  const note = typeof v?.reason === "string" ? v.reason.slice(0, 500) : "";
  const refId = manualRefundRefId(refundId);
  const requestedInternal = displayedAmount * INTERNAL_PER_DISPLAY;

  // ── 重放与断点续跑 ────────────────────────────────────────────────────────
  // 同一个退款单号再来一次,只有三种可能,而它们的答案完全不同:
  //   落过账了      → 如实回答「这一笔已经退过」,连 Stripe 都不碰。
  //   释放过了      → 这个单号已经结束在「失败并成对释放」上,不许在它上面接着退。
  //   只预扣了一半  → 上一次在 Stripe 或落账那一步断了。**接着跑**:Stripe 的 idempotency key
  //                  就是这个 refId,所以重发拿回的是同一笔退款,不会退第二次。
  const existing = await prisma.creditLedger.findMany({
    where: { orgId, refId },
    select: { kind: true, reason: true, reservedDelta: true },
  });
  const settled = existing.find((row) => row.kind === "SETTLE");
  if (settled) {
    const held = existing.find((row) => row.kind === "RESERVE")?.reservedDelta ?? 0;
    const done = settledRefundFromReason(settled.reason);
    return { ok: true, duplicate: true, refundId: done.refundId, displayedAmount: displayCredits(held), amountMinor: done.amountMinor };
  }
  if (existing.some((row) => row.kind === "REFUND")) {
    return { error: "That refund id was already released after a Stripe failure. Start a new refund id." };
  }
  const openHold = existing.find((row) => row.kind === "RESERVE");

  // ── ① 预扣:credits 先锁死 ────────────────────────────────────────────────
  let heldInternal = openHold?.reservedDelta ?? 0;
  if (!openHold) {
    try {
      heldInternal = await prisma.$transaction(async (tx) => {
        let cost = requestedInternal;
        if (allowPartial) {
          // 「按可扣部分退」:读一次余额只是**决定要多少**,守住账户的仍然是预扣那一句条件更新
          // (余额在这两句之间掉下去 ⇒ 预扣影响 0 行 ⇒ 整笔回滚,方向只会是拒绝,不会超扣)。
          const acc = await tx.creditAccount.findUnique({ where: { orgId }, select: { balance: true } });
          cost = Math.min(cost, acc?.balance ?? 0);
        }
        // 0 credits 的退款是**不存在**的东西:`reserveCredits` 对 cost<=0 直接 no-op,不留任何行,
        // 那样往下走就成了「退了钱、没扣 credits」。当场拒。
        if (cost <= 0) throw new InsufficientCredits("No refundable balance left in that workspace.");
        await assertWithinAdjustWindow(tx, orgId, cost);
        await reserveCredits(tx, { orgId, refId, cost });
        return cost;
      });
    } catch (e) {
      if (e instanceof FinanceAdjustBlocked) return { error: await financeAdjustBlockedMessage(e, { via: gate.email, entry: "refundCreditsAction" }) };
      if (e instanceof OrgSuspended) return { error: "That workspace is suspended — resume it before refunding, then suspend it again." };
      if (e instanceof SpendCapBlocked) return { error: "That merchant's own spend cap refused the hold. Nothing was refunded." };
      if (e instanceof InsufficientCredits) {
        return { error: allowPartial ? "That workspace has no credits left to claw back." : "Not enough unused credits to refund that amount. Refuse the refund, or re-run it as a partial." };
      }
      throw e;
    }
  }

  const heldDisplay = displayCredits(heldInternal);
  const amountMinor = refundMinorForPack(heldDisplay, pack);
  if (amountMinor <= 0) {
    await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId, reason: STRIPE_FAILED_REASON }));
    return { error: "That amount rounds to nothing in ringgit. Nothing was refunded." };
  }

  // ── ② Stripe:钱回商家的卡 ────────────────────────────────────────────────
  // idempotency key = 同一个 refId。一张退款单重发多少次,Stripe 都只建一笔退款并把同一个
  // `re_…` 还回来。(Stripe 的幂等键 24 小时后过期 —— 超过一天才补跑的单子,按 runbook 先去
  // Dashboard 核一眼有没有已经退过,再决定。)
  let refund: { id: string; status: string | null };
  try {
    refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, amount: amountMinor },
      { idempotencyKey: refId },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Stripe refused the refund.";
    if (!stripeDefinitelyRefused(e)) {
      // 不知道有没有退成 ⇒ 预扣**留着**,人去核。
      await founderAlert({
        key: "finance.manual_refund_outcome_unknown",
        title: `Manual refund ${refundId} for ${orgId} did not get a clear answer from Stripe.`,
        action:
          `Check Stripe for a refund on ${paymentIntentId}. If it exists, re-run the SAME refund id to settle the ledger; ` +
          "if it does not, re-run it to refund. The credits stay held until then — never release them by hand.",
        context: { orgId, refundId, paymentIntentId, amountMinor, displayedAmount: heldDisplay, via: gate.email, detail },
      });
      return { error: `Stripe did not give a clear answer (${detail}). The credits stay held — check Stripe, then re-run the SAME refund id.` };
    }
    await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId, reason: STRIPE_FAILED_REASON }));
    return { error: `Stripe refused the refund, so the hold was released and the balance is unchanged: ${detail}` };
  }
  // pending / requires_action = **已受理**(单号已经存在),照常落账;规格要的是「落账时单号已存在」,
  // 不是「钱已经到账」。只有 failed / canceled 才是没受理。
  if (refund.status === "failed" || refund.status === "canceled") {
    await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId, reason: STRIPE_FAILED_REASON }));
    return { error: `Stripe reported the refund as ${refund.status}. The hold was released and the balance is unchanged.` };
  }

  // ── ③ 落账:SETTLE 行当场载单号 ───────────────────────────────────────────
  try {
    await prisma.$transaction((tx) => settleCredits(tx, { orgId, refId, reason: settleReasonFor(refund.id, amountMinor) }));
  } catch (e) {
    // 钱已经退出去了、credits 还锁在 reserved 里 —— 方向是安全的(商家花不掉它),但账没记完。
    // 这不能只在日志里躺着:同一个退款单号重跑一次就能补上(Stripe 那一步幂等),所以报警要
    // 把这句话直接说给人听。
    await founderAlert({
      key: "finance.manual_refund_settle_failed",
      title: `Manual refund ${refund.id} was paid but its ledger settle failed.`,
      action: `Re-run the same refund id (${refundId}) from the tenant page — Stripe is idempotent, so it will not refund twice.`,
      context: { orgId, refundId, stripeRefundId: refund.id, amountMinor, displayedAmount: heldDisplay, via: gate.email },
    });
    return { error: `Stripe refunded ${refund.id} but the ledger settle failed. Re-run the SAME refund id to finish it — nothing will be refunded twice.` };
  }

  await prisma.actionEvent.create({
    data: {
      id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.credits.refund",
      payload: { orgId, refundId, stripeRefundId: refund.id, paymentIntentId, displayedAmount: heldDisplay, amountMinor, packCredits: pack.credits, reason: note, via: gate.email },
    },
  }).catch(() => {});
  await prisma.actionEvent.create({
    data: {
      id: newId(), ownerId: orgId, type: "credits.refund",
      payload: { refundId, stripeRefundId: refund.id, displayedAmount: heldDisplay, amountMinor, via: gate.email },
    },
  }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`);
  return { ok: true, refundId: refund.id, displayedAmount: heldDisplay, amountMinor };
}
