import { describe, it, expect } from "vitest";
import { SETTINGS_SECTIONS } from "@fikirtive/core/navigation";
import {
  formatCredits,
  creditsLabel,
  spendCapBlockedMessage,
  SPEND_CAP_RAISE_CTA,
  TOP_UP_CTA,
} from "../credit-format";

describe("formatCredits", () => {
  it("keeps up to 1 decimal for sub-1000 balances (fractional credits are real signal)", () => {
    expect(formatCredits(42.3)).toBe("42.3");
    expect(formatCredits(0.4)).toBe("0.4");
    expect(formatCredits(999.95)).toBe("1,000"); // rounds to 1 decimal (1000.0) → integer branch
  });

  it("shows a clean whole number for integer sub-1000 balances", () => {
    expect(formatCredits(0)).toBe("0");
    expect(formatCredits(12)).toBe("12");
    expect(formatCredits(500)).toBe("500");
  });

  it("keeps the same 1-decimal precision at 1000+ — grouping never changes the amount (#521)", () => {
    expect(formatCredits(1234567.3)).toBe("1,234,567.3");
    expect(formatCredits(1234.6)).toBe("1,234.6"); // used to silently become "1,235"
    expect(formatCredits(1000.1)).toBe("1,000.1");
    expect(formatCredits(999.99)).toBe("1,000"); // rounds to 1 decimal (1000.0) → integer branch
  });

  it("handles negative deltas (spend) with the same magnitude rule", () => {
    expect(formatCredits(-11.6)).toBe("-11.6");
    expect(formatCredits(-1234.6)).toBe("-1,234.6"); // real amount preserved, not rounded to -1,235
  });

  it("uses a fixed locale so server and client never disagree", () => {
    // en-US thousands separator regardless of the runtime's default locale.
    expect(formatCredits(12345)).toBe("12,345");
  });
});

describe("creditsLabel", () => {
  it("singularizes exactly 1 credit", () => {
    expect(creditsLabel(1)).toBe("1 credit");
  });
  it("pluralizes everything else, including fractional and zero", () => {
    expect(creditsLabel(0)).toBe("0 credits");
    expect(creditsLabel(0.4)).toBe("0.4 credits");
    expect(creditsLabel(20)).toBe("20 credits");
    expect(creditsLabel(12345)).toBe("12,345 credits");
  });

  // #1039 — singular/plural used to judge the RAW value while the number printed was the
  // ROUNDED one, so a balance in [0.95, 1.05) that wasn't exactly 1 printed "1 credits": the
  // digit said one, the word said many. Fixed to judge the same rounded value it prints.
  it("judges singular/plural off the PRINTED amount, not the raw balance", () => {
    expect(creditsLabel(0.95)).toBe("1 credit"); // rounds to "1" — used to print "1 credits"
    expect(creditsLabel(1.04)).toBe("1 credit"); // same rounding, other side of 1
    expect(creditsLabel(1.05)).toBe("1.1 credits"); // rounds past 1 — correctly plural
    expect(creditsLabel(0.04)).toBe("0 credits"); // rounds down to "0"
    expect(creditsLabel(999.95)).toBe("1,000 credits"); // rounds up into the integer branch
  });
});

// #524 — the sentence a merchant reads when their OWN cap stopped an action. The whole point
// of the ticket is that the product's words and the charging path agree, so the words are
// pinned: both real numbers, and the exit is the setting they can move, never a top-up.
describe("spendCapBlockedMessage", () => {
  it("names what the action needed, what the cap is, and where the cap lives", () => {
    expect(spendCapBlockedMessage(11, 5)).toBe(
      "Paused by your spend cap — this needs 11 credits and your cap is 5 credits per action. Raise the cap in Billing & credits to run it.",
    );
  });

  // 前端基线合并 FRONT-A1(结构性改写,不是行为性):这一条原本写成
  // `not.toMatch(/top up|billing/i)`。换壳把 Settings 拆成四面之后,花费上限跟着余额搬到
  // 了那一面,而它**被批准的名字**就叫「Billing & credits」——出路句要指到一个商家真找得到
  // 的地方,就绕不开这个词。围栏钉的行为一个字没松,而且钉得更紧了:仍然不许说「top up」,
  // 另外新增两条——不许共用那句真正的充值 CTA(TOP_UP_CTA),不许说商家没钱了。
  it("never tells a capped merchant to buy credits — they are not short of credits", () => {
    const message = spendCapBlockedMessage(11, 5);
    expect(message).not.toMatch(/top up|out of credits|not enough credits/i);
    expect(message).not.toContain(TOP_UP_CTA);
  });

  it("points at the page the cap actually lives on, not at the retired Settings surface", () => {
    // 上限的控件在 app/billing/SpendCapCard.tsx,挂在 Billing & credits 那一面。
    // 旧句子写的是「Settings」,而新壳的 Settings/General 一个跟钱有关的控件都没有。
    expect(spendCapBlockedMessage(11, 5)).toContain("Billing & credits");
    expect(spendCapBlockedMessage(11, 5)).not.toMatch(/in Settings/);
  });

  /**
   * 判官 P2-c —— 出路句念的那个名字,与导航权威源里那一格的名字是**同一份**。
   *
   * 抄一份在 `credit-format.ts` 里,改名那天商家读到的出路句会指着一个屏幕上已经不存在的
   * 名字,而两处都写着同样的字,没有任何一次红会告诉你。所以这里断言的是「相等」,
   * 而且期望值从 `SETTINGS_SECTIONS` 现取 —— 本文件不再手抄第二份名字。
   */
  it("names the cap's page with the navigation registry's own label, not a hand-copied one", () => {
    const billing = SETTINGS_SECTIONS.find((section) => section.key === "billing");
    expect(billing, "导航权威源里没有 billing 那一格了 —— 出路句无处可指").toBeTruthy();
    expect(SPEND_CAP_RAISE_CTA).toBe(`Raise the cap in ${billing!.label} to run it.`);
    expect(spendCapBlockedMessage(11, 5)).toContain(billing!.label);
    // 出路句去的那一页,就是上限控件所在的那一页。
    expect(billing!.href).toBe("/billing");
  });

  it("singularizes a 1-credit cap like every other credit amount", () => {
    expect(spendCapBlockedMessage(2, 1)).toContain("your cap is 1 credit per action");
  });

  it("says so plainly when the cap could not be read, and confirms nothing was charged", () => {
    expect(spendCapBlockedMessage(11, null)).toBe(
      "Paused — your spend cap couldn't be read, so nothing was charged. Try again in a moment.",
    );
  });
});
