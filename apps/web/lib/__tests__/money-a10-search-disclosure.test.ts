/**
 * MONEY-A10 商家侧披露(规格 docs/specs/money-engine.md §7.4 + §5 变更登记 2026-09-02
 * 「A10 聊天搜索的商家侧披露」)。
 *
 * ③段把聊天轮的**第二条钱腿**接上了:Otto 在回复里跑的每一次网页搜索都记在商家账上。可顾问复审
 * 2026-09-02 指出,那个价当时只写在**模型自己的系统提示词**里 —— 商家把整个产品读一遍,也不会
 * 知道「帮我查一下对手卖多少钱」比「帮我改一句文案」贵。只对模型披露的价目不是披露。
 * Founder 2026-09-02 当场裁决:聊天输入框下常驻一行价目小字 + billing 价目区加一行,
 * 数值现算、禁字面量;单动作上限的豁免**接受并写明**。这份测试逐条钉那四件事。
 *
 * 四条钉板:
 *   ① 数值是**现算**的 —— 测试自己也跑 `searchUnitChargeInternal` / `searchChargeInternal` /
 *      `OTTO_CHAT_MAX_SEARCHES_PER_TURN` 算期望值,不手抄一个数;两边同源,改费率当天一起动。
 *   ② 组件源码里一个手抄的钱数都没有(源码文本断言,与 MONEY-A9 同一条纪律)。
 *   ③ 挂点真的在:输入框下那一行,与 <UnderstandingCostHint /> 并列;billing 价目区那一节在,
 *      并且写明了单动作上限豁免 —— 一个商家自己设过的开关对这条腿不生效,这件事必须让他看得见。
 *   ④ **反向**:把三个常量 mock 成别的数,界面上的数字必须跟着变。这一条才真正证明「现算」——
 *      正向断言用同一个函数算期望值,如果实现里其实写死了一个巧合相等的字面量,正向照样全绿。
 *
 * 口径与 `packages/otto/src/instructions.ts` 对齐:按**完成**的搜索收费(空手而归也算完成,
 * 失败的调用不算),单轮上限 5 —— Otto 被问到时说的,和输入框不问自答说的,必须是同一句话。
 */
import { createElement } from "react";
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
import { creditsLabel } from "@/lib/credit-format";
import { SearchCostHint, SEARCH_COST_HINT, SEARCH_COST_HINT_TITLE } from "@/components/otto/SearchCostHint";

const WEB_ROOT = process.cwd();
const codeOf = (rel: string) => readFileSync(path.join(WEB_ROOT, rel), "utf8");

/** 「0.3 credits」这类**手抄的钱数**(与 understanding-disclosure 同一条规则)。 */
const HAND_TYPED_CREDITS = /\d[\d,.]*\s*credits?\b/i;

/** 只扫会被商家读到的那部分 —— 注释里解释「0.3 是怎么来的」是文档,不是文案。 */
const copyLines = (src: string): string[] =>
  src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .map((line) => line.trim());

