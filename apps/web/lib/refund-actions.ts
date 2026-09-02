"use server";
/**
 * 人工退款(MONEY-A14 v2,规格 §7.6;Founder 2026-09-01 裁决 + 编排者 2026-09-02 两轮复审落修)。
 *
 * 为什么要一个专用动作,而不是继续「负向调账 + 后台手点 Stripe」:那条过渡路上有两笔钱要动
 * (商家的 credits、我们的马币),而它们之间没有任何东西保证顺序与配对。人退到一半走神,商家
 * 就既留着 credits 又拿回了钱;单号只在台账里,账本上那一行永远说不清自己是什么。
 *
 * 三段机械,一步都不新发明:
 *   ① `reserveCredits(refId = manual-refund:<退款单号>)` 先把要退的 credits **锁死**;
 *   ② `stripe.refunds.create` 拿到 `re_…`;
 *   ③ **只有 Stripe 报 `succeeded` 才** `settleCredits` 落账,SETTLE 行 reason 当场载 `re_…`。
 *
 * **单价不由人选,由那笔付款自己说了算(复审二 P1-1)。** 上一版让操作员从下拉里选「原购包」,
 * 单价按包价算 —— 而包是会改的:历史包 RM250/500cr 与今天的 Pro RM250/600cr **同额不同包**,
 * 选错了金额对得上、单价错 20%,退多退少都查不出来。现在单价一律从**这笔付款的事实**推导:
 *
 *     单价 = PI 实收(最小单位) ÷ 这笔购买真正入账的 credits
 *
 * 入账 credits 的权威是**账本自己**那一行 GRANT(`stripe:<sessionId>`,webhook 写的);Session
 * 上的 `metadata.credits` 拿来交叉核对,两者不一致就拒(fail closed)。找不到 GRANT 行 = 这笔
 * 付款从来没有入过账,更不该从它退钱。`CREDIT_PACKS` 此后只用来给这笔付款贴一个**展示用**的
 * 包名,不参与任何绑定或算钱。
 *
 * **一张退款单的事实,首次预扣时就钉进账本**(RESERVE 行的 reason,整数 internal 单位)。账本
 * 只追加,所以钉进去就改不了;同一个单号重试时,PI / 申请额 / allowPartial 三样必须逐字对得上,
 * 漂移一律拒绝(复审二 P2-3)。
 *
 * **收口凭据必须活过刷新**(复审二 P1-2):退款单号写进 Stripe 退款的 `metadata.manualRefundId`,
 * 所以即使我们这边的审计行没写成,`completeManualRefund` 也能从 Stripe 那边把 `re_…` 找回来;
 * 未终结的 hold 由 admin 页从**账本**列出(refId 就是单号),刷新页面不丢。
 *
 * 也正因为 pending 的 hold 要留着等人收口,`manual-refund:` 这条前缀被登记为**任何清道夫都不许
 * 碰**(`apps/worker/src/jobs/llm-reservation-reaper.test.ts` 的 NEVER_REAPED,有守卫测试)。
 *
 * 退款计入 30 天 / 2000 显示 credits 的人工调账累计闸,但**豁免**两道给消费用的闸——商家自设的
 * 单笔上限、账号暂停(编排者裁定 2026-09-02,判词见 `packages/db/src/credits.ts` 的
 * `isManualRefundRef`)。
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
  MANUAL_REFUND_REF_PREFIX,
  myrMinorToUsd,
} from "@fikirtive/core";
import { requireRole } from "./auth-guard";
import { activeMerchantOrg } from "./tenant-admin";
import { financeAdjustBlockedMessage } from "./finance-limit-seam";
import { stripe } from "./stripe";
import { founderAlert } from "./founder-alert";

/** Stripe 退款失败后写在 REFUND 行上的标签(账本成对释放的那一半)。 */
const STRIPE_FAILED_REASON = "manual-refund:stripe-failed";
/** 金额小到在马币上取整成 0 —— Stripe 一次都没碰过,所以不许写成「Stripe 失败」。 */
const ROUNDS_TO_ZERO_REASON = "manual-refund:rounds-to-zero";
/** 操作员确认 Stripe 那边根本没这笔退款之后,主动放弃这张单。 */
const ABANDONED_REASON = "manual-refund:abandoned";
/** 受理中(pending)的退款单落的审计行类型;`completeManualRefund` 优先靠它找回 `re_…`。 */
const PENDING_EVENT_TYPE = "manual-refund-pending";

export type RefundCreditsResult =
  | {
      ok: true;
      /** `settled` 落账完成;`pending` Stripe 还没给终态、hold 留着等收口;`already-settled` 这张单以前就退完了;
       *  `abandoned` 人放弃了这张单;`released` Stripe 自己说这笔退款 failed/canceled,hold 成对放掉。 */
      status: "settled" | "pending" | "already-settled" | "abandoned" | "released";
      refundId: string;
      displayedAmount: number;
      amountMinor: number;
      /** pending 时:那条「受理中」审计行到底写进去没有。false ⇒ 收口要靠 Stripe metadata 兜底。 */
      auditRecorded?: boolean;
    }
  | { error: string };

/**
 * **Stripe 是「明确拒绝了」,还是「我们不知道」?** 这两件事的处置相反,合并它们会亏钱。
 *
 * 释放预扣的前提是「那笔退款确定没有建出来」。一个网络超时、一个 5xx、一次幂等键撞参数,
 * 都可能发生在 Stripe **已经把钱退出去之后** —— 这时候再把 credits 还给商家,就成了「钱退了、
 * credits 也留着」,平台自己吃两遍。所以只有 Stripe 自己回了一个业务级拒绝才释放;其余一律
 * **保持预扣**并报警,由人去 Dashboard 核一眼,再用同一个单号补跑或人工收尾。
 */
