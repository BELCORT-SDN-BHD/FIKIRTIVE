/**
 * ENGINE-A3 —— 披露先于扣费,在 `OttoFrontDoor` 的**非画布**那一支上(判官 #1211 P2-4／P2-3)。
 *
 * ⑦段(`docs/specs/otto-engine.md` §7.2⑦)把画布那一支的价目披露补齐了,判官同时记下:同一个
 * 组件的另一支 —— 那道有四颗目标格子的门厅 —— 仍然零披露。四颗格子按一下就把标签本身送出去、
 * 开一条真对话,而一轮对话本身按用量计费(§7.4 一级 + §7.6 处置一)。「按得到的地方读不到」
 * 与「读得到的地方按不着」是同一个缺陷的两面,所以这份文件钉两件:
 *
 *   ① **四颗格子渲染出来的那一屏上,披露就在**。断言读的是真组件的真 markup,不是源码正则:
 *      把 `<ConversationCostHint />` 摘掉,这条当场红。
 *   ② **价目组件源码里一个手抄的钱数都没有**(判官 P2-3 要的那道围栏)。这一条是
 *      `understanding-disclosure.test.ts`／`money-a10-search-disclosure.test.ts` 给另外两条
 *      成本小字装过的同一道闸,新的第三条从前不在名单里。手抄一个「4 credits」不会有任何
 *      行为测试变红 —— 它只会在下一次调预扣上限时**悄悄**变成假话。
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
import { CONVERSATION_COST_HINT } from "@/components/otto/ConversationCostHint";
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

describe("ENGINE-A3 门厅非画布那一支:四颗格子与价目同屏", () => {
  it("ENGINE-A3 四颗目标格子渲染出来时,对话价目披露就在同一屏上", () => {
    const markup = frontDoorMarkup();

    // 四颗格子确实画出来了 —— 否则下一条断言会在一张空屏上恒绿。
    for (const label of Object.values(FRONT_DOOR_GOAL_LABELS)) {
      expect(markup, `目标格子「${label}」没渲染`).toContain(label);
    }
    // 披露与它们同屏:按下任何一颗之前就读得到(§7.4 一级)。
    expect(markup, "四颗格子在,价目披露不在 —— 一按就开一条要钱的对话").toContain(
      CONVERSATION_COST_HINT,
    );
  });

  it("ENGINE-A3 门厅两支挂的是同一个披露组件,不是各写一份价目", () => {
    const src = codeOf("components/otto/OttoFrontDoor.tsx");
    // 一次 import、两处渲染(画布那一支 + 这一支)。第二份价目会以第二个 import 出现。
    expect(src).toContain('import { ConversationCostHint } from "@/components/otto/ConversationCostHint"');
    expect(src.split("<ConversationCostHint />").length - 1, "门厅两支不是各挂一次").toBe(2);
  });
});

describe("ENGINE-A3 价目披露组件不许手抄钱数", () => {
  it("ENGINE-A3 披露组件源码里没有手抄的价钱 —— 数值只能来自推导", () => {
    const src = codeOf("components/otto/ConversationCostHint.tsx");
    const offenders = copyLines(src).filter((line) => HAND_TYPED_CREDITS.test(line));
    expect(offenders, "披露文案里出现了手抄的钱数").toEqual([]);
    // 唯一的数来自 `CHAT_HOLD_NOTE`,它自己从 `OTTO_CONVERSATION_TURN_RESERVE_INTERNAL` 现算。
    expect(src).toContain("CHAT_HOLD_NOTE");
  });

  it("ENGINE-A3 商家读到的那句话里,数字与预扣上限同源", () => {
    // 不比字面量:把预扣上限调一格,`CHAT_HOLD_NOTE` 与这句话一起变,这条仍然绿;
    // 而任何人手抄一个数进文案,它当场红。
    expect(CONVERSATION_COST_HINT).toContain(CHAT_HOLD_NOTE);
  });
});