/** React 把 `'` 转义成 `&#x27;`;要读的是商家看到的那句话。 */
const asReadText = (html: string): string => html.replace(/&#x27;|&#39;|&apos;/g, "'");

/** 期望值,由测试**自己现算** —— 与被测代码同一个函数,不是同一份字面量。 */
const unitLabel = creditsLabel(displayCredits(searchUnitChargeInternal("basic")));
const turnMaxLabel = creditsLabel(
  displayCredits(searchChargeInternal(OTTO_CHAT_MAX_SEARCHES_PER_TURN)),
);

describe("MONEY-A10 商家侧披露:聊天输入框下的价目小字", () => {
  const markup = renderToStaticMarkup(createElement(SearchCostHint));

  it("MONEY-A10:单次搜索价与单轮上限逐条出现,且与计价函数同源(测试自己现算)", () => {
    expect(markup, "单次搜索的价没有出现在披露行里").toContain(unitLabel);
    expect(markup, "单轮上限没有出现在披露行里").toContain(String(OTTO_CHAT_MAX_SEARCHES_PER_TURN));
  });

  it("MONEY-A10:「只为完成的搜索收费」在,而且点明空手而归也算完成", () => {
    // 只说「按次收费」是真话,但商家会以为「没查到就不收」—— 而代码收。
    const title = SEARCH_COST_HINT_TITLE.toLowerCase();
    expect(title).toContain("only searches that complete are charged");
    expect(title).toContain("empty-handed");
  });

  it("MONEY-A10:单动作上限的豁免写明了,并带上一条消息的封顶数(Founder 2026-09-02 接受并写明)", () => {
    // 商家自己设的 Spend cap 挡不住这条腿。这是他设过的开关上的一个真实缺口,
    // 之所以可以接受,靠的正是后半句那个封顶数 —— 两半必须在同一句话里。
    expect(SEARCH_COST_HINT_TITLE).toContain("spend cap does not apply");
    expect(SEARCH_COST_HINT_TITLE, "豁免只写了「不受限」却没写封顶数 = 只说了坏消息的一半").toContain(
      turnMaxLabel,
    );
  });

  it("MONEY-A10:组件源码里没有手抄的钱数 —— 数值只能来自推导", () => {
    const src = codeOf("components/otto/SearchCostHint.tsx");
    expect(copyLines(src).filter((line) => HAND_TYPED_CREDITS.test(line)), "披露文案里出现了手抄的钱数").toEqual([]);
    expect(src).toContain("searchUnitChargeInternal");
    expect(src).toContain("OTTO_CHAT_MAX_SEARCHES_PER_TURN");
  });

  it("MONEY-A10:挂在 OttoChatStream 的输入框下,与理解披露并列", () => {
    const src = codeOf("components/otto/OttoChatStream.tsx");
    expect(src, "OttoChatStream 没有 import 搜索披露组件").toContain("SearchCostHint");
    expect(src, "import 了却没有渲染").toContain("<SearchCostHint />");
    // 并列:两条钱腿的披露读起来是一组,不是散落在两处。
    expect(src).toContain("<UnderstandingCostHint />");
    const understandingAt = src.indexOf("<UnderstandingCostHint />");
    const searchAt = src.indexOf("<SearchCostHint />");
    expect(searchAt - understandingAt, "两行披露被拆散了").toBeLessThan(200);
  });

  it("MONEY-A10:样式照抄现成的成本小字,不是第三种长相", () => {
    expect(markup).toContain("text-[0.75rem] text-muted-foreground");
  });
});

describe("MONEY-A10 商家侧披露:billing 价目区的搜索行", () => {
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
    const { default: BillingPage } = await import("@/app/billing/page");
    const html = asReadText(renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) })));
    vi.doUnmock("@/lib/account-actions");
    vi.doUnmock("@/lib/billing-actions");
    vi.doUnmock("@/lib/spend-history-data");
    vi.doUnmock("@/lib/owner-settings-actions");

    expect(html).toContain("Web search in chat");
    expect(html, "价目区少了单次搜索价").toContain(unitLabel);
    expect(html, "价目区少了单轮上限").toContain(String(OTTO_CHAT_MAX_SEARCHES_PER_TURN));
    expect(html, "价目区没说只按成功次数收").toContain("only for searches that complete");
    expect(html, "价目区没说空手而归也算完成").toContain("empty-handed");
    // §5 变更登记 2026-09-02:单动作上限的豁免**接受并写明**。
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
});

describe("MONEY-A10 商家侧披露:反向 —— 换掉常量,界面上的数字必须跟着变", () => {
  it("MONEY-A10:把费率与上限 mock 成别的值,披露行现算出新数字", async () => {
    // 正向断言用同一个函数算期望值 —— 如果实现里其实写死了一个巧合相等的字面量,它照样全绿。
    // 这一条才是「现算」的真凭据:换掉常量,句子必须自己变。
    vi.resetModules();
    vi.doMock("@fikirtive/core/pricing-config", () => ({
      // 7 internal = 0.7 显示 credit,9 次 ⇒ 63 internal = 6.3 显示 credits ——
      // 三个数字与真实值(0.3 / 5 / 1.5)全不相同,不会撞出假绿。
      searchUnitChargeInternal: () => 7,
      searchChargeInternal: (n: number) => n * 7,
      OTTO_CHAT_MAX_SEARCHES_PER_TURN: 9,
    }));
    const mocked = await import("@/components/otto/SearchCostHint");

    expect(mocked.SEARCH_UNIT_LABEL).toBe("0.7 credits");
    expect(mocked.SEARCH_TURN_MAX_LABEL).toBe("6.3 credits");
    expect(mocked.SEARCH_COST_HINT).toContain("0.7 credits");
    expect(mocked.SEARCH_COST_HINT).toContain("9 searches");
    expect(mocked.SEARCH_COST_HINT_TITLE).toContain("6.3 credits");
    // 真值不许残留在 mock 过的句子里(那说明有一处是抄死的)。
    expect(mocked.SEARCH_COST_HINT).not.toContain(unitLabel);
    expect(mocked.SEARCH_COST_HINT_TITLE).not.toContain(turnMaxLabel);

    vi.doUnmock("@fikirtive/core/pricing-config");
    vi.resetModules();
  });
});

describe("MONEY-A10 商家侧披露:与 Otto 说明书同一个口径", () => {
  it("MONEY-A10:输入框不问自答说的,和 Otto 被问到时说的,是同一个价与同一个上限", async () => {
    // 两处措辞不必逐字相同,但**数**必须同源:商家问一句「搜索多少钱」,得到的数字与他
    // 眼前那一行小字不一致,这条披露就作废了。
    const { ottoInstructions } = await import("@fikirtive/otto");
    const amount = `${displayCredits(searchUnitChargeInternal("basic"))} credits`;
    expect(ottoInstructions, "Otto 说明书里的搜索单价与披露行对不上").toContain(amount);
    expect(ottoInstructions, "Otto 说明书里的单轮上限与披露行对不上").toContain(
      String(OTTO_CHAT_MAX_SEARCHES_PER_TURN),
    );
    expect(SEARCH_COST_HINT, "披露行自己少了单价").toContain(unitLabel);
  });
});
