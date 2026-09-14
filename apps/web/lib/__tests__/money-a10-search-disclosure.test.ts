/**
 * MONEY-A10 商家侧披露(规格 docs/specs/money-engine.md §7.4 + §5 变更登记 2026-09-02
 * 「A10 聊天搜索的商家侧披露」,以及 2026-09-14 的 R3-F06)。
 *
 * ③段把聊天轮的**第二条钱腿**接上了:Otto 在回复里跑的每一次网页搜索都记在商家账上。那个价
 * 当时只写在模型自己的系统提示词里 —— 只对模型披露的价目不是披露。Founder 2026-09-02 当场
 * 裁决:聊天输入框下常驻一行价目小字 + billing 价目区加一行,数值现算、禁字面量;单动作上限
 * 的豁免**接受并写明**。
 *
 * **R3-F06(Founder 2026-09-14,本规格 2026-09-14 变更登记,APPROVED)撤掉了其中的输入框那一
 * 行**,并明写「后续不能以 MONEY-A9／A10 为由重新挂回本类段落」。同一条裁决同样明写:移除这
 * 种展示形态**不批准免费搜索**,也不改变价目单一来源、成功搜索计费、次数上限与原有动作确认。
 * 所以这份文件现在钉的是**撤了展示之后剩下的那半边全都还在**:
 *
 *   ① billing 价目区仍旧念四样:单价 / 单轮上限 / 只按成功次数收 / 上限豁免带封顶数。
 *      商家读这个价的地方从两处变成一处,那一处必须完整 —— 这是本条最硬的一格。
 *   ② 数值仍旧**现算**:反向把三个常量 mock 成别的数,标签必须跟着变。这一条是「现算」的真
 *      凭据(正向断言用同一个函数算期望值,实现里写死一个巧合相等的字面量照样全绿)。
 *      它跟着标签从已删除的展示组件搬到了 `lib/credit-format.ts` —— 钱文案的单一来源。
 *   ③ 口径仍旧与 `packages/otto/src/instructions.ts` 对齐:商家问 Otto「搜索多少钱」,
 *      得到的数字必须与 billing 上那一行同源。
 *   ④ 输入框附近那一行**真的不在了**,而且不是换个名字挂回来。
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  OTTO_CHAT_MAX_SEARCHES_PER_TURN,
  searchChargeInternal,
  searchUnitChargeInternal,
} from "@fikirtive/core/pricing-config";
import { displayCredits } from "@fikirtive/core/spend";
import { creditsLabel, SEARCH_UNIT_LABEL } from "@/lib/credit-format";
import { copyLines, HAND_TYPED_CREDITS } from "./helpers/price-literal-fence";

const WEB_ROOT = process.cwd();
const codeOf = (rel: string) => readFileSync(path.join(WEB_ROOT, rel), "utf8");

/** React 把 `'` 转义成 `&#x27;`;要读的是商家看到的那句话。 */
const asReadText = (html: string): string => html.replace(/&#x27;|&#39;|&apos;/g, "'");

/** 期望值,由测试**自己现算** —— 与被测代码同一个函数,不是同一份字面量。 */
const unitLabel = creditsLabel(displayCredits(searchUnitChargeInternal("basic")));
const turnMaxLabel = creditsLabel(
  displayCredits(searchChargeInternal(OTTO_CHAT_MAX_SEARCHES_PER_TURN)),
);

describe("R3-F06 聊天输入框下那一行搜索价目已撤", () => {
  it("R3-F06 三处 composer 都不再挂它,也没有抄回一份文案", () => {
    for (const file of [
      "components/otto/OttoChatStream.tsx",
      "components/start-something/StartSomething.tsx",
      "components/otto/OttoFrontDoor.tsx",
    ]) {
      const src = codeOf(file);
      expect(src, `${file} 又挂回了搜索价目小字`).not.toContain("SearchCostHint");
      expect(src, `${file} 自己抄了一份搜索价目文案`).not.toContain("Otto searches the web");
    }
  });
});

describe("MONEY-A10 商家侧披露:billing 价目区的搜索行(撤了输入框那一行之后,这里是唯一一处)", () => {
  it("MONEY-A10:「Web search in chat」一节在,单价 / 上限 / 只按成功次数 / 上限豁免四样齐", async () => {
    vi.resetModules();
    vi.doMock("@/lib/account-actions", () => ({ getMyAccount: async () => ({ error: "not signed in" }) }));
    vi.doMock("@/lib/billing-actions", () => ({ listCreditPacks: async () => ({ packs: [] }) }));
    vi.doMock("@/lib/spend-history-data", () => ({ getSpendOverview: async () => ({ error: "unavailable" }) }));
    vi.doMock("@/lib/owner-settings-actions", () => ({
      // 前端基线合并(FRONT-A1):花费上限搬到 /billing 之后这一页多读一个数据源;
      // 这一票不测上限,但不 mock 就会打真 auth 假红。
      getOwnerSettings: async () => ({ spendCapCredits: 0 }),
      setOwnerSetting: async () => ({ ok: true as const }),
    }));
    // FSE-202 — BillingLiveRefresh(正文)调用 useRouter();renderToStaticMarkup 不经过 Next 真的
    // App Router,不 mock 就会抛 "expected app router to be mounted"。
    vi.doMock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
    const { default: BillingPage } = await import("@/app/billing/page");
    const html = asReadText(renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) })));
    vi.doUnmock("@/lib/account-actions");
    vi.doUnmock("@/lib/billing-actions");
    vi.doUnmock("@/lib/spend-history-data");
    vi.doUnmock("@/lib/owner-settings-actions");
    vi.doUnmock("next/navigation");

    expect(html).toContain("Web search in chat");
    expect(html, "价目区少了单次搜索价").toContain(unitLabel);
    expect(html, "价目区少了单轮上限").toContain(String(OTTO_CHAT_MAX_SEARCHES_PER_TURN));
    expect(html, "价目区没说只按成功次数收").toContain("only for searches that complete");
    expect(html, "价目区没说空手而归也算完成").toContain("empty-handed");
    // §5 变更登记 2026-09-02:单动作上限的豁免**接受并写明**。R3-F06 没有松开这一格 ——
    // 输入框那一行撤了之后,这里是商家唯一读得到它的地方。
    expect(html, "价目区没写明单动作上限豁免").toContain("per-action spend cap does not stop them");
    expect(html, "豁免那一句缺了封顶数").toContain(turnMaxLabel);
  });

  it("MONEY-A10:billing 页的搜索数字也是现算的,不是页面里另抄的一份", () => {
    const src = codeOf("app/billing/page.tsx");
    expect(src).toContain("OTTO_CHAT_MAX_SEARCHES_PER_TURN");
    expect(src).toContain("SEARCH_UNIT_LABEL");
    const searchCopy = copyLines(src).filter(
      (line) => /search/i.test(line) && HAND_TYPED_CREDITS.test(line),
    );
    expect(searchCopy, "搜索价目区出现了手抄的钱数").toEqual([]);
  });

  it("MONEY-A10:价目标签搬家之后,它的新住处也不许手抄钱数", () => {
    const src = codeOf("lib/credit-format.ts");
    expect(
      copyLines(src).filter((line) => HAND_TYPED_CREDITS.test(line)),
      "钱文案单一来源里出现了手抄的钱数",
    ).toEqual([]);
    expect(src).toContain("searchUnitChargeInternal");
    expect(src).toContain("OTTO_CHAT_MAX_SEARCHES_PER_TURN");
  });
});

