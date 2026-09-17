// @vitest-environment jsdom
/**
 * 上传理解回执 —— Founder 2026-09-16 裁决(规格 `docs/specs/money-engine.md` §5 2026-09-16 行)。
 *
 * 病情:商家把一张图传上来,后台自动读它,账本上真的扣走 0.1 credit —— 而他从没按过任何
 * 一颗「分析」按钮。R3-F06(Founder 2026-09-14「整段一起删」)把输入附近那几段常驻价目
 * 说明整批撤掉之后,事前这一半**有意**不再说话;裁决同时明写回执不在删除授权内。于是事后
 * 那一半必须补上:东西本身身上留一行「读过了,扣了这么多」。
 *
 * 这一份钉两件事,逐面各跑一遍(商家读得到那行字的两处 —— Library 资产详情的血缘节、
 * 画布卡片的信息面):
 *   ① **结清之后**那一行说得出「Understood · <金额>」,而金额是**账本折出来的那一笔**;
 *      期望值由测试自己从同一条定价来源现算(`pricedUnderstandingCredits` → `displayCredits`
 *      → `creditsLabel`,与 Billing 价目区同源),不手抄一个 "0.1"——涨价当天两边一起动。
 *   ② **还没定论时一个金额都不许出现**(FSE-203 那条不变量的正面表述):正在读、等充值、
 *      我方暂停,三种中间态各说各的实话,但都不许说数字,更不许说「没花钱」。
 *   ③ 到终态而净额为 0(失败/退款,账本 RESERVE+REFUND 相抵)⇒ 没有回执:两面都回到各自
 *      原来的「没花钱」措辞,不编一句 "Understood · 0 credits"。
 *
 * 纯展示:这一份一个 prisma 调用都不发,也不预扣/结算/退款 —— 读模型自己的真库证据在
 * `upload-understanding-receipt-db.test.ts`。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { displayCredits, pricedUnderstandingCredits } from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";
import {
  UNDERSTANDING_PENDING_FALLBACK,
  UNDERSTOOD_LABEL,
  understandingReceipt,
} from "@/lib/understanding-receipt";
import { canvasLineageRows, type CanvasNodeLineage } from "@/lib/canvas-lineage";
import type { GenerationLineage } from "@/lib/actions";

// `next/link` 在 app router 之外拿不到路由上下文;血缘节只是用它画两条回链,与本票无关。
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children?: unknown }) =>
    createElement("a", { href }, children as never),
}));

const { AssetLineage } = await import("@/components/library/AssetLineage");
const { NodeLineagePanel } = await import("@/components/canvas/nodes/NodeLineagePanel");

/** 一件图片素材的理解价,**现算**——与 Billing 价目区、与 worker 落快照用的是同一个函数。 */
const ONE_IMAGE_CAPTION_CREDITS = displayCredits(pricedUnderstandingCredits("image-caption"));
const ONE_IMAGE_CAPTION_LABEL = creditsLabel(ONE_IMAGE_CAPTION_CREDITS);

/** 「屏幕上出现了一个 credits 金额」——中间态一条都不许命中。 */
const CLAIMS_AN_AMOUNT = /\d[\d.,]*\s*credits?/i;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (element: Parameters<Root["render"]>[0]) => {
  act(() => root.render(element));
  return host.textContent ?? "";
};

/** 一件上传素材的血缘,默认是「已经读完、扣过一笔」那一态。 */
function uploadLineage(overrides: Partial<GenerationLineage> = {}): GenerationLineage {
  return {
    canvas: { id: "prj_1", name: "Uploads" },
    conversation: null,
    references: [],
    costCredits: ONE_IMAGE_CAPTION_CREDITS,
    costIsUnderstanding: true,
    costPending: false,
    status: "Uploaded",
    usedIn: [],
    ...overrides,
  };
}

/** 一张上传卡的画布血缘,同样默认「已结清」。 */
function uploadCard(overrides: Partial<CanvasNodeLineage> = {}): CanvasNodeLineage {
  return {
    madeAtLabel: "Sep 16, 2:15 PM",
    settings: { durationSeconds: null, resolution: null, aspectRatio: null },
    costCredits: ONE_IMAGE_CAPTION_CREDITS,
    costIsUnderstanding: true,
    costPending: false,
    batchSize: 1,
    batchPosition: null,
    ...overrides,
  };
}

