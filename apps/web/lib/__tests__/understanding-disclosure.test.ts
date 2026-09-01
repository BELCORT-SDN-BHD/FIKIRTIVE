/**
 * understanding-disclosure — MONEY-A9(规格 §7.3):**披露先于扣费**。
 *
 * Founder 2026-08-31 把「素材理解」从平台自费改成商家照算之后,每一张上传的图、每一段上传的
 * 视频都会自动产生一笔扣费。这一票钉的不是那笔扣费怎么走账(那是 worker 侧的验收),而是
 * **商家在按下选择文件之前有没有被告知**。一笔没被告知的扣费,是商家唯一不会原谅的钱 bug。
 *
 * 四条钉板:
 *   ① 三类价必须逐条出现在那一行小字里,而且是**现算**的 —— 测试自己也调
 *      `pricedUnderstandingCredits` 算期望值,不手抄一个数;两边同源,涨价当天一起动。
 *   ② 组件源码里**一个手抄的价钱都不许有**(源码文本断言)。手抄的那一刻,披露就变成了陷阱:
 *      成本钉点一动,界面上的数字会安静地开始撒谎。
 *   ③ 三个上传入口挂的是**同一个**组件(§7.3 点名的三处);EditDesk 不挂 —— 它今天只收音频,
 *      音频不在收费的三类里。
 *   ④ 级联说明必须在(计费四则②):一张图被认出是菜单/价目表时会**再收一次**,
 *      只报第一段价是「真话,但仍然是骗人」。
 *
 * 另外两面:billing 价目区(同源、措辞更详)与 Otto 的 URL 导入(无 UI,披露走动作前报价)。
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  UNDERSTANDING_PRICED_INTERNAL,
  displayCredits,
  pricedUnderstandingCredits,
} from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";
import {
  UNDERSTANDING_COST_HINT_TITLE,
  UnderstandingCostHint,
} from "@/components/otto/UnderstandingCostHint";

const WEB_ROOT = process.cwd();
const codeOf = (rel: string) => readFileSync(path.join(WEB_ROOT, rel), "utf8");

/** 一件某类素材的报价,**按测试自己现算的口径** —— 与被测代码同一个函数,不是同一份字面量。 */
const priceOf = (kind: keyof typeof UNDERSTANDING_PRICED_INTERNAL) =>
  creditsLabel(displayCredits(pricedUnderstandingCredits(kind)));

/** 「12 credits」「0.1 credit」这类**手抄的钱数**。className 里的 `text-[0.75rem]` 不会命中
 *  (它后面跟的是 rem,不是 credit),命中的只有真的把价钱写死在文案里的那种写法。 */
const HAND_TYPED_CREDITS = /\d[\d,.]*\s*credits?\b/i;

/** 只扫**会被商家读到的那部分**:注释里举例说明「0.1 credits 是怎么来的」是文档,不是文案,
 *  而且它正是我们希望留在源码里的解释。手抄的价钱如果藏在注释里,一个商家也看不见。 */
function copyLines(src: string): string[] {
  return src
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .map((line) => line.trim());
}

const MOUNTS = [
  ["components/otto/OttoChatStream.tsx", "Otto 对话的附件入口"],
  ["components/otto/TemplateModal.tsx", "模板的产品图上传"],
  ["components/otto/stuff/AddAssetDialog.tsx", "素材库的多图上传"],
] as const;

describe("MONEY-A9 披露先于扣费:上传入口的价目小字", () => {
  const markup = renderToStaticMarkup(createElement(UnderstandingCostHint));

  it("三类价逐条出现,且与报价函数同源(测试自己现算期望值,不手抄)", () => {
    for (const kind of Object.keys(UNDERSTANDING_PRICED_INTERNAL) as (keyof typeof UNDERSTANDING_PRICED_INTERNAL)[]) {
      expect(markup, `${kind} 的价没有出现在披露行里`).toContain(priceOf(kind));
    }
  });

  it("第四类理解上线时,这句话必须跟着改(枚举长度即闸)", () => {
    // 这一行不是形式主义:三类价是**三个句子槽**,加第四类而不改文案,商家读到的就是一份
    // 缺一档的价目表 —— 而缺的那一档照样扣钱。枚举一变长,这里当场红。
    expect(
      Object.keys(UNDERSTANDING_PRICED_INTERNAL),
      "理解档多了一类:披露行要多一个槽,billing 价目区同样",
    ).toHaveLength(3);
  });

  it("级联说明在(计费四则②:菜单/价目表会被再读一次,两段价一并披露)", () => {
    expect(markup).toContain("menu or price list");
    expect(markup).toContain(priceOf("doc-extract"));
  });

  it("title 说清了什么时候扣、按哪一天的价(四则①:按上传时刻的快照价)", () => {
    expect(markup).toContain(UNDERSTANDING_COST_HINT_TITLE);
    expect(UNDERSTANDING_COST_HINT_TITLE.toLowerCase()).toContain("when you upload");
  });

  it("组件源码里没有手抄的价钱 —— 数值只能来自推导", () => {
    const src = codeOf("components/otto/UnderstandingCostHint.tsx");
    const offenders = copyLines(src).filter((line) => HAND_TYPED_CREDITS.test(line));
    expect(offenders, "披露文案里出现了手抄的钱数").toEqual([]);
    expect(src).toContain("pricedUnderstandingCredits");
  });

  it("样式照抄现成的成本小字(FlowCanvas 的那一行),不是第三种长相", () => {
    expect(markup).toContain("text-[0.75rem] text-muted-foreground");
    expect(codeOf("components/canvas/FlowCanvas.tsx")).toContain(
      'className="text-[0.75rem] text-muted-foreground"',
    );
  });

  it.each(MOUNTS)("%s 挂的是同一个共享组件", (file) => {
    const src = codeOf(file);
    expect(src, `${file} 没有 import 披露组件`).toContain("UnderstandingCostHint");
    expect(src, `${file} import 了却没有渲染`).toContain("<UnderstandingCostHint />");
  });

  it("EditDesk 不挂 —— 它今天只收音频,音频不在收费的三类里(§7.3 单列)", () => {
    expect(codeOf("components/otto/edit/EditDesk.tsx")).not.toContain("UnderstandingCostHint");
  });
});

