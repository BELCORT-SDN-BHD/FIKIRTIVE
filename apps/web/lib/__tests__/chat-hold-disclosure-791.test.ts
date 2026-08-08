/**
 * #791-9 Otto 预扣披露。
 *
 * 一场对话开始前,产品会先从余额里冻结一笔(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL),
 * 结算时按实际 token 花费扣,剩下的当场退回。这整件事对商家从来没说过 —— 他只会看到
 * 余额先掉一块、过一会儿又回来一点,而产品一个字没解释。
 *
 * 「用多少扣多少、剩下当场退」是这条钱路真实的行为(settleCredits 把 A = min(actual, held)
 * 之外的部分退回 balance),说出来只有好处:它比商家自己猜的更宽厚。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CHAT_HOLD_NOTE } from "@/lib/credit-format";

const webRoot = path.resolve(__dirname, "../..");

describe("#791-9 预扣这件事说出口", () => {
  it("三件事一句说全:先冻结多少、按实际扣、剩下退回", async () => {
    const { OTTO_CONVERSATION_TURN_RESERVE_INTERNAL, displayCredits } = await import("@fikirtive/core");
    const hold = displayCredits(OTTO_CONVERSATION_TURN_RESERVE_INTERNAL);
    expect(CHAT_HOLD_NOTE).toContain(`${hold} credits`);
    expect(CHAT_HOLD_NOTE).toMatch(/holds/i);
    expect(CHAT_HOLD_NOTE).toMatch(/only what it uses/i);
    expect(CHAT_HOLD_NOTE).toMatch(/returns the rest/i);
  });

  it("数字是算出来的 —— 冻结额改了,这句话跟着改", () => {
    // 写死 4 就会在下一次调整冻结额时变成一句假话。
    const src = readFileSync(path.join(webRoot, "lib/credit-format.ts"), "utf8");
    expect(src).toContain("OTTO_CONVERSATION_TURN_RESERVE_INTERNAL");
  });

  it("商家开始对话的那一屏就说了", () => {
    const src = readFileSync(path.join(webRoot, "components/otto/OttoFrontDoor.tsx"), "utf8");
    expect(src).toContain("CHAT_HOLD_NOTE");
  });
});

describe("#791-9 Otto 自己也答得上来", () => {
  it("指令里写明预扣三件事,Otto 被问到时不必猜", async () => {
    const { ottoInstructions } = await import("@fikirtive/otto");
    expect(ottoInstructions).toMatch(/holds a few credits before it starts/i);
    expect(ottoInstructions).toMatch(/charged only what it actually used/i);
    expect(ottoInstructions).toMatch(/rest goes back/i);
  });
});
