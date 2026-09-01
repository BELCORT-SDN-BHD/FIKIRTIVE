"use server";
/**
 * 人工退款(MONEY-A14 v2,规格 §7.6;Founder 2026-09-01 裁决 + 编排者 2026-09-02 两项裁定)。
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
 *
 * **三条在复审里补上的硬规矩:**
 *
 * 1. **动 Stripe 之前先证明这三样是一伙的**(判官 P1-1):这个 `pi_…` 真的属于这个 org、
 *    它付的真的是所选那个包、要退的数没超过它还没退掉的余额。少了这一步,一个填错(或恶意)
 *    的 pi_ 会让我们拿**别人**那笔付款去退钱,而账本上看起来一切正常。
 * 2. **一张退款单的事实,首次预扣时就钉进账本**(RESERVE 行的 reason)。账本只追加,所以
 *    钉进去就改不了;同一个单号重试时读回来的只能是当初批的那一笔,不许拿新参数(比如换个
 *    包)去续跑一个旧 hold。
 * 3. **只有 `succeeded` 才落账**(判官 P1-2)。`pending`/`requires_action` 是「受理了,还没到
 *    终态」——那时候落账等于替 Stripe 说了一句它还没说的话。这种单子把 hold **留着**,发一条
 *    报警,由 {@link completeManualRefund} 重读状态再决定。也正因为 hold 要留着,
 *    `manual-refund:` 这条前缀被登记为**任何清道夫都不许碰**
 *    (`apps/worker/src/jobs/llm-reservation-reaper.test.ts` 的 NEVER_REAPED,有守卫测试):
 *    hold 被自动退回、Stripe 随后又退成 = 平台双付。
 *
 * **退款单号就是幂等键**:`refundId` 由发起方带进来(一张退款单一个,重试用同一个),它同时是
 * 账本 refId 的后缀和 Stripe 的 idempotency key。所以「点了两次」「settle 之前进程挂了」都收敛
 * 到同一个结果,不会退两次钱。
 *
 * 退款计入 30 天 / 2000 显示 credits 的人工调账累计闸(与授信、调账同一口径)。但它**豁免**两道
 * 给消费用的闸——商家自设的单笔上限、账号暂停(编排者裁定 2026-09-02,判词在
 * `packages/db/src/credits.ts` 的 `isManualRefundRef`):退款不是消费,而被拒付暂停的商家恰恰
 * 是最需要逐笔退未用 credits 的那一类。
 */
import { revalidatePath } from "next/cache";
import {
  prisma,
  reserveCredits,
  settleCredits,
  refundReservation,
  assertWithinAdjustWindow,
  InsufficientCredits,
  OrgSuspended,
  FinanceAdjustBlocked,
} from "@fikirtive/db";
import {
  newId,
  FOUNDER_OWNER_ID,
  INTERNAL_PER_DISPLAY,
  CREDIT_PACKS,
  CREDIT_PACK_CURRENCY,
  FINANCE_ADJUST_LIMITS,
  FINANCE_PER_ACTION_LIMIT_MESSAGE,
  displayCredits,
  manualRefundRefId,
  myrMinorToUsd,
  type CreditPack,
} from "@fikirtive/core";
import { requireRole } from "./auth-guard";
import { activeMerchantOrg } from "./tenant-admin";
import { financeAdjustBlockedMessage } from "./finance-limit-seam";
import { stripe } from "./stripe";
import { founderAlert } from "./founder-alert";

/** Stripe 退款失败后写在 REFUND 行上的标签(账本成对释放的那一半)。 */
const STRIPE_FAILED_REASON = "manual-refund:stripe-failed";
/** 金额小到在马币上取整成 0 —— Stripe 一次都没碰过,所以不许写成「Stripe 失败」:
 *  账本上的标签是给以后查账的人看的,不是随手拿一个现成常量凑数。 */
const ROUNDS_TO_ZERO_REASON = "manual-refund:rounds-to-zero";
/** 受理中(pending)的退款单落的审计行类型;`completeManualRefund` 靠它找回 `re_…`。 */
const PENDING_EVENT_TYPE = "manual-refund-pending";

export type RefundCreditsResult =
  | {
      ok: true;
      /** `settled` 落账完成;`pending` Stripe 还没给终态、hold 留着等收口;`already-settled` 这张单以前就退完了。 */
      status: "settled" | "pending" | "already-settled";
      refundId: string;
      displayedAmount: number;
      amountMinor: number;
    }
  | { error: string };

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

