import { describe, it, expect } from "vitest";
import { INTERNAL_PER_DISPLAY } from "./spend.js";
import {
  FINANCE_ADJUST_LIMITS,
  FINANCE_ADJUST_WINDOW_MS,
  FINANCE_PER_ACTION_LIMIT_MESSAGE,
  MANUAL_REFUND_REF_PREFIX,
  manualRefundRefId,
  financeRollingLimitMessage,
} from "./finance-limits.js";

describe("MONEY-A14 — 调账额度单一源的两种单位", () => {
  // 判官复审 ③:账本 balanceDelta 是 internal(×10)。上限一旦被当成同一个数用在两个单位上,
  // 闸要么松 10 倍、要么紧 10 倍,而两种错法在界面上都看不出来。
  it("2000 显示 credits = 20000 内部 credits(换算不许手抄)", () => {
    expect(INTERNAL_PER_DISPLAY).toBe(10);
    expect(FINANCE_ADJUST_LIMITS.rolling30dTotalDisplay).toBe(2000);
    expect(FINANCE_ADJUST_LIMITS.rolling30dTotalInternal).toBe(20_000);
    expect(FINANCE_ADJUST_LIMITS.rolling30dTotalInternal).toBe(
      FINANCE_ADJUST_LIMITS.rolling30dTotalDisplay * INTERNAL_PER_DISPLAY,
    );
  });

  it("单笔 1000 显示 = 10000 内部", () => {
    expect(FINANCE_ADJUST_LIMITS.perActionDisplay).toBe(1000);
    expect(FINANCE_ADJUST_LIMITS.perActionInternal).toBe(
      FINANCE_ADJUST_LIMITS.perActionDisplay * INTERNAL_PER_DISPLAY,
    );
  });

  it("窗口 30 天换算成毫秒", () => {
    expect(FINANCE_ADJUST_LIMITS.windowDays).toBe(30);
    expect(FINANCE_ADJUST_WINDOW_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("退款 refId 只有一种拼法", () => {
    expect(MANUAL_REFUND_REF_PREFIX).toBe("manual-refund:");
    expect(manualRefundRefId("abc-123")).toBe("manual-refund:abc-123");
    expect(manualRefundRefId("abc-123").startsWith(MANUAL_REFUND_REF_PREFIX)).toBe(true);
  });

  it("超限文案由常量生成,不是四份手抄", () => {
    // 这一句在四个 admin 入口上逐字出现过;它现在只有一个出处。
    expect(FINANCE_PER_ACTION_LIMIT_MESSAGE).toBe("Credit actions are capped at 1,000 displayed credits each.");
    expect(financeRollingLimitMessage(2600)).toContain("2,000");
    expect(financeRollingLimitMessage(2600)).toContain("2,600");
    expect(financeRollingLimitMessage(2600)).toContain("30 days");
  });
});
