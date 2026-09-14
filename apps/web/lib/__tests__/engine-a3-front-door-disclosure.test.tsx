/**
 * R3-F06 —— 输入附近不再常驻对话费用说明,在 `OttoFrontDoor` 的**非画布**那一支上。
 *
 * 这份文件原本钉的是反方向(ENGINE-A3 §7.4/§7.6 处置一):四颗目标格子那一屏上,对话价目
 * 披露必须常驻。Founder 2026-09-14 看到输入附近堆着三段说明的截图后裁定这类常驻说明不要,
 * 跨全部受影响入口撤掉(`docs/specs/otto-engine.md` 等三份规格的 2026-09-14 变更登记,
 * R3-F06,APPROVED)。于是这份文件翻面,继续钉两件:
 *
 *   ① **四颗格子照样渲染得出来** —— 这一半没变,而且它是下一条断言的活性证据:
 *      没有它,「读不到那段说明」在一张空屏上恒绿。
 *   ② **那段说明真的不在了**,而且不是换个名字挂回来(按商家读到的句子比,不按组件名比)。
 *
 * 撤的只有展示。钱那一侧一个字没动:预扣仍旧现算(`chat-hold-disclosure-791.test.ts`)、
 * 页面下方「You stay in control」那条信任说明仍在并仍念 CHAT_SPEND_NOTE / CHAT_HOLD_NOTE
 * (`otto-chat-design-system.test.ts`、`otto-turn-cost.test.ts`),花钱仍旧先出确认卡。
 *
 * 一个 credit 都花不出去:开线程、付费动作与服务端读全是替身。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/otto-client-actions", () => ({
  ottoApprove: vi.fn(), ottoTurn: vi.fn(), createEmptyCoworkThread: vi.fn(), setAdsAutonomy: vi.fn(),
}));
vi.mock("@/lib/cowork-actions", () => ({
  coworkGenerate: vi.fn(), coworkVaryCard: vi.fn(), cancelGenJob: vi.fn(),
}));
vi.mock("@/lib/cowork-fetch", () => ({ getCoworkThreadClient: vi.fn() }));
vi.mock("@/lib/otto-start-thread", () => ({ startStreamedThread: vi.fn() }));
vi.mock("@/lib/reference-search-actions", () => ({ searchReferencesAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/otto",
  useSearchParams: () => new URLSearchParams(),
}));

import { OttoFrontDoor } from "@/components/otto/OttoFrontDoor";
import { FRONT_DOOR_GOAL_LABELS } from "@/lib/otto-canned-starters";
import { CHAT_HOLD_NOTE } from "@/lib/credit-format";
import { copyLines, HAND_TYPED_CREDITS } from "./helpers/price-literal-fence";

const WEB_ROOT = process.cwd();
const codeOf = (rel: string) => readFileSync(path.join(WEB_ROOT, rel), "utf8");

/** 「手抄的钱数」与「只扫商家读得到的那部分」两条判据,与另外三条成本小字围栏共用同一份
 *  (`helpers/price-literal-fence.ts`;判官 #1227 P2-3 ＝ #1219 P2-4)。 */

/** 门厅的默认(非画布)那一支,渲染成 markup —— 与 `otto-greeting.test.ts` 同一种渲染法。 */
function frontDoorMarkup(): string {
  return renderToStaticMarkup(
    createElement(OttoFrontDoor, {
      projectId: "proj_1",
      userName: "Rahim",
      onThreadStarted: vi.fn(),
      onStreamStart: vi.fn(),
    }),
  );
}

describe("R3-F06 门厅非画布那一支:四颗格子在,输入附近那段常驻说明不在", () => {
  /** 商家读到的那几句话的开头。比句子不比组件名:要拦的正是「换个组件再挂同一段」。 */
  const STANDING_COST_SENTENCES = [
    "Otto checks with you on a card before it makes anything",
    "Otto searches the web when your question needs it",
    "Uploads are understood automatically",
  ] as const;

  it("R3-F06 四颗目标格子照样在,而输入附近不再常驻费用说明", () => {
    const markup = frontDoorMarkup();

    // 四颗格子确实画出来了 —— 否则下一条断言会在一张空屏上恒绿。
    for (const label of Object.values(FRONT_DOOR_GOAL_LABELS)) {
      expect(markup, `目标格子「${label}」没渲染`).toContain(label);
    }
    for (const sentence of STANDING_COST_SENTENCES) {
      expect(markup, `「${sentence}」又常驻在门厅输入附近了`).not.toContain(sentence);
    }
  });

  it("R3-F06 门厅两支都撤了,不是撤一支留一支", () => {
    const src = codeOf("components/otto/OttoFrontDoor.tsx");
    for (const gone of ["ConversationCostHint", "SearchCostHint", "UnderstandingCostHint"]) {
      expect(src, `${gone} 又被挂回门厅了`).not.toContain(gone);
    }
  });
});

describe("R3-F06 撤的是展示,不是钱", () => {
  it("R3-F06 门厅仍旧念预扣那一句,而那个数仍旧是现算的", () => {
    // 页面下方那条「You stay in control」不在本次删除授权内:它说的是审批边界与去哪里
    // 查账,不是输入附近堆叠的那类价目段落。它仍旧念 `CHAT_HOLD_NOTE`,而那句话里的数字
    // 从 `OTTO_CONVERSATION_TURN_RESERVE_INTERNAL` 现算 —— 把预扣上限调一格,它自己会变。
    const src = codeOf("components/otto/OttoFrontDoor.tsx");
    expect(src, "门厅连预扣那一句也一起没了 —— 那超出了 R3-F06 的删除授权").toContain(
      "CHAT_HOLD_NOTE",
    );
    expect(CHAT_HOLD_NOTE).toMatch(/holds up to/i);
    const offenders = copyLines(codeOf("lib/credit-format.ts")).filter((line) =>
      HAND_TYPED_CREDITS.test(line),
    );
    expect(offenders, "钱文案单一来源里出现了手抄的钱数").toEqual([]);
  });
});