/**
 * 退款金额换算 = **商家原购包的实付单价**,不是面值、也不是汇率钉点(runbook `docs/runbooks/manual-refund.md`
 * 第 4 条):`RM = N × 该包 RM 价 ÷ 该包 credits 数`。例:Pro 包(RM250 → 600cr)退 100cr ≈ RM41.66。
 *
 * 面值口径会退多:1 显示 credit 面值 $0.10,而 Pro 包实付单价只有面值的约 92.6%,按面值退等于
 * 每退一次就白送一次包折扣。向下取整到**仙**,方向永远是少退一分,不是多退一分。
 */
function refundMinorForPack(displayedAmount: number, pack: { amountMinor: number; credits: number }): number {
  return Math.floor((displayedAmount * pack.amountMinor) / pack.credits);
}

/** 一张退款单被批准时的四个事实。首次预扣时钉进 RESERVE 行的 reason,此后只读不写。 */
type RefundFacts = { paymentIntentId: string; packCredits: number; displayedAmount: number; amountMinor: number };

function encodeFacts(f: RefundFacts): string {
  return `pi:${f.paymentIntentId}|pack:${f.packCredits}|credits:${f.displayedAmount}|myr_minor:${f.amountMinor}`;
}

function decodeFacts(reason: string): RefundFacts | null {
  const pi = /pi:(pi_[A-Za-z0-9]+)/.exec(reason)?.[1];
  const pack = Number(/pack:(\d+)/.exec(reason)?.[1]);
  const credits = Number(/credits:(\d+)/.exec(reason)?.[1]);
  const minor = Number(/myr_minor:(\d+)/.exec(reason)?.[1]);
  if (!pi || !Number.isFinite(pack) || !Number.isFinite(credits) || !Number.isFinite(minor)) return null;
  return { paymentIntentId: pi, packCredits: pack, displayedAmount: credits, amountMinor: minor };
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

/** Stripe 对象上的 metadata / 金额字段,按**读得到就用、读不到就说不知道**取。 */
function metadataOrgId(meta: unknown): string | null {
  const orgId = (meta as { orgId?: unknown } | null | undefined)?.orgId;
  return typeof orgId === "string" && orgId ? orgId : null;
}

/**
 * **这笔付款、这个 org、这个包,真的是一伙的吗?**(判官 P1-1;跑在任何账本写入之前。)
 *
 * 少了这一步,服务端就只校验了 `pi_` 的外形:一个填错的单号会让我们拿**另一个**商家的付款去
 * 退钱 —— 钱从那笔付款里出去,credits 从这个 org 扣掉,两边账各自看起来都正常,而事实是
 * 我们替 A 退了 B 的钱。三样都必须自己对上:
 *
 *   ① **归属**:PI 的 metadata.orgId(④a 起为新付款写入)→ 查不到就用 Checkout Session 的
 *      metadata.orgId / client_reference_id(老付款走的就是这条)→ 再查不到就用账本的
 *      `stripe:<sessionId>` 幂等键反查(那一行本身就是「这个 org 因这笔 session 到账」的证据)。
 *      三条都问不出来 = **不知道**,拒绝(不许"猜一个"就退钱)。
 *   ② **包**:PI 实收金额与币种,与所选包逐字相符 —— 单价错了,退出去的马币数就错了。
 *   ③ **余额**:要退的数 ≤ 这笔付款还没退掉的部分,免得对同一笔付款退两次。
 *
 * 只读:一分钱不动、一行不写。任一不符 → 调用方拒绝且**零账本写入**。
 */
async function verifyPaymentBelongsToOrg(args: {
  orgId: string;
  paymentIntentId: string;
  pack: CreditPack;
  plannedMinor: number;
}): Promise<{ ok: true } | { error: string }> {
  const { orgId, paymentIntentId, pack, plannedMinor } = args;

  let pi: { id: string; amount: number; amount_received?: number | null; currency: string; metadata?: unknown };
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (e) {
    return { error: `Could not read that payment from Stripe: ${e instanceof Error ? e.message : "unknown error"}` };
  }

  // ① 归属。
  let ownerOrgId = metadataOrgId(pi.metadata);
  if (!ownerOrgId) {
    try {
      const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
      const session = sessions.data[0];
      if (session) {
        ownerOrgId =
          metadataOrgId(session.metadata) ??
          (typeof session.client_reference_id === "string" ? session.client_reference_id : null);
        if (!ownerOrgId) {
          // 最后一条:账本上那一行入账记录本身就是归属证据(webhook 用 `stripe:<sessionId>` 做幂等键)。
          const granted = await prisma.creditLedger.findFirst({
            where: { orgId, idempotencyKey: `stripe:${session.id}` },
            select: { id: true },
          });
          if (granted) ownerOrgId = orgId;
        }
      }
    } catch {
      // 读不到 session 不改变结论:下面那句「问不出来就拒绝」照旧执行。
    }
  }
  if (!ownerOrgId) {
    return { error: "Could not prove which workspace that payment belongs to. Refusing — check the payment intent id." };
  }
  if (ownerOrgId !== orgId) {
    return { error: "That payment belongs to a different workspace. Nothing was refunded." };
  }

  // ② 包。`amount_received` 是真正收到的数;它读不到时退回 `amount`(授权额),两者对一笔
  //    已完成的 Checkout 付款相等。
  const received = typeof pi.amount_received === "number" && pi.amount_received > 0 ? pi.amount_received : pi.amount;
  if (pi.currency?.toLowerCase() !== CREDIT_PACK_CURRENCY) {
    return { error: `That payment is in ${pi.currency?.toUpperCase() ?? "an unknown currency"}, not ${CREDIT_PACK_CURRENCY.toUpperCase()}. Nothing was refunded.` };
  }
  if (received !== pack.amountMinor) {
    return { error: `That payment is RM${(received / 100).toFixed(2)}, which is not the ${pack.name} price. Pick the pack they actually bought.` };
  }

  // ③ 余额:这笔付款已经退掉多少?failed/canceled 的那些不算数(钱没出去)。
  let alreadyRefunded = 0;
  try {
    const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
    alreadyRefunded = refunds.data
      .filter((r) => r.status !== "failed" && r.status !== "canceled")
      .reduce((sum, r) => sum + (r.amount ?? 0), 0);
  } catch (e) {
    // 读不到已退金额 = 不知道还剩多少可退 ⇒ fail closed。宁可让操作员去 Dashboard 看一眼,
    // 也不要在「可能已经退过」的付款上再退一次。
    return { error: `Could not read existing refunds for that payment: ${e instanceof Error ? e.message : "unknown error"}` };
  }
  const headroom = received - alreadyRefunded;
  if (plannedMinor > headroom) {
    return {
      error: `That payment only has RM${(headroom / 100).toFixed(2)} left to refund (RM${(alreadyRefunded / 100).toFixed(2)} already refunded). Nothing was refunded.`,
    };
  }
  return { ok: true };
}

/** Prisma 的唯一键冲突。只认 code,不认 message。 */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/** 这张单在账本上已经走到哪一步了。 */
type LedgerState = {
  settled?: { reason: string; heldInternal: number };
  released: boolean;
  hold?: { reason: string; heldInternal: number };
};

async function readLedgerState(orgId: string, refId: string): Promise<LedgerState> {
  const rows = await prisma.creditLedger.findMany({
    where: { orgId, refId },
    select: { kind: true, reason: true, reservedDelta: true },
  });
  const held = rows.find((row) => row.kind === "RESERVE");
  const settle = rows.find((row) => row.kind === "SETTLE");
  return {
    settled: settle ? { reason: settle.reason, heldInternal: held?.reservedDelta ?? 0 } : undefined,
    released: rows.some((row) => row.kind === "REFUND"),
    hold: held ? { reason: held.reason, heldInternal: held.reservedDelta } : undefined,
  };
}

/** 落账完成的那张单,如实报「当时发生了什么」。 */
function settledResult(state: LedgerState): RefundCreditsResult {
  const done = settledRefundFromReason(state.settled!.reason);
  return {
    ok: true,
    status: "already-settled",
    refundId: done.refundId,
    displayedAmount: displayCredits(state.settled!.heldInternal),
    amountMinor: done.amountMinor,
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
  // 真实存在的那三个 —— 单价是**代码表**说了算,不是表单里填一个数字进来。选错包会被下面的
  // PI 核对当场打回(实收金额对不上)。
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
  //   只预扣了一半  → 上一次在 Stripe 或落账那一步断了(或者 Stripe 还 pending)。**接着跑**:
  //                  Stripe 的 idempotency key 就是这个 refId,所以重发拿回的是同一笔退款。
  let state = await readLedgerState(orgId, refId);
  if (state.settled) return settledResult(state);
  if (state.released) {
    return { error: "That refund id was already released after a Stripe failure. Start a new refund id." };
  }

  // ── ① 预扣:credits 先锁死 ────────────────────────────────────────────────
  let facts: RefundFacts;
  if (!state.hold) {
    // 动 Stripe 之前先证明 org / 付款 / 包 三样是一伙的,而且退得起(判官 P1-1)。
    // 按**请求额**核余额:allowPartial 只会让真正退的数更小,所以这一关过了,部分退也一定过。
    const plannedMinor = refundMinorForPack(displayedAmount, pack);
    if (plannedMinor <= 0) return { error: "That amount rounds to nothing in ringgit. Nothing was refunded." };
    const verdict = await verifyPaymentBelongsToOrg({ orgId, paymentIntentId, pack, plannedMinor });
    if ("error" in verdict) return verdict;

    try {
      const heldInternal = await prisma.$transaction(async (tx) => {
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
        const minor = refundMinorForPack(displayCredits(cost), pack);
        if (minor <= 0) throw new InsufficientCredits("That amount rounds to nothing in ringgit.");
        await assertWithinAdjustWindow(tx, orgId, cost);
        // 事实钉进账本(账本只追加 ⇒ 钉进去就不可改)。
        await reserveCredits(tx, {
          orgId, refId, cost,
          reason: encodeFacts({ paymentIntentId, packCredits: pack.credits, displayedAmount: displayCredits(cost), amountMinor: minor }),
        });
        return cost;
      });
      facts = { paymentIntentId, packCredits: pack.credits, displayedAmount: displayCredits(heldInternal), amountMinor: refundMinorForPack(displayCredits(heldInternal), pack) };
    } catch (e) {
      // 判官 P2-1 —— 同一个单号被并发点了两次:输的那一笔撞 `reserve:<refId>` 唯一键。那不是错误,
      // 是「hold 已经在了」。重读账本按既有事实继续,两次点击因此得到一致的答案,而不是一条
      // 页面上看不懂的数据库异常。
      if (isUniqueViolation(e)) {
        state = await readLedgerState(orgId, refId);
        if (state.settled) return settledResult(state);
        if (state.released) return { error: "That refund id was already released after a Stripe failure. Start a new refund id." };
        if (!state.hold) throw e; // 撞了唯一键却读不到那一行 = 账本自相矛盾,不许猜
        const pinned = decodeFacts(state.hold.reason);
        if (!pinned) return { error: "That refund id already has a hold, but its details could not be read. Check the ledger before retrying." };
        facts = pinned;
      } else if (e instanceof FinanceAdjustBlocked) {
        return { error: await financeAdjustBlockedMessage(e, { via: gate.email, entry: "refundCreditsAction" }) };
      } else if (e instanceof OrgSuspended) {
        // 裁定 2026-09-02 之后这一支应当不可达(退款豁免暂停闸),留着是因为闸的判据将来若改,
        // 我们要的是一句人话,不是一个 500。
        return { error: "That workspace is suspended and the refund leg was refused. Nothing was refunded." };
      } else if (e instanceof InsufficientCredits) {
        return { error: allowPartial ? "That workspace has no credits left to claw back." : "Not enough unused credits to refund that amount. Refuse the refund, or re-run it as a partial." };
      } else {
        throw e;
      }
    }
  } else {
    // 续跑:事实以**账本上钉着的那一份**为准。这次表单里的参数只能用来核对,不能用来改写 ——
    // 拿新包去算一个旧 hold 的马币数,退出去的就是一个从来没被批准过的金额。
    const pinned = decodeFacts(state.hold.reason);
    if (!pinned) {
      return { error: "That refund id already has a hold, but its details could not be read. Check the ledger before retrying." };
    }
    if (pinned.paymentIntentId !== paymentIntentId || pinned.packCredits !== pack.credits) {
      return {
        error: `That refund id is already bound to ${pinned.paymentIntentId} / ${pinned.packCredits}-credit pack for ${pinned.displayedAmount} credits. Re-enter those details to finish it, or start a new refund id.`,
      };
    }
    facts = pinned;
  }

  // ── ② Stripe:钱回商家的卡 ────────────────────────────────────────────────
  // idempotency key = 同一个 refId。一张退款单重发多少次,Stripe 都只建一笔退款并把同一个
  // `re_…` 还回来。(Stripe 的幂等键 24 小时后过期 —— 超过一天才补跑的单子,按 runbook 先去
  // Dashboard 核一眼有没有已经退过,再决定。)
  let refund: { id: string; status: string | null };
  try {
    refund = await stripe.refunds.create(
      { payment_intent: facts.paymentIntentId, amount: facts.amountMinor },
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
          `Check Stripe for a refund on ${facts.paymentIntentId}. If it exists, re-run the SAME refund id to settle the ledger; ` +
          "if it does not, re-run it to refund. The credits stay held until then — never release them by hand.",
        context: { orgId, refundId, paymentIntentId: facts.paymentIntentId, amountMinor: facts.amountMinor, displayedAmount: facts.displayedAmount, via: gate.email, detail },
      });
      return { error: `Stripe did not give a clear answer (${detail}). The credits stay held — check Stripe, then re-run the SAME refund id.` };
    }
    await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId, reason: STRIPE_FAILED_REASON }));
    return { error: `Stripe refused the refund, so the hold was released and the balance is unchanged: ${detail}` };
  }

  return finishRefund({ orgId, refId, refundId, refund, facts, note, via: gate.email });
}