function stripeDefinitelyRefused(e: unknown): boolean {
  const err = e as { type?: unknown; statusCode?: unknown };
  if (typeof err?.statusCode === "number" && err.statusCode >= 500) return false;
  return (
    err?.type === "StripeInvalidRequestError" ||
    err?.type === "StripeCardError" ||
    err?.type === "StripeAuthenticationError" ||
    err?.type === "StripePermissionError"
  );
}

/**
 * Stripe 那一侧的幂等键。**必须带 org**:账本的唯一键是 (orgId, refId),org 天然在里面;
 * Stripe 的幂等键是全账户一个平面的字符串,不带 org 就等于把两个租户的同名单号焊在一起。
 */
function stripeRefundIdempotencyKey(orgId: string, refundId: string): string {
  return `${MANUAL_REFUND_REF_PREFIX}${orgId}:${refundId}`;
}

/** 翻页防呆上限:100 页 × 100 条 = 一万条退款。 */
const REFUND_PAGE_CAP = 100;

/**
 * 这笔付款上**全部**的退款,翻完每一页(复审二 P2-1)。
 *
 * `limit: 100` 只是第一页。一笔被拆成上百次小额退的付款(争议处理里真的会发生)在旧写法下
 * 只被看见前 100 条,于是「还能退多少」算多了 —— 那是直接多退钱。`has_more` 为真就接着翻。
 *
 * 复审三 P2:翻到防呆上限而 `has_more` **仍然为真**时**抛错**,绝不返回「部分结果」。
 * 返回一份不完整的清单会让上面两件事同时算错:已退金额算少 ⇒ 多退;找不到那笔 `re_…` ⇒
 * Abandon 误以为它不存在、把 hold 放掉。两条都是真赔钱,所以这里 fail closed 交给人。
 */