describe("MONEY-A9 披露先于扣费:billing 页价目区", () => {
  it("Auto-understanding 一节在,三类价同源,级联与上传时刻价都说了", async () => {
    vi.resetModules();
    vi.doMock("@/lib/account-actions", () => ({
      getMyAccount: async () => ({ error: "not signed in" }),
    }));
    vi.doMock("@/lib/billing-actions", () => ({ listCreditPacks: async () => ({ packs: [] }) }));
    vi.doMock("@/lib/spend-history-data", () => ({
      getSpendOverview: async () => ({ error: "unavailable" }),
    }));
    const { default: BillingPage } = await import("@/app/billing/page");

    const html = renderToStaticMarkup(await BillingPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("Auto-understanding");
    for (const kind of Object.keys(UNDERSTANDING_PRICED_INTERNAL) as (keyof typeof UNDERSTANDING_PRICED_INTERNAL)[]) {
      expect(html, `${kind} 的价没有出现在 billing 价目区`).toContain(priceOf(kind));
    }
    expect(html).toContain("menu or a price list");
    // 四则①:结算按上传时刻的快照价,所以价目区不能只报价、不说这笔价什么时候锁。
    expect(html.toLowerCase()).toContain("price shown when you upload");
    vi.doUnmock("@/lib/account-actions");
    vi.doUnmock("@/lib/billing-actions");
    vi.doUnmock("@/lib/spend-history-data");
  });

  it("billing 页的数字也是现算的,不是页面里另抄的一份", () => {
    const src = codeOf("app/billing/page.tsx");
    expect(src).toContain("pricedUnderstandingCredits");
    const understandingCopy = copyLines(src).filter(
      (line) => /understanding/i.test(line) && HAND_TYPED_CREDITS.test(line),
    );
    expect(understandingCopy, "价目区出现了手抄的钱数").toEqual([]);
  });
});

describe("MONEY-A9 披露先于扣费:Otto 的 URL 导入走动作前报价", () => {
  const port = codeOf("lib/otto-media-port.ts");

  it("「$0 by construction」的旧说法已废止 —— 导入落的是会被理解计费的 UPLOAD 素材", () => {
    expect(port).not.toContain("$0 by construction");
    expect(port).toContain("MONEY-A9");
  });

  it("成功结果带一句报价,而且是现算的(无 UI 面,披露只能走动作层)", () => {
    expect(port).toContain("pricedUnderstandingCredits");
    expect(port).toContain("creditsLabel");
    expect(port).toContain("note: importUnderstandingQuote(");
    const offenders = copyLines(port).filter((line) => HAND_TYPED_CREDITS.test(line));
    expect(offenders, "导入报价里出现了手抄的钱数").toEqual([]);
  });

  it("级联那一句只给图片 —— 视频不会触发 doc-extract,承诺它就是另一句假话", () => {
    expect(port).toContain('kind === "image-caption"');
  });

  it("**动作前**那一半真的在动作层:Otto 的说明书与 importMedia 工具描述都带着现算的价", async () => {
    // 上面三条钉的是 port 回来那一句(**事后**报价)。规格 §7.3 要的是「动作前报价」——
    // 事后才告诉商家花了多少,正是这一票开头写的那种「商家唯一不会原谅的钱 bug」。
    // 这条把另一半也钉住:模型在**伸手去调这个工具之前**读到的两处文本里都有那个价。
    const { ottoInstructions, skillCatalog } = await import("@fikirtive/otto");
    const importMedia = skillCatalog.find((s) => s.name === "importMedia");
    expect(importMedia, "importMedia 不在 Otto 的动作表里").toBeDefined();

    for (const kind of Object.keys(UNDERSTANDING_PRICED_INTERNAL) as (keyof typeof UNDERSTANDING_PRICED_INTERNAL)[]) {
      const amount = `${displayCredits(pricedUnderstandingCredits(kind))} credits`;
      expect(ottoInstructions, `Otto 说明书缺 ${kind} 的价`).toContain(amount);
      expect(importMedia!.description, `importMedia 描述缺 ${kind} 的价`).toContain(amount);
    }
    // 先报价、再导入 —— 顺序本身就是这条验收
    expect(ottoInstructions).toContain("Say that price BEFORE you import, never after");
    expect(importMedia!.description).toContain("BEFORE CALLING THIS");
  });
});
