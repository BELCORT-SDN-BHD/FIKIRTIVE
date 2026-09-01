/**
 * 人工调账与人工退款的**额度单一源**(MONEY-A14 / 规格 §7.6)。
 *
 * 为什么单独一个文件:这两个数此前是**五处手抄**(服务端 `tenant-actions.ts` / `credit-actions.ts`、
 * 客户端预检 `TenantDetail.tsx` / `AdminDashboardV2.tsx`、报表 `admin-v2.ts`)另加三处提示文案里
 * 的字面 "1,000"。改一个上限要记得改八个地方,改漏一个的后果是「界面说 1000、服务端放行 5000」
 * 这一类**没有人会当场发现**的错。价格与额度一律回到单一源(CLAUDE.md §7.3)。
 *
 * **两种单位,一个都不许手算**。商家看到的是**显示** credits(1 显示 credit = $0.10),账本写的是
 * **内部** credits(1 = $0.01),换算比 `INTERNAL_PER_DISPLAY` = 10。判定跑在账本层(`grantCredits`
 * 的同一事务里),用的必须是内部口径;表单与文案用显示口径。两个口径都在这里算好导出,调用方
 * 不再自己乘 10 —— 「2000 显示 = 20000 内部」有一条测试钉着。
 */
import { INTERNAL_PER_DISPLAY } from "./spend.js";

/**
 * Founder 2026-09-01 拍板:单笔 1000 显示 credits、滚动 30 天合计 2000 显示 credits。
 *
 * 累计闸的口径(判定实现见 `packages/db/src/credits.ts` 的 `assertWithinAdjustWindow`):
 * `source=ADMIN` 的 GRANT/ADJUST 行 + refId 前缀 `manual-refund:` 的 RESERVE 行,取
 * `|balanceDelta|` 合计,**含本笔**;负向同计(一笔 −1000 的扣减与一笔 +1000 的授信一样占额度)。
 *
 * 撞闸=设计内摩擦,不是 bug:单月两个 Pro 包(1200cr)的退款会撞上 2000 的合计闸。解法是**改这里的
 * 常量、走 PR + Founder 批**,不是在调用方绕过它。
 */
export const FINANCE_ADJUST_LIMITS = {
  /** 单笔上限(显示 credits)。 */
  perActionDisplay: 1_000,
  /** 滚动窗口合计上限(显示 credits)。 */
  rolling30dTotalDisplay: 2_000,
  /** 滚动窗口长度(天)。 */
  windowDays: 30,
  /** 单笔上限(内部 credits)—— 账本层判定用这个。 */
  perActionInternal: 1_000 * INTERNAL_PER_DISPLAY,
  /** 滚动窗口合计上限(内部 credits)—— 账本层判定用这个。 */
  rolling30dTotalInternal: 2_000 * INTERNAL_PER_DISPLAY,
} as const;

/** 滚动窗口的毫秒长度(账本查询用)。 */
export const FINANCE_ADJUST_WINDOW_MS = FINANCE_ADJUST_LIMITS.windowDays * 24 * 60 * 60 * 1000;

/**
 * 人工退款那条钱腿的 refId 前缀(MONEY-A14):`manual-refund:<uuid>`,uuid **就是退款单号**,
 * 由发起方带进来并作为幂等键 —— 同一张退款单重试用同一个 uuid,预扣、Stripe 退款、落账三段
 * 因此都是**恰好一次**。
 *
 * 它同时是三个地方的同一把钥匙,所以只能有一份:
 *   · `packages/db` 的累计闸靠它把退款算进同一个 30 天口径;
 *   · `spendCategoryOf` 靠它把这一行读成商家看得懂的「Refund」(而不是泛泛的 Adjustment);
 *   · admin 报表靠它把退款并进「大额调账」那张表。
 */
export const MANUAL_REFUND_REF_PREFIX = "manual-refund:";

/** `manual-refund:<uuid>` —— 退款单号拼成账本 refId 的唯一写法。 */
export function manualRefundRefId(refundUuid: string): string {
  return `${MANUAL_REFUND_REF_PREFIX}${refundUuid}`;
}

/** 单笔超限时对操作员说的那一句(此前在四处各抄一份)。 */
export const FINANCE_PER_ACTION_LIMIT_MESSAGE =
  `Credit actions are capped at ${FINANCE_ADJUST_LIMITS.perActionDisplay.toLocaleString("en-US")} displayed credits each.`;

/** 30 天累计超限时对操作员说的那一句。 */
export function financeRollingLimitMessage(usedDisplay: number): string {
  return (
    `Manual credit movements are capped at ${FINANCE_ADJUST_LIMITS.rolling30dTotalDisplay.toLocaleString("en-US")} ` +
    `displayed credits per ${FINANCE_ADJUST_LIMITS.windowDays} days for one workspace ` +
    `(${usedDisplay.toLocaleString("en-US")} would be used). Raising it is a code change plus a founder approval.`
  );
}