async function listAllRefunds(paymentIntentId: string): Promise<{ id: string; amount: number; status: string | null; payment_intent?: unknown; metadata?: unknown }[]> {
  const all: { id: string; amount: number; status: string | null; payment_intent?: unknown; metadata?: unknown }[] = [];
  let startingAfter: string | undefined;
  for (let page = 0; page < REFUND_PAGE_CAP; page++) {
    const chunk = await stripe.refunds.list({
      payment_intent: paymentIntentId,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    all.push(...chunk.data);
    if (!chunk.has_more || chunk.data.length === 0) return all;
    startingAfter = chunk.data[chunk.data.length - 1]!.id;
  }
  throw new Error(
    `That payment has more than ${REFUND_PAGE_CAP * 100} refunds — more than we can check in one pass. Reconcile it by hand at Stripe first.`,
  );
}

/** 钱真的出去了的那些退款(failed/canceled 不算)。 */
function liveRefunds<T extends { status: string | null }>(refunds: T[]): T[] {
  return refunds.filter((r) => r.status !== "failed" && r.status !== "canceled");
}

/** 这笔付款的**事实**:金额、币种,以及它当初真正给商家入账了多少 credits。 */
type PaymentFacts = {
  paymentIntentId: string;
  receivedMinor: number;
  currency: string;
  /** 这笔购买真正入账的 credits(**内部**单位),权威 = 账本那一行 GRANT。 */
  creditedInternal: number;
  sessionId: string;
  /** 只为界面上贴个名字用的包标签;不参与任何计算。 */
  packLabel: string;
};

function metadataString(meta: unknown, key: string): string | null {
  const value = (meta as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" && value ? value : null;
}

/**
 * **这笔付款、这个 org、它当初入账多少 credits —— 三样都由事实说了算。**
 * (复审 P1-1 + 复审二 P1-1;跑在任何账本写入之前,只读。)
 *
 * 归属链:PI `metadata.orgId`(④a 起为新付款写入)→ Checkout Session 的 `metadata.orgId` /
 * `client_reference_id` → 账本 `stripe:<sessionId>` 那一行 GRANT 本身(它就是「这个 org 因这笔
 * session 到账」的证据)。三条都问不出来 = 不知道 = 拒绝,不许猜一个就退钱。
 *
 * 入账 credits:**必须**能在账本上找到那一行 GRANT。找不到 = 这笔付款从没入过账(webhook 掉了、
 * 或者根本不是充值),从它退钱没有任何依据。Session 带 `metadata.credits` 时两边交叉核对,
 * 不一致就拒 —— 那种不一致意味着我们对这笔钱的记账本身是错的,不该在上面再叠一笔退款。
 */
async function resolvePaymentFacts(args: {
  orgId: string;
  paymentIntentId: string;
}): Promise<{ ok: true; facts: PaymentFacts } | { error: string }> {
  const { orgId, paymentIntentId } = args;

  let pi: { id: string; amount: number; amount_received?: number | null; currency: string; metadata?: unknown };
  try {
    pi = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (e) {
    return { error: `Could not read that payment from Stripe: ${e instanceof Error ? e.message : "unknown error"}` };
  }

  // 复审三 P2:分母只认**实收**。回退到 `pi.amount`(授权额)会拿一个可能根本没扣到的数当单价
  // 分母 —— 授权未捕获、部分捕获、被撤销的付款都会因此算出一个凭空的单价并真的退出钱去。
  const receivedMinor = typeof pi.amount_received === "number" ? pi.amount_received : 0;
  if (!Number.isSafeInteger(receivedMinor) || receivedMinor <= 0) {
    return { error: "That payment has no captured amount to refund (Stripe reports nothing received). Nothing was refunded." };
  }
  if (pi.currency?.toLowerCase() !== CREDIT_PACK_CURRENCY) {
    return { error: `That payment is in ${pi.currency?.toUpperCase() ?? "an unknown currency"}, not ${CREDIT_PACK_CURRENCY.toUpperCase()}. Nothing was refunded.` };
  }

  const piOrgId = metadataString(pi.metadata, "orgId");
  if (piOrgId && piOrgId !== orgId) {
    return { error: "That payment belongs to a different workspace. Nothing was refunded." };
  }

  // Session:入账 credits 的反查钥匙(`stripe:<sessionId>`),同时是归属链的第二环。
  let session: { id: string; metadata?: unknown; client_reference_id?: string | null } | undefined;
  try {
    // 复审三 P2:要 2 条不是 1 条 —— 取 `data[0]` 时若有第二条命中,我们其实是在几个 session
    // 里**随便挑了一个**去反查入账 credits,而单价的分母正是它。歧义只能交给人,不能默默挑。
    const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 2 });
    if (sessions.data.length > 1) {
      return { error: "That payment maps to multiple checkout sessions. Refusing — reconcile it by hand before refunding." };
    }
    session = sessions.data[0];
  } catch {
    // 读不到 session 不改变结论:下面「找不到入账记录就拒」照旧执行。
  }
  if (!session) {
    return { error: "Could not find the checkout that paid for this. Refusing — check the payment intent id." };
  }
  const sessionOrgId = metadataString(session.metadata, "orgId") ?? (typeof session.client_reference_id === "string" ? session.client_reference_id : null);
  if (sessionOrgId && sessionOrgId !== orgId) {
    return { error: "That payment belongs to a different workspace. Nothing was refunded." };
  }

  // 入账 credits 的权威:账本那一行 GRANT。它同时是**归属链的最后一环** —— PI 与 session 都没写
  // orgId 的老付款(`piOrgId`/`sessionOrgId` 皆空)靠它证明归属:这一行是按 (orgId, 幂等键) 查出
  // 来的,它存在本身就说明这笔 session 的 credits 进的是这个 org。
  const granted = await prisma.creditLedger.findFirst({
    where: { orgId, idempotencyKey: `stripe:${session.id}`, kind: "GRANT" },
    select: { balanceDelta: true },
  });
  if (!granted || granted.balanceDelta <= 0) {
    return { error: "That payment never credited this workspace (no ledger grant for it). Refusing — check the payment intent id." };
  }

  const creditedInternal = granted.balanceDelta;
  // Session 上的 credits 与账本交叉核对(两边都有的时候)。
  const sessionCredits = Number(metadataString(session.metadata, "credits") ?? NaN);
  if (Number.isFinite(sessionCredits) && sessionCredits * INTERNAL_PER_DISPLAY !== creditedInternal) {
    return {
      error: `Stripe says that checkout was ${sessionCredits} credits but the ledger granted ${displayCredits(creditedInternal)}. Refusing until that is reconciled.`,
    };
  }

  // 只为界面贴个名字:金额与 credits 都对得上在售包表里的某一个,就叫它的名字;对不上就如实说
  // 「历史包」——它是**标签**,不是依据。
  const known = CREDIT_PACKS.find((p) => p.amountMinor === receivedMinor && p.credits * INTERNAL_PER_DISPLAY === creditedInternal);
  const packLabel = known ? known.name : `Legacy pack — RM${(receivedMinor / 100).toFixed(2)} → ${displayCredits(creditedInternal)} credits`;

  return { ok: true, facts: { paymentIntentId, receivedMinor, currency: CREDIT_PACK_CURRENCY, creditedInternal, sessionId: session.id, packLabel } };
}

/**
 * 退款金额换算 —— **按这笔付款自己的单价**(复审二 P1-1),整数算术,向下取整到「仙」。
 *
 *     minor = ⌊ 要退的 internal credits × 这笔付款实收 ÷ 这笔付款入账的 internal credits ⌋
 *
 * 全程整数、不经过一次浮点显示单位,所以 `internal = 405`(40.5 显示 credits)这种非 10 倍数
 * 也算得准。方向永远是少退一分,不是多退一分。
 */
function refundMinorFor(internalCredits: number, facts: { receivedMinor: number; creditedInternal: number }): number {
  return Math.floor((internalCredits * facts.receivedMinor) / facts.creditedInternal);
}

/** 一张退款单被批准时钉进账本的全部事实。单位一律是**整数**(internal credits / 最小货币单位)。 */
type RefundPin = {
  paymentIntentId: string;
  /** 操作员**申请**的额度(internal),漂移比对用。 */
  requestedInternal: number;
  /** 实际锁住的额度(internal);allowPartial 时可能小于申请额。 */
  heldInternal: number;
  /** 真正要退给 Stripe 的钱(最小货币单位)。 */
  amountMinor: number;
  currency: string;
  allowPartial: boolean;
};

function encodePin(pin: RefundPin): string {
  return `pi:${pin.paymentIntentId}|req:${pin.requestedInternal}|held:${pin.heldInternal}|minor:${pin.amountMinor}|cur:${pin.currency}|partial:${pin.allowPartial ? 1 : 0}`;
}

function decodePin(reason: string): RefundPin | null {
  const pi = /pi:(pi_[A-Za-z0-9]+)/.exec(reason)?.[1];
  const req = Number(/\|req:(\d+)/.exec(reason)?.[1]);
  const held = Number(/\|held:(\d+)/.exec(reason)?.[1]);
  const minor = Number(/\|minor:(\d+)/.exec(reason)?.[1]);
  const cur = /\|cur:([a-z]+)/.exec(reason)?.[1];
  const partial = /\|partial:([01])/.exec(reason)?.[1];
  if (!pi || !cur || !partial) return null;
  if (![req, held, minor].every((n) => Number.isSafeInteger(n))) return null;
  return { paymentIntentId: pi, requestedInternal: req, heldInternal: held, amountMinor: minor, currency: cur, allowPartial: partial === "1" };
}

/**
 * 同一个退款单号,这次带来的参数与当初钉下的那一组一致吗?(复审二 P2-3。)
 *
 * 不一致 = 这个单号被拿去做另一件事了。它是幂等键:放行就意味着「同一个键、两笔不同的钱」,
 * 而 Stripe 那边只认第一笔 —— 页面会显示第二笔的数字,实际退的是第一笔。一律拒绝并说清楚。
 */
function pinDrift(pin: RefundPin, request: { paymentIntentId: string; requestedInternal: number; allowPartial: boolean }): string | null {
  if (pin.paymentIntentId !== request.paymentIntentId) return `payment ${pin.paymentIntentId}`;
  if (pin.requestedInternal !== request.requestedInternal) return `${displayCredits(pin.requestedInternal)} credits`;
  if (pin.allowPartial !== request.allowPartial) return pin.allowPartial ? "a partial refund" : "a full refund";
  return null;
}

function driftError(pin: RefundPin, what: string): { error: string } {
  return {
    error:
      `That refund id was already opened for ${what} (${pin.paymentIntentId}, ${displayCredits(pin.requestedInternal)} credits` +
      `${pin.allowPartial ? ", partial allowed" : ""}). Re-enter those exact details to finish it, or start a new refund id.`,
  };
}

/** SETTLE 行的 reason:退款单号 + 两种口径的金额(台账反查用;`reason` 不进商家读路径,#683)。 */
function settleReasonFor(refundStripeId: string, amountMinor: number): string {
  return `stripe-refund:${refundStripeId} myr_minor:${amountMinor} usd:${myrMinorToUsd(amountMinor).toFixed(2)}`;
}

function settledRefundFromReason(reason: string): { refundId: string; amountMinor: number } {
  return {
    refundId: /stripe-refund:(re_[A-Za-z0-9]+)/.exec(reason)?.[1] ?? "",
    amountMinor: Number(/myr_minor:(\d+)/.exec(reason)?.[1] ?? 0),
  };
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

/** 共用的入参校验(两个收口动作也用同一套)。 */
async function gateOrgAndTicket(v: { orgId?: unknown; refundId?: unknown }): Promise<
  { ok: true; orgId: string; refundId: string; refId: string; via: string } | { error: string }
> {
  const gate = await requireRole("tenants", "mutate");
  if ("error" in gate) return gate;
  const orgId = typeof v?.orgId === "string" ? v.orgId : "";
  if (!orgId || orgId === FOUNDER_OWNER_ID) return { error: "Pick a merchant org." };
  const refundId = typeof v?.refundId === "string" ? v.refundId.trim() : "";
  if (refundId.length < 8 || refundId.length > 64 || !/^[A-Za-z0-9:_-]+$/.test(refundId)) {
    return { error: "Invalid refund id." };
  }
  return { ok: true, orgId, refundId, refId: manualRefundRefId(refundId), via: gate.email };
}

export async function refundCreditsAction(raw: unknown): Promise<RefundCreditsResult> {
  const v = raw as {
    orgId?: unknown; displayedAmount?: unknown; paymentIntentId?: unknown;
    refundId?: unknown; allowPartial?: unknown; reason?: unknown;
  };
  // 跨租户 + 动真钱:与 `grantTenantCredits` 同一把闸(super-admin),判的是 `tenants.mutate`
  // 这个 capability,不按角色名。
  const entry = await gateOrgAndTicket(v);
  if ("error" in entry) return entry;
  const { orgId, refundId, refId, via } = entry;
  if (!(await activeMerchantOrg(orgId))) return { error: "Unknown or closed org." };

  const displayedAmount = typeof v?.displayedAmount === "number" ? v.displayedAmount : NaN;
  // 退款只能是正数:这个动作**扣**商家的 credits 并把钱退回去。负数是另一件事(授信)。
  if (!Number.isInteger(displayedAmount) || displayedAmount <= 0) return { error: "Enter a whole number of credits to refund." };
  if (displayedAmount > FINANCE_ADJUST_LIMITS.perActionDisplay) return { error: FINANCE_PER_ACTION_LIMIT_MESSAGE };

  const paymentIntentId = typeof v?.paymentIntentId === "string" ? v.paymentIntentId.trim() : "";
  if (!/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return { error: "Enter the original payment intent id (pi_…)." };

  const allowPartial = v?.allowPartial === true;
  const note = typeof v?.reason === "string" ? v.reason.slice(0, 500) : "";
  const requestedInternal = displayedAmount * INTERNAL_PER_DISPLAY;
  const request = { paymentIntentId, requestedInternal, allowPartial };

  // ── 重放与断点续跑 ────────────────────────────────────────────────────────
  // 三种可能,答案完全不同:落过账了 / 释放过了 / 只预扣了一半。三条都先比对事实元组,
  // 漂移一律拒绝(复审二 P2-3)。
  let state = await readLedgerState(orgId, refId);
  if (state.settled) {
    const pin = state.hold ? decodePin(state.hold.reason) : null;
    if (pin) {
      const drift = pinDrift(pin, request);
      if (drift) return driftError(pin, drift);
    }
    return settledResult(state);
  }
  if (state.released) {
    return { error: "That refund id is already closed (released after a Stripe failure, or abandoned). Start a new refund id." };
  }

  // ── ① 预扣:credits 先锁死 ────────────────────────────────────────────────
  let pin: RefundPin;
  // 这一趟是**续跑**吗?(hold 早就在了,或者并发里我是输的那一笔。)续跑在发 Stripe 之前必须
  // 先查一次(复审四 P1),首次则不必 —— 它自己就是第一笔。
  let resuming = false;
  if (!state.hold) {
    // 动 Stripe 之前先把这笔付款的事实查清楚:归属、实收、入账 credits(P1-1)。
    const resolved = await resolvePaymentFacts({ orgId, paymentIntentId });
    if ("error" in resolved) return resolved;
    const facts = resolved.facts;

    // 退得起吗?两个口径都要过:credits 口径(这笔付款还剩多少 credits 没退)与钱口径。
    let alreadyRefundedMinor: number;
    try {
      alreadyRefundedMinor = liveRefunds(await listAllRefunds(paymentIntentId)).reduce((sum, r) => sum + (r.amount ?? 0), 0);
    } catch (e) {
      // 读不到已退金额 = 不知道还剩多少可退 ⇒ fail closed。
      return { error: `Could not read existing refunds for that payment: ${e instanceof Error ? e.message : "unknown error"}` };
    }
    // 已退的钱折回 credits 用**向上取整**:宁可把还能退的额度算少一点。
    const refundedInternalEquivalent = Math.ceil((alreadyRefundedMinor * facts.creditedInternal) / facts.receivedMinor);
    const refundableInternal = facts.creditedInternal - refundedInternalEquivalent;
    if (requestedInternal > refundableInternal) {
      return {
        error:
          `That payment only has ${displayCredits(Math.max(0, refundableInternal))} credits left to refund ` +
          `(it credited ${displayCredits(facts.creditedInternal)}; RM${(alreadyRefundedMinor / 100).toFixed(2)} already refunded). Nothing was refunded.`,
      };
    }
    const plannedMinor = refundMinorFor(requestedInternal, facts);
    if (plannedMinor <= 0) return { error: "That amount rounds to nothing in ringgit. Nothing was refunded." };
    if (plannedMinor > facts.receivedMinor - alreadyRefundedMinor) {
      return { error: `That payment only has RM${((facts.receivedMinor - alreadyRefundedMinor) / 100).toFixed(2)} left to refund. Nothing was refunded.` };
    }

    try {
      pin = await prisma.$transaction(async (tx) => {
        let cost = requestedInternal;
        if (allowPartial) {
          // 「按可扣部分退」:读一次余额只是**决定要多少**,守住账户的仍然是预扣那一句条件更新。
          const acc = await tx.creditAccount.findUnique({ where: { orgId }, select: { balance: true } });
          cost = Math.min(cost, acc?.balance ?? 0);
        }
        // 0 credits 的退款是**不存在**的东西:`reserveCredits` 对 cost<=0 直接 no-op,不留任何行。
        if (cost <= 0) throw new InsufficientCredits("No refundable balance left in that workspace.");
        const minor = refundMinorFor(cost, facts);
        if (minor <= 0) throw new InsufficientCredits("That amount rounds to nothing in ringgit.");
        const fresh: RefundPin = { paymentIntentId, requestedInternal, heldInternal: cost, amountMinor: minor, currency: facts.currency, allowPartial };
        await assertWithinAdjustWindow(tx, orgId, cost);
        await reserveCredits(tx, { orgId, refId, cost, reason: encodePin(fresh) });
        return fresh;
      });
    } catch (e) {
      // 复审 P2-1 —— 同一个单号被并发点了两次:输的那一笔撞 `reserve:<refId>` 唯一键。那不是错误,
      // 是「hold 已经在了」。重读账本、比对事实,再按既有事实继续。
      if (isUniqueViolation(e)) {
        state = await readLedgerState(orgId, refId);
        if (state.settled) {
          const settledPin = state.hold ? decodePin(state.hold.reason) : null;
          if (settledPin) {
            const drift = pinDrift(settledPin, request);
            if (drift) return driftError(settledPin, drift);
          }
          return settledResult(state);
        }
        if (state.released) return { error: "That refund id is already closed (released after a Stripe failure, or abandoned). Start a new refund id." };
        if (!state.hold) throw e; // 撞了唯一键却读不到那一行 = 账本自相矛盾,不许猜
        const pinned = decodePin(state.hold.reason);
        if (!pinned) return { error: "That refund id already has a hold, but its details could not be read. Check the ledger before retrying." };
        const drift = pinDrift(pinned, request);
        if (drift) return driftError(pinned, drift);
        pin = pinned;
        resuming = true;
      } else if (e instanceof FinanceAdjustBlocked) {
        return { error: await financeAdjustBlockedMessage(e, { via, entry: "refundCreditsAction" }) };
      } else if (e instanceof OrgSuspended) {
        return { error: "That workspace is suspended and the refund leg was refused. Nothing was refunded." };
      } else if (e instanceof InsufficientCredits) {
        return { error: allowPartial ? "That workspace has no credits left to claw back." : "Not enough unused credits to refund that amount. Refuse the refund, or re-run it as a partial." };
      } else {
        throw e;
      }
    }
  } else {
    // 续跑:事实以**账本上钉着的那一份**为准,这次的参数只能用来核对,不能改写。
    const pinned = decodePin(state.hold.reason);
    if (!pinned) {
      return { error: "That refund id already has a hold, but its details could not be read. Check the ledger before retrying." };
    }
    const drift = pinDrift(pinned, request);
    if (drift) return driftError(pinned, drift);
    pin = pinned;
    resuming = true;
  }

  // ── ①.5 续跑先查、后建(复审四 P1)────────────────────────────────────────
  //
  // 幂等键**不是**一道能一直站着的防线:Stripe 的幂等键 24 小时后过期,过期之后同一个请求会被
  // 当成全新的一笔,于是退第二次钱、而账本只扣了一次。同样的事在换键那一刻也会发生一次(旧键
  // 建过单、客户端超时,新键重试 = 新请求)。所以任何**已经有 hold** 的重跑,在发 create 之前
  // 先只读地问一次 Stripe「这张单是不是已经有退款了」:
  //   有 → 按它的状态收口(succeeded 落账 / failed·canceled 成对释放 / pending 保持 hold);
  //   没有 → 才 create。
  // 查找本身翻页 fail closed,看不全就整趟拒绝 —— 看不全时 create 等于在瞎猜。
  if (resuming) {
    const existing = await findStripeRefund({ orgId, refundId, paymentIntentId: pin.paymentIntentId });
    if ("error" in existing) return existing;
    if (existing.found) {
      return finishRefund({ orgId, refId, refundId, refund: existing.refund, pin, note, via });
    }
  }

  // ── ② Stripe:钱回商家的卡 ────────────────────────────────────────────────
  // **两把键,两条边界**(复审三 P2):
  //   · 账本 refId = `manual-refund:<uuid>` —— 唯一键是 (orgId, refId),org 已经在键里,
  //     所以两个 org 各自用同一个 uuid 也互不干扰;
  //   · Stripe 幂等键 = `manual-refund:<orgId>:<uuid>` —— Stripe 那边**没有 org 这一维**,
  //     键里不带 org 的话,两个 org 恰好用同一个 uuid(操作员复制粘贴、脚本重放)就会共用一把
  //     幂等键:第二个 org 的退款请求会拿回第一个 org 那笔退款的结果,钱退给了错的商家,而两边
  //     账本都各自「成功」。org 必须进键。
  // metadata 里再写一份退款单号与 org(复审二 P1-2):我们这边的审计行万一没写成,收口时还能
  // 从 Stripe 那边按 uuid 找回这笔退款、并核对它确实属于本单。
  let refund: { id: string; status: string | null };
  try {
    refund = await stripe.refunds.create(
      { payment_intent: pin.paymentIntentId, amount: pin.amountMinor, metadata: { manualRefundId: refundId, orgId } },
      { idempotencyKey: stripeRefundIdempotencyKey(orgId, refundId) },
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Stripe refused the refund.";
    if (!stripeDefinitelyRefused(e)) {
      await founderAlert({
        key: "finance.manual_refund_outcome_unknown",
        title: `Manual refund ${refundId} for ${orgId} did not get a clear answer from Stripe.`,
        action:
          `Check Stripe for a refund on ${pin.paymentIntentId}. If it exists, finish it from the tenant page with the SAME refund id; ` +
          "if it does not, use Abandon there. The credits stay held until then — never release them by hand.",
        context: { orgId, refundId, paymentIntentId: pin.paymentIntentId, amountMinor: pin.amountMinor, displayedAmount: displayCredits(pin.heldInternal), via, detail },
      });
      return { error: `Stripe did not give a clear answer (${detail}). The credits stay held — check Stripe, then finish or abandon this refund id from the open holds list.` };
    }
    await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId, reason: STRIPE_FAILED_REASON }));
    return { error: `Stripe refused the refund, so the hold was released and the balance is unchanged: ${detail}` };
  }

  return finishRefund({ orgId, refId, refundId, refund, pin, note, via });
}

/**
 * 第三段(落账 / 释放 / 继续等),三个动作共用。
 *
 * **只有 `succeeded` 才落账**(复审 P1-2)。`pending` / `requires_action` 的意思是「Stripe 受理了,
 * 但还没到终态」;那时候写 SETTLE 等于替它说了一句它还没说的话,而这笔退款仍然可能失败,那样
 * 商家就是 credits 被扣了、钱没回去。所以 pending 的单子把 hold **原样留着**、落一条审计行、
 * 发一条报警,由人从「未收口的退款」列表按 Complete 收口。
 */
async function finishRefund(args: {
  orgId: string;
  refId: string;
  refundId: string;
  refund: { id: string; status: string | null };
  pin: RefundPin;
  note: string;
  via: string;
}): Promise<RefundCreditsResult> {
  const { orgId, refId, refundId, refund, pin, note, via } = args;
  const displayedAmount = displayCredits(pin.heldInternal);

  if (refund.status === "failed" || refund.status === "canceled") {
    await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId, reason: STRIPE_FAILED_REASON }));
    return { error: `Stripe reported the refund as ${refund.status}. The hold was released and the balance is unchanged.` };
  }

  if (refund.status !== "succeeded") {
    // 受理中。审计行带着 `re_…`;它写失败**不再静默**(复审二 P1-2e)——结果里如实说
    // `auditRecorded:false`,恢复路径是按 Stripe metadata 反查(completeManualRefund 会做)。
    let auditRecorded = true;
    try {
      await prisma.actionEvent.create({
        data: {
          id: newId(), ownerId: orgId, type: `${PENDING_EVENT_TYPE}:${refundId}`,
          payload: { stripeRefundId: refund.id, status: refund.status, paymentIntentId: pin.paymentIntentId, amountMinor: pin.amountMinor, displayedAmount, via },
        },
      });
    } catch (e) {
      auditRecorded = false;
      console.error(`[manual-refund] pending audit row failed for ${refundId} (${refund.id}):`, e instanceof Error ? e.message : e);
    }
    await founderAlert({
      key: "finance.manual_refund_pending",
      title: `Manual refund ${refund.id} for ${orgId} is ${refund.status ?? "pending"} at Stripe.`,
      action:
        `Do not start another refund for this payment. The credits stay held until Stripe settles it — ` +
        `finish it from the tenant page's open holds list (refund id ${refundId}) once Stripe reports succeeded.`,
      context: { orgId, refundId, stripeRefundId: refund.id, status: refund.status, amountMinor: pin.amountMinor, displayedAmount, auditRecorded, via },
    });
    return { ok: true, status: "pending", refundId: refund.id, displayedAmount, amountMinor: pin.amountMinor, auditRecorded };
  }

  try {
    await prisma.$transaction((tx) => settleCredits(tx, { orgId, refId, reason: settleReasonFor(refund.id, pin.amountMinor) }));
  } catch {
    await founderAlert({
      key: "finance.manual_refund_settle_failed",
      title: `Manual refund ${refund.id} was paid but its ledger settle failed.`,
      action: `Finish the same refund id (${refundId}) from the tenant page's open holds list — Stripe is idempotent, so it will not refund twice.`,
      context: { orgId, refundId, stripeRefundId: refund.id, amountMinor: pin.amountMinor, displayedAmount, via },
    });
    return { error: `Stripe refunded ${refund.id} but the ledger settle failed. Finish the SAME refund id from the open holds list — nothing will be refunded twice.` };
  }

  await prisma.actionEvent.create({
    data: {
      id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.credits.refund",
      payload: { orgId, refundId, stripeRefundId: refund.id, paymentIntentId: pin.paymentIntentId, displayedAmount, amountMinor: pin.amountMinor, reason: note, via },
    },
  }).catch(() => {});
  await prisma.actionEvent.create({
    data: {
      id: newId(), ownerId: orgId, type: "credits.refund",
      payload: { refundId, stripeRefundId: refund.id, displayedAmount, amountMinor: pin.amountMinor, via },
    },
  }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`);
  return { ok: true, status: "settled", refundId: refund.id, displayedAmount, amountMinor: pin.amountMinor };
}

/**
 * 这张单在 Stripe 那边到底有没有一笔退款?(复审二 P1-2b。)
 *
 * 顺序:先看我们自己的审计行(便宜、直接);没有就去 Stripe 上按 `metadata.manualRefundId`
 * **翻完每一页**找。两处都没有 = 这张单从来没到过 Stripe(或者创建请求根本没发出去)。
 *
 * 为什么不能用「再 create 一次」代替:Stripe 的幂等键 24 小时后过期,过期之后同样的请求会退
 * **第二笔**。查找必须是只读的。
 */
async function findStripeRefund(args: { orgId: string; refundId: string; paymentIntentId: string }): Promise<
  { found: true; refund: { id: string; status: string | null } } | { found: false } | { error: string }
> {
  const { orgId, refundId, paymentIntentId } = args;
  const audit = await prisma.actionEvent.findFirst({
    where: { ownerId: orgId, type: `${PENDING_EVENT_TYPE}:${refundId}` },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const recorded = (audit?.payload as { stripeRefundId?: unknown } | null)?.stripeRefundId;
  if (typeof recorded === "string" && recorded) {
    let candidate: { id: string; status: string | null; payment_intent?: unknown; metadata?: unknown };
    try {
      candidate = await stripe.refunds.retrieve(recorded);
    } catch (e) {
      return { error: `Could not read refund ${recorded} from Stripe: ${e instanceof Error ? e.message : "unknown error"}` };
    }
    // 复审三 P2:审计行只是**一个指针**,不是证据。它可能被写错、被别的单号的载荷覆盖,或者
    // 指向另一个租户的退款。照着它 SETTLE 就是拿另一笔退款给这张单结账,照着它释放同样错。
    // 三项事实(付款、单号、org)必须逐项对上,任何一项不符 ⇒ 拒,既不落账也不释放。
    const mismatch = refundMismatch(candidate, { orgId, refundId, paymentIntentId });
    if (mismatch) {
      return { error: `The audited refund ${candidate.id} does not match this ticket (${mismatch}). Refusing — reconcile it by hand at Stripe.` };
    }
    return { found: true, refund: candidate };
  }
  try {
    const match = (await listAllRefunds(paymentIntentId)).find(
      (r) => metadataString(r.metadata, "manualRefundId") === refundId,
    );
    if (!match) return { found: false };
    // 列表本身是按这笔付款查的,单号也刚比过;org 再核一次,来源同一把尺。
    const mismatch = refundMismatch({ ...match, payment_intent: paymentIntentId }, { orgId, refundId, paymentIntentId });
    if (mismatch) {
      return { error: `Stripe refund ${match.id} carries this ticket id but does not match it (${mismatch}). Refusing — reconcile it by hand at Stripe.` };
    }
    return { found: true, refund: match };
  } catch (e) {
    return { error: `Could not search that payment's refunds at Stripe: ${e instanceof Error ? e.message : "unknown error"}` };
  }
}

