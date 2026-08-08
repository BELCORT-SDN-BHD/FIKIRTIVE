/**
 * #791-7 余额不足要说人话,并且要早说。
 *
 * 原状:Otto 对话开不起来时只说一句「You're out of credits.」。两个问题 ——
 *  ① 它常常不是真的「out」:一场对话开始前要**先冻结 4 credits**,余额 3.9 的商家
 *    一分钱没花过,却被告知自己没钱了。他看着 3.9 的余额,读到「你没有 credits」,
 *    只会以为是产品坏了。
 *  ② 它只在撞墙那一刻出现。余额低于一条视频的价钱时,应该早一步说。
 *
 * 这里钉的是这两句话本身:名字里必须有他真实的余额、真实的门槛,并且指向 Billing。
 */
import { describe, it, expect } from "vitest";
import {
  outOfCreditsMessage,
  chatHoldShortfallMessage,
  lowBalanceForVideoMessage,
} from "@/lib/credit-format";

describe("#791-7 余额不足说人话", () => {
  it("原来那句(只报门槛)一字不改 —— 生成那条路仍然复用它", () => {
    expect(outOfCreditsMessage(11)).toBe("Not enough credits — this needs 11 credits. Top up in Billing.");
  });

  it("对话开不起来时:报出他真实的余额和这一轮要先留多少", () => {
    const msg = chatHoldShortfallMessage(3.9, 4);
    expect(msg).toContain("3.9");
    expect(msg).toContain("4 credits");
    expect(msg).toMatch(/Billing/);
    // 不能再说他「没有 credits」—— 他有 3.9。
    expect(msg).not.toMatch(/out of credits/i);
  });

  it("余额真的是 0 时也不撒谎,照样报数", () => {
    expect(chatHoldShortfallMessage(0, 4)).toContain("0 credits");
  });

  it("余额读不到时退回原来那句,不编一个数字", () => {
    const msg = chatHoldShortfallMessage(null, 4);
    expect(msg).toContain("4 credits");
    expect(msg).not.toMatch(/you have/i);
  });

  it("提前提醒:低于一条视频的价钱就说,并说清楚差在哪", () => {
    const msg = lowBalanceForVideoMessage(6, 11);
    expect(msg).toContain("6 credits");
    expect(msg).toContain("11 credits");
    // 去处不写成死文字 —— 由 components/exits 渲染成真能点的链接(本仓「指路必须可点」的规矩)。
    expect(msg).not.toMatch(/Billing/);
  });

  it("默认视频的价钱是算出来的,不是抄的 —— 改价时提醒跟着动", async () => {
    const { defaultVideoDisplayCredits } = await import("@fikirtive/core");
    // 现役引擎的默认档 = 5s / 720p = 11 显示 credits(#645 T4 已裁的按秒表)
    expect(defaultVideoDisplayCredits()).toBe(11);
  });
});