describe("MONEY-A9 · Founder 2026-09-16:结清之后,那件上传素材身上留一行回执", () => {
  it("Library 资产详情:理解结清后写「Understood · <账本折出来的金额>」", () => {
    const text = render(createElement(AssetLineage, { lineage: uploadLineage() }));
    expect(text).toContain(`${UNDERSTOOD_LABEL} · ${ONE_IMAGE_CAPTION_LABEL}`);
    // 回执取代了那句什么都没解释的 "Cost: 0.1 credits" —— 一件素材只留**一行**回执,
    // 不是两行说同一笔钱(Founder 原话:one receipt line)。
    expect(text, "同一笔钱被说了两遍").not.toContain(`Cost: ${ONE_IMAGE_CAPTION_LABEL}`);
  });

  it("画布卡片信息面:同一笔钱,同一个词,同一个数", () => {
    const rows = canvasLineageRows(uploadCard());
    expect(rows).toContainEqual({ label: UNDERSTOOD_LABEL, value: ONE_IMAGE_CAPTION_LABEL });
    // 卡面上真的画得出来(信息面是 dl,标签与数值分两格)。
    const text = render(createElement(NodeLineagePanel, { lineage: uploadCard() }));
    expect(text).toContain(UNDERSTOOD_LABEL);
    expect(text).toContain(ONE_IMAGE_CAPTION_LABEL);
  });

  it("生成卡一个字没动:付费任务的费用照旧走 Cost 那一行", () => {
    const rows = canvasLineageRows({
      ...uploadCard({ costCredits: 8 }),
      costIsUnderstanding: false,
    });
    expect(rows).toContainEqual({ label: "Cost", value: "8 credits" });
    expect(rows.some((row) => row.label === UNDERSTOOD_LABEL), "生成卡挂上了理解回执").toBe(false);
  });
});

describe("MONEY-A9 · 还没定论时,两面都不许说出一个金额", () => {
  /**
   * 三种中间态。两句 PAUSED* 文案的**权威**在 `@fikirtive/core`,由读模型
   * (`canvas-lineage-data.understandingPendingCopy`)一处映射好整句传下来 ——
   * 所以这里用的是**夹具句**,不是把那两句权威文案又抄一份进测试(家规 §7.3:
   * 抄一份的那天,改文案只会让这道围栏对着自己的旧影子报绿)。映射本身由
   * `upload-understanding-receipt-db.test.ts` 对着权威常量钉。
   */
  const PENDING_STATES: ReadonlyArray<{ name: string; copy: string | undefined }> = [
    { name: "正在读(QUEUED / RUNNING,没有特殊文案)", copy: undefined },
    { name: "等商家充值(PAUSED_BALANCE,读模型给的那一句)", copy: "<fixture> that file is waiting for credits." },
    { name: "我方暂停(PAUSED,读模型给的那一句)", copy: "<fixture> that file hasn't been read yet." },
  ];

  it.each(PENDING_STATES)("Library 资产详情:$name —— 有话说,但没有数字", ({ copy }) => {
    const text = render(createElement(AssetLineage, {
      lineage: uploadLineage({
        costCredits: 0,
        costPending: true,
        ...(copy === undefined ? {} : { costPendingCopy: copy }),
      }),
    }));
    expect(text).toContain(copy ?? UNDERSTANDING_PENDING_FALLBACK);
    expect(text, "结算还没定论,屏幕上却出现了一个金额").not.toMatch(CLAIMS_AN_AMOUNT);
    expect(text, "结算还没定论,却说了「没花钱」").not.toContain("no credits charged");
  });

  it.each(PENDING_STATES)("画布卡片信息面:$name —— 不再说 \"No charge\"", ({ copy }) => {
    const lineage = uploadCard({
      costCredits: 0,
      costPending: true,
      ...(copy === undefined ? {} : { costPendingCopy: copy }),
    });
    expect(canvasLineageRows(lineage)).toContainEqual({
      label: "Cost",
      value: copy ?? UNDERSTANDING_PENDING_FALLBACK,
    });
    const text = render(createElement(NodeLineagePanel, { lineage }));
    expect(text, "上传后的那几十秒里,卡面仍在说「没花钱」").not.toContain("No charge");
    expect(text, "结算还没定论,卡面却报了一个金额").not.toMatch(CLAIMS_AN_AMOUNT);
  });
});