/** Stripe 退款对象上的 `payment_intent`(可能是 id,也可能是被展开的对象)。 */
function refundPaymentIntentId(refund: { payment_intent?: unknown }): string | null {
  const value = refund.payment_intent;
  if (typeof value === "string") return value || null;
  const id = (value as { id?: unknown } | null | undefined)?.id;
  return typeof id === "string" && id ? id : null;
}

/** 这笔 Stripe 退款到底是不是本单的?对不上就说出**哪一项**对不上(复审三 P2)。 */
function refundMismatch(
  refund: { payment_intent?: unknown; metadata?: unknown },
  expect: { orgId: string; refundId: string; paymentIntentId: string },
): string | null {
  const pi = refundPaymentIntentId(refund);
  if (pi !== expect.paymentIntentId) return `it refunds ${pi ?? "an unknown payment"}, not ${expect.paymentIntentId}`;
  const ticket = metadataString(refund.metadata, "manualRefundId");
  if (ticket !== expect.refundId) return `it carries refund id ${ticket ?? "none"}`;
  const owner = metadataString(refund.metadata, "orgId");
  if (owner !== expect.orgId) return `it belongs to workspace ${owner ?? "unknown"}`;
  return null;
}

/**
 * 收口一张**受理中**的退款单:去 Stripe 重读状态,succeeded 才落账、failed/canceled 成对释放、
 * 仍 pending 就如实说还在等。**不会**发起第二笔退款(全程只读查找)。
 */
