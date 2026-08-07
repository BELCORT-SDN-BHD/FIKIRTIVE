/**
 * otto-instructions-ui-truth.test.ts — #541 r1 判官 P1-1 的承重钉板。
 *
 * 守的是本票的根命题,只是把它掉转过来对准 Otto 自己的提示词:
 * **Otto 让商家去按的东西,必须真的在界面上存在。**
 *
 * r1 判官抓到的正是这个:提示词命令 Otto 说「press the Confirm button on the card」,
 * 而真实的生成确认卡上第一颗按钮写的是「Review cost ·」,第二步才是「Confirm generate ·」——
 * 全站根本没有一颗标签为「Confirm」的按钮。提示词里写死一个界面标签,就是 #541 要消灭的
 * 死指针,只不过这次说谎的是 Otto 的嘴,不是某个页面。
 *
 * 这条钉板必须**跨包**才承重:`packages/otto` 的测试看不见 `apps/web` 的组件,所以
 * 「提示词说的标签是否真的存在」只能在这里断言。任何一边改动都会让它红:
 *  - 有人往提示词里写回一个按钮标签 → 红;
 *  - 有人把卡上的按钮改名、而提示词照抄了旧名 → 红。
 *
 * 纯文本比对,不触碰任何行为或钱路。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ottoInstructions } from "@fikirtive/otto";

const repoRoot = path.resolve(__dirname, "../../../..");

/** 真实渲染确认流程的组件 —— 商家眼睛真正看到的那几颗按钮的唯一出处。 */
const SPEND_CONFIRM_COMPONENTS = [
  "apps/web/components/otto/OttoPlanCard.tsx",
  "apps/web/components/otto/TemplateModal.tsx",
  "apps/web/components/otto/stuff/AddAssetDialog.tsx",
  "apps/web/components/otto/OttoApprovalCard.tsx",
];

function readComponent(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

describe("#541 r1 P1-1 — 提示词不许指向界面上不存在的按钮", () => {
  it("真实确认流程里没有任何一颗标签就叫 “Confirm” 的按钮(判官论断的事实基础)", () => {
    const sources = SPEND_CONFIRM_COMPONENTS.map(readComponent).join("\n");
    // 真身是两步:先 Review cost,再 Confirm generate。(审批卡则是 Approve。)
    expect(sources).toContain("Review cost");
    expect(sources).toContain("Confirm generate");
    // 「Confirm」后面永远跟着 generate —— 没有裸的 Confirm 按钮可供指路。
    const bareConfirmButton = /["'`>]\s*Confirm\s*["'`<]/;
    expect(
      bareConfirmButton.test(sources),
      "若将来真的加了一颗叫 Confirm 的按钮,请连同提示词一起重新裁定这条钉板",
    ).toBe(false);
  });

  it("提示词不写死任何一个确认流程的按钮标签", () => {
    for (const label of ["Review cost", "Confirm generate", "Confirm button", "Approve button"]) {
      expect(
        ottoInstructions,
        `提示词不得让商家去按 “${label}” —— 按钮标签会漂移,Otto 也看不见它`,
      ).not.toContain(label);
    }
  });

  it("提示词仍然把商家指向卡片本身(Founder 裁定不被这条钉板架空)", () => {
    // 不点名标签 ≠ 不指路。Founder 2026-07-31 裁定:让 Otto 叫商家在卡上动手。
    expect(ottoInstructions).toMatch(/approve it on the card/i);
    expect(ottoInstructions).toMatch(/ONLY thing that ever starts the work/i);
  });
});
