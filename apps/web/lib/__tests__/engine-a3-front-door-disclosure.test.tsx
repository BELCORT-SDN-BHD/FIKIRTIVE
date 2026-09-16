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
 * Founder 2026-09-15 当面追加一句「整段一起删」:页尾那条「You stay in control」也撤了
 * (它念的是 CHAT_SPEND_NOTE ＋ CHAT_HOLD_NOTE)。于是门厅上这一类常驻说明一处不剩。
 *
 * 撤的只有展示。钱那一侧一个字没动:预扣照旧先冻结、按实结算、当场退差,说得出这件事的面
 * 仍有两处 —— Otto 被问到时自己答(`chat-hold-disclosure-791.test.ts` 第二组)、真实数字在
 * Billing 与 journeys 02/03/04;花钱仍旧先出确认卡(`Generate · N credits`)。
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
    // Founder 2026-09-15 当面追加「整段一起删」:页尾那条「You stay in control」也撤了,
    // 它念的就是这一句。三张名单(本文件 / front-a15 / journey 27)从此一致。
    "Each message holds up to",
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
  it("R3-F06 门厅页尾那条「You stay in control」整段不在了(Founder 2026-09-15 裁决)", () => {
    // 这一条从前钉的是反方向:那段信任说明**必须**留着念 `CHAT_HOLD_NOTE`。
    // Founder 2026-09-15 当面裁决「整段一起删」,于是它翻面 —— 现在拦的是有人把它挂回来,
    // 标题、两条 note、以及那颗盾牌图标一起拦。
    const src = codeOf("components/otto/OttoFrontDoor.tsx");
    for (const gone of ["You stay in control", "CHAT_HOLD_NOTE", "CHAT_SPEND_NOTE", "ShieldCheck"]) {
      expect(src, `「${gone}」又回到门厅了 —— Founder 裁决的是整段删`).not.toContain(gone);
    }
  });

  it("R3-F06 撤了展示,预扣这件事仍旧说得出口 —— 由 Otto 自己答", () => {
    // 删掉界面上的那句话不等于这件事没人说得清。钱那一侧的口径搬到了仍然存在的面上:
    // Otto 被问到时自己答(逐句断言在 `chat-hold-disclosure-791.test.ts` 第二组),
    // 真实数字在 Billing 与 journeys 02/03/04。这里只钉住「钱文案的单一来源没被手抄污染」。
    const offenders = copyLines(codeOf("lib/credit-format.ts")).filter((line) =>
      HAND_TYPED_CREDITS.test(line),
    );
    expect(offenders, "钱文案单一来源里出现了手抄的钱数").toEqual([]);
  });
});