export async function completeManualRefund(raw: unknown): Promise<RefundCreditsResult> {
  const entry = await gateOrgAndTicket(raw as { orgId?: unknown; refundId?: unknown });
  if ("error" in entry) return entry;
  const { orgId, refundId, refId, via } = entry;

  const state = await readLedgerState(orgId, refId);
  if (state.settled) return settledResult(state);
  if (state.released) return { error: "That refund id is already closed (released after a Stripe failure, or abandoned). Start a new refund id." };
  if (!state.hold) return { error: "No open refund with that id in this workspace." };
  const pin = decodePin(state.hold.reason);
  if (!pin) return { error: "That hold's details could not be read. Check the ledger before finishing it by hand." };

  const found = await findStripeRefund({ orgId, refundId, paymentIntentId: pin.paymentIntentId });
  if ("error" in found) return found;
  if (!found.found) {
    // 找不到 ⇒ **什么都不动**。释放 hold 是 Abandon 的职责,而它自己会再查一次。
    return { error: "Stripe has no refund for that id. If you are sure it never went through, use Abandon to release the hold." };
  }
  return finishRefund({ orgId, refId, refundId, refund: found.refund, pin, note: "", via });
}

/**
 * 放弃一张退款单:把锁着的 credits 还给商家,账本成对(复审二 P1-2c)。
 *
 * **只在钱确定没出去时才放行**:Stripe 上没有这笔退款,或者有、但它自己说 `failed`/`canceled`
 * (复审三 P2)。钱已经退出去却把 credits 也还回去,就是平台白付两遍;反过来,一笔已经 failed
 * 的退款如果连放弃都不许,那商家的 credits 就永远锁在那里等人改库。
 * 残余竞态:`refunds.create` 还在路上(几百毫秒)时来 abandon 会漏看它,所以 runbook 要求操作员
 * 先在 Stripe 后台确认,再回来 abandon;正常流程里这两件事隔着分钟级,撞不上。
 */
