/**
 * #791-9 的预扣披露,以及它 2026-08-18 被裁掉的那一天。
 *
 * 原状(#791-9):一场对话开始前先冻结一笔,结算按实际 token 扣、剩下当场退回。商家只看见
 * 余额先掉一块又回来一点,产品一个字没解释,于是那一条披露被加了上去。
 *
 * 现状(Founder 裁决 2026-08-18):对话根本不再花钱 —— credits 只花在生成上
 * (@fikirtive/core 的 OTTO_CONVERSATION_TURN_MARGIN = 0)。于是不冻结、不结算、不扣费,
 * 那条披露从「说出真相」变成「描述一件不会发生的事」。删掉它不是省一句话,是止一句假话。
 *
 * 这个文件现在钉的是**不许倒退**:三处文案与 Otto 自己的说法,都不许再回到「聊天要钱」。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as creditFormat from "@/lib/credit-format";
import { CHAT_SPEND_NOTE } from "@/lib/credit-format";

const webRoot = path.resolve(__dirname, "../..");

describe("裁决 2026-08-18:聊天免费,所以预扣披露必须消失", () => {
  it("冻结披露这个常量本身已经不存在了", () => {
    // 留着它就一定会有人再渲染一次 —— 那句话现在是假的。
    expect("CHAT_HOLD_NOTE" in creditFormat).toBe(false);
  });

  it("开场那一屏不再提冻结", () => {
    const src = readFileSync(path.join(webRoot, "components/otto/OttoFrontDoor.tsx"), "utf8");
    expect(src).not.toContain("CHAT_HOLD_NOTE");
    expect(src).toContain("CHAT_SPEND_NOTE");
  });

  it("唯一那句花费披露说的是「免费」,不是「先冻结」", () => {
    expect(CHAT_SPEND_NOTE).toMatch(/free/i);
    expect(CHAT_SPEND_NOTE).not.toMatch(/hold/i);
    // 但也不许含糊到让商家以为生成也免费。
    expect(CHAT_SPEND_NOTE).toMatch(/image or a video/);
  });
});

describe("Otto 自己也不许再说聊天要钱", () => {
  it("指令里写明对话免费、credits 只花在生成上", async () => {
    const { ottoInstructions } = await import("@fikirtive/otto");
    expect(ottoInstructions).toMatch(/Talking to you is FREE/);
    // 旧的三件事(先冻结 / 按实际扣 / 剩下退回)一个字都不许留 —— 它们现在都不会发生。
    expect(ottoInstructions).not.toMatch(/holds a few credits before it starts/i);
    expect(ottoInstructions).not.toMatch(/charged only what it actually used/i);
  });

  it("生成那一句原封不动 —— 免费的是对话,不是生成", async () => {
    const { ottoInstructions } = await import("@fikirtive/otto");
    expect(ottoInstructions).toMatch(
      /Making an image or a video costs credits and never happens without the user approving/,
    );
  });
});