describe("MONEY-A10 商家侧披露:反向 —— 换掉常量,billing 上的数字必须跟着变", () => {
  it("MONEY-A10:把费率与上限 mock 成别的值,价目标签现算出新数字", async () => {
    // 正向断言用同一个函数算期望值 —— 如果实现里其实写死了一个巧合相等的字面量,它照样全绿。
    // 这一条才是「现算」的真凭据:换掉常量,标签必须自己变。
    // R3-F06 之后这两个标签住在 `lib/credit-format.ts`(钱文案单一来源),billing 从那里读。
    vi.resetModules();
    vi.doMock("@fikirtive/core/pricing-config", () => ({
      // 7 internal = 0.7 显示 credit,9 次 ⇒ 63 internal = 6.3 显示 credits ——
      // 三个数字与真实值(0.3 / 5 / 1.5)全不相同,不会撞出假绿。
      searchUnitChargeInternal: () => 7,
      searchChargeInternal: (n: number) => n * 7,
      OTTO_CHAT_MAX_SEARCHES_PER_TURN: 9,
    }));
    const mocked = await import("@/lib/credit-format");

    expect(mocked.SEARCH_UNIT_LABEL).toBe("0.7 credits");
    expect(mocked.SEARCH_TURN_MAX_LABEL).toBe("6.3 credits");
    // 真值不许残留(那说明有一处是抄死的)。
    expect(mocked.SEARCH_UNIT_LABEL).not.toBe(unitLabel);
    expect(mocked.SEARCH_TURN_MAX_LABEL).not.toBe(turnMaxLabel);

    vi.doUnmock("@fikirtive/core/pricing-config");
    vi.resetModules();
  });
});

describe("MONEY-A10 商家侧披露:与 Otto 说明书同一个口径", () => {
  it("MONEY-A10:billing 上写的,和 Otto 被问到时说的,是同一个价与同一个上限", async () => {
    // 两处措辞不必逐字相同,但**数**必须同源:商家问一句「搜索多少钱」,得到的数字与
    // billing 价目区对不上,这条披露就作废了。
    const { ottoInstructions } = await import("@fikirtive/otto");
    const amount = `${displayCredits(searchUnitChargeInternal("basic"))} credits`;
    expect(ottoInstructions, "Otto 说明书里的搜索单价与价目区对不上").toContain(amount);
    expect(ottoInstructions, "Otto 说明书里的单轮上限与价目区对不上").toContain(
      String(OTTO_CHAT_MAX_SEARCHES_PER_TURN),
    );
    expect(SEARCH_UNIT_LABEL, "价目标签自己少了单价").toBe(unitLabel);
  });
});