export async function abandonManualRefund(raw: unknown): Promise<RefundCreditsResult> {
  const entry = await gateOrgAndTicket(raw as { orgId?: unknown; refundId?: unknown });
  if ("error" in entry) return entry;
  const { orgId, refundId, refId, via } = entry;

  const state = await readLedgerState(orgId, refId);
  if (state.settled) return settledResult(state);
  if (state.released) return { error: "That refund id is already closed (released after a Stripe failure, or abandoned). Start a new refund id." };
  if (!state.hold) return { error: "No open refund with that id in this workspace." };
  const pin = decodePin(state.hold.reason);
  if (!pin) return { error: "That hold's details could not be read. Check the ledger before releasing it by hand." };

  const found = await findStripeRefund({ orgId, refundId, paymentIntentId: pin.paymentIntentId });
  if ("error" in found) return found;
  // 复审三 P2:Stripe 上**有**这笔退款,但它自己说 failed/canceled —— 钱一分没出去,这个 hold
  // 就是死锁在那儿的。以前一律拒绝放弃,商家的 credits 只能等人去改数据库。现在照 Complete 的
  // 同一条口径成对释放(幂等靠账本 finalizer 的唯一键,重复点只会得到「已释放」)。
  if (found.found) {
    const status = found.refund.status;
    if (status !== "failed" && status !== "canceled") {
      return {
        error: `Stripe has refund ${found.refund.id} (${status ?? "pending"}) for that id — it cannot be abandoned. Use Complete once Stripe settles it.`,
      };
    }
    await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId, reason: STRIPE_FAILED_REASON }));
    await prisma.actionEvent.create({
      data: {
        id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.credits.refund.released",
        payload: { orgId, refundId, stripeRefundId: found.refund.id, status, paymentIntentId: pin.paymentIntentId, displayedAmount: displayCredits(pin.heldInternal), amountMinor: pin.amountMinor, via },
      },
    }).catch(() => {});
    revalidatePath(`/admin/tenants/${orgId}`);
    return { ok: true, status: "released", refundId: found.refund.id, displayedAmount: displayCredits(pin.heldInternal), amountMinor: pin.amountMinor };
  }

  await prisma.$transaction((tx) => refundReservation(tx, { orgId, refId, reason: ABANDONED_REASON }));
  await prisma.actionEvent.create({
    data: {
      id: newId(), ownerId: FOUNDER_OWNER_ID, type: "tenant.credits.refund.abandoned",
      payload: { orgId, refundId, paymentIntentId: pin.paymentIntentId, displayedAmount: displayCredits(pin.heldInternal), amountMinor: pin.amountMinor, via },
    },
  }).catch(() => {});
  revalidatePath(`/admin/tenants/${orgId}`);
  return { ok: true, status: "abandoned", refundId, displayedAmount: displayCredits(pin.heldInternal), amountMinor: pin.amountMinor };
}