/**
 * 第三段(落账 / 释放 / 继续等),`refundCreditsAction` 与 {@link completeManualRefund} 共用。
 *
 * 判官 P1-2 —— **只有 `succeeded` 才落账**。`pending` / `requires_action` 的意思是「Stripe 受理了
 * 这笔退款,但还没到终态」;那时候写 SETTLE 等于替它说了一句它还没说的话,而这笔退款仍然可能
 * 失败(收单行拒绝、卡已注销),那样商家就是 credits 被扣了、钱没回去。所以 pending 的单子把
 * hold **原样留着**、落一条审计行、发一条报警,由人(或 completeManualRefund)去收口。
 */
async function finishRefund(args: {
  orgId: string;
  refId: string;
  refundId: string;
  refund: { id: string; status: string | null };
  facts: RefundFacts;
  note: string;
  via: string;
}): Promise<RefundCreditsResult> {
  const { orgId, refId, refundId, refund, facts, note, via } = args;

  if (refund.status === "failed" || refund.status === "canceled") {
    await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId, reason: STRIPE_FAILED_REASON }));
    return { error: `Stripe reported the refund as ${refund.status}. The hold was released and the balance is unchanged.` };
  }

  if (refund.status !== "succeeded") {
    // 受理中。审计行带着 `re_…`,`completeManualRefund` 靠它重读状态;报警是给人的那一份。
    await prisma.actionEvent.create({
      data: {
        id: newId(), ownerId: orgId, type: `${PENDING_EVENT_TYPE}:${refundId}`,
        payload: { stripeRefundId: refund.id, status: refund.status, paymentIntentId: facts.paymentIntentId, amountMinor: facts.amountMinor, displayedAmount: facts.displayedAmount, via },
      },
    }).catch(() => {});
    await founderAlert({
      key: "finance.manual_refund_pending",
      title: `Manual refund ${refund.id} for ${orgId} is ${refund.status ?? "pending"} at Stripe.`,
      action:
        `Do not start another refund for this payment. The credits stay held until Stripe settles it — ` +
        `finish it from the tenant page with the SAME refund id (${refundId}) once Stripe reports succeeded.`,
      context: { orgId, refundId, stripeRefundId: refund.id, status: refund.status, amountMinor: facts.amountMinor, displayedAmount: facts.displayedAmount, via },
    });
    return { ok: true, status: "pending", refundId: refund.id, displayedAmount: facts.displayedAmount, amountMinor: facts.amountMinor };
  }

  try {
    await prisma.$transaction((tx) => settleCredits(tx, { orgId, refId, reason: settleReasonFor(refund.id, facts.amountMinor) }));
  } catch {
    // 钱已经退出去了、credits 还锁在 reserved 里 —— 方向是安全的(商家花不掉它),但账没记完。
    // 这不能只在日志里躺着:同一个退款单号重跑一次就能补上(Stripe 那一步幂等),所以报警要
    // 把这句话直接说给人听。
    await founderAlert({
      key: "finance.manual_refund_settle_failed",
      title: `Manual refund ${refund.id} was paid but its ledger settle failed.`,
      action: `Re-run the same refund id (${refundId}) from the tenant page — Stripe is idempotent, so it will not refund twice.`,
      context: { orgId, refundId, stripeRefundId: refund.id, amountMinor: facts.amountMinor, displayedAmount: facts.displayedAmount, via },
    });
    return { error: `Stripe refunded ${refund.id} but the ledger settle failed. Re-run the SAME refund id to finish it — nothing will be refunded twice.` };
  }

  await prisma.actionEvent.create({
    data: {
      id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.credits.refund",
      payload: { orgId, refundId, stripeRefundId: refund.id, paymentIntentId: facts.paymentIntentId, displayedAmount: facts.displayedAmount, amountMinor: facts.amountMinor, packCredits: facts.packCredits, reason: note, via },
    },
  }).catch(() => {});
  await prisma.actionEvent.create({
    data: {
      id: newId(), ownerId: orgId, type: "credits.refund",
      payload: { refundId, stripeRefundId: refund.id, displayedAmount: facts.displayedAmount, amountMinor: facts.amountMinor, via },
    },
  }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`);
  return { ok: true, status: "settled", refundId: refund.id, displayedAmount: facts.displayedAmount, amountMinor: facts.amountMinor };
}

/**
 * 收口一张**受理中**的退款单(判官 P1-2 的另一半)。
 *
 * 它只做一件事:去 Stripe 重读那笔退款现在到底是什么状态,然后按同一套规则落地 ——
 * `succeeded` 落账(SETTLE 行载 `re_…`)、`failed`/`canceled` 成对释放、还是 pending 就如实说
 * 还在等。**不会**发起第二笔退款:单号从审计行里读回来,走的是 `refunds.retrieve`。
 *
 * 幂等:已经落账的单直接回「早退完了」,已经释放的单明说不许在它上面继续。
 */
export async function completeManualRefund(raw: unknown): Promise<RefundCreditsResult> {
  const gate = await requireRole("tenants", "mutate");
  if ("error" in gate) return gate;

  const v = raw as { orgId?: unknown; refundId?: unknown };
  const orgId = typeof v?.orgId === "string" ? v.orgId : "";
  if (!orgId || orgId === FOUNDER_OWNER_ID) return { error: "Pick a merchant org." };
  const refundId = typeof v?.refundId === "string" ? v.refundId.trim() : "";
  if (refundId.length < 8 || refundId.length > 64 || !/^[A-Za-z0-9:_-]+$/.test(refundId)) {
    return { error: "Invalid refund id." };
  }
  const refId = manualRefundRefId(refundId);

  const state = await readLedgerState(orgId, refId);
  if (state.settled) return settledResult(state);
  if (state.released) return { error: "That refund id was already released after a Stripe failure. Start a new refund id." };
  if (!state.hold) return { error: "No open refund with that id in this workspace." };
  const facts = decodeFacts(state.hold.reason);
  if (!facts) return { error: "That hold's details could not be read. Check the ledger before finishing it by hand." };

  // Stripe 退款单号在受理时落的那条审计行上。找不到它就不许猜:再发一次 `refunds.create` 在
  // 幂等键过期(24 小时)之后会退**第二笔**,那正是这个动作存在的意义的反面。
  const pending = await prisma.actionEvent.findFirst({
    where: { ownerId: orgId, type: `${PENDING_EVENT_TYPE}:${refundId}` },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const stripeRefundId = (pending?.payload as { stripeRefundId?: unknown } | null)?.stripeRefundId;
  if (typeof stripeRefundId !== "string" || !stripeRefundId) {
    return { error: "No Stripe refund id recorded for that hold. Check Stripe by hand, then settle or release it with support." };
  }

  let refund: { id: string; status: string | null };
  try {
    refund = await stripe.refunds.retrieve(stripeRefundId);
  } catch (e) {
    return { error: `Could not read that refund from Stripe: ${e instanceof Error ? e.message : "unknown error"}` };
  }
  return finishRefund({ orgId, refId, refundId, refund, facts, note: "", via: gate.email });
}