describe("MONEY-A9 · 失败 / 退款:净额为 0 就没有回执可留", () => {
  // 账本上失败的那一笔是 RESERVE + REFUND 相抵,净额恒为 0(与消费历史「Held, then
  // refunded in full」同一个口径)。所以两面都回到各自原来的「没花钱」措辞 —— 既不编一句
  // 「Understood · 0 credits」,也不留一行空回执。
  it("Library 资产详情:回到 \"Cost: no credits charged\",不写回执", () => {
    const text = render(createElement(AssetLineage, {
      lineage: uploadLineage({ costCredits: 0, costPending: false }),
    }));
    expect(text).toContain("Cost: no credits charged");
    expect(text, "0 也被写成了一行回执").not.toContain(UNDERSTOOD_LABEL);
  });

  it("画布卡片信息面:回到 \"No charge\"", () => {
    const rows = canvasLineageRows(uploadCard({ costCredits: 0, costPending: false }));
    expect(rows).toContainEqual({ label: "Cost", value: "No charge" });
  });

  it("判定住在一处:三态由同一个纯函数答完(两面不各判各的)", () => {
    expect(understandingReceipt({ creditsCharged: 0, pending: true })).toEqual({
      state: "pending",
      line: UNDERSTANDING_PENDING_FALLBACK,
    });
    expect(understandingReceipt({ creditsCharged: ONE_IMAGE_CAPTION_CREDITS, pending: false })).toEqual({
      state: "charged",
      line: `${UNDERSTOOD_LABEL} · ${ONE_IMAGE_CAPTION_LABEL}`,
      amount: ONE_IMAGE_CAPTION_LABEL,
    });
    expect(understandingReceipt({ creditsCharged: 0, pending: false })).toEqual({ state: "none" });
  });

  /**
   * **回执念的是账本折出来的那一笔,不是今天的牌价**(MONEY-A7 调价不追溯;跨厂复审 P2)。
   *
   * 上面每一条「已结清」夹具用的都**恰好**是 `pricedUnderstandingCredits("image-caption")`
   * 那个数,于是把 `understanding-receipt.ts` 改成现算牌价,整份测试照样全绿 —— 这条围栏
   * 声称在守的那件事,一条断言都没守住。所以这里给一个**牌价永远算不出来的数**:0.3 是
   * 级联两段(0.1 + 0.2)的账本净额,`creation-upload-understanding-cost.test.ts:139` 里
   * 有同一个数的真读路证据。改成现算牌价的那一刻,这一条当场红。
   *
   * 三层各钉一次:纯函数、画布卡片信息面、Library 资产详情 —— 哪一层偷偷换成牌价都拦得住。
   */
  it("金额是账本已结算的净额,不是今天的牌价(级联两段 0.3,牌价现算永远给不出这个数)", () => {
    const LEDGER_NET = 0.3;
    expect(
      LEDGER_NET,
      "级联净额与单件牌价撞上了 —— 这条围栏失去了它的判别力,换一个牌价算不出的数",
    ).not.toBe(ONE_IMAGE_CAPTION_CREDITS);

    expect(understandingReceipt({ creditsCharged: LEDGER_NET, pending: false })).toEqual({
      state: "charged",
      line: `${UNDERSTOOD_LABEL} · 0.3 credits`,
      amount: "0.3 credits",
    });

    expect(canvasLineageRows(uploadCard({ costCredits: LEDGER_NET })))
      .toContainEqual({ label: UNDERSTOOD_LABEL, value: "0.3 credits" });

    const text = render(createElement(AssetLineage, {
      lineage: uploadLineage({ costCredits: LEDGER_NET }),
    }));
    expect(text, "资产详情把账本净额换成了牌价").toContain(`${UNDERSTOOD_LABEL} · 0.3 credits`);
  });

  it("回执模块里一个手抄的钱数都没有(涨价当天界面不会安静地开始撒谎)", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const source = readFileSync(
      path.join(process.cwd(), "lib/understanding-receipt.ts"),
      "utf8",
    );
    // 注释里可以举例(「例如 Understood · 0.1 credits」),可执行的那部分不许出现字面量金额。
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
      .join("\n");
    expect(code, "回执模块里出现了手抄的钱数").not.toMatch(CLAIMS_AN_AMOUNT);
  });
});
